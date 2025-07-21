import { getFileExtension } from './helpers/shared.js'
import LangWorker from './lang-worker.js';
import Terra from './terra.js';
import VirtualFileSystem from './vfs.js';

/**
 * Base class that is extended for each of the apps.
 */
export default class App {
  /**
   * Reference to the GoldenLayout instance.
   * @type {GoldenLayout.Layout}
   */
  layout = null;

  /**
   * Reference to the current programming language worker.
   * @type {LangWorker}
   */
  langWorker = null;

  /**
   * Reference to the Virtual File System (VFS) instance.
   * @type {VirtualFileSystem}
   */
  vfs = null;

  constructor() {
    this._bindThis();

    this.vfs = new VirtualFileSystem();
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
   * Add event listeners to the layout instance.
   */
  registerLayoutEvents() {
    // We register the postSetupLayout as a callback, which will be called when
    // the subsequent init() function has finished.
    this.layout.on('initialised', this.postSetupLayout);

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
    await this.vfs.updateFileContent(path, editorComponent.getContent());
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
    if (!Terra.v.blockLFSPolling) {
      await this.setEditorFileContent(editorComponent, true);
    }
  }

  onImageShow(imageComponent) {
    this.terminateLangWorker();
    this.setImageFileContent(imageComponent);
  }

  onImageVFSChanged(imageComponent) {
    if (!Terra.v.blockLFSPolling) {
      this.setImageFileContent(imageComponent);
    }
  }


  /**
   * Reload the file content either from VFS or LFS.
   *
   * @async
   * @param {EditorComponent} editorComponent - The editor component instance.
   */
  async setEditorFileContent(editorComponent) {
    const path = editorComponent.getPath();
    if (path) {
      const content = await this.vfs.getFileContentByPath(path);
      editorComponent.setContent(content);
    }
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
   * the current active tab name. If the `fileId` is set, then solely that file
   * will be run.
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

    if (this.langWorker) {
      if (!this.langWorker.isReady) {
        // Worker API is busy, wait for it to be done.
        return;
      } else if (this.langWorker.isRunningCode) {
        // Terminate worker in cases of infinite loops.
        return this.langWorker.restart(true);
      }
    }

    // When reaching this part, we actually run the code in the active editor.

    // Focus the terminal, such that the user can immediately invoke ctrl+c.
    this.layout.term.focus();

    $('#run-code').prop('disabled', true);

    // Run a given file path, or otherwise the active file.
    const filepath = options.filepath || this.layout.getActiveEditor().getPath();
    let files = await this.getAllEditorFiles();

    // Append hidden files if present.
    files = files.concat(this.getHiddenFiles());

    // Create a new worker instance if needed.
    const proglang = getFileExtension(filepath);
    this.createLangWorker(proglang);

    // Build args send to the worker's runUserCode function.
    const runUserCodeArgs = [filepath, files];

    const runAsConfig = this.getRunAsConfig();
    if (options.runAs && runAsConfig) {
      runUserCodeArgs.push(runAsConfig);
    }

    // Wait for the worker to be ready before running the code.
    if (this.langWorker && !this.langWorker.isReady) {
      const runFileIntervalId = setInterval(() => {
        if (this.langWorker && this.langWorker.isReady) {
          this.langWorker.runUserCode(...runUserCodeArgs);
          this.layout.checkForStopCodeButton();
          clearInterval(runFileIntervalId);
        }
      }, 200);
    } else if (this.langWorker) {
      // If the worker is ready, run the code immediately.
      this.langWorker.runUserCode(...runUserCodeArgs);
      this.layout.checkForStopCodeButton();
    }
  }

  handleControlC(event) {
    if (event.key === 'c' && event.ctrlKey && this.langWorker && this.langWorker.isRunningCode) {
      this.langWorker.restart(true);
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
    $button.prop('disabled', true);

    const activeTabName = this.layout.getActiveEditor().getFilename();
    let files = await this.getAllEditorFiles();
    files = files.concat(this.getHiddenFiles());

    if (this.langWorker && this.langWorker.isReady) {
      this.langWorker.runButtonCommand(selector, activeTabName, cmd, files);
    }
  }

  /**
   * Create a new worker instance if none exists already. The existing instance
   * will be terminated and restarted if necessary.
   *
   * @param {string} proglang - The proglang to spawn the related worker for.
   */
  createLangWorker(proglang) {
    // Situation 1: no worker, thus spawn a new one.
    if (!this.langWorker && LangWorker.hasWorker(proglang)) {
      this.langWorker = new LangWorker(proglang);
    } else if (this.langWorker && this.langWorker.proglang !== proglang) {
      this.langWorker.proglang = proglang;

      // Situation 2: existing worker but new proglang is invalid.
      if (!LangWorker.hasWorker(proglang)) {
        this.terminateLangWorker();
      } else {
        // Situation 3: existing worker and new proglang is valid.
        this.langWorker.restart();
      }
    }
  }

  /**
  * Terminate the current language worker if it exists.
   */
  terminateLangWorker() {
    if (this.langWorker) {
      this.langWorker.terminate();
      this.langWorker = null;
    }
  }

  /**
   * Gathers all files from the VFS.
   *
   * @async
   * @param {string} [folderpath=''] - The folder path to start searching from.
   * @returns {Promise<object[]>} List of objects, each containing the filepath
   * and content of the corresponding file.
   */
  async getAllEditorFiles(folderpath = '') {
    let files = [];

    const subfiles = await this.vfs.findFilesInFolder(folderpath);
    for (const file of subfiles) {
      const subfilepath = folderpath ? `${folderpath}/${file.name}` : file.name;
      const content = await this.vfs.getFileContentByPath(subfilepath);
      files.push({
        path: subfilepath,
        content: content,
      });
    }

    const subfolders = await this.vfs.findFoldersInFolder(folderpath);
    for (const folder of subfolders) {
      const subfolderpath = folderpath ? `${folderpath}/${folder.name}` : folder.name;
      const subfiles = await this.getAllEditorFiles(subfolderpath);
      files = files.concat(subfiles);
    }

    return files;
  }

  /**
   * Clear the terminal's write buffer.
   */
  termClearWriteBuffer() {
    this.layout.term.clearTermWriteBuffer();
  }

  /**
   * Write a message to the terminal without newline character.
   *
   * @param {string} msg - The message to write.
   */
  termWrite(msg) {
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
    this.layout.term.disposeUserInput();
  }

  /**
   * Hide the cursor of the terminal.
   */
  termHideTermCursor() {
    this.layout.term.hideTermCursor();
  }

  /**
   * Clear the terminal's content.
   */
  termClear() {
    this.layout.term.clear();
  }

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
