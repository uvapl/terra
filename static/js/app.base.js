import { getFileExtension } from './lib/helpers.js'
import LangWorkerClient from './workers/lang-worker-client.js';
import VirtualFileSystem from './fs/vfs.js';
import Layout from './layouts/layout.js';

/**
 * Composition + wiring layer shared by every app.
 *
 * This base class constructs the composed instances (the VFS and the language
 * worker client), binds methods, runs the layout lifecycle, and wires layout
 * events and worker callbacks to the handler methods. The handlers and the
 * basic app methods themselves live in the App subclass (app.js).
 */
export default class BaseApp {
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

  /**
   * Whether reactive reloads from the VFS are currently suspended because the
   * user is mid-interaction (editing in an editor, renaming/dragging a tree
   * node, a context menu is open, …). It guards both editor/image content
   * reloads and file-tree rebuilds. Use the suspend/resume/isFSReloadSuspended
   * methods rather than touching this directly.
   * @type {boolean}
   */
  _fsReloadSuspended = false;

  /**
   * The terminal component, or null when it does not (yet) exist. The layout
   * owns the terminal's lifecycle; this is a convenience accessor so the rest
   * of the app does not reach through the layout on every use.
   * @type {?TerminalTab}
   */
  get term() {
    return this.layout?.term ?? null;
  }

  /**
   * Suspend reactive reloads from the VFS while the user is mid-interaction.
   * Last-writer-wins (a plain boolean): some interactions clear it without a
   * matching set, matching the previous shared-flag behaviour.
   */
  suspendFSReload() {
    this._fsReloadSuspended = true;
  }

  /** Resume reactive reloads from the VFS. */
  resumeFSReload() {
    this._fsReloadSuspended = false;
  }

  /** @returns {boolean} True while reactive VFS reloads are suspended. */
  isFSReloadSuspended() {
    return this._fsReloadSuspended;
  }

  constructor() {
    this._bindThis();

    this.vfs = new VirtualFileSystem();

    // The language worker client persists for the lifetime of the app; it only
    // spawns a worker thread on demand once a supported language is loaded. The
    // handler object (getLangWorkerHandlers) is defined on the App subclass.
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
    // Layout-driven events (run, editor/image, ready) reach the app through the
    // controller delegate, wired at construction, so they need no registration.
    this.layout.on('initialised', this.postSetupLayout);

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
   * Delegate callback invoked (via the controller) once the layout has rendered
   * and the run button exists. Spawns the worker for the initially active tab's
   * language and sets the run button to match. The editor 'show' events fire
   * before the run button exists, so this has to be applied here. Runs on every
   * layout, including replacements after a reset.
   */
  onReady() {
    const activeEditor = this.getActiveEditor();
    const filename = activeEditor ? activeEditor.getFilename() : null;
    this.createLangWorker(getFileExtension(filename));
    this.updateRunButtonState(filename);
  }
}
