import { triggerPluginEvent } from '../../lib/plugin-manager.js';

/**
 * Storage-coordinator concern.
 *
 * Lets storage backends (GitFS, LFS) coordinate without referencing each other.
 * Each backend registers a teardown hook under a name; activating one backend
 * tears down every other registered backend first. This keeps the git and LFS
 * concerns independent — they only depend on this generic app API.
 *
 * @param {App} app - The app instance to install the coordinator on.
 */
export function useStorageCoordinator(app) {
  app._storageBackends = {};

  Object.assign(app, {
    /**
     * Register a storage backend's teardown so the coordinator can disconnect
     * it when another backend becomes active.
     *
     * @param {string} name - Unique backend name (e.g. 'git', 'lfs').
     * @param {function(): (void|Promise<void>)} teardown - Disconnects the backend.
     */
    registerStorageBackend(name, teardown) {
      this._storageBackends[name] = teardown;
    },

    /**
     * Tear down every backend other than `name` before it becomes active. The
     * teardowns are guarded no-ops when their backend is already inactive.
     *
     * @async
     * @param {string} name - The backend that is about to become active.
     */
    async activateStorageBackend(name) {
      for (const [key, teardown] of Object.entries(this._storageBackends)) {
        if (key !== name) await teardown();
      }
    },

    /**
     * Set-up user interface when disconnecting a backend, reverting to browser
     * temporary (local) storage. Also yields an event to plugins signaling the
     * FS change. Shared by the backends' close paths.
     */
    async finishSwitchToLocalStorage() {
      this.fileTree.clearMessage();
      await this.refreshFileTree(); // show empty file tree
      this.fileTree.showLocalStorageWarning();
      this.fileTree.setTitle('temporary storage');
      triggerPluginEvent('onStorageChange', 'local');
    },
  });
}
