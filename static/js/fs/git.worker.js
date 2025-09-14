import { isImageExtension, arrayBufferToBase64 } from '../helpers/image.js';
import { Octokit } from '../vendor/octokit-core-6.1.3.min.js';
import TaskQueue from '../task-queue.js';

const GITHUB_REPO_URL_PATTERN = /^https:\/\/github.com\/([\w-]+)\/([\w-]+)(?:\.git)?/;

class API {
  /**
   * Reference to the octokit instance used to interact with the GitHub API.
   * @type {Octokit}
   */
  octokit = null;

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
   * The branch of the repository the user is working in.
   * @type {string}
   */
  repoBranch = null;

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

  /**
   * Queue for requests to process that are sent to the GitHub API.
   * @type {Queue}
   */
  queue = null;

  /**
   * Contains the mapping of filepaths to their SHA values.
   * @type {object<string, string>}
   */
  fileShaMap = {};

  constructor(options) {
    this.repoBranch = options.branch;
    this.accessToken = options.accessToken;
    this.fetchBranchesSuccessCallback = options.fetchBranchesSuccessCallback;
    this.moveFolderSuccessCallback = options.moveFolderSuccessCallback;
    this.cloneFailCallback = options.cloneFailCallback;
    this.cloneSuccessCallback = options.cloneSuccessCallback;
    this.onRateLimit = options.onRateLimit;
    this.onRequestError = options.onRequestError;
    this.onRequestSuccess = options.onRequestSuccess;

    this.queue = new TaskQueue('Git');
    this.queue.addEventListener('busy', () => options.onQueueBusy())
    this.queue.addEventListener('done', () => options.onQueueDone());

    this.setRepoLink(options.repoLink);

    this._init()
      .then(() => {
        options.readyCallback();
      }).catch((err) => {
        console.info('Failed to initialise git worker');
        console.error(err);
      });
  }

  _log() {
    console.log('[Git]', ...arguments);
  }

  _info() {
    console.info('[Git]', ...arguments);
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

  setRepoBranch(branch) {
    this.repoBranch = branch;
  }

  /**
   * Initialises octokit and clone the repository immediately.
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

    if (await this.repoExists()) {
      await this.fetchUserInfo();
      await this.fetchBranches();
      await this.clone(true);
    }
  }

  async fetchUserInfo() {
    const userInfo = await this._request('GET', '/user');

    if (userInfo.data.name) {
      this.committer.name = userInfo.data.name;
    } else {
      this._info(`User has no name set in their GitHub, using default: ${this.committer.name}`);
    }

    if (userInfo.data.email) {
      this.committer.email = userInfo.data.email;
    } else {
      this._info(`User has no email set in their GitHub, using default: ${this.committer.email}`);
    }

    this._info(`Committing as: ${this.committer.name} <${this.committer.email}>`);
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
      const shouldOmitRepoParams = url.startsWith('/user');
      const requestOptions = {
        ...options,
        headers: {
          ...options.headers,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',

          // This header disables GitHub cache.
          // See https://octokit.github.io/routes/cache/api.github.com/v3/index.html#conditional-requests
          'If-None-Match': ''
        },
      }

      if (!shouldOmitRepoParams) {
        requestOptions.owner = this.repoOwner;
        requestOptions.repo = this.repoName;
      }

      delete requestOptions.ignoreRequestError;

      const res = await this.octokit.request(`${method} ${url}`, requestOptions);
      this.onRequestSuccess();
      return res;
    } catch (err) {
      if (!options.ignoreRequestError) {
        this._error('Failed to send GitHub request >>>>', err);
        this.onRequestError(err);
      }
      throw err;
    }
  }

  /**
   * Check whether the repository exists.
   *
   * @async
   * @returns {Promise<bool>} True if repository exists, false otherwise.
   */
  async repoExists() {
    try {
      await this._request('GET', '/repos/{owner}/{repo}');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fetch the branches of the repository.
   *
   * @async
   */
  async fetchBranches() {
    // Obtain the main branch.
    const repoInfo = await this._request('GET', '/repos/{owner}/{repo}');
    this.defaultBranch = repoInfo.data.default_branch;
    if (!this.repoBranch) {
      this.repoBranch = this.defaultBranch;
    }

    // Get other branches.
    const branchInfo = await this._request('GET', '/repos/{owner}/{repo}/branches');
    const branches = branchInfo.data
      .map(branch => ({
        name: branch.name,
        current: branch.name === this.repoBranch,
        default: branch.name === this.defaultBranch,
      }))
      .sort((a, b) => (
        // Put the default branch on top.
        b.default ? 1 : 0
      ));

    // When the repo is new with no contents, the /repos/{owner}/{repo}/branches
    // endpoint will not return anything, so have we to add the default branch
    // still, since this always exist.
    if (branches.length === 0) {
      branches.push({
        name: this.defaultBranch,
        current: true,
        default: true,
      });
    }

    this.fetchBranchesSuccessCallback(branches);
  }

  /**
   * Clone a repository and return the file contents tree
   * in the clone-success callback.
   * @async
   */
  async clone(init = false) {
    if (!init && !(await this.repoExists())) {
      return this.cloneFailCallback();
    }

    let tree = [];
    let repoContents = null;

    try {
      // Request a recursive tree of the main branch.
      repoContents = await this._request('GET', '/repos/{owner}/{repo}/git/trees/{branch}', {
        branch: this.repoBranch,
        recursive: true,
        ignoreRequestError: true,
      });
    } catch {
      // If this request fails, then the repo is empty, which is fine.
      this._log('Repository is most likely empty.')
    }

    if (repoContents) {
      tree = await Promise.all(
        repoContents.data.tree.map(async (fileOrFolder) => {
          if (fileOrFolder.type === 'blob') {
            try {
              if (isImageExtension(fileOrFolder.path)) {
                // Octokit returns images as base64, but we want to have them as
                // an ArrayBuffer, thus we fetch them directly from the raw URL.
                const rawUrl = `https://raw.githubusercontent.com/${this.repoOwner}/${this.repoName}/${this.repoBranch}/${fileOrFolder.path}`;
                const resp = await fetch(rawUrl);
                fileOrFolder.content = await resp.arrayBuffer();
              } else {
                const res = await this._request('GET', '/repos/{owner}/{repo}/contents/{path}', {
                  branch: this.repoBranch,
                  path: fileOrFolder.path,
                });

                fileOrFolder.content = atob(res.data.content);
              }

              this.fileShaMap[fileOrFolder.path] = fileOrFolder.sha;
            } catch {
              this._log('Possibly empty file:', fileOrFolder.path)
            }
          }
          return fileOrFolder;
        })
      );
    }

    this.cloneSuccessCallback(tree);
  }

  /**
   * Commit a file to the repository by writing its contents to a file, adding
   * it to the staging area and committing it.
   * @param {string} filepath - The absolute filepath to commit.
   * @param {string|ArrayBuffer} filecontents - The contents of the file to commit.
   * @param {string} sha - The sha of the file to commit.
   * @async
   */
  async commit(filepath, filecontents) {
    this._log('Committing', filepath);
    const sha = this.fileShaMap[filepath];

    const content = filecontents instanceof ArrayBuffer
      ? arrayBufferToBase64(filecontents)
      : btoa(filecontents);

    const response = await this._request('PUT', '/repos/{owner}/{repo}/contents/{path}', {
      path: filepath,
      message: `Update ${filepath}`,
      committer: this.committer,
      content,
      branch: this.repoBranch,
      sha,
    });

    this.fileShaMap[filepath] = response.data.content.sha;
  }

  /**
   * Remove a filepath from the current repository.
   *
   * @param {string} filepath - The absolute filepath to remove.
   */
  async rm(filepath) {
    try {
      await this._request('DELETE', '/repos/{owner}/{repo}/contents/{path}', {
        path: filepath,
        sha: this.fileShaMap[filepath],
        message: `Remove ${filepath}`,
        branch: this.repoBranch,
        committer: this.committer,
      });
      delete this.fileShaMap[filepath];
      this._log(`Removed ${filepath}`);
    } catch (err) {
      this._log('Failed to remove', filepath, err);
    }
  }

  /**
   * Move a file from one location to another.
   *
   * @param {string} oldPath - The absolute filepath of the file to move.
   * @param {string} newPath - The absolute filepath to the new file.
   * @param {string|ArrayBuffer} newContent - The new content of the file.
   */
  async moveFile(oldPath, newPath, newContent) {
    // Create the new file with the new content.
    const result = await this._request('PUT', '/repos/{owner}/{repo}/contents/{path}', {
      path: newPath,
      message: `Rename ${oldPath} to ${newPath}`,
      branch: this.repoBranch,
      committer: this.committer,
      content: newContent instanceof ArrayBuffer
        ? arrayBufferToBase64(newContent)
        : btoa(newContent),
    });

    // Delete the old file.
    await this._request('DELETE', '/repos/{owner}/{repo}/contents/{path}', {
      path: oldPath,
      message: `Remove ${oldPath}`,
      branch: this.repoBranch,
      committer: this.committer,
      sha: this.fileShaMap[oldPath],
    });

    this.fileShaMap[newPath] = result.data.content.sha;

    this._log(`Moved file from ${oldPath} to ${newPath}`);
  }

  /**
   * Move a file from one location to another.
   *
   * @param {array} files - Array of file objects to move.
   * @param {string} files[].srcPath - The filepath of the file to move.
   * @param {string} files[].destPath - The filepath to the new file.
   */
  async moveFolder(files) {
    for (const file of files) {
      // Get the source file content.
      console.log('file', file);
      const contentResponse = await this._request('GET', '/repos/{owner}/{repo}/contents/{path}', {
        branch: this.repoBranch,
        path: file.srcPath,
      });

      const content = atob(contentResponse.data.content);

      // Create the new file.
      const newFileResponse = await this._request('PUT', '/repos/{owner}/{repo}/contents/{path}', {
        path: file.destPath,
        message: `Rename ${file.srcPath} to ${file.destPath}`,
        branch: this.repoBranch,
        committer: this.committer,
        content,
      });

      // Delete the old files.
      await this._request('DELETE', '/repos/{owner}/{repo}/contents/{path}', {
        path: file.srcPath,
        message: `Remove ${file.srcPath}`,
        branch: this.repoBranch,
        committer: this.committer,
        sha: this.fileShaMap[file.srcPath],
      });

      // Update the file's sha.
      this.fileShaMap[file.destPath] = newFileResponse.data.content.sha;

      this._log(`Moved file from ${file.srcPath} to ${file.destPath}`);
    }

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

        onRequestSuccess() {
          postMessage({ id: 'request-success' })
        },

        onRequestError(error) {
          postMessage({
            id: 'request-error',
            data: { error },
          })
        },

        fetchBranchesSuccessCallback(branches) {
          postMessage({
            id: 'fetch-branches-success',
            data: { branches }
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

        onQueueBusy() {
          postMessage({ id: 'queue-busy' });
        },

        onQueueDone() {
          postMessage({ id: 'queue-done' });
        },

      });
      break;

    case 'setRepoBranch':
      api.setRepoBranch(payload.branch);
      break;

    case 'setRepoLink':
      api.setRepoLink(payload.repoLink);
      break;

    case 'clone':
      api.clone();
      break;

    case 'commit':
      api.queue.schedule(() => api.commit(
        payload.filepath,
        payload.filecontents,
      ));
      break;

    case 'rm':
      api.queue.schedule(() => api.rm(payload.filepath, payload.sha));
      break;

    case 'moveFile':
      api.queue.schedule(() => api.moveFile(
        payload.oldPath,
        payload.newPath,
        payload.newContent
      ));
      break;

    case 'moveFolder':
      api.queue.schedule(() => api.moveFolder(payload.files));
      break;
  }
};
