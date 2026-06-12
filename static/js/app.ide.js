import App from './app.js';
import IDELayout from './layout/layout.ide.js';
import { MAX_FILE_SIZE } from './constants.js';
import { getFileExtension, getRepoInfo, isValidFilename } from './helpers/shared.js';
import Terra from './terra.js';
import { getLocalStorageItem } from './local-storage-manager.js';
import * as fileTreeManager from './file-tree-manager.js';
import { triggerPluginEvent, getPlugin } from './plugin-manager.js';
import GitFS from './fs/git.js';
import { FileNotFoundError, FileTooLargeError } from './fs/vfs.js';
import * as LFS from './fs/lfs.js';

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
  onEditorStartEditing(editorComponent) {
    Terra.v.blockFSPolling = true;
  }

  /**
   * Callback function when the user stops typing.
   *
   * @param {EditorComponent} editorComponent - The editor component instance.
   */
  onEditorStopEditing(editorComponent) {
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

  // ***** git FS *****

  /**
   * Called when starting the app to restore a previous Git connection, if
   * available.
   *
   * @returns {Promise<boolean>} True if not configured OR re-connected.
   */
  async initGitFSAtStart() {
    if (this.isGitConfigured()) {
      console.log('Git project detected upon init');
      return true;
    }

    // In fact, this function currently always returns true because making
    // the Git connection is deferred until later.
    return true;
  }

  /**
   * Initiate connection to GitFS.
   *
   * To be called from menu by user.
   */
  async openGitFS() {
    this.closeAllFiles();
    await this.stopLFS();
    await this.startGitFS();
  }

  /**
   * Close connection to GitFS, reverting to browser temporary storage.
   *
   * To be called from menu by user.
   */
  async closeGitFS() {
    this.closeAllFiles();
    await this.stopGitFS();
    await this.finishSwitchToLocalStorage();
  }

  /**
   * Determines whether a Git repo is configured for use.
   *
   * @returns {boolean} True if configured and should be able to connect.
   */
  isGitConfigured() {
    return getLocalStorageItem('git-repo');
  }

  /**
   * Check whether the GitFS worker has been initialised.
   *
   * @returns {boolean} True if the worker has been initialised, false otherwise.
   */
  hasGitFSWorker() {
    return this.gitfs instanceof GitFS;
  }

  /**
   * Create a new GitFSWorker instance if it doesn't exist yet and only if the
   * the user provided an access token and repository link that are saved in local
   * storage. Otherwise, a worker will be created automatically when the user
   * adds a new repository.
   */
  async startGitFS() {
    await this.vfs.connect(null, 'ide-git');

    const accessToken = getLocalStorageItem('git-access-token');
    const repoLink = getLocalStorageItem('git-repo');
    const repoInfo = getRepoInfo(repoLink);
    if (repoInfo) {
      fileTreeManager.setTitle(`${repoInfo.user}/${repoInfo.repo}`)
    }

    if (this.hasGitFSWorker()) {
      // Pass `false` to *NOT* clear the git-repo and git-branch local storage
      // items, because this if-statement only runs when the user is already
      // connected to a repo and changed the repo URL. Thus, we shouldn't clear
      // them; however, the clearing should only happen when terminate() is
      // called in other places to exclusively terminate the worker without
      // respawning another one.
      this.gitfs.terminate(false);

      this.gitfs = null;
      this.closeAllFiles();
    }

    if (accessToken && repoLink) {
      this.layout.getEditorComponents().forEach((editorComponent) => editorComponent.lock());

      const gitfs = new GitFS(this.vfs, repoLink);
      this.gitfs = gitfs;
      gitfs._createWorker(accessToken);

      fileTreeManager.destroyTree();

      console.log('Creating gitfs worker');
      fileTreeManager.setInfoMsg('Cloning repository...');
      triggerPluginEvent('onStorageChange', 'git');
    }
  }

  /**
   * Disconnect GitFS, removing file cache.
   */
  async stopGitFS() {
    if (this.gitfs) {
      this.gitfs.terminate();
      this.gitfs = null;
      await this.vfs.clear();
      await this.vfs.connect(null, 'ide');
    }
  }

  // ***** local FS API *****

  /**
   * Called when starting the app to restore a previous LFS connection, if
   * available.
   *
   * @returns {Promise<boolean>} True if not configured OR re-connected.
   */
  async initLFSAtStart() {
    // Re-open previous LFS project if available.
    if (LFS.hasProjectLoaded()) {
      const rootFolderHandle = await LFS.reopen();

      // Might not succeed if saved LFS handle is stale.
      if (rootFolderHandle) {
        console.log('LFS project detected upon init');
        await this.vfs.connect(rootFolderHandle);
        return true;
      } else {
        console.log('Tried to reopen LFS but handle was stale.');
        return false;
      }
    }
    return true;
  }

  /**
   * Open a directory picker dialog and connects VFS to the selected directory.
   *
   * To be called from menu by user.
   */
  async openLFSFolder() {
    let rootFolderHandle = await LFS.choose();
    if (!rootFolderHandle) return;

    this.closeAllFiles();

    // Make sure GitFS is stopped before connecting LFS,
    // and VFS cache for Git is cleared.
    await this.stopGitFS();

    fileTreeManager.removeLocalStorageWarning();
    // Set file-tree title to the root folder name.
    fileTreeManager.setTitle(await LFS.getBaseFolderName());

    await this.vfs.connect(rootFolderHandle);

    triggerPluginEvent('onStorageChange', 'lfs');

    // Render the LFS contents.
    await fileTreeManager.createFileTree();
  }

  /**
   * Close the current LFS folder and use the VFS again.
   * Gets called by the "Close Folder" menu item.
   */
  async closeLFSFolder() {
    this.closeAllFiles();
    await this.stopLFS();
    this.finishSwitchToLocalStorage();
  }

  /**
   * Disconnect the LFS from the current folder.
   * Gets called when LFS is closed, or when a Git repo is connected.
   */
  async stopLFS() {
    if (!LFS.hasProjectLoaded()) return;

    await this.vfs.connect(null, 'ide');
    LFS.close();
    this.layout.setProjectMenuState({ closeProjectEnabled: false });
  }

  // ***** FS helpers *****

  /**
   * Start listening to file system changes.
   *
   * N.B. Events will only be sent when local file system is connected,
   * so it is OK to have this listener connected all the time.
   */
  async startLFSChangeListener() {
    this.vfs.addEventListener('fileSystemChanged', async () => {
      // We sometimes have a reason to not pick up changes,
      // e.g. when the user is actively renaming an item.
      if (Terra.v.blockFSPolling || !LFS.hasProjectLoaded()) return;

      // Re-import from the VFS.
      console.log('Reloading file tree from fs change');
      await fileTreeManager.runFuncWithPersistedState(() =>
        fileTreeManager.createFileTree(),
      );
    });
  }

  /**
   * Set-up user interface when disconnecting either LFS or GitFS.
   * Also yields an event to plugins signaling FS change.
   */
  async finishSwitchToLocalStorage() {
    fileTreeManager.removeInfoMsg();
    await fileTreeManager.createFileTree(); // show empty file tree
    fileTreeManager.showLocalStorageWarning();
    fileTreeManager.setTitle('local storage');
    triggerPluginEvent('onStorageChange', 'local');
  }
}
