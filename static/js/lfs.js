////////////////////////////////////////////////////////////////////////////////
// This file contains the local filesystem logic for the IDE app, using
// https://developer.mozilla.org/en-US/docs/Web/API/File_System_API
////////////////////////////////////////////////////////////////////////////////

class LocalFileSystem {
  IDB_VERSION = 1;
  IDB_NAME = 'terra';
  FILE_HANDLES_STORE_NAME = 'file-handles';
  FOLDER_HANDLES_STORE_NAME = 'folder-handles';

  /**
   * Whether the user loaded a project through the LFS.
   * @type {boolean}
   */
  loaded = false;

  /**
   * Whether an action is happening, such as moving a file/folder.
   * @type {boolean}
   */
  busy = false;

  constructor() {
    // Only initialize if the user is not connected to git.
    const gitRepoLink = getLocalStorageItem('connected-repo');
    if (!gitRepoLink) {
      this._init();
    }
  }

  async _init() {
    const lastTimeUsedLFS = getLocalStorageItem('use-lfs', false);
    if (!lastTimeUsedLFS) {
      showLocalStorageWarning();
    };

    const rootFolderHandle = await this.getFolderHandle('root');
    if (!rootFolderHandle) return;

    const hasPermission = await this._verifyPermission(rootFolderHandle.handle);
    if (!hasPermission) {
      // If we have no permission, clear VFS and the indexedDB stores.
      VFS.clear();
      createFileTree(); // show empty file tree
      await this._clearStores();
      return;
    }

    await this._importFolderToVFS(rootFolderHandle.handle);

    this._watchRootFolder();
  }

  /**
   * Disconnect the LFS from the current folder.
   */
  terminate() {
    this.loaded = false;
    setLocalStorageItem('use-lfs', false);
    clearTimeout(this._watchRootFolderInterval);
    this._clearStores();
  }

  /**
   * Polling function to watch the root folder for changes. As long as Chrome's
   * LocalFilesystemAPI does not have event listeners built-in, we have no other
   * choice to poll the root folder for changes manually.
   *
   * Note that this does clear rebuild the VFS, indexedDB and visual tree every
   * few seconds, which - besides it not being efficient - also creates new
   * file/folder IDs every time. It's not a problem, but just something to be
   * aware of.
   */
  _watchRootFolder() {
    if (this._watchRootFolderInterval) {
      clearInterval(this._watchRootFolderInterval);
    }

    this._watchRootFolderInterval = setInterval(async () => {
      if (window._blockLFSPolling) return;

      // Iterate through all nodes in the tree and obtain all expanded folder
      // nodes their absolute path.
      const prevExpandedFolderPaths = [];

      getFileTreeInstance().visit((node) => {
        if (node.data.isFolder && node.expanded) {
          prevExpandedFolderPaths.push(VFS.getAbsoluteFolderPath(node.key));
        }
      });

      // Import again from the VFS.
      const rootFolderHandle = await this.getFolderHandle('root');
      await this._importFolderToVFS(rootFolderHandle.handle);

      // Expand all folder nodes again that were open (if they still exist).
      getFileTreeInstance().visit((node) => {
        if (node.data.isFolder && prevExpandedFolderPaths.includes(VFS.getAbsoluteFolderPath(node.key))) {
          node.setExpanded(true, { noAnimation: true });
        }
      });
    }, seconds(5));
  }

  /**
   * Request permission for a given handle, either file or directory handle.
   *
   * @param {FileSystemDirectoryHandle|FileSystemFileHandle} handle
   * @param {string} [mode] - The mode to request permission for.
   * @returns {Promise<boolean>} True if permission is granted, false otherwise.
   */
  _verifyPermission(handle, mode = 'readwrite') {
    const opts = { mode };

    return new Promise(async (resolve, reject) => {
      // Check if we already have permission.
      if ((await handle.queryPermission(opts)) === 'granted') {
        return resolve(true);
      }

      // Request permission to the handle.
      if ((await handle.requestPermission(opts)) === 'granted') {
        return resolve(true);
      }

      // The user did not grant permission.
      return resolve(false);
    });
  }

  /**
   * Open a directory picker dialog and returns the selected directory.
   *
   * @async
   * @returns {Promise<void>}
   */
  async openFolderPicker() {
    let rootFolderHandle;
    try {
      rootFolderHandle = await window.showDirectoryPicker();
    } catch (err) {
      // User most likely aborted.
      return;
    }

    const hasPermission = await this._verifyPermission(rootFolderHandle);
    if (hasPermission) {
      // Make sure GitFS is stopped.
      if (hasGitFSWorker()) {
        window._gitFS.terminate();
        window._gitFS = null;
      }

      // Remove local file storage warning if present.
      removeLocalStorageWarning();

      closeAllFiles();
      await this._importFolderToVFS(rootFolderHandle);
      this._watchRootFolder();
    }
  }

  /**
   * Import the contents of a folder on the local filesystem of the user to VFS.
   *
   * @async
   * @param {FileSystemDirectoryHandle} rootFolderHandle
   * @returns {Promise<void>}
   */
  async _importFolderToVFS(rootFolderHandle) {
    const tabs = getAllEditorTabs();
    const prevOpenTabs = tabs.map((tab) => {
      const fileId = tab.container.getState().fileId;
      return {
        path: VFS.getAbsoluteFilePath(fileId),
        tab: tabs.find((tab) => tab.container.getState().fileId === fileId),
      };
    });

    VFS.clear();
    await this._clearStores();

    // Save rootFolderHandle under the 'root' key for reference.
    await this.saveFolderHandle('root', null, rootFolderHandle);

    setFileTreeTitle(rootFolderHandle.name);

    // Read all contents and create the items in the VFS if they don't exist.
    await this._readFolder(rootFolderHandle, null);

    // Recreate the file tree.
    createFileTree();

    // Sync the new imported VFS IDs with the currently open tabs.
    prevOpenTabs.forEach(({ path, tab }) => {
      const file = VFS.findFileByPath(path);
      if (file) {
        tab.container.setState({ fileId: file.id });
      }
    });
    window._layout.emitToAllComponents('reloadContent');

    this.loaded = true;
    setLocalStorageItem('use-lfs', true);
  }

  /**
   * Retrieve the content of a file by its ID.
   *
   * @async
   * @param {string} id - The VFS file id.
   * @returns {Promise<string>} The file content.
   */
  async getFileContent(id) {
    try {
      const path = VFS.getAbsoluteFilePath(id)
      const fileHandle = await this.getFileHandle(path);
      const file = await fileHandle.handle.getFile();
      const content = await file.text();
      return content.trim();
    } catch (err) {
      console.error('Failed to get file content:', err);
    }
  }

  /**
   * Read the contents of a folder recursively and create the file tree in VFS.
   *
   * @async
   * @param {FileSystemDirectoryHandle} dirHandle - The directory handle to read.
   * @param {string} parentId - The ID of the parent folder.
   * @returns {Promise<void>}
   */
  async _readFolder(dirHandle, parentId) {
    const blacklistedPaths = [
      'site-packages',           // when user folder has python virtual env
      '__pycache__',             // Python cache directory
      '.mypy_cache',             // Mypy cache directory
      '.venv', 'venv', 'env',    // virtual environment
      '.DS_Store',               // Macos metadata file
      'dist', 'build',           // compiled assets for various languages
      'coverage', '.nyc_output', // code coverage reports
      '.git',                    // Git directory
      'node_modules',            // NodeJS projects
    ];

    for await (const [name, handle] of dirHandle) {
      if (handle.kind === 'file' && !blacklistedPaths.includes(name)) {
        const file = await handle.getFile();
        const { id: fileId } = VFS.createFile({
          name: file.name,
          parentId,
          size: file.size
        }, false);
        await this.saveFileHandle(VFS.getAbsoluteFilePath(fileId), fileId, handle);
      } else if (handle.kind === 'directory' && !blacklistedPaths.includes(name)) {
        const folder = VFS.createFolder({ name, parentId }, false);
        await this.saveFolderHandle(VFS.getAbsoluteFolderPath(folder.id), folder.id, handle);
        await this._readFolder(handle, folder.id);
      }
    }
  }

  /**
   * Rebuild the IndexedDB stores by clearing them and recursively reading the
   * child file/folders. For each file/folder, we find its corresponding VFS
   * entry based on its path and save the handle.
   *
   * @async
   * @returns {Promise<void>}
   */
  async rebuildIndexedDB() {
    const rootFolderHandle = await this.getFolderHandle('root');
    await this._clearStores();
    await this.saveFolderHandle('root', null, rootFolderHandle.handle);
    await this._rebuildIndexedDB(rootFolderHandle.handle, '');
  }

  /**
   * Internal method to rebuild the IndexedDB stores recursively.
   *
   * @async
   * @param {FileSystemDirectoryHandle} dirHandle - The directory handle to read.
   * @param {string} [pathPrefix] - Absolute path to this file/folder of its parents.
   * @returns {Promise<void>}
   */
  async _rebuildIndexedDB(dirHandle, pathPrefix) {
    for await (const [name, handle] of dirHandle) {
      if (handle.kind === 'file') {
        const fileKey = pathPrefix ? `${pathPrefix}/${name}` : name;
        const file = VFS.findFileByPath(fileKey);
        await this.saveFileHandle(fileKey, file.id, handle);
      } else if (handle.kind === 'directory') {
        const folderKey = pathPrefix ? `${pathPrefix}/${name}` : name;
        const folder = VFS.findFolderByPath(folderKey);
        await this.saveFolderHandle(folderKey, folder.id, handle);
        await this._rebuildIndexedDB(handle, folderKey);
      }
    }
  }

  /**
   * Callback function when the IndexedDB version is upgraded.
   *
   * @param {IDBVersionChangeEvent} event
   */
  indexedDBOnUpgradeNeededCallback = (event) => {
    const db = event.target.result;

    // Create object stores for file and folder handles

    if (!db.objectStoreNames.contains(this.FILE_HANDLES_STORE_NAME)) {
      db.createObjectStore(this.FILE_HANDLES_STORE_NAME);
    }

    if (!db.objectStoreNames.contains(this.FOLDER_HANDLES_STORE_NAME)) {
      db.createObjectStore(this.FOLDER_HANDLES_STORE_NAME);
    }
  };

  /**
   * Opens a request to the IndexedDB.
   *
   * @returns {Promise<IDBRequest>} The IDB request object.
   */
  _openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.IDB_NAME, this.IDB_VERSION);
      request.onupgradeneeded = this.indexedDBOnUpgradeNeededCallback;

      request.onblocked = (event) => {
        console.error('IDB is blocked', event);
        reject(event.target.error);
      }

      request.onsuccess = (event) => event.target.result ? resolve(event.target.result) : resolve();
      request.onerror = (event) => reject(event.target.error);
    });
  }

  /**
   * Clear all stores inside the app's indexedDB.
   *
   * @returns {Promise<void>}
   */
  _clearStores() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.IDB_NAME, this.IDB_VERSION);
      request.onupgradeneeded = this.indexedDBOnUpgradeNeededCallback;

      request.onsuccess = (event) => {
        const db = event.target.result;

        // Check if the database has any object stores
        if (db.objectStoreNames.length > 0) {
          const transaction = db.transaction(db.objectStoreNames, 'readwrite');

          transaction.oncomplete = () => {
            resolve();
          };

          transaction.onerror = () => {
            console.error('Error clearing stores');
            reject(transaction.error);
          };

          // Clear each object store.
          for (const storeName of db.objectStoreNames) {
            const store = transaction.objectStore(storeName);
            store.clear();
          }
        } else {
          // No object stores, resolve immediately.
          resolve();
        }
      };

      request.onerror = () => {
        console.error('Error opening database');
        reject(request.error);
      };
    });
  }

  /**
   * Save the given handle in the specified IDB store.
   *
   * @async
   * @param {string} storeName - The store name where to save the handle.
   * @param {string} key - The key to save the handle under.
   * @param {*} value - The value to save under the key.
   * @returns {Promise<void>}
   */
  async _saveHandle(storeName, key, value) {
    const db = await this._openDB();

    return new Promise((resolve, reject) => {
      const request = db
        .transaction(storeName, 'readwrite')
        .objectStore(storeName)
        .put(value, key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject();
    });
  }

  /**
   * Save the file handle in the IndexedDB.
   *
   * @param {string} path - The absolute filepath to save the handle under.
   * @param {string} id - The VFS file id.
   * @param {FileSystemFileHandle} handle - The file handle to save.
   * @returns {Promise<FileSystemFileHandle>}
   */
  saveFileHandle(path, id, handle) {
    return this._saveHandle(this.FILE_HANDLES_STORE_NAME, path, { id, handle });
  }

  /**
   * Save the folder handle in the IndexedDB.
   *
   * @param {string} path - The absolute folderpath to save the handle under.
   * @param {string} id - The VFS folder id.
   * @param {FileSystemDirectoryHandle} handle - The folder handle to save.
   * @returns {Promise<FileSystemDirectoryHandle>}
   */
  saveFolderHandle(path, id, handle) {
    return this._saveHandle(this.FOLDER_HANDLES_STORE_NAME, path, { id, handle });
  }

  /**
   * Retrieve a handle from the specified store by key.
   *
   * @async
   * @param {string} storeName - The store name to retrieve the handle from.
   * @param {string} key - A unique key to identify the handle.
   * @returns {Promise<FileSystemDirectoryHandle|FileSystemFileHandle>}
   */
  async _getHandle(storeName, key) {
    const db = await this._openDB();

    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName).objectStore(storeName).get(key);
      request.onsuccess = (event) => event.target.result ? resolve(event.target.result) : resolve();
      request.onerror = (event) => reject(event.target.error);
    });
  }

  /**
   * Retrieve a file handle from the IndexedDB.
   *
   * @param {string} key - The VFS absolute filepath.
   * @returns {Promise<FileSystemFileHandle>}
   */
  getFileHandle(key) {
    return this._getHandle(this.FILE_HANDLES_STORE_NAME, key);
  }

  /**
   * Retrieve a folder handle from the IndexedDB.
   *
   * @param {string} key - The VFS absolute folderpath.
   * @returns {Promise<FileSystemDirectoryHandle>}
   */
  getFolderHandle(key) {
    return this._getHandle(this.FOLDER_HANDLES_STORE_NAME, key);
  }

  /**
   * Delete a handle from the specified store by key.
   *
   * @async
   * @param {string} storeName - The store name to delete the handle from.
   * @param {string} key - A unique key to identify the handle.
   * @returns {Promise<void>}
   */
  async _removeHandle(storeName, key) {
    const db = await this._openDB();

    return new Promise((resolve, reject) => {
      const request = db
        .transaction(storeName, 'readwrite')
        .objectStore(storeName)
        .delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject();
    });
  }

  /**
   * Remove a file handle from the IndexedDB.
   *
   * @async
   * @param {string} key - The VFS absolute filepath.
   * @returns {Promise<void>}
   */
  async removeFileHandle(key) {
    await this._removeHandle(this.FILE_HANDLES_STORE_NAME, key);
  }

  /**
   * Remove a folder handle from the IndexedDB.
   *
   * @async
   * @param {string} key - The VFS absolute folderpath.
   * @returns {Promise<void>}
   */
  async removeFolderHandle(key) {
    await this._removeHandle(this.FOLDER_HANDLES_STORE_NAME, key);
  }

  /**
   * Write the content to a file in the specified folder. If no folderId is
   * provided, the file will be written to the root folder the user selected.
   *
   * @async
   * @param {string} folderId - Unique VFS folder id.
   * @param {string} fileId - Unique VFS file id.
   * @param {string} filename - The filename to write to.
   * @param {string} content - The file contents to write.
   * @returns {Promise<void>}
   */
  async writeFileToFolder(folderId, fileId, filename, content) {
    try {
      this.busy = true;
      const fileKey = VFS.getAbsoluteFilePath(fileId);

      const folderHandle = await this.getFolderHandle(folderId ? VFS.getAbsoluteFolderPath(folderId) : 'root');

      let fileHandle = await this.getFileHandle(fileKey);
      if (!fileHandle) {
        // No file handle exists, create a new one.
        fileHandle = await folderHandle.handle.getFileHandle(filename, { create: true });
        await this.saveFileHandle(fileKey, fileId, fileHandle);
      } else {
        fileHandle = fileHandle.handle;
      }

      const writable = await fileHandle.createWritable();
      await writable.write(content.trim() + '\n');
      await writable.close();
    } finally {
      this.busy = false;
    }
  }

  /**
   * Create a new folder in the specified parent folder. If no parentId is not
   * provided or is either null or undefined, then the folder will be created in
   * the root folder.
   *
   * @async
   * @param {string} folderId - Unique VFS folder id.
   * @param {string} parentId - Unique VFS parent folder id.
   * @param {string} folderName - The name of the folder to create.
   * @returns {Promise<void>}
   */
  async createFolder(folderId, parentId, folderName) {
    try {
      this.busy = true;

      const parentFolder = await this.getFolderHandle(parentId ? VFS.getAbsoluteFolderPath(parentId) : 'root');
      const folderHandle = await parentFolder.handle.getDirectoryHandle(folderName, { create: true });
      await this.saveFolderHandle(VFS.getAbsoluteFolderPath(folderId), folderId, folderHandle);
    } finally {
      this.busy = false;
    }
  }

  /**
   * Delete a file by its VFS file id.
   *
   * @async
   * @param {string} id - Unique VFS file id.
   * @returns {Promise<boolean>} True if deleted successfully, otherwise false.
   */
  async deleteFile(id) {
    try {
      this.busy = true;

      const fileKey = VFS.getAbsoluteFilePath(id);
      const fileHandle = await this.getFileHandle(fileKey);
      if (fileHandle) {
        await fileHandle.handle.remove();
        await this.removeFileHandle(fileKey);
      }

      return true;
    } catch (err) {
      console.error('Failed to delete file:', err);
      return false;
    } finally {
      this.busy = false;
    }
  }

  /**
   * Delete a folder by its VFS folder id.
   *
   * @async
   * @param {string} id - Unique VFS folder id.
   * @returns {Promise<boolean>} True if deleted successfully, otherwise false.
   */
  async deleteFolder(id) {
    try {
      this.busy = true;
      const folderKey = VFS.getAbsoluteFolderPath(id);
      const folderHandle = await this.getFolderHandle(folderKey);
      await this._recursivelyDeleteFolder(folderHandle.handle);
      await this.removeFolderHandle(folderKey);
      return true;
    } catch (err) {
      console.error('Failed to delete folder:', err);
      return false;
    } finally {
      this.busy = false;
    }
  }

  /**
   * Recursively deletes the contents of the folder, then the folder itself.
   *
   * @async
   * @param {FileSystemDirectoryHandle} folderHandle - Handle to the folder.
   * @returns {Promise<void>}
   */
  async _recursivelyDeleteFolder(folderHandle) {
    for await (const [name, handle] of folderHandle.entries()) {
      if (handle.kind === 'directory') {
        // Delete nested directory.
        await this._recursivelyDeleteFolder(handle);
      } else {
        // Delete nested file.
        await handle.remove();
      }
    }

    // Remove the folder itself.
    await folderHandle.remove();
  }

  /**
   * Move a file to a new location.
   *
   * @async
   * @param {string} id - Unique VFS file id.
   * @param {string} newName - The name of the file (can be unchanged).
   * @param {string} newParentId - Unique VFS parent folder id (can be unchanged).
   * @returns {Promise<void>}
   */
  async moveFile(id, newName, newParentId) {
    try {
      this.busy = true;

      const fileKey = VFS.getAbsoluteFilePath(id);

      // Remove current file.
      const currentFileHandle = await this.getFileHandle(fileKey);
      await currentFileHandle.handle.remove();

      // Make new file and store handle under the same id.
      const folderHandle = await this.getFolderHandle(newParentId ? VFS.getAbsoluteFolderPath(newParentId) : 'root');
      const fileHandle = await folderHandle.handle.getFileHandle(newName, { create: true });
      await this.saveFileHandle(fileKey, id, fileHandle);
    } finally {
      this.busy = false;
    }
  }

  /**
   * Move a folder to a new location.
   *
   * @async
   * @param {string} id - Unique VFS folder id.
   * @param {string} newName - The new folder name (can be unchanged).
   * @param {string|null} newParentId - Unique VFS parent folder id.
   * @returns {Promise<void>}
   */
  async moveFolder(id, newName, newParentId) {
    try {
      this.busy = true;
      const folder = VFS.findFolderById(id);

      // Now move the folders in the LFS.
      await this._moveFolderRecursively(id, newParentId, newName);

      // After moving everything, delete the folder itself on the LFS.
      const parentFolderHandle = await this.getFolderHandle(
        folder.parentId
          ? VFS.getAbsoluteFolderPath(folder.parentId)
          : 'root'
      );
      await parentFolderHandle.handle.removeEntry(folder.name, { recursive: true });

      // Move the folder in VFS.
      folder.parentId = newParentId;

      await this.rebuildIndexedDB();
    } finally {
      this.busy = false;
    }
  }

  /**
   * Move a folder recursively to a new location, depth-first.
   *
   * @async
   * @param {string} folderId - Unique VFS folder id.
   * @param {string} parentFolderId - Unique VFS parent folder id.
   * @param {string} [newName] - New folder name for root folder.
   * @returns {Promise<void>}
   */
  async _moveFolderRecursively(folderId, parentFolderId, newName) {
    const folderKey = VFS.getAbsoluteFolderPath(folderId);
    const folderHandle = await this.getFolderHandle(folderKey);
    const parentFolderHandle = await this.getFolderHandle(
      parentFolderId
        ? VFS.getAbsoluteFolderPath(parentFolderId)
        : 'root'
    );

    // Create the current folder in the new parent folder.
    const newCurrentFolderHandle = await parentFolderHandle.handle.getDirectoryHandle(
      newName || folderHandle.handle.name,
      { create: true }
    );
    await this.saveFolderHandle(folderKey, folderId, newCurrentFolderHandle);

    // Create the subfolders and files in the new folder.
    await Promise.all(
      VFS.findFoldersWhere({ parentId: folderId }).map(
        (subfolder) => this._moveFolderRecursively(subfolder.id, folderId)
      )
    )

    await Promise.all(
      VFS.findFilesWhere({ parentId: folderId }).map(async (subfile) => {
        const subfileKey = VFS.getAbsoluteFilePath(subfile.id);
        const currentFileHandle = await this.getFileHandle(subfileKey);
        await currentFileHandle.handle.remove();

        const newFileHandle = await newCurrentFolderHandle.getFileHandle(subfile.name, { create: true });

        if (subfile.content) {
          const writable = await newFileHandle.createWritable();
          await writable.write(subfile.content);
          await writable.close();
        }

        await this.saveFileHandle(subfileKey, subfile.id, newFileHandle);
      })
    )
  }
}

const LFS = new LocalFileSystem();
