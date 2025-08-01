import App from './app.js';
import IDELayout from './layout/layout.ide.js';
import { MAX_FILE_SIZE } from './constants.js';
import { getFileExtension, getRepoInfo, isBase64 } from './helpers/shared.js';
import Terra from './terra.js';
import LangWorker from './lang-worker.js';
import localStorageManager from './local-storage-manager.js';
import fileTreeManager from './file-tree-manager.js';
import pluginManager from './plugin-manager.js';
import GitFS from './gitfs.js';
import { FileNotFoundError, FileTooLargeError } from './vfs-client.js';
import * as LFS from './fs/lfs.js';

export default class IDEApp extends App {
  /**
   * Reference to the Git filesystem, if loaded.
   * @type {GitFS}
   */
  gitfs = null;

  constructor() {
    super();
  }

  getOPFSRootFolderName() {
    return 'ide';
  }

  async setupLayout() {
    // Re-open previous LFS project if available.
    if (LFS.hasProjectLoaded()) {
      const rootFolderHandle = await LFS.reopen();

      // Might not succeed if saved LFS handle is stale.
      if (rootFolderHandle) {
        console.log('LFS project detected upon init');
        await this.vfs.connect(rootFolderHandle);
      } else {
        console.log("Tried to reopen LFS but handle was stale.")
        await this.closeLFSFolder();
      }
    }

    this.layout = this.createLayout();
  }

  async postSetupLayout() {
    if (!LFS.available()) {
      // Disable open-folder if the FileSystemAPI is not supported.
      $('#menu-item--open-folder').remove();
      $('#menu-item--close-folder').remove();
    } else if (LFS.hasProjectLoaded()) {
      // Enable close-folder menu item.
      $('#menu-item--close-folder').removeClass('disabled');
      fileTreeManager.setTitle(await LFS.getBaseFolderName());
    }

    // Initialize file tree.
    await fileTreeManager.createFileTree();
    const repoLink = localStorageManager.getLocalStorageItem('git-repo');
    if (!repoLink && !LFS.hasProjectLoaded()) {
      fileTreeManager.showLocalStorageWarning();
    }

    // Start GitFS if already connected.
    if (localStorageManager.getLocalStorageItem('git-repo')) {
      console.log('Git project detected upon init')
      this.createGitFSWorker();
    }

    this.startLFSChangeListener();

    $(window).resize();
  }

  /**
   * Reset the layout to its initial state.
   */
  resetLayout() {
    const oldContentConfig = Terra.app.layout.getTabComponents().map((component) => ({
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
    this.layout.on('initialised', () => {
      setTimeout(() => {
        const editorComponent = this.layout.getActiveEditor();
        const proglang = getFileExtension(editorComponent.getFilename());
        if (Terra.app.langWorker && LangWorker.hasWorker(proglang)) {
          Terra.app.langWorker.restart();
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
   * Reload the file content.
   *
   * @param {ImageComponent} imageComponent - The image component instance.
   */
  async setImageFileContent(imageComponent) {
    const filepath = imageComponent.getPath();
    if (!filepath) return;

    try {
      const content = await this.vfs.readFile(filepath, MAX_FILE_SIZE);
      if (isBase64(content)) {
        // For base64 content we can directly set it.
        imageComponent.setContent(content);
      } else {
        // For binary content we create a blob URL.
        const link = await this.vfs.getFileURL(filepath);
        imageComponent.setSrc(link);
      }
    } catch (err) {
      if (err instanceof FileTooLargeError) {
        imageComponent.exceededFileSize();
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
    return new IDELayout(forceDefaultLayout, contentConfig);
  }

  /**
   * Get the configuration for the 'Run as...' plugin.
   * This is executed just before the user runs the code from an editor.
   *
   * @returns {object} The configuration object containing the compile source files,
   * compile target, and file arguments.
   */
  getRunAsConfig() {
    const runAsPlugin = pluginManager.getPlugin('run-as');
    const state = runAsPlugin.getState();

    const editorComponent = this.layout.getActiveEditor();
    const activeTabName = editorComponent.getFilename();
    const defaultTarget = activeTabName.replace(/\.c$/, '');

    // This regex matches quoted strings (single or double quotes) or unquoted
    // words separated by whitespace and is used to split a string of arguments
    // into a list of individual arguments.
    const parseArgsRegex = /("[^"]*"|'[^']*'|\S+)/g;

    return {
      compileSrcFilenames: (state.compileSrcFilenames || activeTabName).split(' '),
      compileTarget: state.compileTarget || defaultTarget,
      args: state.args ? state.args.match(parseArgsRegex) : [],
    }
  }

  /**
   * Create a new GitFSWorker instance if it doesn't exist yet and only if the
   * the user provided an ssh-key and repository link that are saved in local
   * storage. Otherwise, a worker will be created automatically when the user
   * adds a new repository.
   */
  async createGitFSWorker() {
    await this.terminateLFS();

    const accessToken = localStorageManager.getLocalStorageItem('git-access-token');
    const repoLink = localStorageManager.getLocalStorageItem('git-repo');
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
      Terra.app.layout.getEditorComponents().forEach((editorComponent) => editorComponent.lock());

      const gitfs = new GitFS(this.vfs, repoLink);
      this.gitfs = gitfs;
      gitfs._createWorker(accessToken);

      fileTreeManager.destroyTree();

      console.log('Creating gitfs worker');
      fileTreeManager.setInfoMsg('Cloning repository...');
      pluginManager.triggerEvent('onStorageChange', 'git');
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

    this.layout.promptSaveFile(editorComponent);
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
    this.layout.getTabComponents().forEach((component) => component.close());
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
      content
    }
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
   * Open a directory picker dialog and returns the selected directory.
   */
  async openLFSFolder() {
    let rootFolderHandle = await LFS.choose();

    // Make sure GitFS is stopped before connecting LFS,
    // and VFS cache for Git is cleared.
    if (this.hasGitFSWorker()) {
      await this.vfs.clear();
      this.gitfs.terminate();
      this.gitfs = null;
    }

    fileTreeManager.removeLocalStorageWarning();
    this.closeAllFiles();
    // Set file-tree title to the root folder name.
    fileTreeManager.setTitle(await LFS.getBaseFolderName());
    pluginManager.triggerEvent('onStorageChange', 'lfs');

    await this.vfs.connect(rootFolderHandle);

    // Render the LFS contents.
    await fileTreeManager.createFileTree();
  }

  /**
   * Disconnect the LFS from the current folder.
   * Gets called when LFS is closed, or when a Git repo is connected.
   */
  async terminateLFS() {
    if (!LFS.hasProjectLoaded()) return;

    await this.vfs.connect(null);
    LFS.close();
    $('#menu-item--close-folder').addClass('disabled');
  }

  /**
   * Close the current LFS folder and use the VFS again.
   * Gets called by the "Close Folder" menu item.
   */
  async closeLFSFolder() {
    await this.terminateLFS();
    await fileTreeManager.createFileTree(); // show empty file tree
    fileTreeManager.showLocalStorageWarning();
    fileTreeManager.setTitle('local storage');
    pluginManager.triggerEvent('onStorageChange', 'local');
  }

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
      console.log('Reloading file tree from fs change')
      await fileTreeManager.runFuncWithPersistedState(
        () => fileTreeManager.createFileTree()
      );
    });
  }
}
