import { getPartsFromPath } from '../lib/helpers.js';

/**
 * VFS interface for the main thread. It delegates to the VFS worker module.
 */
export default class VirtualFileSystem extends EventTarget {
  constructor() {
    super();

    this.worker = new Worker('static/js/fs/vfs.worker.js', {
      type: 'module',
    });

    // For tracking responses from the worker.
    this.pending = new Map(); // id → { resolve, reject }
    this._nextId = 1;

    /** Files to hide from common listings @type RegExp[] */
    this._hidePatterns = [];

    // Connect us to the worker.
    this.worker.addEventListener('message', (e) => this._handleMessage(e.data));
  }

  /**
   * Handles a message received from the VFS (virtual file system) worker.
   *
   * If the message includes an `id`, it is treated as a response to a
   * previously issued request. The corresponding Promise in `this.pending`
   * is resolved with the `data` or rejected with the `error`.
   *
   * If the message does not include an `id`, it is treated as an event
   * originating from the worker (such as a filesystem change notification),
   * and the registered event handler for the given `type` is called with `data`.
   *
   * @param {Object} message - The message object sent from the worker.
   * @param {number|string} [message.id] - The ID correlating the message with a pending request (if any).
   * @param {string} [message.type] - The type of event or response being sent.
   * @param {*} [message.data] - The payload data of the message.
   * @param {string} [message.error] - Error message if the worker encountered a problem.
   */
  _handleMessage({ id, type, data, error }) {
    if (id) {
      // This handles a numbered response to an earlier request.
      if (!this.pending.has(id)) return;
      const { resolve, reject } = this.pending.get(id);
      this.pending.delete(id);

      if (error) {
        reject(_makeError(error));
      } else {
        resolve(data);
      }
    } else {
      // This handles an event originating in the worker (e.g. FS changes).
      this.dispatchEvent(new CustomEvent(type, { detail: data }));
    }
  }

  /**
   * Send a message to the vfs worker, automatically numbered to match
   * the incoming response in _handleMessage.
   *
   * A function is called in the worker upon receipt of the message.
   *
   * @param {string} name
   * @param {array} params
   */
  _send(name, params = []) {
    const id = `vfs-${this._nextId++}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const transfer = params.filter((p) => p instanceof ArrayBuffer);
      this.worker.postMessage({ id, type: name, data: params }, transfer);
    });
  }

  /* Pass-through to worker */

  connect = (handle, baseFolder = '') =>
    this._send('connect', [handle, baseFolder]);

  setBaseFolder = (baseFolder) => this._send('setBaseFolder', [baseFolder]);

  /**
   * Register a hide-pattern. Matching files/folders stay in the VFS but are
   * filtered out of listings (file tree, downloads, shell, run sandbox).
   * They can still be pulled via `getAllFiles(path, { includeHidden: true })`.
   *
   * @param {string} source - A RegExp source matched against a single path
   * segment, e.g. `^\\..+\\.history$`.
   */
  registerHidePattern = (source) => {
    const re = new RegExp(source);
    if (!this._hidePatterns.some((existing) => existing.source === re.source)) {
      this._hidePatterns.push(re);
      // The worker prunes its recursive walks with these, so hidden files are
      // never read. Fire-and-forget: message order guarantees later walks see it.
      this._send('setHidePatterns', [this._hidePatterns.map((p) => p.source)]);
    }
  };

  /**
   * Whether a single path segment matches a registered hide pattern.
   *
   * @param {string} name - A file or folder name.
   * @returns {boolean}
   */
  _isHidden = (name) => this._hidePatterns.some((re) => re.test(name));

  clear = () => this._send('clear');

  readFile = (path, maxSize = null) => this._send('readFile', [path, maxSize]);

  getFileURL = (path) => this._send('getFileURL', [path]);

  updateFile = (path, content, isUserInvoked = true, immediate = false) =>
    this._send('updateFile', [path, content, isUserInvoked, immediate]);

  createFile = (path, content = '', isUserInvoked = true) =>
    this._send('createFile', [path, content, isUserInvoked]);

  deleteFile = (path, isUserInvoked = true) =>
    this._send('deleteFile', [path, isUserInvoked]);

  isTempBinary = (path) =>
    this._send('isTempBinary', [path]);

  writeProducedFile = (path, content, temporary = false) =>
    this._send('writeProducedFile', [path, content, temporary]);

  listFoldersInFolder = async (path = '') => {
    const names = await this._send('listFoldersInFolder', [path]);
    return names.filter((name) => !this._isHidden(name));
  };

  listFilesInFolder = async (path = '') => {
    const names = await this._send('listFilesInFolder', [path]);
    return names.filter((name) => !this._isHidden(name));
  };

  getAllFiles = (path = '', { includeHidden = false } = {}) =>
    this._send('getAllFiles', [path, includeHidden]);

  /**
   * List every file without reading content. Prefer this over `getAllFiles`
   * when only paths or sizes are needed, since it does not touch file bytes.
   *
   * @param {string} [path] - Folder to list. Empty for the project root.
   * @param {object} [options]
   * @param {boolean} [options.includeHidden] - Include hide-pattern matches.
   * @returns {Promise<object[]>} Objects of `{ path, size, mtime }`.
   */
  getFileList = (path = '', { includeHidden = false } = {}) =>
    this._send('getFileList', [path, includeHidden]);

  pathExists = (path) => this._send('pathExists', [path]);

  isEmpty = () => this._send('isEmpty');

  createFolder = (path, isUserInvoked = true) =>
    this._send('createFolder', [path, isUserInvoked]);

  deleteFolder = (path) => this._send('deleteFolder', [path]);

  moveFile = (src, dst) => this._send('moveFile', [src, dst]);

  moveFolder = (src, dst) => this._send('moveFolder', [src, dst]);

  getFileTree = async (path = '') => {
    // Recursively drop hidden nodes from the `getFileTree` result.
    const pruneTree = (nodes) =>
      nodes
        .filter((node) => !this._isHidden(node.title))
        .map((node) =>
          node.children ? { ...node, children: pruneTree(node.children) } : node
        );

    const tree = await this._send('getFileTree', [path]);
    return pruneTree(tree);
  };

  /**
   * List all folders in the VFS recursively, in depth-first order.
   *
   * @async
   * @param {string} [parentPath] - The absolute parent folder path where
   * subfolders will be fetched from.
   * @param {number} [depth] - The current nesting depth.
   * @returns {Promise<object[]>} List of `{ path, depth }` folder objects.
   */
  getFolderList = async (parentPath = '', depth = 0) => {
    const folders = [];

    const subfolders = await this.listFoldersInFolder(parentPath);
    for (const folderName of subfolders) {
      const subfolderpath = parentPath ? `${parentPath}/${folderName}` : folderName;
      folders.push({ path: subfolderpath, depth });
      folders.push(...(await this.getFolderList(subfolderpath, depth + 1)));
    }

    return folders;
  };

  /**
   * Download a file through the browser by creating a new blob and using
   * FileSaver.js to save it.
   *
   * @param {string} path - The absolute file path.
   */
  downloadFile = async (path) => {
    const content = await this.readFile(path);
    const { name } = getPartsFromPath(path);
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    saveAs(blob, name);
  };

  /**
   * Download a folder as a zip file. This includes all files in the folder as
   * well as all the nested folders.
   *
   * @param {string} path - The absolute folder path.
   */
  downloadFolder = async (path) => {
    const { name } = getPartsFromPath(path);

    const zip = new JSZip();
    const rootFolderZip = zip.folder(name);

    // Walk the file list and read one file at a time, rather than pulling the
    // whole folder's content into an array first: that held every file twice,
    // once in the array and once in the zip. JSZip still keeps what it is given
    // until it generates, so this is not fully streamed — bounding that too
    // would mean a streaming zip writer.
    // Note that empty directories will not be zipped.
    // Listed paths are relative to the folder being downloaded, which is what
    // the zip entries want; reading needs the full path.
    const files = await this.getFileList(path);
    for (const file of files) {
      const fullPath = path ? `${path}/${file.path}` : file.path;
      rootFolderZip.file(file.path, await this.readFile(fullPath));
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    saveAs(blob, `${name}.zip`);
  };
}

export class FileTooLargeError extends Error {}
export class FileNotFoundError extends Error {}
export class FileExistsError extends Error {}

const _errorTypes = [
  {
    pattern: /^FileTooLarge$/,
    ErrorClass: FileTooLargeError,
  },
  {
    pattern: /^FileNotFound$/,
    ErrorClass: FileNotFoundError,
  },
  {
    pattern: /^FileExists$/,
    ErrorClass: FileExistsError,
  },
];

/**
 * Creates an error of the class specified in a string, or if the class is
 * unknown, a generic Error instance.
 *
 * @param {string} errorName
 * @returns {Error}
 */
function _makeError(errorName) {
  for (const { pattern, ErrorClass, args } of _errorTypes) {
    const m = pattern.exec(errorName);
    if (m) return new ErrorClass();
  }
  return new Error(errorName);
}
