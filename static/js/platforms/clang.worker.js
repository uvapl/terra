// This file includes code adapted from wasm-clang (https://github.com/binji/wasm-clang)
// Licensed under the Apache License 2.0. See LICENSE.wasm-clang for details.
//
// MEMFS WORKAROUNDS — read this before upgrading the wasm assets.
//
// `static/wasm/c_cpp/{memfs,clang,lld,sysroot.tar}` are prebuilt binaries
// vendored from wasm-clang in 2024 and never rebuilt; there is no source or
// build pipeline for them in this repo. They target `wasi_unstable`, i.e. WASI
// preview0. Several things below exist only to work around defects in that
// specific memfs build, or depend on preview0 details that preview1 changed.
// If memfs is ever rebuilt or moved to preview1/wasi-sdk, revisit each:
//
//  1. WHENCE_* below are preview0's ordering (CUR=0, END=1, SET=2). Preview1
//     uses SET=0, CUR=1, END=2. Getting this wrong corrupts reads silently
//     rather than failing, so re-verify before trusting it.
//  2. MemFS._readProjectFile replaces memfs's own `fd_read` for project files,
//     because this build ignores the iovec lengths it is given and copies the
//     whole rest of the file, overrunning the caller's buffer and leaving the
//     position at EOF. Once `fd_read` honours iovec lengths and reports the
//     true count, that method and MemFS._withScratch can both be deleted and
//     `fd_read` left unwrapped. The test is a read-to-EOF loop
//     (`while ((c = fgetc(f)) != EOF)`) over a file larger than BUFSIZ.
//  3. Nothing here fabricates a WASI errno, because preview0 and preview1
//     number them differently; failures are signalled by letting the real call
//     produce its own error. Keep it that way.
//  4. MemFS._loadIfNeeded reads paths straight out of the *calling* module's
//     memory, which assumes a single preopened root and paths relative to it —
//     true of this build. See normalizePath for the forms actually observed.

import BaseAPI from './base-api.js';
import { getPartsFromPath } from '../lib/helpers.js';
import {
  FileChannelClient,
  STATUS_OK,
  STATUS_TOO_LARGE,
} from './file-channel.js';

const CLANG_C_FLAGS = [
  '-O0', '-std=c11', '-O0', '-Wall', '-Werror', '-Wextra',
  '-Wno-unused-variable', '-Wno-sign-compare', '-Wno-unused-parameter',
  '-Wshadow', '-D_XOPEN_SOURCE'
];
const CLANG_LD_FLAGS = ['-lc', '-lcs50'];

/**
 * Reduce a path the runtime asked for to its canonical form, so it can be
 * matched against the project's file list.
 *
 * WASI paths here are always relative to the single preopened root, and the
 * only forms observed from clang and wasi-libc are plain paths, a leading
 * `./` on a quoted include, and `..` segments from an include like
 * `#include "../top.h"`.
 *
 * @param {string} path - The raw path from the WASI call.
 * @returns {string} The path with `.` and `..` segments resolved.
 */
function normalizePath(path) {
  const segments = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return segments.join('/');
}

function readStr(u8, o, len = -1) {
  let str = '';
  let end = u8.length;
  if (len != -1)
    end = o + len;
  for (let i = o; i < end && u8[i] != 0; ++i)
    str += String.fromCharCode(u8[i]);
  return str;
}

class ProcExit extends Error {
  constructor(code) {
    super(`process exited with code ${code}.`);
    this.code = code;
  }
};

class AbortError extends Error {
  constructor(msg = 'abort') { super(msg); }
}

class AssertError extends Error {
  constructor(msg) { super(msg); }
}

function assert(cond) {
  if (!cond) {
    throw new AssertError('assertion failed.');
  }
}

function getInstance(module, imports) {
  return WebAssembly.instantiate(module, imports);
}

function getImportObject(obj, names) {
  const result = {};
  for (let name of names) {
    result[name] = obj[name].bind(obj);
  }
  return result;
}

const ESUCCESS = 0;

// `fd_seek` whence values, preview0 ordering — see MEMFS WORKAROUNDS (1) at the
// top of this file. Verified against this build by logging what C's
// SEEK_SET/CUR/END actually arrive as, not taken from a spec.
const WHENCE_CUR = 0;
const WHENCE_END = 1;
const WHENCE_SET = 2;

class Memory {
  constructor(memory) {
    this.memory = memory;
    this.buffer = this.memory.buffer;
    this.u8 = new Uint8Array(this.buffer);
    this.u32 = new Uint32Array(this.buffer);
  }

  check() {
    if (this.buffer.byteLength === 0) {
      this.buffer = this.memory.buffer;
      this.u8 = new Uint8Array(this.buffer);
      this.u32 = new Uint32Array(this.buffer);
    }
  }

  read8(offset) { return this.u8[offset]; }
  read32(offset) { return this.u32[offset >> 2]; }
  write8(offset, val) { this.u8[offset] = val; }
  write32(offset, val) { this.u32[offset >> 2] = val; }
  write64(offset, vlo, vhi = 0) { this.write32(offset, vlo); this.write32(offset + 4, vhi); }

  readStr(offset, len) {
    return readStr(this.u8, offset, len);
  }

  // Null-terminated string.
  writeStr(offset, str) {
    offset += this.write(offset, str);
    this.write8(offset, 0);
    return str.length + 1;
  }

  write(offset, buf) {
    if (buf instanceof ArrayBuffer) {
      return this.write(offset, new Uint8Array(buf));
    } else if (typeof buf === 'string') {
      return this.write(offset, buf.split('').map(x => x.charCodeAt(0)));
    } else {
      const dst = new Uint8Array(this.buffer, offset, buf.length);
      dst.set(buf);
      return buf.length;
    }
  }
}

class MemFS {
  constructor(options) {
    const compileStreaming = options.compileStreaming;
    this.hostWrite = options.hostWrite;
    this.hostRead = options.hostRead;
    this.sharedMem = options.sharedMem;
    this.stdinStr = options.stdinStr || "";
    this.stdinStrPos = 0;
    this.memfsFilename = options.memfsFilename;
    this.hostWriteError = options.hostWriteError;
    this.fileReader = options.fileReader;

    this.hostMem_ = null;  // Set later when wired up to application.

    // Per-run state for on-demand file loading, reset by startRun(). The worker
    // outlives a run, so these must not persist: re-reading next run is what
    // picks up edits the user made in between.
    this.projectFiles = new Set();
    this.filesRead = new Set();
    this.dirsCreated = new Set();

    // fd -> canonical path, for project files whose reads are served here.
    this.openFiles = new Map();

    // Imports for memfs module.
    const env = getImportObject(
      this, ['abort', 'host_write', 'host_read', 'memfs_log', 'copy_in', 'copy_out']);

    this.ready = compileStreaming(this.memfsFilename)
      .then(module => WebAssembly.instantiate(module, { env }))
      .then(instance => {
        this.instance = instance;
        this.exports = this._wrapExports(instance.exports);
        this.mem = new Memory(this.exports.memory);
        this.exports.init();
      });
  }

  /**
   * Wrap the WASI calls that take a path, so a project file can be loaded the
   * first time something opens it, and patch over memfs's broken reads.
   *
   * Wrapping here rather than where the table is spliced into the import object
   * means clang, lld and the user's own program all pick this up unchanged.
   * `path_open` covers `#include` and `fopen`; `path_filestat_get` covers the
   * `stat`/`access` probes clang and libc make before opening.
   *
   * memfs is a prebuilt binary with no source in this repo, so its behaviour
   * can only be corrected from here. See MEMFS WORKAROUNDS at the top of this
   * file before changing any of it.
   *
   * @param {WebAssembly.Exports} raw - The instance's own exports.
   * @returns {object} A copy with the wrapped calls replaced.
   */
  _wrapExports(raw) {
    const wrapped = { ...raw };

    const realOpen = raw.path_open;
    wrapped.path_open = (...args) => {
      const [, , pathPtr, pathLen] = args;
      const canonical = this._loadIfNeeded(pathPtr, pathLen);
      const result = realOpen(...args);

      // Remember which fd belongs to which project file, so reads on it can be
      // served here instead of by memfs. args[8] is where the fd is written.
      if (result === ESUCCESS && canonical && this.hostMem_) {
        this.hostMem_.check();
        this.openFiles.set(this.hostMem_.read32(args[8]), canonical);
      }
      return result;
    };

    const realStat = raw.path_filestat_get;
    wrapped.path_filestat_get = (...args) => {
      this._loadIfNeeded(args[2], args[3]);
      return realStat(...args);
    };

    const realClose = raw.fd_close;
    wrapped.fd_close = (fd) => {
      this.openFiles.delete(fd);
      return realClose(fd);
    };

    const realRead = raw.fd_read;
    const realSeek = raw.fd_seek;
    wrapped.fd_read = (fd, iovs, iovsLen, nreadOut) => {
      if (!this.openFiles.has(fd)) return realRead(fd, iovs, iovsLen, nreadOut);
      return this._readProjectFile(realRead, realSeek, fd, iovs, iovsLen, nreadOut);
    };

    return wrapped;
  }

   /**
   * Serve a read from a project file out of memfs's own storage.
   *
   * Workaround for a defect in the vendored memfs — see MEMFS WORKAROUNDS (2)
   * at the top of this file, which also says how to tell when it can go. Its
   * `fd_read` ignores the buffer lengths it is given and copies the whole rest
   * of the file, so the copy is done here instead. Its seek and its node
   * storage are both correct, so those are still used.
   *
   * Only files this class loaded are served this way; clang and lld keep the
   * path they already use, which works for how they read. That keeps the
   * workaround off the compile path entirely.
   */
  _readProjectFile(realRead, realSeek, fd, iovs, iovsLen, nreadOut) {
    const mem = this.hostMem_;
    if (!mem || iovsLen < 1) return realRead(fd, iovs, iovsLen, nreadOut);

    mem.check();

    // Copy the request out first, so the array can double as seek scratch.
    const buffers = [];
    for (let i = 0; i < iovsLen; i++) {
      buffers.push({
        at: mem.read32(iovs + i * 8),
        length: mem.read32(iovs + i * 8 + 4),
      });
    }

    const position = this._withScratch(iovs, () =>
      realSeek(fd, 0n, WHENCE_CUR, iovs) === ESUCCESS ? this._readU64(iovs) : null);
    if (position === null) return realRead(fd, iovs, iovsLen, nreadOut);

    this.mem.check();
    const data = this.getFileContents(this.openFiles.get(fd));

    let written = 0;
    for (const { at, length } of buffers) {
      const count = Math.min(length, data.length - position - written);
      if (count <= 0) break;
      const from = position + written;
      mem.write(at, data.subarray(from, from + count));
      written += count;
    }

    mem.write32(nreadOut, written);
    this._withScratch(iovs, () =>
      realSeek(fd, BigInt(position + written), WHENCE_SET, iovs));

    return ESUCCESS;
  }

  /**
   * Run `fn` with the first iovec free to use as scratch, then put it back.
   *
   * `fd_seek` reports its result by writing 8 bytes through a pointer, so it
   * needs writable memory in the *calling* module — which we cannot allocate.
   * The caller's own iovec array is the one region we know is writable and
   * whose contents we already hold, so its first entry is borrowed. Nothing
   * runs in between, and it is restored before the caller sees it again.
   */
  _withScratch(iovs, fn) {
    const mem = this.hostMem_;
    const savedLo = mem.read32(iovs);
    const savedHi = mem.read32(iovs + 4);
    try {
      return fn();
    } finally {
      mem.write32(iovs, savedLo);
      mem.write32(iovs + 4, savedHi);
    }
  }

  /** Read the u64 `fd_seek` wrote at `ptr`. */
  _readU64(ptr) {
    return this.hostMem_.read32(ptr) + this.hostMem_.read32(ptr + 4) * 2 ** 32;
  }

  /**
   * Begin a run: adopt its file list and drop the previous run's state.
   *
   * Every directory in the list is created up front. That is content-free
   * and cheap, and it means a file can be added mid-`path_open` without having
   * to build its parents at that point.
   *
   * @param {string[]} paths - Canonical paths of every file in the project.
   */
  startRun(paths) {
    this.projectFiles = new Set(paths);
    this.filesRead.clear();
    this.dirsCreated.clear();
    this.openFiles.clear();

    for (const path of paths) {
      this.ensureDirs(path);
    }
  }

  /**
   * Record that a path is already in memfs, so the wrapper leaves it alone.
   * Used for the sources, which are added explicitly before compiling.
   *
   * @param {string} path - A canonical project path.
   */
  markRead(path) {
    this.filesRead.add(path);
  }

  /**
   * Load a file into memfs if the runtime just asked for one we have not read
   * yet. Anything not in the project's files is left alone, so the real call reports
   * its own error for it.
   *
   * @param {number} pathPtr - Path offset, in the *calling* module's memory.
   * @param {number} pathLen - Path length in bytes.
   * @returns {?string} The canonical path when it is a project file that is now
   * in memfs, else null.
   */
  _loadIfNeeded(pathPtr, pathLen) {
    if (!this.fileReader || this.projectFiles.size === 0 || !this.hostMem_) return null;

    let path;
    try {
      this.hostMem_.check();
      // Decoded as UTF-8 rather than with readStr(), which is latin-1 and stops
      // at a NUL, and so would mangle a path with non-ASCII characters.
      path = new TextDecoder().decode(
        this.hostMem_.u8.subarray(pathPtr, pathPtr + pathLen));
    } catch {
      return null;
    }

    const canonical = normalizePath(path);
    if (!this.projectFiles.has(canonical)) return null;
    if (this.filesRead.has(canonical)) return canonical;

    // Recorded before reading, so a failure is not retried on every attempt.
    this.filesRead.add(canonical);

    const { status, bytes } = this.fileReader.read(canonical);
    if (status === STATUS_TOO_LARGE) {
      this.hostWriteError(
        `Cannot open '${canonical}': file is too large to use while running.\n`);
      return null;
    }
    if (status !== STATUS_OK) return null;

    this.addFile(canonical, bytes);
    return canonical;
  }

  /**
   * Create every parent directory of a path, outermost first, since each node
   * needs its parent to exist already.
   *
   * @param {string} path - A file path.
   */
  ensureDirs(path) {
    const { parentPath } = getPartsFromPath(path);
    if (!parentPath) return;

    let dirPath = '';
    for (const segment of parentPath.split('/')) {
      dirPath = dirPath ? `${dirPath}/${segment}` : segment;
      if (this.dirsCreated.has(dirPath)) continue;
      this.dirsCreated.add(dirPath);
      this.addDirectory(dirPath);
    }
  }

  set hostMem(mem) {
    this.hostMem_ = mem;
  }

  setStdinStr(str) {
    this.stdinStr = str;
    this.stdinStrPos = 0;
  }

  addDirectory(path) {
    this.mem.check();
    this.mem.write(this.exports.GetPathBuf(), path);
    this.exports.AddDirectoryNode(path.length);
  }

  addFile(path, content) {
    const length =
      content instanceof ArrayBuffer ? content.byteLength : content.length;
    this.mem.check();
    this.mem.write(this.exports.GetPathBuf(), path);
    const inode = this.exports.AddFileNode(path.length, length);
    const addr = this.exports.GetFileNodeAddress(inode);
    this.mem.check();
    this.mem.write(addr, content);
  }

  getFileContents(path) {
    this.mem.check();
    this.mem.write(this.exports.GetPathBuf(), path);
    const inode = this.exports.FindNode(path.length);
    const addr = this.exports.GetFileNodeAddress(inode);
    const size = this.exports.GetFileNodeSize(inode);
    return new Uint8Array(this.mem.buffer, addr, size);
  }

  abort() { throw new AbortError(); }

  host_write(fd, iovs, iovs_len, nwritten_out) {
    this.hostMem_.check();
    assert(fd <= 2);
    let size = 0;
    let str = '';
    for (let i = 0; i < iovs_len; ++i) {
      const buf = this.hostMem_.read32(iovs);
      iovs += 4;
      const len = this.hostMem_.read32(iovs);
      iovs += 4;
      str += this.hostMem_.readStr(buf, len);
      size += len;
    }
    this.hostMem_.write32(nwritten_out, size);
    this.hostWrite(str);
    return ESUCCESS;
  }

  host_read(fd, iovs, iovs_len, nread) {
    let str = '';

    this.hostRead();
    Atomics.wait(new Int32Array(this.sharedMem.buffer), 0, 0);

    // Read the value stored in memory.
    const sharedMem = new Uint8Array(this.sharedMem.buffer);
    for (let i = 0; i < sharedMem.length; i++) {
      if (sharedMem[i] === 0) {
        // Null terminator found, terminate the loop.
        break;
      }

      str += String.fromCharCode(sharedMem[i]);
    }

    // Clean shared memory.
    sharedMem.fill(0);

    this.hostMem_.check();
    assert(fd === 0);

    const strLen = str.length;
    let bytesWritten = 0;
    for (let i = 0; i < iovs_len; ++i) {
      const buf = this.hostMem_.read32(iovs);
      iovs += 4;
      const len = this.hostMem_.read32(iovs);
      iovs += 4;

      const remainingBytes = strLen - bytesWritten;
      const bytesToWrite = Math.min(len, remainingBytes);
      const slice = str.slice(bytesWritten, bytesWritten + bytesToWrite);
      this.hostMem_.write(buf, slice);
      bytesWritten += bytesToWrite;
    }

    this.hostMem_.write32(nread, bytesWritten);
    return ESUCCESS;
  }

  memfs_log(buf, len) {
    this.mem.check();
    console.log(this.mem.readStr(buf, len));
  }

  copy_out(clang_dst, memfs_src, size) {
    this.hostMem_.check();
    const dst = new Uint8Array(this.hostMem_.buffer, clang_dst, size);
    this.mem.check();
    const src = new Uint8Array(this.mem.buffer, memfs_src, size);
    dst.set(src);
  }

  copy_in(memfs_dst, clang_src, size) {
    this.mem.check();
    const dst = new Uint8Array(this.mem.buffer, memfs_dst, size);
    this.hostMem_.check();
    const src = new Uint8Array(this.hostMem_.buffer, clang_src, size);
    dst.set(src);
  }
}

const RAF_PROC_EXIT_CODE = 0xC0C0A;

// Convert WASM-specific runtime errors to more common C/Linux-style messages.
const RUNTIME_ERRORS = [
  // Bad "function pointer" apparently includes NULL file pointers.
  [
    /null function|signature mismatch|call_indirect/i,
    'Segmentation fault. Did you use a pointer that is NULL, ' +
    'for instance the result of an fopen that failed?',
  ],
  // Reading or writing outside of the program's memory.
  [
    /out of bounds/i,
    'Segmentation fault. Did you index outside of an array, ' +
    'or use a pointer that does not point at anything?',
  ],
  // Stack.
  [
    /call stack|recursion|stack overflow/i,
    'Stack overflow. Did you write a recursive function that never stops?',
  ],
];

/**
 * Describe an error thrown while running the user's program in terms a student
 * can act on, falling back to the original message.
 *
 * @param {Error} exn - The error that was thrown.
 * @returns {string} The message to print.
 */
function describeRuntimeError(exn) {
  const isTrap = exn instanceof WebAssembly.RuntimeError
    || exn instanceof RangeError;

  if (isTrap) {
    for (const [pattern, message] of RUNTIME_ERRORS) {
      if (pattern.test(exn.message)) {
        return message;
      }
    }
  }

  return exn.message;
}

class App {
  constructor(module, memfs, name, ...args) {
    this.argv = [name, ...args];
    this.environ = { USER: 'alice' };
    this.memfs = memfs;
    this.allowRequestAnimationFrame = true;
    this.handles = new Map();
    this.nextHandle = 0;

    const env = getImportObject(this, []);

    const wasi_unstable = getImportObject(this, [
      'proc_exit', 'environ_sizes_get', 'environ_get', 'args_sizes_get',
      'args_get', 'random_get', 'clock_time_get', 'poll_oneoff'
    ]);

    // Fill in some WASI implementations from memfs.
    Object.assign(wasi_unstable, this.memfs.exports);

    this.ready = getInstance(module, { wasi_unstable, env }).then(instance => {
      this.instance = instance;
      this.exports = this.instance.exports;
      this.mem = new Memory(this.exports.memory);
      this.memfs.hostMem = this.mem;
    });
  }

  async run() {
    await this.ready;
    try {
      this.exports._start();
    } catch (exn) {
      /* Do NOT write the stacktrace, as this is not useful for students. */
      let writeStack = false;

      if (exn instanceof ProcExit) {
        if (exn.code === RAF_PROC_EXIT_CODE) {
          console.log('Allowing rAF after exit.');
          return true;
        }
        // Don't allow rAF unless you return the right code.
        console.log(`Disallowing rAF since exit code is ${exn.code}.`);
        this.allowRequestAnimationFrame = false;
        if (exn.code == 0) {
          return false;
        }
        writeStack = false;
      }

      // Write error message.
      let msg = `\x1b[91mError: ${describeRuntimeError(exn)}`;
      if (writeStack) {
        msg = msg + `\n${exn.stack}`;
      }
      msg += '\x1b[0m\n';
      this.memfs.hostWrite(msg);

      // Propagate error.
      throw exn;
    }
  }

  proc_exit(code) {
    throw new ProcExit(code);
  }

  environ_sizes_get(environ_count_out, environ_buf_size_out) {
    this.mem.check();
    let size = 0;
    const names = Object.getOwnPropertyNames(this.environ);
    for (const name of names) {
      const value = this.environ[name];
      // +2 to account for = and \0 in "name=value\0".
      size += name.length + value.length + 2;
    }
    this.mem.write64(environ_count_out, names.length);
    this.mem.write64(environ_buf_size_out, size);
    return ESUCCESS;
  }

  environ_get(environ_ptrs, environ_buf) {
    this.mem.check();
    const names = Object.getOwnPropertyNames(this.environ);
    for (const name of names) {
      this.mem.write32(environ_ptrs, environ_buf);
      environ_ptrs += 4;
      environ_buf +=
        this.mem.writeStr(environ_buf, `${name}=${this.environ[name]}`);
    }
    this.mem.write32(environ_ptrs, 0);
    return ESUCCESS;
  }

  args_sizes_get(argc_out, argv_buf_size_out) {
    this.mem.check();
    let size = 0;
    for (let arg of this.argv) {
      size += arg.length + 1;  // "arg\0".
    }
    this.mem.write64(argc_out, this.argv.length);
    this.mem.write64(argv_buf_size_out, size);
    return ESUCCESS;
  }

  args_get(argv_ptrs, argv_buf) {
    this.mem.check();
    for (let i = 0; i < this.argv.length; i++) {
      // argv[0] is the command as the user typed it (e.g. './hello')
      let arg = this.argv[i];

      // Remove quotes around the argument just like in a real shell.
      // '"FOO BAR"' with 'FOO BAR' or "'FOO BAR'" with "FOO BAR"
      if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
        arg = arg.slice(1, -1);
      }

      this.mem.write32(argv_ptrs, argv_buf);
      argv_ptrs += 4;
      argv_buf += this.mem.writeStr(argv_buf, arg);
    }

    this.mem.write32(argv_ptrs, 0);
    return ESUCCESS;
  }

  random_get(buf, buf_len) {
    const data = new Uint8Array(this.mem.buffer, buf, buf_len);
    for (let i = 0; i < buf_len; ++i) {
      data[i] = (Math.random() * 256) | 0;
    }
  }

  clock_time_get(clock_id, precision, time_out) {
    this.mem.check();

    let time;
    if (clock_id === 0) {
      // CLOCK_REALTIME: Get current timestamp in nanoseconds
      time = BigInt(Date.now()) * 1_000_000n;
    } else if (clock_id === 1) {
      // CLOCK_MONOTONIC: High-resolution timer since some fixed point
      time = BigInt(Math.floor(performance.now() * 1_000_000));
    } else {
      throw new NotImplemented('wasi_unstable', 'clock_time_get');
    }

    // Store the timestamp in memory
    this.mem.write64(time_out, Number(time & 0xFFFFFFFFn), Number(time >> 32n));
    return ESUCCESS;
  }

  poll_oneoff(in_ptr, out_ptr, nsubscriptions, nevents_out) {
    throw new NotImplemented('wasi_unstable', 'poll_oneoff');
  }
}

class Tar {
  constructor(buffer) {
    this.u8 = new Uint8Array(buffer);
    this.offset = 0;
  }

  readStr(len) {
    const result = readStr(this.u8, this.offset, len);
    this.offset += len;
    return result;
  }

  readOctal(len) {
    return parseInt(this.readStr(len), 8);
  }

  alignUp() {
    this.offset = (this.offset + 511) & ~511;
  }

  readEntry() {
    if (this.offset + 512 > this.u8.length) {
      return null;
    }

    const entry = {
      filename: this.readStr(100),
      mode: this.readOctal(8),
      owner: this.readOctal(8),
      group: this.readOctal(8),
      size: this.readOctal(12),
      mtim: this.readOctal(12),
      checksum: this.readOctal(8),
      type: this.readStr(1),
      linkname: this.readStr(100),
    };

    const format = this.readStr(8);
    if (!/ustar/.test(format)) {
      return null;
    }

    entry.ownerName = this.readStr(32);
    entry.groupName = this.readStr(32);
    entry.devMajor = this.readStr(8);
    entry.devMinor = this.readStr(8);
    entry.filenamePrefix = this.readStr(155);
    this.alignUp();

    if (entry.type === '0') {        // Regular file.
      entry.content = this.u8.subarray(this.offset, this.offset + entry.size);
      this.offset += entry.size;
      this.alignUp();
    } else if (entry.type !== '5') { // Directory.
      console.log('type', entry.type);
      assert(false);
    }
    return entry;
  }

  untar(memfs) {
    let entry;
    while (entry = this.readEntry()) {
      switch (entry.type) {
        case '0': // Regular file.
          memfs.addFile(entry.filename, entry.content);
          break;
        case '5': // Directory.
          memfs.addDirectory(entry.filename);
          break;
      }
    }
  }
}

class API extends BaseAPI {
  constructor(options) {
    super(options);
    this.moduleCache = {};
    this.hostWriteError = options.hostWriteError;
    this.newOrModifiedFilesCallback = options.newOrModifiedFilesCallback;
    this.readBuffer = options.readBuffer;
    this.sharedMem = options.sharedMem;
    this.hostRead = options.hostRead;
    this.compileStreaming = options.compileStreaming;
    this.clangFilename = options.clang || 'clang';
    this.lldFilename = options.lld || 'lld';
    this.sysrootFilename = options.sysroot || 'sysroot.tar';

    this.cflags = CLANG_C_FLAGS;
    this.ldflags = CLANG_LD_FLAGS;

    // Lets the worker read project files from inside a synchronous WASI call.
    // Absent when the page lacks the COOP/COEP headers.
    this.fileReader = options.fileChannel
      ? new FileChannelClient(options.fileChannel, options.requestFile)
      : null;

    this.memfs = new MemFS({
      compileStreaming: this.compileStreaming,
      hostWrite: this.hostWrite,
      hostWriteError: this.hostWriteError,
      hostRead: this.hostRead,
      sharedMem: this.sharedMem,
      fileReader: this.fileReader,
      memfsFilename: options.memfs || 'memfs',
    });

    this.ready = this.memfs.ready.then(() => {
      return this.untar(this.sysrootFilename);
    });

    this.ready.then(() => {
      this.loadModules().then(() => {
        options.readyCallback();
      });
    })
  }

  loadModules() {
    return Promise.all([
      this.getModule(this.clangFilename),
      this.getModule(this.lldFilename),
    ]);
  }

  async hostLogAsync(message, promise) {
    this.hostLog(`${message}...`);
    const result = await promise;
    this.hostWrite('done.\n');
    return result;
  }

  /**
   * Read a project file, blocking until the main thread answers. Safe to call
   * from inside a synchronous WASI import.
   *
   * @param {string} path - The (VFS-absolute) file path.
   * @returns {?Uint8Array} The file content, or null when it could not be read.
   */
  readProjectFile(path) {
    if (!this.fileReader) return null;
    const { status, bytes } = this.fileReader.read(path);
    return status === STATUS_OK ? bytes : null;
  }

  async getModule(name) {
    if (this.moduleCache[name]) return this.moduleCache[name];
    const module = await this.compileStreaming(name);
    this.moduleCache[name] = module;
    return module;
  }

  async untar(filename) {
    await this.memfs.ready;
    const tar = new Tar(await this.readBuffer(filename));
    tar.untar(this.memfs);
  }

  async compile(options) {
    const input = options.input;
    const content = options.content;
    const obj = options.obj;

    await this.ready;
    this.memfs.addFile(input, content);
    const clang = await this.getModule(this.clangFilename);
    return await this.run([
      clang, 'clang', '-cc1', '-emit-obj', '-disable-free',
      '-isysroot', '/',
      '-internal-isystem', '/include',
      '-internal-isystem', '/lib/clang/8.0.1/include',
      '-ferror-limit', '19',
      '-fmessage-length', '80',
      '-fcolor-diagnostics',
      '-x', 'c', ...this.cflags, '-o', obj, input
    ]);
  }

  async link(objs, wasm) {
    const stackSize = 1024 * 1024;
    const libdir = 'lib/wasm32-wasi';
    const crt1 = `${libdir}/crt1.o`;

    await this.ready;
    const lld = await this.getModule(this.lldFilename);
    return await this.run([
      lld, 'wasm-ld', '--no-threads',
      '--export-dynamic',
      '-z', `stack-size=${stackSize}`,
      `-L${libdir}`, crt1, ...objs, ...this.ldflags,
      '-o', wasm,
    ]);
  }

  async run(cmd) {
    const [module, ...args] = cmd;
    const app = new App(module, this.memfs, ...args);
    const stillRunning = await app.run();
    return stillRunning ? app : null;
  }

  /**
   * Compile and link a target from its sources.
   *
   * @param {object} options
   * @param {object[]} options.srcFiles - The source files to compile. These
   * carry their content unless `lazyFiles` is set.
   * @param {string[]} options.srcFilenames - The source paths as requested,
   * used for the echoed command and the existence check.
   * @param {string[]} options.vfsFilePaths - Every path in the project.
   * @param {string} options.target - The output path, without an extension.
   * @param {boolean} options.lazyFiles - Whether sources are read on demand.
   * @returns {Promise<?Uint8Array>} The linked binary, or null when the build
   * failed.
   */
  async buildTarget({ srcFiles, srcFilenames, vfsFilePaths, target, lazyFiles }) {
    const wasm = `${target}.wasm`;
    const objectFiles = [];

    this.hostWriteCmd(`make ${target}`);
    this.hostWrite(makeCmdPlaceholder(srcFilenames, target) + '\n');

    // Check if the user misspelled some paths in srcFilenames.
    const incorrectFiles = srcFilenames
      .filter((filepath) => !vfsFilePaths.includes(filepath))
      .join(', ');

    if (incorrectFiles.length > 0) {
      this.hostWriteError(`Error: The following files do not exist: ${incorrectFiles}\n`);
      return null;
    }

    for (const file of srcFiles) {
      if (!file.path.endsWith('.c')) {
        continue;
      }

      // Make parent dirs before creating the final file inside it. Each
      // directory node must be created individually and in order, as its
      // parent has to exist already. startRun() has already done this for a
      // lazy run, and _ensureDirs skips what it created.
      this.memfs.ensureDirs(file.path);

      // A lazy run gets stubs, so fetch the source we are about to compile.
      const content = lazyFiles ? this.readProjectFile(file.path) : file.content;
      if (lazyFiles && content === null) {
        this.hostWriteError(`Error: could not read ${file.path}\n`);
        return null;
      }

      // compile() adds this to memfs itself; keep the wrapper off it.
      this.memfs.markRead(file.path);

      const obj = `${file.path.replace(/\.c$/, '')}.o`;
      try {
        await this.compile({ input: file.path, content, obj });
      } catch {
        return null;
      }
      objectFiles.push(obj);
    }

    try {
      await this.link(objectFiles, wasm);
    } catch {
      return null;
    }

    // getFileContents hands back a view onto memfs's own heap, which the next
    // build overwrites, so take a copy before it leaves this method.
    return this.memfs.getFileContents(wasm).slice();
  }

  /**
   * Work out what to build from a run payload, build it, and hand the binary
   * to the host so it shows up in the file tree.
   *
   * @param {object} data - The data object coming from the main thread.
   * @param {string} data.activeTabPath - The path of the file being run.
   * @param {array} data.vfsFiles - Every file in the VFS. When `lazyFiles` is
   * set these carry no content, and the file is read on demand the first time
   * the runtime opens it; otherwise each carries its content up front.
   * @param {boolean} data.lazyFiles - Whether `vfsFiles` entries are stubs.
   * @param {?object} data.runAsConfig - The configuration for the run-as button.
   * @returns {Promise<{ target: string, binary: ?Uint8Array }>}
   */
  async build({ activeTabPath, vfsFiles, runAsConfig, lazyFiles }) {
    const srcFilenames = runAsConfig
      ? runAsConfig.compileSrcFilenames
      : [activeTabPath];

    const srcFiles = vfsFiles.filter((file) => srcFilenames.includes(file.path));
    const vfsFilePaths = vfsFiles.map((file) => file.path);

    // An empty list leaves on-demand loading off, so an eager run behaves
    // exactly as before while still getting its per-run state reset.
    this.memfs.startRun(lazyFiles ? vfsFilePaths : []);

    // The binary lands next to its source, so `./hello` works from the folder
    // the source is in.
    const target = runAsConfig
      ? runAsConfig.compileTarget
      : activeTabPath.replace(/\.c$/, '');

    const binary = await this.buildTarget({
      srcFiles, srcFilenames, vfsFilePaths, target, lazyFiles,
    });

    // Reported through the same channel a run uses for any file it produced.
    // `temporary` is what marks it as a build artifact: visible in the file
    // tree, but held in memory and never written to disk or committed.
    if (binary) {
      this.newOrModifiedFilesCallback([
        { path: target, content: binary, temporary: true },
      ]);
    }

    return { target, binary };
  }

  /**
   * Run a compiled binary and print its output to the terminal.
   *
   * @param {string} cmd - The command as the user typed it, echoed to the
   * terminal and passed to the program as argv[0].
   * @param {Uint8Array} binary - The compiled wasm binary.
   * @param {string[]} args - The command-line arguments.
   */
  async execute(cmd, binary, args) {
    this.hostWriteCmd([cmd, ...args].join(' '));

    try {
      const module = await WebAssembly.compile(binary);
      return await this.run([module, cmd, ...args]);
    } finally {
      this.runUserCodeCallback();
    }
  }

  /**
   * Compile the user's code and run it. Backs the Run button.
   *
   * @param {object} data - See build().
   */
  async runUserCode(data) {
    await this.ready;

    const { target, binary } = await this.build(data);
    if (!binary) {
      this.runUserCodeCallback();
      return;
    }

    const args = data.runAsConfig ? data.runAsConfig.args : [];
    return await this.execute(`./${target}`, binary, args);
  }

  /**
   * Compile the user's code without running it. Backs the shell's `make`.
   *
   * @param {object} data - See build().
   */
  async compileUserCode(data) {
    await this.ready;

    await this.build(data);

    // Run-end both cleans up the terminal and releases whoever is waiting. A
    // build reports nothing else: its diagnostics have already been written,
    // and killing the worker mid-build still settles the caller through the
    // run-end the client synthesises.
    this.runUserCodeCallback();
  }

  /**
   * Run a binary the user built earlier, e.g. `./hello alice` from the shell.
   *
   * @param {object} data - The data object coming from the main thread.
   * @param {string} data.cmd - The command as typed, echoed and used as argv[0].
   * @param {ArrayBuffer} data.binary - The compiled wasm binary.
   * @param {string[]} data.args - The command-line arguments.
   * @param {array} data.vfsFiles - Every file in the VFS, so the program can
   * open project files while it runs.
   * @param {boolean} data.lazyFiles - Whether `vfsFiles` entries are stubs.
   */
  async runBinary({ cmd, binary, args, vfsFiles, lazyFiles }) {
    await this.ready;

    this.memfs.startRun(lazyFiles ? vfsFiles.map((file) => file.path) : []);

    return await this.execute(cmd, new Uint8Array(binary), args);
  }
}

/**
 * Make a command placeholder for the clang compile command.
 *
 *
 * @param {string[]} srcFiles - List of files to compile.
 * @param {string} target - Name of the output file (target).
 * @returns {string} The command.
 */
function makeCmdPlaceholder(srcFilenames, target) {
  const cmd = [
    'clang', ...CLANG_C_FLAGS,
    '-o', target,
    ...srcFilenames,
    ...CLANG_LD_FLAGS,
  ];

  return cmd.join(' ');
}


// =============================================================================
// Worker message handling.
// =============================================================================

let api;
let currentApp = null;

const onAnyMessage = async event => {
  // Per message, so an entry point can never inherit the previous run's
  // setting, and a message that says nothing about it (runSnippet) echoes.
  if (api) api.echoCmd = event.data.data?.echoCmd !== false;

  switch (event.data.id) {
    case 'constructor':
      const { port, sharedMem, fileChannel } = event.data.data;
      port.onmessage = onAnyMessage;
      api = new API({
        sharedMem,
        fileChannel,

        requestFile() {
          port.postMessage({ id: 'readVfsFile' });
        },

        async readBuffer(filename) {
          const response = await fetch(filename);
          return response.arrayBuffer();
        },

        async compileStreaming(filename) {
          const response = await fetch(filename);
          return WebAssembly.compile(await response.arrayBuffer());
        },

        hostWrite(s) {
          port.postMessage({ id: 'write', data: s });
        },

        hostWriteError(s) {
          port.postMessage({ id: 'write-error', data: s });
        },

        hostRead() {
          port.postMessage({ id: 'readStdin' });
        },

        readyCallback() {
          port.postMessage({ id: 'ready' });
        },

        runUserCodeCallback() {
          port.postMessage({ id: 'runUserCodeCallback' });
        },

        newOrModifiedFilesCallback(newOrModifiedFiles) {
          // Posts full file contents:
          port.postMessage({ id: 'newOrModifiedFilesCallback', newOrModifiedFiles });
        },

        clang: '../../wasm/c_cpp/clang',
        lld: '../../wasm/c_cpp/lld',
        sysroot: '../../wasm/c_cpp/sysroot.tar',
        memfs: '../../wasm/c_cpp/memfs',
      });
      break;

    case 'runUserCode':
      if (currentApp) {
        // Stop running rAF on the previous app, if any.
        currentApp.allowRequestAnimationFrame = false;
      }
      currentApp = await api.runUserCode(event.data.data);
      break;

    case 'compileUserCode':
      await api.compileUserCode(event.data.data);
      break;

    case 'runBinary':
      if (currentApp) {
        currentApp.allowRequestAnimationFrame = false;
      }
      currentApp = await api.runBinary(event.data.data);
      break;
  }
};

self.onmessage = onAnyMessage;
