import { uuidv4 } from './helpers/shared.js'
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

    if ('onEditorStartEditing' in this && typeof this.onEditorStartEditing === 'function') {
      editorComponent.addEventListener(
        'startEditing',
        () => this.onEditorStartEditing(editorComponent)
      );
    }

    if ('onEditorStopEditing' in this && typeof this.onEditorStopEditing === 'function') {
      editorComponent.addEventListener(
        'stopEditing',
        () => this.onEditorStopEditing(editorComponent)
      );
    }
  }

  /**
   * Callback functions for when the editor starts editing.
   *
   * This is default functionality and super.onEditorStartEditing() must be
   * called first in child classes before any additional functionality.
   */
  onEditorStartEditing(editorComponent) {
    console.log('[app] start editing');
    const { fileId } = editorComponent.container.getState();
    if (fileId) {
      VFS.updateFile(fileId, {
        content: editorComponent.editor.getValue(),
      });
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
        fileId: uuidv4(),
      },
      title: filename,
      isClosable: false,
    }));
  }
}
