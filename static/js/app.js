import { getFileExtension, isImageExtension, isObject } from './helpers/shared.js'
import LangWorkerClient from './workers/lang-worker-client.js';
import Terra from './terra.js';
import * as fileTreeManager from './file-tree-manager.js';
import VirtualFileSystem, { FileNotFoundError, FileTooLargeError } from './fs/vfs.js';
import Layout from './layout/layout.js';
import { MAX_FILE_SIZE } from './constants.js';

/**
 * Base class that is extended for each of the apps.
 */
export default class App {
  /**
   * Reference to the GoldenLayout instance.
   * @type {Layout}
   */
  layout = null;

  /**
   * Reference to the current language worker client.
   * @type {LangWorkerClient}
   */
  langWorkerClient = null;

  /**
   * Reference to the Virtual File System (VFS) instance.
   * @type {VirtualFileSystem}
   */
  vfs = null;

  constructor() {
    this._bindThis();

    this.vfs = new VirtualFileSystem();

    // The language worker client persists for the lifetime of the app; it only
    // spawns a worker thread on demand once a supported language is loaded.
    this.langWorkerClient = new LangWorkerClient(this.getLangWorkerHandlers());
  }

  /**
   * Bind all functions to the current instance of the class.
   */
  _bindThis() {
    const functionNames = [];

    let proto = Object.getPrototypeOf(this);
    while (proto && proto !== Object.prototype) {
      Object.getOwnPropertyNames(proto).forEach((fn) => {
        if (functionNames.indexOf(fn) === -1 && typeof this[fn] === 'function' && fn !== 'constructor') {
          functionNames.push(fn);
        }
      });

      // Move up the prototype chain
      proto = Object.getPrototypeOf(proto);
    }

    functionNames.forEach((fn) => {
      this[fn] = this[fn].bind(this);
    });
  }

  /**
   * The initialisation function that is called when the app is loaded. This is
   * explicitely invoked inside the main.<app-type>.js files rather than the
   * constructor to ensure that the app is properly loaded before it is used.
   */
  async init() {
    // Await the setupLayout because some apps might need to do async work.
    await this.setupLayout();

    // We register the postSetupLayout as a callback, which will be called when
    // the subsequent init() function has finished. This is only done once: a
    // replacement layout (e.g. after a reset) must not re-run postSetupLayout.
    this.layout.on('initialised', this.postSetupLayout);

    this.registerLayoutEvents();
    this.layout.init();
  }

  /**
   * Child classes that extend this class are expected to implement this.
   * This function can be async.
   */
  async setupLayout() {
    console.info('setupLayout() not implemented');
  }

  /**
   * Child classes that extend this class are expected to implement this.
   */
  postSetupLayout() {
    console.info('postSetupLayout() not implemented');
  }

  /**
   * Add event listeners to the layout instance. This must be called again
   * whenever the layout instance is replaced (e.g. after a layout reset),
   * because the listeners are attached to the instance itself.
   */
  registerLayoutEvents() {
    this.layout.addEventListener('runCode', this.onRunCode);

    // Listen for editor events being emitted.
    const editorEvents = [
      'onEditorStartEditing',
      'onEditorStopEditing',
      'onEditorChange',
      'onEditorShow',
      'onEditorVFSChanged',
      'onImageShow',
      'onImageVFSChanged',
    ];

    editorEvents.forEach((eventName) => {
      this.layout.addEventListener(eventName, async (event) => {
        const { tabComponent } = event.detail;
        if (typeof this[eventName] === 'function') {
          this[eventName](tabComponent);
        }
      });
    });

    // Once the layout (and thus its run button) has rendered, spawn the worker
    // for the initially active tab's language and set the run button to match.
    // The editor 'show' events fire before the run button exists, so this has to
    // be (re)applied here rather than relying on those events alone.
    this.layout.on('initialised', () => {
      const activeEditor = this.getActiveEditor();
      const filename = activeEditor ? activeEditor.getFilename() : null;
      this.createLangWorker(getFileExtension(filename));
      this.updateRunButtonState(filename);
    });
  }

  /**
   * Callback when the user clicks on the run-code button in the UI.
   *
   * @param {Event} event - The event object.
   */
  onRunCode(event) {
    const { clearTerm } = event.detail;
    this.runCode({ clearTerm });
  }

  /**
   * Callback function for when the content has changed of an editor.
   *
   * This is default functionality and super.onEditorChange() must be
   * called first in child classes before any additional functionality.
   *
   * @async
   * @param {EditorComponent} editorComponent - The editor component instance.
   */
  async onEditorChange(editorComponent) {
    const path = editorComponent.getPath();
    await this.vfs.updateFile(path, editorComponent.getContent());
  }

  /**
   * Callback function when an editor instance becomes visible/active.
   *
   * This is default functionality and super.onEditorShow() must be
   * called first in child classes before any additional functionality.
   *
   * @param {EditorComponent} editorComponent - The editor component instance.
   */
  async onEditorShow(editorComponent) {
    if (editorComponent.ready) {
      this.createLangWorker(editorComponent.proglang);
    }

    this.updateRunButtonState(editorComponent.getFilename());

    await this.setEditorFileContent(editorComponent);
  }


  /**
   * Invoked after each LFS polling where each editor instance gets notified
   * that the VFS content has been changed, which requires to reload the file
   * content from the vfs.
   *
   * @param {EditorComponent} editorComponent - The editor component instance.
   */
  async onEditorVFSChanged(editorComponent) {
    if (!Terra.v.blockFSPolling) {
      await this.setEditorFileContent(editorComponent, true);
    }
  }

  onImageShow(imageComponent) {
    this.terminateLangWorker();
    this.updateRunButtonState(null);
    this.setImageFileContent(imageComponent);
  }

  onImageVFSChanged(imageComponent) {
    if (!Terra.v.blockFSPolling) {
      this.setImageFileContent(imageComponent);
    }
  }

  async setImageFileContent(imageComponent) {
    const filepath = imageComponent.getPath();
    if (!filepath) return;

    try {
      await this.vfs.readFile(filepath, MAX_FILE_SIZE);
      const link = await this.vfs.getFileURL(filepath);
      imageComponent.setSrc(link);
    } catch (err) {
      if (err instanceof FileTooLargeError) {
        imageComponent.exceededFileSize();
      } else if (err instanceof FileNotFoundError) {
        console.warn('Editor file disappeared:', err.path);
      } else {
        console.error('Unexpected error reading file:', err);
      }
    }
  }


  /**
   * Reload the file content from VFS.
   *
   * @async
   * @param {EditorComponent} editorComponent - The editor component instance.
   */
  async setEditorFileContent(editorComponent) {
    const path = editorComponent.getPath();
    if (!path) return;

    const content = await this.vfs.readFile(path);
    editorComponent.setContent(content);
  }

  /**
   * Create a list of content objects based on the tabs config data.
   *
   * @param {object} tabs - An object where each key is the filename and the
   * value is the default value the editor should have when the file is opened.
   * @param {number} fontSize - The default font-size used for the content.
   * @returns {array} List of content objects.
   */
  generateConfigContent(tabs, fontSize) {
    return Object.keys(tabs).map((filename) => ({
      type: 'component',
      componentName: 'editor',
      componentState: {
        fontSize,
        value: tabs[filename],
        path: filename,
      },
      title: filename,
      isClosable: false,
    }));
  }

  /**
   * Runs the code inside the worker by sending all files to the worker along with
   * the current active tab name. If the `options.filepath` is set, then solely
   * that file will be run.
   *
   * @async
   * @param {object} options - Options for running the code.
   * @param {string} options.filepath - Run a specific file.
   * @param {boolean} options.clearTerm Whether to clear the terminal before
   * printing the output.
   * @param {boolean} options.runAs - Whether the runAs config should be used.
   */
  async runCode(options = {}) {
    if (options.clearTerm) this.layout.term.clear();

    if (this.langWorkerClient.isRunningCode) {
      // Act as stop button: abort the running program (e.g. an infinite loop).
      return this.stopRunningProgramManually();
    }

    // Focus the terminal, such that the user can immediately invoke ctrl+c.
    this.layout.term.focus();

    $('.lm_header .run-user-code-btn, .lm_header .config-btn').prop('disabled', true);

    // Run a given file path, or otherwise the active file.
    const filepath = options.filepath || this.layout.getActiveEditor().getPath();
    let files = await this.vfs.getAllFiles();

    // Append hidden files if present.
    files = files.concat(this.getHiddenFiles());

    // Create a new worker instance if needed.
    const proglang = getFileExtension(filepath);
    this.createLangWorker(proglang);

    // Build args to send to the worker's runUserCode function.
    const runUserCodeArgs = [filepath, files];

    const runAsConfig = this.getRunAsConfig();
    if (options.runAs && runAsConfig) {
      runUserCodeArgs.push(runAsConfig);
    }

    const run = () => {
      this.langWorkerClient.runUserCode(...runUserCodeArgs);
      this.layout.checkForStopCodeButton();
    };

    if (this.langWorkerClient.hasActiveWorker() && !this.langWorkerClient.isReady) {
      // Worker is still loading — queue the command to run once it's ready.
      this.langWorkerClient.pendingCommand = run;
      $('.lm_header .worker-loading-label').show();
    } else if (this.langWorkerClient.hasActiveWorker()) {
      run();
    }
  }

  handleControlC(event) {
    if (event.key === 'c' && event.ctrlKey && this.langWorkerClient.isRunningCode) {
      this.stopRunningProgramManually();
    }
  }

  /**
   * Get the config object for the run-as button.
   * This is executed just before the user runs the code from an editor.
   * By default this returns null if not implemented in child classes.
   *
   * @returns {null|object} The config object if implemented.
   */
  getRunAsConfig() {
    return null;
  }

  /**
   * Get the hidden files that should be passed to the worker, but are not
   * displayed as visual tabs inside the UI for the user.
   *
   * @returns {array} List of (hidden) files.
   */
  getHiddenFiles() {
    return [];
  }

  /**
   * Run the command of a custom config button.
   *
   * @param {string} selector - Unique selector for the button, used to disable
   * it when running and disable it when it's done running.
   * @param {array} cmd - List of commands to execute.
   */
  async runButtonCommand(selector, cmd) {
    const $button = $(selector);
    if ($button.prop('disabled')) return;
    $('.lm_header .run-user-code-btn, .lm_header .config-btn').prop('disabled', true);

    this.layout.term.clear();

    const activeTabName = this.layout.getActiveEditor().getFilename();
    let files = await this.vfs.getAllFiles();
    files = files.concat(this.getHiddenFiles());

    const run = () => this.langWorkerClient.runButtonCommand(selector, activeTabName, cmd, files);

    if (this.langWorkerClient.hasActiveWorker() && !this.langWorkerClient.isReady) {
      // Worker is still loading — queue the command to run once it's ready.
      this.langWorkerClient.pendingCommand = run;
      $('.lm_header .worker-loading-label').show();
    } else if (this.langWorkerClient.isReady) {
      run();
    }
  }

  /**
   * Create a new language worker client if none exists already. The existing
   * client will be terminated and restarted if necessary. This is the single
   * place where a client is constructed, so its handlers are always wired.
   *
   * @param {string} proglang - The proglang to spawn the related worker for.
   */
  createLangWorker(proglang) {
    this.langWorkerClient.load(proglang);

    if (!this.langWorkerClient.hasActiveWorker()) {
      $('.lm_header .worker-loading-label').hide();
    }
  }

  /**
   * Build the app-side reaction callbacks handed to a language worker client.
   * The client is pure transport and delegates every DOM/VFS/terminal reaction
   * to these handlers. All methods are already bound to `this` via _bindThis().
   *
   * @returns {object} The handlers object.
   */
  getLangWorkerHandlers() {
    return {
      onReady: this.onWorkerReady,
      onWrite: this.onWorkerWrite,
      onWriteError: this.onWorkerWriteError,
      onRequestStdin: this.termWaitForInput,
      onRunButtonCommandDone: this.onWorkerRunButtonCommandDone,
      onRunEnded: this.onRunEnded,
      onNewOrModifiedFiles: this.onWorkerNewOrModifiedFiles,
      onDeletedFiles: this.onWorkerDeletedFiles,
    };
  }

  /**
  * Terminate the current language worker if it exists.
   */
  terminateLangWorker() {
    if (this.langWorkerClient.hasActiveWorker()) {
      this.langWorkerClient.terminate();
    }
    $('.lm_header .worker-loading-label').hide();
  }

  /**
   * Enable the run button only when the given file's language has a worker;
   * disable it otherwise (e.g. plain text, an image, or an Untitled file).
   * Called whenever the active tab changes.
   *
   * @param {string|null} filename - The active tab's filename, or null when the
   * active tab is not a runnable editor (e.g. an image).
   */
  updateRunButtonState(filename) {
    const canRun = this.langWorkerClient.supports(getFileExtension(filename));
    $('.lm_header .run-user-code-btn, .lm_header .config-btn').prop('disabled', !canRun);
  }

  /**
   * Worker handler: the worker has finished initialising and is ready to run.
   * Re-enable the worker UI buttons unless a queued command is about to run.
   *
   * @param {boolean} hasPendingCommand - Whether a queued command will run now.
   */
  onWorkerReady(hasPendingCommand) {
    $('.lm_header .worker-loading-label').hide();

    if (!hasPendingCommand) {
      $('.lm_header .run-user-code-btn').prop('disabled', false);
      $('.lm_header .clear-term-btn').prop('disabled', false);
      $('.lm_header .config-btn').prop('disabled', false);
    }
  }

  /**
   * Worker handler: write a message produced by the worker to the terminal.
   *
   * @param {string} text - The message to write.
   */
  onWorkerWrite(text) {
    try {
      this.termWrite(text);
    } catch (e) {
      console.log("Caught write error on the terminal - clearing buffer;")
      console.log(e)
      this.termClearWriteBuffer();
    }
  }

  /**
   * Worker handler: write an error message produced by the worker in red.
   *
   * @param {string} text - The error message to write.
   */
  onWorkerWriteError(text) {
    this.termWrite(`\x1b[1;31m${text}\x1b[0m`);
  }

  /**
   * Worker handler: a custom config button's command has finished executing.
   */
  onWorkerRunButtonCommandDone() {
    $('.lm_header .run-user-code-btn, .lm_header .config-btn').prop('disabled', false);
  }

  /**
   * Stop the program the user is currently running: restart the worker so the
   * next run starts fresh, then clear any pending output and print a termination
   * notice. The restart triggers onRunEnded, which resets the UI and terminal.
   */
  stopRunningProgramManually() {
    this.langWorkerClient.restart();
    this.termClearWriteBuffer();
    this.termWriteln('\x1b[1;31mProcess terminated\x1b[0m');
  }

  /**
   * Worker handler: files were created or modified in the worker's internal
   * filesystem during execution. Reflect the changes in the VFS, open tabs and
   * the file tree.
   *
   * @async
   * @param {array} newOrModifiedFiles - List of file objects.
   */
  async onWorkerNewOrModifiedFiles(newOrModifiedFiles) {
    if (!Array.isArray(newOrModifiedFiles)) {
      return;
    }

    for (const file of newOrModifiedFiles) {
      // Check if the file already exists in the VFS.
      if ((await this.vfs.pathExists(file.path))) {
        // If the file already exists, update its content.
        await this.vfs.updateFile(file.path, file.content);

        // Check if there's an open tab for this file.
        const tabComponent = this.getTabComponents().find((component) => {
          const path = component.getPath();
          return path == file.path;
        });

        // If so, update its content.
        if (tabComponent) {
          tabComponent.setContent(file.content);
        }
      } else {
        // Otherwise, create a new file in the VFS.
        await this.vfs.createFile(
          file.path,
          file.content,
        );

        // Automatically open new image files in a tab.
        if (isImageExtension(file.path)) {
          this.layout.addFileTab(file.path);
        }
      }

      // Recreate the file tree.
      await fileTreeManager.createFileTree();
    }
  }

  /**
   * Worker handler: files were deleted from the worker's internal filesystem
   * during execution. Remove them from the VFS and close any open tabs.
   *
   * @async
   * @param {string[]} deletedPaths - List of file paths that were deleted.
   */
  async onWorkerDeletedFiles(deletedPaths) {
    if (!Array.isArray(deletedPaths)) {
      return;
    }

    for (const path of deletedPaths) {
      await this.vfs.deleteFile(path, false);

      const tabComponent = this.getTabComponents().find(
        (component) => component.getPath() === path
      );
      if (tabComponent) {
        tabComponent.close();
      }
    }
  }

  /**
   * Worker handler: the user's code has finished running or was aborted. Reset
   * the run/stop button and clean up the terminal. Safe on normal completion
   * too: there is nothing pending to dispose and the cursor is already hidden.
   */
  onRunEnded() {
    // Only disable the button again if the current tab has a worker, because
    // users can still run code through the contextmenu in the file-tree in the
    // IDE app.
    const activeEditor = this.getActiveEditor();
    const disableRunBtn =
      !activeEditor ||
      !this.langWorkerClient.supports(getFileExtension(activeEditor.getFilename()));

    // Print inverted `%` to terminal if last line of output was not terminated by a `\n`.
    this.termForgotNewlinePercent();

    // Dispose any pending stdin prompt left by an aborted run and hide the cursor.
    this.termDisposeUserInput();
    this.termHideTermCursor();

    // Set focus to the active editor.
    this.getActiveEditor().focus();

    this.layout.onRunEnded({ disableRunBtn });
  }

  /***** Terminal Management ********************************************/

  lastWriteNotTerminated = false;

  /**
   * Clear the terminal's write buffer.
   */
  termClearWriteBuffer() {
    this.layout.term?.clearTermWriteBuffer();
  }

  /**
   * Write a message to the terminal without newline character.
   *
   * @param {string} msg - The message to write.
   */
  termWrite(msg) {
    this.lastWriteNotTerminated = typeof msg !== "string" || !msg.endsWith("\n");
    this.layout.term.write(msg);
  }

  /**
   * Write a message to the terminal with newline character.
   *
   * @param {string} msg - The message to write.
   */
  termWriteln(msg) {
    this.layout.term.writeln(msg);
  }

  /**
   * Enable the terminal input for the user and wait until they press ENTER and
   * process the typed input.
   *
   * @returns {Promise<string>} The user's input.
   */
  termWaitForInput() {
    return this.layout.term.waitForInput()
  }

  /**
   * Dispose the terminal user input, which means that the terminal will no
   * longer wait for user input and will not process any further input.
   */
  termDisposeUserInput() {
    this.layout.term?.disposeUserInput();
  }

  /**
   * Hide the cursor of the terminal.
   */
  termHideTermCursor() {
    this.layout.term?.hideTermCursor();
  }

  /**
   * Print inverted `%` to terminal if last line of output was not
   * terminated by a `\n`.
   */
  termForgotNewlinePercent() {
    if (this.lastWriteNotTerminated) {
      this.lastWriteNotTerminated = false;
      Terra.app.termWriteln("\x1b[7m%\x1b[0m");
    }
  }

  /**
   * Clear the terminal's content.
   */
  termClear() {
    this.layout.term.clear();
  }

  /***********************************************************************/

  /**
   * Get all tab components from the layout.
   *
   * @returns {TabComponent[]} List containing all open tab components.
   */
  getTabComponents() {
    return this.layout.getTabComponents();
  }

  /**
   * Get the active editor component from the layout.
   *
   * @returns {Editor} the active editor instance.
   */
  getActiveEditor() {
    return this.layout.getActiveEditor();
  }
}
