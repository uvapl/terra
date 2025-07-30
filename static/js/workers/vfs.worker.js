/**
 * This worker module managed the file system connection,
 * either to a local file system (via a provided handle) or
 * to the browser-managed origin private file system (OPFS).
 *
 * The module has no initialization procedure. Calling FS
 * operations will *always* work, because by default, it is
 * connected to the OPFS.
 *
 * The worker is managed by the VFS class in vfs-client.js.
 * Information is exchanged via postMessage calls and
 * translated into method or event handler calls on each side.
 *
 * Switching to another file system is done by calling
 * handlers.setRootHandle(). This does nothing more than
 * setting a variable, which is used from then on in FS
 * operations.
 */

import { getPartsFromPath, seconds, slugify } from '../helpers/shared.js';

const blacklistedPaths = [
  'site-packages', // when user folder has python virtual env
  '__pycache__', // Python cache directory
  '.mypy_cache', // Mypy cache directory
  '.venv',
  'venv',
  'env', // virtual environment
  '.DS_Store', // Macos metadata file
  'dist',
  'build', // compiled assets for various languages
  'coverage',
  '.nyc_output', // code coverage reports
  '.git', // Git directory
  'node_modules', // NodeJS projects
];

/**
 * When set, the vfsRoot should be a FileSystemDirectoryHandle
 * pointing to a local file system.
 *
 * When null, this means that we will be working in the
 * "origin private file system" (OPFS), managed by the browser.
 */
let vfsRoot = null;

/**
 * For polling or external changes in the FS.
 */
let watchRootFolderInterval;
let previousTree = null;

/**
 * Main message dispatcher for this worker.
 * It calls functions in the `handler` variable.
 * Errors are catched and translated to a postMessage to the main UI.
 */
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
  console.log(`vfs worker message: ${type}`);

  // Call function, wait for result to resolve, and post that back
  const result = await handlers[type](...(data ?? []));
  self.postMessage({ id, type: `${type}:result`, data: result });

  /* note: exception handling disabled to get good tracebacks on the worker */
  // try {
  // } catch (err) {
  //   self.postMessage({ id, type: `${type}:error`, error: err.message });
  // }
};

// Operation handlers
const handlers = {
  /**
   * Connect the file system to a local FS handle provided by the UI,
   * or reset to `null` to use the origin private file system (OPFS).
   *
   * If set to a FS handle, this will automatically activate change
   * polling. Any external change to the FS will trigger an event.
   *
   * Safari does not support local file systems other than the OPFS.
   * However, it also does not support sending directory handles
   * to a worker via postMessage, so this function will not be
   * called on Safari anyway.
   *
   * @param {FileSystemDirectoryHandle | null} handle
   * @returns {Promise<void>} Resolves when ready.
   */
  async setRootHandle(handle) {
    vfsRoot = handle;

    // (de)activate external changes polling
    if (isOPFS()) {
      clearTimeout(watchRootFolderInterval);
    } else {
      await resetTreeState();
      watchRootFolder();
    }
  },

  /**
   * Clear the filesystem, removing all files and folders permanently.
   * Called when the app switches to a Git repo (OPFS is needed as backed)
   * or when the app disconnects from the Git repo.
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
      if ('remove' in FileSystemDirectoryHandle.prototype) {
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
   * @returns {Promise<boolean>} True if VFS is empty, false otherwise.
   */
  async isEmpty() {
    // Count the root folders and files.
    const files = await findFilesInFolder();
    const folders = await findFoldersInFolder();

    return files.length === 0 && folders.length === 0;
  },

  /**
   * Retrieve the content of a file as string.
   * Error thrown when not found or specified size exceeded.
   *
   * @param {string} filepath - The absolute file path.
   * @param {number} maxSize - Maximum allowed content size to return.
   * @returns {Promise<string>} The file content.
   */
  async readFile(path, maxSize) {
    console.log(`readFile: ${path}`);

    // throw on non-existing path // TODO can this be merged with getFileHandleByPath?
    if (!(await handlers.pathExists(path))) {
      throw new Error(`FileNotFound:${path}`);
    }

    const handle = await getFileHandleByPath(path);

    if (isOPFS()) {
      // Use Safari-compatible API.
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
      // Use general FS API.
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
   * @param {string} path - The name of the file. Leave empty to
   * create a new Untitled file in the root directory.
   * @param {string} content - The initial content of the file.
   * // TODO had isUserInvoked but is this needed?
   * @param {boolean} isUserInvoked - Whether user invoked the action.
   * @returns {Promise<string>} The path for the new file. // TODO is object actually
   */
  async createFile(path, content, isUserInvoked = true) {
    const parts = path ? path.split('/') : [];
    let name = path ? parts.pop() : 'Untitled';
    const parentPath = parts.join('/');

    // getFolderHandleByPath handles root path, too
    const folder = await getFolderHandleByPath(parentPath);

    while (await handlers.pathExists(`${parentPath}/${name}`)) {
      name = incrementString(name);
    }

    // Create an empty file and add content if provided.
    const handle = await folder.getFileHandle(name, { create: true });
    if (content) {
      writeFile(handle, content);
    }

    if (isUserInvoked) {
      const filepath = parentPath ? `${parentPath}/${name}` : name;
      self.postMessage({
        type: 'fileCreated',
        data: { file: { path: filepath, content } },
      });
    }

    return { name, path: `${parentPath}/${name}` };
  },

  /**
   * Update a file in the virtual filesystem.
   *
   * @param {string} path - The file path.
   * @param {string} content - The new content of the file.
   * @param {boolean} isUserInvoked - Whether user invoked the action.
   * @returns {Promise<FileSystemFileHandle>} The updated file handle.
   */
  async updateFile(path, content, isUserInvoked = true) {
    const handle = await getFileHandleByPath(path);
    if (!handle) return;

    // TODO why debounce this? See original `updateFileContent`.
    writeFile(handle, content);

    if (isUserInvoked) {
      self.postMessage({
        type: 'fileContentChanged',
        data: { file: { path, content } },
      });
    }
  },

  /**
   * Delete a file.
   *
   * @param {string} path - The path of the file to delete.
   * @param {boolean} isUserInvoked - Whether the action was user-invoked.
   * @returns {Promise<boolean>} Resolves to true if deleted successfully, false otherwise.
   */
  async deleteFile(path, isUserInvoked = true) {
    if (!(await handlers.pathExists(path))) {
      return false;
    }

    const parts = path.split('/');
    const filename = parts.pop();
    const parentPath = parts.join('/');
    const parent = await getFolderHandleByPath(parentPath);
    await parent.removeEntry(filename);

    if (isUserInvoked) {
      self.postMessage({
        type: 'fileDeleted',
        data: { file: { path } },
      });
    }

    // TODO
    return true;
  },

  /**
   * Gathers all files from the VFS.
   * Formerly known as getAllEditorFiles.
   *
   * @returns {Promise<object[]>} List of objects, each containing the filepath
   * and content of the corresponding file.
   */
  async getAllFiles() {
    const root = await getRootHandle();
    const files = [];

    async function walk(folderHandle, currentPath = '') {
      for await (const [name, handle] of folderHandle.entries()) {
        if (blacklistedPaths.includes(name)) continue;
        const path = currentPath ? `${currentPath}/${name}` : name;

        if (handle.kind === 'file') {
          // TODO this is safari api, is this needed?
          if (isOPFS()) {
            // Use Safari-compatible API.
            const accessHandle = await handle.createSyncAccessHandle();
            const size = accessHandle.getSize();
            const buffer = new Uint8Array(size);
            accessHandle.read(buffer, { at: 0 });
            accessHandle.close();
            const content = new TextDecoder().decode(buffer);
            files.push({ path, content });
          } else {
            // Use general FS API.
            const file = await handle.getFile();
            const content = await file.text();
            files.push({ path, content });
          }
        } else if (handle.kind === 'directory') {
          await walk(handle, path);
        }
      }
    }

    await walk(root);
    return files;
  },

  /**
   * Create a new folder.
   * TODO `isUserInvoked` is unused.
   *
   * @param {object} path - The path where the new folder will be created.
   * Leave empty to create a new Untitled folder in the root directory.
   * @returns {Promise<FileSystemDirectoryHandle>} The new folder handle.
   */
  async createFolder(path, isUserInvoked = true) {
    const parts = path ? path.split('/') : [];
    let name = path ? parts.pop() : 'Untitled';
    const parentPath = parts.join('/');

    let parentFolderHandle = parentPath
      ? await getFolderHandleByPath(parentPath)
      : await getRootHandle();

    // Ensure a unique folder name.
    while (await handlers.pathExists(name, parentFolderHandle)) {
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
   * @returns {Promise<boolean>} True if deleted successfully, false otherwise.
   */
  async deleteFolder(path) {
    if (!(await handlers.pathExists(path))) {
      return false;
    }

    // Gather all subfiles and trigger a deleteFile on them.
    const files = await findFilesInFolder(path);
    for (const file of files) {
      const filepath = `${path}/${file.name}`;
      await handlers.deleteFile(filepath, true);
    }

    // Delete all the nested folders inside the current folder.
    const folders = await findFoldersInFolder(path);
    for (const folder of folders) {
      const folderpath = `${path}/${folder.name}`;
      await handlers.deleteFolder(folderpath, false);
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
   * @param {string} srcPath - The source path of the file to move.
   * @param {string} destPath - The destination path where the file should be moved to.
   * @returns {Promise}
   */
  async moveFile(src, dest) {
    console.log(`moveFile: ${src} -> ${dest}`);

    const srcFileContent = await handlers.readFile(src);

    // Create the file in the new destination path.
    const newFileHandle = await handlers.createFile(
      dest,
      srcFileContent,
      false,
    );

    // Delete the old file.
    await handlers.deleteFile(src, false);

    self.postMessage({
      type: 'fileMoved',
      data: {
        oldPath: src,
        file: {
          path: dest,
          content: srcFileContent,
        },
      },
    });
  },

  /**
   * Update a folder in the virtual filesystem.
   *
   * Move folder2 from folder1 to folder3
   * @example moveFolder('folder1/folder2', 'folder3/folder2')
   *
   * @param {string} srcPath - The absolute path of the source folder.
   * @param {string} dstPath - The absolute path where the source folder should
   * be moved to.
   * @returns {Promise}
   */
  async moveFolder(srcPath, dstPath) {
    // Create the destination folder before moving contents.
    await handlers.createFolder(dstPath);

    // Move all files inside the folder to the new destination path.
    const files = await findFilesInFolder(srcPath);
    for (const file of files) {
      const filePath = `${srcPath}/${file.name}`;
      const newFilePath = dstPath ? `${dstPath}/${file.name}` : file.name;
      await handlers.moveFile(filePath, newFilePath);
    }

    // Recurse on folders inside the folder.
    const folders = await findFoldersInFolder(srcPath);
    for (const folder of folders) {
      const subFolderPath = `${srcPath}/${folder.name}`;
      const newFolderPath = dstPath ? `${dstPath}/${folder.name}` : folder.name;
      await handlers.moveFolder(subFolderPath, newFolderPath);
    }

    // Delete source folder recursively.
    await handlers.deleteFolder(srcPath);
  },

  /**
   * Create a file tree list from the VFS compatible with FancyTree.
   *
   * @param {string} path - The parent folder absolute path.
   * @returns {Promise<array>} List with file tree objects.
   */
  async getFileTree(path = '') {
    const folders = await Promise.all(
      (await findFoldersInFolder(path)).map(async (folder) => {
        const subpath = path ? `${path}/${folder.name}` : folder.name;
        const subtree = subpath ? await handlers.getFileTree(subpath) : null;
        return {
          key: subpath,
          title: folder.name,
          folder: true,
          data: {
            type: 'folder',
            isFolder: true,
          },
          children: subtree,
        };
      }),
    );

    const files = (await findFilesInFolder(path)).map((file) => ({
      key: path ? `${path}/${file.name}` : file.name,
      title: file.name,
      folder: false,
      data: {
        type: 'file',
        isFile: true,
      },
    }));

    // sort the tree so it can be compared in watchRootFolder
    folders.sort((a, b) => a.key.localeCompare(b.key));
    files.sort((a, b) => a.key.localeCompare(b.key));

    return folders.concat(files);
  },

  /**
   * Get all names of files inside a given folder.
   *
   * @param {string} path - The absolute folder path.
   * @returns {Promise<string[]>} Array of file paths.
   */
  async listFilesInFolder(path) {
    const handles = await findFilesInFolder(path);
    return handles.map((handle) => handle.name);
  },

  /**
   * Get all names of folders inside a given folder.
   *
   * @param {string} path - The absolute folder path to search in.
   * @returns {Promise<FileSystemDirectoryHandle[]>} Array of folder handles.
   */
  async listFoldersInFolder(path) {
    const handles = await findFoldersInFolder(path);
    return handles.map((handle) => handle.name);
  },

  /**
   * Check if a given path exists, either as a file or a folder.
   *
   * @param {string} path - The path to check.
   * @param {string|FileSystemDirectoryHandle} [parentFolder] - Check whether
   * the path exists in this folder. Defaults to the root folder handle. Either
   * the absolute folder path or a FileSystemDirectoryHandle can be provided.
   * @returns {Promise<boolean>} True if the path exists, false otherwise.
   */
  async pathExists(path, parentFolder = null) {
    const rootHandle = vfsRoot;

    let parentFolderHandle = rootHandle;
    if (typeof parentFolder === 'string') {
      parentFolderHandle = await this.getFolderHandleByPath(parentFolder);
    } else if (parentFolder instanceof FileSystemDirectoryHandle) {
      parentFolderHandle = parentFolder;
    }

    if (!parentFolderHandle) {
      parentFolderHandle = rootHandle;
    }

    const parts = path.split('/');
    const last = parts.pop();

    // Check if the parent folders exist.
    let currentHandle = parentFolderHandle;
    for (const part of parts) {
      try {
        currentHandle = await currentHandle.getDirectoryHandle(part, {
          create: false,
        });
      } catch {
        // If the handle does not exist, return false.
        return false;
      }
    }

    // At this point, we know the parent folder exists.
    // The last part of the path could be either file or folder, so we just
    // iterate over each entry and check if it exists.
    for await (let name of currentHandle.keys()) {
      if (name === last) {
        // If the entry exists, return true.
        return true;
      }
    }

    return false;
  },
};

/**
 * Polling function to watch the root folder for changes. As long as Chrome's
 * LocalFilesystemAPI does not have event listeners built-in, we have no other
 * choice to poll the root folder for changes manually.
 *
 * Polling only applies to local storage and LFS mode, but not when connected
 * to a GitHub repository.
 *
 * Note that this does clear rebuild the VFS and visual file tree every
 * few seconds, which---besides not being efficient---also creates new
 * file/folder IDs every time. It's not a problem, but just something to be
 * aware of.
 */
function watchRootFolder() {
  if (watchRootFolderInterval) {
    clearInterval(watchRootFolderInterval);
  }

  watchRootFolderInterval = setInterval(async () => {
    console.log('Checking FS changes...');
    const newTree = await handlers.getFileTree();
    if (JSON.stringify(newTree) !== JSON.stringify(previousTree)) {
      previousTree = newTree;
      self.postMessage({ type: 'fileSystemChanged', data: newTree });
    }
  }, seconds(5));
}

/**
 * Save the current file tree in the polling cache. To be
 * used after switching file systems, so the new FS content is
 * not reported as a change.
 */
async function resetTreeState() {
  previousTree = await handlers.getFileTree();
}

function incrementString(str) {
  const match = /\((\d+)\)$/.exec(str);
  if (match) {
    const num = parseInt(match[1]) + 1;
    return str.replace(/\((\d+)\)$/, `(${num})`);
  }
  return `${str} (1)`;
}

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
 * @param {string} folderpath - The absolute folder path.
 * @returns {Promise<FileSystemDirectoryHandle>} The folder handle.
 */
async function getFolderHandleByPath(folderpath = '') {
  // console.log(`${folderpath}`);
  const rootHandle = await getRootHandle();
  if (!folderpath) return rootHandle;

  let handle = rootHandle;
  const parts = folderpath.split('/');

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
 * @param {string} filepath - The absolute file path.
 * @returns {Promise<FileSystemFileHandle|null>} The file handle if it exists.
 */
async function getFileHandleByPath(filepath) {
  if (!(await handlers.pathExists(filepath))) {
    return null;
  }

  const { name, parentPath } = getPartsFromPath(filepath);

  let parentFolderHandle = await getFolderHandleByPath(parentPath);
  const fileHandle = await parentFolderHandle.getFileHandle(name, {
    create: false,
  });

  return fileHandle;
}

/**
 * Get all folder handles inside a given folder path (NOT recursive).
 *
 * @param {string} folderpath - The absolute folder path to search in.
 * @returns {Promise<FileSystemDirectoryHandle[]>} Array of folder handles.
 */
async function findFoldersInFolder(folderpath) {
  // Obtain the folder handle recursively.
  const folderHandle = await getFolderHandleByPath(folderpath);

  // Gather all subfolder handles.
  const subfolders = [];
  for await (let handle of folderHandle.values()) {
    if (
      handle.kind === 'directory' &&
      !blacklistedPaths.includes(handle.name)
    ) {
      subfolders.push(handle);
    }
  }

  return subfolders;
}

/**
 * Get all file handles inside a given path (NOT recursive).
 *
 * @param {string} folderpath - The absolute folder path to search in.
 * @returns {Promise<FileSystemFileHandle[]>} Array of file handles.
 */
async function findFilesInFolder(folderpath) {
  // Obtain the folder handle recursively.
  const folderHandle = await getFolderHandleByPath(folderpath);

  // Gather all subfile handles.
  const subfiles = [];
  for await (let handle of folderHandle.values()) {
    if (handle.kind === 'file' && !blacklistedPaths.includes(handle.name)) {
      subfiles.push(handle);
    }
  }

  return subfiles;
}

/**
 * Writes data to a file.
 *
 * @param {FileSystemFileHandle} handle - The handle of the file to write.
 * @param {string} content - The content to write to the file.
 * @returns {Promise<void>} Resolves when the file is successfully written.
 */
async function writeFile(handle, content) {
  if (isOPFS()) {
    // Use Safari-compatible API.
    console.log('writeFile to OPFS');
    const accessHandle = await handle.createSyncAccessHandle();
    const data = new TextEncoder().encode(content);
    accessHandle.truncate(data.byteLength);
    accessHandle.write(data, { at: 0 });
    accessHandle.flush();
    accessHandle.close();
  } else {
    // Use general FS API.
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  }
}
