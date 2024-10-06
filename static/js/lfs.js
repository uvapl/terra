////////////////////////////////////////////////////////////////////////////////
// This file contains the local filesystem logic for the IDE app, using
// https://developer.mozilla.org/en-US/docs/Web/API/File_System_API
////////////////////////////////////////////////////////////////////////////////

class LocalFileSystem {
  IDB_VERSION = 1;
  IDB_NAME = 'examide';
  FILE_HANDLES_STORE_NAME = 'file-handles';
  FOLDER_HANDLES_STORE_NAME = 'folder-handles';

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
    await this._saveFolderHandle(dirHandle, 'root');

    await this._readFolder(dirHandle, null);
    createFileTree();
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
        await this._saveFileHandle(handle, fileId);
      } else if (handle.kind === 'directory') {
        const folder = VFS.createFolder({ name, parentId }, false);
        await this._saveFolderHandle(handle, folder.id);
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
  _saveFileHandle(handle, key) {
    return this._saveHandle(this.FILE_HANDLES_STORE_NAME, handle, key);
  }

  /**
   * Save the folder handle in the IndexedDB.
   *
   * @param {FileSystemDirectoryHandle} handle - The folder handle to save.
   * @param {string} key - The VFS folder id.
   * @returns {Promise<FileSystemDirectoryHandle>}
   */
  _saveFolderHandle(handle, key) {
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
      this._saveFileHandle(fileHandle, fileId);
    }

    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }
}

const LFS = new LocalFileSystem();
