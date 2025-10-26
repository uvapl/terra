import { DROP_AREA_INDICATOR_CLASS } from './ide/constants.js';
import { getFileExtension, getPartsFromPath, isValidFilename } from './helpers/shared.js'
import { createModal, hideModal, showModal } from './modal.js'
import Terra from './terra.js'
import LangWorker from './lang-worker.js';
import EditorComponent from './layout/editor.component.js';
import { createTooltip, destroyTooltip } from './tooltip-manager.js';

/**
 * Reference to the FancyTree instance.
 * @type {FancyTree}
 */
let tree = null;

setupFileDrop();

// ===========================================================================
// Functions
// ===========================================================================

/**
 * Since FancyTree handles DnD on a node-level, we need another droparea that
 * allows dropping files/folders from the filesystem onto the file tree.
 */
export function setupFileDrop() {
  const $dropzone = $('#file-dropzone');

  // The datatransfer.types will be ['Files'] if the user is dragging a local
  // filesystem file/folder onto this area.
  const isLocalFileSystemDrag = (e) =>
    e.originalEvent.dataTransfer.types.includes('Files');

  $dropzone.on('dragover', (e) => {
    if (!isLocalFileSystemDrag(e)) return;

    // This prevents the browser from opening the file.
    e.preventDefault();
    e.stopPropagation();
  });

  $dropzone.on('dragenter', (e) => {
    if (!isLocalFileSystemDrag(e)) return;

    $('#file-tree').addClass(DROP_AREA_INDICATOR_CLASS);
    $dropzone.addClass('drag-over');
  });

  $dropzone.on('dragleave', (e) => {
    if (!isLocalFileSystemDrag(e)) return;

    $(`.${DROP_AREA_INDICATOR_CLASS}`).removeClass(DROP_AREA_INDICATOR_CLASS);
    $dropzone.removeClass('drag-over');
  });

  $dropzone.on('drop', (e) => {
    if (!isLocalFileSystemDrag(e)) return;

    e.preventDefault();
    e.stopPropagation();

    $(`.${DROP_AREA_INDICATOR_CLASS}`).removeClass(DROP_AREA_INDICATOR_CLASS);
    $dropzone.removeClass('drag-over');

    const files = e.originalEvent.dataTransfer.items;
    for (var i = 0; i < files.length; i++) {
      const item = getDataTransferFileEntry(files[i]);
      if (!item) continue;
      _createFileSystemEntryInVFS(item).then(() => {
        createFileTree();
      });
    }
  });
}

/**
 * Get the FileSystemEntry from a DataTransferItem.
 *
 * Note: webkitGetAsEntry() is also implemented in non-Webkit browsers; it may
 * be renamed to getAsEntry() in the future, so we should look for both.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/webkitGetAsEntry
 *
 * @param {DataTransferItem} file - The file to get the entry from.
 * @returns {FileSystemEntry|null} The file entry or null if not available.
 */
function getDataTransferFileEntry(file) {
  if (file.webkitGetAsEntry) {
    return file.webkitGetAsEntry();
  } else if (file.getAsEntry) {
    return file.getAsEntry();
  }

  // Dropped file isn't a file or it's not in read or read/write mode.
  return null;
}

/**
 * Set the file tree title.
 *
 * @param {string} title - The title to set.
 */
export function setTitle(title) {
  $('#file-tree-title').text(title);
}

/**
 * Set an info message in the file tree.
 *
 * @param {string} msg - The message to display.
 */
export function setInfoMsg(msg) {
  const tree = getInstance();
  if (tree) {
    tree.destroy();
  }
  $('#file-tree').html(`<div class="info-msg">${msg}</div>`);
}

/**
 * Set an error message in the file tree.
 *
 * @param {string} msg - The message to display.
 */
export function setErrorMsg(err) {
  const tree = getInstance();
  if (tree) {
    tree.destroy();
  }
  $('#file-tree').html(`<div class="info-msg error">${err}</div>`);
}

/**
 * Remove the info message.
 */
export function removeInfoMsg() {
  $('#file-tree .info-msg').remove();
}

/**
 * Indicates whether the file tree has an info message.
 *
 * @returns {boolean} True if the file tree has an info message, false otherwise.
 */
export function hasInfoMsg() {
  return $('#file-tree .info-msg').length > 0;
}

/**
 * Removes the bottom message from the DOM.
 */
export function removeBottomMsg() {
  $('.file-tree-container').removeClass('has-bottom-msg')
  $('#file-tree-bottom-msg').remove();
}

/**
 * Show a message at the bottom of the file-tree.
 */
export function showBottomMsg(msg) {
  if (hasBottomMsg()) {
    $('#file-tree-bottom-msg').html(msg);
    return;
  };

  const html = `<div id="file-tree-bottom-msg" class="file-tree-bottom-msg"><p>${msg}</p></div>`;

  $('.file-tree-container').addClass('has-bottom-msg').append(html);
}

/**
 * Checks if the file tree has a bottom message.
 */
export function hasBottomMsg() {
  return $('#file-tree-bottom-msg').length > 0;
}

/**
 * Removes the local storage warning from the DOM.
 */
export function removeLocalStorageWarning() {
  $('.file-tree-container').removeClass('localstorage-mode')
  $('#local-storage-warning').remove();
}

/**
 * Add the local storage warning to the DOM.
 */
export function showLocalStorageWarning() {
  if ($('#local-storage-warning').length > 0) return;

  const html = `
    <div id="local-storage-warning" class="local-storage-warning">
      <div class="warning-title">
        <img src="static/img/icons/warning.png" alt="warning icon" class="warning-icon" /> Warning
      </div>
      <p>
        You're currently using temporary browser storage. Clearing website data will
        delete project files and folders permanently.
      </p>
    </div>
  `;

  $('.file-tree-container').addClass('localstorage-mode').append(html);
}

export function destroyTree() {
  const tree = getInstance();
  if (tree) {
    $('#file-tree').fancytree('destroy');
    tree = null;
  }
}

/**
 * Create a new file element in the file tree and trigger edit mode.
 *
 * @example createFile('path/to/file.txt')
 * @example createFile('file.txt')
 *
 * Creates a new Untitled file in the root folder
 * @example createFile()
 *
 * @async
 * @param {string|null} [path] - The path for the new file. Leave null to
 * create a new file in the root folder.
 */
async function createFile(path = null) {
  // Create the new file in the filesystem.
  const parentPath = path ? path.split('/').slice(0, -1).join('/') : null;

  const fileName = await Terra.app.vfs.createFile(path);
  const key = parentPath ? `${parentPath}/${fileName}` : fileName;

  // Create the new node in the file tree.
  const newChildProps = {
    key,
    title: fileName,
    folder: false,
    data: {
      type: 'file',
      isFile: true,
    },
  };

  // Append to the parent node if it exists, otherwise append to the root.
  const tree = getInstance();
  if (parentPath) {
    const parentNode = tree.getNodeByKey(parentPath);
    parentNode.addChildren(newChildProps);

    if (!parentNode.expanded) {
      parentNode.setExpanded();
    }
  } else {
    tree.rootNode.addChildren(newChildProps);
  }

  // Reload tree such that the 'No files or folders found' is removed in case
  // there were no files, but a new has been created.
  await createFileTree();

  const newNode = tree.getNodeByKey(key);

  sortFileTree();

  Terra.app.openFile(key);

  // Trigger edit mode for the new node.
  setTimeout(() => {
    newNode.editStart();
  }, 100);
}

/**
 * Get the absolute path of a node.
 *
 * @param {string} key - The key of the node.
 * @returns {string} The absolute path.
 */
function getAbsoluteNodePath(node) {
  if (!node.parent) return node.title;

  let parentPath = getAbsoluteNodePath(node.parent);
  return parentPath.startsWith('root') ? node.title : `${parentPath}/${node.title}`;
}

/**
 * Create a new folder element in the file tree and trigger edit mode.
 * @example createFolder('path/to/newFolder')
 * @example createFolder('newFolder')
 *
 * Creates a new Untitled folder in the root folder
 * @example createFolder()
 *
 * @async
 * @param {string|null} [path] - The path for the new folder. Leave
 * null to create a new folder in the root folder.
 */
export async function createFolder(path = null) {
  const parentPath = path ? path.split('/').slice(0, -1).join('/') : null;

  // Create the new folder in the filesystem.
  const folder = await Terra.app.vfs.createFolder(path);
  const key = parentPath ? `${parentPath}/${folder.name}` : folder.name;

  // Create the new node in the file tree.
  const newChildProps = {
    key,
    title: folder.name,
    folder: true,
    data: {
      type: 'folder',
      isFolder: true,
    },
  };

  // Append to the parent node if it exists, otherwise append to the root.
  const tree = getInstance();
  if (parentPath) {
    const parentNode = tree.getNodeByKey(parentPath);
    parentNode.setExpanded();
    parentNode.addChildren(newChildProps);
  } else {
    tree.rootNode.addChildren(newChildProps);
  }

  // Reload tree such that the 'No files or folders found' is removed in case
  // there were no files, but a new has been created.
  await createFileTree();

  sortFileTree();

  // Trigger edit mode for the new node.
  const newNode = tree.getNodeByKey(key);

  // Check again if the parent node is expanded, because the node might have
  // been added to a closed folder. Only then we can trigger editStart().
  if (parentPath) {
    tree.getNodeByKey(parentPath).setExpanded();
  }

  newNode.editStart();
}

/**
 * Create a file tree list from the VFS compatible with FancyTree.
 *
 * @returns {Promise<array>} List with file tree objects.
 */
async function createFromVFS() {
  const basicTree = await Terra.app.vfs.getFileTree();

  /**
   * Convert a minimal file tree into FancyTree-compatible format.
   *
   * @param {object[]} tree - Minimal tree (title, folder, children).
   * @param {string} path - Path prefix for keys.
   * @returns {object[]} FancyTree-compatible structure.
   */
  function toFancyTree(tree, path = '') {
    return tree.map((node) => {
      const key = path ? `${path}/${node.title}` : node.title;
      const isFolder = node.folder;

      return {
        key,
        title: node.title,
        folder: isFolder,
        data: {
          type: isFolder ? 'folder' : 'file',
          isFolder,
          isFile: !isFolder,
        },
        ...(isFolder && node.children
          ? { children: toFancyTree(node.children, key) }
          : {}),
      };
    });
  }

  return toFancyTree(basicTree);
}

/**
 * Delete a file tree item from the VFS and the file tree. When the node is a
 * file and its corresponding tab is open, then it'll be closed.
 *
 * @param {FancytreeNode} node - The node to delete.
 */
function deleteNode(node) {
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
    Terra.v.blockFSPolling = false;
    hideModal($modal);
  });

  $modal.find('.confirm-btn').click(async () => {
    if (node.data.isFile) {
      Terra.app.closeFile(node.key);
    } else if (node.data.isFolder) {
      await Terra.app.closeFilesFromFolder(node.key);
    }

    // Delete from the VFS.
    const fn = node.data.isFolder
      ? Terra.app.vfs.deleteFolder
      : Terra.app.vfs.deleteFile;
    await fn(node.key);

    // Delete from the file tree.
    node.remove();

    hideModal($modal);
    Terra.v.blockFSPolling = false;

    // Reload tree such that the 'No files or folders found' becomes visible
    // when needed.
    await createFileTree();
  });
}

/**
 * Create a contextmenu for the file tree. The contextmenu items created
 * dynamically when the user right-clicks on a file or folder in the file tree.
 *
 * @see https://swisnl.github.io/jQuery-contextMenu/docs/items.html
 *
 * @returns {object} The contextmenu object.
 */
function _createContextMenuItems($trigger, event) {
  const menu = {};
  const node = $.ui.fancytree.getNode($trigger[0]);
  const { isFolder, isFile } = node.data;

  if (isFolder) {
    menu.createFile = {
      name: 'New File',
      callback: () => {
        Terra.v.userClickedContextMenuItem = true;
        const parentPath = node.key;
        const newPath = parentPath.startsWith('root') ? 'Untitled' : `${parentPath}/Untitled`;
        createFile(newPath);
      },
    };

    menu.createFolder = {
      name: 'New Folder',
      callback: () => {
        Terra.v.userClickedContextMenuItem = true;
        const parentPath = node.key;
        const newPath = parentPath.startsWith('root') ? 'Untitled' : `${parentPath}/Untitled`;
        createFolder(newPath);
      },
    };

    if (!Terra.app.hasLFSProjectLoaded) {
      menu.downloadFolder = {
        name: 'Download',
        callback: () => {
          Terra.v.userClickedContextMenuItem = true;
          Terra.app.vfs.downloadFolder(node.key);
          Terra.v.blockFSPolling = false;
        },
      };
    }
  }

  if (isFile) {
    if (!Terra.app.hasLFSProjectLoaded) {
      menu.downloadFile = {
        name: 'Download',
        callback: () => {
          Terra.v.userClickedContextMenuItem = true;
          Terra.app.vfs.downloadFile(node.key);
          Terra.v.blockFSPolling = false;
        },
      };
    }

    if (LangWorker.hasWorker(getFileExtension(node.title))) {
      menu.run = {
        name: 'Run',
        callback: () => {
          Terra.v.userClickedContextMenuItem = true;
          Terra.app.runCode({ fileId: node.key });
          Terra.v.blockFSPolling = false;
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
        deleteNode(node);
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
function sortFileTree() {
  const tree = getInstance();

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
function getInstance() {
  return $.ui.fancytree.getTree("#file-tree");
}

/**
 * Instantiates the file tree with the files in the VFS using TreeJS.
 * If an existing instance already exists, only the data is updated and redrawn.
 *
 * @param {boolean} [forceRecreate=false] Enforce recreation of the file tree.
 * @param {boolean} [persistState=true] Whether to persist the state of the expanded folders.
 *
 * @see https://wwwendt.de/tech/fancytree/doc/jsdoc/global.html#FancytreeOptions
 */
export function createFileTree(forceRecreate = false, persistState = true) {
  return new Promise((resolve) => {
    // Reload the tree if it already exists by re-importing from VFS.
    if (tree) {
      if (!forceRecreate) {
        const reloadTree = () => createFromVFS().then((data) => {
          getInstance().reload(data);
        });

        // Persist the tree state to prevent folders from being closed.
        if (persistState) {
          runFuncWithPersistedState(reloadTree).then(() => {
            resolve();
          });
        } else {
          reloadTree();
          resolve();
        }
        return;
      } else {
        removeInfoMsg();
      }
    }

    // Bind buttons for creating new folders/files.
    $('#file-tree--add-folder-btn').off('click').on('click', () => createFolder());
    $('#file-tree--add-file-btn').off('click').on('click', () => createFile());

    // Otherwise, instantiate a new tree.
    tree = $("#file-tree").fancytree({
      selectMode: 1,
      debugLevel: 0,
      strings: {
        noData: 'Create a file to get started'
      },
      source: createFromVFS(),
      click: _onClickNodeCallback,
      init: () => {
        sortFileTree();
        resolve();
      },

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
        dragStart: _dragStartCallback,
        dragEnter: _dragEnterCallback,
        dragDrop: _dragStopCallback,
        dragEnd: _dragEndCallback,
      },

      // @see https://github-wiki-see.page/m/mar10/fancytree/wiki/ExtEdit
      edit: {
        triggerStart: ['dblclick'],
        edit: _onStartEditNodeCallback,
        beforeClose: _beforeCloseEditNodeCallback,
        close: _afterCloseEditNodeCallback,
      },
    });

    // @see http://swisnl.github.io/jQuery-contextMenu/docs.html
    $.contextMenu({
      zIndex: 10,
      selector: '#file-tree span.fancytree-title',
      build: _createContextMenuItems,
      events: {
        show: () => {
          Terra.v.blockFSPolling = true;
        },
        hide: () => {
          if (!Terra.v.userClickedContextMenuItem) {
            Terra.v.blockFSPolling = false;
          }
        }
      }
    });
  });
}

/**
 * Callback after the inline editor was removed.
 */
function _afterCloseEditNodeCallback() {
  sortFileTree(),
  Terra.v.blockFSPolling = false;
}

/**
 * Check whether a file exists in the file tree in a given folder path.
 *
 * NOTE: The logic is ultimately identical to the VFS.pathExists(), but since
 * the dnd5 does not support async callbacks, this function is used instead.
 *
 * @param {string} name - The file name.
 * @param {string} parentPath - The folder path where to check for the file.
 * @param {string[]} [ignorePaths] - Paths to ignore in the parent path.
 * @returns {boolean} True if the file exists, false otherwise.
 */
function _nodePathExists(name, parentPath, ignorePaths = []) {
  const tree = getInstance();
  const parentNode = tree.getNodeByKey(parentPath);
  if (!parentNode) return false;

  const childNodes = parentNode.children || [];
  for (const node of childNodes) {
    // Check if the name matches the child node's title.
    if (node.title === name && !ignorePaths.includes(node.key)) {
      return true;
    }
  }

  return false;
}

/**
 * Callback before the user closes the edit mode of a node in the file tree.
 */
function _beforeCloseEditNodeCallback(event, data) {
  // Check if user pressed cancel or text is unchanged.
  if (!data.save) return;

  const sourceNode = data.node;
  const newName = data.input.val().trim();
  const oldName = sourceNode.title;

  if (!newName) {
    // If no name has been filled in, return false.
    // In this case, the old file name will be kept.
    destroyTooltip('renameNode');
    return false;
  }

  if (oldName === newName) {
    // Nothing changes, return true to close the edit.
    destroyTooltip('renameNode');
    return true;
  }

  let errorMsg;

  // Check if the name already exists in the parent folder.
  // If so, trigger edit mode again and show error tooltip.
  const parentNodeKey = sourceNode.parent.key;
  if (!isValidFilename(newName)) {
    errorMsg = 'Name can\'t contain \\ / : * ? " < > |';
  } else if (_nodePathExists(newName, parentNodeKey)) {
    errorMsg = `There already exists a "${newName}" file or folder`;
  }

  if (errorMsg) {
    createTooltip('renameNode', sourceNode.span, errorMsg, {
      placement: 'right',
      theme: 'error',
    });
    return false;
  }

  const fn = sourceNode.data.isFolder
    ? Terra.app.vfs.moveFolder
    : Terra.app.vfs.moveFile;

  const srcPath = sourceNode.key;
  const parentPath = parentNodeKey.startsWith('root') ? null : parentNodeKey;
  const destPath = parentPath ? `${parentPath}/${newName}` : newName;

  fn(srcPath, destPath).then(() => {
    // Update the node's path (recurively).
    if (sourceNode.data.isFile) {
      sourceNode.key = destPath;

      // If the moved file is also the active editor tab, update the tab's
      // filename and path in-place.
      _updateOpenTab(srcPath, destPath);
    } else if (sourceNode.data.isFolder) {
      _updateFolderKeysRecursively(sourceNode);
    }
  });

  // Destroy the leftover tooltip if it exists.
  destroyTooltip('renameNode');

  return true;
}

/**
 * Update the open tab's filename and path when a file is renamed.
 *
 * @param {string} srcPath - The source path of the file.
 * @param {string} destPath - The destination path of the file.
 */
function _updateOpenTab(srcPath, destPath) {
  // Find the tab component that corresponds to the file.
  const tabComponent = Terra.app.getTabComponents().find(
    (tabComponent) => tabComponent.getPath() === srcPath
  );

  // Update it if it exists.
  if (tabComponent) {
    const newName = getPartsFromPath(destPath).name;
    tabComponent.setPath(destPath);

    if (tabComponent instanceof EditorComponent) {
      const proglang = newName.includes('.') ? getFileExtension(newName) : 'text';
      tabComponent.setProgLang(proglang);
      Terra.app.createLangWorker(proglang);
    }

    // For some reason no update is triggered, so we trigger it manually.
    // This will reload the content if needed.
    Terra.app.layout.emit('stateChanged');
  }
}

/**
 * Callback when the user starts editing a node in the file tree.
 */
function _onStartEditNodeCallback(event, data) {
  Terra.v.blockFSPolling = true;
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
function _onClickNodeCallback(event, data) {
  // Prevent default behavior for folders.
  if (data.node.data.isFile) {
    Terra.app.openFile(data.node.key);
  } else if (data.node.data.isFolder) {
    clearTimeout(Terra.v.fileTreeToggleTimeout);

    // Only toggle with a debounce of 200ms when clicked on the title
    // to prevent double-clicks.
    if (event.originalEvent.target.classList.contains('fancytree-title')) {
      Terra.v.fileTreeToggleTimeout = setTimeout(() => {
        Terra.v.blockFSPolling = true;
        data.node.toggleExpanded();

        // Unblock LFS polling after the animation has completed.
        setTimeout(() => {
          Terra.v.blockFSPolling = false;
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
function _dragEnterCallback(targetNode, data) {
  // Remove all existing visual drag area indicators.
  $(`.${DROP_AREA_INDICATOR_CLASS}`).removeClass(DROP_AREA_INDICATOR_CLASS);

  // Add a visual drag area indicator.
  if ((targetNode.parent.title.startsWith('root') && targetNode.data.isFile) || targetNode.title === 'root') {
    $('#file-tree').addClass(DROP_AREA_INDICATOR_CLASS);
  }
  else if (targetNode.data.isFile) {
    $(targetNode.parent.li).addClass(DROP_AREA_INDICATOR_CLASS);
  }
  else if (targetNode.data.isFolder) {
    $(targetNode.li).addClass(DROP_AREA_INDICATOR_CLASS);
  }

  // NOTE: sourceNode is undefined when user drags a filesystem file/folder
  // onto the file tree. Additionally, for security reasons, the `data.files`
  // list remains empty during dragEnter and dragOver events, so there is no
  // way to check for a duplicate in this case. Essentially it just creates
  // the file with "(1)" appended to it if a file with the same name already
  // exists in the folder.
  const sourceNode = data.otherNode;

  if (sourceNode) {
    // Prevent dropping if there exists already a file with the same name on
    // the target folder.
    const containsDuplicate = (
      (
        targetNode.data.isFile &&
        _nodePathExists(sourceNode.title, targetNode.parent.key, [sourceNode.key])
      )
      ||
      (
        targetNode.data.isFolder &&
        _nodePathExists(sourceNode.title, targetNode.key, [sourceNode.key])
      )
    );

    destroyTooltip('dndDuplicate');

    if (containsDuplicate) {
      // Create new tooltip.
      const anchor = targetNode.data.isFile
        ? (targetNode.parent.title.startsWith('root') ? $('.file-tree-container .title')[0] : targetNode.parent.span)
        : targetNode.span;

      const msg = `There already exists a "${sourceNode.title}" file or folder`;
      createTooltip('dndDuplicate', anchor, msg, {
        placement: 'right',
        theme: 'error',
      });

      return false;
    }
  }

  return true;
}

/**
 * Callback when the user starts dragging a node in the file tree.
 */
function _dragStartCallback(node, data) {
  Terra.v.blockFSPolling = true;

  // Set custom drag image.
  data.dataTransfer.setDragImage($(`<div class="custom-drag-helper">${node.title}</div>`).appendTo("body")[0], -10, -10);
  data.useDefaultImage = false;

  // Return true to enable dnd.
  return node.statusNodeType !== 'nodata';
}

/**
 * Callback when the user stops dragging a node in the file tree.
 */
function _dragEndCallback() {
  // Remove the visual drag area indicator.
  $(`.${DROP_AREA_INDICATOR_CLASS}`).removeClass(DROP_AREA_INDICATOR_CLASS);

  $('.custom-drag-helper').remove();
  destroyTooltip('dndDuplicate');
  sortFileTree()
  Terra.v.blockFSPolling = false;
}

/**
 * Create a file or folder in the VFS from a FileSystemFileEntry object.
 *
 * @param {FileSystemFileEntry} item - The file or folder entry.
 * @param {string} [path] - The path of the entry.
 * @param {string} [targetNodePath] - The path of the node it was dropped onto.
 * @return {Promise<void>} Resolves when the file or folder has been created.
 */
function _createFileSystemEntryInVFS(item, path = '', targetNodePath = null) {
  return new Promise((resolve) => {
    if (item.isFile) {
      item.file((file) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const buffer = e.target.result;
          const destPath = [targetNodePath, path, file.name].filter((s) => s).join('/');
          Terra.app.vfs.createFile(destPath, buffer).then(() => {
            resolve();
          });
        };
        reader.readAsArrayBuffer(file);
      });
    } else if (item.isDirectory) {
      const dirReader = item.createReader();
      dirReader.readEntries(async (entries) => {
        for (const entry of entries) {
          const subpath = path ? `${path}/${item.name}` : item.name;
          await _createFileSystemEntryInVFS(entry, subpath, targetNodePath);
        }
        resolve();
      });
    }
  });
}

/**
 * Callback when the user stops dragging and dropping a node in the file tree.
 *
 * @param {FancytreeNode} targetNode - The node where the other node was dropped
 * @param {object} data - The data object containing the source node.
 */
function _dragStopCallback(targetNode, data) {
  const sourceNode = data.otherNode;

  const parentPath = (targetNode.data.isFolder)
    ? targetNode.key
    : (targetNode.parent.title.startsWith('root') ? null : targetNode.parent.key);

  if (data.files.length > 0) { // user dropped one or more filesystem file/folder
    for (var i = 0; i < data.files.length; i++) {
      const item = getDataTransferFileEntry(data.dataTransfer.items[i]);
      if (!item) continue
      _createFileSystemEntryInVFS(item, '', parentPath).then(() => {
        createFileTree();
      });
    }
  } else if (sourceNode) { // user moved a node in the file tree
    // If the dropped node became a root node, unset parentId.
    const srcPath = sourceNode.key;
    const fn = sourceNode.data.isFolder
      ? Terra.app.vfs.moveFolder
      : Terra.app.vfs.moveFile;

    const destPath = parentPath ? `${parentPath}/${sourceNode.title}` : sourceNode.title;

    if (srcPath == destPath) {
      // Nothing happened (rare case, but it might occur).
      return true;
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


    fn(srcPath, destPath).then(() => {
      // Update the node keys.
      if (sourceNode.data.isFile) {
        sourceNode.key = destPath;

        // If the moved file is also the active editor tab, update the tab's
        // filename and path in-place.
        _updateOpenTab(srcPath, destPath);
      } else if (sourceNode.data.isFolder) {
        _updateFolderKeysRecursively(sourceNode);
      }
    });
  }
}

/**
 * Update the folder key recursively for all child nodes.
 *
 * @param {FancytreeNode} folderNode - The folder node to update recursively.
 */
function _updateFolderKeysRecursively(folderNode) {
  folderNode.key = getAbsoluteNodePath(folderNode);

  const childNodes = folderNode.children || [];
  for (const childNode of childNodes) {
    if (childNode.data.isFolder) {
      _updateFolderKeysRecursively(childNode);
    } else {
      const srcPath = childNode.key;
      const destPath = getAbsoluteNodePath(childNode);
      childNode.key = destPath;
      _updateOpenTab(srcPath, destPath);
    }
  }
}

/**
 * Runs a given function while preserving the expanded state of folder nodes.
 *
 * @async
 * @param {Function} fn - Callable async function reference.
 * @returns {Promise<void>}
 */
export async function runFuncWithPersistedState(fn) {
  const tree = getInstance();
  if (!tree) {
    return await fn();
  }

  // Iterate through all nodes in the tree and obtain all expanded folder
  // nodes their absolute path.
  const prevExpandedFolderPaths = [];

  tree.visit((node) => {
    if (node.data.isFolder && node.expanded) {
      prevExpandedFolderPaths.push(node.key);
    }
  });

  await fn();

  // Expand all folder nodes again that were open (if they still exist).
  getInstance().visit((node) => {
    if (node.data.isFolder && prevExpandedFolderPaths.includes(node.key)) {
      node.setExpanded(true, { noAnimation: true });
    }
  });
}
