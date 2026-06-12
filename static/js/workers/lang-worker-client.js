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
   * The current programming language that is being used.
   * @type {string}
   */
  _proglang = null;

  /**
   * The previous programming language that was used.
   * @type {string}
   */
  _prevProglang = null;

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
   * onRunEnded, onTerminate, onNewOrModifiedFiles, onDeletedFiles.
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
      if (this.worker) {
        this.terminate();
      }
      return;
    }

    if (!this.worker) {
      // No worker yet: spawn one.
      this.proglang = proglang;
      this._createWorker();
    } else if (this.proglang !== proglang) {
      // Worker running for a different language: restart with the new one.
      this.proglang = proglang;
      this.restart();
    }
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

  set proglang(newLang) {
    this._prevProglang = this.proglang;
    this._proglang = newLang;
  }

  get proglang() {
    return this._proglang;
  }

  /**
   * Terminate the existing worker process and delegate the terminal/UI cleanup
   * (cursor, user input, terminate message) to the app.
   *
   * @param {boolean} [showTerminateMsg] - Print a message in the terminal
   * indicating the current worker process has been terminated.
   */
  terminate(showTerminateMsg) {
    // Safe to call when idle: nothing to tear down without an active worker.
    if (!this.worker) {
      return;
    }

    console.log(`Terminating existing ${this._prevProglang || this.proglang} worker`);

    this.isRunningCode = false;
    this.isReady = false;
    this.worker.terminate();
    this.worker = null;
    this.handlers.onRunEnded();
    this.handlers.onTerminate(showTerminateMsg);
  }

  /**
   * Creates a new worker process and terminates the existing worker if needed.
   *
   * @param {boolean} [showTerminateMsg] - Print a message in the terminal
   * indicating the current worker process has been terminated.
   */
  _createWorker(showTerminateMsg) {
    this.isReady = false;

    if (this.worker) {
      this.terminate(showTerminateMsg);
    }

    console.log(`Spawning new ${this.proglang} worker`);

    this.worker = new Worker(this.getWorkerPath(this._proglang), { type: 'module' });
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

    return `static/js/workers/${name}.worker.js`;
  }

  /**
   * Terminate the code that is being run by the user. Useful when e.g. an
   * infinite loop is detected. This process terminates the existing worker and
   * create a complete new instance.
   *
   * @param {boolean} [showTerminateMsg] - Print a message in the terminal
   * indicating the current worker process has been terminated.
   */
  restart(showTerminateMsg) {
    this._createWorker(showTerminateMsg);
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
        this.restart(false);
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
