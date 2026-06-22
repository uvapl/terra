import { isValidFilename } from '../lib/helpers.js';
import { createModal, hideModal, showModal } from './modal.js';
import { createTooltip, destroyTooltip } from './tooltip.js';

/** CSS class marking the active drop target during a drag. */
const DROP_AREA_INDICATOR_CLASS = 'drop-area-indicator';

/**
 * File-tree component: a FancyTree adapter.
 *
 * A view component in the same family as the editor/image/terminal components
 * (hence its home in layout/), though not registered with GoldenLayout — it
 * renders the sidebar tree, which lives outside the GoldenLayout container.
 *
 * Speaks FancyTree + DOM and returns plain data; it never touches the VFS, the
 * workspace, storage, or the `Terra` global. User gestures are reported to its
 * `delegate` (the controller) as intents in tree vocabulary; data it needs is
 * handed to it through render commands. The controller is responsible for
 * setting `delegate` before the first render.
 */
export default class FileTreeComponent {
  /**
   * The controller that handles this view's intents and issues render commands.
   * @type {?object}
   */
  delegate = null;

  /** Debounce timer for folder expand/collapse on title click. */
  _toggleTimeout = null;

  /** Whether the user clicked a context-menu item (vs. dismissing the menu). */
  _userClickedContextMenuItem = false;

  constructor() {
    this._setupFileDrop();
    this._bindToolbarButtons();
    this._setupContextMenu();
  }

  // ─────────────────────────── Render commands ───────────────────────────

  /**
   * (Re)load the tree from a minimal VFS tree. Reloads in place when a tree
   * already exists (persisting expanded folders), otherwise instantiates a new
   * FancyTree. Clears any in-place message first.
   *
   * @param {object[]} minimalTree - Minimal VFS tree (`{ title, folder, children }`).
   * @returns {Promise<void>}
   */
  render(minimalTree) {
    this.clearMessage();

    const data = toFancyTree(minimalTree);
    const instance = this._getInstance();
    if (instance) {
      return this._withPersistedExpansion(() => instance.reload(data));
    }
    return this._instantiate(data);
  }

  /**
   * Force a full re-instantiation of the tree (e.g. after a git clone replaces
   * everything). Tears down any existing instance or message first.
   *
   * @param {object[]} minimalTree - Minimal VFS tree.
   * @returns {Promise<void>}
   */
  recreate(minimalTree) {
    this.clearMessage();
    this.destroy();
    return this._instantiate(toFancyTree(minimalTree));
  }

  /**
   * Destroy the FancyTree instance, if any.
   */
  destroy() {
    if (this._getInstance()) {
      $('#file-tree').fancytree('destroy');
    }
  }

  /**
   * Show a message in the tree area, replacing the tree (which is torn down).
   *
   * @param {string} msg - The message HTML to display.
   * @param {object} [opts]
   * @param {boolean} [opts.error=false] - Render as an error message.
   */
  showMessage(msg, { error = false } = {}) {
    this.destroy();
    const cls = error ? 'info-msg error' : 'info-msg';
    $('#file-tree').html(`<div class="${cls}">${msg}</div>`);
  }

  /**
   * Remove the in-place message, if any.
   */
  clearMessage() {
    $('#file-tree .info-msg').remove();
  }

  /**
   * @returns {boolean} True if the tree area is showing a message.
   */
  hasMessage() {
    return $('#file-tree .info-msg').length > 0;
  }

  // ─────────────────────────── Panel chrome ──────────────────────────────
  // The parts of .file-tree-container that surround the tree itself. These
  // never tear down the tree; they are driven mostly by storage code (via the
  // controller).

  /**
   * Set the file tree title.
   *
   * @param {string} title - The title to set.
   */
  setTitle(title) {
    $('#file-tree-title').text(title);
  }

  /**
   * Show a message at the bottom of the file tree (e.g. git sync status).
   *
   * @param {string} msg - The message HTML to display.
   */
  showBottomMessage(msg) {
    if (this.hasBottomMessage()) {
      $('#file-tree-bottom-msg').html(msg);
      return;
    }

    const html = `<div id="file-tree-bottom-msg" class="file-tree-bottom-msg"><p>${msg}</p></div>`;
    $('.file-tree-container').addClass('has-bottom-msg').append(html);
  }

  /**
   * Remove the bottom message from the DOM.
   */
  clearBottomMessage() {
    $('.file-tree-container').removeClass('has-bottom-msg');
    $('#file-tree-bottom-msg').remove();
  }

  /**
   * @returns {boolean} True if the file tree has a bottom message.
   */
  hasBottomMessage() {
    return $('#file-tree-bottom-msg').length > 0;
  }

  /**
   * Add the localstorage warning to the DOM.
   */
  showLocalStorageWarning() {
    if ($('#local-storage-warning').length > 0) return;

    const html = `
      <div id="local-storage-warning" class="local-storage-warning">
        <div class="warning-title">
          <img src="static/img/icons/warning.png" alt="warning icon" class="warning-icon" /> Warning
        </div>
        <p>
          You are currently using temporary browser storage. Clearing website data will
          delete project files and folders permanently.
        </p>
      </div>
    `;

    $('.file-tree-container').addClass('localstorage-mode').append(html);
  }

  /**
   * Remove the localstorage warning from the DOM.
   */
  clearLocalStorageWarning() {
    $('.file-tree-container').removeClass('localstorage-mode');
    $('#local-storage-warning').remove();
  }

  /**
   * Expand ancestor folders so a node is visible, then start inline rename.
   *
   * @param {string} key - The key of the node to rename.
   */
  startInlineRename(key) {
    const node = this._getInstance()?.getNodeByKey(key);
    if (!node) return;

    let ancestor = node.parent;
    while (ancestor) {
      if (ancestor.data?.isFolder) {
        ancestor.setExpanded(true, { noAnimation: true });
      }
      ancestor = ancestor.parent;
    }

    setTimeout(() => node.editStart(), 100);
  }

  /**
   * Recompute node key(s) after a move/rename and return the `{ src, dest }`
   * path pairs of every affected file so the caller can re-point open editor
   * tabs. Pure tree bookkeeping — no VFS, tab or app calls.
   *
   * @param {string} srcKey - The node's previous key.
   * @param {string} destKey - The node's new key (used directly for files).
   * @param {boolean} isFolder - Whether the node is a folder.
   * @returns {Array<{src: string, dest: string}>} Affected file path pairs.
   */
  applyRelocatedKeys(srcKey, destKey, isFolder) {
    const node = this._getInstance()?.getNodeByKey(srcKey);
    if (!node) return [];

    if (!isFolder) {
      node.key = destKey;
      return [{ src: srcKey, dest: destKey }];
    }
    return this._updateFolderKeysRecursively(node);
  }

  // ─────────────────────────── Setup (one-time) ──────────────────────────

  /**
   * Since FancyTree handles DnD on a node level, we need another droparea that
   * allows dropping files/folders from the local filesystem onto the file tree.
   */
  _setupFileDrop() {
    const $dropzone = $('#file-dropzone');

    // dataTransfer.types is ['Files'] when dragging local filesystem entries.
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

      const entries = this._collectEntries(e.originalEvent.dataTransfer.items);
      this.delegate.onFilesDropped(entries, null);
    });
  }

  /** Bind the "new file"/"new folder" toolbar buttons (persist across reloads). */
  _bindToolbarButtons() {
    $('#file-tree--add-folder-btn').off('click').on('click', () => this.delegate.createFolder());
    $('#file-tree--add-file-btn').off('click').on('click', () => this.delegate.createFile());
  }

  /** Register the right-click context menu (delegated selector, bound once). */
  _setupContextMenu() {
    // @see http://swisnl.github.io/jQuery-contextMenu/docs.html
    $.contextMenu({
      zIndex: 10,
      selector: '#file-tree span.fancytree-node',
      build: this._createContextMenuItems,
      events: {
        show: () => {
          this._userClickedContextMenuItem = false;
          this.delegate.suspendFSReload();
        },
        hide: () => {
          if (!this._userClickedContextMenuItem) {
            this.delegate.resumeFSReload();
          }
          document
            .querySelectorAll(".fancytree-node.selected-for-context")
            .forEach((n) => {
              const node = $.ui.fancytree.getNode(n);
              if (node) node.removeClass("selected-for-context");
            });
        },
      },
    });
  }

  /**
   * Instantiate a new FancyTree with the given source data.
   *
   * @param {object[]} data - FancyTree source nodes.
   * @returns {Promise<void>} Resolves once the tree has initialised.
   * @see https://wwwendt.de/tech/fancytree/doc/jsdoc/global.html#FancytreeOptions
   */
  _instantiate(data) {
    return new Promise((resolve) => {
      $('#file-tree').fancytree({
        selectMode: 1,
        debugLevel: 0,
        strings: {
          noData: 'Create a file to get started',
        },
        source: data,
        click: this._onClick,
        init: () => {
          this._sort();
          resolve();
        },

        // @see https://github-wiki-see.page/m/mar10/fancytree/wiki/ExtensionIndex
        extensions: ['glyph', 'edit', 'dnd5'],

        // @see https://github-wiki-see.page/m/mar10/fancytree/wiki/ExtGlyph
        glyph: {
          map: {
            dropMarker: '',
            doc: 'file-tree-icon file-tree-file-icon',
            docOpen: 'file-tree-icon file-tree-file-icon open',
            folder: 'file-tree-icon file-tree-folder-icon',
            folderOpen: 'file-tree-icon file-tree-folder-icon open',
          },
        },

        // @see https://github-wiki-see.page/m/mar10/fancytree/wiki/ExtDnd
        dnd5: {
          preventVoidMoves: true,
          autoExpandMS: 400,
          dragStart: this._onDragStart,
          dragEnter: this._onDragEnter,
          dragDrop: this._onDragStop,
          dragEnd: this._onDragEnd,
          dragOver: (node, data) => {
            if (data.hitMode === 'before' || data.hitMode === 'after') {
              data.hitMode = 'over';
            }
          },
        },

        // @see https://github-wiki-see.page/m/mar10/fancytree/wiki/ExtEdit
        edit: {
          triggerStart: ['dblclick'],
          // FancyTree sets the input width inline to `titleWidth + adjustWidthOfs`.
          // Widen it to cover the input's horizontal padding (2×3px) + border
          // (2×1px) so short names aren't clipped (see `.fancytree-node input`).
          adjustWidthOfs: 16,
          edit: this._onStartEdit,
          beforeClose: this._onBeforeCloseEdit,
          close: this._onAfterCloseEdit,
        },
      });
    });
  }

  // ─────────────────────────── FancyTree callbacks ───────────────────────

  /** User clicked a node: activate a file, or toggle a folder. */
  _onClick = (event, data) => {
    if (data.node.data.isFile) {
      // Debounce file activation so a double-click (which starts an inline
      // rename) doesn't open the file and steal focus from the edit input.
      clearTimeout(this._activateTimeout);
      this._activateTimeout = setTimeout(() => {
        this.delegate.onFileActivated(data.node.key);
      }, 200);
    } else if (data.node.data.isFolder) {
      clearTimeout(this._toggleTimeout);

      // Debounce title clicks by 200ms to avoid clashing with double-clicks.
      if (event.originalEvent.target.classList.contains('fancytree-title')) {
        this._toggleTimeout = setTimeout(() => {
          this.delegate.suspendFSReload();
          data.node.toggleExpanded();

          // Resume reloads after the expand/collapse animation completes.
          setTimeout(() => this.delegate.resumeFSReload(), 400);
        }, 200);
      } else {
        data.node.toggleExpanded();
      }
    }
  };

  /** User started editing a node's name. */
  _onStartEdit = (event, data) => {
    this.delegate.suspendFSReload();
    clearTimeout(this._toggleTimeout);
    clearTimeout(this._activateTimeout);
    data.input.select();

    $(data.input).attr({
      autocorrect: 'off',     // Disable auto-correction
      autocapitalize: 'none', // Prevent automatic capitalization
      spellcheck: 'false',    // Disable spell-check
    });
  };

  /** Validate a rename and report it; FancyTree closes the editor on `true`. */
  _onBeforeCloseEdit = (event, data) => {
    // Check if user pressed cancel or text is unchanged.
    if (!data.save) return;

    const sourceNode = data.node;
    const newName = data.input.val().trim();
    const oldName = sourceNode.title;

    if (!newName) {
      // Keep the old name when nothing was entered.
      destroyTooltip('renameNode');
      return false;
    }

    if (oldName === newName) {
      destroyTooltip('renameNode');
      return true;
    }

    let errorMsg;

    // Reject invalid names or names already taken in the parent folder.
    const parentNodeKey = sourceNode.parent.key;
    if (!isValidFilename(newName)) {
      errorMsg = 'Name can\'t contain \\ / : * ? " < > |';
    } else if (this._nodePathExists(newName, parentNodeKey)) {
      errorMsg = `There already exists a "${newName}" file or folder`;
    }

    if (errorMsg) {
      createTooltip('renameNode', sourceNode.span, errorMsg, {
        placement: 'right',
        theme: 'error',
      });
      return false;
    }

    const srcPath = sourceNode.key;
    const parentPath = parentNodeKey.startsWith('root') ? null : parentNodeKey;
    const destPath = parentPath ? `${parentPath}/${newName}` : newName;

    // Stash the validated rename; the actual move is performed in
    // `_onAfterCloseEdit`, once FancyTree has written the new title onto the
    // node (folder key recomputation reads it via getAbsoluteNodePath).
    this._pendingRename = { srcPath, destPath, isFolder: sourceNode.data.isFolder };

    destroyTooltip('renameNode');
    return true;
  };

  /** Inline editor was removed: re-sort, resume reloads, and commit any rename. */
  _onAfterCloseEdit = () => {
    this._sort();
    this.delegate.resumeFSReload();

    if (this._pendingRename) {
      const { srcPath, destPath, isFolder } = this._pendingRename;
      this._pendingRename = null;
      this.delegate.onNodeRenamed(srcPath, destPath, isFolder);
    }
  };

  /** User started dragging a node. */
  _onDragStart = (node, data) => {
    this.delegate.suspendFSReload();

    // Set a custom drag image.
    data.dataTransfer.setDragImage(
      $(`<div class="custom-drag-helper">${node.title}</div>`).appendTo('body')[0],
      -10,
      -10,
    );
    data.useDefaultImage = false;

    // Return true to enable dnd.
    return node.statusNodeType !== 'nodata';
  };

  /** User dragged a node over another node; manage drop indicators + dup check. */
  _onDragEnter = (targetNode, data) => {
    // Remove all existing visual drag area indicators.
    $('.fancytree-drop-accept').removeClass('fancytree-drop-accept');
    $(`.${DROP_AREA_INDICATOR_CLASS}`).removeClass(DROP_AREA_INDICATOR_CLASS);

    // Add a visual drag area indicator.
    if ((targetNode.parent.title.startsWith('root') && targetNode.data.isFile) || targetNode.title === 'root') {
      $('#file-tree').addClass(DROP_AREA_INDICATOR_CLASS);
    } else if (targetNode.data.isFile) {
      $(targetNode.parent.li).addClass(DROP_AREA_INDICATOR_CLASS);
    } else if (targetNode.data.isFolder) {
      $(targetNode.li).addClass(DROP_AREA_INDICATOR_CLASS);
    }

    // NOTE: sourceNode is undefined when dragging a local filesystem entry onto
    // the tree. For security reasons `data.files` is empty during dragEnter, so
    // duplicates cannot be detected then; such drops just get "(1)" appended.
    const sourceNode = data.otherNode;

    if (sourceNode) {
      // Prevent dropping when a file with the same name exists in the target.
      const containsDuplicate = (
        (targetNode.data.isFile && this._nodePathExists(sourceNode.title, targetNode.parent.key, [sourceNode.key]))
        ||
        (targetNode.data.isFolder && this._nodePathExists(sourceNode.title, targetNode.key, [sourceNode.key]))
      );

      destroyTooltip('dndDuplicate');

      if (containsDuplicate) {
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
  };

  /** Drag ended: clean up indicators and resume reloads. */
  _onDragEnd = () => {
    $(`.${DROP_AREA_INDICATOR_CLASS}`).removeClass(DROP_AREA_INDICATOR_CLASS);
    $('.custom-drag-helper').remove();
    destroyTooltip('dndDuplicate');
    this._sort();
    this.delegate.resumeFSReload();
  };

  /** A node (or local files) was dropped: move it visually, then report it. */
  _onDragStop = (targetNode, data) => {
    const sourceNode = data.otherNode;

    const parentPath = targetNode.data.isFolder
      ? targetNode.key
      : (targetNode.parent.title.startsWith('root') ? null : targetNode.parent.key);

    if (data.files.length > 0) {
      // User dropped one or more local filesystem files/folders.
      const entries = this._collectEntries(data.dataTransfer.items);
      this.delegate.onFilesDropped(entries, parentPath);
    } else if (sourceNode) {
      // User moved a node within the tree.
      const srcPath = sourceNode.key;
      const destPath = parentPath ? `${parentPath}/${sourceNode.title}` : sourceNode.title;

      if (srcPath === destPath) {
        // Nothing happened (rare, but it might occur).
        return true;
      }

      // Move the node in the tree. When dropped onto a file, insert as a sibling
      // rather than creating a new folder.
      if (data.hitMode === 'over' && targetNode.data.isFile) {
        sourceNode.moveTo(targetNode, 'before');
      } else if (targetNode.data.isFile) {
        /* not sure if this is needed */
        sourceNode.moveTo(targetNode, 'after');
      } else if (targetNode.data.isFolder) {
        sourceNode.moveTo(targetNode, 'child');
        targetNode.setExpanded();
      }

      this.delegate.onNodeMoved(srcPath, destPath, sourceNode.data.isFolder);
    }
  };

  // ─────────────────────────── Context menu ──────────────────────────────

  /**
   * Build the right-click context menu for a file/folder node. Capability
   * questions (download/run) are deferred to the delegate so this view stays
   * free of LFS/worker knowledge.
   *
   * @see https://swisnl.github.io/jQuery-contextMenu/docs/items.html
   */
  _createContextMenuItems = ($trigger) => {
    const menu = {};
    const node = $.ui.fancytree.getNode($trigger[0]);
    node.addClass("selected-for-context");
    const { isFolder, isFile } = node.data;

    if (isFolder) {
      menu.createFile = {
        name: 'New File',
        callback: () => {
          this._userClickedContextMenuItem = true;
          this.delegate.createFile(this._childUntitledPath(node.key));
        },
      };

      menu.createFolder = {
        name: 'New Folder',
        callback: () => {
          this._userClickedContextMenuItem = true;
          this.delegate.createFolder(this._childUntitledPath(node.key));
        },
      };

      if (this.delegate.canDownload()) {
        menu.downloadFolder = {
          name: 'Download',
          callback: () => {
            this._userClickedContextMenuItem = true;
            this.delegate.onDownloadRequested(node.key, true);
            this.delegate.resumeFSReload();
          },
        };
      }
    }

    if (isFile) {
      if (this.delegate.canDownload()) {
        menu.downloadFile = {
          name: 'Download',
          callback: () => {
            this._userClickedContextMenuItem = true;
            this.delegate.onDownloadRequested(node.key, false);
            this.delegate.resumeFSReload();
          },
        };
      }

      if (this.delegate.canRun(node.key)) {
        menu.run = {
          name: 'Run',
          callback: () => {
            this._userClickedContextMenuItem = true;
            this.delegate.onRunRequested(node.key);
            this.delegate.resumeFSReload();
          },
        };
      }
    }

    if (isFile || isFolder) {
      menu.rename = {
        name: 'Rename',
        callback: () => {
          this._userClickedContextMenuItem = true;
          node.editStart();
        },
      };

      menu.remove = {
        name: 'Delete',
        callback: () => {
          this._userClickedContextMenuItem = true;
          this._confirmDelete(node);
        },
      };
    }

    if (Object.keys(menu).length === 0) {
      return false;
    }

    return { items: menu };
  };

  /**
   * Show a confirmation modal, then report the deletion to the delegate.
   *
   * @param {FancytreeNode} node - The node to delete.
   */
  _confirmDelete(node) {
    const $modal = createModal({
      title: 'Confirmation required',
      body: `<p>You are about to delete the ${node.data.type} <strong>${node.title}</strong> permanently, are you sure? This action can't be undone.</p>`,
      footer: `
        <button type="button" class="button cancel-btn">Cancel</button>
        <button type="button" class="button confirm-btn danger-btn">I'm sure</button>
      `,
      attrs: {
        id: 'ide-delete-confirmation-modal',
        class: 'modal-width-small',
      },
    });

    showModal($modal);

    $modal.find('.cancel-btn').click(() => {
      this.delegate.resumeFSReload();
      hideModal($modal);
    });

    $modal.find('.confirm-btn').click(async () => {
      await this.delegate.onNodeDeleted(node.key, node.data.isFolder);
      hideModal($modal);
      this.delegate.resumeFSReload();
    });
  }

  // ─────────────────────────── Private helpers ───────────────────────────

  /** @returns {string} The path for a new "Untitled" child of `parentKey`. */
  _childUntitledPath(parentKey) {
    return parentKey.startsWith('root') ? 'Untitled' : `${parentKey}/Untitled`;
  }

  /**
   * Extract the `FileSystemEntry` objects from a DataTransferItemList.
   *
   * @param {DataTransferItemList} items - The dropped items.
   * @returns {FileSystemEntry[]} The non-null entries.
   */
  _collectEntries(items) {
    const entries = [];
    for (let i = 0; i < items.length; i++) {
      const entry = getDataTransferFileEntry(items[i]);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  /** Sort folders before files, then alphabetically. */
  _sort() {
    this._getInstance().rootNode.sortChildren((a, b) => {
      if (a.data.type === b.data.type) {
        return a.title.localeCompare(b.title);
      }
      return a.folder ? -1 : 1;
    }, true);
  }

  /** @returns {FancyTree|null} The FancyTree instance, or null if none. */
  _getInstance() {
    return $.ui.fancytree.getTree('#file-tree');
  }

  /**
   * Check whether a name exists in a given folder path in the tree.
   *
   * NOTE: equivalent to VFS.pathExists(), but synchronous — dnd5 callbacks do
   * not support async.
   *
   * @param {string} name - The file name.
   * @param {string} parentPath - The folder path to check.
   * @param {string[]} [ignorePaths] - Node keys to ignore.
   * @returns {boolean} True if a matching node exists.
   */
  _nodePathExists(name, parentPath, ignorePaths = []) {
    const parentNode = this._getInstance().getNodeByKey(parentPath);
    if (!parentNode) return false;

    const childNodes = parentNode.children || [];
    for (const node of childNodes) {
      if (node.title === name && !ignorePaths.includes(node.key)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Recompute the key of a folder node and all its descendants, collecting the
   * `{ src, dest }` pairs of every affected file.
   *
   * @param {FancytreeNode} folderNode - The folder node to update.
   * @returns {Array<{src: string, dest: string}>} Renamed file path pairs.
   */
  _updateFolderKeysRecursively(folderNode) {
    folderNode.key = getAbsoluteNodePath(folderNode);

    const renamedFiles = [];
    const childNodes = folderNode.children || [];
    for (const childNode of childNodes) {
      if (childNode.data.isFolder) {
        renamedFiles.push(...this._updateFolderKeysRecursively(childNode));
      } else {
        const srcPath = childNode.key;
        const destPath = getAbsoluteNodePath(childNode);
        childNode.key = destPath;
        renamedFiles.push({ src: srcPath, dest: destPath });
      }
    }
    return renamedFiles;
  }

  /**
   * Run a function while preserving which folders are expanded.
   *
   * @param {Function} fn - Callable (may be async).
   * @returns {Promise<void>}
   */
  async _withPersistedExpansion(fn) {
    const instance = this._getInstance();
    if (!instance) return await fn();

    const prevExpandedFolderPaths = [];
    instance.visit((node) => {
      if (node.data.isFolder && node.expanded) {
        prevExpandedFolderPaths.push(node.key);
      }
    });

    await fn();

    this._getInstance().visit((node) => {
      if (node.data.isFolder && prevExpandedFolderPaths.includes(node.key)) {
        node.setExpanded(true, { noAnimation: true });
      }
    });
  }
}

/**
 * Get the FileSystemEntry from a DataTransferItem.
 *
 * Note: webkitGetAsEntry() is also implemented in non-Webkit browsers; it may
 * be renamed to getAsEntry() in the future, so we look for both.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/webkitGetAsEntry
 *
 * @param {DataTransferItem} item - The item to get the entry from.
 * @returns {FileSystemEntry|null} The file entry, or null if not available.
 */
function getDataTransferFileEntry(item) {
  if (item.webkitGetAsEntry) {
    return item.webkitGetAsEntry();
  } else if (item.getAsEntry) {
    return item.getAsEntry();
  }
  return null;
}

/**
 * Get the absolute path of a node from its position in the tree.
 *
 * @param {FancytreeNode} node - The node.
 * @returns {string} The absolute path.
 */
function getAbsoluteNodePath(node) {
  if (!node.parent) return node.title;

  const parentPath = getAbsoluteNodePath(node.parent);
  return parentPath.startsWith('root') ? node.title : `${parentPath}/${node.title}`;
}

/**
 * Convert a minimal VFS file tree into a FancyTree-compatible source structure.
 *
 * The VFS yields a minimal tree of `{ title, folder, children }` nodes; FancyTree
 * needs `{ key, title, folder, data, children }` where the key is the node's
 * absolute path. Pure transform — the FancyTree source shape is this component's
 * private knowledge.
 *
 * @param {object[]} tree - Minimal tree nodes (`{ title, folder, children }`).
 * @param {string} [path] - Path prefix used to build node keys.
 * @returns {object[]} FancyTree-compatible node list.
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
