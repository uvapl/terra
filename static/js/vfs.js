////////////////////////////////////////////////////////////////////////////////
// This file contains the virtual filesystem logic for the IDE app.
////////////////////////////////////////////////////////////////////////////////

class VirtualFileSystem {
  constructor() {
    this.files = {};
    this.folders = {};

    this.loadFromLocalStorage();
  }

  _git(fn, ...payload) {
    if (!hasGitFSWorker()) return;

    window._gitFS[fn](...payload);
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
   * Internal helper function to filter a list of object based on conditions.
   *
   * @param {object} conditions - The conditions to filter on.
   */
  _where = (conditions) => (f) =>
    Object.entries(conditions).every(([k, v]) => f[k] === v)

  /**
   * Find all files that match the given conditions.
   *
   * @example findFilesWhere({ name: 'foo' })
   *
   * @param {object} conditions - The conditions to filter on.
   * @returns {array} List of file objects matching the conditions.
   */
  findFilesWhere = (conditions) => Object.values(this.files).filter(this._where(conditions))

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
   * Find all folders that match the given conditions.
   *
   * @example findFoldersWhere({ name: 'foo' })
   *
   * @param {object} conditions - The conditions to filter on.
   * @returns {array} List of folder objects matching the conditions.
   */
  findFoldersWhere = (conditions) => Object.values(this.folders).filter(this._where(conditions))

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
   * @param {boolean} [commit] - Whether to commit the file.
   * @returns {object} The new file object.
   */
  createFile = (fileObj, commit = true) => {
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

    if (commit) {
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
   * @returns {object} The updated file object.
   */
  updateFile = (id, obj) => {
    let isRenamed = false;
    const file = this.findFileById(id);

    if (file) {
      for (const [key, value] of Object.entries(obj)) {
        if (file.hasOwnProperty(key) && key !== 'id') {

          // Check whether the file is renamed.
          if (key === 'name' && file[key] !== obj[key]) {
            const oldPath = this.getAbsoluteFilePath(file.id);
            file[key] = value;
            const newPath = this.getAbsoluteFilePath(file.id);

            // Move the file to the new location.
            this._git('mv', oldPath, newPath);

            isRenamed = true;
            continue;
          }

          file[key] = value;
        }
      }

      file.updatedAt = new Date().toISOString();
    }

    if (!isRenamed) {
      // Just commit the changes to the file.
      this._git('commit', this.getAbsoluteFilePath(file.id), file.content);
    }

    this.saveState();
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
    let isRenamed = false;
    const folder = this.findFolderById(id);

    if (folder) {
      for (const [key, value] of Object.entries(obj)) {
        if (folder.hasOwnProperty(key) && key !== 'id') {

          // Check whether the folder is renamed.
          if (key === 'name' && folder[key] !== obj[key]) {
            const oldPath = this.getAbsoluteFolderPath(folder.id);
            folder[key] = value;
            const newPath = this.getAbsoluteFolderPath(folder.id);

            // Move the folder to the new location.
            this._git('mv', oldPath, newPath);

            isRenamed = true;
            continue;
          }

          folder[key] = value;
        }
      }

      folder.updatedAt = new Date().toISOString();
    }

    if (!isRenamed) {
      // Just commit the changes to the folder.
      this._git('commit', this.getAbsoluteFilePath(folder.id), folder.content);
    }

    this.saveState();
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
    if (this.folder[id]) {
      delete this.folder[id];
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
          const newFolder = this.createFolder({
            name: dirname,
            parentId,
          });
          parentId = newFolder.id;
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
