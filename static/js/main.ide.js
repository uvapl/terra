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
 * Create a new file element in the file tree and trigger edit mode.
 *
 * @param {jQuery.Object} [parentNode] - The parent node of the new file.
 */
function createNewFileTreeFile(parentNode = null) {
  console.log('parentNode', parentNode);
  const nodeId = $('#file-tree').jstree('create_node', parentNode, {
    text: 'Untitled',
    type: 'file',
  });
  $('#file-tree').jstree(true).edit(nodeId);
}

/**
 * Create a new folder element in the file tree and trigger edit mode.
 *
 * @param {jQuery.Object} [parentNode] - The parent node of the new folder.
 */
function createNewFileTreeFolder(parentNode = null) {
  const nodeId = $('#file-tree').jstree('create_node', parentNode, {
    text: 'Untitled',
    type: 'folder',
  });
  $('#file-tree').jstree(true).edit(nodeId);
}

/**
 * Create a file tree list from the VFS compatible with jsTree.
 *
 * @param {string} [parentId] - The parent folder id.
 * @returns {array} jsTree list with file tree objects.
 */
function createFileTreeFromVFS(parentId = null) {
  const folders = VFS.findFoldersWhere({ parentId }).map((folder) => ({
    id: folder.id,
    text: folder.name,
    type: 'folder',
    children: createFileTreeFromVFS(folder.id),
  }));

  const files = VFS.findFilesWhere({ parentId }).map((file) => ({
    id: file.id,
    text: file.filename,
    type: 'file',
  }));

  return folders.concat(files);
}

/**
 * Instantiates the file tree with the files in the VFS using TreeJS.
 */
function createFileTree() {
  const $tree = $('#file-tree').jstree({
    core: {
      animation: 0,
      check_callback: true,
      data: createFileTreeFromVFS(),
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

        if (node.type === 'folder') {
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
      if (nodeA.type === nodeB.type) {
        return nodeA.text.localeCompare(nodeB.text);
      }
      return nodeA.type === 'folder' ? -1 : 1;
    },

    types: {
      folder: {
        icon: 'file-tree-icon file-tree-folder-icon',
        valid_children: ['folder', 'file'],
      },
      file: {
        icon: 'file-tree-icon file-tree-file-icon',
        valid_children: [],
      }
    },

    dnd: {
      copy: false,
      use_html5: true,
    },

    plugins: ['conditionalselect', 'contextmenu', 'sort', 'types', 'dnd'],
  });

  $('#file-tree--add-folder-btn').click(() => {
    createNewFileTreeFolder();
  });

  $('#file-tree--add-file-btn').click(() => {
    createNewFileTreeFile();
  });

  registerFileTreeEventListeners($tree);
}

/**
 * Registers event listeners for the file tree.
 *
 * @param {jQuery.Object} $tree - File-tree reference object.
 */
function registerFileTreeEventListeners($tree) {
  $tree.on('create_node.jstree', (event, data) => {
    // Create the new file or folder in the filesystem.
    const fn = data.node.type === 'folder'
      ? VFS.createFolder
      : VFS.createFile;

    const parentId = data.node.parent !== '#' ? data.node.parent : null;
    const { id } = fn(data.node.original.text, parentId);
    $tree.jstree('set_id', data.node, id);
  });

  $tree.on('rename_node.jstree', (event, data) => {
    const id = data.node.id;
    const newName = data.text;

    if (data.node.type === 'folder') {
      VFS.updateFolder(id, { name: newName });
    } else {
      VFS.updateFile(id, { filename: newName });
    }
  });

  $tree.on('delete_node.jstree', (event, data) => {
    const id = data.node.id;
    const fn = data.node.type === 'folder'
      ? VFS.deleteFolder
      : VFS.deleteFile;

    fn(id);
  });

  $tree.on('select_node.jstree', (event, data) => {
    if (data.node.type === 'folder') {
      $('#file-tree').jstree('toggle_node', data.node);
    } else {
      VFS.openFile(data.node.id, data.node.text);
    }
  });

  $(document).on('dnd_stop.vakata', function(event, data) {
    // Use setTimeout-trick to check after the drop process is finished.
    setTimeout(() => {
      const $treeRef = $('#file-tree').jstree(true);
      const targetNode = $treeRef.get_node(data.event.target);

      if (targetNode) {
        const sourceNode = $treeRef.get_node(data.data.nodes[0]);

        // If the dropped node became a root node, unset parentId.
        const atRootLevel = $('#' + sourceNode.id).parent().parent().attr('id') === 'file-tree';
        const parentId = atRootLevel ? null : targetNode.id;

        const id = sourceNode.id;
        const fn = sourceNode.type === 'folder'
          ? VFS.updateFolder
          : VFS.updateFile;

        fn(id, { parentId });
      }
    }, 0);
  });
}
