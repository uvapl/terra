import { DROP_AREA_INDICATOR_CLASS } from './ide/constants.js';
import { getFileExtension, getPartsFromPath, isValidFilename } from './helpers/shared.js'
import { createModal, hideModal, showModal } from './modal.js'
import Terra from './terra.js'
import LangWorker from './lang-worker.js';
import EditorComponent from './layout/editor.component.js';
import tooltipManager from './tooltip-manager.js';

class FileTreeManager {
  /**
   * Reference to the FancyTree instance.
   * @type {FancyTree}
   */
  tree = null;

  /**
   * Set the file tree title.
   *
   * @param {string} title - The title to set.
   */
  setTitle = (title) => {
    $('#file-tree-title').text(title);
  }

  /**
   * Set an info message in the file tree.
   *
   * @param {string} msg - The message to display.
   */
  setInfoMsg = (msg) => {
    this.getInstance().destroy();
    $('#file-tree').html(`<div class="info-msg">${msg}</div>`);
  }

  /**
   * Set an error message in the file tree.
   *
   * @param {string} msg - The message to display.
   */
  setErrorMsg = (err) => {
    this.getInstance().destroy();
    $('#file-tree').html(`<div class="info-msg error">${err}</div>`);
  }

  /**
   * Remove the info message.
   */
  removeInfoMsg = () => {
    $('#file-tree .info-msg').remove();
  }

  /**
   * Indicates whether the file tree has an info message.
   *
   * @returns {boolean} True if the file tree has an info message, false otherwise.
   */
  hasInfoMsg = () => $('#file-tree .info-msg').length > 0;

  /**
   * Removes the bottom message from the DOM.
   */
  removeBottomMsg = () => {
    $('.file-tree-container').removeClass('has-bottom-msg')
    $('#file-tree-bottom-msg').remove();
  }

  /**
   * Show a message at the bottom of the file-tree.
   */
  showBottomMsg = (msg) => {
    if (this.hasBottomMsg()) {
      $('#file-tree-bottom-msg').html(msg);
      return;
    };

    const html = `<div id="file-tree-bottom-msg" class="file-tree-bottom-msg"><p>${msg}</p></div>`;

    $('.file-tree-container').addClass('has-bottom-msg').append(html);
  }

  /**
   * Checks if the file tree has a bottom message.
   */
  hasBottomMsg = () => {
    return $('#file-tree-bottom-msg').length > 0;
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
  createFile = async (path = null) => {
    if (Terra.app.hasLFSProjectLoaded && Terra.app.lfs.busy) return;

    // Create the new file in the filesystem.
    const parentPath = path ? path.split('/').slice(0, -1).join('/') : null;

    const file = await Terra.app.vfs.createFile({ path });
    const key = parentPath ? `${parentPath}/${file.name}` : file.name;

    // Create the new node in the file tree.
    const newChildProps = {
      key,
      title: file.name,
      folder: false,
      data: {
        type: 'file',
        isFile: true,
      },
    };

    // Append to the parent node if it exists, otherwise append to the root.
    const tree = this.getInstance();
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
    await this.createFileTree();

    const newNode = tree.getNodeByKey(key);

    this.sortFileTree();

    // Trigger edit mode for the new node.
    setTimeout(() => {
      newNode.editStart();
    }, 0);
  }

  /**
   * Get the absolute path of a node.
   *
   * @param {string} key - The key of the node.
   * @returns {string} The absolute path.
   */
  getAbsoluteNodePath = (node) => {
    if (!node.parent) return node.title;

    let parentPath = this.getAbsoluteNodePath(node.parent);
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
  createFolder = async (path = null) => {
    if (Terra.app.hasLFSProjectLoaded && Terra.app.lfs.busy) return;

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
    const tree = this.getInstance();
    if (parentPath) {
      const parentNode = tree.getNodeByKey(parentPath);
      parentNode.setExpanded();
      parentNode.addChildren(newChildProps);
    } else {
      tree.rootNode.addChildren(newChildProps);
    }

    // Reload tree such that the 'No files or folders found' is removed in case
    // there were no files, but a new has been created.
    await this.createFileTree();

    this.sortFileTree();

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
   * @async
   * @param {string} [path] - The parent folder absolute path.
   * @returns {array} List with file tree objects.
   */
  createFromVFS = async (path = '') => {
    const folders = await Promise.all(
      (await Terra.app.vfs.findFoldersInFolder(path)).map(async (folder) => {
        const subpath = path ? `${path}/${folder.name}` : folder.name;
        return {
          key: subpath,
          title: folder.name,
          folder: true,
          data: {
            type: 'folder',
            isFolder: true,
          },
          children: (await this.createFromVFS(subpath)),
        };
      })
    )

    const files = (await Terra.app.vfs.findFilesInFolder(path)).map((file) => ({
      key: path ? `${path}/${file.name}` : file.name,
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
      Terra.v.blockFSPolling = false;
      hideModal($modal);
    });

    $modal.find('.confirm-btn').click(async () => {
      if (node.data.isFile) {
        Terra.app.closeFile(node.key);
      } else if (node.data.isFolder) {
        await this.closeFilesInFolderRecursively(node.key);
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
      await this.createFileTree();
    });
  }

  /**
   * Close all files inside a folder, including nested files in subfolders.
   *
   * @async
   * @param {string} path - The absolute folderpath to close all files from.
   */
  closeFilesInFolderRecursively = async (path) => {
    const subfiles = await Terra.app.vfs.findFilesInFolder(path);
    for (const file of subfiles) {
      const subfilepath = path ? `${path}/${file.name}` : file.name;
      Terra.app.closeFile(subfilepath);
    }

    const subfolders = await Terra.app.vfs.findFoldersInFolder(path);
    for (const folder of subfolders) {
      const subfolderpath = path ? `${path}/${folder.name}` : folder.name;
      this.closeFilesInFolderRecursively(subfolderpath);
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
          const parentPath = node.key;
          const newPath = parentPath.startsWith('root') ? 'Untitled' : `${parentPath}/Untitled`;
          this.createFile(newPath);
        },
      };

      menu.createFolder = {
        name: 'New Folder',
        callback: () => {
          Terra.v.userClickedContextMenuItem = true;
          const parentPath = node.key;
          const newPath = parentPath.startsWith('root') ? 'Untitled' : `${parentPath}/Untitled`;
          this.createFolder(newPath);
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
   * @param {boolean} [persistState=true] Whether to persist the state of the expanded folders.
   *
   * @see https://wwwendt.de/tech/fancytree/doc/jsdoc/global.html#FancytreeOptions
   */
  createFileTree = (forceRecreate = false, persistState = true) => {
    return new Promise((resolve) => {
      // Reload the tree if it already exists by re-importing from VFS.
      if (this.tree) {
        if (!forceRecreate) {
          const reloadTree = () => this.createFromVFS().then((data) => {
            this.getInstance().reload(data);
          });

          // Persist the tree state to prevent folders from being closed.
          if (persistState) {
            this.runFuncWithPersistedState(reloadTree).then(() => {
              resolve();
            });
          } else {
            reloadTree();
            resolve();
          }
          return;
        } else {
          this.removeInfoMsg();
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
        init: () => {
          this.sortFileTree();
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
  _afterCloseEditNodeCallback = () => {
    this.sortFileTree(),
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
  _nodePathExists = (name, parentPath, ignorePaths = []) => {
    const tree = this.getInstance();
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
  _beforeCloseEditNodeCallback = (event, data) => {
    // Check if user pressed cancel or text is unchanged.
    if (!data.save) return;

    const sourceNode = data.node;
    const newName = data.input.val().trim();
    const oldName = sourceNode.title;

    if (!newName) {
      // If no name has been filled in, return false.
      // In this case, the old file name will be kept.
      tooltipManager.destroyTooltip('renameNode');
      return false;
    }

    if (oldName === newName) {
      // Nothing changes, return true to close the edit.
      tooltipManager.destroyTooltip('renameNode');
      return true;
    }

    let errorMsg;

    // Check if the name already exists in the parent folder.
    // If so, trigger edit mode again and show error tooltip.
    const parentNodeKey = sourceNode.parent.key;
    if (!isValidFilename(newName)) {
      errorMsg = 'Name can\'t contain \\ / : * ? " < > |';
    } else if (this._nodePathExists(newName, parentNodeKey)) {
      errorMsg = `There already exists a "${newName}" file or folder`;
    }

    if (errorMsg) {
      tooltipManager.createTooltip('renameNode', sourceNode.span, errorMsg, {
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
        this._updateOpenTab(srcPath, destPath);
      } else if (sourceNode.data.isFolder) {
        this._updateFolderKeysRecursively(sourceNode);
      }
    });

    // Destroy the leftover tooltip if it exists.
    tooltipManager.destroyTooltip('renameNode');

    return true;
  }

  /**
   * Update the open tab's filename and path when a file is renamed.
   *
   * @param {string} srcPath - The source path of the file.
   * @param {string} destPath - The destination path of the file.
   */
  _updateOpenTab = (srcPath, destPath) => {
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
  _onStartEditNodeCallback = (event, data) => {
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
  _onClickNodeCallback = (event, data) => {
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
  _dragEnterCallback = (targetNode, data) => {
    // Add a visual drag area indicator.
    $(`.${DROP_AREA_INDICATOR_CLASS}`).removeClass(DROP_AREA_INDICATOR_CLASS);

    if ((targetNode.parent.title.startsWith('root') && targetNode.data.isFile) || targetNode.title === 'root') {
      $('#file-tree').addClass(DROP_AREA_INDICATOR_CLASS);
    }
    else if (targetNode.data.isFile) {
      $(targetNode.parent.li).addClass(DROP_AREA_INDICATOR_CLASS);
    }
    else if (targetNode.data.isFolder) {
      $(targetNode.li).addClass(DROP_AREA_INDICATOR_CLASS);
    }

    // Prevent dropping if there exists already a file with the same name on the
    // target folder.
    const sourceNode = data.otherNode;
    const containsDuplicate = (
      (
        targetNode.data.isFile &&
        this._nodePathExists(sourceNode.title, targetNode.parent.key, [sourceNode.key])
      )
        ||
      (
        targetNode.data.isFolder &&
        this._nodePathExists(sourceNode.title, targetNode.key, [sourceNode.key])
      )
    );

    tooltipManager.destroyTooltip('dndDuplicate');

    if (containsDuplicate) {
      // Create new tooltip.
      const anchor = targetNode.data.isFile
        ? (targetNode.parent.title.startsWith('root') ? $('.file-tree-container .title')[0] : targetNode.parent.span)
        : targetNode.span;

      const msg = `There already exists a "${sourceNode.title}" file or folder`;
      tooltipManager.createTooltip('dndDuplicate', anchor, msg, {
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
  _dragEndCallback = () => {
    // Remove the visual drag area indicator.
    $(`.${DROP_AREA_INDICATOR_CLASS}`).removeClass(DROP_AREA_INDICATOR_CLASS);

    tooltipManager.destroyTooltip('dndDuplicate');
    this.sortFileTree()
    Terra.v.blockFSPolling = false;
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
    let parentPath = (targetNode.data.isFolder)
      ? targetNode.key
      : (targetNode.parent.title.startsWith('root') ? null : targetNode.parent.key);

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
        this._updateOpenTab(srcPath, destPath);
      } else if (sourceNode.data.isFolder) {
        this._updateFolderKeysRecursively(sourceNode);
      }
    });
  }

  /**
   * Update the folder key recursively for all child nodes.
   *
   * @param {FancytreeNode} folderNode - The folder node to update recursively.
   */
  _updateFolderKeysRecursively = (folderNode) => {
    folderNode.key = this.getAbsoluteNodePath(folderNode);

    const childNodes = folderNode.children || [];
    for (const childNode of childNodes) {
      if (childNode.data.isFolder) {
        this._updateFolderKeysRecursively(childNode);
      } else {
        const srcPath = childNode.key;
        const destPath = this.getAbsoluteNodePath(childNode);
        childNode.key = destPath;
        this._updateOpenTab(srcPath, destPath);
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
        prevExpandedFolderPaths.push(node.key);
      }
    });

    await fn();

    // Expand all folder nodes again that were open (if they still exist).
    this.getInstance().visit((node) => {
      if (node.data.isFolder && prevExpandedFolderPaths.includes(node.key)) {
        node.setExpanded(true, { noAnimation: true });
      }
    });
  }
}

export default new FileTreeManager();
