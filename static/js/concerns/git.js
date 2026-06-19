import { getRepoInfo } from '../lib/helpers.js';
import {
  getLocalStorageItem,
  setLocalStorageItem,
  removeLocalStorageItem,
} from '../lib/local-storage-manager.js';
import { triggerPluginEvent } from '../plugin-manager.js';
import { createModal, hideModal, showModal } from '../components/modal.js';
import { GITHUB_URL_PATTERN } from '../constants.js';
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

    /**
     * Render the repository's branches as a dropdown under the Git > Branch menu
     * item, and wire each one to switch + re-clone on click. Called by GitFS once
     * the worker reports the available branches.
     *
     * @param {Array<{name: string, current: boolean}>} branches
     */
    renderGitRepoBranches(branches) {
      $('#menu-item--branch').addClass('has-dropdown');
      $('#menu-item--branch ul').remove();

      const branchesHtml = branches.map((branch) => {
        const activeClass = branch.current ? ' class="active"' : '';
        return `<li${activeClass} data-val="${branch.name}">${branch.name}</li>`;
      }).join('');

      $('#menu-item--branch').append(`<ul id="git-branches">${branchesHtml}</ul>`);
      $('#menu-item--branch').removeClass('disabled');

      $('#git-branches').find('li').click((event) => {
        const $element = $(event.target);
        if ($element.hasClass('active')) return;

        const newBranch = $element.data('val');
        setLocalStorageItem('git-branch', newBranch);
        $element.addClass('active').siblings().removeClass('active');

        this.gitfs.setRepoBranch(newBranch);

        this.fileTree.showMessage('Cloning repository...');
        this.gitfs.clone();

        this.closeAllFiles();
      });
    },

    /**
     * Prompt the user for a GitHub access token and repository URL, then connect
     * to the repository. Invoked by the "Connect GitHub Repository" menu item.
     */
    connectRepo() {
      const accessToken = getLocalStorageItem('git-access-token', '');

      // When the current repo link exists, the user was already connected and
      // they want to connect to another repository.
      const currentRepoLink = getLocalStorageItem('git-repo', '');

      const hasEmptyFields = !accessToken || !currentRepoLink;

      let connectRepoHistory = getLocalStorageItem('connect-repo-history', '')
        .split(',')
        .filter((url) => url.trim() !== '');
      const connectRepoHistoryHtml = connectRepoHistory.map((url) => `<option value="${url}"></option>`);

      const $connectModal = createModal({
        title: 'Connect GitHub repository',
        body: `
          <div class="form-wrapper-full-width">
            <label>Personal access token:</label>
            <input type="password" class="text-input full-width-input git-access-token" value="${accessToken}" placeholder="Fill in your personal access token" />
          </div>

          <p class="text-small">
            GitHub access tokens can be created <a href="https://github.com/settings/tokens">here</a>.
            Make sure to at least check the <em>repo</em> scope such that all its subscopes are checked.
            <br\>
            <br\>
            In order to clone private repositories or push and pull contents from any repository, your GitHub personal access token is required.
            Credentials will be stored locally in your browser and will not be shared with anyone.
          </p>

          <div class="form-wrapper-full-width">
            <label>Repository HTTPS URL</label>
            <input class="text-input full-width-input repo-link" list="connect-repo-hist" value="${currentRepoLink}" placeholder="https://github.com/{owner}/{repo}"></textarea>
            <datalist id="connect-repo-hist">
              ${connectRepoHistoryHtml}
            </datalist>
          </div>
        `,
        footer: `
          <button type="button" class="button cancel-btn">Cancel</button>
          <button type="button" class="button primary-btn connect-btn" ${hasEmptyFields ? 'disabled' : ''}>Connect</button>
        `,
        attrs: {
          id: 'ide-connect-repo-modal',
          class: 'modal-width-small',
        }
      });

      showModal($connectModal).then(() => {
        $('#ide-connect-repo-modal .repo-link').focus();
      });

      // Disable the connect button when any of the text fields are empty.
      // The 'input' event listener is needed if a user clicks on a datalist item.
      $connectModal.find('.text-input').on('keyup input', () => {
        const hasEmptyFields = $connectModal.find('.text-input').toArray().some(input => !$(input).val().trim());
        const $connectBtn = $connectModal.find('.connect-btn');

        const newRepoLink = $connectModal.find('.repo-link').val().trim();
        if (hasEmptyFields || !GITHUB_URL_PATTERN.test(newRepoLink)) {
          $connectBtn.attr('disabled', 'disabled');
        } else {
          $connectBtn.removeAttr('disabled');
        }
      });

      $connectModal.find('.cancel-btn').click(() => hideModal($connectModal));
      $connectModal.find('.connect-btn').click(() => {
        // For now, we only allow GitHub-HTTPS repo links.
        const newRepoLink = $connectModal.find('.repo-link').val().trim();
        if (newRepoLink && !GITHUB_URL_PATTERN.test(newRepoLink)) {
          alert('Invalid GitHub repository');
          return;
        }

        const newAccessToken = $connectModal.find('.git-access-token').val();

        hideModal($connectModal);
        console.log('Connecting to repository:', newRepoLink);

        // Update connect repo history by prepending the new repo link.
        if (connectRepoHistory.includes(newRepoLink)) {
          connectRepoHistory.splice(connectRepoHistory.indexOf(newRepoLink), 1);
        }
        connectRepoHistory.unshift(newRepoLink);
        connectRepoHistory = connectRepoHistory.slice(0, 10); // Only last 10 entries.
        setLocalStorageItem('connect-repo-history', connectRepoHistory.join(','));

        // Remove previously selected branch such that the clone will use the
        // default branch for the new repo.
        removeLocalStorageItem('git-branch');

        setLocalStorageItem('git-access-token', newAccessToken);
        setLocalStorageItem('git-repo', newRepoLink);
        this.openGitFS();
      });
    },
  });

  // Register GitFS so the coordinator tears it down when another backend
  // becomes active.
  app.registerStorageBackend('git', () => app.stopGitFS());
}
