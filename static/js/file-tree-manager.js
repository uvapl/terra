import { DROP_AREA_INDICATOR_CLASS } from './ide/constants.js';
import { getFileExtension, hasLFSApi, isObject, isValidFilename } from './helpers/shared.js'
import { createModal, hideModal, showModal } from './modal.js'
import { getAllEditorTabs, openFile, runCode } from './helpers/editor-component.js'
import VFS from './vfs.js'
import LFS from './lfs.js'
import Terra from './terra.js'
import { hasWorker } from './lang-worker-api.js';

class FileTreeManager {
  /**
   * Reference to the FancyTree instance.
   * @type {FancyTree}
   */
  tree = null;

  /**
   * Increment the number in a string with the pattern `XXXXXX (N)`.
   *
   * @example _this._incrementString('Untitled')     -> 'Untitled (1)'
   * @example _this._incrementString('Untitled (1)') -> 'Untitled (2)'
   *
   * @param {string} string - The string to update.
   * @returns {string} The updated string containing the number.
   */
  _incrementString = (string) => {
    const match = /\((\d+)\)$/g.exec(string);

    if (match) {
      const num = parseInt(match[1]) + 1;
      return string.replace(/\d+/, num);
    }

    return `${string} (1)`;
  }

  /**
   * Set the file tree title.
   *
   * @param {string} title - The title to set.
   */
  setTitle = (title) => {
    $('#file-tree-title').text(title);
  }

  /**
   * Removes the local storage warning from the DOM.
   */
  removeLocalStorageWarning = () => {
    $('.file-tree-container').removeClass('localstorage-mode')
    $('#local-storage-warning').remove();
  }

  /**
   * Add the local storage warning to the DOM.
   */
  showLocalStorageWarning = () => {
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

  destroyTree = () => {
    const tree = this.getInstance();
    if (tree) {
      $('#file-tree').fancytree('destroy');
      this.tree = null;
    }
  }

  /**
   * Create a new file element in the file tree and trigger edit mode.
   *
   * @param {string|null} [parentId] - The parent folder id.
   */
  createFile = (parentId = null) => {
    if (LFS.busy) return;

    // Create a new unique filename.
    let filename = 'Untitled';
    while (VFS.existsWhere({ parentId, name: filename })) {
      filename = this._incrementString(filename);
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

    // Append to the parent node if it exists, otherwise append to the root.
    const tree = this.getInstance();
    if (parentId) {
      const parentNode = tree.getNodeByKey(parentId);
      parentNode.setExpanded();

      parentNode.addChildren(newChildProps);
    } else {
      tree.rootNode.addChildren(newChildProps);
    }

    // Reload tree such that the 'No files or folders found' is removed in case
    // there were no files, but a new has been created.
    this.createFileTree();

    this.sortFileTree();

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
  createFolder = (parentId = null) => {
    if (LFS.busy) return;

    // Create a new unique foldername.
    let foldername = 'Untitled';
    while (VFS.existsWhere({ parentId, name: foldername })) {
      foldername = this._incrementString(foldername);
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

    // Append to the parent node if it exists, otherwise append to the root.
    const tree = this.getInstance();
    if (parentId) {
      const parentNode = tree.getNodeByKey(parentId);
      parentNode.setExpanded();

      parentNode.addChildren(newChildProps);
    } else {
      tree.rootNode.addChildren(newChildProps);
    }

    // Reload tree such that the 'No files or folders found' is removed in case
    // there were no files, but a new has been created.
    this.createFileTree();

    this.sortFileTree();

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
  createFromVFS = (parentId = null) => {
    const folders = VFS.findFoldersWhere({ parentId }).map((folder) => ({
      key: folder.id,
      title: folder.name,
      folder: true,
      data: {
        type: 'folder',
        isFolder: true,
      },
      children: this.createFromVFS(folder.id),
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
  deleteNode = (node) => {
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
        closeFileTab(node.key);
        VFS.deleteFile(node.key);
      } else if (node.data.isFolder) {
        this.closeFilesInFolderRecursively(node.key);
      }

      // Delete from the VFS.
      const fn = node.data.isFolder
        ? VFS.deleteFolder
        : VFS.deleteFile;
      fn(node.key);

      // Delete from the file tree.
      node.remove();

      hideModal($modal);
      Terra.v.blockLFSPolling = false;

      // Reload tree such that the 'No files or folders found' becomes visible
      // when needed.
      this.createFileTree();
    });
  }

  /**
   * Close a single file tab by its fileId.
   *
   * @param {string} fileId - The file ID to close.
   */
  closeFileTab = (fileId) => {
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
  closeFilesInFolderRecursively = (folderId) => {
    const files = VFS.findFilesWhere({ parentId: folderId });
    for (const file of files) {
      closeFileTab(file.id);
    }

    const folders = VFS.findFoldersWhere({ parentId: folderId });
    for (const folder of folders) {
      this.closeFilesInFolderRecursively(folder.id);
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
  _createContextMenuItems = ($trigger, event) => {
    const menu = {};
    const node = $.ui.fancytree.getNode($trigger[0]);
    const { isFolder, isFile } = node.data;

    if (isFolder) {
      menu.createFile = {
        name: 'New File',
        callback: () => {
          Terra.v.userClickedContextMenuItem = true;
          this.createFile(node.key);
        },
      };

      menu.createFolder = {
        name: 'New Folder',
        callback: () => {
          Terra.v.userClickedContextMenuItem = true;
          this.createFolder(node.key);
        },
      };

      if (!hasLFSApi() || (hasLFSApi() && !LFS.loaded)) {
        menu.downloadFolder = {
          name: 'Download',
          callback: () => {
            Terra.v.userClickedContextMenuItem = true;
            VFS.downloadFolder(node.key);
            Terra.v.blockLFSPolling = false;
          },
        };
      }
    }

    if (isFile) {
      if (!hasLFSApi() || (hasLFSApi() && !LFS.loaded)) {
        menu.downloadFile = {
          name: 'Download',
          callback: () => {
            Terra.v.userClickedContextMenuItem = true;
            VFS.downloadFile(node.key);
            Terra.v.blockLFSPolling = false;
          },
        };
      }

      if (hasWorker(getFileExtension(node.title))) {
        menu.run = {
          name: 'Run',
          callback: () => {
            Terra.v.userClickedContextMenuItem = true;
            runCode(node.key);
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
          this.deleteNode(node);
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
  sortFileTree = () => {
    const tree = this.getInstance();

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
  getInstance = () => {
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
  createFileTree = (forceRecreate = false) => {
    // Reload the tree if it already exists by re-importing from VFS.
    if (this.tree) {
      if (!forceRecreate) {
        // Always persist the tree state to prevent folders from being closed.
        this.runFuncWithPersistedState(async () => {
          this.getInstance().reload(this.createFromVFS());
        })
        return;
      } else {
        $('#file-tree .info-msg').remove();
        this.getInstance().destroy();
      }
    }

    // Bind buttons for creating new folders/files.
    $('#file-tree--add-folder-btn').off('click').on('click', () => this.createFolder());
    $('#file-tree--add-file-btn').off('click').on('click', () => this.createFile());

    // Otherwise, instantiate a new tree.
    this.tree = $("#file-tree").fancytree({
      selectMode: 1,
      debugLevel: 0,
      strings: {
        noData: 'Create a file to get started'
      },
      source: this.createFromVFS(),
      click: this._onClickNodeCallback,
      init: () => this.sortFileTree(),

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
        dragStart: this._dragStartCallback,
        dragEnter: this._dragEnterCallback,
        dragDrop: this._dragStopCallback,
        dragEnd: this._dragEndCallback,
      },

      // @see https://github-wiki-see.page/m/mar10/fancytree/wiki/ExtEdit
      edit: {
        triggerStart: ['dblclick'],
        edit: this._onStartEditNodeCallback,
        beforeClose: this._beforeCloseEditNodeCallback,
        close: this._afterCloseEditNodeCallback,
      },
    });

    // @see http://swisnl.github.io/jQuery-contextMenu/docs.html
    $.contextMenu({
      zIndex: 10,
      selector: '#file-tree span.fancytree-title',
      build: this._createContextMenuItems,
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
  _afterCloseEditNodeCallback = () => {
    this.sortFileTree(),
    Terra.v.blockLFSPolling = false;
  }

  /**
   * Callback before the user closes the edit mode of a node in the file tree.
   */
  _beforeCloseEditNodeCallback = (event, data) => {
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
    if (!isValidFilename(name)) {
      errorMsg = 'Name can\'t contain \\ / : * ? " < > |';
    } else if (VFS.existsWhere({ parentId, name }, { ignoreIds: data.node.key })) {
      errorMsg = `There already exists a "${name}" file or folder`;
    }

    if (errorMsg) {
      // Delete previous tooltip.
      if (isObject(Terra.v.renameNodeTippy)) {
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
      ? VFS.updateFolder
      : VFS.updateFile;

    fn(data.node.key, { name });

    const tab = getAllEditorTabs().find((tab) => tab.container.getState().fileId === data.node.key);
    if (tab) {
      tab.container.setTitle(name);
      const proglang = name.includes('.') ? getFileExtension(name) : 'text';
      tab.instance.setProgLang(proglang);

      // For some reason no update is triggered, so we trigger an update.
      Terra.app.layout.emit('stateChanged');
    }

    // Destroy the leftover tooltip if it exists.
    if (isObject(Terra.v.renameNodeTippy)) {
      Terra.v.renameNodeTippy.destroy();
      Terra.v.renameNodeTippy = null;
    }

    return true;
  }

  /**
   * Callback when the user starts editing a node in the file tree.
   */
  _onStartEditNodeCallback = (event, data) => {
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
  _onClickNodeCallback = (event, data) => {
    // Prevent default behavior for folders.
    if (data.node.data.isFile) {
      openFile(data.node.key, data.node.title);
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
  _dragEnterCallback = (targetNode, data) => {
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
        }, { ignoreIds: sourceNode.key })
      )
        ||
      (
        targetNode.data.isFolder &&
        VFS.existsWhere({
          parentId: targetNode.key,
          name: sourceNode.title
        }, { ignoreIds: sourceNode.key })
      )
    );

    if (isObject(Terra.v.dndDuplicateTippy)) {
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
  _dragStartCallback = (node, data) => {
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
  _dragEndCallback = () => {
    // Remove the visual drag area indicator.
    $(`.${DROP_AREA_INDICATOR_CLASS}`).removeClass(DROP_AREA_INDICATOR_CLASS);

    if (isObject(Terra.v.dndDuplicateTippy)) {
      Terra.v.dndDuplicateTippy.destroy();
      Terra.v.dndDuplicateTippy = null;
    }

    this.sortFileTree()
    Terra.v.blockLFSPolling = false;
  }

  /**
   * Callback when the user stops dragging and dropping a node in the file tree.
   *
   * @param {FancytreeNode} targetNode - The node where the other node was dropped
   * @param {object} data - The data object containing the source node.
   */
  _dragStopCallback = (targetNode, data) => {
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
  runFuncWithPersistedState = async (fn) => {
    const tree = this.getInstance();
    if (!tree) {
      return await fn();
    }

    // Iterate through all nodes in the tree and obtain all expanded folder
    // nodes their absolute path.
    const prevExpandedFolderPaths = [];

    tree.visit((node) => {
      if (node.data.isFolder && node.expanded) {
        prevExpandedFolderPaths.push(VFS.getAbsoluteFolderPath(node.key));
      }
    });

    await fn();

    // Expand all folder nodes again that were open (if they still exist).
    this.getInstance().visit((node) => {
      if (node.data.isFolder && prevExpandedFolderPaths.includes(VFS.getAbsoluteFolderPath(node.key))) {
        node.setExpanded(true, { noAnimation: true });
      }
    });
  }
}

export default new FileTreeManager();
