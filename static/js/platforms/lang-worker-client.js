import {
  CHANNEL_BYTES,
  FileChannelServer,
  STATUS_INTERNAL,
  STATUS_NOT_FOUND,
  STATUS_TOO_LARGE,
} from './file-channel.js';
import { FileNotFoundError, FileTooLargeError } from '../fs/vfs.js';
import { hasSharedMemory } from '../lib/environment.js';

/**
 * Built-in languages are registered here with owner `null`. Plugins may add
 * more via registerLang(). The owner lets a worker's custom messages be routed
 * back to just that plugin instead of every plugin.
 *
 * `commands` names the interpreters that directly run a script in this
 * language from the shell.
 *
 * @type {Object<string, { path: string, owner: ?string, lazyFiles: boolean, commands: string[] }>}
 */
const workers = {
  c: { path: 'static/js/platforms/clang.worker.js', owner: null, lazyFiles: true, commands: [] },
  py: { path: 'static/js/platforms/py.worker.js', owner: null, lazyFiles: false, commands: ['python', 'python3'] },
};


/**
 * Main-thread client that manages language workers and provides a
 * communication channel for the currently activated language worker.
 */
export default class LangWorkerClient {
  /**
   * The programming language the active worker runs, or null when idle.
   * @type {string}
   */
  proglang = null;

  /**
   * Contains a shared memory object when enabled.
   * @type {WebAssembly.Memory}
   */
  sharedMem = null;

  /**
   * Whether the worker is currently running code from the user.
   * @type {boolean}
   */
  isRunningCode = false;

  /**
   * Whether the worker has been initialised.
   * @type {boolean}
   */
  isReady = false;

  /**
   * Current active worker instance for a specific proglang.
   * @type {Worker}
   */
  worker = null;

  /**
   * Resolves _loadingPromise once the worker signals ready.
   * @type {Function|null}
   */
  _readyResolver = null;

  /**
   * Promise that resolves when the current worker is ready. Created by
   * _createWorker so restart() sets it up too. Shared by all load() callers
   * waiting on the same worker.
   * @type {Promise<void>|null}
   */
  _loadingPromise = null;

  /**
   * True while a runFile or runSnippet call is awaiting the worker. Drives
   * hasPendingCommand() so getRunStatus() reports "loading".
   * @type {boolean}
   */
  _runQueued = false;

  /**
   * App-side reaction callbacks. See App.getLangWorkerHandlers() for the shape.
   * @type {object}
   */
  handlers = null;

  /**
   * Shared buffer the worker uses to request project files, and the server end
   * that answers on it. Null when shared memory is unavailable.
   * @type {?SharedArrayBuffer}
   */
  fileChannel = null;
  fileChannelServer = null;

  /**
   * File content resolved during the current run, keyed by path. Cleared when
   * the run ends so edits are picked up next time.
   * @type {Map<string, Uint8Array>}
   */
  _fileCache = new Map();

  /**
   * The constructor receives references to handlers that the app provides.
   * This client is created once during the lifetime of the app.
   *
   * @param {object} handlers - App-side reaction callbacks. Required keys:
   * onReady, onWrite, onWriteError, onRequestStdin, onRunSnippetDone,
   * onRunStarted, onRunEnded, onNewOrModifiedFiles, onDeletedFiles.
   */
  constructor(handlers) {
    this.handlers = handlers;
  }

  /**
   * Check whether a given proglang has a corresponding worker implementation.
   *
   * @param {string} proglang - The proglang to check for.
   * @returns {boolean} True if proglang is supported, false otherwise.
   */
  supports(proglang) {
    return Object.prototype.hasOwnProperty.call(workers, proglang);
  }

  /**
   * Register a worker script for a programming language. Used by plugins to add
   * a language to the run pipeline.
   *
   * @param {string} proglang - The programming language (= file extension).
   * @param {string} workerPath - Path to the worker script.
   * @param {?string} owner - Name of the plugin registering the language; it
   *   receives this language's custom worker messages (see onWorkerMessage).
   * @param {object} [options]
   * @param {boolean} [options.lazyFiles] - Whether the worker reads project
   *   files on demand instead of being handed their content up front.
   * @param {string[]} [options.commands] - Interpreter names that launch this
   *   language from the shell, e.g. `['python', 'python3']`.
   */
  registerLang(proglang, workerPath, owner = null, { lazyFiles = false, commands = [] } = {}) {
    workers[proglang] = { path: workerPath, owner, lazyFiles, commands };
  }

  /**
   * The language an interpreter command runs, e.g. 'py' for 'python3'. The
   * shell uses this to tell an interpreter launch from a builtin, and to
   * reject a file the interpreter cannot run.
   *
   * @param {string} command - The first word of a command line.
   * @returns {?string} The programming language, or null when the command is
   * not an interpreter.
   */
  getLangForCommand(command) {
    const match = Object.entries(workers).find(
      ([, worker]) => worker.commands?.includes(command)
    );
    return match ? match[0] : null;
  }

  /**
   * Whether this language's worker reads project files on demand instead of
   * being handed their content up front. Callers use this to decide what to put
   * in the run payload.
   *
   * @param {string} proglang - The programming language.
   * @returns {boolean}
   */
  usesLazyFiles(proglang) {
    return !!workers[proglang]?.lazyFiles;
  }

  /**
   * Get the plugin that owns a programming language, or null for built-ins.
   *
   * @param {string} proglang - The programming language.
   * @returns {?string} The owning plugin's name, or null.
   */
  getLangOwner(proglang) {
    return workers[proglang]?.owner ?? null;
  }

  /**
   * Whether a worker thread is currently running.
   *
   * @returns {boolean} True if a worker is active, false otherwise.
   */
  hasActiveWorker() {
    return !!this.worker;
  }

  hasPendingCommand() {
    return this._runQueued;
  }

  /**
   * Start, switch, or terminate the worker thread for a given language.
   *
   * @param {string} proglang - The programming language to load a worker for.
   */
  load(proglang) {
    // Unsupported language: make sure no worker keeps running.
    if (!this.supports(proglang)) {
      this.terminate();
      return Promise.resolve();
    }

    // Switching languages: terminate the current worker first, while
    // this.proglang still names it.
    if (this.worker && this.proglang !== proglang) {
      this.terminate();
    }

    // Worker already exists and is ready: nothing to be done.
    if (this.worker && this.isReady) {
      return Promise.resolve();
    }

    // Worker is loading or needs to be spawned: notify and wait for ready.
    this.handlers.onLoad(this._runQueued);
    if (!this.worker) {
      this.proglang = proglang;
      this._createWorker();
    }
    return this._loadingPromise;
  }

  /**
   * Whether the page has shared memory. The app refuses to start without it
   * (see checkEnvironment), so this only guards the spawn path, where creating
   * the buffer would otherwise throw.
   *
   * @returns {boolean} True if browser supports shared memory, false otherwise.
   */
  hasSharedMemoryEnabled() {
    return hasSharedMemory();
  }

  /**
   * Terminate the active worker process. If a program was running when killed,
   * the run-ended handler is invoked so the app can reset its UI and clean up
   * the terminal.
   */
  terminate() {
    const wasRunning = this.isRunningCode;
    this._destroyWorker();

    // Only when we abort a still-running program:
    if (wasRunning) {
      this.handlers.onRunEnded();
    }
  }

  /**
   * Destroy the current worker and clean up state.
   */
  _destroyWorker() {
    // Safe to call when idle
    if (!this.worker) {
      return;
    }

    console.log(`Terminating existing ${this.proglang} worker`);

    this._clearFileCache();
    this.isRunningCode = false;
    this.isReady = false;
    this._readyResolver = null;
    this._loadingPromise = null;
    this.worker.terminate();
    this.worker = null;
  }

  /**
   * Spawn a new worker process for the current proglang. Callers are responsible
   * for terminating any existing worker first (load() and restart()).
   */
  _createWorker() {
    this.isReady = false;
    this._loadingPromise = new Promise(resolve => {
      this._readyResolver = resolve;
    });

    console.log(`Spawning new ${this.proglang} worker`);

    this.worker = new Worker(this.getWorkerPath(this.proglang), { type: 'module' });
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.onmessage = this.onmessage.bind(this);
    const remotePort = channel.port2;
    const constructorData = { port: remotePort };

    if (this.hasSharedMemoryEnabled()) {
      this.sharedMem = new WebAssembly.Memory({
        initial: 1,
        maximum: 80,
        shared: true,
      });
      constructorData.sharedMem = this.sharedMem;

      // Separate buffer from sharedMem: that one is a 64 KiB, NUL-terminated,
      // latin-1 stdin slot and cannot carry binary file content.
      this.fileChannel = new SharedArrayBuffer(CHANNEL_BYTES);
      this.fileChannelServer = new FileChannelServer(this.fileChannel);
      constructorData.fileChannel = this.fileChannel;
    } else {
      // Without them the new worker has no channel, so don't leave one behind
      // from a previous spawn pointing at memory it cannot see.
      this.sharedMem = null;
      this.fileChannel = null;
      this.fileChannelServer = null;
    }

    this.worker.postMessage({
      id: 'constructor',
      data: constructorData,
    }, [remotePort]);
  }

  async runFile(proglang, filepath, files, runAsConfig, echoCmd = true) {
    this._runQueued = true;
    await this.load(proglang);
    this._runQueued = false;
    this.isRunningCode = true;
    this.handlers.onRunStarted();
    this.port.postMessage({
      id: 'runUserCode',
      data: {
        activeTabPath: filepath,
        vfsFiles: files,
        runAsConfig,
        // Tells the worker whether `vfsFiles` entries carry content or are
        // name-only entries that can later be lazy-loaded.
        lazyFiles: this.usesLazyFiles(proglang),
        echoCmd,
      },
    });
  }

  /**
   * Compile a file without running it. Only the C worker implements this.
   *
   * @param {string} proglang - The programming language.
   * @param {string} filepath - The source file.
   * @param {object[]} files - The run file payload, see App.getRunFiles().
   * @param {boolean} [echoCmd] - Whether the worker should echo the command.
   */
  async compileFile(proglang, filepath, files, echoCmd = true) {
    this._runQueued = true;
    await this.load(proglang);
    this._runQueued = false;
    this.isRunningCode = true;
    this.handlers.onRunStarted();
    this.port.postMessage({
      id: 'compileUserCode',
      data: {
        activeTabPath: filepath,
        vfsFiles: files,
        lazyFiles: this.usesLazyFiles(proglang),
        echoCmd,
      },
    });
  }

  /**
   * Run a binary that was built earlier, with command-line arguments.
   *
   * @param {string} cmd - The command as the user typed it, used as argv[0].
   * @param {ArrayBuffer} binary - The compiled binary.
   * @param {string[]} args - The command-line arguments.
   * @param {object[]} files - The run file payload, so the program can open
   * project files while it runs.
   * @param {boolean} [echoCmd] - Whether the worker should echo the command.
   */
  async runBinary(cmd, binary, args, files, echoCmd = true) {
    this._runQueued = true;
    await this.load('c');
    this._runQueued = false;
    this.isRunningCode = true;
    this.handlers.onRunStarted();
    this.port.postMessage({
      id: 'runBinary',
      data: {
        cmd, binary, args,
        vfsFiles: files,
        lazyFiles: this.usesLazyFiles('c'),
        echoCmd,
      },
    }, [binary]);
  }

  async runSnippet(proglang, selector, filename, command, files) {
    this._runQueued = true;
    await this.load(proglang);
    this._runQueued = false;
    this.port.postMessage({
      id: 'runSnippet',
      data: { selector, activeTabName: filename, cmd: command, files },
    });
  }

  /**
   * Get the path to the worker file given a programming language.
   *
   * @param {string} proglang - The programming language to get the worker path for.
   * @returns {string} Path to the worker file.
   */
  getWorkerPath(proglang) {
    return workers[proglang]?.path;
  }

  /**
   * Tear down the existing worker and spawn a fresh instance for the same
   * language. Used to abort a running program (e.g. an infinite loop) and for
   * the Pyodide post-run reset.
   */
  restart() {
    const wasRunning = this.isRunningCode;
    this._destroyWorker();

    // Spawn the fresh worker before notifying the app. onRunEnded focuses the
    // editor, which re-enters load() via the focus handler; with a live worker
    // already in place for the same proglang, that call is a harmless no-op
    // instead of spawning a competing second worker.
    this._createWorker();

    if (wasRunning) {
      this.handlers.onRunEnded();
    }
  }

  /**
   * Answer a pending file request from the worker through
   * `handlers.onReadFile`. Results are cached.
   */
  async _serveVfsRead() {
    const server = this.fileChannelServer;

    // The worker is blocked until we answer, and cannot time out, so every
    // path through here must reach exactly one respond/respondError.
    try {
      const path = server.requestedPath();
      let bytes = this._fileCache.get(path);
      if (!bytes) {
        bytes = toBytes(await this.handlers.onReadFile(path));
        this._fileCache.set(path, bytes);
      }
      server.respond(bytes);
    } catch (err) {
      server.respondError(fileErrorStatus(err));
    }
  }

  /** Remove per-run file content, so the next run sees edited files. */
  _clearFileCache() {
    this._fileCache.clear();
  }

  /**
   * Provide the user's stdin input to the worker by writing it into shared
   * memory and notifying the (blocked) worker thread.
   *
   * @param {string} value - The user's input.
   */
  provideStdin(value) {
    const view = new Uint8Array(this.sharedMem.buffer);
    for (let i = 0; i < value.length; i++) {
      // To the shared memory.
      view[i] = value.charCodeAt(i);
    }

    // Set the last byte to the null terminator.
    view[value.length] = 0;

    Atomics.notify(new Int32Array(this.sharedMem.buffer), 0);
  }

  /**
   * Message event handler for the worker. Updates client state and delegates
   * every app/UI reaction to the handlers object.
   *
   * @param {object} event - Event object coming from the worker.
   */
  onmessage(event) {
    switch (event.data.id) {

      // Ready callback from the worker instance. This will be run after
      // everything has been initialised and ready to run some code.
      case 'ready': {
        this.isReady = true;
        this.handlers.onReady(this._runQueued);
        if (this._readyResolver) {
          const resolve = this._readyResolver;
          this._readyResolver = null;
          this._loadingPromise = null;
          resolve();
        }
        break;
      }

      // Write callback from the worker instance. When the worker wants to write
      // code the terminal, this event will be triggered.
      case 'write':
        // Only write when the worker is ready. This prevents infinite loops
        // with print statements to continue printing after the worker has
        // terminated when the user has pressed the stop button.
        if (this.isReady) {
          this.handlers.onWrite(event.data.data);
        }
        break;

      case 'write-error':
        this.handlers.onWriteError(event.data.data);
        break;

      // Stdin callback from the worker instance. When the worker requests user
      // input, this event will be triggered. The user input will be requested
      // and sent back to the worker through the usage of shared memory.
      case 'readStdin':
        this.handlers.onRequestStdin().then((value) => this.provideStdin(value));
        break;

      // The worker is blocked waiting on a project file. Resolve it and write
      // the answer into the shared channel, which unblocks it.
      case 'readVfsFile':
        this._serveVfsRead();
        break;

      // Run custom config button callback from the worker instance.
      // This event will be triggered after a custom config button's command has
      // been executed.
      case 'runSnippetCallback':
        this.handlers.onRunSnippetDone();
        break;

      case 'restartWorker':
        this.restart();
        break;

      case 'runUserCodeCallback':
        // Run user code callback invoked from the worker instance. This event
        // will be triggered after excecuting the user's code.
        this.isRunningCode = false;
        this._clearFileCache();
        this.handlers.onRunEnded();
        break;

      case 'newOrModifiedFilesCallback':
        // Any files created or changed in the worker FS are propagated to VFS
        this.handlers.onNewOrModifiedFiles(event.data.newOrModifiedFiles);
        break;

      case 'deletedFilesCallback':
        this.handlers.onDeletedFiles(event.data.deletedPaths);
        break;

      default:
        // Custom messages a worker may post that the core does not recognise
        // (e.g. a plugin language's draw commands). Forwarded verbatim, tagged
        // with the plugin that owns this language, so the app can route it to
        // that plugin without the transport layer knowing its shape.
        this.handlers.onWorkerMessage?.(event.data, this.getLangOwner(this.proglang));
        break;
    }
  }
}

/**
 * Normalise file content to bytes. Text is encoded as UTF-8; the channel is
 * byte-oriented, so nothing may be passed through as a JS string.
 *
 * @param {string|ArrayBuffer|Uint8Array} content
 * @returns {Uint8Array}
 */
function toBytes(content) {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  return new TextEncoder().encode(String(content ?? ''));
}

/**
 * Map a file-resolution failure onto a channel status code.
 *
 * @param {Error} err
 * @returns {number} One of the STATUS_* values.
 */
function fileErrorStatus(err) {
  if (err instanceof FileNotFoundError) return STATUS_NOT_FOUND;
  if (err instanceof FileTooLargeError) return STATUS_TOO_LARGE;
  console.error('Unexpected error reading a file for the worker:', err);
  return STATUS_INTERNAL;
}
