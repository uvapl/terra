////////////////////////////////////////////////////////////////////////////////
// This file contains the virtual filesystem logic for the IDE app.
////////////////////////////////////////////////////////////////////////////////

const VFS = {
  folders: [],
  files: [],
};

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
 * @param {string} filename - The name of the file to open.
 */
VFS.openFile = (filename) => {
  const tab = getAllEditorTabs().filter((tab) => tab.config.title === filename);

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
VFS.createFile = (filename, parentId) => {
  const newFile = {
    id: uuidv4(),
    filename,
    parentId,
    content: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  VFS.files.push(newFile);
  return newFile;
}

/**
 * Create a new folder in the virtual filesystem.
 *
 * @param {string} name - The name of the folder.
 * @returns {object} The new folder object.
 */
VFS.createFolder = (name) => {
  const newFolder = {
    id: uuidv4(),
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  VFS.folders.push(newFolder);
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
    return true;
  }

  return false;
}
