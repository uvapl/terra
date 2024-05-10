////////////////////////////////////////////////////////////////////////////////
// This file contains the virtual filesystem logic for the IDE app.
////////////////////////////////////////////////////////////////////////////////

const VFS = {
  totalFolders: 0,
  totalFiles: 0,
  folders: [
    {
      id: 1,
      name: 'prog1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 2,
      name: 'prog2',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 3,
      parentId: 2,
      name: 'prog3',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  ],
  files: [
    {
      parentId: 1,
      filename: 'main.c',
      content: `#include <stdio.h>'\n\nint main() {\n    printf("Hello, World!\\n");\n    return 0;\n}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      filename: 'README.md',
      content: `# Welcome to the ExamIDE!\n\nThis is a simple IDE for the Exam project.\n\n## Features\n\n- Syntax highlighting\n- File tree\n- Terminal\n- Menubar\n- Virtual filesystem\n\n## Usage\n\n1. Click on a file in the file tree to open it in the editor.\n2. Edit the file content.\n3. Click on the save button to save the file.\n4. Click on the close button to close the file.\n5. Click on the terminal tab to open the terminal.\n6. Click on the menubar items to open the dropdown menus.\n7. Click on the close icon in the menubar to close the dropdown menu.\n8. Click on the file tree icon to open the file tree.\n9. Click on the file tree items to open the files in the editor.\n10. Click on the file tree icon again to close the file tree.\n\n## License\n\nThis project is licensed under the MIT License.`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      parentId: 1,
      filename: 'Makefile',
      content: `all:\n    gcc main.c -o main\n\nrun:\n    ./main\n\nclean:\n    rm -f main\n`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      parentId: 2,
      filename: 'snake.c',
      content: '#include <stdio.h>\n\nint main() {\n    printf("Hello, Snake!\\n");\n    return 0;\n}',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      filename: '.gitignore',
      content: 'node_modules/\n.vscode/\n*.log\n',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ],
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
 */
VFS.createFile = (filename, parentId) => {
  VFS.files.push({
    filename,
    parentId,
    content: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

/**
 * Create a new folder in the virtual filesystem.
 *
 * @param {string} name - The name of the folder.
 */
VFS.createFolder = (name) => {
  VFS.folders.push({
    id: uuidv4(),
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}
