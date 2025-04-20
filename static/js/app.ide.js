import App from './app.js';
import IDELayout from './layout/layout.ide.js';
import { LFS_MAX_FILE_SIZE } from './constants.js';
import {
  getFileExtension,
  hasGitFSWorker,
  getRepoInfo,
} from './helpers/shared.js';
import Terra from './terra.js';
import LangWorker from './lang-worker.js';
import localStorageManager from './local-storage-manager.js';
import fileTreeManager from './file-tree-manager.js';
import LocalFileSystem from './lfs.js';
import pluginManager from './plugin-manager.js';
import GitFS from './gitfs.js';

export default class IDEApp extends App {
  /**
   * Reference to the Git filesystem, if loaded.
   * @type {GitFS}
   */
  gitfs = null;

  /**
   * Reference to the Local File System (LFS) instance.
   * @type {LocalFileSystem}
   */
  lfs = null;

  constructor() {
    super();

    if (this.browserHasLFSApi()) {
      this.lfs = new LocalFileSystem();
    }
  }

  /**
   * Whether the LFS has been initialized (which only happens in the IDE) and
   * the user subsequently loaded a project. This instance variable remains
   *
   * @returns {boolean} True if an LFS project is loaded.
   */
  get hasLFSProjectLoaded() {
    return this.lfs && this.lfs.loaded;
  }

  /**
   * Check whether the browser has support for the Local Filesystem API.
   *
   * @returns {boolean} True if the browser supports the api.
   */
  browserHasLFSApi() {
    return 'showOpenFilePicker' in window;
  }

  setupLayout() {
    this.layout = this.createLayout();
  }

  postSetupLayout() {
    // Fetch the repo files or the local storage files (vfs) otherwise.
    const repoLink = localStorageManager.getLocalStorageItem('git-repo');
    if (repoLink) {
      this.createGitFSWorker();
    } else {
      this.lfs.init();
      fileTreeManager.createFileTree();
    }

    if (!this.browserHasLFSApi()) {
      // Disable open-folder if the FileSystemAPI is not supported.
      $('#menu-item--open-folder').remove();
    }

    if (!repoLink && !this.browserHasLFSApi()) {
      fileTreeManager.showLocalStorageWarning();
    }

    $(window).resize();
  }

  /**
   * Reset the layout to its initial state.
   */
  resetLayout() {
    const oldContentConfig = Terra.app.layout.getEditorComponents().map((editorComponent) => ({
      title: editorComponent.getFilename(),
      componentState: {
        fileId: editorComponent.getState().fileId,
        value: editorComponent.getContent(),
      }
    }));

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
  }

  /**
   * Callback function when the user starts typing.
   *
   * @param {EditorComponent} editorComponent - The editor component instance.
   */
  onEditorStartEditing(editorComponent) {
    Terra.v.blockLFSPolling = true;
  }

  /**
   * Callback function when the user stops typing.
   *
   * @param {EditorComponent} editorComponent - The editor component instance.
   */
  onEditorStopEditing(editorComponent) {
    Terra.v.blockLFSPolling = false;
  }

  /**
   * Reload the file content either from VFS or LFS.
   *
   * @param {EditorComponent} editorComponent - The editor component instance.
   * @param {boolean} clearUndoStack - Whether to clear the undo stack or not.
   */
  setEditorFileContent(editorComponent, clearUndoStack = false) {
    const file = this.vfs.findFileById(editorComponent.getState().fileId);
    if (!file) return;

    if (Terra.app.hasLFSProjectLoaded && typeof file.size === 'number' && file.size > LFS_MAX_FILE_SIZE) {
      editorComponent.exceededFileSize();
    } else if (Terra.app.hasLFSProjectLoaded && !hasGitFSWorker() && !file.content) {
      // Load the file content from LFS.
      const cursorPos = editorComponent.getCursorPosition();
      this.lfs.getFileContent(file.id).then((content) => {
        editorComponent.setContent(content);
        editorComponent.setCursorPosition(cursorPos);

        if (clearUndoStack) {
          editorComponent.clearUndoStack();
        }
      });
    } else {
      editorComponent.setContent(file.content);
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
   * Get the arguments for the current file.
   * This is executed just before the user runs the code from an editor.
   *
   * @param {string} fileId - The ID of the file to get the arguments for.
   * @returns {array} The arguments for the current file.
   */
  getCurrentFileArgs(fileId) {
    const filepath = this.vfs.getAbsoluteFilePath(fileId);
    const fileArgsPlugin = pluginManager.getPlugin('file-args').getState('fileargs');
    const fileArgs = fileArgsPlugin[filepath];

    const parseArgsRegex = /("[^"]*"|'[^']*'|\S+)/g;
    return fileArgs !== undefined ? fileArgs.match(parseArgsRegex) : [];
  }

  /**
   * Create a new GitFSWorker instance if it doesn't exist yet and only if the
   * the user provided an ssh-key and repository link that are saved in local
   * storage. Otherwise, a worker will be created automatically when the user
   * adds a new repository.
   */
  createGitFSWorker() {
    if (this.haLFSProjectLoaded) {
      this.lfs.terminate();
    }

    const accessToken = localStorageManager.getLocalStorageItem('git-access-token');
    const repoLink = localStorageManager.getLocalStorageItem('git-repo');
    const repoInfo = getRepoInfo(repoLink);
    if (repoInfo) {
      fileTreeManager.setTitle(`${repoInfo.user}/${repoInfo.repo}`)
    }

    if (hasGitFSWorker()) {
      this.gitfs.terminate();
      this.gitfs = null;
      Terra.app.layout.closeAllFiles();
    }

    if (accessToken && repoLink) {
      Terra.app.layout.getEditorComponents().forEach((editorComponent) => editorComponent.lock());

      const gitfs = new GitFS(repoLink);
      this.gitfs = gitfs;
      gitfs._createWorker(accessToken);

      fileTreeManager.destroyTree();

      console.log('Creating gitfs worker');
      $('#file-tree').html('<div class="info-msg">Cloning repository...</div>');
      pluginManager.triggerEvent('onStorageChange', 'git');
    }
  }
}
