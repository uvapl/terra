import { IS_IDE } from './constants.js';
import { uuidv4 } from './helpers/shared.js'
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

    // Register the editor tab created callback *before* the layout is
    // initialized to ensure it is always called properly.
    this.layout.on('tabCreated', this.onEditorTabCreated);

    // We register the postSetupLayout as a callback, which will be called when
    // the subsequent init() function has finished.
    this.layout.on('initialised', this.postSetupLayout);

    // Start initializing the layout.
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
   * Callback function when a new tab has been created in the layout.
   *
   * This is default functionality and super.onEditorTabCreated() must be called
   * first in child classes before any additional functionality.
   *
   * @param {GoldenLayout.Tab} tab - The tab instance that has been created.
   */
  onEditorTabCreated(tab) {
    if (tab.contentItem.isTerminal) return;

    const editorComponent = tab.contentItem.instance;

    // Bind event listeners to custom editor component events.
    // key = event name
    // value = callback function
    const events = {
      'startEditing': 'onEditorStartEditing',
      'stopEditing': 'onEditorStopEditing',
      'onShow': 'onEditorShow',
      'vfsChanged': 'onVFSChanged',
    }

    for (const [eventName, fn] of Object.entries(events)) {
      const callback = this[fn];
      if (typeof callback === 'function') {
        editorComponent.addEventListener(eventName, () => callback(editorComponent));
      }
    }
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
    const { fileId } = editorComponent.container.getState();
    if (fileId) {
      VFS.updateFile(fileId, {
        content: editorComponent.editor.getValue(),
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
}
