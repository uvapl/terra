import { IS_IDE } from './constants.js';
import { checkForStopCodeButton, getActiveEditor, getAllEditorFiles } from './helpers/editor-component.js';
import { getFileExtension, hasLFSApi, uuidv4 } from './helpers/shared.js'
import { createLangWorkerApi } from './lang-worker-api.js';
import Terra from './terra.js';
import VFS from './vfs.js';

/**
 * Base class that is extended for each of the apps.
 */
export default class App {
  /**
   * Reference to the GoldenLayout instance.
   * @type {GoldenLayout.Layout}
   */
  layout = null;

  constructor() {
    this._bindThis();
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
   * Other apps that extend this class are expected to implement this.
   * This function can be either async or not.
   */
  async setupLayout() {
    console.info('setupLayout() not implemented');
  }

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

    this.layout.addEventListener('onRunCodeButtonClick', this.onRunCodeButtonClick);

    // Listen for editor events being emitted.
    const editorEvents = [
      'onEditorStartEditing',
      'onEditorStopEditing',
      'onEditorShow',
      'onVFSChanged',
    ];

    editorEvents.forEach((eventName) => {
      this.layout.addEventListener(eventName, (event) => {
        const { editorComponent } = event.detail;
        this[eventName](editorComponent);
      });
    });
  }

  /**
   * Callback when the user clicks on the run-code button in the UI.
   */
  onRunCodeButtonClick() {
    this.runCode();
  }

  /**
   * Callback function for when the editor starts editing.
   *
   * This is default functionality and super.onEditorStartEditing() must be
   * called first in child classes before any additional functionality.
   *
   * @param {EditorComponent} editorComponent - The editor component instance.
   */
  onEditorStartEditing(editorComponent) {
    const { fileId } = editorComponent.getState();
    if (fileId) {
      VFS.updateFile(fileId, {
        content: editorComponent.getContent(),
      });
    }
  }

  /**
   * Callback function when an editor instance becomes visible/active.
   *
   * This is default functionality and super.onEditorShow() must be
   * called first in child classes before any additional functionality.
   *
   * @param {EditorComponent} editorComponent - The editor component instance.
   */
  onEditorShow(editorComponent) {
    // If we ran into a layout state from localStorage that doesn't have
    // a file ID, or the file ID is not the same, then we should sync the
    // filesystem ID with this tab state's file ID. We can only do this for
    // non-IDE versions, because the ID always uses IDs properly and can have
    // multiple filenames. It can be assumed that both the exam and iframe will
    // not have duplicate filenames.
    if (!IS_IDE) {
      const filename = editorComponent.getFilename();
      const file = VFS.findFileWhere({ name: filename });
      const { fileId } = editorComponent.getState();
      if (!fileId || (file && fileId !== file.id)) {
        editorComponent.extendState({ fileId: file.id });
      }
    }

    if (editorComponent.ready) {
      createLangWorkerApi(editorComponent.proglang);
    }

    this.setEditorFileContent(editorComponent);
  }


  /**
   * Invoked after each LFS polling where each editor instance gets notified
   * that the VFS content has been changed, which requires to reload the file
   * content from the vfs.
   *
   * @param {EditorComponent} editorComponent - The editor component instance.
   */
  onVFSChanged(editorComponent) {
    if (!Terra.v.blockLFSPolling) {
      this.setEditorFileContent(editorComponent);
    }
  }

  /**
   * Reload the file content either from VFS or LFS.
   *
   * @param {EditorComponent} editorComponent - The editor component instance.
   */
  setEditorFileContent(editorComponent) {
    const file = VFS.findFileById(editorComponent.getState().fileId);
    if (!file) return;

    editorComponent.setContent(file.content);
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
        fileId: uuidv4(),
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
   * @param {string} [id] - The ID of the file to run.
   * @param {boolean} [clearTerm=false] Whether to clear the terminal before
   * printing the output.
   */
  async runCode(fileId = null, clearTerm = false) {
    if (clearTerm) Terra.app.layout.term.reset();

    // TODO: maybe do if (!Terra.langWorkerApi.isReady) { ... } else { ... }
    if (Terra.langWorkerApi) {
      if (!Terra.langWorkerApi.isReady) {
        // Worker API is busy, wait for it to be done.
        return;
      } else if (Terra.langWorkerApi.isRunningCode) {
        // Terminate worker in cases of infinite loops.
        return Terra.langWorkerApi.restart(true);
      }
    }

    $('#run-code').prop('disabled', true);

    let filename = null;
    let files = null;

    if (fileId) {
      // Run given file id.
      const file = VFS.findFileById(fileId);
      filename = file.name;
      files = [file];

      if (!file.content && hasLFSApi() && LFS.loaded) {
        const content = await LFS.getFileContent(file.id);
        files = [{ ...file, content }];
      }
    } else {
      const tab = getActiveEditor();
      fileId = tab.container.getState().fileId;
      filename = tab.config.title;
      files = await getAllEditorFiles();
    }

    // Create a new worker instance if needed.
    const proglang = getFileExtension(filename);
    createLangWorkerApi(proglang);

    // Get file args, if any.
    const args = this.getCurrentFileArgs(fileId);

    // Wait for the worker to be ready before running the code.
    if (Terra.langWorkerApi && !Terra.langWorkerApi.isReady) {
      const runFileIntervalId = setInterval(() => {
        if (Terra.langWorkerApi && Terra.langWorkerApi.isReady) {
          Terra.langWorkerApi.runUserCode(filename, files, args);
          checkForStopCodeButton();
          clearInterval(runFileIntervalId);
        }
      }, 200);
    } else if (Terra.langWorkerApi) {
      // If the worker is ready, run the code immediately.
      Terra.langWorkerApi.runUserCode(filename, files, args);
      checkForStopCodeButton();
    }
  }

  /**
   * Get the arguments for the current file.
   * This is executed just before the user runs the code from an editor.
   * By default this returns an empty array if not implemented in child classes.
   *
   * @param {string} FileId - The ID of the file to get the arguments for.
   * @returns {array} The arguments for the current file.
   */
  getCurrentFileArgs(fileId) {
    return [];
  }
}
