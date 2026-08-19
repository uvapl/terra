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

    /** A file node was activated (clicked). */
    onFileActivated(key) {
      this.openFile(key);
    },

    /** A node was moved (drag-drop); the component already moved it visually. */
    async onNodeMoved(srcPath, destPath, isFolder) {
      // perform the move in the file system
      const move = isFolder ? this.vfs.moveFolder : this.vfs.moveFile;
      await move(srcPath, destPath);

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
        await this.vfs.createFolder(path);
        await this.refreshFileTree();
      } else {
        const fileName = await this.vfs.createFile(path, "");
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

    /** Local filesystem entries were dropped onto the tree. */
    async onFilesDropped(entries, destParentKey) {
      for (const entry of entries) {
        await importEntry(this.vfs, entry, "", destParentKey);
      }
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

/**
 * Create a file or folder in the VFS from a FileSystemEntry (e.g. dragged from
 * the local filesystem). Recurses into directories.
 *
 * @param {VirtualFileSystem} vfs - The VFS to write into.
 * @param {FileSystemEntry} item - The file or folder entry.
 * @param {string} [path] - Path of the entry relative to the drop target.
 * @param {string} [targetNodePath] - Path of the node it was dropped onto.
 * @returns {Promise<void>}
 */
function importEntry(vfs, item, path = "", targetNodePath = null) {
  return new Promise((resolve) => {
    if (item.isFile) {
      item.file((file) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const buffer = e.target.result;
          const destPath = [targetNodePath, path, file.name].filter((s) => s).join("/");
          vfs.createFile(destPath, buffer).then(() => resolve());
        };
        reader.readAsArrayBuffer(file);
      });
    } else if (item.isDirectory) {
      const dirReader = item.createReader();
      dirReader.readEntries(async (entries) => {
        for (const entry of entries) {
          const subpath = path ? `${path}/${item.name}` : item.name;
          await importEntry(vfs, entry, subpath, targetNodePath);
        }
        resolve();
      });
    } else {
      resolve();
    }
  });
}
