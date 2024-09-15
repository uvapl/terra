/**
 * GitFS worker class that handles all Git operations using wasm-git.
 * This is the bridge class between the app and the git.worker.js.
 * @see https://github.com/petersalomonsen/wasm-git
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
   * @param {string} username - The username of the user's account.
   * @param {string} accessToken - The user's personal access token.
   */
  _createWorker(username, accessToken) {
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
        username: username,
        accessToken: accessToken,
        repoLink: this._repoLink,
        isDev: isDev,
      },
    });
  }

  terminate() {
    console.log('Terminating existing GitFS worker')
    this.worker.terminate();
  }

  setRepoLink() {
    this.worker.postMessage({
      id: 'setRepoLink',
      data: {
        repoLink: this._repoLink,
      },
    });
  }

  clone() {
    this.worker.postMessage({ id: 'clone' });
  }

  commit() {
    const tab = getActiveEditor();
    this.worker.postMessage({
      id: 'commit',
      data: {
        filename: tab.config.title,
        filecontents: tab.container.getState().value,
      },
    });
  }

  push() {
    this.worker.postMessage({ id: 'push' });
  }

  /**
   * Message event handler for the worker.
   *
   * @param {object} event - Event object coming from the UI.
   */
  onmessage(event) {
    const payload = event.data.data;

    switch (event.data.id) {
      // Ready callback from the worker instance. This will be run after
      // libgit2 has been initialised successfully.
      case 'ready':
        this.isReady = true;

        const { repoFiles } = payload;

        // Remove all files from the virtual filesystem.
        VFS.clear();

        // Put repo files inside the virtual filesystem.
        for (const file of repoFiles) {
          VFS.createFile(file);
        }

        // Refresh the file tree.
        createFileTree();
        break;
    }
  }
}

/**
 * Check whether the GitFS worker has been initialised.
 *
 * @returns {boolean} True if the worker has been initialised, false otherwise.
 */
function hasGitFSWorker() {
  return window._gitFS instanceof GitFS;
}

/**
 * Create a new GitFSWorker instance if it doesn't exist yet and only if the the
 * user provided an ssh-key and repository link that are saved in local storage.
 * Otherwise, a worker will be created automatically when the user adds a new
 * repository.
 */
function createGitFSWorker() {
  const username = getLocalStorageItem('git-username');
  const accessToken = getLocalStorageItem('git-access-token');
  const repoLink = getLocalStorageItem('connected-repo');

  if (hasGitFSWorker()) {
    window._gitFS.terminate();
    window._gitFS = null;
  }

  if (username && accessToken && repoLink) {
    const gitFS = new GitFS(repoLink);
    window._gitFS = gitFS;
    gitFS._createWorker(username, accessToken);
    $('#file-tree').jstree('destroy').html('<div class="info-msg">Cloning repository...</div>');
  }
}
