////////////////////////////////////////////////////////////////////////////////
// This file contains the local filesystem logic for the IDE app, using
// https://developer.mozilla.org/en-US/docs/Web/API/File_System_API
////////////////////////////////////////////////////////////////////////////////
import { hasGitFSWorker, seconds } from './helpers/shared.js';
import pluginManager from './plugin-manager.js';
import Terra from './terra.js';
import localStorageManager from './local-storage-manager.js';
import fileTreeManager from './file-tree-manager.js';

export default class LocalFileSystem {
  IDB_VERSION = 1;
  IDB_NAME = 'terra';
  FILE_HANDLES_STORE_NAME = 'file-handles';
  FOLDER_HANDLES_STORE_NAME = 'folder-handles';

  /**
   * Local reference to the VFS instance.
   * @type {VirtualFileSystem}
   */
  vfs = null;

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

  constructor(vfs) {
    this.vfs = vfs;

    this.bindVFSEvents();
  }

  bindVFSEvents = () => {
    // Only call the specified event if the user loaded a project.
    const listener = (fn) => (event) => this.loaded ? fn(event) : false;

    this.vfs.addEventListener('fileCreated', listener(this.vfsFileCreatedHandler));
    this.vfs.addEventListener('beforeFileMoved', listener(this.vfsBeforeFileMovedHandler));
    this.vfs.addEventListener('fileContentChanged', listener(this.vfsFileContentChangedHandler));
    this.vfs.addEventListener('beforeFileDeleted', listener(this.vfsFileDeletedHandler));

    this.vfs.addEventListener('folderCreated', listener(this.vfsFolderCreatedHandler));
    this.vfs.addEventListener('beforeFolderMoved', listener(this.vfsBeforeFolderMovedHandler));
    this.vfs.addEventListener('beforeFolderDeleted', listener(this.vfsBeforeFolderDeletedHandler));
  }

  vfsFileCreatedHandler = (event) => {
    const { file } = event.detail;
    this.writeFileToFolder(file.parentId, file.id, file.name, file.content);
  }

  vfsBeforeFileMovedHandler = async (event) => {
    const { file, values } = event.detail;
    await this.moveFile(
      file.id,
      values.name || file.name,
      typeof values.parentId !== 'undefined' ? values.parentId : file.parentId,
    );
  }

  vfsFileContentChangedHandler = (event) => {
    const { file } = event.detail;

    // Update the file content in the LFS after a second of inactivity.
    Terra.app.registerTimeoutHandler(`lfs-sync-${file.id}`, seconds(1), () => {
      this.writeFileToFolder(file.parentId, file.id, file.name, file.content);
    });
  }

  vfsFileDeletedHandler = (event) => {
    const  { file, isSingleFileDelete } = event.detail;

    if (isSingleFileDelete) {
      this.deleteFile(file.id);
    }

    this.removeFileHandle(file.id);
  }

  vfsBeforeFolderMovedHandler = async (event) => {
    const { folder, values } = event.detail;
    await this.moveFolder(
      folder.id,
      values.name || folder.name,
      typeof values.parentId !== 'undefined' ? values.parentId : folder.parentId,
    );
  }

  vfsFolderCreatedHandler = (event) => {
    const { folder } = event.detail;
    this.createFolder(folder.id, folder.parentId, folder.name);
  }

  vfsBeforeFolderDeletedHandler = (event) => {
    const { folder, isRootFolder } = event.detail;

    if (isRootFolder) {
      this.deleteFolder(folder.id);
    } else {
      this.removeFolderHandle(folder.id);
    }
  }

  init = async () => {
    const rootFolderHandle = await this.getFolderHandle('root');
    if (!rootFolderHandle) return;

    const hasPermission = await this._verifyPermission(rootFolderHandle.handle);
    if (!hasPermission) {
      // If we have no permission, clear VFS and the indexedDB stores.
      this.vfs.clear();
      fileTreeManager.createFileTree(); // show empty file tree
      await this._clearStores();
      return;
    }

    await this._importFolderToVFS(rootFolderHandle.handle);

    $('#menu-item--close-folder').removeClass('disabled');

    this._watchRootFolder();
    pluginManager.triggerEvent('onStorageChange', 'lfs');
  }

  /**
   * Disconnect the LFS from the current folder.
   */
  terminate = async () => {
    this.loaded = false;
    localStorageManager.setLocalStorageItem('use-lfs', false);
    clearTimeout(this._watchRootFolderInterval);
    await this._clearStores();
    $('#menu-item--close-folder').addClass('disabled');
  }

  /**
   * Close the current folder and clear the VFS.
   */
  closeFolder = () => {
    this.terminate();
    this.vfs.clear();
    fileTreeManager.createFileTree(); // show empty file tree
    fileTreeManager.showLocalStorageWarning();
    fileTreeManager.setTitle('local storage');
    pluginManager.triggerEvent('onStorageChange', 'local');
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
  _watchRootFolder = () => {
    if (this._watchRootFolderInterval) {
      clearInterval(this._watchRootFolderInterval);
    }

    this._watchRootFolderInterval = setInterval(async () => {
      if (Terra.v.blockLFSPolling) return;

      await fileTreeManager.runFuncWithPersistedState(async () => {
        // Import again from the VFS.
        const rootFolderHandle = await this.getFolderHandle('root');
        await this._importFolderToVFS(rootFolderHandle.handle);
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
  _verifyPermission = (handle, mode = 'readwrite') => {
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
  openFolderPicker = async () => {
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
        Terra.app.gitfs.terminate();
        Terra.app.gitfs = null;
      }

      // Remove local file storage warning if present.
      fileTreeManager.removeLocalStorageWarning();

      Terra.app.layout.closeAllFiles();
      await this._importFolderToVFS(rootFolderHandle);
      this._watchRootFolder();
      pluginManager.triggerEvent('onStorageChange', 'lfs');
    }
  }

  /**
   * Import the contents of a folder on the local filesystem of the user to VFS.
   *
   * @async
   * @param {FileSystemDirectoryHandle} rootFolderHandle
   * @returns {Promise<void>}
   */
  _importFolderToVFS = async (rootFolderHandle) => {
    const tabComponents = Terra.app.layout.getTabComponents();
    const prevOpenTabs = tabComponents
    .filter((tabComponent) => tabComponent.getState().fileId)
    .map((tabComponent) => {
      const { fileId } = tabComponent.getState();
      return {
        path: this.vfs.findFileById(fileId).path,
        editorComponent: tabComponent,
      };
    });

    this.vfs.clear();
    await this._clearStores();

    // Save rootFolderHandle under the 'root' key for reference.
    await this.saveFolderHandle('root', null, rootFolderHandle);

    fileTreeManager.setTitle(rootFolderHandle.name);

    // Read all contents and create the items in the VFS if they don't exist.
    await this._readFolder(rootFolderHandle, null);

    // Recreate the file tree.
    fileTreeManager.createFileTree();

    // Sync the new imported VFS IDs with the currently open tabs.
    prevOpenTabs.forEach(({ path, editorComponent }) => {
      const file = this.vfs.findFileByPath(path);
      if (file) {
        editorComponent.extendState({ fileId: file.id });
      }
    });

    this.loaded = true;
    Terra.app.layout.emitToAllComponents('vfsChanged');
    localStorageManager.setLocalStorageItem('use-lfs', true);
  }

  /**
   * Retrieve the content of a file by its ID.
   *
   * @async
   * @param {string} id - The VFS file id.
   * @returns {Promise<string>} The file content.
   */
  getFileContent = async (id) => {
    try {
      const { path } = this.vfs.findFileById(id);
      const fileHandle = await this.getFileHandle(path);
      const file = await fileHandle.handle.getFile();
      const content = await file.text();
      return content;
    } catch (err) {
      console.error('Failed to get file content:', err);
    }
  }

  /**
   * Retrieve the file by its ID.
   *
   * @async
   * @param {string} id - The VFS file id.
  * @returns {Promise<File>} The file object.
   */
  getFile = async (id) => {
    try {
      const { path } = this.vfs.findFileById(id);
      const fileHandle = await this.getFileHandle(path);
      const file = await fileHandle.handle.getFile();
      return file;
    } catch (err) {
      console.error('Failed to get file object:', err);
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
  _readFolder = async (dirHandle, parentId) => {
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
        const { id: fileId } = this.vfs.createFile({
          name: file.name,
          parentId,
          size: file.size
        }, false);
        await this.saveFileHandle(this.vfs.findFileById(fileId).path, fileId, handle);
      } else if (handle.kind === 'directory' && !blacklistedPaths.includes(name)) {
        const folder = this.vfs.createFolder({ name, parentId }, false);
        await this.saveFolderHandle(this.vfs.findFolderById(folder.id).path, folder.id, handle);
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
  rebuildIndexedDB = async () => {
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
  _rebuildIndexedDB = async (dirHandle, pathPrefix) => {
    for await (const [name, handle] of dirHandle) {
      if (handle.kind === 'file') {
        const fileKey = pathPrefix ? `${pathPrefix}/${name}` : name;
        const file = this.vfs.findFileByPath(fileKey);
        await this.saveFileHandle(fileKey, file.id, handle);
      } else if (handle.kind === 'directory') {
        const folderKey = pathPrefix ? `${pathPrefix}/${name}` : name;
        const folder = this.vfs.findFolderByPath(folderKey);
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
  _openDB = () => {
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
  _clearStores = () => {
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
  _saveHandle = async (storeName, key, value) => {
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
  saveFileHandle = (path, id, handle) => {
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
  saveFolderHandle = (path, id, handle) => {
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
  _getHandle = async (storeName, key) => {
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
  getFileHandle = (key) => {
    return this._getHandle(this.FILE_HANDLES_STORE_NAME, key);
  }

  /**
   * Retrieve a folder handle from the IndexedDB.
   *
   * @param {string} key - The VFS absolute folderpath.
   * @returns {Promise<FileSystemDirectoryHandle>}
   */
  getFolderHandle = (key) => {
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
  _removeHandle = async (storeName, key) => {
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
  removeFileHandle = async (key) => {
    await this._removeHandle(this.FILE_HANDLES_STORE_NAME, key);
  }

  /**
   * Remove a folder handle from the IndexedDB.
   *
   * @async
   * @param {string} key - The VFS absolute folderpath.
   * @returns {Promise<void>}
   */
  removeFolderHandle = async (key) => {
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
  writeFileToFolder = async (folderId, fileId, filename, content) => {
    try {
      this.busy = true;
      const fileKey = this.vfs.findFileById(fileId).path;

      const folderHandle = await this.getFolderHandle(folderId ? this.vfs.findFolderById(folderId).path : 'root');

      let fileHandle = await this.getFileHandle(fileKey);
      if (!fileHandle) {
        // No file handle exists, create a new one.
        fileHandle = await folderHandle.handle.getFileHandle(filename, { create: true });
        await this.saveFileHandle(fileKey, fileId, fileHandle);
      } else {
        fileHandle = fileHandle.handle;
      }

      const writable = await fileHandle.createWritable();
      await writable.write(content);
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
  createFolder = async (folderId, parentId, folderName) => {
    try {
      this.busy = true;

      const parentFolder = await this.getFolderHandle(parentId ? this.vfs.findFolderById(parentId).path : 'root');
      const folderHandle = await parentFolder.handle.getDirectoryHandle(folderName, { create: true });
      await this.saveFolderHandle(this.vfs.findFolderById(folderId).path, folderId, folderHandle);
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
  deleteFile = async (id) => {
    try {
      this.busy = true;

      const fileKey = this.vfs.findFileById(id).path;
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
  deleteFolder = async (id) => {
    try {
      this.busy = true;
      const folderKey = this.vfs.findFolderById(id).path;
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
  _recursivelyDeleteFolder = async (folderHandle) => {
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
  moveFile = async (id, newName, newParentId) => {
    try {
      this.busy = true;

      const fileKey = this.vfs.findFileById(id).path;

      // Remove current file.
      const currentFileHandle = await this.getFileHandle(fileKey);
      await currentFileHandle.handle.remove();

      // Make new file and store handle under the same id.
      const folderHandle = await this.getFolderHandle(newParentId ? this.vfs.findFolderById(newParentId).path : 'root');
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
  moveFolder = async (id, newName, newParentId) => {
    try {
      this.busy = true;
      const folder = this.vfs.findFolderById(id);

      // Now move the folders in the LFS.
      await this._moveFolderRecursively(id, newParentId, newName);

      // After moving everything, delete the folder itself on the LFS.
      const parentFolderHandle = await this.getFolderHandle(
        folder.parentId
          ? this.vfs.findFolderById(folder.parentId).path
          : 'root'
      );
      await parentFolderHandle.handle.removeEntry(folder.name, { recursive: true });

      // Move the folder in VFS.
      // Do not use `VFS.updateFolder()` to prevent recursion.
      folder.parentId = newParentId;
      folder.path = this.vfs.getAbsoluteFolderPath(folder.id);

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
  _moveFolderRecursively = async (folderId, parentFolderId, newName) => {
    const folderKey = this.vfs.findFolderById(folderId).path;
    const folderHandle = await this.getFolderHandle(folderKey);
    const parentFolderHandle = await this.getFolderHandle(
      parentFolderId
        ? this.vfs.findFolderById(parentFolderId).path
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
      this.vfs.findFoldersWhere({ parentId: folderId }).map(
        (subfolder) => this._moveFolderRecursively(subfolder.id, folderId)
      )
    )

    await Promise.all(
      this.vfs.findFilesWhere({ parentId: folderId }).map(async (subfile) => {
        const subfileKey = this.vfs.findFileById(subfile.id).path;
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
