/**
 * List of supported programming languages that have a corresponding worker.
 * @type {string[]}
 */
const supportedLangs = ['c', 'py'];


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
   * A command to execute immediately once the worker signals ready.
   * Set when a button is clicked while the worker is still (re)loading.
   * @type {Function|null}
   */
  pendingCommand = null;

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
   * onReady, onWrite, onWriteError, onRequestStdin, onRunButtonCommandDone,
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
    return supportedLangs.some((lang) => proglang === lang);
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
    return !!this.pendingCommand;
  }

  /**
   * Spawn, switch, or tear down the worker thread for a given language. This is
   * the single entry point the app uses to keep the worker in sync with the
   * active programming language.
   *
   * @param {string} proglang - The programming language to load a worker for.
   */
  load(proglang, pendingCommand = null) {
    // Unsupported language: make sure no worker keeps running.
    if (!this.supports(proglang)) {
      this.terminate();
      return;
    }

    // Switching languages: tear down the current worker first, while
    // this.proglang still names it (so terminate() logs the right one).
    if (this.worker && this.proglang !== proglang) {
      this.terminate();
    }

    if (this.worker) {
      // Worker already exists for this proglang. Run the command now if it has
      // finished initialising, otherwise queue it so the 'ready' handler runs
      // it once the (re)loading worker signals ready.
      if (pendingCommand) {
        if (this.isReady) {
          pendingCommand();
        } else {
          this.pendingCommand = pendingCommand;
          this.handlers.onLoad(true);
        }
      }
      return;
    }

    this.pendingCommand = pendingCommand;
    this.handlers.onLoad(!!pendingCommand);
    this.proglang = proglang;
    this._createWorker();
  }

  start(proglang, filepath, files, runAsConfig) {
    this.load(proglang, () => this.runUserCode(filepath, files, runAsConfig));
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
    this.worker.terminate();
    this.worker = null;
  }

  /**
   * Spawn a new worker process for the current proglang. Callers are responsible
   * for terminating any existing worker first (see load() and restart()).
   */
  _createWorker() {
    this.isReady = false;

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

  /**
   * Triggers the `runUserCode` event in the currently active worker.
   *
   * @param {string} activeTabPath - The active tab's absolute file path.
   * @param {array} vfsFiles - List of objects, each containing the filename
   * and content of the corresponding editor tab.
   * @param {array} runAsConfig - Configuration object for the run-as command.
   */
  runUserCode(activeTabPath, vfsFiles, runAsConfig) {
    this.isRunningCode = true;

    // Single funnel for a user-code run (immediate or queued via pendingCommand),
    // so the app can flip the run button into a stop button from one place.
    this.handlers.onRunStarted();

    this.port.postMessage({
      id: 'runUserCode',
      data: { activeTabPath, vfsFiles, runAsConfig },
    });
  }

  /**
   * Triggers the `runButtonCommand` event in the currently active worker.
   *
   * @param {string} selector - Unique selector for the button, used to disable
   * it when running and disable it when it's done running.
   * @param {string} activeTabName - The name of the currently active tab.
   * @param {array} cmd - List of commands to execute.
   * @param {array} files - List of objects, each containing the filename and
   * content of the corresponding editor tab.
   */
  runButtonCommand(selector, activeTabName, cmd, files) {
    this.port.postMessage({
      id: 'runButtonCommand',
      data: { selector, activeTabName, cmd, files },
    });
  }

  /**
   * Get the path to the worker file given a programming language.
   *
   * @param {string} proglang - The programming language to get the worker path for.
   * @returns {string} Path to the worker file.
   */
  getWorkerPath(proglang) {
    let name = proglang;

    if (proglang === 'c') {
      name = 'clang';
    }

    return `static/js/platforms/${name}.worker.js`;
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
        const hasPendingCommand = !!this.pendingCommand;
        this.handlers.onReady(hasPendingCommand);
        if (hasPendingCommand) {
          const cmd = this.pendingCommand;
          this.pendingCommand = null;
          cmd();
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
      case 'runButtonCommandCallback':
        this.handlers.onRunButtonCommandDone();
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
    }
  }
}
