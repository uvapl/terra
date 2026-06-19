import { triggerPluginEvent } from '../plugin-manager.js';
import * as LFS from '../fs/lfs.js';

/**
 * Local filesystem (LFS) concern.
 *
 * Installs the local filesystem (File System Access API) connection behaviour
 * onto an app instance. The app must already have the storage coordinator
 * installed (see concerns/storage.js); LFS registers itself as a storage backend
 * so it gets torn down when another backend becomes active.
 *
 * @param {App} app - The app instance to install LFS on.
 */
export function useLFS(app) {
  Object.assign(app, {
    /**
     * Called when starting the app to restore a previous LFS connection, if
     * available.
     *
     * @returns {Promise<boolean>} True if not configured OR re-connected.
     */
    async initLFSAtStart() {
      // Re-open previous LFS project if available.
      if (LFS.hasProjectLoaded()) {
        const rootFolderHandle = await LFS.reopen();

        // Might not succeed if saved LFS handle is stale.
        if (rootFolderHandle) {
          console.log('LFS project detected upon init');
          await this.vfs.connect(rootFolderHandle);
          return true;
        } else {
          console.log('Tried to reopen LFS but handle was stale.');
          return false;
        }
      }
      return true;
    },

    /**
     * Open a directory picker dialog and connects VFS to the selected directory.
     *
     * To be called from menu by user.
     */
    async openLFSFolder() {
      if (!LFS.available()) return;

      let rootFolderHandle = await LFS.choose();
      if (!rootFolderHandle) return;

      this.closeAllFiles();

      // Make sure other storage backends are stopped before connecting LFS,
      // and their VFS cache is cleared.
      await this.activateStorageBackend('lfs');

      this.fileTree.clearLocalStorageWarning();
      // Set file-tree title to the root folder name.
      this.fileTree.setTitle(await LFS.getBaseFolderName());

      await this.vfs.connect(rootFolderHandle);

      triggerPluginEvent('onStorageChange', 'lfs');

      // Render the LFS contents.
      await this.refreshFileTree();

      this.fileTree.clearMessage();
      this.view.setProjectMenuState({ closeProjectEnabled: true });
    },

    /**
     * Close the current LFS folder and use the VFS again.
     * Gets called by the "Close Folder" menu item.
     */
    async closeLFSFolder() {
      this.closeAllFiles();
      await this.stopLFS();
      this.finishSwitchToLocalStorage();
    },

    /**
     * Disconnect the LFS from the current folder.
     * Gets called when LFS is closed, or when a Git repo is connected.
     */
    async stopLFS() {
      if (!LFS.hasProjectLoaded()) return;

      await this.vfs.connect(null, 'ide');
      LFS.close();
      this.view.setProjectMenuState({ closeProjectEnabled: false });
    },
  });

  // Register LFS so the coordinator tears it down when another backend
  // becomes active.
  app.registerStorageBackend('lfs', () => app.stopLFS());
}
