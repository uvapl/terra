////////////////////////////////////////////////////////////////////////////////
// This file contains the virtual filesystem logic for the IDE app.
////////////////////////////////////////////////////////////////////////////////

import {
  addNewLineCharacter,
  hasGitFSWorker,
} from './helpers/shared.js';
import { IS_IDE } from './constants.js';
import Terra from './terra.js';
import localStorageManager from './local-storage-manager.js';

export default class VirtualFileSystem extends EventTarget {
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

  /**
   * The OPFS root handle that is saved in the IndexedDB.
   * @type {FileSystemDirectoryHandle}
   */
  rootHandle;

  constructor() {
    super();
    this.loadFromLocalStorage();
    this.loadRootHandle();
  }

  /**
   * Wait for the `this.rootHandle` to be available.
   *
   * @returns {Promise<void>} Resolves when the root handle is available.
   */
  ready = () => {
    return new Promise((resolve) => {
      const check = () => {
        if (this.rootHandle) {
          resolve();
        } else {
          // Check every 300ms if the root handle is available.
          setTimeout(check, 300);
        }
      };

      check();
    });
  }

  /**
   * Retrieve the root handle from OPFS.
   */
  loadRootHandle = () => {
    navigator.storage.getDirectory().then((rootHandle) => {
      this.rootHandle = rootHandle;
    });
  }

  /**
   * Get the root handle of the virtual filesystem.
   *
   * @returns {Promise<FileSystemDirectoryHandle>} A directory handle to the
   * root of the virtual filesystem, or undefined if the handle is not found.
   */
  getRootHandle = () => {
    return this._getHandle(this.STORE_NAME, 'root');
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
  clear = () => {
    this.files = {};
    this.folders = {};
    this.saveState();
  }

  /**
   * Check whether the virtual filesystem is empty.
   */
  isEmpty = () => Object.keys(this.files).length === 0 && Object.keys(this.folders).length === 0;

  /**
   * Load the saved virtual filesystem state from local storage.
   */
  loadFromLocalStorage = () => {
    const savedState = localStorageManager.getLocalStorageItem('vfs');
    if (typeof savedState === 'string') {
      const json = JSON.parse(savedState);

      for (const key of ['files', 'folders']) {
        if (json.hasOwnProperty(key)) {
          this[key] = json[key];
        }
      }
    }
  }

  /**
   * Save the virtual filesystem state to localstorage.
   */
  saveState = () => {
    let files = { ...this.files };

    // Remove the content from all files when LFS or Git is used, because LFS uses
    // lazy loading and GitFS is being cloned when refreshed anyway.
    if (IS_IDE && (Terra.app.hasLFSProjectLoaded || hasGitFSWorker())) {
      const keys = ['sha', 'content'];
      Object.keys(files).forEach((fileId) => {
        files[fileId] = { ...files[fileId] };
        keys.forEach((key) => {
          if (files[fileId].hasOwnProperty(key)) {
            delete files[fileId][key];
          }
        });
      });
    }

    localStorageManager.setLocalStorageItem('vfs', JSON.stringify({
      files,
      folders: this.folders,
    }));
  }

  /**
   * Get the root-level folders in the virtual filesystem.
   */
  getRootFolders = () => Object.values(this.folders).filter((folder) => !folder.parentId);

  /**
   * Get the root-level files in the virtual filesystem.
   */
  getRootFiles = () => Object.values(this.files).filter((file) => !file.parentId)

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
  findFilesWhere = (conditions) => {
    return Object.values(this.files).filter(this._whereIgnoreCase(conditions))
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
  findFolderByPath = (path) =>
    Object.values(this.folders).find((f) => f.path === path);

  /**
   * Get a folder handle by its absolute path.
   *
   * @async
  * @param {string} folderpath - The absolute folder path.
  * @returns {Promise<FileSystemDirectoryHandle>} The folder handle.
   */
  getFolderHandleByPath = async (folderpath) => {
    await this.ready();

    if (!folderpath) return this.rootHandle;

    let handle = this.rootHandle;
    const parts = folderpath.split('/');

    while (handle && parts.length > 0) {
      handle = await handle.getDirectoryHandle(parts.shift(), { create: false });
    }

    return handle;
  }

  /**
   * Get all folder handles inside a given folder path.
   *
   * @async
   * @param {string} folderpath - The absolute folder path to search in.
   * @returns {Promise<FileSystemDirectoryHandle[]>} Array of folder handles.
   */
  findFoldersByPath = async (folderpath) => {
    await this.ready();

    // Obtain the folder handle recursively.
    const folderHandle = await this.getFolderHandleByPath(folderpath);

    // Gather all subfolder handles.
    const subfolders = [];
    for await (let handle of folderHandle.values()) {
      if (handle.kind === 'directory') {
        subfolders.push(handle);
      }
    }

    return subfolders;
  }

  /**
   * Get all file handles inside a given path.
   *
   * @async
   * @param {string} folderpath - The absolute folder path to search in.
   * @returns {Promise<FileSystemFileHandle[]>} Array of file handles.
   */
  findFilesByPath = async (folderpath) => {
    await this.ready();

    // Obtain the folder handle recursively.
    const folderHandle = await this.getFolderHandleByPath(folderpath);

    // Gather all subfile handles.
    const subfiles = [];
    for await (let handle of folderHandle.values()) {
      if (handle.kind === 'file') {
        subfiles.push(handle);
      }
    }

    return subfiles;
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
   * @param {string} [fileObj.name] - The name of the file.
   * @param {string} [fileObj.content] - The content of the file.
   * @param {string} [fileObj.path] - Absolute folderpath to create the file in.
   * @param {boolean} [isUserInvoked] - Whether to user invoked the action.
   * @returns {FileSystemFileHandle} The new file handle.
   */
  createFile = async (fileObj, isUserInvoked = true) => {
    await this.ready();

    const newFile = {
      name: 'Untitled',
      content: '',
      ...fileObj,
    };

    let parentFolderHandle = fileObj.path
      ? await this.getFolderHandleByPath(fileObj.path)
      : this.rootHandle;

    // Ensure a unique file name.
    while ((await this.pathExists(newFile.name, parentFolderHandle))) {
      newFile.name = this._incrementString(newFile.name);
    }

    const newFileHandle = await parentFolderHandle.getFileHandle(newFile.name, { create: true });

    if (newFile.content) {
      const writable = newFileHandle.createWritable();
      await writable.write(newFile.content);
      await writable.close();
    }

    if (isUserInvoked) {
      this.dispatchEvent(new CustomEvent('fileCreated', {
        detail: { file: newFileHandle },
      }));
    }

    return newFileHandle;
  }

  pathExists = async (path, parentFolderHandle) => {
    if (!parentFolderHandle) {
      parentFolderHandle = this.rootHandle;
    }

    const parts = path.split('/');
    const last = parts.pop();

    // Check if the parent folders exist.
    let currentHandle = parentFolderHandle;
    for (const part of parts) {
      try {
        currentHandle = await currentHandle.getDirectoryHandle(part, { create: false });
      } catch {
        // If the handle does not exist, return false.
        return false;
      }
    }

    // At this point, we know the parent folder exists.
    // The last part of the path could be either file or folder, so we just
    // iterate over each entry and check if it exists.
    for await (let entry of currentHandle.values()) {
      if (entry.name === last) {
        // If the entry exists, return true.
        return true;
      }
    }

    // If we reach here, the entry does not exist.
    return false;
  }

  /**
   * Create a new folder in the virtual filesystem.
   *
   * @param {object} folderObj - The folder object to create.
   * @param {boolean} [isUserInvoked] - Whether to user invoked the action.
   * @returns {object} The new folder object.
   */
  createFolder = async (folderObj, isUserInvoked = true) => {
    let parentFolderHandle = folderObj.path
      ? await this.getFolderHandleByPath(folderObj.path)
      : this.rootHandle;

    // Ensure a unique folder name.
    let name = folderObj.name || 'Untitled';
    while ((await this.pathExists(name, parentFolderHandle))) {
      name = this._incrementString(name);
    }

    const newFolderHandle = await parentFolderHandle.getDirectoryHandle(name, { create: true });

    if (isUserInvoked) {
      this.dispatchEvent(new CustomEvent('folderCreated', {
        detail: { folder: newFolderHandle },
      }));
    }

    return newFolderHandle;
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

    this.saveState();

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

    if (isRenamed || isMoved) {
      this.dispatchEvent(new CustomEvent('folderMoved', {
        detail: { folder, oldPath },
      }));
    }

    this.saveState();

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
      this.saveState();
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
      this.saveState();
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
