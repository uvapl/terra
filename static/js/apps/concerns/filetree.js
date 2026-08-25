import FileTreeComponent from "../../ui/components/filetree.js";
import * as LFS from "../../fs/lfs.js";
import { getFileExtension } from "../../lib/helpers.js";

/**
 * File-tree concern.
 *
 * Installs the file-tree behaviour onto an app instance: it creates the
 * FancyTree view component (exposed as `app.fileTree`) and makes the app the
 * component's controller — its `delegate` for user intents and the owner of the
 * tree-coordination methods (create / refresh / move / delete + VFS reactions).
 *
 * This mirrors how the app already handles the editor and image components'
 * events (onEditorTextChanged, onImageReloadRequested, …): the components
 * report, the app coordinates. Because the coordination lives on the app, these
 * methods reach the VFS, tabs and workers directly (this.vfs, this.openFile, …) —
 * no separate "workspace" abstraction is needed.
 *
 * Presentation (title, in-place messages, bottom message, localstorage warning)
 * stays on the component and is reached directly via `app.fileTree`, like any
 * other public collaborator (`app.view`, `app.vfs`).
 *
 * @param {App} app - The app instance to install the file tree on.
 */
export function useFileTree(app) {
  const component = new FileTreeComponent();
  app.fileTree = component;
  component.delegate = app;

  Object.assign(app, {
    /**
     * Re-read the VFS tree and re-render the component in place.
     *
     * @returns {Promise<void>}
     */
    async refreshFileTree() {
      const tree = await this.vfs.getFileTree();
      this.fileTree.render(tree);
    },

    /**
     * Re-read the VFS tree and force a full re-instantiation of the component
     * (e.g. after a git clone replaces everything).
     *
     * @returns {Promise<void>}
     */
    async rebuildFileTree() {
      const tree = await this.vfs.getFileTree();
      this.fileTree.recreate(tree);
    },

    /**
     * Start inline creation of a new file. Nothing is written to the VFS until
     * the user confirms a name (see `onNodeCreated`); cancelling creates nothing.
     *
     * @param {string|null} [parentPath] - Parent folder key, or null for root.
     */
    startCreateFile(parentPath = null) {
      this.fileTree.startInlineCreate(parentPath, false);
    },

    /**
     * Start inline creation of a new folder. Nothing is written to the VFS until
     * the user confirms a name (see `onNodeCreated`); cancelling creates nothing.
     *
     * @param {string|null} [parentPath] - Parent folder key, or null for root.
     */
    startCreateFolder(parentPath = null) {
      this.fileTree.startInlineCreate(parentPath, true);
    },

    // ── Component intents (the app is the component's delegate) ──

    /**
     * A file node was activated (clicked). Temp files cannot be opened.
     *
     * @param {string} key - The node's path.
     * @param {object} [nodeData] - The node's data, see toFancyTree().
     */
    onFileActivated(key, nodeData = {}) {
      if (nodeData.temporary) return;
      this.openFile(key);
    },

    /** A node was moved (drag-drop); the component already moved it visually. */
    async onNodeMoved(srcPath, destPath, isFolder) {
      // perform the move in the file system
      const move = isFolder ? this.vfs.moveFolder : this.vfs.moveFile;
      const result = await move(srcPath, destPath);

      // move failed in FS
      if (result === null) {
        await this.refreshFileTree();
        return;
      }

      // work the move recursively into the filetree and collect any changed paths
      const pairs = this.fileTree.applyRelocatedKeys(srcPath, destPath, isFolder);

      // work the move into any open tabs
      pairs.forEach(({ src, dest }) => this.updateOpenTabPath(src, dest));
    },

    /** A node was renamed via inline edit; move it, then refocus the editor. */
    async onNodeRenamed(srcPath, destPath, isFolder) {
      await this.onNodeMoved(srcPath, destPath, isFolder);
      this.focusActiveEditor();
    },

    /**
     * A new file/folder name was confirmed via inline edit; persist it now,
     * refresh the tree, and open the new file (if it's a file).
     *
     * @param {string|null} parentPath - Parent folder key, or null for root.
     * @param {string} name - The confirmed (validated) name.
     * @param {boolean} isFolder - Whether to create a folder.
     * @returns {Promise<void>}
     */
    async onNodeCreated(parentPath, name, isFolder) {
      const path = parentPath ? `${parentPath}/${name}` : name;

      if (isFolder) {
        if (!(await this.vfs.createFolder(path))) return;
        await this.refreshFileTree();
      } else {
        const fileName = await this.vfs.createFile(path, "");
        // creation in FS might fail
        if (!fileName) return;
        const key = parentPath ? `${parentPath}/${fileName}` : fileName;
        await this.refreshFileTree();
        this.openFile(key);
      }
    },

    /** A node deletion was confirmed by the user. */
    async onNodeDeleted(key, isFolder) {
      if (isFolder) {
        await this.view.closeFilesFromFolder(key);
      } else {
        this.closeFile(key);
      }

      const remove = isFolder ? this.vfs.deleteFolder : this.vfs.deleteFile;
      await remove(key);

      await this.refreshFileTree();
    },

    /**
     * Local filesystem entries were dropped onto the tree. Refuses the whole
     * drop if any top-level dragged-in name is already taken.
     */
    async onFilesDropped(entries, destParentKey) {
      if (!(await this.vfs.importEntries(entries, destParentKey))) return;
      await this.refreshFileTree();
    },

    /** A download was requested from the context menu. */
    onDownloadRequested(key, isFolder) {
      const download = isFolder ? this.vfs.downloadFolder : this.vfs.downloadFile;
      download(key);
    },

    /** A run was requested from the context menu. */
    onRunRequested(key) {
      this.runFile(key);
    },

    /** @returns {boolean} Whether download is offered (only on temporary storage). */
    canDownload() {
      return !LFS.hasProjectLoaded();
    },

    /** @returns {boolean} Whether the file's language can be run. */
    canRun(key) {
      return this.langWorkerClient.supports(getFileExtension(key));
    },
  });

  // Rebuild the tree when the VFS changes.
  const rebuildOnChange = () => {
    if (!app.isFSReloadSuspended()) app.refreshFileTree();
  };
  app.vfs.addEventListener("fileCreated", rebuildOnChange);
  app.vfs.addEventListener("folderCreated", rebuildOnChange);
  app.vfs.addEventListener("fileDeleted", rebuildOnChange);
  app.vfs.addEventListener("fileSystemChanged", rebuildOnChange);
}
