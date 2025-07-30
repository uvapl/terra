import { getPartsFromPath } from './helpers/shared.js';

/**
 * VFS interface for the main thread ---
 * delegates most of its work to a VFS worker module.
 *
 * By default it will operate, through the worker, on the
 * origin private file system provided by the browser.
 */
export default class VirtualFileSystem extends EventTarget {
  constructor() {
    super();

    this.worker = new Worker('static/js/workers/vfs.worker.js', {
      type: 'module',
    });

    // for tracking responses from the worker
    this.pending = new Map(); // id → { resolve, reject }
    this._nextId = 1;

    // connect us to the worker
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
   *
   * @returns {void}
   */
  _handleMessage({ id, type, data, error }) {
    if (id) {
      // this is a numbered response to an earlier request
      if (!this.pending.has(id)) return;
      const { resolve, reject } = this.pending.get(id);
      this.pending.delete(id);
      error ? reject(new Error(error)) : resolve(data);
    } else {
      // this is an event originating in the worker (e.g. FS changes)
      this.dispatchEvent(new CustomEvent(type, { detail: data }));
    }
  }

  /**
   * Send a message to the vfs worker
   * automatically numbered to match in _handleMessage
   *
   * @param {*} type
   * @param {*} data
   */
  _send(type, data) {
    const id = `vfs-${this._nextId++}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, data });
    });
  }

  /* Pass-through to worker */

  setRootHandle = (handle) => this._send('setRootHandle', [handle]);

  clear = () => this._send('clear');

  readFile = (path, maxSize = null) => this._send('readFile', [path, maxSize]);

  updateFile = (path, content, isUserInvoked = true) =>
    this._send('updateFile', [path, content, isUserInvoked]);

  createFile = (path, content = '', isUserInvoked = true) =>
    this._send('createFile', [path, content, isUserInvoked]);

  deleteFile = (path, isUserInvoked = true) =>
    this._send('deleteFile', [path, isUserInvoked]);

  listFoldersInFolder = (path = '') =>
    this._send('listFoldersInFolder', [path]);

  listFilesInFolder = (path = '') => this._send('listFilesInFolder', [path]);

  getAllFiles = () => this._send('getAllFiles');

  pathExists = (path, parentFolder = null) =>
    this._send('pathExists', [path, parentFolder]);

  isEmpty = () => this._send('isEmpty');

  createFolder = (path, isUserInvoked = true) =>
    this._send('createFolder', [path, isUserInvoked]);

  deleteFolder = (path) => this._send('deleteFolder', [path]);

  moveFile = (src, dst) => this._send('moveFile', [src, dst]);

  moveFolder = (src, dst) => this._send('moveFolder', [src, dst]);

  getFileTree = (path = '') => this._send('getFileTree', [path]);

  /**
   * Download a file through the browser by creating a new blob and using
   * FileSaver.js to save it.
   *
   * @param {string} path - The absolute file path.
   */
  downloadFile = async (path) => {
    const content = await this.readFile(path);
    const { name } = getPartsFromPath(path);
    const fileBlob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    saveAs(fileBlob, name);
  };

  // TODO ZIP file generation and downloadFolder
}

export class FileTooLargeError extends Error {
  constructor(path, size, max) {
    super(`File "${path}" is too large: ${size} > ${max}`);
    this.name = 'FileTooLargeError';
    this.path = path;
    this.size = size;
    this.max = max;
  }
}

export class FileNotFoundError extends Error {
  constructor(path) {
    super(`File not found: ${path}`);
    this.name = 'FileNotFoundError';
    this.path = path;
  }
}
