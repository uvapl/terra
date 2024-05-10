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
