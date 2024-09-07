/**
 * GitFS worker class that handles all Git operations using wasm-git.
 * @see https://github.com/petersalomonsen/wasm-git
 */
class GitFS {
  /**
   * The user's personal access token used for authentication.
   * @type {string}
   */
  _accessToken = null;

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

  constructor(accessToken, repoLink) {
    this._accessToken = accessToken;
    this._repoLink = repoLink;
  }

  /**
   * Creates a new worker process.
   */
  _createWorker() {
    if (this.worker instanceof Worker) {
      console.error('[GitFS] failed to create a new worker as an instance is already running');
      return;
    };

    this.isReady = false;

    console.log('Spawning new git worker');

    this.worker = new Worker('static/js/workers/git.worker.js');
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.onmessage = this.onmessage.bind(this);
    const remotePort = channel.port2;
    const constructorData = {
      port: remotePort,
      accessToken: this._accessToken,
      repoLink: this._repoLink,
    };

    this.worker.postMessage({
      id: 'constructor',
      data: constructorData,
    }, [remotePort]);
  }

  /**
   * Message event handler for the worker.
   *
   * @param {object} event - Event object coming from the UI.
   */
  onmessage(event) {
    switch (event.data.id) {
      // Ready callback from the worker instance. This will be run after
      // libgit2 has been initialised successfully.
      case 'ready':
        this.isReady = true;
        break;
    }
  }
}

/**
 * Create a new GitFSWorker instance if it doesn't exist yet and only if the the
 * user provided an ssh-key and repository link that are saved in local storage.
 * Otherwise, a worker will be created automatically when the user adds a new
 * repository.
 */
function createGitFSWorker() {
  const accessToken = getLocalStorageItem('git-access-token');
  const repoLink = getLocalStorageItem('connected-repo');
  if (!(window._gitFS instanceof GitFS) && accessToken && repoLink) {
    const gitFS = new GitFS(accessToken, repoLink);
    window._gitFS = gitFS;
    gitFS._createWorker();
  }
}
