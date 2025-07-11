import { createModal, hideModal, showModal } from './modal.js';
import Terra from './terra.js';
import localStorageManager from './local-storage-manager.js';
import fileTreeManager from './file-tree-manager.js';
import { seconds } from './helpers/shared.js';
import { GITHUB_URL_PATTERN } from './ide/constants.js';

/**
 * GitFS worker class that handles all Git operations.
 * This is the bridge class between the app and the git.worker.js.
 */
export default class GitFS {
  /**
   * Local reference to the VFS instance.
   * @type {VirtualFileSystem}
   */
  vfs = null;

  /**
   * The repository link that the user is connected to.
   * @type {string}
   */
  _repoLink = null;

  /**
   * Whether the worker has been initialised
   * @type {boolean}
   */
  isReady = false;

  /**
   * Current active worker instance.
   * @type {Worker}
   */
  worker = null;

  constructor(vfs, repoLink) {
    this.vfs = vfs;
    this._repoLink = repoLink;

    this.bindVFSEvents();
    this.bindPageReloadEvent();
  }

  bindPageReloadEvent = () => {
    $(window).on('beforeunload', (e) => {
      if (fileTreeManager.hasBottomMsg()) {
        const message = 'The app is currently syncing changes to GitHub. Are you sure you want to reload the page?';
        e.preventDefault();
        e.returnValue = message;
        return message;
      }
    });
  }

  bindVFSEvents = () => {
    this.vfs.addEventListener('fileCreated', this.vfsFileCreatedHandler);
    this.vfs.addEventListener('fileMoved', this.vfsFileMovedHandler);
    this.vfs.addEventListener('fileContentChanged', this.vfsFileContentChangedHandler);
    this.vfs.addEventListener('beforeFileDeleted', this.vfsBeforeFileDeletedHandler);

    this.vfs.addEventListener('folderMoved', this.vfsFolderMovedHandler);
  }

  vfsFileCreatedHandler = (event) => {
    const { file } = event.detail;
    this.commit(file.path, file.content, file.sha);
  }

  vfsFileMovedHandler = (event) => {
    const { file, oldPath } = event.detail;
    this.moveFile(oldPath, file.sha, file.path, file.content);
  }

  vfsFileContentChangedHandler = (event) => {
    const { file } = event.detail;

    // Only commit changes after 2 seconds of inactivity.
    Terra.app.registerTimeoutHandler(`git-commit-${file.id}`, seconds(2), () => {
      this.commit(file.path, file.content, file.sha);
    });
  }

  vfsBeforeFileDeletedHandler = (event) => {
    const  { file } = event.detail;
    this.rm(file.path, file.sha);
  }

  vfsFolderMovedHandler = (event) => {
    const { folder, oldPath } = event.detail;
    const filesToMove = this.getOldNewFilePathsRecursively(folder.id, oldPath);
    this.moveFolder(filesToMove);
  }

  /**
   * Get all file paths recursively from a folder. Invoked when a folder is
   * being renamed or moved and updated in the UI when connected to Git.
   *
   * @param {string} folderId - The folder id to get the file paths from.
   * @returns {array} List of objects with the old and new file paths.
   */
  getOldNewFilePathsRecursively = (folderId, oldPath) => {
    const files = this.vfs.findFilesWhere({ parentId: folderId });
    const folders = this.vfs.findFoldersWhere({ parentId: folderId });

    let paths = files.map((file) => {
      const filename = file.path.split('/').pop();
      return {
        oldPath: `${oldPath}/${filename}`,
        newPath: file.path,
        content: file.content,
        sha: file.sha,
      }
    });

    for (const folder of folders) {
      paths = [
        ...paths,
        ...this.getOldNewFilePathsRecursively(folder.id, oldPath)
      ];
    }

    return paths;
  }

  /**
   * Creates a new worker process.
   *
   * @param {string} accessToken - The user's personal access token.
   */
  _createWorker = (accessToken) => {
    if (this.worker instanceof Worker) {
      console.error('[GitFS] failed to create a new worker as an instance is already running');
      return;
    };

    this.isReady = false;

    console.log('Spawning new git worker');

    this.worker = new Worker('static/js/workers/git.worker.js', { type: 'module' });
    this.worker.onmessage = this.onmessage.bind(this);

    this.worker.postMessage({
      id: 'constructor',
      data: {
        accessToken: accessToken,
        repoLink: this._repoLink,
        branch: localStorageManager.getLocalStorageItem('git-branch'),
      },
    });
  }

  /**
   * Terminate the current worker instance.
   *
  * @param {boolean} clear - Whether to clear related local storage items.
   */
  terminate = (clear = true) => {
    console.log('Terminating existing GitFS worker')

    if (clear) {
      localStorageManager.setLocalStorageItem('git-repo', '');
      localStorageManager.setLocalStorageItem('git-branch', '');
    }

    $('#menu-item--branch')
      .removeClass('has-dropdown').addClass('disabled')
      .find('ul').remove();
    this.worker.terminate();
  }

  /**
   * Set the current repository link that is cloned in the UI.
   */
  setRepoLink = () => {
    this.worker.postMessage({
      id: 'setRepoLink',
      data: {
        repoLink: this._repoLink,
      },
    });
  }

  setRepoBranch = (branch) => {
    this.worker.postMessage({
      id: 'setRepoBranch',
      data: { branch },
    });
  }

  /**
   * Clone the current repository.
   */
  clone = () => {
    this.worker.postMessage({ id: 'clone' });
  }

  /**
   * Commit the changes to the current repository.
   *
   * @param {string} filepath - The absolute filepath within the git repo.
   * @param {string} filecontents - The new contents to commit.
   * @param {string} sha - The sha of the file to commit.
   */
  commit = (filepath, filecontents, sha) => {
    this.worker.postMessage({
      id: 'commit',
      data: { filepath, filecontents, sha },
    });
  }

  /**
   * Remove a filepath from the current repository.
   *
   * @param {string} filepath - The absolute filepath within the git repo.
   * @param {string} sha - The sha of the file to delete.
   */
  rm = (filepath, sha) => {
    this.worker.postMessage({
      id: 'rm',
      data: { filepath, sha },
    });
  }

  /**
   * Move a file from one location to another.
   *
   * @param {string} oldPath - The absolute filepath of the file to move.
   * @param {string} oldSha - The sha of the file to remove.
   * @param {string} newPath - The absolute filepath to the new file.
   * @param {string} newContent - The new content of the file.
   */
  moveFile = (oldPath, oldSha, newPath, newContent) => {
    this.worker.postMessage({
      id: 'moveFile',
      data: { oldPath, oldSha, newPath, newContent },
    });
  }

  /**
   * Move a folder and its contents from one location to another.
   *
   * @param {array} files - Array of file objects to move.
   * @param {string} files[].oldPath - The filepath of the file to move.
   * @param {string} files[].sha - The sha of the file to remove.
   * @param {string} files[].newPath - The filepath to the new file.
   * @param {string} files[].content - The new content of the file.
   */
  moveFolder = (files) => {
    this.worker.postMessage({
      id: 'moveFolder',
      data: { files },
    });
  }

  /**
   * Message event handler for the worker.
   *
   * @param {object} event - Event object coming from the UI.
   */
  onmessage = (event) => {
    const payload = event.data.data;

    switch (event.data.id) {
      // Ready callback from the worker instance.
      case 'ready':
        this.isReady = true;
        break;

      // Triggered for primary and secondary rate limit.
      case 'rate-limit': {
        const retryAfter = Math.ceil(payload.retryAfter / 60);
        $('#file-tree').html('<div class="info-msg error">Exceeded GitHub API limit.</div>');

        const $modal = createModal({
          title: 'Exceeded GitHub API limit',
          body: `
            <p>
              You have exceeded your GitHub API limit.<br/>
              Please try again after ${retryAfter} minutes.
            </p>
          `,
          footer: `
            <button type="button" class="button primary-btn">Got it</button>
          `,
          footerClass: 'flex-end',
          attrs: {
            id: 'ide-git-exceeded-quota-modal',
            class: 'modal-width-small',
          }
        });

        showModal($modal);

        $modal.find('.primary-btn').click(() => hideModal($modal));
        break;
      }

      case 'fetch-branches-success':
        // Import the renderGitRepoBranches dynamically, because if we put this
        // at the top then the menubar.js will also be loaded for the Exam and
        // Embed application, which is something we do not want.
        import('./ide/menubar.js').then((module) => {
          const { renderGitRepoBranches } = module;
          renderGitRepoBranches(payload.branches);
        });
        break;

      case 'clone-success':
        $('#file-tree .info-msg').remove();
        fileTreeManager.removeLocalStorageWarning();

        this.importToVFS(payload.repoContents).then(() => {
          Terra.app.layout.getEditorComponents().forEach((editorComponent) => editorComponent.unlock());
          fileTreeManager.createFileTree();
        });
        break;

      case 'request-success':
        // If there was an error message, the file tree is gone, thus we have to
        // recreate the file tree.
        if (this.isReady && $('#file-tree .info-msg').length > 0) {
          $('#file-tree .info-msg').remove();
          fileTreeManager.createFileTree(true);
        }
        break;

      case 'request-error':
        let errMsg = payload.error.message;

        if (errMsg.toLowerCase().includes('bad credentials')) {
          errMsg = 'Personal access token was not accepted. Could it be expired?';
        } else if (errMsg.toLowerCase().includes('not found')) {
          const gitRepo = localStorageManager.getLocalStorageItem('git-repo');
          const match = GITHUB_URL_PATTERN.exec(gitRepo);
          if (match && match.length === 3) {
            errMsg = `Repository ${match[1]}/${match[2]} was not found on GitHub.`;
          } else {
            errMsg = 'Repository was not found on GitHub.';
          }
        }

        $('#file-tree').html(`<div class="info-msg error">Failed to clone repository<br/><br/>${errMsg}</div>`);
        break;

      case 'clone-fail':
        $('#file-tree').html('<div class="info-msg error">Failed to clone repository</div>');
        break;

      case 'move-folder-success':
        // Update all sha in the new files in the VFS.
        payload.updatedFiles.forEach((fileObj) => {
          const file = this.vfs.findFileByPath(fileObj.path);
          file.sha = fileObj.sha;
        });
        break;

      case 'move-file-success':
      case 'commit-success':
        // Update the file's sha in the VFS.
        const file = this.vfs.findFileByPath(payload.filepath);
        file.sha = payload.sha;
        break;

      case 'queue-busy':
        fileTreeManager.showBottomMsg('Syncing changes to GitHub...');
        break;

      case 'queue-done':
        fileTreeManager.removeBottomMsg();
        break;
    }
  }

  /**
   * Import files and folders from a git repository into the virtual filesystem.
   *
   * Each entry in the repoContents has a path property which contains the whole
   * relative path from the root of the repository.
   *
   * @param {array} repoContents - List of files from the repository.
   * @async
   */
  importToVFS = async (repoContents) => {
    // Preserve all currently open tabs after refreshing.
    // We first obtain the current filepaths before clearing the VFS.
    const tabs = {};
    Terra.app.layout.getTabComponents().forEach((tabComponent) => {
      const { fileId } = tabComponent.getState();
      if (fileId) {
        const { path } = this.vfs.findFileById(fileId);
        tabs[path] = tabComponent;
      }
    });

    // Remove all files from the virtual filesystem.
    this.vfs.clear();

    // First create all root files.
    repoContents
      .filter((file) => file.type === 'blob' && !file.path.includes('/'))
      .forEach(async (file) => {
        this.vfs.createFile({
          name: file.path.split('/').pop(),
          sha: file.sha,
          isNew: false,
          content: file.content,
        }, false);
      });

    // Then create all root folders and their nested files.
    repoContents
      .filter((fileOrFolder) => !(fileOrFolder.type === 'blob' && !fileOrFolder.path.includes('/')))
      .forEach((fileOrFolder) => {
        const { sha } = fileOrFolder;
        const path = fileOrFolder.path.split('/');
        const name = path.pop();

        const parentId = path.length > 0 ? this.vfs.findFolderByPath(path.join('/')).id : null;

        if (fileOrFolder.type === 'tree') {
          this.vfs.createFolder({ name, parentId, sha });
        } else if (fileOrFolder.type === 'blob') {
          this.vfs.createFile({
            name,
            parentId,
            sha,
            content: fileOrFolder.content,
          }, false);
        }
      });

    // Finally, we sync the current tabs with their new file IDs.
    for (const [filepath, tabComponent] of Object.entries(tabs)) {
      const file = this.vfs.findFileByPath(filepath);
      if (file) {
        tabComponent.extendState({ fileId: file.id });
        Terra.app.layout.emitToAllComponents('vfsChanged');
      }
    }

    this.vfs.saveState();
  }
}
