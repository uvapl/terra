import { Octokit } from 'https://esm.sh/octokit';

const GITHUB_REPO_URL_PATTERN = /^https:\/\/github.com\/([\w-]+)\/([\w-]+)(?:\.git)?/;

class API {
  /**
   * Reference to the octokit instance used to interact with the GitHub API.
   * @type {Octokit}
   */
  octokit = null;

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
   * The username of the repository. This is the {owner} part in
   * https://github.com/{owner}/{repo}.
   * @type {string}
   */
  repoOwner = null;

  /**
   * The name of the repository. This is the {repo} part in
   * https://github.com/{owner}/{repo}.
   * @type {string}
   */
  repoName = null;

  /**
   * The personal access token from the user used to authenticate as them for API calls.
   * @type {[TODO:type]}
   */
  accessToken = null;

  /**
   * Defines the URL to the proxy server used for local development.
   * @type {string}
   */
  devProxyUrl = 'http://localhost:8888';

  /**
   * List of folders that should be ignored when traversing the repo contents.
   * @type {array}
   */
  blacklistedFolders = ['.', '..', '.git'];

  constructor(options) {
    this.isDev = options.isDev;
    this.accessToken = options.accessToken;
    this.commitSuccessCallback = options.commitSuccessCallback;
    this.cloneFailCallback = options.cloneFailCallback;
    this.cloneSuccessCallback = options.cloneSuccessCallback;

    this.setRepoLink(options.repoLink);

    this._init()
      .then(() => {
        options.readyCallback();
      }).catch(() => {
        console.info('Failed to initialize git worker');
      });
  }

  _log() {
    console.log('[git]', ...arguments);
  }

  // TODO: rename this to setRepo(owner, name)
  setRepoLink(repoLink) {
    if (!GITHUB_REPO_URL_PATTERN.test(repoLink)) return;
    const [_, repoOwner, repoName] = repoLink.match(GITHUB_REPO_URL_PATTERN);
    this.repoOwner = repoOwner;
    this.repoName = repoName;
  }

  /**
   * Initializes octokit and clone the repository immediately.
   *
   * @async
   */
  async _init() {
    this.octokit = new Octokit({ auth: this.accessToken });
    this.clone();
  }

  /**
   * Send a request through octokit to the GitHub API.
   *
   * @param {string} method - The request method.
   * @param {string} url - The relative endpoint URL.
   * @param {object} [options] - Data object to pass along with the request.
   * @returns {Promise<*>} Response object.
   */
  _request(method, url, options = {}) {
    return this.octokit.request(`${method} ${url}`, {
      ...options,
      headers: {
        ...options.headers,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
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
   * Clone a repository and return the file contents tree
   * in the clone-success callback.
   * @async
   */
  async clone() {
    try {
      // Obtain the main branch.
      const repoInfo = await this._request('GET', '/repos/{owner}/{repo}', {
        owner: this.repoOwner,
        repo: this.repoName,
      });

      // Request a recursive tree of the main branch.
      const repoContents = await this._request('GET', '/repos/{owner}/{repo}/git/trees/{branch}', {
        owner: this.repoOwner,
        repo: this.repoName,
        branch: repoInfo.data.default_branch,
        recursive: true,
      });

      const tree = await Promise.all(
        repoContents.data.tree.map(async (fileOrFolder) => {
          if (fileOrFolder.type === 'blob') {
            const res = await this._request('GET', '/repos/{owner}/{repo}/contents/{path}', {
              owner: this.repoOwner,
              repo: this.repoName,
              path: fileOrFolder.path,
            });

            const content = atob(res.data.content);
            if (content) {
              fileOrFolder.content = content;
            }
          }
          return fileOrFolder;
        })
      );

      this.cloneSuccessCallback(tree);
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
   * @param {string} sha - The sha of the file to commit.
   * @async
   */
  async commit(filepath, filecontents, sha) {
    this._log('comitting', filepath);

    const response = await this._request('PUT', '/repos/{owner}/{repo}/contents/{path}', {
      owner: this.repoOwner,
      repo: this.repoName,
      path: filepath,
      message: `Update ${filepath}`,
      committer: {
        name: 'UvA Programming Lab',
        email: 'terra@proglab.nl'
      },
      content: btoa(filecontents),
      sha,
    });

    this.commitSuccessCallback(filepath, response.data.content.sha);
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

        commitSuccessCallback(filepath, sha) {
          postMessage({
            id: 'commit-success',
            data: { filepath, sha }
          });
        },

        cloneFailCallback() {
          postMessage({ id: 'clone-fail' })
        },

        cloneSuccessCallback(repoContents) {
          postMessage({
            id: 'clone-success',
            data: { repoContents }
          })
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
      api.commit(payload.filepath, payload.filecontents, payload.sha);
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
