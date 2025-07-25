import { getPartsFromPath } from './helpers/shared.js';

/**
 * VFS API for the main thread
 * delegates most of its work to a VFS worker module
 *
 * By default it will operate, through the worker, on the
 * origin private file system provided by the browser.
 */
export default class VirtualFileSystem {
  constructor() {
    this.worker = new Worker("static/js/workers/vfs.worker.js", {
      type: "module",
    });

    // for tracking responses from the worker
    this.pending = new Map(); // id → { resolve, reject }
    this._nextId = 1;

    // for handlers of general events like "fs changed"
    this.eventListeners = new Map();

    // connect us to the worker
    this.worker.addEventListener("message", (e) => this._handleMessage(e.data));
  }

  /**
   * Allows registering a VFS event handler
   *
   * @param {*} eventName
   * @param {*} handler
   */
  onEvent = (eventName, handler) => {
    this.eventListeners.set(eventName, handler);
  };

  /**
   * Process a response or message from the vfs worker
   *
   * @param {*} param0
   * @returns
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
      const handler = this.eventListeners.get(type);
      if (handler) handler(data);
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

  setRootHandle = (handle) => this._send("setRootHandle", { handle });

  clear = () => this._send("clear");

  readFile = (path) => this._send("readFile", { path });

  writeFile = (path, content) => this._send("writeFile", { path, content });

  createFile = (path, content = "") =>
    this._send("createFile", { path, content });

  deleteFile = (path) => this._send("deleteFile", { path });

  findFoldersInFolder = (path = "") => this._send("findFoldersInFolder", path);

  findFilesInFolder = (path = "") => this._send("findFilesInFolder", path);

  getAllFiles = () => this._send("getAllFiles");

  createFolder = (path) => this._send("createFolder", { path });

  deleteFolder = (path) => this._send("deleteFolder", { path });

  moveFile = (src, dest) => this._send("moveFile", { src, dest });

  moveFolder = (src, dest) => this._send("moveFolder", { src, dest });

  getFileTree = (path = "") => this._send("getFileTree", { path });

  /**
   * Download a file through the browser by creating a new blob and using
   * FileSaver.js to save it.
   *
   * @param {string} path - The absolute file path.
   */
  downloadFile = async (path) => {
    const content = await this.readFile(path);
    const { name } = getPartsFromPath(path);
    const fileBlob = new Blob([content], { type: "text/plain;charset=utf-8" });
    saveAs(fileBlob, name);
  };

  // TODO ZIP file generation and downloadFolder
}

export class FileTooLargeError extends Error {
  constructor(path, size, max) {
    super(`File "${path}" is too large: ${size} > ${max}`);
    this.name = "FileTooLargeError";
    this.path = path;
    this.size = size;
    this.max = max;
  }
}

export class FileNotFoundError extends Error {
  constructor(path) {
    super(`File not found: ${path}`);
    this.name = "FileNotFoundError";
    this.path = path;
  }
}
