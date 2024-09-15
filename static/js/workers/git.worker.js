class API {
  /**
   * Contains a reference to the libgit2 filesystem.
   * @type {FS}
   */
  fs = null;

  /**
   * Contains a reference to the libgit2 module.
   * @type {Module}
   */
  lg = null;

  /**
   * The name of the directory where to clone the repo in.
   * @type {string}
   */
  repoDir = 'project';

  /**
   * Whether to app is running development mode.
   * @type {boolean}
   */
  isDev = false;

  /**
   * The absolute link to the repository.
   * @type {string}
   */
  repoLink = null;

  /**
   * Defines the URL to the proxy server used for local development.
   * @type {string}
   */
  proxyUrl = 'http://localhost:5000';

  /**
   * Whether there are new commits that need to be pushed.
   * @type {boolean}
   */
  hasNewCommits = false;

  constructor(options) {
    this.isDev = options.isDev;

    this.setRepoLink(options.repoLink);
    this._alterXHR(options.username, options.accessToken);
    this._init().then(() => {
      options.readyCallback();
    });
  }

  setRepoLink(repoLink) {
    this.repoLink = this.isDev
      ? repoLink.replace(new URL(repoLink).origin, this.proxyUrl)
      : repoLink;
  }

  /**
   * Initializes the libgit2 module and filesystem.
   *
   * @async
   */
  async _init() {
    const lg2mod = await import(new URL('../vendor/lg2.js', import.meta.url));
    this.lg = await lg2mod.default();
    this.fs = this.lg.FS;
    this.fs.writeFile('/home/web_user/.gitconfig',
      [
        '[user]',
        'email = noreply@proglab.nl',
        'name = UvA Programming Lab',
      ].join('\n')
    );

    // Setup a timer that triggers a push once per minute.
    this.pushIntervalId = setInterval(() => {
      if (this.hasNewCommits) {
        this.push();
        this.hasNewCommits = false;
      }
    }, minutes(1));
  }

  /**
   * Modifies the XMLHttpRequest object to include the user's GitHub credentials
   * essential for cloning/pushing repositories.
   *
   * @param {string} username - The username of the user's account.
   * @param {string} accessToken - The user's personal access token.
   */
  _alterXHR(username, accessToken) {
    XMLHttpRequest.prototype._open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
      this._open(method, url, async, user, password);
      const base64string = btoa(`${username}:${accessToken}`);
      this.setRequestHeader('Authorization', `Basic ${base64string}`);
    }
  }

  /**
   * Check whether a given filepath exists in the filesystem.
   *
   * @param {string} filepath - The filepath to check.
   * @returns {booleab} True if the given filepath exists, false otherwise.
   */
  fileExists(filepath) {
    try {
      this.fs.readFile(filepath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clone a repository to the local wasm-git filesystem and `cd` into the
   * cloned directory.
   */
  clone() {
    this.lg.callMain(['clone', this.repoLink, this.repoDir]);
    this.fs.chdir(this.repoDir);
  }

  /**
   * Commit a file to the repository by writing its contents to a file, adding
   * it to the staging area and committing it.
   * @param {string} filename - The name of the file to commit.
   * @param {string} filecontents - The contents of the file to commit.
   */
  commit(filename, filecontents) {
    const commitPrefix = !this.fileExists(filename) ? 'Add' : 'Update';
    this.fs.writeFile(filename, filecontents);
    this.lg.callMain(['add', filename]);
    this.lg.callMain(['commit', '-m', `${commitPrefix} ${filename}`]);
    this.hasNewCommits = true;
  }

  /**
   * Trigger a push to the remote repository.
   */
  push() {
    this.lg.callMain(['push'])
  }
}

// =============================================================================
// Worker message handling.
// =============================================================================

let api;

self.onmessage = (event) => {
  const payload = event.data.data;

  switch (event.data.id) {
    case 'constructor':
      api = new API({
        ...payload,

        readyCallback() {
          postMessage({ id: 'ready' });
        },
      });
      break;

    case 'setRepoLink':
      api.setRepoLink(payload.repoLink);
      break;

    case 'clone':
      api.clone();
      break;

    case 'commit':
      api.commit(payload.filename, payload.filecontents);
      break;

    case 'push':
      api.push();
      break;
  }
};
