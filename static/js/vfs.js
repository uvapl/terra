////////////////////////////////////////////////////////////////////////////////
// This file contains the virtual filesystem logic for the IDE app.
////////////////////////////////////////////////////////////////////////////////

class VirtualFileSystem {
  constructor() {
    this.files = {};
    this.folders = {};

    this.loadFromLocalStorage();
  }

  /**
   * Call a function on the git filesystem worker.
   *
   * @param {string} fn - Name of the function to call.
   * @param {array} payload - Arguments to pass to the function.
   */
  _git = (fn, ...payload) => {
    if (!hasGitFSWorker()) return;

    window._gitFS[fn](...payload);
  }

  /**
   * Call a function to the local filesystem class.
   *
   * @param {string} fn - Name of the function to call.
   * @param {array} payload - Arguments to pass to the function.
   * @returns {*} The return value of the function.
   */
  _lfs = (fn, ...payload) => {
    if (!hasLFS() || (hasLFS() && !LFS.loaded)) return;

    return LFS[fn](...payload);
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
    const savedState = getLocalStorageItem('vfs');
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
    let files = this.files;

    // Remove the content from all files when LFS is used, because the LFS uses
    // lazy loading. Furthermore, we never know how large files will be when
    // loaded from the user's LFS, thus we don't want to save these.
    if (isIDE && hasLFS() && LFS.loaded) {
      Object.keys(files).forEach((fileId) => {
        files[fileId] = {
          ...files[fileId],
          content: '',
        }
      });
    }

    setLocalStorageItem('vfs', JSON.stringify({
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
    Object.values(this.files)
    .find((f) => this.getAbsoluteFilePath(f.id) === path);

  /**
   * Find a folder by its absolute path.
   *
   * @param {string} path - The absolute folderpath.
   */
  findFolderByPath = (path) =>
    Object.values(this.folders)
    .find((f) => this.getAbsoluteFolderPath(f.id) === path);

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
   * @param {boolean} [userInvoked] - Whether to user invoked the action.
   * @returns {object} The new file object.
   */
  createFile = (fileObj, userInvoked = true) => {
    const newFile = {
      id: uuidv4(),
      name: 'Untitled',
      parentId: null,
      content: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...fileObj,
    };

    this.files[newFile.id] = newFile;

    if (userInvoked) {
      this._git('commit', this.getAbsoluteFilePath(newFile.id), newFile.content);
      this._lfs('writeFileToFolder', newFile.parentId, newFile.id, newFile.name, newFile.content);
    }

    this.saveState();
    return newFile;
  }

  /**
   * Create a new folder in the virtual filesystem.
   *
   * @param {object} folderObj - The folder object to create.
   * @param {boolean} [userInvoked] - Whether to user invoked the action.
   * @returns {object} The new folder object.
   */
  createFolder = (folderObj, userInvoked = true) => {
    const newFolder = {
      id: uuidv4(),
      name: 'Untitled',
      parentId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...folderObj,
    };

    this.folders[newFolder.id] = newFolder;

    if (userInvoked) {
      this._lfs('createFolder', newFolder.id, newFolder.parentId, newFolder.name);
    }

    this.saveState();
    return newFolder;
  }

  /**
   * Update a file in the virtual filesystem.
   *
   * @param {string} id - The file id.
   * @param {object} obj - Key-value pairs to update in the file object.
   * @param {boolean} [userInvoked] - Whether to user invoked the action.
   * @returns {object} The updated file object.
   */
  updateFile = async (id, obj, userInvoked = true) => {
    const file = this.findFileById(id);
    const oldPath = this.getAbsoluteFilePath(file.id);

    // These extra checks is needed because in the UI, the user can trigger a
    // rename but not actually change the name.
    const isRenamed = typeof obj.name === 'string' && file.name !== obj.name;
    const isMoved = typeof obj.parentId !== 'undefined' && file.parentId !== obj.parentId;
    const isContentChanged = typeof obj.content === 'string' && file.content !== obj.content;

    if (file) {
      // Move the file to the new location before updating the file object,
      // because the LFS.moveFile needs to use the absolute paths from VFS.
      if (isRenamed || isMoved) {
        await this._lfs(
          'moveFile',
          file.id,
          obj.name || file.name,
          typeof obj.parentId !== 'undefined' ? obj.parentId : file.parentId,
        );
      }

      for (const [key, value] of Object.entries(obj)) {
        if (file.hasOwnProperty(key) && key !== 'id') {
          file[key] = value;
        }
      }

      file.updatedAt = new Date().toISOString();

      const newPath = this.getAbsoluteFilePath(file.id);

      if (isRenamed || isMoved) {
        // Move the file to the new location.
        this._git('mv', oldPath, newPath);
      }


      if (isContentChanged && userInvoked) {
        // Just commit the changes to the file.
        this._git('commit', newPath, file.content);

        // Update the file content in the LFS after a second of inactivity.
        clearTimeout(window._lfsUpdateFileTimeoutId);
        window._lfsUpdateFileTimeoutId = setTimeout(() => {
          this._lfs('writeFileToFolder', file.parentId, file.id, file.name, file.content);
        }, seconds(1));
      }

      this.saveState();
    }

    return file;
  }

  /**
   * Update a folder in the virtual filesystem.
   *
   * @param {string} id - The folder id.
   * @param {object} obj - Key-value pairs to update in the folder object.
   * @returns {object} The updated folder object.
   */
   updateFolder = async (id, obj) => {
    const folder = this.findFolderById(id);
    const oldPath = this.getAbsoluteFolderPath(folder.id);

    // This extra check is needed because in the UI, the user can trigger a
    // rename but not actually change the name.
    const isRenamed = typeof obj.name === 'string' && folder.name !== obj.name;
    const isMoved = typeof obj.parentId !== 'undefined' && folder.parentId !== obj.parentId;

    if (folder) {
      // Move the folder to the new location before updating the folder object,
      // because the LFS.moveFolder needs to use the absolute paths from VFS.
      if (isRenamed || isMoved) {
        await this._lfs(
          'moveFolder',
          folder.id,
          obj.name || folder.name,
          typeof obj.parentId !== 'undefined' ? obj.parentId : folder.parentId,
        );
      }

      for (const [key, value] of Object.entries(obj)) {
        if (folder.hasOwnProperty(key) && key !== 'id') {
          folder[key] = value;
        }
      }

      folder.updatedAt = new Date().toISOString();

      const newPath = this.getAbsoluteFolderPath(folder.id);

      // Check whether the file is renamed or moved, in either case we
      // just need to move the file to the new location.
      if (isRenamed || isMoved) {
        this._git('mv', oldPath, newPath);
      }

      this.saveState();
    }

    return folder;
  }

  /**
   * Delete a file from the virtual filesystem.
   *
   * @param {string} id - The file id.
   * @param {boolean} [deleteInLFS] - Whether to delete the file in the LFS.
   * @returns {boolean} True if deleted successfully, false otherwise.
   */
  deleteFile = (id, deleteInLFS = true) => {
    if (this.files[id]) {
      this._git('rm', this.getAbsoluteFilePath(id));

      if (deleteInLFS) {
        this._lfs('deleteFile', id);
      }

      this._lfs('removeFileHandle', id);
      delete this.files[id];
      this.saveState();
      return true;
    }

    return false;
  }

  /**
   * Delete a folder from the virtual filesystem, including its nested files and
   * folders. The deleteInLFS parameter will only be true on the first call to
   * it. All subsequent calls will have it set to false, because the LFS uses
   * async and thus needs to wait for nested files and folders to be deleted
   * before deleting the parent folder itself.
   *
   * @param {string} id - The folder id.
   * @param {boolean} [deleteInLFS] - Whether to delete the folder in the LFS.
   * @returns {boolean} True if deleted successfully, false otherwise.
   */
  deleteFolder = (id, deleteInLFS = true) => {
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
      this._git('rm', this.getAbsoluteFolderPath(id));

      // The deleteInLFS is only true on the first call to this function.
      // Inside the LFS class we'll delete everything properly including the
      // root folder handle.
      if (deleteInLFS) {
        this._lfs('deleteFolder', id);
      } else {
        // If it's not the root folder, then delete the folder handle.
        this._lfs('removeFolderHandle', id);
      }

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
   * Import files and folders from a git repository into the virtual filesystem.
   *
   * A directory contains the path inside the `file.name`, e.g.
   *   { name: 'folder1/folder2/file.txt', content: '...' }
   * whereas a file solely contains the file name, e.g.:
   *   { name: 'file.txt', content: '...' }
   *
   * @param {array} repoFiles - List of files from the repository.
   */
  importFromGit = (repoFiles) => {
    // Remove all files from the virtual filesystem.
    this.clear();

    // Filter on all files and create them in the this.
    repoFiles
      .filter((fileOrFolder) => !fileOrFolder.name.includes('/'))
      .forEach((file) => this.createFile(file, false));

    // Filter on all folders and create them in the this.
    // Example: /folder1/folder2/file.txt
    repoFiles
      .filter((fileOrFolder) => fileOrFolder.name.includes('/'))
      .forEach((file) => {
        // Create all parent folders first.
        const parentDirs = file.name.split('/').slice(0, -1);
        let parentId = null;
        for (const dirname of parentDirs) {
          const currFolder = this.findFolderWhere({ name: dirname, parentId });
          if (!currFolder) {
            const newFolder = this.createFolder({
              name: dirname,
              parentId,
            });
            parentId = newFolder.id;
          } else {
            parentId = currFolder.id;
          }
        }

        // Create the file in the last folder.
        const filename = file.name.split('/').pop();
        this.createFile({
          ...file,
          name: filename,
          parentId,
        }, false);
      });
  }
}

const VFS = new VirtualFileSystem();
