import { getFileExtension } from './helpers/shared.js';
import Terra from './terra.js';
import fileTreeManager from './file-tree-manager.js';


/**
 * List of supported programming languages that have a corresponding worker.
 * @type {string[]}
 */
const supportedLangs = ['c', 'py'];


/**
 * Bridge class between the main app and the currently loaded language worker.
 */
export default class LangWorker {
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

  constructor(proglang) {
    this.proglang = proglang;
    this._createWorker();
  }

  /**
   * Check whether a given proglang has a corresponding worker implementation.
   *
   * @param {string} proglang - The proglang to check for.
   * @returns {boolean} True if proglang is valid, false otherwise.
   */
  static hasWorker(proglang) {
    return supportedLangs.some((lang) => proglang === lang);
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
   * Terminate the existing worker process, hides term cursor and disposes any
   * active user input that is active.
   *
   * @param {boolean} [showTerminateMsg] - Print a message in the terminal
   * indicating the current worker process has been terminated.
   */
  terminate(showTerminateMsg) {
    console.log(`Terminating existing ${this._prevProglang || this.proglang} worker`);

    this.isRunningCode = false;
    this.worker.terminate();
    this.runUserCodeCallback();

    // Disable the button and wait for the worker to remove the disabled prop
    // once it has been loaded.
    $('#run-code').prop('disabled', true);

    Terra.app.termClearWriteBuffer();

    if (showTerminateMsg) {
      Terra.app.termWriteln('\x1b[1;31mProcess terminated\x1b[0m');
    }

    // Dispose any active user input.
    Terra.app.termDisposeUserInput();

    Terra.app.termHideTermCursor();
  }

  /**
   * Creates a new worker process and terminates the existing worker if needed.
   *
   * @param {boolean} [showTerminateMsg] - Print a message in the terminal
   * indicating the current worker process has been terminated.
   */
  _createWorker(showTerminateMsg) {
    this.isReady = false;

    $('#run-code').addClass('loading');

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
   * @param {string} activeTabName - The name of the currently active tab.
   * @param {array} files - List of objects, each containing the filename
   * and content of the corresponding editor tab.
   * @param {array} args - List of arguments to pass to the file.
   */
  runUserCode(activeTabName, files, args) {
    this.isRunningCode = true;

    this.port.postMessage({
      id: 'runUserCode',
      data: { activeTabName, files, args },
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
   * Callback function for when the user code has finished running or has been
   * terminated by the user.
   */
  runUserCodeCallback() {
    this.isRunningCode = false;

    // Only disable the button again if the current tab has a worker,
    // because users can still run code through the contextmenu in the
    // file-tree in the IDE app.
    const editorComponent = Terra.app.getActiveEditor();
    let disableRunBtn = false;
    if (editorComponent && !this.constructor.hasWorker(getFileExtension(editorComponent.getFilename()))) {
      disableRunBtn = true;
    }

    // Focus the active editor again.
    editorComponent.focus();

    // Change the stop-code button back to a run-code button.
    const $button = $('#run-code');
    const newText = $button.text().replace('Stop', 'Run');
    $button.text(newText)
      .prop('disabled', disableRunBtn)
      .addClass('primary-btn')
      .removeClass('danger-btn');

    if (Terra.v.showStopCodeButtonTimeoutId) {
      clearTimeout(Terra.v.showStopCodeButtonTimeoutId);
      Terra.v.showStopCodeButtonTimeoutId = null;
    }
  }

  /**
   * Called from within the worker when files have been added or modified in the
   * worker's internal filesystem during execution of the program.
   *
   * @param {array} newOrModifiedFiles - List of file objects.
   */
  newOrModifiedFilesCallback(newOrModifiedFiles) {
    if (!Array.isArray(newOrModifiedFiles)) {
      return;
    }

    for (const file of newOrModifiedFiles) {
      // Check if the file already exists in the VFS.
      const existingFile = Terra.app.vfs.findFileByPath(file.path);
      if (existingFile) {
        // If the file already exists, update its content.
        Terra.app.vfs.updateFile(existingFile.id, {
          content: file.content,
        });

        // Check if there's an open tab for this file.
        const tabComponent = Terra.app.getTabComponents().find((tabComponent) => {
          const { fileId } = tabComponent.getState();
          return fileId == existingFile.id;
        });

        // If so, update its content.
        if (tabComponent) {
          tabComponent.setContent(file.content);
        }
      } else {
        const parentFolderPath = file.path.split('/').slice(0, -1).join('/');
        const parentFolder = Terra.app.vfs.findFolderByPath(parentFolderPath);
        const parentId = parentFolder ? parentFolder.id : null;
        Terra.app.vfs.createFile({
          name: file.name,
          content: file.content,
          parentId,
        });
      }

      // Recreate the file tree.
      fileTreeManager.createFileTree();
    }
  }

  /**
   * Message event handler for the worker.
   *
   * @param {object} event - Event object coming from the UI.
   */
  onmessage(event) {
    switch (event.data.id) {

      // Ready callback from the worker instance. This will be run after
      // everything has been initialised and ready to run some code.
      case 'ready':
        this.isReady = true;
        $('.lm_header .run-user-code-btn').prop('disabled', false).removeClass('loading');
        $('.lm_header .clear-term-btn').prop('disabled', false);
        $('.lm_header .config-btn').prop('disabled', false);
        break;

      // Write callback from the worker instance. When the worker wants to write
      // code the terminal, this event will be triggered.
      case 'write':
        try {
          // Only write when the worker is ready. This prevents infinite loops
          // with print statements to continue printing after the worker has
          // terminated when the user has pressed the stop button.
          if (this.isReady) {
            Terra.app.termWrite(event.data.data);
          }
        } catch (e) {
          Terra.app.termClearWriteBuffer();
        }
        break;

      // Stdin callback from the worker instance. When the worker requests user
      // input, this event will be triggered. The user input will be requested
      // and sent back to the worker through the usage of shared memory.
      case 'readStdin':
        Terra.app.termWaitForInput().then((value) => {
          const view = new Uint8Array(this.sharedMem.buffer);
          for (let i = 0; i < value.length; i++) {
            // To the shared memory.
            view[i] = value.charCodeAt(i);
          }

          // Set the last byte to the null terminator.
          view[value.length] = 0;

          Atomics.notify(new Int32Array(this.sharedMem.buffer), 0);
        });
        break;

      // Run custom config button callback from the worker instance.
      // This event will be triggered after a custom config button's command has
      // been executed.
      case 'runButtonCommandCallback':
        $(event.data.selector).prop('disabled', false);
        break;

      case 'runUserCodeCallback':
        // Run user code callback invoked from the worker instance. This event
        // will be triggered after excecuting the user's code.
        this.runUserCodeCallback();
        break;

      case 'newOrModifiedFilesCallback':
        // New or modified files callback invoked from the worker instance. This
        // event will be triggered just before the run-user-code callback and
        // will only triggerer if there are new files created or existing files
        // have been modified during execution time.
        this.newOrModifiedFilesCallback(event.data.newOrModifiedFiles);
        break;
    }
  }
}
