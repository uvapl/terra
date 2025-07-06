import App from './app.js';
import IDELayout from './layout/layout.ide.js';
import { LFS_MAX_FILE_SIZE } from './constants.js';
import {
  getFileExtension,
  hasGitFSWorker,
  getRepoInfo,
  isObject,
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

  /**
   * This is mainly used for files/folders where a user could potentially
   * trigger another file onchange event, while the previous file change of
   * another file hasn't been synced. In that case, it shouldn't overwrite the
   * previous file its timeout handler. This happens when a user made a change
   * in file and immediately switches to another file.
   * @type {object<string, number>}
   */
  timeoutHandlers = {};

  constructor() {
    super();

    if (this.browserHasLFSApi()) {
      this.lfs = new LocalFileSystem(this.vfs);
    }
  }

  /**
   * Register a timeout handler based on an ID.
   *
   * @param {string} id - Some unique identifier, like uuidv4.
   * @param {number} timeout - The amount of time in milliseconds to wait.
   * @param {function} callback - Callback function that will be invoked.
   */
  registerTimeoutHandler(id, timeout, callback) {
    if (!isObject(this.timeoutHandlers)) {
      this.timeoutHandlers = {};
    }

    if (typeof this.timeoutHandlers[id] !== 'undefined') {
      clearTimeout(this.timeoutHandlers[id]);
    }

    this.timeoutHandlers[id] = setTimeout(() => {
      callback();
      clearTimeout(this.timeoutHandlers[id]);
      delete this.timeoutHandlers[id];
    }, timeout);
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
    // Check what to start after the page loads (GitFS, LFS or local storage).
    const repoLink = localStorageManager.getLocalStorageItem('git-repo');
    const useLFS = localStorageManager.getLocalStorageItem('use-lfs', false);
    if (repoLink) {
      this.createGitFSWorker();
    } else if (useLFS) {
      this.lfs.init();
    } else {
      // local storage
      fileTreeManager.createFileTree();
    }

    if (!this.browserHasLFSApi()) {
      // Disable open-folder if the FileSystemAPI is not supported.
      $('#menu-item--open-folder').remove();
    }

    if (!repoLink && !useLFS) {
      fileTreeManager.showLocalStorageWarning();
    }

    $(window).resize();
  }

  /**
   * Reset the layout to its initial state.
   */
  resetLayout() {
    const oldContentConfig = Terra.app.layout.getTabComponents().map((tabComponent) => ({
      title: tabComponent.getFilename(),
      componentName: tabComponent.getComponentName(),
      componentState: {
        fileId: tabComponent.getState().fileId,
        value: tabComponent.getContent(),
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
   * @async
   * @param {EditorComponent} editorComponent - The editor component instance.
   * @param {boolean} clearUndoStack - Whether to clear the undo stack or not.
   */
  async setEditorFileContent(editorComponent, clearUndoStack = false) {
    const content = await this.vfs.getFileContentByPath(editorComponent.getPath());
    editorComponent.setContent(content);

    const cursorPos = editorComponent.getCursorPosition();
    editorComponent.setContent(content);
    editorComponent.setCursorPosition(cursorPos);

    if (clearUndoStack) {
      editorComponent.clearUndoStack();
    }

    return;

    // TODO: We do want to persist the max filesize check and still call the
    // editorComponent.exceededFileSize() function.
    //
    // Maybe this function here can be removed since it will be identical to the
    // same definition in app.js, but that's still indecisive.

    if (Terra.app.hasLFSProjectLoaded && typeof file.size === 'number' && file.size > LFS_MAX_FILE_SIZE) {
      editorComponent.exceededFileSize();
    } else if (Terra.app.hasLFSProjectLoaded && !file.content) {
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
   * Reload the file content either from VFS or LFS.
   *
   * @param {ImageComponent} imageComponent - The image component instance.
   */
  setImageFileContent(imageComponent) {
    const file = this.vfs.findFileById(imageComponent.getState().fileId);
    if (!file) return;

    if (Terra.app.hasLFSProjectLoaded && typeof file.size === 'number' && file.size > LFS_MAX_FILE_SIZE) {
      imageComponent.exceededFileSize();
    } else if (Terra.app.hasLFSProjectLoaded && !file.content) {
      // Load the file content from LFS.
      this.lfs.getFile(file.id).then((file) => {
        const url = URL.createObjectURL(file);
        imageComponent.img.src = url;
      });
    } else {
      imageComponent.setContent(file.content);
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
      $('#file-tree').html('<div class="info-msg">Cloning repository...</div>');
      pluginManager.triggerEvent('onStorageChange', 'git');
    }
  }

  /**
   * Save the current file. Another part in the codebase is responsible for
   * auto-saving the file. This function will be used mainly for any file that
   * doesn't exist in th vfs yet. It will prompt the user with a modal for a
   * filename and in which folder to save the file. Finally, the file will be
   * created in the file-tree which automatically creates the file in the vfs.
   *
   * This function gets triggered on each 'save' keystroke, i.e. <cmd/ctrl + s>.
   */
  saveFile() {
    const editorComponent = this.layout.getActiveEditor();

    if (!editorComponent) return;

    // If the file exists in the vfs, then return, because the contents will be
    // auto-saved already by the editor component.
    const existingFileId = editorComponent.getState().fileId;
    if (existingFileId) {
      const file = this.vfs.findFileById(existingFileId);
      if (file) return;
    }

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
   * @param {string} fileId - The file ID of the tab to close. If not provided,
   * the active tab will be closed.
   */
  closeFile(fileId) {
    const editorComponent = fileId
      ? this.layout.getTabComponents().find((editorComponent) => editorComponent.getState().fileId === fileId)
      : this.layout.getActiveEditor();

    if (editorComponent) {
      editorComponent.close();
    }
  }

  /**
   * Close all tabs in the editor.
   */
  closeAllFiles() {
    this.layout.getTabComponents().forEach((editorComponent) => {
      editorComponent.close();
    });
  }

  /**
   * Retrieve the file object of the active editor.
   *
   * @returns {object} The file object.
   */
  getActiveEditorFileObject() {
    const editorComponent = this.layout.getActiveEditor();
    const { fileId } = editorComponent.getState();
    return Terra.app.vfs.findFileById(fileId);
  }
}
