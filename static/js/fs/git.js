import { createModal, hideModal, showModal } from '../modal.js';
import Terra from '../terra.js';
import localStorageManager from '../local-storage-manager.js';
import fileTreeManager from '../file-tree-manager.js';
import { isBase64, seconds, slugify, isImageExtension } from '../helpers/shared.js';
import { GITHUB_URL_PATTERN } from '../ide/constants.js';
import debounce from '../debouncer.js';

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
    this.vfs.addEventListener('fileDeleted', this.vfsBeforeFileDeletedHandler);
  }

  vfsFileCreatedHandler = (event) => {
    const { file } = event.detail;
    this.commit(file.path, file.content);
  }

  vfsFileMovedHandler = (event) => {
    const { file, oldPath } = event.detail;
    this.moveFile(oldPath, file.path, file.content);
  }

  vfsFileContentChangedHandler = (event) => {
    const { file } = event.detail;

    // Only commit changes after 2 seconds of inactivity.
    debounce(
      `commit-${slugify(file.path)}`,
      seconds(2),
      () => this.commit(file.path, file.content)
    );
  }

  vfsBeforeFileDeletedHandler = (event) => {
    const { file } = event.detail;
    this.rm(file.path);
  }

  vfsFolderMovedHandler = (event) => {
    const { filesMoved } = event.detail;
    this.moveFolder(filesMoved);
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

    this.worker = new Worker('static/js/fs/git.worker.js', {
      type: 'module',
    });
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
    this.isReady = false;
    this.worker.postMessage({ id: 'clone' });
  }

  /**
   * Commit the changes to the current repository.
   *
   * @param {string} filepath - The absolute filepath within the git repo.
   * @param {string} filecontents - The new contents to commit.
   */
  commit = (filepath, filecontents) => {
    this.worker.postMessage({
      id: 'commit',
      data: { filepath, filecontents },
    });
  }

  /**
   * Remove a filepath from the current repository.
   *
   * @param {string} filepath - The absolute filepath within the git repo.
   */
  rm = (filepath) => {
    this.worker.postMessage({
      id: 'rm',
      data: { filepath },
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
  moveFile = (oldPath, newPath, newContent) => {
    this.worker.postMessage({
      id: 'moveFile',
      data: { oldPath, newPath, newContent },
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
  onmessage = async (event) => {
    const payload = event.data.data;

    switch (event.data.id) {
      // Ready callback from the worker instance.
      case 'ready':
        this.isReady = true;
        $('#menu-item--close-project').removeClass('disabled');
        break;

      // Triggered for primary and secondary rate limit.
      case 'rate-limit': {
        const retryAfter = Math.ceil(payload.retryAfter / 60);
        fileTreeManager.setErrorMsg('Exceeded GitHub API limit.');

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
        import('../ide/menubar.js').then((module) => {
          const { renderGitRepoBranches } = module;
          renderGitRepoBranches(payload.branches);
        });
        break;

      case 'clone-success':
        fileTreeManager.removeInfoMsg();
        fileTreeManager.removeLocalStorageWarning();

        this.importToVFS(payload.repoContents).then(() => {
          Terra.app.layout.getEditorComponents().forEach((editorComponent) => editorComponent.unlock());
          fileTreeManager.createFileTree(true);
        });
        break;

      case 'request-success':
        // If there was an error message, the file tree is gone, thus we have to
        // recreate the file tree.
        if (this.isReady && fileTreeManager.hasInfoMsg()) {
          fileTreeManager.removeInfoMsg();
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


        fileTreeManager.setErrorMsg(`Failed to clone repository<br/><br/>${errMsg}`);
        break;

      case 'clone-fail':
        fileTreeManager.setErrorMsg('Failed to clone repository');
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
    // Remove all files from the VFS.
    await this.vfs.clear();

    const files = repoContents.filter((file) => file.type === 'blob');
    for (const file of files) {
      const content = isImageExtension(file.path)
        ? file.content
        : (isBase64(file.content) ? atob(file.content) : file.content);

      await this.vfs.createFile(file.path, content, false);
    }

    // Trigger a vfsChanged event, such that all editors reload their content.
    Terra.app.layout.emitToAllComponents('vfsChanged');
  }
}
