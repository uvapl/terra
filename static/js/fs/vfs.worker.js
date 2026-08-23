/**
 * This worker module managed the file system connection,
 * either to a local file system (via a provided handle) or
 * to the browser-managed origin private file system (OPFS).
 *
 * The module has no initialization procedure. Calling FS
 * operations will *always* work, because by default, it is
 * connected to the OPFS.
 *
 * The worker is managed by the VFS class in fs/vfs.js.
 * Information is exchanged via postMessage calls and
 * translated into method or event handler calls on each side.
 *
 * Switching to another file system is done by calling
 * handlers.connect(). This does nothing more than
 * setting a variable, which is used from then on in FS
 * operations.
 */

import {
  getPartsFromPath,
  seconds,
  isImageExtension
} from '../lib/helpers.js';

/**
 * When set, the _vfsRoot should be a FileSystemDirectoryHandle
 * pointing to a local file system.
 *
 * When null, this means that we will be working in the
 * "origin private file system" (OPFS), managed by the browser.
 *
 * The _vfsBaseFolder is the subfolder to be used as the base
 * project root.
 */
let _vfsRoot = null;
let _vfsBaseFolder = '';

/**
 * Ignore rules registered by the main thread (see vfs.js). Each holds a test
 * for a single path segment and whether matching files are Terra's own.
 */
let ignoreRules = [];

/**
 * Whether a path segment is left out of listings.
 *
 * @param {string} name - A file or folder name.
 * @returns {boolean}
 */
const isIgnored = (name) => ignoreRules.some((rule) => rule.test(name));

/**
 * Whether a path segment belongs to something Terra does not own, which is
 * never read and never reported in an event.
 *
 * @param {string} name - A file or folder name.
 * @returns {boolean}
 */
const isUntracked = (name) =>
  ignoreRules.some((rule) => rule.test(name) && !rule.tracked);

/**
 * Whether an entry is left out at the given level.
 *
 * @param {string} name - A file or folder name.
 * @param {string} include - `listed` leaves out every ignored entry, `tracked`
 * leaves out only what Terra does not own, `all` leaves out nothing.
 * @returns {boolean}
 */
function excluded(name, include) {
  if (include === 'all') return false;
  if (include === 'tracked') return isUntracked(name);
  return isIgnored(name);
}

/**
 * Compiled binaries are kept in memory only, but made accessible in some
 * cases, e.g. to run them.
 *
 * @type {Map<string, { content: Uint8Array, mtime: number }>}
 */
const tempBinaries = new Map();

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

  // Call function, wait for result to resolve, and post that back. A handler
  // that throws still has to answer, otherwise the caller waits forever.
  let result;
  try {
    result = await handlers[type](...(data ?? []));
  } catch (err) {
    self.postMessage({ id, type: `${type}:error`, error: `${err.name}: ${err.message}` });
    return;
  }

  if (result && result.error) {
    self.postMessage({ id, type: `${type}:error`, error: result.error });
  } else {
    // Transfer an ArrayBuffer instead of copying it.
    const transfer = result instanceof ArrayBuffer ? [result] : [];

    self.postMessage({ id, type: `${type}:result`, data: result }, transfer);
  }
};

/**
 * Handlers for each operation that is made available.
 *
 * When writing a handler, you can return any of these:
 *   - a normal JS value
 *   - a promise (i.e. if the function is async)
 *   - nothing
 *   - an error object like { error: 'FileNotFound' }
 *
 * In vfs.js you can define error classes that will be thrown
 * as a result of returning those error objects.
 */
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
   * @param {string} baseFolderName
   * @returns {Promise<void>} Resolves when ready.
   */
  async connect(handle, baseFolderName = '') {
    _vfsRoot = handle;
    _vfsBaseFolder = baseFolderName;

    tempBinaries.clear();

    console.log(`base folder set: ${baseFolderName} in ${handle}`);

    // (De)activate external changes polling.
    if (isOPFS()) {
      clearTimeout(watchRootFolderInterval);
    } else {
      await resetTreeState();
      watchRootFolder();
    }
  },

  /**
   * Set the base directory in the file system. Any paths will be considered
   * relative to this directory.
   *
   * @param {string} baseFolderName
   */
  setBaseFolder(baseFolderName) {
    console.log(`base folder: ${baseFolderName}`);
    _vfsBaseFolder = baseFolderName;
  },

  /**
   * Clear the filesystem, removing all files and folders permanently.
   * Called when the app switches to a Git repo (OPFS is needed as backed)
   * or when the app disconnects from the Git repo.
   *
   * @returns {Promise<void>} Resolves when the root handle is cleared.
   */
  async clear() {
    // In-memory tempfiles can always be cleared.
    tempBinaries.clear();

    // We only allow clearing when a private browser file system
    // (origin private) is connected and not when the real file
    // system is connected.
    if (isOPFS()) {
      const rootHandle = await getRootFolderHandle();

      // To date, the 'remove' function is only available in Chromium-based
      // browsers. For other browsers, we iterate through the first level of
      // files and folders and delete them one by one.
      if ('remove' in FileSystemDirectoryHandle.prototype) {
        await rootHandle.remove({ recursive: true });
      } else {
        // Fallback for non-Chromium browsers. The names are collected first,
        // so removing them does not disturb the iteration.
        for (const [name] of await readEntries(rootHandle)) {
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
   * @returns {Promise<string|ArrayBuffer>} The file content.
   */
  async readFile(path, maxSize) {
    console.log(`readFile: ${path}`);

    // Either get the file from the binaries store...
    const temp = tempBinaries.get(path);
    if (temp) {
      if (maxSize && temp.content.byteLength > maxSize) {
        return { error: 'FileTooLarge' };
      }
      // Create a copy to return.
      return temp.content.slice().buffer;
    }

    // ...or get it from the FS.
    const handle = await getFileHandleByPath(path);
    if (!handle) {
      return { error: 'FileNotFound' };
    }

    const file = await handle.getFile();
    const size = file.size;
    if (maxSize && size > maxSize) {
      return { error: 'FileTooLarge' };
    }

    return isImageExtension(path) ? await file.arrayBuffer() : await file.text();
  },

  async getFileURL(path) {
    const handle = await getFileHandleByPath(path);
    if (!handle) {
      throw new Error(`FileNotFound:${path}`);
    }

    const file = await handle.getFile();
    return URL.createObjectURL(file);
  },

  /**
   * Create a new file.
   *
   * @param {string} path - The name of the file. Leave empty to
   * create a new Untitled file in the root directory.
   * @param {string|ArrayBuffer} content - The initial content of the file.
   * @param {boolean} isUserInvoked - Whether user invoked the action.
   * @returns {Promise<string>} The generated name for the new file.
   */
  async createFile(path, content, isUserInvoked = true) {
    const parts = path ? path.split('/') : [];
    let name = path ? parts.pop() : 'Untitled';
    const parentPath = parts.join('/');

    const folder = await getFolderHandleByPath(parentPath, { create: true });

    // A real file overwrites a binary with the same name.
    tempBinaries.delete(parentPath ? `${parentPath}/${name}` : name);

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

    return name;
  },

  /**
   * Update a file in the virtual filesystem.
   *
   * @param {string} path - The file path.
   * @param {string} content - The new content of the file.
   * @param {boolean} isUserInvoked - Whether user invoked the action.
   * @returns {Promise<void>}
   */
  async updateFile(path, content, isUserInvoked = true) {
    // A real file overwrites a binary with the same name.
    tempBinaries.delete(path);

    // Upsert: create the file (and any missing parent folders) when it does
    // not exist yet, writing to the exact path with no collision rename.
    const existed = await handlers.pathExists(path);
    const handle = await getFileHandleByPath(path, { create: true });

    await writeFile(handle, content);

    if (isUserInvoked) {
      // A freshly created file must post `fileCreated` so the file tree learns
      // about it (see filetree.js); an existing file only changed content.
      self.postMessage({
        type: existed ? 'fileContentChanged' : 'fileCreated',
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
    // Either delete from the binaries store...
    if (tempBinaries.delete(path)) {
      if (isUserInvoked) {
        // Note that we do not post fileDeleted (e.g. to git) for tempfiles
        self.postMessage({ type: 'fileSystemChanged' });
      }
      return true;
    }

    // ...or from the FS.
    if (!(await handlers.pathExists(path))) {
      return false;
    }

    const parts = path.split('/');
    const filename = parts.pop();
    const parentPath = parts.join('/');
    const parent = await getFolderHandleByPath(parentPath);
    if (!parent) return false;

    await parent.removeEntry(filename);

    if (isUserInvoked) {
      self.postMessage({
        type: 'fileDeleted',
        data: { file: { path } },
      });
    }

    return true;
  },

  /**
   * Write a file that a run produced, either in mem or persisted.
   *
   * @param {string} path - The absolute file path.
   * @param {string|ArrayBuffer|Uint8Array} content - The file content.
   * @param {boolean} temporary - Whether this is a build artifact.
   * @returns {Promise<void>}
   */
  async writeProducedFile(path, content, temporary = false) {
    return temporary
      ? handlers.writeTempBinary(path, content)
      : handlers.updateFile(path, content);
  },

  /**
   * Write a temporary compiled binary file.
   *
   * @param {string} path - The absolute file path.
   * @param {ArrayBuffer|Uint8Array} content - The file content.
   * @returns {Promise<void>}
   */
  async writeTempBinary(path, content) {
    const existed = tempBinaries.has(path);

    // Do not allow overwriting a "real" file with a temp binary.
    if (!existed && (await handlers.pathExists(path))) {
      return { error: 'FileExists' };
    }

    tempBinaries.set(path, {
      content: content instanceof Uint8Array ? content : new Uint8Array(content),
      mtime: Date.now(),
    });

    // Note that we do not post fileCreated (e.g. to git) for tempfiles
    self.postMessage({ type: 'fileSystemChanged' });
  },

  /**
   * Whether a path holds a compiled binary.
   *
   * @param {string} path - The absolute file path.
   * @returns {Promise<boolean>}
   */
  async isTempBinary(path) {
    return tempBinaries.has(path);
  },

  /**
   * Set the rules that decide which entries are left out of listings.
   *
   * @param {object[]} rules - Each with a `name`, `suffix` or `pattern` to
   * match one path segment, and a `tracked` flag.
   */
  setIgnoreRules(rules) {
    ignoreRules = rules.map(({ name, suffix, pattern, tracked = true }) => {
      const re = pattern ? new RegExp(pattern) : null;

      return {
        tracked,
        test: (segment) =>
          re ? re.test(segment)
            : suffix ? segment.endsWith(suffix)
            : segment === name,
      };
    });
  },

  /**
   * Gathers all files from the VFS.
   *
   * @returns {Promise<object[]>} List of objects, each containing the filepath
   * and content of the corresponding file.
   */
  async getAllFiles(path) {
    const files = [];

    await walkFiles(path, async (filepath, handle) => {
      const file = await handle.getFile();
      const content = isImageExtension(filepath)
        ? await file.arrayBuffer()
        : await file.text();

      files.push({ path: filepath, content });
    });

    return files;
  },

  /**
   * Lists every file in the VFS without reading any content. `size` and `mtime`
   * come from file metadata.
   *
   * @returns {Promise<object[]>} List of objects, each containing the filepath,
   * byte size and last-modified timestamp of the corresponding file.
   */
  async getFileList(path) {
    const entries = [];

    await walkFiles(path, async (filepath, handle) => {
      const file = await handle.getFile();
      entries.push({
        path: filepath,
        size: file.size,
        mtime: file.lastModified,
      });
    });

    return entries;
  },

  /**
   * Create a new folder.
   *
   * @param {object} path - The path where the new folder will be created.
   * Leave empty to create a new Untitled folder in the root directory.
   * @param {boolean} isUserInvoked - Whether the action was user-invoked.
   * @returns {Promise<FileSystemDirectoryHandle>} The new folder handle.
   */
  async createFolder(path, isUserInvoked = true) {
    const parts = path ? path.split('/') : [];
    let name = path ? parts.pop() : 'Untitled';
    const parentPath = parts.join('/');

    let parentFolderHandle = parentPath
      ? await getFolderHandleByPath(parentPath, { create: true })
      : await getRootFolderHandle();

    // Ensure a unique folder name.
    while (await nameExistsInFolder(parentFolderHandle, name)) {
      name = incrementString(name);
    }

    // Actually create the folder.
    const newHandle = await parentFolderHandle.getDirectoryHandle(name, {
      create: true,
    });

    if (isUserInvoked) {
      const folderpath = parentPath ? `${parentPath}/${name}` : name;
      self.postMessage({
        type: 'folderCreated',
        data: { folder: { path: folderpath } },
      });
    }

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
    const files = await findFilesInFolder(path, { include: 'tracked' });
    for (const file of files) {
      const filepath = `${path}/${file.name}`;
      await handlers.deleteFile(filepath, true);
    }

    // Delete temporary binaries.
    for (const filepath of tempBinariesUnder(path)) {
      await handlers.deleteFile(filepath, true);
    }

    // Delete all the nested folders inside the current folder.
    const folders = await findFoldersInFolder(path, { include: 'tracked' });
    for (const folder of folders) {
      const folderpath = `${path}/${folder.name}`;
      await handlers.deleteFolder(folderpath, false);
    }

    // Finally, delete the folder itself from OPFS recursively.
    const parts = path.split('/');
    const foldername = parts.pop();
    const parentPath = parts.join('/');
    const parentFolderHandle = await getFolderHandleByPath(parentPath);
    if (!parentFolderHandle) return false;

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
   * @returns {Promise<boolean|void>} False if the source does not exist.
   */
  async moveFile(src, dest) {
    console.log(`moveFile: ${src} -> ${dest}`);

    // A temp binary is just tagged with its new filename
    const temp = tempBinaries.get(src);
    if (temp) {
      tempBinaries.delete(src);
      tempBinaries.set(dest, temp);

      self.postMessage({ type: 'fileSystemChanged' });
      return;
    }

    if (!(await handlers.pathExists(src))) {
      return false;
    }

    // Choose a free name first, so a move cannot overwrite anything
    const { name, parentPath } = getPartsFromPath(dest);
    const fullPath = (n) => (parentPath ? `${parentPath}/${n}` : n);
    let destName = name;
    while (await handlers.pathExists(fullPath(destName))) {
      destName = incrementString(destName);
    }
    const destPath = fullPath(destName);

    try {
      const srcHandle = await getFileHandleByPath(src);
      const destFolder = await getFolderHandleByPath(parentPath, { create: true });

      // Use FS API or do it manually with copy and delete
      if (!srcHandle || !(await nativeMove(srcHandle, destFolder, destName))) {
        await handlers.createFile(destPath, await handlers.readFile(src), false);
        await handlers.deleteFile(src, false);
      }
    } catch (err) {
      // The file was moved by something else between the check and here
      if (err.name !== 'NotFoundError') throw err;
      return false;
    }

    self.postMessage({
      type: 'fileMoved',
      data: {
        oldPath: src,
        file: {
          path: destPath,
        },
      },
    });
  },

  /**
   * Update a folder in the virtual filesystem.
   *
   * Everything inside is moved, hidden entries included.
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
    const { name, parentPath } = getPartsFromPath(dstPath);
    const dstParentHandle = await getFolderHandleByPath(parentPath, {
      create: true,
    });

    // Choose a free name first, so a move cannot overwrite anything
    let dstName = name;
    while (await nameExistsInFolder(dstParentHandle, dstName)) {
      dstName = incrementString(dstName);
    }
    dstPath = parentPath ? `${parentPath}/${dstName}` : dstName;

    // Folder handles have no `move` in some browsers, so the contents are
    // moved one entry at a time. Create the destination folder before moving
    // contents.
    await handlers.createFolder(dstPath);
    const dstHandle = await getFolderHandleByPath(dstPath);

    // Move all files inside the folder to the new destination path. Ignored
    // files go first, so a listener reacting to a visible file's move already
    // finds its ignored siblings in their new place.
    const files = await findFilesInFolder(srcPath, { include: 'all' });
    files.sort((a, b) => Number(isIgnored(b.name)) - Number(isIgnored(a.name)));

    for (const file of files) {
      if (isUntracked(file.name)) {
        await relocateEntry(file, dstHandle);
        continue;
      }

      const filePath = `${srcPath}/${file.name}`;
      const newFilePath = dstPath ? `${dstPath}/${file.name}` : file.name;
      await handlers.moveFile(filePath, newFilePath);
    }

    // Recurse on folders inside the folder
    const folders = await findFoldersInFolder(srcPath, { include: 'all' });
    for (const folder of folders) {
      if (isUntracked(folder.name)) {
        await relocateEntry(folder, dstHandle);
        continue;
      }

      const subFolderPath = `${srcPath}/${folder.name}`;
      const newFolderPath = dstPath ? `${dstPath}/${folder.name}` : folder.name;
      await handlers.moveFolder(subFolderPath, newFolderPath);
    }

    // Delete source folder recursively
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
          title: folder.name,
          folder: true,
          children: subtree,
        };
      }),
    );

    const files = (await findFilesInFolder(path))
      .map((file) => ({ title: file.name, folder: false }))
      .concat(
        tempBinariesInFolder(path).map((name) => ({
          title: name,
          folder: false,
          temporary: true,
        }))
      );

    // Sort the tree so it can be compared in watchRootFolder.
    folders.sort((a, b) => a.title.localeCompare(b.title));
    files.sort((a, b) => a.title.localeCompare(b.title));

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
    return handles.map((handle) => handle.name).concat(tempBinariesInFolder(path));
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
   * @returns {Promise<boolean>} True if the path exists, false otherwise.
   */
  async pathExists(path) {
    if (tempBinaries.has(path)) return true;

    // First parts of the path are directories, the last
    // is the name of what we need to find (be it a file
    // or directory name).
    const pathParts = path.split('/');
    const lastPart = pathParts.pop();

    let currentHandle = await getRootFolderHandle();

    if (!(pathParts.length == 1 && pathParts[0] === '')) {
      // Check if the parent folders exist.
      for (const part of pathParts) {
        try {
          currentHandle = await currentHandle.getDirectoryHandle(part, {
            create: false,
          });
        } catch {
          // If the handle does not exist, return false.
          return false;
        }
      }
    }

    return nameExistsInFolder(currentHandle, lastPart);
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

/**
 * Every compiled binary inside a folder, at any depth.
 *
 * @param {string} folderpath - The absolute folder path ('' for the root).
 * @returns {string[]} Absolute file paths.
 */
function tempBinariesUnder(folderpath) {
  const prefix = folderpath ? `${folderpath}/` : '';
  return [...tempBinaries.keys()].filter((path) => path.startsWith(prefix));
}

/**
 * The compiled binaries directly inside a folder, excluding deeper ones.
 *
 * @param {string} folderpath - The absolute folder path ('' for the root).
 * @returns {string[]} File names, without their path.
 */
function tempBinariesInFolder(folderpath) {
  const prefix = folderpath ? `${folderpath}/` : '';
  return tempBinariesUnder(folderpath)
    .map((path) => path.slice(prefix.length))
    .filter((name) => !name.includes('/'));
}

function incrementString(str) {
  const parts = str.split('.');
  const ext = parts.length > 1 ? `.${parts.pop()}` : '';
  let name = parts.join('.');

  const match = /\((\d+)\)$/.exec(name);
  if (match) {
    const num = parseInt(match[1]) + 1;
    return name.replace(/\((\d+)\)$/, `(${num})`);
  }
  return `${name} (1)${ext}`;
}

function isOPFS() {
  return _vfsRoot == null;
}

/**
 * Returns the connected root folder. If the root is in the OPFS, it
 * checks whether a base directory was set and uses that.
 *
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
async function getRootFolderHandle() {
  const baseHandle = _vfsRoot || (await navigator.storage.getDirectory());
  if (baseHandle != _vfsRoot && _vfsBaseFolder !== '') {
    return baseHandle.getDirectoryHandle(_vfsBaseFolder, { create: true });
  } else {
    return baseHandle;
  }
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
 * @param {object} [options]
 * @param {boolean} [options.create=false] - Create missing folders along the
 * way, instead of returning null.
 * @returns {Promise<FileSystemDirectoryHandle|null>} The folder handle, or null
 * if it does not exist and `create` is false.
 */
async function getFolderHandleByPath(folderpath = '', { create = false } = {}) {
  const rootHandle = await getRootFolderHandle();
  if (!folderpath) return rootHandle;

  let handle = rootHandle;
  const parts = folderpath.split('/');

  // Walk path segments
  while (handle && parts.length > 0) {
    try {
      handle = await handle.getDirectoryHandle(parts.shift(), { create });
    } catch {
      return null;
    }
  }

  return handle;
}

/**
 * List a folder's entries. A folder that is removed while it is being read
 * lists as empty.
 *
 * @param {FileSystemDirectoryHandle} folderHandle - The folder to read.
 * @returns {Promise<Array<[string, FileSystemHandle]>>} Name/handle pairs.
 */
async function readEntries(folderHandle) {
  const entries = [];

  try {
    for await (const entry of folderHandle.entries()) {
      entries.push(entry);
    }
  } catch (err) {
    if (err.name !== 'NotFoundError') throw err;
    return [];
  }

  return entries;
}

/**
 * Recursively walk every file under a folder, calling `visit` for each one.
 *
 * Skipped names and hide-pattern matches are left out. A matching folder is
 * skipped without being entered, so its subtree is never touched.
 *
 * @param {string} path - The folder to walk. Empty for the project root.
 * @param {function} visit - Called as `visit(filepath, fileHandle)`, awaited.
 * @returns {Promise<void>}
 */
async function walkFiles(path, visit) {
  const root = await getFolderHandleByPath(path);
  if (!root) return;

  async function walk(folderHandle, currentPath = '') {
    for (const [name, handle] of await readEntries(folderHandle)) {
      if (isIgnored(name)) continue;
      const filepath = currentPath ? `${currentPath}/${name}` : name;

      if (handle.kind === 'file') {
        await visit(filepath, handle);
      } else if (handle.kind === 'directory') {
        await walk(handle, filepath);
      }
    }
  }

  await walk(root);
}

/**
 * Get a file handle by its absolute path.
 *
 * The example below returns the handle for `myfile.txt`.
 * @example getFileHandleByPath('folder1/folder2/myfile.txt')
 *
 * @param {string} filepath - The absolute file path.
 * @param {object} [options]
 * @param {boolean} [options.create=false] - Create the file (and any missing
 * parent folders) if it does not exist, instead of returning null.
 * @returns {Promise<FileSystemFileHandle|null>} The file handle, or null if it
 * does not exist and `create` is false.
 */
async function getFileHandleByPath(filepath, { create = false } = {}) {
  if (!(await handlers.pathExists(filepath)) && !create) {
    return null;
  }

  const { name, parentPath } = getPartsFromPath(filepath);

  const parentFolderHandle = await getFolderHandleByPath(parentPath, { create });
  if (!parentFolderHandle) return null;

  const fileHandle = await parentFolderHandle.getFileHandle(name, { create });

  return fileHandle;
}

/**
 * Get all folder handles inside a given folder path (NOT recursive).
 *
 * @param {string} folderpath - The absolute folder path to search in.
 * @param {object} [options]
 * @param {string} [options.include=listed] - Which entries to return, see
 * `excluded`.
 * @returns {Promise<FileSystemDirectoryHandle[]>} Array of folder handles.
 */
async function findFoldersInFolder(folderpath, { include = 'listed' } = {}) {
  // Obtain the folder handle recursively
  const folderHandle = await getFolderHandleByPath(folderpath);
  if (!folderHandle) return [];

  // Gather all subfolder handles
  const subfolders = [];
  for (const [, handle] of await readEntries(folderHandle)) {
    if (handle.kind !== 'directory') continue;
    if (excluded(handle.name, include)) continue;
    subfolders.push(handle);
  }

  return subfolders;
}

/**
 * Get all file handles inside a given path (NOT recursive).
 *
 * @param {string} folderpath - The absolute folder path to search in.
 * @param {object} [options]
 * @param {string} [options.include=listed] - Which entries to return, see
 * `excluded`.
 * @returns {Promise<FileSystemFileHandle[]>} Array of file handles.
 */
async function findFilesInFolder(folderpath, { include = 'listed' } = {}) {
  // Obtain the folder handle recursively
  const folderHandle = await getFolderHandleByPath(folderpath);
  if (!folderHandle) return [];

  // Gather all subfile handles
  const subfiles = [];
  for (const [, handle] of await readEntries(folderHandle)) {
    if (handle.kind !== 'file') continue;
    if (excluded(handle.name, include)) continue;
    subfiles.push(handle);
  }

  return subfiles;
}

/**
 * Handle kinds ("file", "directory") whose move the browser does not implement.
 *
 * @type {Set<string>}
 */
const unmovableKinds = new Set();

/** Errors that mean the browser does not implement the move at all. */
const UNSUPPORTED_ERRORS = ['NotSupportedError', 'TypeError'];

/**
 * Move an entry with the browser's move operation, which is not offered for
 * every kind of handle. Returns false when unavailable, so we can copy instead.
 *
 * @param {FileSystemHandle} handle - The entry to move.
 * @param {FileSystemDirectoryHandle} destFolder - Its new parent.
 * @param {string} name - The name to give it there.
 * @returns {Promise<boolean>} False when the move is unavailable.
 */
async function nativeMove(handle, destFolder, name) {
  if (unmovableKinds.has(handle.kind)) return false;

  if (typeof handle.move !== 'function') {
    unmovableKinds.add(handle.kind);
    return false;
  }

  try {
    await handle.move(destFolder, name);
    return true;
  } catch (err) {
    // Only a refusal of the operation itself rules out the whole kind; other
    // failures say nothing about the next entry.
    if (UNSUPPORTED_ERRORS.includes(err.name)) {
      unmovableKinds.add(handle.kind);
    }

    console.log(`nativeMove failed for ${handle.name}:`, err.name);
    return false;
  }
}

/**
 * Copy a file or a whole folder into another folder.
 *
 * @param {FileSystemHandle} handle - The entry to copy.
 * @param {FileSystemDirectoryHandle} destFolder - Where the copy goes.
 * @returns {Promise<void>}
 */
async function copyEntry(handle, destFolder) {
  if (handle.kind === 'file') {
    const file = await handle.getFile();
    const dest = await destFolder.getFileHandle(handle.name, { create: true });
    return writeFile(dest, await file.arrayBuffer());
  }

  const destSub = await destFolder.getDirectoryHandle(handle.name, {
    create: true,
  });
  for (const [, child] of await readEntries(handle)) {
    await copyEntry(child, destSub);
  }
}

/**
 * Move an entry that the app never sees into another folder, without emitting
 * events. Falls back to a copy when the browser cannot move it directly.
 *
 * @param {FileSystemHandle} handle - The entry to move.
 * @param {FileSystemDirectoryHandle} destFolder - Where it should end up.
 * @returns {Promise<void>}
 */
async function relocateEntry(handle, destFolder) {
  if (await nativeMove(handle, destFolder, handle.name)) return;
  await copyEntry(handle, destFolder);
}

/**
 * Writes data to a file.
 *
 * @param {FileSystemFileHandle} handle - The handle of the file to write.
 * @param {string|ArrayBuffer} content - The content to write.
 * @returns {Promise<void>} Resolves when the file is successfully written.
 */
async function writeFile(handle, content) {
  const data = content instanceof ArrayBuffer
    ? new Uint8Array(content)
    : new TextEncoder().encode(content);

  if (isOPFS()) {
    // Use Safari-compatible API.
    const accessHandle = await handle.createSyncAccessHandle();
    accessHandle.truncate(data.byteLength);
    accessHandle.write(data, { at: 0 });
    accessHandle.flush();
    accessHandle.close();
  } else {
    // Use general FS API.
    const writable = await handle.createWritable();
    await writable.write({ type: "write", data });
    await writable.close();
  }
}

/**
 * Checks if file or folder with a specified nodeName
 * exists in the specified folder.
 *
 * @param {FileSystemDirectoryHandle} parentFolderHandle
 * @param {string} nodeName
 * @returns {Promise<boolean>}
 */
async function nameExistsInFolder(parentFolderHandle, nodeName) {
  const entries = await readEntries(parentFolderHandle);
  return entries.some(([name]) => name === nodeName);
}
