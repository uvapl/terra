import App from './app.js';
import IDELayout from './layout/layout.ide.js';
import { MAX_FILE_SIZE } from './constants.js';
import { getFileExtension, isValidFilename } from './helpers/shared.js';
import Terra from './terra.js';
import * as fileTreeManager from './file-tree-manager.js';
import { getPlugin } from './plugin-manager.js';
import { FileNotFoundError, FileTooLargeError } from './fs/vfs.js';
import * as LFS from './fs/lfs.js';
import { useStorageCoordinator } from './concerns/storage.js';
import { useGit } from './concerns/git.js';
import { useLFS } from './concerns/lfs.js';

export default class IDEApp extends App {
  /**
   * Reference to the Git filesystem, if loaded.
   * @type {GitFS}
   */
  gitfs = null;

  constructor() {
    super();

    // Files for the IDE are hosted in a subdirectory of the VFS.
    this.vfs.setBaseFolder('ide')

    // Install the storage concerns. The coordinator must be installed before the
    // backends, because each backend registers itself with the coordinator.
    useStorageCoordinator(this);
    useGit(this);
    useLFS(this);
  }

  async setupLayout() {
    // LFS or Git may have been previously connected. Here, we try to
    // reinstate the connection. If either succeeds, we can reopen files
    // that we open earlier, otherwise we will open a fresh Untitled.
    const reset =
      !(await this.initLFSAtStart()) && !(await this.initGitFSAtStart());
    this.layout = this.createLayout(reset);
  }

  async postSetupLayout() {
    if (!LFS.available()) {
      // Disable open-folder if the FileSystemAPI is not supported.
      this.layout.setProjectMenuState({ openFolderEnabled: false });
    } else if (LFS.hasProjectLoaded()) {
      // Enable close-folder menu item.
      this.layout.setProjectMenuState({ closeProjectEnabled: true });
      fileTreeManager.setTitle(await LFS.getBaseFolderName());
    }

    // Initialize file tree.
    await fileTreeManager.createFileTree();

    // Start GitFS if already connected.
    if (this.isGitConfigured()) {
      await this.startGitFS();
    }

    // Warn if no external file system is connected.
    if (!this.isGitConfigured() && !LFS.hasProjectLoaded()) {
      fileTreeManager.showLocalStorageWarning();
    }

    this.startLFSChangeListener();
    this.startFSStructureListener();

    this.layout.refresh();
  }

  /**
   * Reset the layout to its initial state.
   */
  resetLayout() {
    const oldContentConfig = this.layout.getTabComponents().map((component) => ({
      title: component.getFilename(),
      componentName: component.getComponentName(),
      componentState: {
        path: component.getPath(),
        value: component.getContent(),
      }
    }));

    this.layout.resetLayout = true;
    this.layout.destroy();
    this.layout = this.createLayout(true, oldContentConfig);

    // Re-attach the base-class listeners (runCode, editor events) to the new
    // layout instance. Note that postSetupLayout is intentionally not re-bound
    // to 'initialised', as its side effects should only happen at app init.
    this.registerLayoutEvents();

    this.layout.on('initialised', () => {
      setTimeout(() => {
        const editorComponent = this.layout.getActiveEditor();
        const proglang = getFileExtension(editorComponent.getFilename());
        if (this.langWorkerClient.hasActiveWorker() && this.langWorkerClient.supports(proglang)) {
          this.langWorkerClient.restart();
        }
      }, 10);
    });
    this.layout.init();
    this.layout.resetLayout = false;
  }

  /**
   * Callback function when the user starts typing.
   *
   * @param {EditorComponent} editorComponent - The editor component instance.
   */
  onEditorEditingStarted(editorComponent) {
    Terra.v.blockFSPolling = true;
  }

  /**
   * Callback function when the user stops typing.
   *
   * @param {EditorComponent} editorComponent - The editor component instance.
   */
  onEditorEditingStopped(editorComponent) {
    Terra.v.blockFSPolling = false;
  }

  /**
   * Reload the file content.
   *
   * @param {EditorComponent} editorComponent - The editor component instance.
   * @param {boolean} clearUndoStack - Whether to clear the undo stack or not.
   */
  async setEditorFileContent(editorComponent, clearUndoStack = false) {
    const filepath = editorComponent.getPath();
    if (!filepath) return;

    try {
      const content = await this.vfs.readFile(filepath, MAX_FILE_SIZE);

      editorComponent.setContent(content);

      const cursorPos = editorComponent.getCursorPosition();
      editorComponent.setContent(content);
      editorComponent.setCursorPosition(cursorPos);

      if (clearUndoStack) {
        editorComponent.clearUndoStack();
      }
    } catch (err) {
      if (err instanceof FileTooLargeError) {
        editorComponent.exceededFileSize();
      } else if (err instanceof FileNotFoundError) {
        console.warn('Editor file disappeared:', err.path);
      } else {
        console.error('Unexpected error reading file:', err);
      }
    }
  }

  /**
   * Create the layout object with the given content objects and font-size.
   *
   * @param {boolean} [forceDefaultLayout=false] Whether to force the default layout.
   * @param {Array} [contentConfig=[]] The content configuration for the layout.
   * @returns {Layout} The layout instance.
   */
  createLayout(forceDefaultLayout = false, contentConfig = []) {
    const layout = new IDELayout(forceDefaultLayout, contentConfig);

    // Attach listeners here rather than in registerLayoutEvents(), because
    // resetLayout() replaces the layout instance and the new instance needs
    // these listeners too.
    layout.addEventListener('saveFile', () => this.saveFile());
    layout.addEventListener('closeFile', () => this.closeFile());

    return layout;
  }

  /**
   * Get the configuration for the 'Run as...' plugin.
   * This is executed just before the user runs the code from an editor.
   *
   * @returns {object} The configuration object containing the compile source files,
   * compile target, and file arguments.
   */
  getRunAsConfig() {
    const runAsPlugin = getPlugin('run-as');
    const state = runAsPlugin.getState();

    const editorComponent = this.layout.getActiveEditor();
    const activeTabPath = editorComponent.getPath();
    const defaultTarget = editorComponent.getFilename().replace(/\.c$/, '');

    // This regex matches quoted strings (single or double quotes) or unquoted
    // words separated by whitespace and is used to split a string of arguments
    // into a list of individual arguments.
    const parseArgsRegex = /("[^"]*"|'[^']*'|\S+)/g;

    return {
      compileSrcFilenames: (state.compileSrcFilenames || activeTabPath).split(' '),
      compileTarget: state.compileTarget || defaultTarget,
      args: state.args ? state.args.match(parseArgsRegex) : [],
    }
  }

  /**
   * Save the current file on request by the user (i.e. CTRL-S).
   * Another part in the codebase is responsible for auto-saving.
   *
   * This function is mainly used for any file that doesn't exist in the
   * vfs yet. It will prompt the user with a modal for a filename and in
   * which folder to save the file. Finally, the file will be created in
   * the file-tree which automatically creates the file in the vfs.
   *
   * @async
   */
  async saveFile() {
    const editorComponent = this.layout.getActiveEditor();

    if (!editorComponent) return;

    // If the file exists in the vfs, then return, because the contents will be
    // auto-saved already by the editor component.
    const existingFilepath = editorComponent.getPath();
    if (existingFilepath && (await this.vfs.pathExists(existingFilepath)))
      return;

    this.layout.showSaveFileModal({
      filename: editorComponent.getFilename(),
      folders: await this.getFolderList(),
      onSave: (filename, parentPath) =>
        this.saveFileAs(editorComponent, filename, parentPath),
    });
  }

  /**
   * List all folders in the VFS recursively, in depth-first order.
   *
   * @async
   * @param {string} [parentPath] - The absolute parent folder path where
   * subfolders will be fetched from.
   * @param {number} [depth] - The current nesting depth.
   * @returns {Promise<array<object>>} List of `{ path, depth }` folder objects.
   */
  async getFolderList(parentPath = '', depth = 0) {
    const folders = [];

    const subfolders = await this.vfs.listFoldersInFolder(parentPath);
    for (const folderName of subfolders) {
      const subfolderpath = parentPath ? `${parentPath}/${folderName}` : folderName;
      folders.push({ path: subfolderpath, depth });
      folders.push(...(await this.getFolderList(subfolderpath, depth + 1)));
    }

    return folders;
  }

  /**
   * Save the contents of an editor as a new file in the VFS, refresh the file
   * tree and point the editor tab at the new file.
   *
   * @async
   * @param {EditorComponent} editorComponent - The editor component instance.
   * @param {string} filename - The filename for the new file.
   * @param {string} parentPath - The absolute folder path to save the file in,
   * or an empty string for the root folder.
   * @returns {Promise<string|null>} An error message when the save failed, or
   * null on success.
   */
  async saveFileAs(editorComponent, filename, parentPath) {
    const filepath = parentPath ? `${parentPath}/${filename}` : filename;

    if (!isValidFilename(filename)) {
      return 'Name can\'t contain \\ / : * ? " < > |';
    } else if ((await this.vfs.pathExists(filepath))) {
      return `There already exists a "${filename}" file or folder`;
    }

    // Create a new file in the VFS and then refresh the file tree.
    await this.vfs.createFile(filepath, editorComponent.getContent());
    await fileTreeManager.createFileTree();

    // Change the Untitled tab to the new filename.
    editorComponent.setPath(filepath);

    // Update the container state.
    editorComponent.extendState({ path: filepath });

    // For some reason no layout update is triggered, so we trigger an update.
    this.layout.emit('stateChanged');

    const proglang = getFileExtension(filename);

    // Set correct syntax highlighting.
    editorComponent.setProgLang(proglang);

    this.createLangWorker(proglang);

    return null;
  }

  /**
   * Open a file in the editor and if necessary, spawn a new worker based on the
   * file extension.
   *
   * @param {string} filepath - The path of the file to open.
   */
  openFile(filepath) {
    this.layout.addFileTab(filepath);

    const proglang = getFileExtension(filepath);
    this.createLangWorker(proglang);
  }


  /**
   * Close the active tab in the editor.
   *
   * @param {string} filepath - The absolute file path of the tab to close. If
   * not provided, the active tab will be closed.
   */
  closeFile(filepath) {
    const component = filepath
      ? this.layout.getTabComponents().find((component) => component.getPath() === filepath)
      : this.layout.getActiveEditor();

    if (component) {
      component.close();
    }
  }

  /**
   * Close all tabs in the editor.
   */
  closeAllFiles() {
    this.layout.closeAllTabs();
  }

  /**
   * Close all files inside a folder, including nested files in subfolders.
   *
   * @param {string} path - The absolute folderpath to close all files from.
   */
  async closeFilesFromFolder(path) {
    this.layout.getTabComponents().forEach((component) => {
      const subfilepath = component.getPath();
      if (subfilepath?.startsWith(path)) {
        this.closeFile(subfilepath);
      }
    });
  }

  /**
   * Retrieve the file object of the active editor.
   *
   * @async
   * @returns {Promise<object>} The file object.
   */
  async getActiveEditorFileObject() {
    const editorComponent = this.layout.getActiveEditor();
    const filepath = editorComponent.getPath();
    const content = await this.vfs.readFile(filepath);
    return {
      path: filepath,
      content,
    };
  }

  // ***** FS helpers *****

  /**
   * Rebuild the file tree when the VFS structure changes (a file or folder is
   * created or deleted), regardless of the active storage backend. This makes
   * the tree reflect changes made outside the file-tree UI — e.g. files and
   * folders created by the shell via touch, mkdir, or output redirection.
   *
   * Content-only changes (fileContentChanged, e.g. autosave) are intentionally
   * ignored, as they do not alter the tree structure.
   */
  async startFSStructureListener() {
    const rebuild = async () => {
      // Skip while the user is mid-action (e.g. renaming a tree item).
      if (Terra.v.blockFSPolling) return;

      await fileTreeManager.runFuncWithPersistedState(() =>
        fileTreeManager.createFileTree(),
      );
    };

    this.vfs.addEventListener('fileCreated', rebuild);
    this.vfs.addEventListener('folderCreated', rebuild);
    this.vfs.addEventListener('fileDeleted', rebuild);
  }
}
