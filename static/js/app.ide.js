import App from './app.js';
import IDELayout from './layout/layout.ide.js';
import { LFS_MAX_FILE_SIZE } from './constants.js';
import {
  getFileExtension,
  hasGitFSWorker,
  hasLFSApi,
} from './helpers/shared.js';
import VFS from './vfs.js';
import Terra from './terra.js';
import { hasWorker } from './lang-worker-api.js';
import localStorageManager from './local-storage-manager.js';
import fileTreeManager from './file-tree-manager.js';
import LFS from './lfs.js';
import pluginManager from './plugin-manager.js';

export default class IDEApp extends App {
  setupLayout() {
    this.layout = this.createLayout();
  }

  postSetupLayout() {
    // Fetch the repo files or the local storage files (vfs) otherwise.
    const repoLink = localStorageManager.getLocalStorageItem('git-repo');
    if (repoLink) {
      VFS.createGitFSWorker();
    } else {
      LFS.init();
      fileTreeManager.createFileTree();
    }

    if (!hasLFSApi()) {
      // Disable open-folder if the FileSystemAPI is not supported.
      $('#menu-item--open-folder').remove();
    }

    if (!repoLink && !hasLFSApi()) {
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
        if (hasWorker(proglang) && Terra.langWorkerApi) {
          Terra.langWorkerApi.restart();
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
    const file = VFS.findFileById(editorComponent.getState().fileId);
    if (!file) return;

    if (hasLFSApi() && LFS.loaded && typeof file.size === 'number' && file.size > LFS_MAX_FILE_SIZE) {
      editorComponent.exceededFileSize();
    } else if (hasLFSApi() && LFS.loaded && !hasGitFSWorker() && !file.content) {
      // Load the file content from LFS.
      const cursorPos = editorComponent.getCursorPosition();
      LFS.getFileContent(file.id).then((content) => {
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
   * @param {string} FileId - The ID of the file to get the arguments for.
   * @returns {array} The arguments for the current file.
   */
  getCurrentFileArgs(fileId) {
    const filepath = VFS.getAbsoluteFilePath(fileId);
    const fileArgsPlugin = pluginManager.getPlugin('file-args').getState('fileargs');
    const fileArgs = fileArgsPlugin[filepath];

    const parseArgsRegex = /("[^"]*"|'[^']*'|\S+)/g;
    return fileArgs !== undefined ? fileArgs.match(parseArgsRegex) : [];
  }
}
