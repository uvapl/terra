/**
 * Synchronous file reads between a language worker and the main thread.
 *
 * A language worker reads source files from synchronous callback. A WASI
 * `path_open` cannot await anything. The VFS lives on another thread, and
 * a worker blocked in `Atomics.wait` cannot process its own message queue,
 * so the reply cannot come back over postMessage. It has to arrive through
 * shared memory.
 *
 * How it works: the worker posts a notification, then blocks on the STATE
 * word. The main thread reads the request out of the buffer, resolves the
 * content however it likes, writes a chunk back, and wakes the worker.
 * Files larger than the payload region are fetched one chunk at a time.
 *
 * The worker and the lang-worker-client both import the definitions below.
 */

/** Control words, as Int32 indices into the head of the buffer. */
const STATE = 0;
const STATUS = 1;
const CHUNK_LEN = 2;
const TOTAL_SIZE = 3;
const REQ_OFFSET = 4;
const REQ_MAXLEN = 5;
const PATH_LEN = 6;
const SEQ = 7;

const CONTROL_BYTES = 64;
const PATH_BYTES = 1024;
const PATH_OFFSET = CONTROL_BYTES;
const PAYLOAD_OFFSET = CONTROL_BYTES + PATH_BYTES;

/** STATE values. */
const STATE_IDLE = 0;
const STATE_REQUEST = 1;
const STATE_RESPONSE = 2;

/** STATUS values, reported to the caller of `read()`. */
export const STATUS_OK = 0;
export const STATUS_NOT_FOUND = 1;
export const STATUS_TOO_LARGE = 2;
export const STATUS_INTERNAL = 3;

/** Total channel size. The payload region is everything after the header. */
export const CHANNEL_BYTES = 1024 * 1024;

/**
 * Whether this context can create the shared memory the channel needs. Requires
 * the COOP/COEP headers; see dev-server/serve.rb.
 *
 * @returns {boolean}
 */
export function canUseFileChannel() {
  try {
    new SharedArrayBuffer(8);
    return true;
  } catch {
    return false;
  }
}

/**
 * Views onto one shared buffer. Both ends build this over the same memory.
 *
 * @param {SharedArrayBuffer} buffer
 */
function views(buffer) {
  return {
    ctrl: new Int32Array(buffer, 0, CONTROL_BYTES / 4),
    path: new Uint8Array(buffer, PATH_OFFSET, PATH_BYTES),
    payload: new Uint8Array(buffer, PAYLOAD_OFFSET),
  };
}

/**
 * Worker end of the channel. Blocks the calling thread until the main thread
 * answers, so it must never be used on the main thread.
 */
export class FileChannelClient {
  /**
   * @param {SharedArrayBuffer} buffer - The shared channel buffer.
   * @param {function} notify - Called with no arguments to tell the main thread
   * a request is waiting in the buffer.
   */
  constructor(buffer, notify) {
    Object.assign(this, views(buffer));
    this.notify = notify;
    this.encoder = new TextEncoder();
  }

  /**
   * Read a whole file, blocking until it arrives. Chunks are requested in a
   * loop, so file size is limited by memory rather than by the channel.
   *
   * @param {string} path - The file to read.
   * @returns {{status: number, bytes: ?Uint8Array}} `bytes` is set only when
   * status is STATUS_OK.
   */
  read(path) {
    const pathBytes = this.encoder.encode(path);
    if (pathBytes.length > PATH_BYTES) {
      return { status: STATUS_NOT_FOUND, bytes: null };
    }

    const chunks = [];
    let received = 0;
    let total = 0;

    do {
      this.path.set(pathBytes);
      Atomics.store(this.ctrl, PATH_LEN, pathBytes.length);
      Atomics.store(this.ctrl, REQ_OFFSET, received);
      Atomics.store(this.ctrl, REQ_MAXLEN, this.payload.length);
      Atomics.add(this.ctrl, SEQ, 1);
      Atomics.store(this.ctrl, STATE, STATE_REQUEST);

      this.notify();
      Atomics.wait(this.ctrl, STATE, STATE_REQUEST);

      const status = Atomics.load(this.ctrl, STATUS);
      const length = Atomics.load(this.ctrl, CHUNK_LEN);
      total = Atomics.load(this.ctrl, TOTAL_SIZE);
      Atomics.store(this.ctrl, STATE, STATE_IDLE);

      if (status !== STATUS_OK) return { status, bytes: null };

      chunks.push(this.payload.slice(0, length));
      received += length;

      // A zero-length chunk before the end would loop forever.
      if (length === 0) break;
    } while (received < total);

    if (received !== total) return { status: STATUS_INTERNAL, bytes: null };

    return { status: STATUS_OK, bytes: concat(chunks, total) };
  }
}

/**
 * Main-thread end of the channel. Reads a pending request and answers it.
 */
export class FileChannelServer {
  /**
   * @param {SharedArrayBuffer} buffer - The shared channel buffer.
   */
  constructor(buffer) {
    Object.assign(this, views(buffer));
    this.decoder = new TextDecoder();
  }

  /**
   * The path the worker is currently asking for.
   *
   * @returns {string}
   */
  requestedPath() {
    const length = Atomics.load(this.ctrl, PATH_LEN);
    // slice, not subarray: TextDecoder rejects views on shared memory.
    return this.decoder.decode(this.path.slice(0, length));
  }

  /**
   * Answer the pending request with a slice of `bytes` and wake the worker.
   *
   * @param {Uint8Array} bytes - The file's full content.
   */
  respond(bytes) {
    const offset = Atomics.load(this.ctrl, REQ_OFFSET);
    const maxLen = Atomics.load(this.ctrl, REQ_MAXLEN);
    const length = Math.min(maxLen, Math.max(0, bytes.length - offset));

    this.payload.set(bytes.subarray(offset, offset + length));
    Atomics.store(this.ctrl, CHUNK_LEN, length);
    Atomics.store(this.ctrl, TOTAL_SIZE, bytes.length);
    this._finish(STATUS_OK);
  }

  /**
   * Answer the pending request with a failure and wake the worker.
   *
   * @param {number} status - One of the STATUS_* values.
   */
  respondError(status) {
    Atomics.store(this.ctrl, CHUNK_LEN, 0);
    Atomics.store(this.ctrl, TOTAL_SIZE, 0);
    this._finish(status);
  }

  _finish(status) {
    Atomics.store(this.ctrl, STATUS, status);
    Atomics.store(this.ctrl, STATE, STATE_RESPONSE);
    Atomics.notify(this.ctrl, STATE);
  }
}

/**
 * Join chunks into one buffer of a known total length.
 *
 * @param {Uint8Array[]} chunks
 * @param {number} total
 * @returns {Uint8Array}
 */
function concat(chunks, total) {
  if (chunks.length === 1) return chunks[0];

  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
