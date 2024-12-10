/**
 * GitFS worker class that handles all Git operations.
 * This is the bridge class between the app and the git.worker.js.
 */
class GitFS {
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

  constructor(repoLink) {
    this._repoLink = repoLink;
  }

  /**
   * Creates a new worker process.
   *
   * @param {string} accessToken - The user's personal access token.
   */
  _createWorker(accessToken) {
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
        isDev: isDev,
      },
    });
  }

  /**
   * Terminate the current worker instance.
   */
  terminate() {
    console.log('Terminating existing GitFS worker')
    setLocalStorageItem('connected-repo', '');
    $('#menu-item--push-changes').addClass('disabled');
    this.worker.terminate();
  }

  /**
   * Set the current repository link that is cloned in the UI.
   */
  setRepoLink() {
    this.worker.postMessage({
      id: 'setRepoLink',
      data: {
        repoLink: this._repoLink,
      },
    });
  }

  /**
   * Clone the current repository.
   */
  clone() {
    this.worker.postMessage({ id: 'clone' });
  }

  /**
   * Commit the changes to the current repository.
   *
   * @param {string} filepath - The absolute filepath within the git repo.
   * @param {string} filecontents - The new contents to commit.
   * @param {string} sha - The sha of the file to commit.
   */
  commit(filepath, filecontents, sha) {
    this.worker.postMessage({
      id: 'commit',
      data: { filepath, filecontents, sha },
    });
  }

  /**
   * Push any unpushed commits to the remote repository.
   */
  push() {
    this.worker.postMessage({ id: 'push' });
  }

  /**
   * Remove a filepath from the current repository.
   *
   * @param {string} filepath - The absolute filepath within the git repo.
   */
  rm(filepath) {
    this.worker.postMessage({
      id: 'rm',
      data: { filepath },
    });
  }

  /**
   * Move a file from one location to another.
   *
   * @param {string} oldPath - The absolute filepath of the file to move.
   * @param {string} newPath - The absolute filepath to the new file.
   */
  mv(oldPath, newPath) {
    this.worker.postMessage({
      id: 'mv',
      data: { oldPath, newPath },
    });
  }

  /**
   * Message event handler for the worker.
   *
   * @param {object} event - Event object coming from the UI.
   */
  onmessage(event) {
    const payload = event.data.data;

    switch (event.data.id) {
      // Ready callback from the worker instance.
      case 'ready':
        this.isReady = true;
        break;

    case 'clone-success':
      $('#file-tree .info-msg').remove();
      removeLocalStorageWarning();

      VFS.importFromGit(payload.repoContents);
      createFileTree();
      break;

      case 'clone-fail':
        $('#file-tree').html('<div class="info-msg error">Failed to clone repository</div>');V
        break;

      case 'commit-success':
        // Update the file's sha in the VFS.
        const file = VFS.findFileByPath(payload.filepath);
        file.sha = payload.sha;
        break;
    }
  }
}

/**
 * Create a new GitFSWorker instance if it doesn't exist yet and only if the the
 * user provided an ssh-key and repository link that are saved in local storage.
 * Otherwise, a worker will be created automatically when the user adds a new
 * repository.
 *
 * This is considered a private function invoked from VFS.createGitFSWorker.
 */
function _createGitFSWorker() {
  closeAllFiles();

  const accessToken = getLocalStorageItem('git-access-token');
  const repoLink = getLocalStorageItem('connected-repo');
  const repoInfo = getRepoInfo(repoLink);
  if (repoInfo) {
    setFileTreeTitle(`${repoInfo.user}/${repoInfo.repo}`)
  }

  if (hasGitFSWorker()) {
    window._gitFS.terminate();
    window._gitFS = null;
  }

  if (accessToken && repoLink) {
    const gitFS = new GitFS(repoLink);
    window._gitFS = gitFS;
    gitFS._createWorker(accessToken);

    const tree = getFileTreeInstance();
    if (tree) {
      $('#file-tree').fancytree('destroy');
      window._fileTree = null;
    }

    console.log('Creating gitfs worker');
    $('#file-tree').html('<div class="info-msg">Cloning repository...</div>');
  }
}
