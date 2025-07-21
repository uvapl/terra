////////////////////////////////////////////////////////////////////////////////
// This file contains the virtual filesystem logic for the IDE app.
////////////////////////////////////////////////////////////////////////////////

import { getPartsFromPath, seconds } from './helpers/shared.js';
import Terra from './terra.js';
import fileTreeManager from './file-tree-manager.js';
import idbManager from './idb.js';

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
   * List of paths that should be ignored when traversing the filesystem.
   * @type {string[]}
   */
  blacklistedPaths = [
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

  constructor() {
    super();

    this._watchRootFolder();
  }

  /**
   * Retrieve the root handle from OPFS/LFS, depending on which one is active.
   *
   * NOTE: Since caching the OPFS root handle becomes stale rather quickly in
   * Chrome/Safari, the root handle is explicitly requested each time an
   * operation is performed on the VFS in general.
   *
   * @returns {Promise<FileSystemDirectoryHandle>} The root handle.
   */
  getRootHandle = () => {
    if (Terra.app.hasLFSProjectLoaded) {
      return this._getRootHandleFromLFS();
    }

    return this._getRootHandleFromOPFS();
  }

  /**
   * Retrieve the root handle from the OPFS.
   *
   * @returns {Promise<FileSystemDirectoryHandle>} The OPFS root handle.
   */
  _getRootHandleFromOPFS = () => navigator.storage.getDirectory();

  /**
   * Retrieves the LFS root directory handle from the IndexedDB store.
   *
   * @async
   * @returns {Promise<FileSystemDirectoryHandle>} The LFS root folder handle.
   */
  _getRootHandleFromLFS = async () => {
    const rootFolderHandle = await idbManager.getHandle('lfs', 'root');
    if (!rootFolderHandle) {
      throw new Error('LFS root folder handle not found');
    }

    const hasPermission = await this._verifyLFSHandlePermission(rootFolderHandle);
    if (!hasPermission) {
      // If we have no permission, clear VFS and the indexedDB stores.
      await this.clear();
      await idbManager.clearStores();
      await fileTreeManager.createFileTree(); // show empty file tree
      return;
    }

    return rootFolderHandle;
  }

  /**
   * Request permission for a given LFS handle, either file or directory handle.
   *
   * @param {FileSystemDirectoryHandle|FileSystemFileHandle} handle
   * @param {string} [mode] - The mode to request permission for.
   * @returns {Promise<boolean>} True if permission is granted, false otherwise.
   */
  _verifyLFSHandlePermission = (handle, mode = 'readwrite') => {
    const opts = { mode };

    return new Promise(async (resolve) => {
      // Check if we already have permission.
      if ((await handle.queryPermission(opts)) === 'granted') {
        return resolve(true);
      }

      // Otherwise, request permission to the handle.
      if ((await handle.requestPermission(opts)) === 'granted') {
        return resolve(true);
      }

      // The user did not grant permission.
      return resolve(false);
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
      return string.replace(/\((\d+)\)$/, `(${num})`);;
    }

    return `${string} (1)`;
  }

  /**
   * Clear the virtual filesystem, removing all files and folders permanently.
   *
   * @returns {Promise<void>} Resolves when the root handle is cleared.
   */
  clear = async () => {
    const rootHandle = await this.getRootHandle();

    // To date, the 'remove' function is only available in Chromium-based
    // browsers. For other browsers, we iteratore through the first level of
    // files and folders and delete them one by one.
    if ('remove' in FileSystemDirectoryHandle.prototype) {
      await rootHandle.remove({ recursive: true });
    } else {
      // Fallback for non-Chromium browsers.
      for await (const name of rootHandle.keys()) {
        await rootHandle.removeEntry(name, { recursive: true });
      }
    }
  }

  /**
   * Polling function to watch the root folder for changes. As long as Chrome's
   * LocalFilesystemAPI does not have event listeners built-in, we have no other
   * choice to poll the root folder for changes manually.
   *
   * Polling only applies to local storage and LFS mode, but not when connected
   * to a GitHub repository.
   *
   * Note that this does clear rebuild the VFS and visual file tree every
   * few seconds, which---besides not being efficient---also creates new
   * file/folder IDs every time. It's not a problem, but just something to be
   * aware of.
   */
  _watchRootFolder = () => {
    if (this._watchRootFolderInterval) {
      clearInterval(this._watchRootFolderInterval);
    }

    this._watchRootFolderInterval = setInterval(async () => {
      if (Terra.v.blockFSPolling || Terra.app.hasGitFSWorker()) return;

      // Import again from the VFS.
      await fileTreeManager.runFuncWithPersistedState(
        () => fileTreeManager.createFileTree()
      );

    }, seconds(5));
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
    const rootHandle = await this.getRootHandle();

    if (!folderpath) return rootHandle;

    let handle = rootHandle;
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
   * Get the size of a file by its absolute path.
   *
   * @async
   * @param {string} filepath - The absoluten file path.
   * @returns {Promise<number>} The file size in bytes.
   */
  getFileSizeByPath = async (filepath) => {
    const fileHandle = await this.getFileHandleByPath(filepath);
    if (!fileHandle) return 0;
    const file = await fileHandle.getFile();
    return file.size;
  }

  /**
   * Get all folder handles inside a given folder path (NOT recursive).
   *
   * @async
   * @param {string} folderpath - The absolute folder path to search in.
   * @returns {Promise<FileSystemDirectoryHandle[]>} Array of folder handles.
   */
  findFoldersInFolder = async (folderpath) => {
    // Obtain the folder handle recursively.
    const folderHandle = await this.getFolderHandleByPath(folderpath);

    // Gather all subfolder handles.
    const subfolders = [];
    for await (let handle of folderHandle.values()) {
      if (handle.kind === 'directory' && !this.blacklistedPaths.includes(handle.name)) {
        subfolders.push(handle);
      }
    }

    return subfolders;
  }

  /**
   * Get all file handles inside a given path (NOT recursive).
   *
   * @async
   * @param {string} folderpath - The absolute folder path to search in.
   * @returns {Promise<FileSystemFileHandle[]>} Array of file handles.
   */
  findFilesInFolder = async (folderpath) => {
    // Obtain the folder handle recursively.
    const folderHandle = await this.getFolderHandleByPath(folderpath);

    // Gather all subfile handles.
    const subfiles = [];
    for await (let handle of folderHandle.values()) {
      if (handle.kind === 'file' && !this.blacklistedPaths.includes(handle.name)) {
        subfiles.push(handle);
      }
    }

    return subfiles;
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
    const { path, content } = fileObj;

    const parts = path ? path.split('/') : [];
    let name = path ? parts.pop() : 'Untitled';
    const parentPath = parts.join('/');

    let parentFolderHandle = parentPath
      ? await this.getFolderHandleByPath(parentPath)
      : await this.getRootHandle();

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
      const filepath = parentPath ? `${parentPath}/${name}` : name;
      this.dispatchEvent(new CustomEvent('fileCreated', {
        detail: {
          file: { path: filepath, content }
        },
      }));
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
    const rootHandle = await this.getRootHandle();

    let parentFolderHandle = rootHandle;
    if (typeof parentFolder === 'string') {
      parentFolderHandle = await this.getFolderHandleByPath(parentFolder);
    } else if (parentFolder instanceof FileSystemDirectoryHandle) {
      parentFolderHandle = parentFolder;
    }

    if (!parentFolderHandle) {
      parentFolderHandle = rootHandle;
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
      : await this.getRootHandle();

    // Ensure a unique folder name.
    while ((await this.pathExists(name, parentFolderHandle))) {
      name = this._incrementString(name);
    }

    const newFolderHandle = await parentFolderHandle.getDirectoryHandle(name, { create: true });

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

    if (isUserInvoked) {
      this.dispatchEvent(new CustomEvent('fileContentChanged', {
        detail: {
          file: { path, content }
        },
      }));
    }

    return fileHandle;
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
    const srcFileContent = await this.getFileContentByPath(srcPath);

    // Create the file in the new destination path.
    const newFileHandle = await this.createFile({
      path: destPath,
      content: srcFileContent,
    }, false);

    // Delete the old file.
    await this.deleteFile(srcPath, false);

    this.dispatchEvent(new CustomEvent('fileMoved', {
      detail: {
        oldPath: srcPath,
        file: {
          path: destPath,
          content: srcFileContent,
        }
      },
    }));

    return newFileHandle;
  }

  /**
   * Update a folder in the virtual filesystem.
   *
   * Move folder2 from folder1 to folder3
   * @example moveFolder('folder1/folder2', 'folder3/folder2')
   *
   * @param {string} srcPath - The absolute path of the source folder.
   * @param {string} destPath - The absolute path where the source folder should
   * be moved to.
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
  }

  /**
   * Delete a file.
   *
   * @param {string} id - The path of the file to delete.
   * @param {boolean} [isSingleFileDelete] - whether this function is called for
   * a single file or is called from the `deleteFolder` function.
   * @returns {boolean} True if deleted successfully, false otherwise.
   */
  deleteFile = async (path, isUserInvoked = true) => {
    if (!(await this.pathExists(path))) {
      return false;
    }

    const parts = path.split('/');
    const filename = parts.pop();
    const parentPath = parts.join('/');
    const parentHandle = await this.getFolderHandleByPath(parentPath);
    await parentHandle.removeEntry(filename);

    if (isUserInvoked) {
      this.dispatchEvent(new CustomEvent('fileDeleted', {
        detail: {
          file: { path },
        },
      }));
    }

    return true;
  }

  /**
   * Delete a folder recursively from the VFS.
   *
   * @param {string} path - The folder path to delete.
   * @returns {boolean} True if deleted successfully, false otherwise.
   */
  deleteFolder = async (path) => {
    const rootHandle = await this.getRootHandle();

    if (!(await this.pathExists(path, rootHandle))) {
      return false;
    }

    // Gather all subfiles and trigger a deleteFile on them.
    const files = await this.findFilesInFolder(path);
    for (const file of files) {
      const filepath = `${path}/${file.name}`;
      await this.deleteFile(filepath, true);
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
