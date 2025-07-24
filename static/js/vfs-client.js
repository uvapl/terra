/**
 * VFS API for the main thread
 * delegates most of its work to a VFS worker module
 */
export default class VirtualFileSystem {
  constructor(worker) {
    this.worker = new Worker("static/js/workers/vfs.worker.js", {
      type: "module",
    });

    this.pending = new Map(); // id → { resolve, reject }
    this._nextId = 1;
    this.eventListeners = new Map();

    this.worker.addEventListener("message", (e) => this._handleMessage(e.data));
  }

  _handleMessage({ id, type, data, error }) {
    if (id) {
      if (!this.pending.has(id)) return;
      const { resolve, reject } = this.pending.get(id);
      this.pending.delete(id);
      error ? reject(new Error(error)) : resolve(data);
    } else {
      // Broadcast-style event from worker
      const handler = this.eventListeners.get(type);
      if (handler) handler(data);
    }
  }

  _send(type, data) {
    const id = `vfs-${this._nextId++}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, data });
    });
  }

  setRootHandle(handle) {
    this.worker.postMessage({
      type: "setRootHandle",
      data: { handle },
    });
  }

  clear = () => this._send("clear");

  readFile = (path) => this._send("readFile", { path });

  writeFile = (path, content) => this._send("writeFile", { path, content });

  createFile = (path, content = "") =>
    this._send("createFile", { path, content });

  deleteFile = (path) => this._send("deleteFile", { path });

  listDirectory = (path = "") => this._send("listDirectory", { path });

  findFoldersInFolder = (path = "") => this._send("findFoldersInFolder", path);

  findFilesInFolder = (path = "") => this._send("findFilesInFolder", path);

  getAllFiles = () => this._send("getAllFiles");

  createFolder = (path) => this._send("createFolder", { path });

  deleteFolder = (path) => this._send("deleteFolder", { path });

  moveFile = (src, dest) => this._send("moveFile", { src, dest });

  moveFolder = (src, dest) => this._send("moveFolder", { src, dest });

  getFileTree = (path = "") => this._send("getFileTree", { path });

  onEvent = (eventName, handler) => {
    this.eventListeners.set(eventName, handler);
  };

  // // Optional: subscribe to fs events like `fs:changed`
  // onEvent(callback) {
  //   this.worker.addEventListener("message", (e) => {
  //     const { id, type, data } = e.data;
  //     if (!id && type.startsWith("fs:")) {
  //       callback(type, data);
  //     }
  //   });
  // }

  /**
   * Download a file through the browser by creating a new blob and using
   * FileSaver.js to save it.
   *
   * @param {string} path - The absolute file path.
   */
  downloadFile = async (path) => {
    const content = await this.readFile(path);
    const { name } = this.getPartsFromPath(path);
    const fileBlob = new Blob([content], { type: "text/plain;charset=utf-8" });
    saveAs(fileBlob, name);
  };

  /**
   * Get the name and parent path from a given filepath (either file or folder).
   *
   * @param {string} path - The absolute path.
   * @returns {object} An object containing the name and parent path.
   */
  getPartsFromPath = (path) => {
    const parts = path.split("/");
    const name = parts.pop();
    const parentPath = parts.join("/");
    return { name, parentPath };
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
