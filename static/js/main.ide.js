////////////////////////////////////////////////////////////////////////////////
// This file is the main entry point for the IDE app.
////////////////////////////////////////////////////////////////////////////////

// ===========================================================================
// Here's the start of the application.
// ===========================================================================

initApp().then(({ layout }) => {
  createFileTree();
}).catch((err) => {
  console.error('Failed to bootstrap IDE app:', err);
});

// ===========================================================================
// Functions
// ===========================================================================

/**
 * Initialise the app by loading the config and create the layout.
 *
 * @returns {Promise<{ layout: Layout }>} Object containing the layout instance.
 */
function initApp() {
  return new Promise((resolve, reject) => {
    // Get the programming language based on tabs filename.
    const proglang = 'c';

    // Initialise the programming language specific worker API.
    window._workerApi = new WorkerAPI(proglang);

    // Create the layout object.
    const layout = createLayout(proglang, {});

    // Call the init function that creates all components.
    layout.init();

    // Make layout instance available at all times.
    window._layout = layout;

    resolve({ layout });
  });
}


/**
 * Create the layout object with the given content objects and font-size.
 *
 * @param {array} content - List of content objects.
 * @param {string} proglang - The programming language to be used
 * @param {object} options - Additional options object.
 * @param {object} options.buttonConfig - Object containing buttons with their
 * commands that will be rendered by the layout.
 * @returns {Layout} The layout instance.
 */
function createLayout(proglang, options) {
  const defaultLayoutConfig = {
    settings: {
      showCloseIcon: false,
      showPopoutIcon: false,
      showMaximiseIcon: true,
      reorderEnabled: true,
    },
    dimensions: {
      headerHeight: 30,
      borderWidth: 10,
    },
    content: [
      {
        type: 'column',
        content: [
          {
            type: 'stack',
            content: [
              {
                type: 'component',
                componentName: 'editor',
                componentState: {
                  fontSize: BASE_FONT_SIZE,
                },
                title: 'Untitled',
              },
            ],
          },
          {
            type: 'component',
            componentName: 'terminal',
            componentState: { fontSize: BASE_FONT_SIZE },
            isClosable: false,
          }
        ]
      }
    ]
  };

  return new LayoutIDE(proglang, defaultLayoutConfig, options);
}

/**
 * Instantiates the file tree with the files in the VFS using TreeJS.
 */
function createFileTree() {
  const rootFiles = VFS.files.filter((file) => !file.parentId).map((file) => ({
    id: file.id,
    text: file.filename,
    type: 'file',
    icon: 'file-tree-icon file-tree-file-icon',
  }));

  const rootDirs = VFS.folders.filter((folder) => !folder.parentId).map((folder) => ({
    id: folder.id,
    text: folder.name,
    type: 'directory',
    icon: 'file-tree-icon file-tree-folder-icon',
    children: [
      ...VFS.folders.filter((childFolder) => childFolder.parentId === folder.id).map((childFolder) => ({
        id: childFolder.id,
        text: childFolder.name,
        type: 'directory',
        icon: 'file-tree-icon file-tree-folder-icon',
        children: rootFiles,
      })),
      ...rootFiles,
    ]
  }));

  const $tree = $('#file-tree').jstree({
    core: {
      animation: 0,
      data: [
        ...rootDirs,
        ...rootFiles,
      ]
    },

    conditionalselect: () => {
      // Returning true makes a single click open a file/directory.
      // Returning false will require double click.
      return true;
    },

    plugins: ['wholerow', 'conditionalselect'],
  });

  $tree.on('select_node.jstree', (event, data) => {
    if (data.node.original.type === 'directory') {
      $('#file-tree').jstree('toggle_node', data.node);
    } else {
      VFS.openFile(data.node.text);
    }
  })
}
