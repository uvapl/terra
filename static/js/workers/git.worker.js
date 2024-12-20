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
   * The default branch of the repository.
   * @type {string}
   */
  defaultBranch = null;

  /**
   * The personal access token from the user used to authenticate as them for API calls.
   * @type {string}
   */
  accessToken = null;

  /**
   * The information about the committer.
   * @type {object}
   */
  committer = {
    name: 'UvA Programming Lab',
    email: 'terra@proglab.nl'
  }

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
    this.moveFileSuccessCallback = options.moveFileSuccessCallback;
    this.moveFolderSuccessCallback = options.moveFolderSuccessCallback;
    this.cloneFailCallback = options.cloneFailCallback;
    this.cloneSuccessCallback = options.cloneSuccessCallback;
    this.onRateLimit = options.onRateLimit;

    this.setRepoLink(options.repoLink);

    this._init()
      .then(() => {
        options.readyCallback();
      }).catch(() => {
        console.info('Failed to initialize git worker');
      });
  }

  _log() {
    console.log('[Git]', ...arguments);
  }

  _error() {
    console.error('[Git]', ...arguments);
  }

  setRepoLink(repoLink) {
    if (!GITHUB_REPO_URL_PATTERN.test(repoLink)) return;

    const match = repoLink.match(GITHUB_REPO_URL_PATTERN);
    if (!match) return;

    this.repoOwner = match[1];
    this.repoName = match[2];
  }

  /**
   * Initializes octokit and clone the repository immediately.
   *
   * @async
   */
  async _init() {
    this.octokit = new Octokit({
      auth: this.accessToken,
      throttle: {
        // https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api?apiVersion=2022-11-28#exceeding-the-rate-limit
        onRateLimit: (retryAfter, options, octokit, retryCount) => {
          this.onRateLimit(retryAfter);
        },
        onSecondaryRateLimit: (retryAfter, options, octokit) => {
          this.onRateLimit(retryAfter);
        },
      }

    });
    this.clone();
  }

  /**
   * Send a request through octokit to the GitHub API. By default, the '{owner}'
   * and '{repo}' variables are available inside the `url`.
   *
   * @param {string} method - The request method.
   * @param {string} url - The relative endpoint URL.
   * @param {object} [options] - Data object to pass along with the request.
   * @returns {Promise<*>} Response object.
   */
  async _request(method, url, options = {}) {
    try {
      return await this.octokit.request(`${method} ${url}`, {
        owner: this.repoOwner,
        repo: this.repoName,
        ...options,
        headers: {
          ...options.headers,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        }
      });
    } catch (err) {
      this._error('GitHub API rate limit exceeded');
      this._error(err);
      throw err;
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
      const repoInfo = await this._request('GET', '/repos/{owner}/{repo}');
      this.defaultBranch = repoInfo.data.default_branch;

      // Request a recursive tree of the main branch.
      const repoContents = await this._request('GET', '/repos/{owner}/{repo}/git/trees/{branch}', {
        branch: this.defaultBranch,
        recursive: true,
      });

      const tree = await Promise.all(
        repoContents.data.tree.map(async (fileOrFolder) => {
          if (fileOrFolder.type === 'blob') {
            const res = await this._request('GET', '/repos/{owner}/{repo}/contents/{path}', {
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
      if (![403, 429].includes(err.status)) {
        this._log('Failed to clone repository:', err);
        this.cloneFailCallback();
      }
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
    this._log('Committing', filepath);

    const response = await this._request('PUT', '/repos/{owner}/{repo}/contents/{path}', {
      path: filepath,
      message: `Update ${filepath}`,
      committer: this.committer,
      content: btoa(filecontents),
      sha,
    });

    this.commitSuccessCallback(filepath, response.data.content.sha);
  }

  /**
   * Remove a filepath from the current repository.
   *
   * @param {string} filepath - The absolute filepath to remove.
   * @param {string} sha - The sha of the file to delete.
   */
  async rm(filepath, sha) {
    try {
      await this._request('DELETE', '/repos/{owner}/{repo}/contents/{path}', {
        path: filepath,
        sha,
        message: `Remove ${filepath}`,
        branch: this.defaultBranch,
        committer: this.committer,
      });
      this._log(`Removed ${filepath}`);
    } catch (err) {
      this._log('Failed to remove', filepath, err);
    }
  }

  /**
   * Move a file from one location to another.
   *
   * @param {string} oldPath - The absolute filepath of the file to move.
   * @param {string} oldSha - The sha of the file to remove.
   * @param {string} newPath - The absolute filepath to the new file.
   * @param {string} newContent - The new content of the file.
   */
  async moveFile(oldPath, oldSha, newPath, newContent) {
    // Create the new file with the new content.
    const result = await this._request('PUT', '/repos/{owner}/{repo}/contents/{path}', {
      path: newPath,
      message: `Rename ${oldPath} to ${newPath}`,
      branch: this.defaultBranch,
      committer: this.committer,
      content: btoa(newContent),
    });

    // Delete the old file.
    await this._request('DELETE', '/repos/{owner}/{repo}/contents/{path}', {
      path: oldPath,
      message: `Remove ${oldPath}`,
      branch: this.defaultBranch,
      committer: this.committer,
      sha: oldSha,
    });

    const newSha = result.data.content.sha;
    this.moveFileSuccessCallback(newPath, newSha);

    this._log(`Moved file from ${oldPath} to ${newPath}`);
  }

  /**
   * Move a file from one location to another.
   *
   * @param {array} files - Array of file objects to move.
   * @param {string} files[].oldPath - The filepath of the file to move.
   * @param {string} files[].sha - The sha of the file to remove.
   * @param {string} files[].newPath - The filepath to the new file.
   * @param {string} files[].content - The new content of the file.
   */
  async moveFolder(files) {
    // Keep track of a list of all new files with their new sha.
    const updatedFiles = [];

    await Promise.all(
      files.map(async (file) => {
        // Create the new file.
        const result = await this._request('PUT', '/repos/{owner}/{repo}/contents/{path}', {
          path: file.newPath,
          message: `Rename ${file.oldPath} to ${file.newPath}`,
          branch: this.defaultBranch,
          committer: this.committer,
          content: btoa(file.content),
        });

        // Delete the old files.
        await this._request('DELETE', '/repos/{owner}/{repo}/contents/{path}', {
          path: file.oldPath,
          message: `Remove ${file.oldPath}`,
          branch: this.defaultBranch,
          committer: this.committer,
          sha: file.sha,
        });

        updatedFiles.push({
          filepath: file.newPath,
          sha: result.data.content.sha,
        });

        this._log(`Moved file from ${file.oldPath} to ${file.newPath}`);
      })
    );

    this.moveFolderSuccessCallback(updatedFiles);
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

        onRateLimit(retryAfter) {
          postMessage({
            id: 'rate-limit',
            data: { retryAfter }
          });
        },

        commitSuccessCallback(filepath, sha) {
          postMessage({
            id: 'commit-success',
            data: { filepath, sha }
          });
        },

        moveFileSuccessCallback(filepath, sha) {
          postMessage({
            id: 'move-file-success',
            data: { filepath, sha },
          });
        },

        moveFolderSuccessCallback(updatedFiles) {
          postMessage({
            id: 'move-folder-success',
            data: { updatedFiles },
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
      api.rm(payload.filepath, payload.sha);
      break;

    case 'moveFile':
      api.moveFile(payload.oldPath, payload.oldSha, payload.newPath, payload.newContent);
      break;

    case 'moveFolder':
      api.moveFolder(payload.files);
      break;
  }
};
