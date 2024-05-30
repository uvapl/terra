////////////////////////////////////////////////////////////////////////////////
// This file contains the virtual filesystem logic for the IDE app.
////////////////////////////////////////////////////////////////////////////////

class VirtualFileSystem {
  constructor() {
    this.files = [];
    this.folders = [];

    this.loadFromLocalStorage();
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
  getRootFolders = () => this.folders.filter((folder) => !folder.parentId)

  /**
   * Get the root-level files in the virtual filesystem.
   */
  getRootFiles = () => this.files.filter((file) => !file.parentId)

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
  findFilesWhere = (conditions) => this.files.filter(this._where(conditions))

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
  findFoldersWhere = (conditions) => this.folders.filter(this._where(conditions))

  /**
   * Find a file by its id.
   *
   * @param {string} id - The id of the file to find.
   */
  findFileById = (id) => this.files.find((file) => file.id === id)

  /**
   * Find a folder by its id.
   *
   * @param {string} id - The id of the folder to find.
   */
  findFolderById = (id) => this.folders.find((folder) => folder.id === id)

  /**
   * Create a new file in the virtual filesystem.
   *
   * @param {object} fileObj - The file object to create.
   * @returns {object} The new file object.
   */
  createFile = (fileObj) => {
    const newFile = {
      id: uuidv4(),
      name: 'Untitled',
      parentId: null,
      content: '',
      ...fileObj,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.files.push(newFile);
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
      ...folderObj,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.folders.push(newFolder);
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
    const file = this.findFileById(id);

    if (file) {
      for (const [key, value] of Object.entries(obj)) {
        if (file.hasOwnProperty(key) && key !== 'id') {
          file[key] = value;
        }
      }

      file.updatedAt = new Date().toISOString();
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
    const folder = this.findFolderById(id);

    if (folder) {
      for (const [key, value] of Object.entries(obj)) {
        if (folder.hasOwnProperty(key) && key !== 'id') {
          folder[key] = value;
        }
      }

      folder.updatedAt = new Date().toISOString();
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
    const file = this.files.find((file) => file.id === id);

    if (file) {
      this.files = this.files.filter((file) => file.id !== id);
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
    const folder = this.findFolderById(id);

    if (folder) {
      this.folders = this.folders.filter((f) => f.id !== id);
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

    const fileBlob = new Blob([addNewLineCharacter(file.content)], { type: 'text/plain;charset=utf-8' });
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
}

const VFS = new VirtualFileSystem();
