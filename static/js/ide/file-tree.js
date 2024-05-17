////////////////////////////////////////////////////////////////////////////////
// This file contains the logic for the left-sidebar file-tree in the IDE.
////////////////////////////////////////////////////////////////////////////////

/**
 * Create a new file element in the file tree and trigger edit mode.
 *
 * @param {jQuery.Object} [parentNode] - The parent node of the new file.
 */
function createNewFileTreeFile(parentNode = null) {
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

function createFileTreeContextMenuItems(node) {
  const defaultMenu = $.jstree.defaults.contextmenu.items();
  const menu = {};

  if (node.type === 'folder') {
    menu.createFile = {
      label: 'New File',
      action: () => createNewFileTreeFile(node),
    };

    menu.createFolder = {
      label: 'New Folder',
      action: () => createNewFileTreeFolder(node),
    };

    menu.download = {
      label: 'Download',
      action: () => VFS.downloadFolder(node.id),
    };
  } else { // file
    menu.download = {
      label: 'Download',
      action: () => VFS.downloadFile(node.id),
    };

    const proglang = getFileExtension(node.text);
    if (hasWorker(proglang)) {
      menu.run = {
        label: 'Run',
        action: () => {
          runCode(node.id);
        }
      }
    }
  }

  // By default this is added for folders and files.
  menu.rename = defaultMenu.rename;
  menu.remove = defaultMenu.remove;

  return menu;
}

/**
 * Sort folders before files and then alphabetically.
 */
function sortFileTree(a, b) {
  // Sort folders before files and then alphabetically.
  const nodeA = this.get_node(a);
  const nodeB = this.get_node(b);
  if (nodeA.type === nodeB.type) {
    return nodeA.text.localeCompare(nodeB.text);
  }
  return nodeA.type === 'folder' ? -1 : 1;
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

    contextmenu: { items: createFileTreeContextMenuItems },
    sort: sortFileTree,

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
      openFile(data.node.id, data.node.text);
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
