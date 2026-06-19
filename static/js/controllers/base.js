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
 * Members the controller does not implement are forwarded to the wrapped layout
 * through a Proxy, so the app can still reach layout methods via `this.layout`.
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

    // Resolve persisted state up front so the layout can receive it as plain
    // constructor parameters (it never reads storage itself).
    const restoredConfig = this.resolveRestoredConfig(layoutOptions.forceDefaultLayout);

    this.layout = this.buildLayout({
      ...layoutOptions,
      fontSize: this.getStoredFontSize(),
      theme: this.getStoredTheme(),
      restoredConfig,
    });

    // Members not defined on the controller resolve on the wrapped layout.
    // Subclass methods take precedence (they live on the proxied target's
    // prototype chain, so `prop in target` finds them first).
    const controller = new Proxy(this, {
      get(target, prop, receiver) {
        if (prop in target) {
          return Reflect.get(target, prop, receiver);
        }
        const value = target.layout[prop];
        return typeof value === 'function' ? value.bind(target.layout) : value;
      },
      set(target, prop, value, receiver) {
        if (prop in target) {
          return Reflect.set(target, prop, value, receiver);
        }
        target.layout[prop] = value;
        return true;
      },
    });

    // The layout reports user-driven events to its controller, which forwards
    // them to the app delegate.
    this.layout.delegate = controller;

    // The controller owns layout persistence: whenever GoldenLayout reports a
    // structural change, store the (possibly transformed) config.
    this.layout.on('stateChanged', () => {
      if (this.layout.isInitialised) {
        this.persistLayoutConfig();
      }
    });

    return controller;
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

  // ── Delegate callbacks reported by the layout, forwarded to the app ──
  // These replace the old layout EventTarget bus. The app implements whichever
  // it cares about; optional chaining skips the rest.

  onReady() {
    this.delegate.onReady?.();
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
