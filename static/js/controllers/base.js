import { seconds } from '../lib/helpers.js';
import {
  getLocalStorageItem,
  setLocalStorageItem,
} from '../lib/local-storage-manager.js';
import { BASE_FONT_SIZE } from '../constants.js';

/**
 * Current version of the default layout config. Bump it when a breaking change
 * requires every user to reload a fresh config instead of their stored one.
 */
const LAYOUT_CONFIG_VERSION = 3;

/**
 * BaseController is the app's single interface to the UI layer. Each app variant
 * has its own subclass (IDEController, ExamController, LabController,
 * EmbedController); this base holds the behaviour they share.
 *
 * The controller owns the layout's lifecycle and persistence: the app
 * constructs a variant controller with itself as the single `delegate`, the
 * controller reads persisted state (font size, theme, restored config) and
 * builds the layout, passing those values in as parameters. The layout itself
 * never touches local storage; at runtime it reads/writes settings back through
 * the controller via `this.delegate`.
 *
 * The controller exposes the layout as `controller.layout`. The app calls the
 * layout directly for view/tab operations, and the controller only for its own
 * concerns: run-button state (onRunEnded / checkForStopCodeButton), persistence,
 * and recreate(). The layout calls back into the controller via `this.delegate`.
 */
export default class BaseController {
  /**
   * @param {object} options
   * @param {object} options.delegate - The app instance the controller reports
   * to (and forwards layout events to).
   * @param {boolean} [options.forceDefaultLayout] - Force the default layout
   * instead of restoring the stored one.
   * Remaining options are variant-specific and passed through to buildLayout().
   */
  constructor({ delegate, ...layoutOptions }) {
    this.delegate = delegate;
    this.createLayout(layoutOptions);
  }

  /**
   * Build the layout, wire it to this controller, and expose it as
   * `this.layout`. The app reads `controller.layout` and calls the layout
   * directly for view/tab operations; it only goes through the controller for
   * the controller's own concerns (run-button state, persistence, recreate).
   * Reused by recreate() to swap in a fresh layout.
   *
   * @param {object} layoutOptions - Variant options passed to buildLayout(),
   * augmented with the resolved persisted state.
   */
  createLayout(layoutOptions) {
    // Resolve persisted state up front so the layout can receive it as plain
    // constructor parameters (it never reads storage itself).
    const restoredConfig = this.resolveRestoredConfig(layoutOptions.forceDefaultLayout);

    this.layout = this.buildLayout({
      ...layoutOptions,
      fontSize: this.getStoredFontSize(),
      theme: this.getStoredTheme(),
      restoredConfig,
    });

    // The layout reports user-driven events back to this controller (which
    // forwards them to the app delegate) and reads/writes settings through it.
    this.layout.delegate = this;

    // The controller owns layout persistence: whenever GoldenLayout reports a
    // structural change, store the (possibly transformed) config.
    this.layout.on('stateChanged', () => {
      if (this.layout.isInitialised) {
        this.persistLayoutConfig();
      }
    });

    return this.layout;
  }

  /**
   * Build the variant's Layout instance. Abstract: each variant controller
   * returns its own Layout subclass, passing the supplied options (which include
   * the resolved fontSize, theme and restoredConfig) into the constructor.
   *
   * @param {object} options
   * @returns {Layout}
   */
  buildLayout(options) {
    throw new Error('buildLayout() not implemented');
  }

  /**
   * Decide whether to restore the stored layout config or start from the
   * variant default, applying config versioning. Returns the parsed config to
   * restore, or null to signal the layout should build its default. Bumps the
   * stored version when a default is (re)loaded.
   *
   * @param {boolean} [forceDefaultLayout]
   * @returns {?object}
   */
  resolveRestoredConfig(forceDefaultLayout) {
    const storedConfig = this.getStoredLayoutConfig();
    const storedVersion = parseInt(this.getStoredLayoutVersion(), 10);

    if (
      !storedConfig ||
      forceDefaultLayout ||
      isNaN(storedVersion) ||
      storedVersion < LAYOUT_CONFIG_VERSION
    ) {
      this.setStoredLayoutVersion(LAYOUT_CONFIG_VERSION);
      return null;
    }

    return JSON.parse(storedConfig);
  }

  // ── Layout API exposed to the app ──
  // The app talks only to the controller; these thin wrappers forward to the
  // layout (which keeps the DOM and GoldenLayout-internal implementations).

  /** Render the layout (GoldenLayout init). */
  init() {
    this.layout.init();
  }

  /** @returns {?TerminalComponent} The terminal component, or null. */
  get term() {
    return this.layout?.term ?? null;
  }

  getActiveEditor() {
    return this.layout.getActiveEditor();
  }

  getTabComponents() {
    return this.layout.getTabComponents();
  }

  getEditorComponents() {
    return this.layout.getEditorComponents();
  }

  addFileTab(filepath) {
    this.layout.addFileTab(filepath);
  }

  repointTab(tabComponent, filepath, proglang) {
    return this.layout.repointTab(tabComponent, filepath, proglang);
  }

  repointTabByPath(srcPath, destPath, proglang) {
    return this.layout.repointTabByPath(srcPath, destPath, proglang);
  }

  emitToAllComponents(event, data) {
    this.layout.emitToAllComponents(event, data);
  }

  increaseFontSize() {
    this.layout.increaseFontSize();
  }

  decreaseFontSize() {
    this.layout.decreaseFontSize();
  }

  setFontSizeDefault() {
    this.layout.setFontSizeDefault();
  }

  setFontSizeDemo() {
    this.layout.setFontSizeDemo();
  }

  refresh() {
    this.layout.refresh();
  }

  /**
   * Lock all open editors (read-only). Called by the Git backend while a
   * clone/connect is in flight, so the storage layer never reaches into the
   * view directly.
   */
  lockEditors() {
    this.view.getEditorComponents().forEach((editorComponent) => editorComponent.lock());
  }

  /**
   * Unlock all open editors. Called by the Git backend after a clone/pull so
   * the storage layer never reaches into the view directly.
   */
  unlockEditors() {
    this.view.getEditorComponents().forEach((editorComponent) => editorComponent.unlock());
  }

  // ── Delegate callbacks reported by the layout, forwarded to the app ──
  // These replace the old layout EventTarget bus. The app implements whichever
  // it cares about; optional chaining skips the rest.

  /**
   * Reported by the layout once it has rendered (every init, including after a
   * reset). Dispatches the lifecycle hooks to the app: `onReady` every time,
   * `afterSetupLayout` once (initial build only), and `afterLayoutReset` after a
   * recreate. This replaces the app's old `layout.on('initialised', …)` wiring.
   */
  onReady() {
    this.delegate.onReady?.();

    if (!this._afterSetupDone) {
      this._afterSetupDone = true;
      this.delegate.afterSetupLayout?.();
    }

    if (this._pendingReset) {
      this._pendingReset = false;
      this.delegate.afterLayoutReset?.();
    }
  }

  onRunCode(detail) {
    this.delegate.onRunCode?.(detail);
  }

  onEditorEditingStarted(tabComponent) {
    this.delegate.onEditorEditingStarted?.(tabComponent);
  }

  onEditorEditingStopped(tabComponent) {
    this.delegate.onEditorEditingStopped?.(tabComponent);
  }

  onEditorTextChanged(tabComponent) {
    this.delegate.onEditorTextChanged?.(tabComponent);
  }

  onEditorSwitchedTo(tabComponent) {
    this.delegate.onEditorSwitchedTo?.(tabComponent);
  }

  onEditorReloadRequested(tabComponent) {
    this.delegate.onEditorReloadRequested?.(tabComponent);
  }

  onImageSwitchedTo(tabComponent) {
    this.delegate.onImageSwitchedTo?.(tabComponent);
  }

  onImageReloadRequested(tabComponent) {
    this.delegate.onImageReloadRequested?.(tabComponent);
  }

  onClearTerm() {
    this.delegate.clearTerminal?.();
  }

  onConfigButtonCommand(selector, cmd) {
    this.delegate.runButtonCommand?.(selector, cmd);
  }

  // ── Run-button lifecycle ──
  // The controller owns the run/stop semantics; the layout exposes only the
  // mechanical button primitives (setRunButtonMode / setRunButtonEnabled /
  // setConfigButtonsEnabled).

  /**
   * If the running program does not finish quickly (potential infinite loop),
   * turn the run button into a stop button so the user can abort it.
   */
  checkForStopCodeButton() {
    this.showStopCodeButtonTimeoutId = setTimeout(() => {
      this.layout.setRunButtonMode('stop');
      this.layout.setRunButtonEnabled(true);
    }, seconds(0.2));
  }

  /**
   * Reset the button back to a run button when a run has finished.
   *
   * @param {object} options
   * @param {boolean} options.disableRunBtn - Whether the run button should stay
   * disabled (e.g. the active tab is not runnable).
   */
  onRunEnded({ disableRunBtn }) {
    this.layout.setRunButtonMode('run');
    this.layout.setRunButtonEnabled(!disableRunBtn);

    if (!disableRunBtn) {
      this.layout.setConfigButtonsEnabled(true);
    }

    if (this.showStopCodeButtonTimeoutId) {
      clearTimeout(this.showStopCodeButtonTimeoutId);
      this.showStopCodeButtonTimeoutId = null;
    }
  }

  /**
   * Persist the current layout configuration to local storage. Triggered on
   * every GoldenLayout state change. Subclasses adjust what gets stored by
   * overriding serializeLayoutConfig().
   */
  persistLayoutConfig() {
    const config = this.serializeLayoutConfig(this.layout.toConfig());
    this.setStoredLayoutConfig(config);
  }

  /**
   * Hook to transform the layout config before it is persisted. The base
   * controller stores it as-is; subclasses may strip volatile data (e.g. editor
   * contents that are reloaded from elsewhere on restore).
   *
   * @param {object} config - The GoldenLayout config from layout.toConfig().
   * @returns {object} The config to persist.
   */
  serializeLayoutConfig(config) {
    return config;
  }

  // ── Local-storage authority ──
  // The controller is the only place that touches local storage: keys, defaults
  // and serialization live here. The layout reads/writes settings at runtime via
  // `this.delegate` (these instance methods); the controller itself uses them
  // while building the layout.

  getStoredTheme() {
    return getLocalStorageItem('theme') || 'light';
  }

  setStoredTheme(theme) {
    setLocalStorageItem('theme', theme);
  }

  getStoredFontSize() {
    return parseInt(getLocalStorageItem('font-size', BASE_FONT_SIZE));
  }

  setStoredFontSize(fontSize) {
    setLocalStorageItem('font-size', fontSize);
  }

  getStoredLayoutConfig() {
    return getLocalStorageItem('layout');
  }

  setStoredLayoutConfig(config) {
    setLocalStorageItem('layout', JSON.stringify(config));
  }

  getStoredLayoutVersion() {
    return getLocalStorageItem('layout-version');
  }

  setStoredLayoutVersion(version) {
    setLocalStorageItem('layout-version', version);
  }
}
