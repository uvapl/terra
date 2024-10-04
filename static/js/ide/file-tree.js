////////////////////////////////////////////////////////////////////////////////
// This file contains the logic for the left-sidebar file-tree in the IDE.
////////////////////////////////////////////////////////////////////////////////

/**
 * Increment the number in a string with the pattern `XXXXXX (N)`.
 *
 * @example incrementString('Untitled')     -> 'Untitled (1)'
 * @example incrementString('Untitled (1)') -> 'Untitled (2)'
 *
 * @param {string} string - The string to update.
 * @returns {string} The updated string containing the number.
 */
function incrementString(string) {
  const match = /\((\d+)\)$/g.exec(string);

  if (match) {
    const num = parseInt(match[1]) + 1;
    return string.replace(/\d+/, num);
  }

  return `${string} (1)`;
}

/**
 * Create a new file element in the file tree and trigger edit mode.
 *
 * @param {jQuery.Object} [parentNode] - The parent node of the new file.
 */
function createNewFileTreeFile(parentNode = null) {
  const parentId = parentNode ? parentNode.id : null;

  // Create a new unique filename.
  let filename = 'Untitled';
  while (VFS.existsWhere({ parentId, name: filename })) {
    filename = incrementString(filename)
  }

  const nodeId = $('#file-tree').jstree('create_node', parentNode, {
    text: filename,
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
  const parentId = parentNode ? parentNode.id : null;

  // Create a new unique foldername.
  let foldername = 'Untitled';
  while (VFS.existsWhere({ parentId, name: foldername })) {
    foldername = incrementString(foldername)
  }

  const nodeId = $('#file-tree').jstree('create_node', parentNode, {
    text: foldername,
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
    text: file.name,
    type: 'file',
  }));

  return folders.concat(files);
}

/**
 * Delete a file tree item from the VFS and the file tree. When the node is a
 * file and its corresponding tab is open, then it'll be closed.
 *
 * @param {jsTree.Node} node - The node to delete.
 */
function deleteFileTreeItem(node) {
  const $modal = createModal({
    title: 'Confirmation required',
    body: `<p>Are you sure you want to delete the ${node.type} <strong>${node.text}</strong> permanently? This action can't be undone.</p>`,
    footer: `
      <button type="button" class="button cancel-btn">Cancel</button>
      <button type="button" class="button confirm-btn danger-btn">I'm sure</button>
    `,
    attrs: {
      id: 'ide-delete-confirmation-modal',
      class: 'modal-width-small'
    }
  });

  showModal($modal);

  $modal.find('.cancel-btn').click(() => hideModal($modal));
  $modal.find('.confirm-btn').click(() => {
    if (node.type === 'file') {
      closeFileTab(node.id);
    } else if (node.type === 'folder') {
      closeFilesInFolderRecursively(node.id);
    }

    // Delete from file-tree, including VFS.
    $('#file-tree').jstree('delete_node', node);

    hideModal($modal);
  });
}

/**
 * Close a single file tab by its fileId, including removing it from the vfs.
 *
 * @param {string} fileId - The file ID to close.
 */
function closeFileTab(fileId) {
  const tab = getAllEditorTabs().find((tab) => tab.container.getState().fileId === fileId);
  if (tab) {
    tab.parent.removeChild(tab);
  }

  VFS.deleteFile(fileId);
}

/**
 * Close all files inside a folder, including nested files in subfolders.
 *
 * @param {string} folderId - The folder ID to close all files from.
 */
function closeFilesInFolderRecursively(folderId) {
  const files = VFS.findFilesWhere({ parentId: folderId });
  for (const file of files) {
    closeFileTab(file.id);
  }

  const folders = VFS.findFoldersWhere({ parentId: folderId });
  for (const folder of folders) {
    closeFilesInFolderRecursively(folder.id);
  }
}

/**
 * Create a contextmenu for the file tree. This function is called when the user
 * right-clicks on a file or folder in the file tree. The contextmenu items are
 * dynamically created based on the node type (file or folder).
 *
 * @param {jsTree.Node} node - The node that was right-clicked.
 * @returns {object} The contextmenu object.
 */
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
  } else if (node.type === 'file') {
    menu.download = {
      label: 'Download',
      action: () => VFS.downloadFile(node.id),
    };

    const proglang = getFileExtension(node.text);
    if (hasWorker(proglang)) {
      menu.run = {
        label: 'Run',
        action: () => runCode(node.id)
      }
    }
  }

  menu.rename = defaultMenu.rename;

  menu.remove = {
    label: 'Delete',
    action: () => deleteFileTreeItem(node),
  };

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
  // Make sure we destroy the existing tree instance if it exists.
  $('#file-tree').jstree('destroy');

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

  $('#file-tree--add-folder-btn').off('click').on('click', () => {
    createNewFileTreeFolder();
  });

  $('#file-tree--add-file-btn').off('click').on('click', () => {
    createNewFileTreeFile();
  });

  registerFileTreeEventListeners($tree);
}

/**
 * Add a visual indicator to the file tree for files and folder whether they are
 * added or modified in Git.
 *
 * @param {jsTree.Node} node - The node to add the indicator to.
 */
function addGitDiffIndicator(node) {
  $tree = $('#file-tree');

  // Add modified classes for visual indicators.
  if (!$(`#${node.id}`).hasClass('git-added')) {
    $tree.jstree('get_node', node).li_attr.class = 'git-modified';
    $tree.jstree('redraw_node', node);
  }

  // Add modified classes to parent folders.
  if (node.type === 'file' && node.parent !== '#' && !$(`#${node.parent}`).hasClass('git-added')) {
    $tree.jstree('get_node', node.parent).li_attr.class = 'git-modified';
    $tree.jstree('redraw_node', node.parent);
  }
}

/**
 * Callback when the user creates a new node in the file tree.
 *
 * @param {jsTree} $tree - The file tree instance.
 */
function createNodeCallback($tree) {
  return (event, data) => {
    // Create the new file or folder in the filesystem.
    const fn = data.node.type === 'folder'
      ? VFS.createFolder
      : VFS.createFile;

    const parentId = data.node.parent !== '#' ? data.node.parent : null;
    const { id } = fn({ name: data.node.original.text, parentId });

    if (hasGitFSWorker()) {
      $tree.jstree('get_node', data.node).li_attr.class = 'git-added';
    }

    $tree.jstree('set_id', data.node, id);
    $tree.jstree('redraw_node', data.node);
  }
}

/**
 * Callback when the user renames a node in the file tree.
 *
 * @param {jsTree} $tree - The file tree instance.
 */
function renameNodeCallback($tree) {
  return (event, data) => {
    const name = data.text;

    // Check if the name already exists in the parent folder.
    // If so, trigger edit mode again and show error tooltip.
    const parentId = data.node.parent === '#' ? null : data.node.parent;
    if (VFS.existsWhere({ parentId, name }) && name !== data.node.original.text) {
      return setTimeout(() => {
        $('#file-tree').jstree(true).edit(data.node);

        // Delete previous tooltip.
        const inputWrapper = $(`#${data.node.id} input`).parent()[0];
        if (window._renameNodeTippy) {
          window._renameNodeTippy.destroy();
          window._renameNodeTippy = null;
        }

        // Create new tooltip.
        window._renameNodeTippy = tippy(inputWrapper, {
          content: `${data.node.type} "${name}" already exists`,
          showOnCreate: true,
          placement: 'right',
          theme: 'error',
        });
      }, 10);
    }

    const fn = data.node.type === 'folder'
      ? VFS.updateFolder
      : VFS.updateFile;

    fn(data.node.id, { name });

    if (hasGitFSWorker()) {
      addGitDiffIndicator(data.node);
    }

    const tab = getAllEditorTabs().find((tab) => tab.container.getState().fileId === data.node.id);
    if (tab) {
      tab.container.setTitle(name);

      // For some reason no update is triggered, so we trigger an update.
      window._layout.emit('stateChanged');
    }

    // Destroy the leftover tooltip if it exists.
    if (window._renameNodeTippy) {
      window._renameNodeTippy.destroy();
      window._renameNodeTippy = null;
    }
  };
}

/**
 * Callback when the user deletes a node in the file tree.
 *
 * @param {jsTree} $tree - The file tree instance.
 */
function deleteNodeCallback($tree) {
  return (event, data) => {
    const id = data.node.id;
    const fn = data.node.type === 'folder'
      ? VFS.deleteFolder
      : VFS.deleteFile;

    fn(id);
  };
}

/**
 * Callback when the user selects a node in the file tree.
 *
 * @param {jsTree} $tree - The file tree instance.
 */
function selectNodeCallback($tree) {
  return (event, data) => {
    if (data.node.type === 'folder') {
      $('#file-tree').jstree('toggle_node', data.node);
    } else {
      openFile(data.node.id, data.node.text);
    }

    // Deselect the node to make sure it is clickable again.
    $('#file-tree').jstree('deselect_node', data.node);
  };
}

/**
 * Callback when the user stops dragging and dropping a node in the file tree.
 *
 * @param {Event} event - The event object.
 * @param {object} data - The data object containing the nodes.
 */
function dndStopCallback(event, data) {
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

      if (hasGitFSWorker()) {
        addGitDiffIndicator(sourceNode);
      }
    }
  }, 0);
}

/**
 * Registers event listeners for the file tree.
 *
 * @param {jQuery.Object} $tree - File-tree reference object.
 */
function registerFileTreeEventListeners($tree) {
  $tree.on('create_node.jstree', createNodeCallback($tree));
  $tree.on('rename_node.jstree', renameNodeCallback($tree));
  $tree.on('delete_node.jstree', deleteNodeCallback($tree));
  $tree.on('select_node.jstree', selectNodeCallback($tree));
  $(document).on('dnd_stop.vakata', dndStopCallback);
}
