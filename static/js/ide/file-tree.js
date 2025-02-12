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
Terra.f.incrementString = (string) => {
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
 * @param {string|null} [parentId] - The parent folder id.
 */
Terra.f.createNewFileTreeFile = (parentId = null) => {
  if (Terra.f.hasLFS() && Terra.lfs.busy) return;

  // Create a new unique filename.
  let filename = 'Untitled';
  while (Terra.vfs.existsWhere({ parentId, name: filename })) {
    filename = Terra.f.incrementString(filename)
  }

  // Create the new file in the filesystem.
  const { id } = Terra.vfs.createFile({ name: filename, parentId });

  // Create the new node in the file tree.
  const newChildProps = {
    title: filename,
    folder: false,
    key: id,
    data: {
      type: 'file',
      isFile: true,
    },
  };

  // Append to the parent node if it exists, otherwise append to the root.
  const tree = Terra.f.getFileTreeInstance();
  if (parentId) {
    const parentNode = tree.getNodeByKey(parentId);
    parentNode.setExpanded();

    parentNode.addChildren(newChildProps);
  } else {
    tree.rootNode.addChildren(newChildProps);
  }

  // Reload tree such that the 'No files or folders found' is removed in case
  // there were no files, but a new has been created.
  Terra.f.createFileTree();

  Terra.f.sortFileTree();

  const newNode = tree.getNodeByKey(id);

  // Check again if the parent node is expanded, because the node might have
  // been added to a closed folder. Only then we can trigger editStart().
  if (parentId) {
    tree.getNodeByKey(parentId).setExpanded();
  }

  // Trigger edit mode for the new node.
  newNode.editStart();
}

/**
 * Create a new folder element in the file tree and trigger edit mode.
 *
 * @param {string|null} [parentId] - The parent id of the new folder.
 */
Terra.f.createNewFileTreeFolder = (parentId = null) => {
  if (Terra.f.hasLFS() && Terra.lfs.busy) return;

  // Create a new unique foldername.
  let foldername = 'Untitled';
  while (Terra.vfs.existsWhere({ parentId, name: foldername })) {
    foldername = Terra.f.incrementString(foldername)
  }

  // Create the new folder in the filesystem.
  const { id } = Terra.vfs.createFolder({ name: foldername, parentId });

  // Create the new node in the file tree.
  const newChildProps = {
    title: foldername,
    folder: true,
    key: id,
    data: {
      type: 'folder',
      isFolder: true,
    },
  };

  // Append to the parent node if it exists, otherwise append to the root.
  const tree = Terra.f.getFileTreeInstance();
  if (parentId) {
    const parentNode = tree.getNodeByKey(parentId);
    parentNode.setExpanded();

    parentNode.addChildren(newChildProps);
  } else {
    tree.rootNode.addChildren(newChildProps);
  }

  // Reload tree such that the 'No files or folders found' is removed in case
  // there were no files, but a new has been created.
  Terra.f.createFileTree();

  Terra.f.sortFileTree();

  // Trigger edit mode for the new node.
  const newNode = tree.getNodeByKey(id);

  // Check again if the parent node is expanded, because the node might have
  // been added to a closed folder. Only then we can trigger editStart().
  if (parentId) {
    tree.getNodeByKey(parentId).setExpanded();
  }

  newNode.editStart();
}

/**
 * Create a file tree list from the VFS compatible with FancyTree.
 *
 * @param {string} [parentId] - The parent folder id.
 * @returns {array} List with file tree objects.
 */
Terra.f.createFileTreeFromVFS = (parentId = null) => {
  const folders = Terra.vfs.findFoldersWhere({ parentId }).map((folder) => ({
    key: folder.id,
    title: folder.name,
    folder: true,
    data: {
      type: 'folder',
      isFolder: true,
    },
    children: Terra.f.createFileTreeFromVFS(folder.id),
  }));

  const files = Terra.vfs.findFilesWhere({ parentId }).map((file) => ({
    key: file.id,
    title: file.name,
    folder: false,
    data: {
      type: 'file',
      isFile: true,
    },
  }));

  return folders.concat(files);
}

/**
 * Delete a file tree item from the VFS and the file tree. When the node is a
 * file and its corresponding tab is open, then it'll be closed.
 *
 * @param {FancytreeNode} node - The node to delete.
 */
Terra.f.deleteFileTreeItem = (node) => {
  const $modal = createModal({
    title: 'Confirmation required',
    body: `<p>You are about to delete the ${node.data.type} <strong>${node.title}</strong> permanently, are you sure? This action can't be undone.</p>`,
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

  $modal.find('.cancel-btn').click(() => {
    Terra.v.blockLFSPolling = false;
    hideModal($modal);
  });

  $modal.find('.confirm-btn').click(() => {
    if (node.data.isFile) {
      Terra.f.closeFileTab(node.key);
      Terra.vfs.deleteFile(node.key);
    } else if (node.data.isFolder) {
      Terra.f.closeFilesInFolderRecursively(node.key);
    }

    // Delete from the VFS.
    const fn = node.data.isFolder
      ? Terra.vfs.deleteFolder
      : Terra.vfs.deleteFile;
    fn(node.key);

    // Delete from the file tree.
    node.remove();

    hideModal($modal);
    Terra.v.blockLFSPolling = false;

    // Reload tree such that the 'No files or folders found' becomes visible
    // when needed.
    Terra.f.createFileTree();
  });
}

/**
 * Close a single file tab by its fileId.
 *
 * @param {string} fileId - The file ID to close.
 */
Terra.f.closeFileTab = (fileId) => {
  const tab = Terra.f.getAllEditorTabs().find((tab) => tab.container.getState().fileId === fileId);
  if (tab) {
    tab.parent.removeChild(tab);
  }
}

/**
 * Close all files inside a folder, including nested files in subfolders.
 *
 * @param {string} folderId - The folder ID to close all files from.
 */
Terra.f.closeFilesInFolderRecursively = (folderId) => {
  const files = Terra.vfs.findFilesWhere({ parentId: folderId });
  for (const file of files) {
    Terra.f.closeFileTab(file.id);
  }

  const folders = Terra.vfs.findFoldersWhere({ parentId: folderId });
  for (const folder of folders) {
    Terra.f.closeFilesInFolderRecursively(folder.id);
  }
}

/**
 * Create a contextmenu for the file tree. The contextmenu items created
 * dynamically when the user right-clicks on a file or folder in the file tree.
 *
 * @see https://swisnl.github.io/jQuery-contextMenu/docs/items.html
 *
 * @returns {object} The contextmenu object.
 */
Terra.f.createFileTreeContextMenuItems = ($trigger, event) => {
  const menu = {};
  const node = $.ui.fancytree.getNode($trigger[0]);
  const { isFolder, isFile } = node.data;

  if (isFolder) {
    menu.createFile = {
      name: 'New File',
      callback: () => {
        Terra.v.userClickedContextMenuItem = true;
        Terra.f.createNewFileTreeFile(node.key);
      },
    };

    menu.createFolder = {
      name: 'New Folder',
      callback: () => {
        Terra.v.userClickedContextMenuItem = true;
        Terra.f.createNewFileTreeFolder(node.key);
      },
    };

    if (!Terra.f.hasLFS() || (Terra.f.hasLFS() && !Terra.lfs.loaded)) {
      menu.downloadFolder = {
        name: 'Download',
        callback: () => {
          Terra.v.userClickedContextMenuItem = true;
          Terra.vfs.downloadFolder(node.key);
          Terra.v.blockLFSPolling = false;
        },
      };
    }
  }

  if (isFile) {
    if (!Terra.f.hasLFS() || (Terra.f.hasLFS() && !Terra.lfs.loaded)) {
      menu.downloadFile = {
        name: 'Download',
        callback: () => {
          Terra.v.userClickedContextMenuItem = true;
          Terra.vfs.downloadFile(node.key);
          Terra.v.blockLFSPolling = false;
        },
      };
    }

    if (hasWorker(Terra.f.getFileExtension(node.title))) {
      menu.run = {
        name: 'Run',
        callback: () => {
          Terra.v.userClickedContextMenuItem = true;
          Terra.f.runCode(node.key);
          Terra.v.blockLFSPolling = false;
        }
      };
    }
  }

  if (isFile || isFolder) {
    menu.rename = {
      name: 'Rename',
      callback: () => {
        Terra.v.userClickedContextMenuItem = true;
        node.editStart();
      },
    };

    menu.remove = {
      name: 'Delete',
      callback: () => {
        Terra.v.userClickedContextMenuItem = true;
        Terra.f.deleteFileTreeItem(node);
      }
    };
  }

  if (Object.keys(menu).length === 0) {
    return false;
  }

  return { items: menu };
}

/**
 * Sort folders before files and then alphabetically.
 */
Terra.f.sortFileTree = () => {
  const tree = Terra.f.getFileTreeInstance();

  tree.rootNode.sortChildren((a, b) => {
    if (a.data.type === b.data.type) {
      return a.title.localeCompare(b.title);
    }
    return a.folder ? -1 : 1;
  }, true);
}

/**
 * Get the file tree instance.
 */
Terra.f.getFileTreeInstance = () => {
  return $.ui.fancytree.getTree("#file-tree");
}

/**
 * Instantiates the file tree with the files in the VFS using TreeJS.
 * If an existing instance already exists, only the data is updated and redrawn.
 *
 * @param {boolean} [forceRecreate=false] Enforce recreation of the file tree.
 *
 * @see https://wwwendt.de/tech/fancytree/doc/jsdoc/global.html#FancytreeOptions
 */
Terra.f.createFileTree = (forceRecreate = false) => {
  // Reload the tree if it already exists by re-importing from VFS.
  if (Terra.filetree) {
    if (!forceRecreate) {
      // Always persist the tree state to prevent folders from being closed.
      Terra.f.persistFileTreeState(async () => {
        Terra.f.getFileTreeInstance().reload(Terra.f.createFileTreeFromVFS());
      })
      return;
    } else {
      $('#file-tree .info-msg').remove();
      Terra.f.getFileTreeInstance().destroy();
    }
  }

  // Bind buttons for creating new folders/files.
  $('#file-tree--add-folder-btn').off('click').on('click', () => Terra.f.createNewFileTreeFolder());
  $('#file-tree--add-file-btn').off('click').on('click', () => Terra.f.createNewFileTreeFile());

  // Otherwise, instantiate a new tree.
  Terra.filetree = $("#file-tree").fancytree({
    selectMode: 1,
    debugLevel: 0,
    strings: {
      noData: 'Create a file to get started'
    },
    source: Terra.f.createFileTreeFromVFS(),
    click: Terra.f.onClickNodeCallback,
    init: () => Terra.f.sortFileTree(),

    // @see https://github-wiki-see.page/m/mar10/fancytree/wiki/ExtensionIndex
    extensions: ['glyph', 'edit', 'dnd5'],

    // @see https://github-wiki-see.page/m/mar10/fancytree/wiki/ExtGlyph
    glyph: {
      map: {
        dropMarker: '',
        doc: "file-tree-icon file-tree-file-icon",
        docOpen: "file-tree-icon file-tree-file-icon open",
        folder: "file-tree-icon file-tree-folder-icon",
        folderOpen: "file-tree-icon file-tree-folder-icon open",
      },
    },

    // @see https://github-wiki-see.page/m/mar10/fancytree/wiki/ExtDnd
    dnd5: {
      autoExpandMS: 400,
      dragStart: Terra.f.dragStartCallback,
      dragEnter: Terra.f.dragEnterCallback,
      dragDrop: Terra.f.dragStopCallback,
      dragEnd: Terra.f.dragEndCallback,
    },

    // @see https://github-wiki-see.page/m/mar10/fancytree/wiki/ExtEdit
    edit: {
      triggerStart: ['dblclick'],
      edit: Terra.f.onStartEditNodeCallback,
      beforeClose: Terra.f.beforeCloseEditNodeCallback,
      close: Terra.f.afterCloseEditNodeCallback,
    },
  });

  // @see http://swisnl.github.io/jQuery-contextMenu/docs.html
  $.contextMenu({
    zIndex: 10,
    selector: '#file-tree span.fancytree-title',
    build: Terra.f.createFileTreeContextMenuItems,
    events: {
      show: () => {
        Terra.v.blockLFSPolling = true;
      },
      hide: () => {
        if (!Terra.v.userClickedContextMenuItem) {
          Terra.v.blockLFSPolling = false;
        }
      }
    }
  });
}

/**
 * Callback after the inline editor was removed.
 */
Terra.f.afterCloseEditNodeCallback = () => {
  Terra.f.sortFileTree(),
  Terra.v.blockLFSPolling = false;
}

/**
 * Callback before the user closes the edit mode of a node in the file tree.
 */
Terra.f.beforeCloseEditNodeCallback = (event, data) => {
  // Check if user pressed cancel or text is unchanged.
  if (!data.save) return;

  const name = data.input.val().trim();
  if (!name) {
    return false;
  }

  const parentId = data.node.parent.title === 'root' ? null : data.node.parent.key;

  let errorMsg;

  // Check if the name already exists in the parent folder.
  // If so, trigger edit mode again and show error tooltip.
  if (!Terra.f.isValidFilename(name)) {
    errorMsg = 'Name can\'t contain \\ / : * ? " < > |';
  } else if (Terra.vfs.existsWhere({ parentId, name }, { ignoreIds: data.node.key })) {
    errorMsg = `There already exists a "${name}" file or folder`;
  }

  if (errorMsg) {
    // Delete previous tooltip.
    if (Terra.f.isObject(Terra.v.renameNodeTippy)) {
      Terra.v.renameNodeTippy.destroy();
      Terra.v.renameNodeTippy = null;
    }

    // Create new tooltip.
    Terra.v.renameNodeTippy = tippy(data.node.span, {
      content: errorMsg,
      animation: false,
      showOnCreate: true,
      placement: 'right',
      theme: 'error',
    });

    return false;
  }

  const fn = data.node.data.isFolder
    ? Terra.vfs.updateFolder
    : Terra.vfs.updateFile;

  fn(data.node.key, { name });

  const tab = Terra.f.getAllEditorTabs().find((tab) => tab.container.getState().fileId === data.node.key);
  if (tab) {
    tab.container.setTitle(name);
    const proglang = name.includes('.') ? Terra.f.getFileExtension(name) : 'text';
    tab.instance.setProgLang(proglang);

    // For some reason no update is triggered, so we trigger an update.
    Terra.layout.emit('stateChanged');
  }

  // Destroy the leftover tooltip if it exists.
  if (Terra.f.isObject(Terra.v.renameNodeTippy)) {
    Terra.v.renameNodeTippy.destroy();
    Terra.v.renameNodeTippy = null;
  }

  return true;
}

/**
 * Callback when the user starts editing a node in the file tree.
 */
Terra.f.onStartEditNodeCallback = (event, data) => {
  Terra.v.blockLFSPolling = true;
  clearTimeout(Terra.v.fileTreeToggleTimeout);
  data.input.select();

  $(data.input).attr({
    autocorrect: 'off',     // Disable auto-correction
    autocapitalize: 'none', // Prevents automatic capitalization of the first letter
    spellcheck: 'false',    // Disable the spell-check feature

  });
}

/**
 * Callback when the user clicks on a node in the file tree.
 */
Terra.f.onClickNodeCallback = (event, data) => {
  // Prevent default behavior for folders.
  if (data.node.data.isFile) {
    Terra.f.openFile(data.node.key, data.node.title);
  } else if (data.node.data.isFolder) {
    clearTimeout(Terra.v.fileTreeToggleTimeout);

    // Only toggle with a debounce of 200ms when clicked on the title
    // to prevent double-clicks.
    if (event.originalEvent.target.classList.contains('fancytree-title')) {
      Terra.v.fileTreeToggleTimeout = setTimeout(() => {
        Terra.v.blockLFSPolling = true;
        data.node.toggleExpanded();

        // Unblock LFS polling after the animation has completed.
        setTimeout(() => {
          Terra.v.blockLFSPolling = false;
        }, 400);
      }, 200);
    } else {
      // Otherwise, immediately toggle the folder.
      data.node.toggleExpanded();
    }
  }
}

/**
 * Callback when the user drags a node over another node in the file tree.
 *
 * @returns {boolean} True if the user is allowed to drag onto the node.
 */
Terra.f.dragEnterCallback = (targetNode, data) => {
  // Add a visual drag area indicator.

  $(`.${Terra.c.DROP_AREA_INDICATOR_CLASS}`).removeClass(Terra.c.DROP_AREA_INDICATOR_CLASS);

  if ((targetNode.parent.title === 'root' && targetNode.data.isFile) || targetNode.title === 'root') {
    $('#file-tree').addClass(Terra.c.DROP_AREA_INDICATOR_CLASS);
  }
  else if (targetNode.data.isFile) {
    $(targetNode.parent.li).addClass(Terra.c.DROP_AREA_INDICATOR_CLASS);
  }
  else if (targetNode.data.isFolder) {
    $(targetNode.li).addClass(Terra.c.DROP_AREA_INDICATOR_CLASS);
  }

  // Check if there exists already a file with the same name on the
  // target folder. If so, prevent dropping.
  const sourceNode = data.otherNode;
  const containsDuplicate = (
    (
      targetNode.data.isFile &&
      Terra.vfs.existsWhere({
        parentId: targetNode.parent.title === 'root' ? null : targetNode.parent.key,
        name: sourceNode.title
      }, { ignoreIds: sourceNode.key })
    )
      ||
    (
      targetNode.data.isFolder &&
      Terra.vfs.existsWhere({
        parentId: targetNode.key,
        name: sourceNode.title
      }, { ignoreIds: sourceNode.key })
    )
  );

  if (Terra.f.isObject(Terra.v.dndDuplicateTippy)) {
    Terra.v.dndDuplicateTippy.destroy();
    Terra.v.dndDuplicateTippy = null;
  }

  if (containsDuplicate) {
    // Create new tooltip.
    const tooltipElement = targetNode.parent.title === 'root'
      ? $('.file-tree-container .title')[0]
      : (targetNode.data.isFile ? targetNode.parent.span : targetNode.span);

    Terra.v.dndDuplicateTippy = tippy(tooltipElement, {
      content: `There already exists a "${sourceNode.title}" file or folder`,
      animation: false,
      showOnCreate: true,
      placement: 'right',
      theme: 'error',
    });

    return false;
  }

  return true;
}

/**
 * Callback when the user starts dragging a node in the file tree.
 */
Terra.f.dragStartCallback = (node, data) => {
  Terra.v.blockLFSPolling = true;

  // Set custom drag image.
  data.dataTransfer.setDragImage($(`<div class="custom-drag-helper">${node.title}</div>`).appendTo("body")[0], -10, -10);
  data.useDefaultImage = false;

  // Return true to enable dnd.
  return node.statusNodeType !== 'nodata';
}

/**
 * Callback when the user stops dragging a node in the file tree.
 */
Terra.f.dragEndCallback = () => {
  // Remove the visual drag area indicator.
  $(`.${Terra.c.DROP_AREA_INDICATOR_CLASS}`).removeClass(Terra.c.DROP_AREA_INDICATOR_CLASS);

  if (Terra.f.isObject(Terra.v.dndDuplicateTippy)) {
    Terra.v.dndDuplicateTippy.destroy();
    Terra.v.dndDuplicateTippy = null;
  }

  Terra.f.sortFileTree()
  Terra.v.blockLFSPolling = false;
}

/**
 * Callback when the user stops dragging and dropping a node in the file tree.
 *
 * @param {FancytreeNode} targetNode - The node where the other node was dropped
 * @param {object} data - The data object containing the source node.
 */
Terra.f.dragStopCallback = (targetNode, data) => {
  const sourceNode = data.otherNode;

  // If the dropped node became a root node, unset parentId.
  let parentId = (targetNode.data.isFolder)
    ? targetNode.key
    : (targetNode.parent.title === 'root' ? null : targetNode.parent.key);

  const id = sourceNode.key;
  const fn = sourceNode.data.isFolder
    ? Terra.vfs.updateFolder
    : Terra.vfs.updateFile;

  fn(id, { parentId });

  // Move the node in the tree, but when files or files are dropped onto other
  // files, prevent a new folder being created and just insert the source file
  // as a sibling next to the target file.
  if (data.hitMode === 'over' && targetNode.data.isFile) {
    sourceNode.moveTo(targetNode, 'before');
  } else {
    sourceNode.moveTo(targetNode, data.hitMode);
    targetNode.setExpanded();
  }
}

/**
 * Runs a given function while preserving the expanded state of folder nodes.
 *
 * @async
 * @param {Function} fn - Callable async function reference.
 * @returns {Promise<void>}
 */
Terra.f.persistFileTreeState = async (fn) => {
  const tree = Terra.f.getFileTreeInstance();
  if (!tree) {
    return await fn();
  }

  // Iterate through all nodes in the tree and obtain all expanded folder
  // nodes their absolute path.
  const prevExpandedFolderPaths = [];

  tree.visit((node) => {
    if (node.data.isFolder && node.expanded) {
      prevExpandedFolderPaths.push(Terra.vfs.getAbsoluteFolderPath(node.key));
    }
  });

  await fn();

  // Expand all folder nodes again that were open (if they still exist).
  Terra.f.getFileTreeInstance().visit((node) => {
    if (node.data.isFolder && prevExpandedFolderPaths.includes(Terra.vfs.getAbsoluteFolderPath(node.key))) {
      node.setExpanded(true, { noAnimation: true });
    }
  });
}
