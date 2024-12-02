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
  devProxyUrl = 'http://localhost:8888';

  /**
   * Whether there are new commits that need to be pushed.
   * @type {boolean}
   */
  hasNewCommits = false;

  /**
   * List of folders that should be ignored when traversing the repo contents.
   * @type {array}
   */
  blacklisted_folders = ['.', '..', '.git'];

  constructor(options) {
    this.isDev = options.isDev;
    this.pushedCallback = options.pushedCallback;
    this.cloneFailCallback = options.cloneFailCallback;
    this.cloneSuccessCallback = options.cloneSuccessCallback;

    this.setRepoLink(options.repoLink);
    this._alterXHR(options.username, options.accessToken);
    this._init().then((repoFiles) => {
      options.readyCallback(repoFiles);
    }).catch(() => {
      console.info('Failed to initialize git worker');
    });
  }

  _log() {
    console.log('[git]', ...arguments);
  }

  setRepoLink(repoLink) {
    this.repoLink = this.isDev
      ? repoLink.replace(new URL(repoLink).origin, this.devProxyUrl)
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
      this.push();
    }, 30 * 1000);

    // Clone the repo as soon as the worker is ready.
    this.clone();

    return this._getNestedDirContents('.');
  }

  /**
   * Get the nested files of a directory and all its subdirectories.
   *
   * @param {string} dirPath - The path to the directory to list contents for.
   * @returns {array} All nested file objects.
   */
  _getNestedDirContents(dirPath) {
    const files = [];

    this.fs.readdir(dirPath).forEach((filename) => {
      const filepath = `${dirPath}/${filename}`.replace('./', '');
      const stat = this.fs.stat(filepath);
      if (this.fs.isDir(stat.mode) && !this.blacklisted_folders.includes(filename)) {
        files.push(...this._getNestedDirContents(filepath));
      } else if (this.fs.isFile(stat.mode)) {
        files.push({
          name: filepath,
          content: this.fs.readFile(filepath, { encoding: 'utf8' }),
          createdAt: new Date(stat.ctime).toISOString(),
          updatedAt: new Date(stat.mtime).toISOString(),
        });
      }
    });

    return files;
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
   * Create all the directories in a given filepath.
   *
   * @example _makeDirs('path/to/dir')
   *
   * @param {string} filepath - The filepath to create directories for.
   */
  _makeDirs(filepath) {
    const dirs = filepath.split('/');

    let path = ['.'];
    dirs.forEach((dirname) => {
      path.push(dirname);
      const path_str = path.join('/');
      try {
        this.fs.lookupPath(path_str)
      } catch {
        this.fs.mkdir(path_str);
      }
    });
  }

  /**
   * Check whether a given filepath exists in the filesystem and is a file.
   *
   * @param {string} filepath - The filepath to check.
   * @returns {boolean} True if the given filepath exists, false otherwise.
   */
  _isFile(filepath) {
    try {
      const stat = this.fs.stat(filepath);
      return this._pathExists(filepath) && this.fs.isFile(stat.mode);
    } catch {
      return false;
    }
  }

  /**
   * Check whether a given folderpath exists in the filesystem and is a directory.
   *
   * @param {string} folderpath - The folderpath to check.
   * @returns {boolean} True if the given folderpath exists, false otherwise.
   */
  _isDir(folderpath) {
    try {
      const stat = this.fs.stat(folderpath);
      return this._pathExists(folderpath) && this.fs.isDir(stat.mode);
    } catch {
      return false;
    }
  }

  /**
   * Check whether a given path exists in the filesystem.
   *
   * @param {string} path - The path to check.
   * @returns {boolean} True if the given path exists, false otherwise.
   */
  _pathExists(path) {
    try {
      this.fs.lookupPath(path);
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
    try {
      const exitcode = this.lg.callMain(['clone', this.repoLink, this.repoDir]);
      if (exitcode !== 0) {
        this._log('Failed to clone repository');
        this.cloneFailCallback();
      } else {
        this.fs.chdir(this.repoDir);
        this.cloneSuccessCallback();
      }
    } catch (err) {
      console.error('Failed to clone repository:', err);
      this.cloneFailCallback();
    }
  }

  /**
   * Commit a file to the repository by writing its contents to a file, adding
   * it to the staging area and committing it.
   * @param {string} filepath - The absolute filepath to commit.
   * @param {string} filecontents - The contents of the file to commit.
   */
  commit(filepath, filecontents) {
    this._log('comitting', filepath);

    if (filepath.includes('/')) {
      const parentDirs = filepath.split('/').slice(0, -1).join('/');
      this._makeDirs(parentDirs);
    }

    const commitPrefix = !this._isFile(filepath) ? 'Add' : 'Update';
    this.fs.writeFile(filepath, filecontents);
    this.lg.callMain(['add', filepath]);
    this.lg.callMain(['commit', '-m', `${commitPrefix} ${filepath}`]);
    this.hasNewCommits = true;
  }

  /**
   * Trigger a push to the remote repository.
   */
  push() {
    if (this.hasNewCommits) {
      this.lg.callMain(['push'])
      this.hasNewCommits = false;
      this.pushedCallback();
    }
  }

  /**
   * Remove a filepath from the current repository.
   *
   * @param {string} filepath - The absolute filepath to remove.
   */
  rm(filepath) {
    this._log(`remove ${filepath}`);

    if (this._isFile(filepath)) {
      // File
      this.fs.unlink(filepath);
    } else {
      // Folder
      this.fs.rmdir(filepath);
    }

    this.lg.callMain(['add', filepath]);
    this.lg.callMain(['commit', '-m', `Remove ${filepath}`]);
    this.hasNewCommits = true;
  }

  /**
   * Move a file from one location to another.
   *
   * @param {string} oldPath - The absolute filepath of the file to move.
   * @param {string} newPath - The absolute filepath to the new file.
   */
  mv(oldPath, newPath) {
    if (!this._pathExists(oldPath)) return;

    this._log(`rename ${oldPath} to ${newPath}`);
    this.fs.rename(oldPath, newPath);
    this.lg.callMain(['add', oldPath, newPath])
    this.lg.callMain(['commit', '-m', `Rename ${oldPath} to ${newPath}`]);
    this.hasNewCommits = true;
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

        readyCallback(repoFiles) {
          postMessage({
            id: 'ready',
            data: { repoFiles }
          });
        },

        pushedCallback() {
          postMessage({ id: 'pushed' });
        },

        cloneFailCallback() {
          postMessage({ id: 'clone-fail' })
        },

        cloneSuccessCallback() {
          postMessage({ id: 'clone-success' })
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
      api.commit(payload.filepath, payload.filecontents);
      break;

    case 'push':
      api.push();
      break;

    case 'newFolder':
      api.newFolder(payload.folderPath);
      break;

    case 'rm':
      api.rm(payload.filepath);
      break;

    case 'mv':
      api.mv(payload.oldPath, payload.newPath);
      break;
  }
};
