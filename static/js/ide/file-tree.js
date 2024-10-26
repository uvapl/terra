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
 * @param {string|null} [parentId] - The parent folder id.
 */
function createNewFileTreeFile(parentId = null) {
  if (hasLFS() && LFS.busy) return;

  // Create a new unique filename.
  let filename = 'Untitled';
  while (VFS.existsWhere({ parentId, name: filename })) {
    filename = incrementString(filename)
  }

  // Create the new file in the filesystem.
  const { id } = VFS.createFile({ name: filename, parentId });

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

  if (hasGitFSWorker()) {
    newChildProps.extraClasses = 'git-added';
  }

  // Append to the parent node if it exists, otherwise append to the root.
  const tree = getFileTreeInstance();
  if (parentId) {
    const parentNode = tree.getNodeByKey(parentId);
    parentNode.setExpanded();

    parentNode.addChildren(newChildProps);
  } else {
    tree.rootNode.addChildren(newChildProps);
  }

  sortFileTree();

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
function createNewFileTreeFolder(parentId = null) {
  if (hasLFS() && LFS.busy) return;

  // Create a new unique foldername.
  let foldername = 'Untitled';
  while (VFS.existsWhere({ parentId, name: foldername })) {
    foldername = incrementString(foldername)
  }

  // Create the new folder in the filesystem.
  const { id } = VFS.createFolder({ name: foldername, parentId });

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

  if (hasGitFSWorker()) {
    newChildProps.extraClasses = 'git-added';
  }

  // Append to the parent node if it exists, otherwise append to the root.
  const tree = getFileTreeInstance();
  if (parentId) {
    const parentNode = tree.getNodeByKey(parentId);
    parentNode.setExpanded();

    parentNode.addChildren(newChildProps);
  } else {
    tree.rootNode.addChildren(newChildProps);
  }

  sortFileTree();

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
function createFileTreeFromVFS(parentId = null) {
  const folders = VFS.findFoldersWhere({ parentId }).map((folder) => ({
    key: folder.id,
    title: folder.name,
    folder: true,
    data: {
      type: 'folder',
      isFolder: true,
    },
    children: createFileTreeFromVFS(folder.id),
  }));

  const files = VFS.findFilesWhere({ parentId }).map((file) => ({
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
function deleteFileTreeItem(node) {
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

  $modal.find('.cancel-btn').click(() => hideModal($modal));
  $modal.find('.confirm-btn').click(() => {
    if (node.data.isFile) {
      closeFileTab(node.key);
      VFS.deleteFile(node.key);
    } else if (node.data.isFolder) {
      closeFilesInFolderRecursively(node.key);
    }

    // Delete from the VFS.
    const fn = node.data.isFolder
      ? VFS.deleteFolder
      : VFS.deleteFile;
    fn(node.key);

    // Delete from the file tree.
    node.remove();

    hideModal($modal);
  });
}

/**
 * Close a single file tab by its fileId.
 *
 * @param {string} fileId - The file ID to close.
 */
function closeFileTab(fileId) {
  const tab = getAllEditorTabs().find((tab) => tab.container.getState().fileId === fileId);
  if (tab) {
    tab.parent.removeChild(tab);
  }
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
 * Create a contextmenu for the file tree. The contextmenu items created once
 * and are made visible throught the `visible` property.
 *
 * @see https://swisnl.github.io/jQuery-contextMenu/docs/items.html
 *
 * @returns {object} The contextmenu object.
 */
function createFileTreeContextMenuItems() {
  const isType = (type) => (key, opt) => {
    const node = $.ui.fancytree.getNode(opt.$trigger[0]);
    return node.data.type === type;
  };

  const isFolder = isType('folder');
  const isFile = isType('file');
  const getNode = (opt) => $.ui.fancytree.getNode(opt.$trigger[0]);

  const folderMenuItems = {
    createFile: {
      name: 'New File',
      visible: isFolder,
      callback: (itemKey, opt, event) => createNewFileTreeFile(getNode(opt).key),
    },

    createFolder: {
      name: 'New Folder',
      visible: isFolder,
      callback: (itemKey, opt, event) => createNewFileTreeFolder(getNode(opt).key),
    },

    downloadFolder: {
      name: 'Download',
      visible: isFolder,
      callback: (itemKey, opt, event) => VFS.downloadFolder(getNode(opt).key),
    },
  };

  const fileMenuItems = {
    downloadFile: {
      name: 'Download',
      visible: isFile,
      callback: (itemKey, opt, event) => VFS.downloadFile(getNode(opt).key),
    },
    run: {
      name: 'Run',
      visible: (key, opt) => {
        const node = getNode(opt);
        return isFile(key, opt) && hasWorker(getFileExtension(node.title));
      },
      callback: (itemKey, opt, event) => runCode(getNode(opt).key)
    }
  }

  return {
    ...folderMenuItems,
    ...fileMenuItems,
    rename: {
      name: 'Rename',
      callback: (itemKey, opt, event) => {
        const node = getNode(opt);
        node.editStart();
      },
    },
    remove: {
      name: 'Delete',
      callback: (itemKey, opt, event) => deleteFileTreeItem(getNode(opt)),
    },
  };
}

/**
 * Sort folders before files and then alphabetically.
 */
function sortFileTree() {
  const tree = getFileTreeInstance();

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
function getFileTreeInstance() {
  return $.ui.fancytree.getTree("#file-tree");
}

/**
 * Instantiates the file tree with the files in the VFS using TreeJS.
 * If an existing instance already exists, only the data is updated and redrawn.
 *
 * @see https://wwwendt.de/tech/fancytree/doc/jsdoc/global.html#FancytreeOptions
 */
function createFileTree() {
  // Reload the tree if it already exists by re-importing from VFS.
  if (window._fileTree) {
    getFileTreeInstance().reload(createFileTreeFromVFS());
    return;
  }

  // Bind buttons for creating new folders/files.
  $('#file-tree--add-folder-btn').off('click').on('click', () => createNewFileTreeFolder());
  $('#file-tree--add-file-btn').off('click').on('click', () => createNewFileTreeFile());

  // Otherwise, instantiate a new tree.
  window._fileTree = $("#file-tree").fancytree({
    selectMode: 1,
    debugLevel: 0,
    strings: {
      noData: 'No files or folders found.'
    },
    source: createFileTreeFromVFS(),
    click: onClickNodeCallback,
    init: () => sortFileTree(),

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
      dragStart: dragStartCallback,
      dragEnter: dragEnterCallback,
      dragDrop: dragStopCallback,
      dragEnd: dragEndCallback,
    },

    // @see https://github-wiki-see.page/m/mar10/fancytree/wiki/ExtEdit
    edit: {
      triggerStart: ['dblclick'],
      edit: onStartEditNodeCallback,
      beforeClose: beforeCloseEditNodeCallback,
      close: () => sortFileTree(),
    },
  });

  // @see http://swisnl.github.io/jQuery-contextMenu/docs.html
  $.contextMenu({
    zIndex: 10,
    selector: "#file-tree span.fancytree-title",
    items: createFileTreeContextMenuItems(),
  });
}

/**
 * Add a visual indicator to the file tree for files and folder whether they are
 * added or modified in Git.
 *
 * @param {FancytreeNode} node - The node to add the indicator to.
 */
function addGitDiffIndicator(node) {
  const classes = node.extraClasses ? node.extraClasses.split(' ') : []
  const parentClasses = node.parent.extraClasses ? node.parent.extraClasses.split(' ') : [];

  // Add modified classes for visual indicators.
  if (!classes.includes('git-added')) {
    node.extraClasses = classes.concat('git-added').join(' ');
    node.render();
  }

  // Add modified classes to parent folders.
  if (node.data.isFile && !node.parent.title === 'root' && !parentClasses.includes('git-added')) {
    node.parent.extraClasses = parentClasses.concat('git-modified').join(' ');
    node.parent.render();
  }
}

function beforeCloseEditNodeCallback(event, data) {
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
  const nameConflicts = VFS.findWhere({ parentId, name }, true);
  if (!isValidFilename(name)) {
    errorMsg = 'Name can\'t contain \\ / : * ? " < > |';
  } else if (nameConflicts.length > 0 && nameConflicts[0].id !== data.node.key) {
    errorMsg = `There already exists a "${name}" file or folder`;
  }

  if (errorMsg) {
    // Delete previous tooltip.
    if (isObject(window._renameNodeTippy)) {
      window._renameNodeTippy.destroy();
      window._renameNodeTippy = null;
    }

    // Create new tooltip.
    window._renameNodeTippy = tippy(data.node.span, {
      content: errorMsg,
      animation: false,
      showOnCreate: true,
      placement: 'right',
      theme: 'error',
    });

    return false;
  }

  const fn = data.node.data.isFolder
    ? VFS.updateFolder
    : VFS.updateFile;

  fn(data.node.key, { name });

  if (hasGitFSWorker()) {
    addGitDiffIndicator(data.node);
  }

  const tab = getAllEditorTabs().find((tab) => tab.container.getState().fileId === data.node.key);
  if (tab) {
    tab.container.setTitle(name);

    // For some reason no update is triggered, so we trigger an update.
    window._layout.emit('stateChanged');
  }

  // Destroy the leftover tooltip if it exists.
  if (isObject(window._renameNodeTippy)) {
    window._renameNodeTippy.destroy();
    window._renameNodeTippy = null;
  }

  return true;
}

/**
 * Callback when the user starts editing a node in the file tree.
 */
function onStartEditNodeCallback(event, data) {
  if (window._fileTreeToggleTimeout) {
    clearTimeout(window._fileTreeToggleTimeout);
  }

  data.input.select();
}

/**
 * Callback when the user clicks on a node in the file tree.
 *
 * @param {[TODO:type]} event - [TODO:description]
 * @param {[TODO:type]} data - [TODO:description]
 */
function onClickNodeCallback(event, data) {
  // Prevent default behavior for folders.
  if (data.node.data.isFile) {
    openFile(data.node.key, data.node.title);
  } else if (data.node.data.isFolder) {
    if (window._fileTreeToggleTimeout) {
      clearTimeout(window._fileTreeToggleTimeout);
    }

    // Only toggle with a debounce of 200ms when clicked on the title
    // to prevent double-clicks.
    if (event.originalEvent.target.classList.contains('fancytree-title')) {
      window._fileTreeToggleTimeout = setTimeout(() => data.node.toggleExpanded(), 200);
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
function dragEnterCallback(targetNode, data) {
  // Add a visual drag area indicator.

  $(`.${DROP_AREA_INDICATOR_CLASS}`).removeClass(DROP_AREA_INDICATOR_CLASS);

  if ((targetNode.parent.title === 'root' && targetNode.data.isFile) || targetNode.title === 'root') {
    $('#file-tree').addClass(DROP_AREA_INDICATOR_CLASS);
  }
  else if (targetNode.data.isFile) {
    $(targetNode.parent.li).addClass(DROP_AREA_INDICATOR_CLASS);
  }
  else if (targetNode.data.isFolder) {
    $(targetNode.li).addClass(DROP_AREA_INDICATOR_CLASS);
  }

  // Check if there exists already a file with the same name on the
  // target folder. If so, prevent dropping.
  const sourceNode = data.otherNode;
  const containsDuplicate = (
    (
      targetNode.data.isFile &&
      VFS.existsWhere({
        parentId: targetNode.parent.title === 'root' ? null : targetNode.parent.key,
        name: sourceNode.title
      }, sourceNode.key)
    )
      ||
    (
      targetNode.data.isFolder &&
      VFS.existsWhere({
        parentId: targetNode.key,
        name: sourceNode.title
      }, sourceNode.key)
    )
  );

  if (isObject(window._dndDuplicateTippy)) {
    window._dndDuplicateTippy.destroy();
    window._dndDuplicateTippy = null;
  }

  if (containsDuplicate) {
    // Create new tooltip.
    const tooltipElement = targetNode.parent.title === 'root'
      ? $('.file-tree-container .title')[0]
      : (targetNode.data.isFile ? targetNode.parent.span : targetNode.span);

    window._dndDuplicateTippy = tippy(tooltipElement, {
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
function dragStartCallback(node, data) {
  // Set custom drag image.
  data.dataTransfer.setDragImage($(`<div class="custom-drag-helper">${node.title}</div>`).appendTo("body")[0], -10, -10);
  data.useDefaultImage = false;

  // Return true to enable dnd.
  return true;
}

/**
 * Callback when the user stops dragging a node in the file tree.
 */
function dragEndCallback() {
  // Remove the visual drag area indicator.
  $(`.${DROP_AREA_INDICATOR_CLASS}`).removeClass(DROP_AREA_INDICATOR_CLASS);

  if (isObject(window._dndDuplicateTippy)) {
    window._dndDuplicateTippy.destroy();
    window._dndDuplicateTippy = null;
  }

  sortFileTree()
}

/**
 * Callback when the user stops dragging and dropping a node in the file tree.
 *
 * @param {FancytreeNode} targetNode - The node where the other node was dropped
 * @param {object} data - The data object containing the source node.
 */
function dragStopCallback(targetNode, data) {
  const sourceNode = data.otherNode;

  // If the dropped node became a root node, unset parentId.
  let parentId = (targetNode.data.isFolder)
    ? targetNode.key
    : (targetNode.parent.title === 'root' ? null : targetNode.parent.key);

  const id = sourceNode.key;
  const fn = sourceNode.data.isFolder
    ? VFS.updateFolder
    : VFS.updateFile;

  fn(id, { parentId });

  if (hasGitFSWorker()) {
    addGitDiffIndicator(sourceNode);
  }

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
