import FileTreeComponent from '../components/filetree.js';
import * as LFS from '../fs/lfs.js';
import { getFileExtension } from '../lib/helpers.js';

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
 * other public collaborator (`app.layout`, `app.vfs`).
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
    refreshFileTree() {
      return this.vfs.getFileTree().then((tree) => this.fileTree.render(tree));
    },

    /**
     * Re-read the VFS tree and force a full re-instantiation of the component
     * (e.g. after a git clone replaces everything).
     *
     * @returns {Promise<void>}
     */
    rebuildFileTree() {
      return this.vfs.getFileTree().then((tree) => this.fileTree.recreate(tree));
    },

    /**
     * Create a new file in the VFS, refresh the tree, open it and start renaming.
     *
     * @param {string|null} [path] - Path for the new file, or null for the root.
     * @returns {Promise<void>}
     */
    async createFile(path = null) {
      const parentPath = path ? path.split('/').slice(0, -1).join('/') : null;
      const fileName = await this.vfs.createFile(path);
      const key = parentPath ? `${parentPath}/${fileName}` : fileName;

      await this.refreshFileTree();
      this.openFile(key);
      this.fileTree.startInlineRename(key);
    },

    /**
     * Create a new folder in the VFS, refresh the tree and start renaming.
     *
     * @param {string|null} [path] - Path for the new folder, or null for the root.
     * @returns {Promise<void>}
     */
    async createFolder(path = null) {
      const parentPath = path ? path.split('/').slice(0, -1).join('/') : null;
      const folder = await this.vfs.createFolder(path);
      const key = parentPath ? `${parentPath}/${folder.name}` : folder.name;

      await this.refreshFileTree();
      this.fileTree.startInlineRename(key);
    },

    // ── Component intents (the app is the component's delegate) ──

    /** A file node was activated (clicked). */
    onFileActivated(key) {
      this.openFile(key);
    },

    /** A node was moved or renamed (the component already moved it visually). */
    async onNodeMoved(srcPath, destPath, isFolder) {
      const move = isFolder ? this.vfs.moveFolder : this.vfs.moveFile;
      await move(srcPath, destPath);

      const pairs = this.fileTree.applyRelocatedKeys(srcPath, destPath, isFolder);
      pairs.forEach(({ src, dest }) => this.updateOpenTabPath(src, dest));
    },

    /** A node deletion was confirmed by the user. */
    async onNodeDeleted(key, isFolder) {
      if (isFolder) {
        await this.closeFilesFromFolder(key);
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
        await importEntry(this.vfs, entry, '', destParentKey);
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
      this.runCode({ filepath: key });
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

  // Rebuild the tree when the VFS structure changes from outside the tree UI
  // (shell touch/mkdir, output redirection, or local filesystem polling), unless
  // the user is mid-interaction. Consolidates what used to be two separate
  // listeners (FS-structure events and LFS fileSystemChanged).
  const rebuildOnChange = () => {
    if (!app.isFSReloadSuspended()) app.refreshFileTree();
  };
  app.vfs.addEventListener('fileCreated', rebuildOnChange);
  app.vfs.addEventListener('folderCreated', rebuildOnChange);
  app.vfs.addEventListener('fileDeleted', rebuildOnChange);
  app.vfs.addEventListener('fileSystemChanged', rebuildOnChange);
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
function importEntry(vfs, item, path = '', targetNodePath = null) {
  return new Promise((resolve) => {
    if (item.isFile) {
      item.file((file) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const buffer = e.target.result;
          const destPath = [targetNodePath, path, file.name].filter((s) => s).join('/');
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
