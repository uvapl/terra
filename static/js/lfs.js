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
   * Open a directory picker dialog and returns the selected directory.
   *
   * @async
   * @returns {Promise<void>}
   */
  async openFolderPicker() {
    const dirHandle = await window.showDirectoryPicker();

    const permission = await dirHandle.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      return console.error('Permission denied readwrite directory');
    }

    closeAllFiles();
    VFS.clear();
    createFileTree(); // show empty file tree
    this._clearDB();

    // Save dirHandle under the 'root' key for reference.
    await this.saveFolderHandle(dirHandle, 'root');

    await this._readFolder(dirHandle, null);
    createFileTree();
    this.loaded = true;
  }

  /**
   * Retrieve the content of a file by its ID.
   *
   * @async
   * @param {string} id - The VFS file id.
   * @returns {Promise<string>} The file content.
   */
  async getFileContent(id) {
    const handle = await this.getFileHandle(id);
    const file = await handle.getFile();
    const content = await file.text();
    return content;
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
    for await (const [name, handle] of dirHandle) {
      if (handle.kind === 'file') {
        const file = await handle.getFile();
        const { id: fileId } = VFS.createFile({
          name: file.name,
          parentId,
          size: file.size
        }, false);
        await this.saveFileHandle(handle, fileId);
      } else if (handle.kind === 'directory') {
        const folder = VFS.createFolder({ name, parentId }, false);
        await this.saveFolderHandle(handle, folder.id);
        await this._readFolder(handle, folder.id);
      }
    }
  }

  /**
   * Opens a request to the IndexedDB.
   *
   * @returns {Promise<IDBRequest>} The IDB request object.
   */
  _openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.IDB_NAME, this.IDB_VERSION);

      request.onblocked = (event) => {
        console.error('IDB is blocked', event);
        reject(event.target.error);
      }

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create object stores for file and folder handles

        if (!db.objectStoreNames.contains(this.FILE_HANDLES_STORE_NAME)) {
          db.createObjectStore(this.FILE_HANDLES_STORE_NAME);
        }

        if (!db.objectStoreNames.contains(this.FOLDER_HANDLES_STORE_NAME)) {
          db.createObjectStore(this.FOLDER_HANDLES_STORE_NAME);
        }
      };

      request.onsuccess = (event) => event.target.result ? resolve(event.target.result) : reject();
      request.onerror = (event) => reject(event.target.error);
    });
  }

  _clearDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.IDB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject();
    });
  }

  /**
   * Save the given handle in the specified IDB store.
   *
   * @async
   * @param {string} storeName - The store name where to save the handle.
   * @param {FileSystemDirectoryHandle|FileSystemFileHandle} handle - The handle to save.
   * @param {string} key - A unique key to identify the handle.
   * @returns {Promise<void>} The file id of the saved handle.
   */
  async _saveHandle(storeName, handle, key) {
    const db = await this._openDB();

    return new Promise((resolve, reject) => {
      const request = db
        .transaction(storeName, 'readwrite')
        .objectStore(storeName)
        .put(handle, key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject();
    });
  }

  /**
   * Save the file handle in the IndexedDB.
   *
   * @param {FileSystemFileHandle} handle - The file handle to save.
   * @param {string} key - The VFS file id.
   * @returns {Promise<FileSystemFileHandle>}
   */
  saveFileHandle(handle, key) {
    return this._saveHandle(this.FILE_HANDLES_STORE_NAME, handle, key);
  }

  /**
   * Save the folder handle in the IndexedDB.
   *
   * @param {FileSystemDirectoryHandle} handle - The folder handle to save.
   * @param {string} key - The VFS folder id.
   * @returns {Promise<FileSystemDirectoryHandle>}
   */
  saveFolderHandle(handle, key) {
    return this._saveHandle(this.FOLDER_HANDLES_STORE_NAME, handle, key);
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
      request.onsuccess = (event) => event.target.result ? resolve(event.target.result) : reject();
      request.onerror = (event) => reject(event.target.error);
    });
  }

  /**
   * Retrieve a file handle from the IndexedDB.
   *
   * @param {string} key - The VFS file id.
   * @returns {Promise<FileSystemFileHandle>}
   */
  getFileHandle(key) {
    return this._getHandle(this.FILE_HANDLES_STORE_NAME, key);
  }

  /**
   * Retrieve a folder handle from the IndexedDB.
   *
   * @param {string} key - The VFS folder id.
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
   * @param {string} key - The VFS file id.
   * @returns {Promise<void>}
   */
  async removeFileHandle(key) {
    await this._removeHandle(this.FILE_HANDLES_STORE_NAME, key);
  }

  /**
   * Remove a folder handle from the IndexedDB.
   *
   * @async
   * @param {string} key - The VFS folder id.
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
    if (!folderId) {
      folderId = 'root';
    }

    const folderHandle = await this.getFolderHandle(folderId);

    let fileHandle;
    try {
      // Get file handle if it exists.
      fileHandle = await this.getFileHandle(fileId);
    } catch {
      // No file handle exists, create a new one.
      fileHandle = await folderHandle.getFileHandle(filename, { create: true });
      await this.saveFileHandle(fileHandle, fileId);
    }

    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
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
    if (!parentId) {
      parentId = 'root';
    }

    const parentFolder = await this.getFolderHandle(parentId);
    const folderHandle = await parentFolder.getDirectoryHandle(folderName, { create: true });
    await this.saveFolderHandle(folderHandle, folderId);
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
      const fileHandle = await this.getFileHandle(id);
      await fileHandle.remove();
      await this.removeFileHandle(id);
      return true;
    } catch (err) {
      console.error('Failed to delete file:', err);
      return false;
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
      const folderHandle = await this.getFolderHandle(id);
      await this._recursivelyDeleteFolder(folderHandle);
      await this.removeFolderHandle(id);
      return true;
    } catch (err) {
      console.error('Failed to delete folder:', err);
      return false;
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
    if (!newParentId) {
      newParentId = 'root';
    }

    // Remove current file.
    const currentFileHandle = await this.getFileHandle(id);
    await currentFileHandle.remove();

    // Make new file and store handle under the same id.
    const folderHandle = await this.getFolderHandle(newParentId);
    const fileHandle = await folderHandle.getFileHandle(newName, { create: true });
    await this.saveFileHandle(fileHandle, id);
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
    const folder = VFS.findFolderById(id);

    // Move current folder in VFS.
    folder.parentId = newParentId;

    // Now move the folders in the LFS.
    await this._moveFolderRecursively(id, newParentId, newName);
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
    const folderHandle = await this.getFolderHandle(folderId);
    const parentFolderHandle = await this.getFolderHandle(parentFolderId || 'root');

    // Create the current folder in the new parent folder.
    const newCurrentFolderHandle = await parentFolderHandle.getDirectoryHandle(newName || folderHandle.name, { create: true });
    await this.saveFolderHandle(newCurrentFolderHandle, folderId);

    // Create the subfolders and files in the new folder.
    await Promise.all(
      VFS.findFoldersWhere({ parentId: folderId }).map(
        (subfolder) => this._moveFolderRecursively(subfolder.id, folderId)
      )
    )

    await Promise.all(
      VFS.findFilesWhere({ parentId: folderId })
        .map(async (subfile) => {
          const currentFileHandle = await this.getFileHandle(subfile.id);
          await currentFileHandle.remove();

          const newFileHandle = await newCurrentFolderHandle.getFileHandle(subfile.name, { create: true });

          if (subfile.content) {
            const writable = await newFileHandle.createWritable();
            await writable.write(subfile.content);
            await writable.close();
          }

          await this.saveFileHandle(newFileHandle, subfile.id);
        })
    )

    await folderHandle.remove();
  }
}

const LFS = new LocalFileSystem();
