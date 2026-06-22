import App from './app.js';
import IDEController from './controllers/ide.js';
import { getFileExtension, isValidFilename } from './lib/helpers.js';
import { getPlugin } from './plugin-manager.js';
import { removeLocalStorageItem } from './lib/local-storage-manager.js';
import * as LFS from './fs/lfs.js';
import { useFileTree } from './concerns/filetree.js';
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

    // The file-tree concern: creates the view component (app.fileTree) and makes
    // this app its controller (delegate + coordination methods).
    useFileTree(this);

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

    // The controller reads persisted state and builds the IDE layout. The app
    // talks only to the controller. The save command calls this.saveFile()
    // directly (see app.ide.commands.js).
    this.view = new IDEController({
      delegate: this,
      forceDefaultLayout: reset,
      contentConfig: []
    });
  }

  async afterSetupLayout() {
    if (!LFS.available()) {
      // Disable open-folder if the FileSystemAPI is not supported.
      this.view.setProjectMenuState({ openFolderEnabled: false });
    } else if (LFS.hasProjectLoaded()) {
      // Enable close-folder menu item.
      this.view.setProjectMenuState({ closeProjectEnabled: true });
      this.fileTree.setTitle(await LFS.getBaseFolderName());
    }

    // Initialize file tree.
    await this.refreshFileTree();

    // Start GitFS if already connected.
    if (this.isGitConfigured()) {
      await this.startGitFS();
    }

    // Warn if no external file system is connected.
    if (!this.isGitConfigured() && !LFS.hasProjectLoaded()) {
      this.fileTree.showLocalStorageWarning();
    }

    this.view.refresh();
  }

  /**
   * Close the currently open project, whichever storage backend it uses (Git or
   * LFS), reverting to browser temporary storage. Invoked by the "Close Project"
   * menu item.
   */
  async closeProject() {
    removeLocalStorageItem('git-repo');
    await this.closeGitFS();
    await this.closeLFSFolder();
    this.view.setProjectMenuState({ closeProjectEnabled: false });
  }

  /**
   * Reset the layout to its initial state. The controller owns the
   * destroy/recreate lifecycle (see IDEController.recreate); here we reset the
   * font size, refresh our layout reference and re-init.
   * The controller rebuilds its layout (preserving open tabs) and re-inits.
   * It fires afterLayoutReset() on this app once the new layout is ready;
   * afterSetupLayout is intentionally not re-run (init-only side effects).
   */
  resetLayout() {
    this.view.recreate();
  }

  /**
   * Delegate hook invoked by the controller after a layout reset. Restart the
   * language worker for the active tab so it starts from a clean state — only
   * when a worker is active and supports the active tab's language.
   */
  afterLayoutReset() {
    setTimeout(() => {
      const editorComponent = this.view.getActiveEditor();
      const proglang = getFileExtension(editorComponent.getFilename());
      if (this.langWorkerClient.hasActiveWorker() && this.langWorkerClient.supports(proglang)) {
        this.langWorkerClient.restart();
      }
    }, 10);
  }

  /**
   * Callback function when the user starts typing.
   *
   * @param {EditorTab} editorComponent - The editor component instance.
   */
  onEditorEditingStarted(editorComponent) {
    this.suspendFSReload();
  }

  /**
   * Callback function when the user stops typing.
   *
   * @param {EditorTab} editorComponent - The editor component instance.
   */
  onEditorEditingStopped(editorComponent) {
    this.resumeFSReload();
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

    const editorComponent = this.view.getActiveEditor();
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
    const editorComponent = this.view.getActiveEditor();

    if (!editorComponent) return;

    // If the file exists in the vfs, then return, because the contents will be
    // auto-saved already by the editor component.
    const existingFilepath = editorComponent.getPath();
    if (existingFilepath && (await this.vfs.pathExists(existingFilepath)))
      return;

    this.view.showSaveFileModal({
      filename: editorComponent.getFilename(),
      folders: await this.vfs.getFolderList(),
      onSave: (filename, parentPath) =>
        this.saveFileAs(editorComponent, filename, parentPath),
    });
  }

  /**
   * Save the contents of an editor as a new file in the VFS, refresh the file
   * tree and point the editor tab at the new file.
   *
   * @async
   * @param {EditorTab} editorComponent - The editor component instance.
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
    await this.refreshFileTree();

    // Re-point the Untitled tab at the new file (path, title, highlighting,
    // persisted state) and spawn the matching worker.
    const proglang = getFileExtension(filename);
    this.view.repointTab(editorComponent, filepath);
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
    this.view.addFileTab(filepath);
    const proglang = getFileExtension(filepath);
    this.createLangWorker(proglang);
  }

  /**
   * Re-point any open tab when its file is renamed or moved in the VFS, and
   * (re)spawn the worker for the new language. A no-op when the file isn't open.
   * Called by the file tree after a rename/move so it doesn't have to reach into
   * the layout or tab components itself.
   *
   * @param {string} srcPath - The previous absolute path.
   * @param {string} destPath - The new absolute path.
   */
  updateOpenTabPath(srcPath, destPath) {
    const filename = destPath.split('/').pop();
    const proglang = filename.includes('.') ? getFileExtension(filename) : 'text';

    const tabComponent = this.view.repointTabByPath(srcPath, destPath, proglang);
    if (tabComponent) {
      this.createLangWorker(proglang);
    }
  }

  /**
   * Close the active tab in the editor.
   *
   * @param {string?} filepath - The absolute file path of the tab to close. If
   * not provided, the active tab will be closed.
   */
  closeFile(filepath) {
    this.view.closeFile(filepath);
  }

  /**
   * Close all tabs in the editor.
   */
  closeAllFiles() {
    this.view.closeAllTabs();
  }

  /**
   * Close all files inside a folder, including nested files in subfolders.
   *
   * @param {string} path - The absolute folderpath to close all files from.
   */
  closeFilesFromFolder(path) {
    this.view.closeFilesFromFolder(path);
  }

  /**
   * Retrieve the file object of the active editor.
   *
   * @async
   * @returns {Promise<object>} The file object.
   */
  async getActiveEditorFileObject() {
    const editorComponent = this.view.getActiveEditor();
    const filepath = editorComponent.getPath();
    const content = await this.vfs.readFile(filepath);
    return {
      path: filepath,
      content,
    };
  }

}
