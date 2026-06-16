/**
 * File-tree controller concern.
 *
 * Installs the glue the file-tree view (file-tree-manager.js) needs to keep the
 * VFS, open editor tabs and workers in sync with what the user does in the tree.
 * file-tree-manager.js stays a FancyTree adapter and calls these methods via
 * `Terra.app.<method>` for anything that touches the VFS, tabs or workers.
 *
 * @param {App} app - The app instance to install the file-tree controller on.
 */
export function useFileTree(app) {
  Object.assign(app, {
    /**
     * Get the minimal file tree from the VFS, for the view to convert into a
     * FancyTree-compatible structure.
     *
     * @async
     * @returns {Promise<object[]>} Minimal tree (title, folder, children).
     */
    getFileTree() {
      return this.vfs.getFileTree();
    },

    /**
     * Create a new file in the VFS.
     *
     * @async
     * @param {string|null} [path] - The path for the new file, or null for a new
     * file in the root folder.
     * @returns {Promise<string>} The name of the created file.
     */
    createFileInVFS(path = null) {
      return this.vfs.createFile(path);
    },

    /**
     * Create a new folder in the VFS.
     *
     * @async
     * @param {string|null} [path] - The path for the new folder, or null for a
     * new folder in the root folder.
     * @returns {Promise<object>} The created folder object.
     */
    createFolderInVFS(path = null) {
      return this.vfs.createFolder(path);
    },

    /**
     * Move a file or folder in the VFS.
     *
     * @async
     * @param {string} srcPath - The current absolute path.
     * @param {string} destPath - The new absolute path.
     * @param {boolean} isFolder - Whether the entry is a folder.
     * @returns {Promise<void>}
     */
    moveEntry(srcPath, destPath, isFolder) {
      const fn = isFolder ? this.vfs.moveFolder : this.vfs.moveFile;
      return fn(srcPath, destPath);
    },

    /**
     * Delete a file or folder: close any affected editor tabs, then delete the
     * entry from the VFS.
     *
     * @async
     * @param {string} path - The absolute path of the entry to delete.
     * @param {boolean} isFolder - Whether the entry is a folder.
     * @returns {Promise<void>}
     */
    async deleteEntry(path, isFolder) {
      if (isFolder) {
        await this.closeFilesFromFolder(path);
      } else {
        this.closeFile(path);
      }

      const fn = isFolder ? this.vfs.deleteFolder : this.vfs.deleteFile;
      await fn(path);
    },

    /**
     * Download a file or folder from the VFS.
     *
     * @param {string} path - The absolute path of the entry to download.
     * @param {boolean} isFolder - Whether the entry is a folder.
     */
    downloadEntry(path, isFolder) {
      const fn = isFolder ? this.vfs.downloadFolder : this.vfs.downloadFile;
      fn(path);
    },

    /**
     * Create a file or folder in the VFS from a FileSystemEntry object, such as
     * one obtained when the user drags a file/folder from their local
     * filesystem onto the file tree. Recurses into directories.
     *
     * @async
     * @param {FileSystemEntry} item - The file or folder entry.
     * @param {string} [path] - The path of the entry.
     * @param {string} [targetNodePath] - The path of the node it was dropped onto.
     * @return {Promise<void>} Resolves when the file or folder has been created.
     */
    importFileSystemEntry(item, path = '', targetNodePath = null) {
      return new Promise((resolve) => {
        if (item.isFile) {
          item.file((file) => {
            const reader = new FileReader();
            reader.onload = (e) => {
              const buffer = e.target.result;
              const destPath = [targetNodePath, path, file.name].filter((s) => s).join('/');
              this.vfs.createFile(destPath, buffer).then(() => {
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
              await this.importFileSystemEntry(entry, subpath, targetNodePath);
            }
            resolve();
          });
        }
      });
    },
  });
}
