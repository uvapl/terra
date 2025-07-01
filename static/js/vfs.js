////////////////////////////////////////////////////////////////////////////////
// This file contains the virtual filesystem logic for the IDE app.
////////////////////////////////////////////////////////////////////////////////

import {
  addNewLineCharacter,
  hasGitFSWorker,
  uuidv4
} from './helpers/shared.js';
import { IS_IDE } from './constants.js';
import Terra from './terra.js';
import localStorageManager from './local-storage-manager.js';

export default class VirtualFileSystem extends EventTarget {
  IDB_VERSION = 1;
  IDB_NAME = 'terra-vfs';
  FILES_STORE_NAME = 'files';
  FOLDERS_STORE_NAME = 'folders';

  /**
   * Contains all the files in the virtual filesystem.
   * The key is the file id and the value is the file object.
   * @type {object<string, object>}
   */
  files = {};

  /**
   * Contains all the folders in the virtual filesystem.
   * The key is the folder id and the value is the folder object.
   * @type {object<string, object>}
   */
  folders = {};

  constructor() {
    super();
  }

  /**
   * Callback function when the IndexedDB version is upgraded.
   *
   * @param {IDBVersionChangeEvent} event
   */
  indexedDBOnUpgradeNeededCallback = (event) => {
    const db = event.target.result;

    // Create object stores for file and folder handles

    if (!db.objectStoreNames.contains(this.FILES_STORE_NAME)) {
      db.createObjectStore(this.FILES_STORE_NAME);
    }

    if (!db.objectStoreNames.contains(this.FOLDERS_STORE_NAME)) {
      db.createObjectStore(this.FOLDERS_STORE_NAME);
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
   * Increment the number in a string with the pattern `XXXXXX (N)`.
   *
   * @example this._incrementString('Untitled')     -> 'Untitled (1)'
   * @example this._incrementString('Untitled (1)') -> 'Untitled (2)'
   *
   * @param {string} string - The string to update.
   * @returns {string} The updated string containing the number.
   */
  _incrementString = (string) => {
    const match = /\((\d+)\)$/g.exec(string);

    if (match) {
      const num = parseInt(match[1]) + 1;
      return string.replace(/\d+/, num);
    }

    return `${string} (1)`;
  }

  /**
   * Clear the virtual filesystem, removing all files and folders permantly.
   */
  clear = async () => {
    // this.files = {};
    // this.folders = {};

    await this._clearStores();
  }

  _dbHasFiles = async () => {
    const db = await this._openDB();

    return new Promise((resolve, reject) => {
      const request = db.transaction(this.FILES_STORE_NAME, 'readonly')
        .objectStore(this.FILES_STORE_NAME)
        .count();

      request.onsuccess = () => resolve(request.result > 0);
      request.onerror = () => reject();
    });
  }

  _dbHasFolders = async () => {
    const db = await this._openDB();

    return new Promise((resolve, reject) => {
      const request = db.transaction(this.FOLDERS_STORE_NAME, 'readonly')
        .objectStore(this.FOLDERS_STORE_NAME)
        .count();

      request.onsuccess = () => resolve(request.result > 0);
      request.onerror = () => reject();
    });
  }

  /**
   * Check whether the virtual filesystem is empty.
   */
  isEmpty = async () => {
    const hasFiles = await this._dbHasFiles();
    const hasFolders = await this._dbHasFolders();
    return !hasFiles && !hasFolders;
  }

  /**
   * Internal helper function to filter an object based on conditions, ignoring
   * the case of the values.
   *
   * @param {object} conditions - The conditions to filter on.
   */
  _whereIgnoreCase = (conditions) => (f) =>
    Object.entries(conditions).every(([k, v]) =>
      typeof f[k] === 'string' && typeof v === 'string'
        ? f[k].toLowerCase() === v.toLowerCase()
        : f[k] === v
    )

  /**
   * Find all files that match the given conditions.
   *
   * @example findFilesWhere({ name: 'foo' })
   *
   * @param {object} conditions - The conditions to filter on.
   * @returns {array} List of file objects matching the conditions.
   */
  findFilesWhere = async (conditions) => {
    const db = await this._openDB();

    return new Promise((resolve, reject) => {
      const request = db.transaction(this.FILES_STORE_NAME, 'readonly')
        .objectStore(this.FILES_STORE_NAME)
        .getAll();

      request.onsuccess = (event) => {
        const allFiles = event.target.result;
        const matchingFiles = allFiles.filter(this._whereIgnoreCase(conditions));
        resolve(matchingFiles);
      };

      request.onerror = (event) => reject(event.target.error);
    });
  }

  /**
   * Find a single file that match the given conditions.
   *
   * @example findFileWhere({ name: 'foo' })
   *
   * @param {object} conditions - The conditions to filter on.
   * @returns {object|null} The file object matching the conditions or null if
   * the file is not found.
   */
  findFileWhere = (conditions) => {
    const files = this.findFilesWhere(conditions);
    return files.length > 0 ? files[0] : null;
  }

  /**
   * Check whether either a folder or file exists with the given conditions.
   *
   * @example existsWhere({ name: 'foo' })
   *
   * @param {object} conditions - The conditions to filter on.
   * @param {object} [options] - Additional options.
   * @param {string|array} [options.ignoreIds] - List of ids to ignore.
   * @returns {boolean} True if a folder or file exists with the given
   * conditions, false otherwise.
   */
  existsWhere = (conditions, options = {}) => {
    if (!Array.isArray(options.ignoreIds)) {
      options.ignoreIds = [options.ignoreIds];
    }

    return this.findWhere(conditions)
      .filter((f) => !options.ignoreIds.includes(f.id))
      .length > 0;
  }

  /**
   * Find all folders that match the given conditions.
   *
   * @example findFoldersWhere({ name: 'foo' })
   *
   * @param {object} conditions - The conditions to filter on.
   * @returns {array} List of folder objects matching the conditions.
   */
  findFoldersWhere = (conditions) => {
    return Object.values(this.folders).filter(this._whereIgnoreCase(conditions))
  }

  /**
   * Find a single folders that match the given conditions.
   *
   * @example findFolderWhere({ name: 'foo' })
   *
   * @param {object} conditions - The conditions to filter on.
   * @returns {object|null} The folder object matching the conditions or null if
   * the folder is not found.
   */
  findFolderWhere = (conditions) => {
    const folders = this.findFoldersWhere(conditions);
    return folders.length > 0 ? folders[0] : null;
  }


  /**
   * Find a all files and folders that match the given conditions.
   *
   * @example findWhere({ name: 'foo' })
   *
   * @param {object} conditions - The conditions to filter on.
   * @returns {array} List of objects matching the conditions.
   */
  findWhere = (conditions) => {
    const files = this.findFilesWhere(conditions);
    const folders = this.findFoldersWhere(conditions);
    return [...files, ...folders];
  }

  /**
   * Find a file by its id.
   *
   * @param {string} id - The id of the file to find.
   */
  findFileById = (id) => this.files[id];

  /**
   * Find a folder by its id.
   *
   * @param {string} id - The id of the folder to find.
   */
  findFolderById = (id) => this.folders[id];

  /**
   * Find a file by its absolute path.
   *
   * @param {string} path - The absolute filepath.
   */
  findFileByPath = (path) =>
    Object.values(this.files).find((f) => f.path === path);

  /**
   * Find a folder by its absolute path.
   *
   * @param {string} path - The absolute folderpath.
   */
  findFolderByPath = (path) => {
    return Object.values(this.folders).find((f) => f.path === path);
  }

  /**
   * Get the absolute file path of a file.
   *
   * @param {string} fileId - The file id.
   * @returns {string} The absolute file path of the file.
   */
  getAbsoluteFilePath = (fileId) => {
    const file = this.findFileById(fileId);
    if (!file) return '';
    if (!file.parentId) return file.name;

    let folder = this.findFolderById(file.parentId);
    if (!folder) return file.name;
    let folderPath = this.getAbsoluteFolderPath(folder.id);
    let path = `${folderPath}/${file.name}`;

    return path;
  }

  /**
   * Get the absolute file path of a folder.
   *
   * @param {string} folderId - The folder id.
   * @returns {string} The absolute file path of the folder.
   */
  getAbsoluteFolderPath = (folderId) => {
    const folder = this.findFolderById(folderId);

    if (!folder) return '';
    if (!folder.parentId) return folder.name;

    let parentFolder = this.findFolderById(folder.parentId);
    let path = folder.name;

    while (parentFolder) {
      path = `${parentFolder.name}/${path}`;
      parentFolder = this.findFolderById(parentFolder.parentId);
    }

    return path;
  }

  /**
   * Create a new file in the virtual filesystem.
   *
   * @param {object} fileObj - The file object to create.
   * @param {boolean} [isUserInvoked] - Whether to user invoked the action.
   * @returns {object} The new file object.
   */
  createFile = async (fileObj, isUserInvoked = true) => {
    const newFile = {
      id: uuidv4(),
      name: 'Untitled',
      parentId: null,
      content: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...fileObj,
    };

    // Ensure a unique file name.
    while (this.existsWhere({ parentId: newFile.parentId, name: newFile.name })) {
      newFile.name = this._incrementString(newFile.name);
    }

    await this._dbCreateFile(newFile);

    this.files[newFile.id] = newFile;
    newFile.path = this.getAbsoluteFilePath(newFile.id);

    if (isUserInvoked) {
      this.dispatchEvent(new CustomEvent('fileCreated', {
        detail: { file: newFile },
      }));
    }

    return newFile;
  }

  /**
   * Create a new file in the IndexedDB.
   *
   * @async
   * @param {object} file - The file object to create.
   * @returns {Promise<void>} Resolves when the file is created.
   */
  _dbCreateFile = async (file) => {
    const db = await this._openDB();

    return new Promise((resolve, reject) => {
      const request = db
        .transaction(this.FILES_STORE_NAME, 'readwrite')
        .objectStore(this.FILES_STORE_NAME)
        .put(file, file.id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject();
    });
  }

  /**
   * Create a new folder in the virtual filesystem.
   *
   * @param {object} folderObj - The folder object to create.
   * @param {boolean} [isUserInvoked] - Whether to user invoked the action.
   * @returns {object} The new folder object.
   */
  createFolder = async (folderObj, isUserInvoked = true) => {
    const newFolder = {
      id: uuidv4(),
      name: 'Untitled',
      parentId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...folderObj,
    };

    // Ensure the folder name is unique.
    while (this.existsWhere({ parentId: newFolder.parentId, name: newFolder.name })) {
      newFolder.name = this._incrementString(newFolder.name);
    }

    await this._dbCreateFolder(newFolder);

    this.folders[newFolder.id] = newFolder;
    newFolder.path = this.getAbsoluteFolderPath(newFolder.id);

    if (isUserInvoked) {
      this.dispatchEvent(new CustomEvent('folderCreated', {
        detail: { folder: newFolder },
      }));
    }

    return newFolder;
  }

  /**
   * Create a new folder in the IndexedDB.
   *
   * @async
   * @param {object} folder - The folder object to create.
   * @returns {Promise<void>} Resolves when the folder is created.
   */
  _dbCreateFolder = async (folder) => {
    const db = await this._openDB();

    return new Promise((resolve, reject) => {
      const request = db
        .transaction(this.FOLDERS_STORE_NAME, 'readwrite')
        .objectStore(this.FOLDERS_STORE_NAME)
        .put(folder, folder.id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject();
    });
  }

  /**
   * Update a file in the virtual filesystem.
   *
   * @param {string} id - The file id.
   * @param {object} values - Key-value pairs to update in the file object.
   * @param {boolean} [isUserInvoked] - Whether to user invoked the action.
   * @returns {object} The updated file object.
   */
  updateFile = async (id, values, isUserInvoked = true) => {
    const file = this.findFileById(id);
    if (!file) return;

    const oldPath = file.path;

    // These extra checks is needed because in the UI, the user can trigger a
    // rename but not actually change the name.
    const isRenamed = typeof values.name === 'string' && file.name !== values.name;
    const isMoved = typeof values.parentId !== 'undefined' && file.parentId !== values.parentId;
    const isContentChanged = typeof values.content === 'string' && file.content !== values.content;

    if (isRenamed || isMoved) {
      this.dispatchEvent(new CustomEvent('beforeFileMoved', {
        detail: { file, values },
      }));
    }

    for (const [key, value] of Object.entries(values)) {
      if (file.hasOwnProperty(key) && key !== 'id') {
        file[key] = value;
      }
    }

    file.path = this.getAbsoluteFilePath(file.id);
    file.updatedAt = new Date().toISOString();

    if (isRenamed || isMoved) {
      // Move the file to the new location.
      this.dispatchEvent(new CustomEvent('fileMoved', {
        detail: { file, oldPath },
      }));
    }

    if (isContentChanged && isUserInvoked) {
      this.dispatchEvent(new CustomEvent('fileContentChanged', {
        detail: { file },
      }));
    }


    return file;
  }

  /**
   * Update a folder in the virtual filesystem.
   *
   * @param {string} id - The folder id.
   * @param {object} values - Key-value pairs to update in the folder object.
   * @returns {object} The updated folder object.
   */
   updateFolder = async (id, values) => {
    const folder = this.findFolderById(id);
    if (!folder) return;

    const oldPath = folder.path;

    // This extra check is needed because in the UI, the user can trigger a
    // rename but not actually change the name.
    const isRenamed = typeof values.name === 'string' && folder.name !== values.name;
    const isMoved = typeof values.parentId !== 'undefined' && folder.parentId !== values.parentId;

    if (isRenamed || isMoved) {
      this.dispatchEvent(new CustomEvent('beforeFolderMoved', {
        detail: { folder, values },
      }));
    }

    for (const [key, value] of Object.entries(values)) {
      if (folder.hasOwnProperty(key) && key !== 'id') {
        folder[key] = value;
      }
    }

    folder.path = this.getAbsoluteFolderPath(folder.id);
    folder.updatedAt = new Date().toISOString();

    // Update all nested files and folders recursively with the new path.
    this._updateFolderSubPaths(id);
    console.log('oldPath', oldPath, 'newPath', folder.path);

    if (isRenamed || isMoved) {
      this.dispatchEvent(new CustomEvent('folderMoved', {
        detail: { folder, oldPath },
      }));
    }


    return folder;
  }

  /**
   * Delete a file from the virtual filesystem.
   *
   * @param {string} id - The file id.
   * @param {boolean} [isSingleFileDelete] - whether this function is called for
   * a single file or is called from the `deleteFolder` function.
   * @returns {boolean} True if deleted successfully, false otherwise.
   */
  deleteFile = (id, isSingleFileDelete = true) => {
    const file = this.findFileById(id);
    if (file) {
      this.dispatchEvent(new CustomEvent('beforeFileDeleted', {
        detail: { file, isSingleFileDelete },
      }));

      delete this.files[id];
      return true;
    }

    return false;
  }

  /**
   * Delete a folder from the VFS, including nested files and folders.
   *
   * The isRootFolder parameter will only be true on the first call because the
   * LFS will delete the folder with all of its children at once. Therefore, all
   * subsequent calls will have it set to false, because we don't want to remove
   * the those nested files by ourselves.
   *
   * @param {string} id - The folder id.
   * @param {boolean} [isRootFolder] - Whether it is the root folder.
   * @returns {boolean} True if deleted successfully, false otherwise.
   */
  deleteFolder = (id, isRootFolder = true) => {
    // Delete all the files inside the current folder.
    const files = this.findFilesWhere({ parentId: id });
    for (const file of files) {
      this.deleteFile(file.id, false);
    }

    // Delete all the nested folders inside the current folder.
    const folders = this.findFoldersWhere({ parentId: id });
    for (const folder of folders) {
      this.deleteFolder(folder.id, false);
    }

    if (this.folders[id]) {
      this.dispatchEvent(new CustomEvent('beforeFolderDeleted', {
        detail: { folder: this.folders[id], isRootFolder },
      }));

      delete this.folders[id];
      return true;
    }

    return false;
  }

  /**
   * Download a file through the browser by creating a new blob and trigger a
   * download by creating a new temporary anchor element.
   *
   * @param {string} id - The file id.
   */
  downloadFile = (id) => {
    const file = this.findFileById(id);
    if (!file) return;

    const fileBlob = new Blob(
      [addNewLineCharacter(file.content)],
      { type: 'text/plain;charset=utf-8' }
    );
    saveAs(fileBlob, file.name);
  }

  /**
   * Internal helper function to recursively add files to a zip object.
   *
   * @param {JSZip} zip - The JSZip object to add files to.
   * @param {string} folderId - The folder id to add files from.
   */
  _addFilesToZipRecursively = (zip, folderId) => {
    // Put all direct files into the zip file.
    const files = this.findFilesWhere({ parentId: folderId });
    for (const file of files) {
      zip.file(file.name, addNewLineCharacter(file.content));
    }

    // Get all the nested folders and files.
    const nestedFolders = this.findFoldersWhere({ parentId: folderId });
    for (const nestedFolder of nestedFolders) {
      const folderZip = zip.folder(nestedFolder.name);
      this._addFilesToZipRecursively(folderZip, nestedFolder.id);
    }
  }

  /**
   * Download a folder as a zip file. This includes all files in the folder as
   * well as all the nested folders.
   *
   * @param {string} id - The folder id.
   */
  downloadFolder = (id) => {
    const folder = this.findFolderById(id);
    if (!folder) return;

    const zip = new JSZip();
    const rootFolderZip = zip.folder(folder.name);

    this._addFilesToZipRecursively(rootFolderZip, folder.id);

    zip.generateAsync({ type: 'blob' }).then((content) => {
      saveAs(content, `${folder.name}.zip`);
    });
  }

  /**
   * Update the nested paths of all files and folders inside a folder.
   *
   * @param {string} folderId - The folder id to update.
   */
  _updateFolderSubPaths = (folderId) => {
    // Update all files in the folder.
    const files = this.findFilesWhere({ parentId: folderId });
    for (const file of files) {
      file.path = this.getAbsoluteFilePath(file.id);
    }

    // Update all nested folders recursively.
    const folders = this.findFoldersWhere({ parentId: folderId });
    for (const folder of folders) {
      folder.path = this.getAbsoluteFolderPath(folder.id);
      this._updateNestedPaths(folder.id);
    }
  }
}
