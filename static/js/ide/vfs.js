////////////////////////////////////////////////////////////////////////////////
// This file contains the virtual filesystem logic for the IDE app.
////////////////////////////////////////////////////////////////////////////////

/* Main virtual filesystem object */
const VFS = initVFS({
  folders: [],
  files: [],
});

// ===========================================================================
// Functions
// ===========================================================================

/**
 * Load the saved state from local storage and update the main VFS object.
 * If no saved state is found, return the default state.
 *
 * @param {object} defaultState - The default state to return.
 */
function initVFS(defaultState) {
  const savedState = getLocalStorageItem('vfs');
  if (typeof savedState === 'string') {
    return JSON.parse(savedState);
  } else {
    return defaultState;
  }
}

/**
 * Save the virtual filesystem state to localstorage.
 */
VFS.saveState = () => setLocalStorageItem('vfs', JSON.stringify({
  files: VFS.files,
  folders: VFS.folders,
}));

/**
 * Get the root-level folders in the virtual filesystem.
 */
VFS.getRootFolders = () => VFS.folders.filter((f) => !f.parentId);

/**
 * Get the root-level files in the virtual filesystem.
 */
VFS.getRootFiles = () => VFS.files.filter((f) => !f.parentId);

/**
 * Internal helper function to filter a list of object based on conditions.
 *
 * @param {object} conditions - VThe conditions to filter on.
 */
VFS._where = (conditions) => (f) => Object.entries(conditions).every(([k, v]) => f[k] === v);

/**
 * Find all files that match the given conditions.
 *
 * @param {object} conditions - VThe conditions to filter on.
 */
VFS.findFilesWhere = (conditions) => VFS.files.filter(VFS._where(conditions));

/**
 * Find all folders that match the given conditions.
 *
 * @param {object} conditions - VThe conditions to filter on.
 */
VFS.findFoldersWhere = (conditions) => VFS.folders.filter(VFS._where(conditions));

/**
 * Close the active tab in the editor, except when it is an untitled tab.
 */
VFS.closeFile = () => {
  const editor = getActiveEditor();
  if (editor) {
    editor.parent.removeChild(editor);
  }
}

/**
 * Open a file in the editor. When the file is already open, switch to the tab.
 *
 * @param {string} id - The file id. Leave empty to create new file.
 * @param {string} filename - The name of the file to open.
 */
VFS.openFile = (id, filename) => {
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
VFS.createFile = (filename, parentId = null) => {
  const newFile = {
    id: uuidv4(),
    filename,
    parentId,
    content: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  VFS.files.push(newFile);
  VFS.saveState();
  return newFile;
}

/**
 * Create a new folder in the virtual filesystem.
 *
 * @param {string} name - The name of the folder.
 * @param {string} [parentId] - The parent folder id.
 * @returns {object} The new folder object.
 */
VFS.createFolder = (name, parentId = null) => {
  const newFolder = {
    id: uuidv4(),
    name,
    parentId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  VFS.folders.push(newFolder);
  VFS.saveState();
  return newFolder;
}

/**
 * Update a file in the virtual filesystem.
 *
 * @param {string} id - The file id.
 * @param {object} obj - Key-value pairs to update in the file object.
 * @returns {object} The updated file object.
 */
VFS.updateFile = (id, obj) => {
  const file = VFS.files.find((file) => file.id === id);

  if (file) {
    for (const [key, value] of Object.entries(obj)) {
      if (file.hasOwnProperty(key) && key !== 'id') {
        file[key] = value;
      }
    }

    file.updatedAt = new Date().toISOString();
  }

  VFS.saveState();
  return file;
}

/**
 * Update a folder in the virtual filesystem.
 *
 * @param {string} id - The folder id.
 * @param {object} obj - Key-value pairs to update in the folder object.
 * @returns {object} The updated folder object.
 */
VFS.updateFolder = (id, obj) => {
  const folder = VFS.folders.find((folder) => folder.id === id);

  if (folder) {
    for (const [key, value] of Object.entries(obj)) {
      if (folder.hasOwnProperty(key) && key !== 'id') {
        folder[key] = value;
      }
    }

    folder.updatedAt = new Date().toISOString();
  }

  VFS.saveState();
  return folder;
}

/**
 * Delete a file from the virtual filesystem.
 *
 * @param {string} id - The file id.
 * @returns {boolean} True if deleted successfully, false otherwise.
 */
VFS.deleteFile = (id) => {
  const file = VFS.files.find((file) => file.id === id);

  if (file) {
    VFS.files = VFS.files.filter((file) => file.id !== id);
    VFS.saveState();
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
VFS.deleteFolder = (id) => {
  const folder = VFS.folders.find((folder) => folder.id === id);

  if (folder) {
    VFS.folders = VFS.folders.filter((folder) => folder.id !== id);
    VFS.saveState();
    return true;
  }

  return false;
}
