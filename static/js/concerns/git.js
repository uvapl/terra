import { getRepoInfo } from '../lib/helpers.js';
import { getLocalStorageItem } from '../lib/local-storage-manager.js';
import { triggerPluginEvent } from '../plugin-manager.js';
import GitFS from '../fs/git.js';

/**
 * GitFS concern.
 *
 * Installs the GitHub filesystem (GitFS) connection behaviour onto an app
 * instance. The app must already have the storage coordinator installed (see
 * concerns/storage.js); GitFS registers itself as a storage backend so it gets
 * torn down when another backend becomes active.
 *
 * @param {App} app - The app instance to install GitFS on.
 */
export function useGit(app) {
  Object.assign(app, {
    /**
     * Called when starting the app to restore a previous Git connection, if
     * available.
     *
     * @returns {Promise<boolean>} True if not configured OR re-connected.
     */
    async initGitFSAtStart() {
      if (this.isGitConfigured()) {
        console.log('Git project detected upon init');
        return true;
      }

      // In fact, this function currently always returns true because making
      // the Git connection is deferred until later.
      return true;
    },

    /**
     * Initiate connection to GitFS.
     *
     * To be called from menu by user.
     */
    async openGitFS() {
      this.closeAllFiles();
      await this.activateStorageBackend('git');
      await this.startGitFS();
    },

    /**
     * Close connection to GitFS, reverting to browser temporary storage.
     *
     * To be called from menu by user.
     */
    async closeGitFS() {
      this.closeAllFiles();
      await this.stopGitFS();
      await this.finishSwitchToLocalStorage();
    },

    /**
     * Determines whether a Git repo is configured for use.
     *
     * @returns {boolean} True if configured and should be able to connect.
     */
    isGitConfigured() {
      return getLocalStorageItem('git-repo');
    },

    /**
     * Check whether the GitFS worker has been initialised.
     *
     * @returns {boolean} True if the worker has been initialised, false otherwise.
     */
    hasGitFSWorker() {
      return this.gitfs instanceof GitFS;
    },

    /**
     * Create a new GitFSWorker instance if it doesn't exist yet and only if the
     * the user provided an access token and repository link that are saved in local
     * storage. Otherwise, a worker will be created automatically when the user
     * adds a new repository.
     */
    async startGitFS() {
      await this.vfs.connect(null, 'ide-git');

      const accessToken = getLocalStorageItem('git-access-token');
      const repoLink = getLocalStorageItem('git-repo');
      const repoInfo = getRepoInfo(repoLink);
      if (repoInfo) {
        this.fileTree.setTitle(`${repoInfo.user}/${repoInfo.repo}`)
      }

      if (this.hasGitFSWorker()) {
        // Pass `false` to *NOT* clear the git-repo and git-branch local storage
        // items, because this if-statement only runs when the user is already
        // connected to a repo and changed the repo URL. Thus, we shouldn't clear
        // them; however, the clearing should only happen when terminate() is
        // called in other places to exclusively terminate the worker without
        // respawning another one.
        this.gitfs.terminate(false);

        this.gitfs = null;
        this.closeAllFiles();
      }

      if (accessToken && repoLink) {
        this.layout.getEditorComponents().forEach((editorComponent) => editorComponent.lock());

        const gitfs = new GitFS(this.vfs, repoLink);
        this.gitfs = gitfs;
        gitfs._createWorker(accessToken);

        console.log('Creating gitfs worker');
        // showMessage tears down the tree, so no separate destroy is needed.
        this.fileTree.showMessage('Cloning repository...');
        triggerPluginEvent('onStorageChange', 'git');
      }
    },

    /**
     * Disconnect GitFS, removing file cache.
     */
    async stopGitFS() {
      if (this.gitfs) {
        this.gitfs.terminate();
        this.gitfs = null;
        await this.vfs.clear();
        await this.vfs.connect(null, 'ide');
      }
    },
  });

  // Register GitFS so the coordinator tears it down when another backend
  // becomes active.
  app.registerStorageBackend('git', () => app.stopGitFS());
}
