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

function createNewFileTreeFile(parentNode = null) {
  const nodeId = $('#file-tree').jstree('create_node', parentNode, {
    filename: 'Untitled',
    type: 'file',
  });
  $('#file-tree').jstree(true).edit(nodeId);
}

function createNewFileTreeFolder(parentNode = null) {
  const nodeId = $('#file-tree').jstree('create_node', parentNode, {
    name: 'Untitled',
    type: 'folder',
  });
  $('#file-tree').jstree(true).edit(nodeId);
}

/**
 * Instantiates the file tree with the files in the VFS using TreeJS.
 */
function createFileTree() {
  const $tree = $('#file-tree').jstree({
    core: {
      animation: 0,
      check_callback: true,
      data: [/* TODO: get files from vfs via localStorage */]
    },

    conditionalselect: (node, event) => {
      // Only trigger the select_node event when it's not triggered by the
      // contextmenu event.
      return event.type !== 'contextmenu';
    },

    contextmenu: {
      items: (node) => {
        const defaultItems = $.jstree.defaults.contextmenu.items();
        const newItems = {};

        if (node.original.type === 'folder') {
          newItems.createFile = {
            separator_before: false,
            separator_after: false,
            label: 'New File',
            action: () => createNewFileTreeFile(node),
          };

          newItems.createFolder = {
            separator_before: false,
            separator_after: false,
            label: 'New Folder',
            action: () => createNewFileTreeFolder(node),
          };
        }

        newItems.rename = defaultItems.rename;
        newItems.remove = defaultItems.remove;

        return newItems;
      }
    },

    sort: function(a, b) {
      // Sort folders before files and then alphabetically.
      const nodeA = this.get_node(a);
      const nodeB = this.get_node(b);
      if (nodeA.original.type === nodeB.original.type) {
        return nodeA.text.localeCompare(nodeB.text);
      }
      return nodeA.original.type === 'folder' ? -1 : 1;
    },

    types: {
      folder: {
        icon: 'file-tree-icon file-tree-folder-icon'
      },
      file: {
        icon: 'file-tree-icon file-tree-file-icon'
      }
    },

    plugins: ['wholerow', 'conditionalselect', 'contextmenu', 'sort', 'types'],
  });

  $('#file-tree--add-folder-btn').click(() => {
    createNewFileTreeFolder();
  });

  $('#file-tree--add-file-btn').click(() => {
    createNewFileTreeFile();
  });

  registerFileTreeEventListeners($tree);
}

function registerFileTreeEventListeners($tree) {
  $tree.on('create_node.jstree', (event, data) => {
    // Create the new file or folder in the filesystem.
    const fn = data.node.original.type === 'folder'
      ? VFS.createFolder
      : VFS.createFile;

    const { id } = fn(data.node.original.text);
    data.node.original.id = id;
  });

  $tree.on('rename_node.jstree', (event, data) => {
    const id = data.node.original.id;
    const newName = data.text;

    if (data.node.original.type === 'folder') {
      VFS.updateFolder(id, { name: newName });
    } else {
      VFS.updateFile(id, { filename: newName });
    }
  });

  $tree.on('delete_node.jstree', (event, data) => {
    const id = data.node.original.id;
    const fn = data.node.original.type === 'folder'
      ? VFS.deleteFolder
      : VFS.deleteFile;

    fn(id);
  });

  $tree.on('select_node.jstree', (event, data) => {
    if (data.node.original.type === 'folder') {
      $('#file-tree').jstree('toggle_node', data.node);
    } else {
      VFS.openFile(data.node.text);
    }
  });
}
