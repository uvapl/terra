import { getPartsFromPath } from '../lib/helpers.js';
import { IGNORED_PATHS } from '../constants.js';
import { createModal } from '../ui/components/modal.js';

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

    /**
     * Rules for what stays out of file listings. When `tracked: false` the
     * file is fully ignored. @type object[] */
    this._ignoreRules = [...IGNORED_PATHS];

    // Connect us to the worker
    this.worker.addEventListener('message', (e) => this._handleMessage(e.data));

    // Sent to the worker before any other message
    this._send('setIgnoreRules', [this._ignoreRules]);
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
   * Register a rule for entries that stay in the VFS but are filtered out of
   * listings (file tree, downloads, shell, run sandbox).
   *
   * @param {object} rule - Matches one path segment by `name`, `suffix` or
   * `pattern` (a RegExp source, e.g. `^\\..+\\.history$`).
   * @param {boolean} [rule.tracked=true] - Whether the file is Terra's own, so
   * its content is still read and its moves and deletions still raise events.
   */
  registerIgnoreRule = (rule) => {
    const key = JSON.stringify(rule);
    if (this._ignoreRules.some((existing) => JSON.stringify(existing) === key)) {
      return;
    }

    this._ignoreRules.push(rule);

    // Update the worker
    this._send('setIgnoreRules', [this._ignoreRules]);
  };

  clear = () => this._send('clear');

  readFile = (path, maxSize = null) => this._send('readFile', [path, maxSize]);

  getFileURL = (path) => this._send('getFileURL', [path]);

  updateFile = (path, content, isUserInvoked = true) =>
    this._send('updateFile', [path, content, isUserInvoked]);

  createFile = (path, content = '', isUserInvoked = true) =>
    _withCollisionAlert(this._send('createFile', [path, content, isUserInvoked]), path);

  deleteFile = (path, isUserInvoked = true) =>
    this._send('deleteFile', [path, isUserInvoked]);

  isTempBinary = (path) =>
    this._send('isTempBinary', [path]);

  writeProducedFile = (path, content, temporary = false) =>
    this._send('writeProducedFile', [path, content, temporary]);

  listFoldersInFolder = (path = '') =>
    this._send('listFoldersInFolder', [path]);

  listFilesInFolder = (path = '') => this._send('listFilesInFolder', [path]);

  /**
   * Get all files with contents.
   *
   * @param {string} [path] - Base folder.
   * @returns {Promise<object[]>} Objects of `{ path, content }`.
   */
  getAllFiles = (path = '') => this._send('getAllFiles', [path]);

  /**
   * List every file without reading content.
   *
   * @param {string} [path] - Folder to list. Empty for the project root.
   * @returns {Promise<object[]>} Objects of `{ path, size, mtime }`.
   */
  getFileList = (path = '') => this._send('getFileList', [path]);

  pathExists = (path) => this._send('pathExists', [path]);

  isEmpty = () => this._send('isEmpty');

  createFolder = (path, isUserInvoked = true) =>
    _withCollisionAlert(this._send('createFolder', [path, isUserInvoked]), path);

  deleteFolder = (path) => this._send('deleteFolder', [path]);

  moveFile = (src, dst) => _withCollisionAlert(this._send('moveFile', [src, dst]), dst);

  /**
   * Move a folder and everything in it. Normally ignored files are
   * moved, too.
   *
   * @param {string} src - The folder to move.
   * @param {string} dst - Where it should end up.
   * @returns {Promise<void>}
   */
  moveFolder = (src, dst) => _withCollisionAlert(this._send('moveFolder', [src, dst]), dst);

  getFileTree = (path = '') => this._send('getFileTree', [path]);

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

/**
 * Catch a failed file operation to show an alert.
 *
 * @param {Promise} promise - The pending `_send` call.
 * @param {string} path - The path that was already taken, for the message.
 * @returns {Promise<*>} Whatever `promise` resolves to, or null on collision.
 */
async function _withCollisionAlert(promise, path) {
  try {
    return await promise;
  } catch (err) {
    if (!(err instanceof FileExistsError)) throw err;
    createModal({
      title: 'Name already exists',
      body: `<p>A file or folder named <strong>${path}</strong> already exists.</p>`,
      confirmLabel: 'OK',
    });
    return null;
  }
}
