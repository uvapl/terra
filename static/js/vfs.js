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
   * @param {object} conditions - The conditions to filter on.
   */
  findFilesWhere = (conditions) => this.files.filter(this._where(conditions))

  /**
   * Find all folders that match the given conditions.
   *
   * @param {object} conditions - The conditions to filter on.
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
   * Close the active tab in the editor, except when it is an untitled tab.
   */
  closeFile = () => {
    const editor = getActiveEditor();
    if (editor) {
      editor.parent.removeChild(editor);
    }
  }

  /**
   * Open a file in the editor, otherwise switch to the tab.
   *
   * @param {string} id - The file id. Leave empty to create new file.
   * @param {string} filename - The name of the file to open.
   */
  openFile = (id, filename) => {
    const tab = getAllEditorTabs().filter((tab) =>
      id === null
        ? tab.config.title === filename
        : tab.container.getState().fileId === id
    );

    if (tab.length > 0) {
      // Switch to the active tab.
      tab[0].parent.setActiveContentItem(tab[0]);
      tab[0].instance.editor.focus();
    } else {
      const currentTab = getActiveEditor();

      // Add a new tab next to the current active tab.
      currentTab.parent.addChild({
        type: 'component',
        componentName: 'editor',
        componentState: {
          fontSize: BASE_FONT_SIZE,
          fileId: id,
        },
        title: filename,
      });

      // Check if the current tab is an untitled tab with no content.
      if (currentTab.config.title === 'Untitled' && currentTab.instance.editor.getValue() === '') {
        currentTab.parent.removeChild(currentTab);
      }
    }
  }

  /**
   * Create a new file in the virtual filesystem.
   *
   * @param {string} filename - The basename of the file including extension.
   * @param {string} [parentId] - The parent folder id.
   * @returns {object} The new file object.
   */
  createFile = (filename, parentId = null) => {
    const newFile = {
      id: uuidv4(),
      filename,
      parentId,
      content: '',
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
   * @param {string} name - The name of the folder.
   * @param {string} [parentId] - The parent folder id.
   * @returns {object} The new folder object.
   */
  createFolder = (name, parentId = null) => {
    const newFolder = {
      id: uuidv4(),
      name,
      parentId,
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
    console.log('updating folder', id, folder, obj);

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

    const fileBlob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
    saveAs(fileBlob, file.filename);
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
      zip.file(file.filename, file.content);
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
