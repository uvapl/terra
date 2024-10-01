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
  _git(fn, ...payload) {
    if (!hasGitFSWorker()) return;

    window._gitFS[fn](...payload);
  }

  /**
   * Call a function to the local filesystem class.
   *
   * @param {string} fn - Name of the function to call.
   * @param {array} payload - Arguments to pass to the function.
   */
  _lfs(fn, ...payload) {
    if (!(LFS instanceof LocalFileSystem)) return;

    LFS[fn](...payload);
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
    setLocalStorageItem('vfs', JSON.stringify({
      files: this.files,
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
   * Internal helper function to filter an object based on conditions
   *
   * @param {object} conditions - The conditions to filter on.
   */
  _where = (conditions) => (f) =>
    Object.entries(conditions).every(([k, v]) => f[k] === v)

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
   * @param {boolean} [ignoreCase] - Whether to search case-insensitive.
   * @returns {array} List of file objects matching the conditions.
   */
  findFilesWhere = (conditions, ignoreCase = false) => {
    const filterFn = ignoreCase ? this._whereIgnoreCase : this._where;
    return Object.values(this.files).filter(filterFn(conditions))
  }
  /**
   * Find a single file that match the given conditions.
   *
   * @example findFileWhere({ name: 'foo' })
   *
   * @param {object} conditions - The conditions to filter on.
   * @param {boolean} [ignoreCase] - Whether to search case-insensitive.
   * @returns {object|null} The file object matching the conditions or null if
   * the file is not found.
   */
  findFileWhere = (conditions, ignoreCase = false) => {
    const files = this.findFilesWhere(conditions, ignoreCase);
    return files.length > 0 ? files[0] : null;
  }

  /**
   * Check whether either a folder or file exists with the given conditions.
   *
   * @example existsWhere({ name: 'foo' })
   *
   * @param {object} conditions - The conditions to filter on.
   * @param {boolean} [ignoreCase] - Whether to search case-insensitive.
   * @returns {boolean} True if a folder or file exists with the given
   * conditions, false otherwise.
   */
  existsWhere = (conditions, ignoreCase = false) => {
    return this.findWhere(conditions, ignoreCase).length > 0;
  }

  /**
   * Find all folders that match the given conditions.
   *
   * @example findFoldersWhere({ name: 'foo' })
   *
   * @param {object} conditions - The conditions to filter on.
   * @param {boolean} [ignoreCase] - Whether to search case-insensitive.
   * @returns {array} List of folder objects matching the conditions.
   */
  findFoldersWhere = (conditions, ignoreCase = false) => {
    const filterFn = ignoreCase ? this._whereIgnoreCase : this._where;
    return Object.values(this.folders).filter(filterFn(conditions))
  }

  /**
   * Find a single folders that match the given conditions.
   *
   * @example findFolderWhere({ name: 'foo' })
   *
   * @param {object} conditions - The conditions to filter on.
   * @param {boolean} [ignoreCase] - Whether to search case-insensitive.
   * @returns {object|null} The folder object matching the conditions or null if
   * the folder is not found.
   */
  findFolderWhere = (conditions, ignoreCase) => {
    const folders = this.findFoldersWhere(conditions, ignoreCase);
    return folders.length > 0 ? folders[0] : null;
  }


  /**
   * Find a all files and folders that match the given conditions.
   *
   * @example findWhere({ name: 'foo' })
   *
   * @param {object} conditions - The conditions to filter on.
   * @param {boolean} [ignoreCase] - Whether to search case-insensitive.
   * @returns {array} List of objects matching the conditions.
   */
  findWhere = (conditions, ignoreCase = false) => {
    const files = this.findFilesWhere(conditions, ignoreCase);
    const folders = this.findFoldersWhere(conditions, ignoreCase);
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
    }

    this.saveState();
    return newFile;
  }

  /**
   * Create a new folder in the virtual filesystem.
   *
   * @param {object} folderObj - The folder object to create.
   * @returns {object} The new folder object.
   */
  createFolder = (folderObj) => {
    const newFolder = {
      id: uuidv4(),
      name: 'Untitled',
      parentId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...folderObj,
    };

    this.folders[newFolder.id] = newFolder;
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
  updateFile = (id, obj, userInvoked = true) => {
    const file = this.findFileById(id);

    // This extra check is needed because in the UI, the user can trigger a
    // rename but not actually change the name.
    const isRenamed = typeof obj.name === 'string' && file.name !== obj.name;
    const isMoved = file.parentId !== obj.parentId;
    const isContentChanged = typeof obj.content === 'string' && file.content !== obj.content;

    if (file) {
      for (const [key, value] of Object.entries(obj)) {
        if (file.hasOwnProperty(key) && key !== 'id') {

          // Check whether the file is renamed.
          if (key === 'name' && isRenamed || key === 'parentId' && isMoved) {
            const oldPath = this.getAbsoluteFilePath(file.id);
            file[key] = value;
            const newPath = this.getAbsoluteFilePath(file.id);

            // Move the file to the new location.
            this._git('mv', oldPath, newPath);

            continue;
          }

          file[key] = value;
        }
      }

      file.updatedAt = new Date().toISOString();

      if (isContentChanged && userInvoked) {
        // Just commit the changes to the file.
        this._git('commit', this.getAbsoluteFilePath(file.id), file.content);
      }


      // Update the file content in the LFS after a second of inactivity.
      clearTimeout(window._lfsUpdateFileTimeoutId);
      window._lfsUpdateFileTimeoutId = setTimeout(() => {
        this._lfs('writeFileToFolder', file.parentId, file.id, file.name, file.content);
      }, seconds(1));

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
  updateFolder = (id, obj) => {
    const folder = this.findFolderById(id);

    // This extra check is needed because in the UI, the user can trigger a
    // rename but not actually change the name.
    const isRenamed = typeof obj.name === 'string' && folder.name !== obj.name;
    const isMoved = folder.parentId !== obj.parentId;

    if (folder) {
      for (const [key, value] of Object.entries(obj)) {
        if (folder.hasOwnProperty(key) && key !== 'id') {

          // Check whether the folder is renamed.
          if (key === 'name' && isRenamed || key === 'parentId' && isMoved) {
            const oldPath = this.getAbsoluteFolderPath(folder.id);
            folder[key] = value;
            const newPath = this.getAbsoluteFolderPath(folder.id);

            // Move the folder to the new location.
            this._git('mv', oldPath, newPath);

            continue;
          }

          folder[key] = value;
        }
      }

      folder.updatedAt = new Date().toISOString();

      this.saveState();
    }

    return folder;
  }

  /**
   * Delete a file from the virtual filesystem.
   *
   * @param {string} id - The file id.
   * @returns {boolean} True if deleted successfully, false otherwise.
   */
  deleteFile = (id) => {
    if (this.files[id]) {
      this._git('rm', this.getAbsoluteFilePath(id));
      delete this.files[id];
      this.saveState();
      return true;
    }

    return false;
  }

  /**
   * Delete a folder from the virtual filesystem.
   *
   * @param {string} id - The folder id.
   * @returns {boolean} True if deleted successfully, false otherwise.
   */
  deleteFolder = (id) => {
    if (this.folders[id]) {
      this._git('rm', this.getAbsoluteFolderPath(id));
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
