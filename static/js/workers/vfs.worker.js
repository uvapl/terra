import { getPartsFromPath, seconds, slugify } from "../helpers/shared.js";
import idbManager from "../idb.js";

const blacklistedPaths = [
  "site-packages",
  "__pycache__",
  ".mypy_cache",
  ".venv",
  "venv",
  "env",
  ".DS_Store",
  "dist",
  "build",
  "coverage",
  ".nyc_output",
  ".git",
  "node_modules",
];

function incrementString(str) {
  const match = /\((\d+)\)$/.exec(str);
  if (match) {
    const num = parseInt(match[1]) + 1;
    return str.replace(/\((\d+)\)$/, `(${num})`);
  }
  return `${str} (1)`;
}

/**
 * When set, the vfsRoot should be a FileSystemDirectoryHandle
 * pointing to a local file system.
 *
 * When null, this means that we will be working in the
 * "origin private file system" (OPFS), managed by the browser.
 */
let vfsRoot = null;

function isOPFS() {
  return vfsRoot == null;
}

/**
 * Returns the root handle provided by the UI, or gets
 * an OPFS root handle.
 *
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
async function getRootHandle() {
  return vfsRoot || (await navigator.storage.getDirectory());
}

/**
 * Get a folder handle by its absolute path.
 *
 * The example below returns the handle for folder3.
 * @example getFolderHandleByPath('folder1/folder2/folder3')
 *
 * The examples below return the root handle.
 * @example getFolderHandleByPath('')
 * @example getFolderHandleByPath()
 *
 * @async
 * @param {string} folderpath - The absolute folder path.
 * @returns {Promise<FileSystemDirectoryHandle>} The folder handle.
 */
async function getFolderHandleByPath(folderpath = "") {
  const rootHandle = await getRootHandle();
  if (!folderpath) return rootHandle;

  let handle = rootHandle;
  const parts = folderpath.split("/");

  // Walk path segments
  while (handle && parts.length > 0) {
    handle = await handle.getDirectoryHandle(parts.shift(), { create: true });
  }

  return handle;
}

/**
 * Get a file handle by its absolute path.
 *
 * The example below returns the handle for `myfile.txt`.
 * @example getFileHandleByPath('folder1/folder2/myfile.txt')
 *
 * @async
 * @param {string} filepath - The absolute file path.
 * @returns {Promise<FileSystemFileHandle|null>} The file handle if it exists.
 */
async function getFileHandleByPath(filepath) {
  if (!(await pathExists(filepath))) {
    return null;
  }

  const { name, parentPath } = getPartsFromPath(filepath);

  // Get the parent folder's handle.
  let parentFolderHandle = await getFolderHandleByPath(parentPath);

  // Get the file handle through its parent folder handle.
  const fileHandle = await parentFolderHandle.getFileHandle(name, {
    create: false,
  });

  return fileHandle;
}

/**
 * Check if a given path exists, either as a file or a folder.
 *
 * @async
 * @param {string} path - The path to check.
 * @param {string|FileSystemDirectoryHandle} [parentFolder] - Check whether
 * the path exists in this folder. Defaults to the root folder handle. Either
 * the absolute folder path or a FileSystemDirectoryHandle can be provided.
 * @returns {Promise<boolean>} True if the path exists, false otherwise.
 */
async function pathExists(path) {
  // TODO this is much more basic than the original
  const parts = path.split("/");
  const last = parts.pop();
  try {
    const folder = await getFolderHandleByPath(parts.join("/"));
    for await (const entry of folder.keys()) {
      if (entry === last) return true;
    }
  } catch (_) {}
  return false;
}

// Operation handlers
const handlers = {
  /**
   * Link the file system to a handle provided by the UI.
   *
   * @param {{ handle: FileSystemDirectoryHandle }} param0
   */
  setRootHandle({ handle }) {
    vfsRoot = handle;
    // return { ok: true };
  },

  /**
   * Clear the filesystem, removing all files and folders permanently.
   *
   * @returns {Promise<void>} Resolves when the root handle is cleared.
   */
  async clear() {
    // We only allow this when a private browser file system
    // (origin private) is connected and not when the real file
    // system is connected.
    if (isOPFS()) {
      const rootHandle = await getRootHandle();

      // To date, the 'remove' function is only available in Chromium-based
      // browsers. For other browsers, we iteratore through the first level of
      // files and folders and delete them one by one.
      if ("remove" in FileSystemDirectoryHandle.prototype) {
        await rootHandle.remove({ recursive: true });
      } else {
        // Fallback for non-Chromium browsers.
        for await (const name of rootHandle.keys()) {
          await rootHandle.removeEntry(name, { recursive: true });
        }
      }
    } else {
      throw new Error("We're not allowed to clear() a local file system");
    }
  },

  /**
   * Check whether the virtual filesystem is empty.
   *
   * @async
   * @returns {Promise<boolean>} True if VFS is empty, false otherwise.
   */
  async isEmpty() {
    // Get the root folders and files.
    const files = await this.findFilesInFolder();
    const folders = await this.findFoldersInFolder();

    return files.length === 0 && folders.length === 0;
  },

  /**
   * Obtain the content of a file by its absolute path.
   *
   * @async
   * @param {string} filepath - The absolute file path.
   * @returns {Promise<string>} The file content.
   */
  async readFile({ path, maxSize }) {
    console.log(`readFile: ${path}`);

    // Throw on non-existing path
    if (!(await pathExists(path))) {
      throw new Error(`FileNotFound:${path}`);
    }

    const handle = await getFileHandleByPath(path);

    if (isOPFS()) {
      // use Safari-compatible API
      const accessHandle = await handle.createSyncAccessHandle();
      const size = accessHandle.getSize();
      if (maxSize && size > maxSize) {
        accessHandle.close();
        throw new Error(`FileTooLarge:${handle.name}:${size}:${maxSize}`);
      }
      const buffer = new Uint8Array(size);
      accessHandle.read(buffer, { at: 0 });
      accessHandle.close();
      return new TextDecoder().decode(buffer);
    } else {
      // use general FS API
      const file = await handle.getFile();
      const size = file.size;
      if (maxSize && size > maxSize) {
        throw new Error(`FileTooLarge:${handle.name}:${size}:${maxSize}`);
      }
      return await file.text();
    }
  },

  /**
   * Create a new file.
   *
   * @param {object} fileObj - The file object to create.
   * @param {string} [fileObj.path] - The name of the file. Leave empty to
   * create a new Untitled file in the root directory.
   * @param {string} [fileObj.content] - The content of the file.
   * @param {boolean} [isUserInvoked] - Whether to user invoked the action.
   * @returns {FileSystemFileHandle} The new file handle.
   */
  async createFile({ path, content }) {
    console.log(`createFile: ${path}`);

    const parts = path ? path.split("/") : [];
    let name = path ? parts.pop() : "Untitled";
    const parentPath = parts.join("/");

    // getFolderHandleByPath handles root path, too
    const folder = await getFolderHandleByPath(parentPath);

    while (await pathExists(`${parentPath}/${name}`)) {
      name = incrementString(name);
    }

    // Create an empty file.
    const fileHandle = await folder.getFileHandle(name, { create: true });

    // TODO should be handled by writeFile, probably
    if (content) {
      const accessHandle = await fileHandle.createSyncAccessHandle();
      const data = new TextEncoder().encode(content);
      accessHandle.truncate(data.byteLength);
      accessHandle.write(data, { at: 0 });
      accessHandle.flush();
      accessHandle.close();
    }

    return { name, path: `${parentPath}/${name}` };
  },

  /**
   * Update a file in the virtual filesystem.
   *
   * @param {string} path - The file path.
   * @param {object} content - The new content of the file.
   * @param {boolean} [isUserInvoked] - Whether to user invoked the action.
   * @returns {FileSystemFileHandle} The updated file handle.
   */
  async writeFile({ path, content }) {
    console.log(`writeFile: ${path}`);
    const handle = await getFileHandleByPath(path);
    if (!handle) return;

    // TODO where should debouncing go? See original.

    if (isOPFS()) {
      // use Safari-compatible API
      console.log("writeFile to OPFS");
      const accessHandle = await handle.createSyncAccessHandle();
      const data = new TextEncoder().encode(content);
      accessHandle.truncate(data.byteLength);
      accessHandle.write(data, { at: 0 });
      accessHandle.flush();
      accessHandle.close();
      return { ok: true };
    } else {
      // use general FS API
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
    }

    if (isUserInvoked) {
      this.dispatchEvent(
        new CustomEvent("fileContentChanged", {
          detail: {
            file: { path, content },
          },
        }),
      );
    }
  },

  /**
   * Delete a file.
   *
   * @param {string} id - The path of the file to delete.
   * @param {boolean} [isSingleFileDelete] - whether this function is called for
   * a single file or is called from the `deleteFolder` function.
   * @returns {boolean} True if deleted successfully, false otherwise.
   */
  async deleteFile({ path, isUserInvoked = true }) {
    if (!(await pathExists(path))) {
      return false;
    }

    const parts = path.split("/");
    const filename = parts.pop();
    const parentPath = parts.join("/");
    const parent = await getFolderHandleByPath(parentPath);
    await parent.removeEntry(filename);

    if (isUserInvoked) {
      this.dispatchEvent(
        new CustomEvent("fileDeleted", {
          detail: {
            file: { path },
          },
        }),
      );
    }

    // TODO
    return { ok: true };
  },

  /**
   * Gathers all files from the VFS.
   * Formerly known as getAllEditorFiles.
   *
   * @async
   * @param {string} [folderpath=''] - The folder path to start searching from.
   * @returns {Promise<object[]>} List of objects, each containing the filepath
   * and content of the corresponding file.
   */
  async getAllFiles() {
    console.log(`getAllFiles:`);
    const root = await getRootHandle();
    const files = [];

    async function walk(folderHandle, currentPath = "") {
      for await (const [name, handle] of folderHandle.entries()) {
        if (blacklistedPaths.includes(name)) continue;
        const path = currentPath ? `${currentPath}/${name}` : name;

        if (handle.kind === "file") {
          const accessHandle = await handle.createSyncAccessHandle();
          const size = accessHandle.getSize();
          const buffer = new Uint8Array(size);
          accessHandle.read(buffer, { at: 0 });
          accessHandle.close();
          const content = new TextDecoder().decode(buffer);
          files.push({ path, content });
        } else if (handle.kind === "directory") {
          await walk(handle, path);
        }
      }
    }

    await walk(root);
    return files;
  },

  /**
   * Create a new folder.
   *
   * @param {object} folderpath - The path where the new folder will be created.
   * Leave empty to create a new Untitled folder in the root directory.
   * @param {boolean} [isUserInvoked] - Whether to user invoked the action.
   * @returns {FileSystemDirectoryHandle} The new folder handle.
   */
  async createFolder({ path }) {
    const parts = path ? path.split("/") : [];
    let name = path ? parts.pop() : "Untitled";
    const parentPath = parts.join("/");

    let parentFolderHandle = parentPath
      ? await getFolderHandleByPath(parentPath)
      : await getRootHandle();

    // Ensure a unique folder name.
    while (await pathExists(name, parentFolderHandle)) {
      name = incrementString(name);
    }

    // Actually create the folder.
    const newHandle = await parentFolderHandle.getDirectoryHandle(name, {
      create: true,
    });

    return { name };
  },

  /**
   * Delete a folder recursively from the VFS.
   *
   * @param {string} path - The folder path to delete.
   * @returns {boolean} True if deleted successfully, false otherwise.
   */
  async deleteFolder({ path }) {
    if (!(await pathExists(path))) {
      return false;
    }

    // Gather all subfiles and trigger a deleteFile on them.
    const files = await this.findFilesInFolder(path);
    for (const file of files) {
      const filepath = `${path}/${file.name}`;
      await this.deleteFile(filepath, true);
    }

    // Delete all the nested folders inside the current folder.
    const folders = await this.findFoldersInFolder(path);
    for (const folder of folders) {
      const folderpath = `${path}/${folder.name}`;
      await this.deleteFolder(folderpath, false);
    }

    // Finally, delete the folder itself from OPFS recursively.
    const parts = path.split('/');
    const foldername = parts.pop();
    const parentPath = parts.join('/');
    const parentFolderHandle = await getFolderHandleByPath(parentPath);
    await parentFolderHandle.removeEntry(foldername, { recursive: true });

    return true;
  },

  /**
   * Move a file from a source path to a destination path.
   *
   * @example moveFile('folder1/myfile.txt', 'folder2/myfile.txt')
   *
   * @async
   * @param {string} srcPath - The source path of the file to move.
   * @param {string} destPath - The destination path where the file should be moved to.
   */
  async moveFile({ src, dest }) {
    console.log(`moveFile: ${src} -> ${dest}`);

    const srcFileContent = await handlers.readFile({ path: src });

    // Create the file in the new destination path.
    const newFileHandle = await handlers.createFile(
      {
        path: dest,
        content: srcFileContent,
      },
      false,
    );

    // Delete the old file.
    await this.deleteFile({ path: src, isUserInvoked: false });

    // TODO needed?
    // this.dispatchEvent(new CustomEvent('fileMoved', {
    //   detail: {
    //     oldPath: src,
    //     file: {
    //       path: dest,
    //       content: srcFileContent,
    //     }
    //   },
    // }));
  },

  /**
   * Update a folder in the virtual filesystem.
   *
   * Move folder2 from folder1 to folder3
   * @example moveFolder('folder1/folder2', 'folder3/folder2')
   *
   * @param {string} srcPath - The absolute path of the source folder.
   * @param {string} destPath - The absolute path where the source folder should
   * be moved to.
   */
  async moveFolder({ src, dest }) {
    console.log(`moveFolder: ${src} -> ${dest}`);

    // Create the destination folder before moving contents.
    await this.createFolder({ path: dest });

    // Move all files inside the folder to the new destination path.
    const files = await this.findFilesInFolder(src);
    for (const file of files) {
      const filePath = `${src}/${file.name}`;
      const newFilePath = dest ? `${dest}/${file.name}` : file.name;
      await this.moveFile(filePath, newFilePath);
    }

    // Recurse on folders inside the folder.
    const folders = await this.findFoldersInFolder(src);
    for (const folder of folders) {
      const folderPath = `${src}/${folder.name}`;
      const newFolderPath = dest ? `${dest}/${folder.name}` : folder.name;
      await this.moveFolder(folderPath, newFolderPath);
    }

    // Delete source folder recursively.
    await this.deleteFolder({ path: src });
  },

  /**
   * Create a file tree list from the VFS compatible with FancyTree.
   *
   * @async
   * @param {string} [path] - The parent folder absolute path.
   * @returns {array} List with file tree objects.
   */
  async getFileTree({ path = "" }) {
    console.log(`getFileTree: ${path}`);
    const folders = await Promise.all(
      (await handlers.findFoldersInFolder(path)).map(async (folder) => {
        const subpath = path ? `${path}/${folder.name}` : folder.name;
        console.log(`found ${subpath}`);
        const subtree = subpath
          ? await this.getFileTree({ path: subpath })
          : null;
        return {
          key: subpath,
          title: folder.name,
          folder: true,
          data: {
            type: "folder",
            isFolder: true,
          },
          children: subtree,
        };
      }),
    );

    const files = (await handlers.findFilesInFolder(path)).map((file) => ({
      key: path ? `${path}/${file.name}` : file.name,
      title: file.name,
      folder: false,
      data: {
        type: "file",
        isFile: true,
      },
    }));
    return folders.concat(files);
  },

  /**
   * Get all folder handles inside a given folder path (NOT recursive).
   *
   * @async
   * @param {string} folderpath - The absolute folder path to search in.
   * @returns {Promise<FileSystemDirectoryHandle[]>} Array of folder handles.
   */
  async findFoldersInFolder(folderpath) {
    console.log(`findFoldersInFolder ${folderpath}`);
    // Obtain the folder handle recursively.
    const folderHandle = await getFolderHandleByPath(folderpath);

    // Gather all subfolder handles.
    const subfolders = [];
    for await (let handle of folderHandle.values()) {
      if (
        handle.kind === "directory" &&
        !blacklistedPaths.includes(handle.name)
      ) {
        subfolders.push(handle);
      }
    }

    return subfolders;
  },

  /**
   * Get all file handles inside a given path (NOT recursive).
   *
   * @async
   * @param {string} folderpath - The absolute folder path to search in.
   * @returns {Promise<FileSystemFileHandle[]>} Array of file handles.
   */
  async findFilesInFolder(folderpath) {
    // Obtain the folder handle recursively.
    const folderHandle = await getFolderHandleByPath(folderpath);

    // Gather all subfile handles.
    const subfiles = [];
    for await (let handle of folderHandle.values()) {
      if (handle.kind === "file" && !blacklistedPaths.includes(handle.name)) {
        subfiles.push(handle);
      }
    }

    return subfiles;
  },
};

// Message dispatcher calls functions in the handler variable
// this catches errors and translates to a postMessage to the main UI
self.onmessage = async (event) => {
  const { id, type, data } = event.data;
  if (!handlers[type]) {
    self.postMessage({
      id,
      type: `${type}:error`,
      error: `Unknown method: ${type}`,
    });
    return;
  }
  // try {
  const result = await handlers[type](data);
  self.postMessage({ id, type: `${type}:result`, data: result });
  // } catch (err) {
  //   self.postMessage({ id, type: `${type}:error`, error: err.message });
  // }
};
