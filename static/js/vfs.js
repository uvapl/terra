////////////////////////////////////////////////////////////////////////////////
// This file contains the virtual filesystem logic for the IDE app.
////////////////////////////////////////////////////////////////////////////////

import { hasGitFSWorker, getPartsFromPath } from './helpers/shared.js';
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
   * The OPFS root handle.
   * @type {FileSystemDirectoryHandle}
   */
  rootHandle;

  constructor() {
    super();
    this.loadRootHandle();
  }

  /**
   * Wait for the OPFS root folder handle to be available.
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
   * Clear the virtual filesystem, removing all files and folders permanently.
   *
   * @returns {Promise<void>} Resolves when the root handle is cleared.
   */
  clear = async () => {
    await this.ready();

    // To date, the 'remove' function is only available in Chromium-based
    // browsers. For other browsers, we iteratore through the first level of
    // files and folders and delete them one by one.
    if ('remove' in FileSystemDirectoryHandle.prototype) {
      await this.rootHandle.remove({ recursive: true });
    } else {
      // Fallback for non-Chromium browsers.
      for await (const name of this.rootHandle.keys()) {
        await this.rootHandle.removeEntry(name, { recursive: true });
      }
    }
  }

  /**
   * Check whether the virtual filesystem is empty.
   *
   * @async
   * @returns {Promise<boolean>} True if VFS is empty, false otherwise.
   */
  isEmpty = async () => {
    // Get the root folders and files.
    const files = await this.findFilesInFolder();
    const folders = await this.findFoldersInFolder();

    return files.length === 0 && folders.length === 0;
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
   * The example below returns the handle for folder3.
   * @example getFolderHandleByPath('folder1/folder2/folder3')
   *
   * The examples below return the root handle.
   * @example getFolderHandleByPath('')
   * @example getFolderHandleByPath()
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
      handle = await handle.getDirectoryHandle(parts.shift(), { create: true });
    }

    return handle;
  }

  /**
   * Get a file handle by its absolute path.
   *
   * The example below returns the handle for `myfile.txt`.
   * @example getFolderHandleByPath('folder1/folder2/myfile.txt')
   *
   * @async
   * @param {string} filepath - The absolute file path.
   * @returns {Promise<FileSystemFileHandle|null>} The file handle if it exists.
   */
  getFileHandleByPath = async (filepath) => {
    await this.ready();

    if (!(await this.pathExists(filepath))) {
      return null;
    }

    const { name, parentPath } = getPartsFromPath(filepath);

    // Get the parent folder's handle.
    let parentFolderHandle = await this.getFolderHandleByPath(parentPath);

    // Get the file handle through its parent folder handle.
    const fileHandle = await parentFolderHandle.getFileHandle(name, { create: false });

    return fileHandle;
  }

  /**
   * Obtain the content of a file by its absolute path.
   *
   * @async
   * @param {string} filepath - The absolute file path.
   * @returns {Promise<string>} The file content.
   */
  getFileContentByPath = async (filepath) => {
    const fileHandle = await this.getFileHandleByPath(filepath);
    const file = await fileHandle.getFile();
    const content = await file.text();
    return content;
  }

  /**
   * Get all folder handles inside a given folder path.
   *
   * @async
   * @param {string} folderpath - The absolute folder path to search in.
   * @returns {Promise<FileSystemDirectoryHandle[]>} Array of folder handles.
   */
  findFoldersInFolder = async (folderpath) => {
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
  findFilesInFolder = async (folderpath) => {
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
   * Create a new file.
   *
   * @param {object} fileObj - The file object to create.
   * @param {string} [fileObj.path] - The name of the file. Leave empty to
   * create a new Untitled file in the root directory.
   * @param {string} [fileObj.content] - The content of the file.
   * @param {boolean} [isUserInvoked] - Whether to user invoked the action.
   * @returns {FileSystemFileHandle} The new file handle.
   */
  createFile = async (fileObj, isUserInvoked = true) => {
    await this.ready();

    const { path, content } = fileObj;

    const parts = path ? path.split('/') : [];
    let name = path ? parts.pop() : 'Untitled';
    const parentPath = parts.join('/');

    let parentFolderHandle = parentPath
      ? await this.getFolderHandleByPath(parentPath)
      : this.rootHandle;

    // Ensure a unique file name.
    while ((await this.pathExists(name, parentFolderHandle))) {
      name = this._incrementString(name);
    }

    const newFileHandle = await parentFolderHandle.getFileHandle(name, { create: true });

    if (content) {
      const writable = await newFileHandle.createWritable();
      await writable.write(content);
      await writable.close();
    }

    if (isUserInvoked) {
      // TODO: migrate this.
      // this.dispatchEvent(new CustomEvent('fileCreated', {
      //   detail: { file: newFileHandle },
      // }));
    }

    return newFileHandle;
  }

  /**
   * Check if a given path exists, either as a file or a folder.
   *
   * @async
   * @param {string} path - The path to check.
   * @param {string|FileSystemDirectoryHandle} [parentFolder] - Check whether
   * the path exists in this folder. Defaults to the root folder handle. Either
   * the absolute folder path or a FileSystemDirectoryHandle can be provided.
   * @returns {Promise<boolean>} True if the path exists, false otherwise.
   */
  pathExists = async (path, parentFolder = null) => {
    await this.ready();

    let parentFolderHandle = this.rootHandle;
    if (typeof parentFolder === 'string') {
      parentFolderHandle = await this.getFolderHandleByPath(parentFolder);
    } else if (parentFolder instanceof FileSystemDirectoryHandle) {
      parentFolderHandle = parentFolder;
    }

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
    for await (let name of currentHandle.keys()) {
      if (name === last) {
        // If the entry exists, return true.
        return true;
      }
    }

    // If we reach here, the entry does not exist.
    return false;
  }

  /**
   * Create a new folder.
   *
   * @param {object} folderpath - The path where the new folder will be created.
   * Leave empty to create a new Untitled folder in the root directory.
   * @param {boolean} [isUserInvoked] - Whether to user invoked the action.
   * @returns {FileSystemDirectoryHandle} The new folder handle.
   */
  createFolder = async (folderpath, isUserInvoked = true) => {
    const parts = folderpath ? folderpath.split('/') : [];
    let name = folderpath ? parts.pop() : 'Untitled';
    const parentPath = parts.join('/');

    let parentFolderHandle = parentPath
      ? await this.getFolderHandleByPath(parentPath)
      : this.rootHandle;

    // Ensure a unique folder name.
    while ((await this.pathExists(name, parentFolderHandle))) {
      name = this._incrementString(name);
    }

    const newFolderHandle = await parentFolderHandle.getDirectoryHandle(name, { create: true });

    if (isUserInvoked) {
      // TODO: migrate this.
      // this.dispatchEvent(new CustomEvent('folderCreated', {
      //   detail: { folder: newFolderHandle },
      // }));
    }

    return newFolderHandle;
  }

  /**
   * Update a file in the virtual filesystem.
   *
   * @param {string} path - The file path.
   * @param {object} content - The new content of the file.
   * @param {boolean} [isUserInvoked] - Whether to user invoked the action.
   * @returns {FileSystemFileHandle} The updated file handle.
   */
  updateFileContent = async (path, content, isUserInvoked = true) => {
    const fileHandle = await this.getFileHandleByPath(path);
    if (!fileHandle) return;

    if (content) {
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
    }

    return fileHandle;

    // TODO: migrate this.
    // if (isUserInvoked) {
    //   this.dispatchEvent(new CustomEvent('fileContentChanged', {
    //     detail: { file: fileHandle },
    //   }));
    // }
  }

  /**
   * Move a file from a source path to a destination path.
   *
   * @example moveFile('folder1/myfile.txt', 'folder2/myfile.txt')
   *
   * @async
   * @param {string} srcPath - The source path of the file to move.
   * @param {string} destPath - The destination path where the file should be moved to.
   * @returns {Promise<FileSystemFileHandle>} The new file handle at the destination path.
   */
  moveFile = async (srcPath, destPath) => {
    await this.ready();

    const srcFileContent = await this.getFileContentByPath(srcPath);

    // Create the file in the new destination path.
    const newFileHandle = await this.createFile({
      path: destPath,
      content: srcFileContent,
    });

    // Delete the old file.
    await this.deleteFile(srcPath);

    return newFileHandle;
  }

  /**
   * Update a folder in the virtual filesystem.
   *
   * Move folder2 from folder1 to folder3
   * @example moveFolder('folder1/folder2', 'folder3/folder2')
   *
   * @param {string} srcPath - The absolute path of the source folder.
   * @param {string} destPath - The absolute path where the source folder should be moved to.
   * @returns {Promise<FileSystemDirectoryHandle>} The new folder handle at the destination path.
   */
  moveFolder = async (srcPath, destPath) => {
    // Move all files inside the folder to the new destination path.
    const files = await this.findFilesInFolder(srcPath);
    for (const file of files) {
      const filePath = `${srcPath}/${file.name}`;
      const newFilePath = destPath ? `${destPath}/${file.name}` : file.name;
      await this.moveFile(filePath, newFilePath);
    }

    const folders = await this.findFoldersInFolder(srcPath);
    for (const folder of folders) {
      const folderPath = `${srcPath}/${folder.name}`;
      const newFolderPath = destPath ? `${destPath}/${folder.name}` : folder.name;
      await this.moveFolder(folderPath, newFolderPath);
    }

    // Delete source folder recursively.
    await this.deleteFolder(srcPath);

    // Get the new folder handle at the destination path.
    const newFolderHandle = await this.getFolderHandleByPath(destPath);

    // TODO: migrate this.
    // this.dispatchEvent(new CustomEvent('folderMoved', {
    //   detail: { folder, oldPath },
    // }));

    return newFolderHandle;
  }

  /**
   * Delete a file.
   *
   * @param {string} id - The path of the file to delete.
   * @param {boolean} [isSingleFileDelete] - whether this function is called for
   * a single file or is called from the `deleteFolder` function.
   * @returns {boolean} True if deleted successfully, false otherwise.
   */
  deleteFile = async (path, isSingleFileDelete = true) => {
    await this.ready();

    if (!(await this.pathExists(path))) {
      return false;
    }

    // TODO: migrate this.
    // this.dispatchEvent(new CustomEvent('beforeFileDeleted', {
    //   detail: { file, isSingleFileDelete },
    // }));

    const parts = path.split('/');
    const filename = parts.pop();
    const parentPath = parts.join('/');
    const parentHandle = await this.getFolderHandleByPath(parentPath);
    await parentHandle.removeEntry(filename);
    return true;
  }

  /**
   * Delete a folder from the VFS, including nested files and folders.
   *
   * The isRootFolder parameter will only be true on the first call because the
   * LFS will delete the folder with all of its children at once. Therefore, all
   * subsequent calls will have it set to false, because we don't want to remove
   * the those nested files by ourselves.
   *
   * @param {string} path - The folder path to delete.
   * @param {boolean} [isRootFolder] - Whether it is the root folder.
   * @returns {boolean} True if deleted successfully, false otherwise.
   */
  deleteFolder = async (path, isRootFolder = true) => {
    if (!(await this.pathExists(path, this.rootHandle))) {
      return false;
    }

    // TODO: migrate this.
    // this.dispatchEvent(new CustomEvent('beforeFolderDeleted', {
    //   detail: { folder: this.folders[id], isRootFolder },
    // }));

    // Gather all subfiles and trigger a deleteFile on them.
    const files = await this.findFilesInFolder(path);
    for (const file of files) {
      const filepath = `${path}/${file.name}`;
      await this.deleteFile(filepath, false);
    }

    // Delete all the nested folders inside the current folder.
    const folders = await this.findFoldersInFolder(path);
    for (const folder of folders) {
      const folderpath = `${path}/${folder.name}`;
      await this.deleteFolder(folderpath, false);
    }

    // Finally, delete the folder itself from OPFS recursively.
    const parts = path.split('/');
    const foldername = parts.pop();
    const parentPath = parts.join('/');
    const parentFolderHandle = await this.getFolderHandleByPath(parentPath);
    await parentFolderHandle.removeEntry(foldername, { recursive: true });

    return true;
  }

  /**
   * Download a file through the browser by creating a new blob and using
   * FileSaver.js to save it.
   *
   * @param {string} path - The absolute file path.
   */
  downloadFile = async (path) => {
    const content = await this.getFileContentByPath(path);
    const { name } = getPartsFromPath(path);
    const fileBlob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    saveAs(fileBlob, name);
  }

  /**
   * Internal helper function to recursively add files to a zip object.
   *
   * @param {JSZip} zip - The JSZip object to add files to.
   * @param {string} folderpath - The absolute folder path to add files from.
   */
  _addFilesToZipRecursively = async (zip, folderpath) => {
    // Put all subfiles from this folder into the zip file.
    const subfiles = await this.findFilesInFolder(folderpath);
    for (const file of subfiles) {
      const content = await this.getFileContentByPath(`${folderpath}/${file.name}`);
      zip.file(file.name, content);
    }

    // Get all the nested folders and files.
    // const nestedFolders = this.findFoldersWhere({ parentId: folderpath });
    const subfolders = await this.findFoldersInFolder(folderpath);
    for (const folder of subfolders) {
      const folderZip = zip.folder(folder.name);
      await this._addFilesToZipRecursively(folderZip, `${folderpath}/${folder.name}`)
    }
  }

  /**
   * Download a folder as a zip file. This includes all files in the folder as
   * well as all the nested folders.
   *
   * @param {string} path - The absolute folder path.
   */
  downloadFolder = async (path) => {
    const { name } = getPartsFromPath(path);

    const zip = new JSZip();
    const rootFolderZip = zip.folder(name);

    await this._addFilesToZipRecursively(rootFolderZip, path);

    zip.generateAsync({ type: 'blob' }).then((content) => {
      saveAs(content, `${name}.zip`);
    });
  }
}
