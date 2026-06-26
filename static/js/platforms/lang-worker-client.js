/**
 * Registry mapping a programming language to its worker script and, for
 * plugin-provided languages, the plugin that owns it. Built-in languages are
 * registered here (owner `null`); plugins add more via registerLang(), which is
 * how a plugin-provided language (e.g. Karel) joins the same run pipeline as C
 * and Python without any other core change. The owner lets a worker's custom
 * messages be routed back to just that plugin instead of every plugin.
 * @type {Object<string, { path: string, owner: ?string }>}
 */
const workers = {
  c: { path: 'static/js/platforms/clang.worker.js', owner: null },
  py: { path: 'static/js/platforms/py.worker.js', owner: null },
};


/**
 * Main-thread client that fronts a language worker.
 *
 * This class is a pure transport layer: it owns the `Worker` instance and its
 * shared memory, posts commands to it, routes incoming messages, and manages the
 * worker lifecycle (spawn/terminate/restart). It has no knowledge of the DOM, the
 * app, or the VFS — all UI and app-side reactions are delegated to the handlers
 * object passed to the constructor.
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
   * The client is created once and persists for the lifetime of the app. It does
   * not spawn a worker until load() is called for a supported language.
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
   */
  registerLang(proglang, workerPath, owner = null) {
    workers[proglang] = { path: workerPath, owner };
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
   * Spawn, switch, or tear down the worker thread for a given language. This is
   * the single entry point the app uses to keep the worker in sync with the
   * active programming language.
   *
   * @param {string} proglang - The programming language to load a worker for.
   */
  load(proglang) {
    // Unsupported language: make sure no worker keeps running.
    if (!this.supports(proglang)) {
      this.terminate();
      return Promise.resolve();
    }

    // Switching languages: tear down the current worker first, while
    // this.proglang still names it (so terminate() logs the right one).
    if (this.worker && this.proglang !== proglang) {
      this.terminate();
    }

    // Worker already exists and is ready: resolve immediately.
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
   * Checks whether the browser enabled support for WebAssembly.Memory object
   * usage by trying to create a new SharedArrayBuffer object. This object can
   * only be created whenever both the Cross-Origin-Opener-Policy and
   * Cross-Origin-Embedder-Policy headers are set.
   *
   * @returns {boolean} True if browser supports shared memory, false otherwise.
   */
  hasSharedMemoryEnabled() {
    try {
      new SharedArrayBuffer(1024);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Terminate the active worker process. Safe to call when idle. If a program
   * was running when killed, the run-ended handler is invoked so the app can
   * reset its UI and clean up the terminal; a clean post-run restart (where the
   * run already reported completion) stays silent.
   */
  terminate() {
    const wasRunning = this.isRunningCode;
    this._destroyWorker();

    // Only when we abort a still-running program: a normal run already reported
    // its end via the 'runUserCodeCallback' message, so the Pyodide post-run
    // self-restart must not fire it again.
    if (wasRunning) {
      this.handlers.onRunEnded();
    }
  }

  /**
   * Pure transport teardown: kill the active worker and reset client state.
   * Safe to call when idle. Has no app/UI side effects — callers that need to
   * report the run as ended (terminate) or recreate the worker (restart) do so
   * themselves.
   */
  _destroyWorker() {
    // Safe to call when idle: nothing to tear down without an active worker.
    if (!this.worker) {
      return;
    }

    console.log(`Terminating existing ${this.proglang} worker`);

    this.isRunningCode = false;
    this.isReady = false;
    this._readyResolver = null;
    this._loadingPromise = null;
    this.worker.terminate();
    this.worker = null;
  }

  /**
   * Spawn a new worker process for the current proglang. Callers are responsible
   * for terminating any existing worker first (see load() and restart()).
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
    }

    this.worker.postMessage({
      id: 'constructor',
      data: constructorData,
    }, [remotePort]);
  }

  async runFile(proglang, filepath, files, runAsConfig) {
    this._runQueued = true;
    await this.load(proglang);
    this._runQueued = false;
    this.isRunningCode = true;
    this.handlers.onRunStarted();
    this.port.postMessage({
      id: 'runUserCode',
      data: { activeTabPath: filepath, vfsFiles: files, runAsConfig },
    });
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
        this.handlers.onRunEnded();
        break;

      case 'newOrModifiedFilesCallback':
        // New or modified files callback invoked from the worker instance. This
        // event will be triggered just before the run-user-code callback and
        // will only triggerer if there are new files created or existing files
        // have been modified during execution time.
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
