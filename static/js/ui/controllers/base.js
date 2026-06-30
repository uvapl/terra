import { seconds } from '../../lib/helpers.js';
import {
  getLocalStorageItem,
  setLocalStorageItem,
} from '../../lib/local-storage-manager.js';
import { BASE_FONT_SIZE, DEMO_FONT_SIZE } from '../../constants.js';
import CommandSurfaces from '../../commands/surfaces.js';

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
 * concerns: the command registry (which owns action availability + the run/stop
 * lifecycle), persistence, and recreate(). The layout calls back into the
 * controller via `this.delegate`.
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
  constructor({ delegate, commandRegistry, ...layoutOptions }) {
    this.delegate = delegate;

    this.surfaces = new CommandSurfaces(commandRegistry);
    this.setupCommandSurfaces();
    this.createLayout(layoutOptions);
  }

  /**
   * Build the variant's command surfaces (menubar, global keyboard shortcuts).
   * Variant controllers override this. The base is a no-op so a variant with
   * no surfaces is valid.
   */
  setupCommandSurfaces() {}

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
    // constructor parameters (it never reads storage itself). An explicit
    // restoredConfig (e.g. a plugin loading a custom layout) is used verbatim.
    const restoredConfig = layoutOptions.restoredConfig !== undefined
      ? layoutOptions.restoredConfig
      : this.resolveRestoredConfig(layoutOptions.forceDefaultLayout);

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

    // Build the toolbar from the registered commands' button surfaces, into the
    // static `#toolbar` div in the page chrome — the mirror of the menubar, and
    // (like the menubar) built before the layout renders. Every variant has a
    // `#toolbar`, so this is shared here rather than per-variant.
    this.layout.on('initialised', () => { this.onLayoutInitialised() });

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

  addCanvasTab(opts) {
    return this.layout.addCanvasTab(opts);
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

  // ── Font size & theme: storage authority + initiator ──
  // The controller is the single owner of these persisted settings. A change
  // signal (menu click, keybinding) reaches the app, which forwards here; this
  // is where the value is clamped and stored, and only then handed to the layout
  // to apply as a pure view update. The layout never reads or writes storage for
  // these — it holds the current value purely to seed new tabs.

  /**
   * Set the font size to an absolute value: clamp, persist, then apply to the
   * view. The single sink every font-size change flows through.
   *
   * @param {number} size - The requested font size in px.
   */
  setFontSize(size) {
    size = Math.max(8, Math.min(72, size));
    this.setStoredFontSize(size);
    this.layout.applyFontSize(size);
  }

  increaseFontSize() {
    this.setFontSize(this.getStoredFontSize() + 1);
  }

  decreaseFontSize() {
    this.setFontSize(this.getStoredFontSize() - 1);
  }

  setFontSizeDefault() {
    this.setFontSize(BASE_FONT_SIZE);
  }

  setFontSizeDemo() {
    this.setFontSize(DEMO_FONT_SIZE);
  }

  /**
   * Set the editor theme: persist, then apply to the view.
   *
   * @param {string} theme - 'light' | 'dark'.
   */
  setTheme(theme) {
    this.setStoredTheme(theme);
    this.layout.applyTheme(theme);
  }

  /**
   * Wire the font-size and theme menu clicks to the app entry points. These
   * value lists (`<li data-val>`) render into two different surfaces depending on
   * the variant — the IDE menubar and the hand-rolled gear settings menu — but
   * both use the same `#font-size-menu` / `#editor-theme-menu` ids, so a single
   * id-based binding here covers every variant. Routing through the app mirrors
   * how the menubar's other commands reach it (e.g. setLayoutOrientation); the
   * app forwards back to setFontSize/setTheme above.
   *
   * The menus may live in chrome that survives a layout reset, so the handlers
   * are namespaced and rebound (off-then-on) on every init.
   */
  wireSettingsControls() {
    $('#font-size-menu').find('li[data-val]').off('click.settings').on('click.settings', (event) => {
      this.delegate.setFontSize(parseInt($(event.currentTarget).data('val'), 10));
    });

    $('#editor-theme-menu').find('li[data-val]').off('click.settings').on('click.settings', (event) => {
      this.delegate.setTheme($(event.currentTarget).data('val'));
    });
  }

  refresh() {
    this.layout.refresh();
  }

  /**
   * Switch the layout orientation at runtime (horizontal ⇄ vertical).
   *
   * @param {string} orientation - 'horizontal' | 'vertical'.
   */
  setOrientation(orientation) {
    this.layout.setOrientation(orientation);
  }

  /** @returns {string} The current orientation ('horizontal' | 'vertical'). */
  get orientation() {
    return this.layout.orientation;
  }

  /**
   * Lock all open editors (read-only). Called by the Git backend while a
   * clone/connect is in flight, so the storage layer never reaches into the
   * view directly.
   */
  lockEditors() {
    this.layout.getEditorComponents().forEach((editorComponent) => editorComponent.lock());
  }

  /**
   * Unlock all open editors. Called by the Git backend after a clone/pull so
   * the storage layer never reaches into the view directly.
   */
  unlockEditors() {
    this.layout.getEditorComponents().forEach((editorComponent) => editorComponent.unlock());
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
  onLayoutInitialised() {
    this.surfaces.buildToolbar('#toolbar');
    this.wireSettingsControls();
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

  // Plugin-event-carrying callbacks — app always defines these.

  onLayoutLoaded() {
    this.delegate.onLayoutLoaded();
  }

  // Bind the registry's editor-scope shortcuts onto a freshly created editor.
  // Terminates here (not re-forwarded to the app): the controller owns the
  // command surfaces, so command registration is its own responsibility.
  onEditorCreated(editorComponent) {
    this.surfaces.registerEditorCommands(editorComponent);
  }

  onEditorTextChanged(tabComponent) {
    this.delegate.onEditorTextChanged(tabComponent);
  }

  onSwitchToEditorTab(tabComponent) {
    this.delegate.onSwitchToEditorTab(tabComponent);
  }

  onEditorFocused(tabComponent) {
    this.delegate.onEditorFocused(tabComponent);
  }

  onEditorHidden(tabComponent) {
    this.delegate.onEditorHidden(tabComponent);
  }

  onEditorLocked(tabComponent) {
    this.delegate.onEditorLocked(tabComponent);
  }

  onEditorUnlocked(tabComponent) {
    this.delegate.onEditorUnlocked(tabComponent);
  }

  onEditorResized(tabComponent) {
    this.delegate.onEditorResized(tabComponent);
  }

  onEditorDestroyed(tabComponent) {
    this.delegate.onEditorDestroyed(tabComponent);
  }

  onTabDragStopped(event, tab) {
    this.delegate.onTabDragStopped(event, tab);
  }

  onSwitchToImageTab(tabComponent) {
    this.delegate.onSwitchToImageTab(tabComponent);
  }

  onImageHidden(tabComponent) {
    this.delegate.onImageHidden(tabComponent);
  }

  onImageDestroyed(tabComponent) {
    this.delegate.onImageDestroyed(tabComponent);
  }

  // Optional callbacks — not all app variants implement these.

  onEditorEditingStarted(tabComponent) {
    this.delegate.onEditorEditingStarted?.(tabComponent);
  }

  onEditorEditingStopped(tabComponent) {
    this.delegate.onEditorEditingStopped?.(tabComponent);
  }

  // ── Action availability ──
  // Re-pull every command's predicate and reflect it onto its surfaces (run
  // button, config buttons, menu items, plugin buttons). The app calls this on
  // the transitions that change availability; nothing pushes button state.
  invalidateActions() {
    this.surfaces.invalidate();
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
