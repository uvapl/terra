import { BASE_FONT_SIZE } from '../../constants.js';
import {
  isImageExtension,
  isObject,
  mergeObjects,
} from '../../lib/helpers.js';
import FileTab from '../components/file.tab.js';
import ImageTab from '../components/image.tab.js';
import EditorTab from '../components/editor.tab.js';
import TerminalTab from '../components/terminal.tab.js';
import CanvasTab from '../components/canvas.tab.js';
import { constrainDrops } from './drag-constraints.js';
import {
  componentTypeOf,
  createTabConfig,
  isEditorItem,
  isOutputItem,
} from './tab-config.js';
import {
  GoldenLayout,
  ItemConfig,
  LayoutConfig,
} from '../../../vendor/golden-layout/2.6.0/golden-layout.esm.js';

/**
 * Some tabs are always preserved when created programmatically. The user
 * cannot close these.
 * @type {string[]}
 */
const FIXTURE_KINDS = ['terminal', 'canvas'];

/**
 * Default layout config that is used when the layout is created for the first
 * time (and thus not saved in local storage yet) or when the layout is reset.
 * @type {object}
 */
const DEFAULT_LAYOUT_CONFIG = {
  settings: {
    reorderEnabled: false,
  },
  // The stack close button is hidden in CSS rather than disabled here:
  // `header.close: false` also makes GoldenLayout treat every stack as
  // non-closable, which blocks dragging a tab out of a single-tab stack.
  header: {
    popout: false,
    maximise: false,
  },
  dimensions: {
    headerHeight: 30,
    borderWidth: 10,
  },
  root: {
    type: 'row',
    isClosable: false,
    content: [
      {
        // Note that the stack is closable here to make it behave well, but we
        // otherwise prevent it from closing
        type: 'stack',
        id: 'editorStack',
        isClosable: true,
      },
      {
        type: 'stack',
        id: 'outputStack',
        isClosable: false,
        content: [
          createTabConfig(
            { kind: 'terminal', title: 'Terminal', isClosable: true },
            { fontSize: BASE_FONT_SIZE },
          ),
        ]
      }
    ]
  }
};

export default class Layout extends GoldenLayout {
  /**
   * Whether the layout has been initialised. This is different from the
   * GoldenLayout `this.isInitialised` property, which is true when the layout
   * is created. We use this to check whether the layout has been rendered.
   * @type {boolean}
   */
  initialised = false;

  /**
   * Whether tabs created via addFileTab() can be closed by the user.
   * @type {boolean}
   */
  tabsClosable = true;

  /**
   * The layout orientation: 'vertical' puts the output stack below the editor
   * stack, 'horizontal' puts it to the right. This is the single source of truth
   * for orientation; the root content item's type (column/row) is derived from
   * it. Read via the `orientation` / `vertical` getters.
   * @type {string}
   */
  _orientation = 'horizontal';

  /**
   * Whether cross-stack dragging (an editor into the output stack or vice-versa)
   * is blocked. Flip to false to restore GoldenLayout's default free dragging.
   * @type {boolean}
   */
  static constrainDrag = true;

  /**
   * Reference to the default layout config.
   * @type {object}
   */
  defaultLayoutConfig = null;

  /**
   * Reference to the terminal component.
   * There can only be one terminal component inside an app.
   * @type {Terminal}
   */
  term = null;

  /**
   * Reference to the canvas component.
   * Like the terminal, there can only be one canvas component inside an app.
   * @type {?CanvasTab}
   */
  canvas = null;

  /**
   * Default terminal startup message.
   * Each element in the array is written on a separate line.
   * @type {array}
   */
  termStartupMessage = [
    'Press Cmd-Enter to run your code.',
    'Press Cmd-K to clear this terminal.'
  ];

  /**
   * References to all open tabs in the UI.
   * @type {Tab[]}
   */
  tabs = [];

  /**
   * Reference to tab Stack element in the GoldenLayout hierarchy.
   * @type {Stack}
   */
  editorStack = null;

  /**
   * Reference to the Stack the terminal lives in, used to open output panes
   * (e.g. a canvas tab) next to the terminal.
   * @type {Stack}
   */
  outputStack = null;

  /**
   * Reference to all hidden files which will *never* be shown in the UI, but
   * will be sent to the workers and written to worker's filesystem.
   * @type {object<string, string>}
   */
  hiddenFiles = {};

  /**
   * Reference to the current active tab instance in the layout.
   * @type {BaseTab}
   */
  activeEditor = null;

  /**
   * The controller that owns this layout. The layout reports user-driven events
   * to it (`this.delegate.onX?.()`) and reads/writes persisted settings through
   * it. Set by the controller right after construction.
   * @type {?BaseController}
   */
  delegate = null;

  /**
   * The current theme ('light' | 'dark'). Seeded from the controller-supplied
   * value and kept in sync by applyTheme(); the layout never reads it from
   * storage itself.
   * @type {string}
   */
  theme = 'light';

  /**
   * The current font size in px. Seeded from the controller-supplied value and
   * kept in sync by applyFontSize(); the layout never reads it from storage
   * itself, but holds it to seed newly created tabs.
   * @type {number}
   */
  fontSize = BASE_FONT_SIZE;

  /**
   * @param {object} additionalLayoutConfig - The variant's default layout config,
   * merged onto DEFAULT_LAYOUT_CONFIG when starting fresh.
   * @param {object} options - Controller-supplied options. The controller
   * resolves persisted state and passes it in here.
   * @param {?object} [options.restoredConfig] - The stored GoldenLayout config to
   * restore, or null/undefined to start from the (merged) default.
   * @param {string} [options.theme] - The persisted theme to apply on render.
   */
  constructor(additionalLayoutConfig, options = {}) {
    const containerElement = document.getElementById('layout');
    super(containerElement);

    // Distinct from GoldenLayout's own (private) _containerElement.
    this._terraContainer = containerElement;

    const orientation = Layout.resolveOrientation(options);

    if (options.restoredConfig) {
      // A stored config is a ResolvedLayoutConfig (what saveLayout() emits);
      // loadLayout() wants the unresolved form.
      this._layoutConfig = LayoutConfig.fromResolved(options.restoredConfig);
    } else {
      // Clone the shared default before merging so the module constant is never
      // mutated, and stamp the root type from the resolved orientation so the
      // base owns the editor/output skeleton (variants no longer hand-roll it).
      const base = JSON.parse(JSON.stringify(DEFAULT_LAYOUT_CONFIG));
      base.root.type = orientation === 'vertical' ? 'column' : 'row';
      this._layoutConfig = mergeObjects(base, additionalLayoutConfig);
    }

    if (Layout.constrainDrag) {
      constrainDrops(this);
    }

    this._orientation = orientation;
    this.theme = options.theme || 'light';
    this.fontSize = options.fontSize || BASE_FONT_SIZE;

    if (isObject(options.hiddenFiles)) {
      this.hiddenFiles = options.hiddenFiles;
    }

    // 'layoutReady' is ours, not GoldenLayout's: v2 emits 'initialised' from
    // init(), which runs *before* loadLayout() has built the tree, so it is too
    // early for anything that touches components. render() emits this once the
    // layout is actually populated.
    this.on('layoutReady', () => this.onInitialised(options));

    // v2 has no 'stackCreated'; stacks arrive as bubbling 'itemCreated' events.
    this.on('itemCreated', (event) => {
      if (event.target.isStack) this.onStackCreated(event.target, options);
    });
    this.on('tabCreated', (tab) => this.onTabCreated(tab));

    // The counterpart to the refresh onTabCreated() schedules. Removing a tab or
    // a stack reaches the layout through neither 'tabCreated' nor a layout-level
    // 'stateChanged' (v2 does not propagate one for structural changes), so
    // without this the area tags and editor-stack closability go stale as soon as
    // anything is closed. Deferred, so it runs after the stack that emptied has
    // had its chance to remove itself.
    this.on('itemDestroyed', () => this._scheduleOutputControlsRefresh());

    this.registerComponentConstructor('image', ImageTab);
    this.registerComponentConstructor('editor', EditorTab);
    this.registerComponentConstructor('canvas', CanvasTab);
    this.registerComponentConstructor('terminal', TerminalTab);

    // Let GoldenLayout's own ResizeObserver drive sizing from the container
    // element (v2 defaults this off). The window 'resize' that refresh() fires
    // is left to the other listeners (Ace, xterm) that depend on it.
    this.resizeWithContainerAutomatically = true;
  }

  /**
   * Build and show the layout: GoldenLayout's init() creates the ground item,
   * loadLayout() populates it, and 'layoutReady' then tells everything that
   * needs a populated tree to run.
   *
   * Named render() rather than init() because init() is GoldenLayout's own
   * method.
   */
  render() {
    // The GoldenLayout 2 constructor calls init() itself; it only defers to
    // DOMContentLoaded when the document is still loading. Calling it a second
    // time would build a second (empty) ground item, so only force it when the
    // deferred path has not run yet.
    if (!this.isInitialised) {
      this.init();
    }

    // init() ran from the constructor, when the container had not been laid out
    // yet (the lab and embed pages size it against a sibling). Re-measure now so
    // the first paint is already correct instead of waiting for the container's
    // ResizeObserver to correct a collapsed layout.
    const { width, height } = this._terraContainer.getBoundingClientRect();
    this.setSize(width, height);

    this.loadLayout(this._layoutConfig);
    this.emit('layoutReady');
  }

  /**
   * Resolve the layout orientation from the controller-supplied options, in
   * precedence order: a restored config's root type, then an explicit
   * `orientation` option, then the legacy `vertical` boolean, then horizontal.
   *
   * @param {object} options - Controller-supplied options.
   * @returns {string} 'horizontal' | 'vertical'.
   */
  static resolveOrientation(options) {
    const restoredType = options.restoredConfig?.root?.type;
    if (restoredType) {
      return restoredType === 'column' ? 'vertical' : 'horizontal';
    }
    if (options.orientation) {
      return options.orientation;
    }
    if (typeof options.vertical === 'boolean') {
      return options.vertical ? 'vertical' : 'horizontal';
    }
    return 'horizontal';
  }

  /** @returns {string} The current orientation ('horizontal' | 'vertical'). */
  get orientation() {
    return this._orientation;
  }

  /** @returns {boolean} Whether the layout is vertical (output below editor). */
  get vertical() {
    return this._orientation === 'vertical';
  }

  // ── Runtime restructuring hooks ──
  // Flipping the orientation and splitting/merging the output are runtime
  // *manipulations* that only the IDE offers; they live in FlexibleLayout. The
  // base wires these no-op hooks into its lifecycle so the IDE can override them
  // without the other variants (fixed two-pane, no reordering) paying for any of
  // the bookkeeping. See layout.flexible.js.

  /** Hook: set up runtime-restructuring controls after init. No-op in base. */
  _initStructureControls() {}

  /** Hook: re-sync the output controls after a structural change. No-op in base. */
  _scheduleOutputControlsRefresh() {}

  /**
   * Hook: arrange a newly opened output tab according to the user's remembered
   * split/merge choice. No-op in base; only the IDE can rearrange at runtime.
   */
  _applyOutputArrangementPreference() {}

  /**
   * Re-apply the current window size to the layout by firing the window
   * resize event, which also lets other resize listeners recalculate.
   */
  refresh() {
    $(window).trigger('resize');
  }

  /**
   * Executed after the layout has been initialised.
   *
   * @param {object} options - Options passed to the layout.
   */
  onInitialised(options) {
    this.initCustomContent();
    this.emitToAllComponents('afterFirstRender');
    this.applyTheme(this.theme);
    this.addActiveStates();
    this.addButtonEventListeners();
    this.showTermStartupMessage();
    this.delegate.onLayoutLoaded();

    if (Array.isArray(options.autocomplete) && options.autocomplete.every(isObject)) {
      this.emitToTabComponents('setCustomAutocompleter', options.autocomplete);
    }

    // Wire up runtime-restructuring controls (orientation flip, output
    // split/merge). A no-op in the base; FlexibleLayout (IDE) implements it.
    this._initStructureControls();
  }

  /**
   * Hook: variant-specific per-editor wiring, run once per freshly created
   * editor. No-op in base; the IDE attaches its file-size guard here.
   *
   * @param {EditorTab} editorComponent
   */
  _setupEditorComponent(editorComponent) {}

  /**
   * Retrieve components from the layout.
   *
   * @returns {BaseTab[]} List containing all open tab components.
   */
  getTabComponents() {
    return this.tabs.map((tab) => tab.componentItem.component);
  }

  /**
   * Retrieve all editor components from the layout.
   *
   * @returns {EditorTab[]} List containing all open editor tabs' components.
   */
  getEditorComponents() {
    return this.getTabComponents().filter((component) => component instanceof EditorTab);
  }

  /**
   * Retrieve all file-backed components (editors and images) from the layout.
   * These are the tabs that carry a file path; canvas and terminal tabs do not.
   *
   * @returns {FileTab[]} List containing all open file-backed tabs' components.
   */
  getFileTabComponents() {
    return this.getTabComponents().filter((component) => component instanceof FileTab);
  }

  /**
   * Invoked when the terminal tab is created for the first time.
   *
   * @param {Tab} tab - The tab instance that has been created.
   */
  onTermTabCreated(tab) {
    this.term = tab.componentItem.component;
    tab.componentItem.container.on('destroy', () => {
      this.term = null;
    });
  }

  /**
   * Invoked when the canvas tab is created. Like the terminal, the canvas is a
   * singleton, so we keep a reference to reuse rather than identifying it by a
   * path.
   *
   * @param {Tab} tab - The tab instance that has been created.
   */
  onCanvasTabCreated(tab) {
    this.canvas = tab.componentItem.component;
    tab.componentItem.container.on('destroy', () => {
      this.canvas = null;
    });
  }

  /**
   * Invoked when an image is opened.
   *
   * @param {Tab} tab - The tab instance that has been created.
   */
  onImageTabCreated(tab) {
    const imageComponent = tab.componentItem.component;

    // Layout-internal wiring, registered *before* the component is announced so
    // the layout's own state settles before the controller (and app) react:
    // 'destroy' runs the last-editor bookkeeping. An image is never the "active
    // editor" — like the terminal and canvas it is pure output, so showing it
    // must leave the active code editor (and the run button) untouched.
    imageComponent.addEventListener('destroy', () => this.onTabDestroy(imageComponent));

    // Announce the component; the controller subscribes to its events and
    // forwards them to the app. Emitted last so the listeners above are set.
    this.delegate.onImageCreated(imageComponent);
  }

  /**
   * Invoked when a text file is opened.
   *
   * @param {Tab} tab - The tab instance that has been created.
   */
  onEditorTabCreated(tab) {
    const editorComponent = tab.componentItem.component;

    // Layout-internal wiring, registered *before* the component is announced so
    // the layout's own state settles before the controller (and app) react:
    //  - 'show'/'focus' set the active editor. The controller's 'show' forward
    //    re-pulls run availability (canRunActiveTab), which must read the new
    //    active tab, so this has to run first.
    //  - 'destroy' inserts an Untitled replacement while the stack is still
    //    attached, before the app hears onEditorDestroyed.
    editorComponent.addEventListener('show', () => this.setActiveEditor(editorComponent));
    editorComponent.addEventListener('focus', () => this.setActiveEditor(editorComponent));
    editorComponent.addEventListener('destroy', () => this.onTabDestroy(editorComponent));

    // Layout-owned per-editor wiring (no-op in base; the IDE adds a size guard).
    this._setupEditorComponent(editorComponent);

    // Announce the component. The controller binds the registry's editor-scope
    // shortcuts and subscribes to the component's events, forwarding them to the
    // app. Emitted last so all layout-internal listeners above are in place.
    this.delegate.onEditorCreated(editorComponent);
  }

  /**
   * Try to register a given tab instance to the internal tabs list of this
   * class instance.
   *
   * @param {Tab} tab - The tab instance to register.
   */
  registerTab(tab) {
    // If there is no active editor yet, set it to the current tab — but only
    // when that tab is an editor. Images and the canvas are pure output and must
    // never be the "active editor" (see activeContentItemChanged above). When the
    // layout is loaded from local storage the open tabs are created in order, so
    // the first editor encountered becomes active; a later 'show'/'focus' or
    // activeContentItemChanged overrides it as the user switches editors.
    const instance = tab.componentItem.component;
    if (!this.getActiveEditor() && instance.getComponentName?.() === 'editor') {
      this.setActiveEditor(instance);
    }

    // The onTabCreated is *also* triggered when a user is dragging tabs around,
    // thus if the tab is already in the list, we return early.
    const newTabInstance = tab.componentItem.component;
    const tabExists = this.tabs.some((existingTab) => {
      return existingTab.componentItem.component === newTabInstance;
    });
    if (tabExists) return;

    // Add a regular component to the tabs list.
    // Remove the tab from the list when it is destroyed.
    this.tabs.push(tab);
    tab.componentItem.container.on('destroy', () => {
      this.tabs.splice(this.tabs.indexOf(tab), 1);
    });
  }

  /**
   * Callback function when a new tab has been created in the layout.
   *
   * @param {Tab} tab - The tab instance that has been created.
   */
  onTabCreated(tab) {
    const kind = componentTypeOf(tab.componentItem);

    // Fixtures are configured closable so they stay draggable (see
    // FIXTURE_KINDS); take the close button away so they still cannot be closed.
    // Runs on every tab creation, including the new tab made when one is dragged
    // into another stack.
    if (FIXTURE_KINDS.includes(kind)) {
      tab.element.querySelector('.lm_close_tab')?.remove();
    }

    switch (kind) {
      case 'terminal':
        this.onTermTabCreated(tab);
        break;

      case 'image':
        this.registerTab(tab);
        this.onImageTabCreated(tab);
        break;

      case 'editor':
        this.registerTab(tab);
        this.onEditorTabCreated(tab);
        break;

      case 'canvas':
        this.registerTab(tab);
        this.onCanvasTabCreated(tab);
        break;

      default:
        console.warn('Unknown tab type:', tab.contentItem);
    }

    this._scheduleOutputControlsRefresh();
  }

  /**
   * Callback when a tab is destroyed. Guarantees at least one editor remains
   * *anywhere* in the layout: an Untitled replacement is inserted only when the
   * editor being closed is the last editor across all (possibly split) editor
   * stacks. Closing one editor of several — even in a separate split stack —
   * just closes it. Output tabs (terminal, canvas, images) never spawn one.
   *
   * Runs synchronously while the closing component's stack is still attached, so
   * the replacement keeps that stack (and thus the editor area) from collapsing.
   *
   * @param {BaseTab} closedComponent - The tab component being closed.
   */
  onTabDestroy(closedComponent) {
    if (this.resetLayout) return;

    // Editors that will remain after this one is gone (filtering by identity
    // works whether or not the closing tab has left the tracked list yet).
    const remainingEditors = this.getEditorComponents()
      .filter((component) => component !== closedComponent);

    if (remainingEditors.length === 0) {
      // Add the replacement to the closing editor's own stack when possible, so
      // that stack survives instead of being removed for being empty.
      const stack = closedComponent?.container?.parent?.parent;
      const target = stack?.isStack ? stack : this.getEditorStack();
      target?.addItem(this._createEditorTab());
    }
  }

  /**
   * Create a new editor tab with provided config, or default to Untitled.
   *
   * @param {ContentItem} config - Content item config object.
   * @returns {object} - Fully configured object.
   */
  _createEditorTab(config = {}) {
    return createTabConfig(config, {
      fontSize: this.fontSize,
      theme: this.theme,
    });
  }

  /**
   * Callback when the layout is initialised and a stack is created.
   *
   * There are two stacks in some layouts: one for the code editors, and
   * one for the terminal. Here, we're interested in the code editor stack.
   *
   * @param {Stack} stack - Object representing the root structure.
   * @param {object} options - Options passed to the layout.
   */
  onStackCreated(stack, options) {
    // Seed the initial stack references from the default config's ids. These are
    // only the *initial* single stacks; once either area is split they may go
    // stale, so runtime logic uses the dynamic area getters / `_terraArea` tags
    // instead. They remain handy fallbacks for the common unsplit case.
    if (stack.id === 'editorStack') {
      this.editorStack = stack;
    }
    if (stack.id === 'outputStack') {
      this.outputStack = stack;
    }

    // Track the active tab for every stack (the editor area may be split into
    // several stacks).
    stack.on('activeContentItemChanged', (componentItem) => {
      // Only editors become the "active editor"; the terminal, canvas and images
      // must not, or activating one of these (non-runnable) output tabs would
      // leave the run button reading a non-runnable tab.
      if (isEditorItem(componentItem)) {
        this.setActiveEditor(componentItem.component);
      }
    });

  }

  /**
   * Add active states in the UI for certain dropdowns.
   */
  addActiveStates() {
    // Add active state to font-size dropdown.
    const $fontSizeMenu = $('#font-size-menu');
    const currentFontSize = this.fontSize
    $fontSizeMenu.find(`li[data-val=${currentFontSize}]`).addClass('active');

    // Add active state to theme dropdown.
    const currentTheme = this.theme;
    const $editorThemeMenu = $('#editor-theme-menu');
    $editorThemeMenu.find(`li[data-val=${currentTheme}]`).addClass('active');

    // Reflect the current orientation in the View ▸ Orientation menu (IDE only;
    // a no-op where those menu items don't exist).
    $('#menu-item--orientation-horizontal').toggleClass('active', !this.vertical);
    $('#menu-item--orientation-vertical').toggleClass('active', this.vertical);
  }

  /**
   * Display the terminal startup message.
   */
  showTermStartupMessage() {
    for (const line of this.termStartupMessage) {
      this.term?.write(line + '\n');
    }

    this.term?.write('\n');
  }

  /**
   * Emit an event (optionally with data) to all components in the layout.
   *
   * @param {string} event - The event name.
   * @param {object} data - Data object to pass along with the event.
   */
  emitToAllComponents(event, data) {
    this.emitToTabComponents(event, data);
    this.term?.emit(event, data);
  }

  /**
   * Emit an event (optionally with data) to all editors.
   *
   * @param {string} event - The event name.
   * @param {object} data - Data object to pass along with the event.
   */
  emitToTabComponents(event, data) {
    this.tabs.forEach((tab) => {
      tab.componentItem.container.emit(event, data);
    });
  }

  /**
   * Apply a theme to the layout and all components: toggle the page's dark-mode
   * class, broadcast the change to components, remember it, and reflect it in the
   * theme menu's active state. A pure view update — the controller has already
   * persisted the value before calling this.
   *
   * @param {string} theme - Either 'dark' or 'light'.
   */
  applyTheme(theme) {
    const isDarkMode = (theme === 'dark');

    if (isDarkMode) {
      $('body').addClass('dark-mode');
      $('#theme').val('dark');
    } else {
      $('body').removeClass('dark-mode');
      $('#theme').val('light');
    }

    this.emitToAllComponents('themeChanged', theme);
    this.theme = theme;

    const $items = $('#editor-theme-menu').find('li[data-val]');
    $items.removeClass('active');
    $items.filter(`[data-val="${theme}"]`).addClass('active');
  }

  /**
   * Retrieve the HTML for the settings menu.
   *
   * @returns {string}
   */
  getSettingsMenuHtml() {
    return `
      <div class="settings-menu">
        <button class="settings-btn"></button>
        <ul class="settings-dropdown">
          <li class="has-dropdown">
            Editor theme
            <ul class="settings-dropdown" id="editor-theme-menu">
              <li data-val="light">Light</li>
              <li data-val="dark">Dark</li>
            </ul>
          </li>
          <li class="has-dropdown">
            Font size
            <ul class="settings-dropdown" id="font-size-menu">
              <li data-val="10">10</li>
              <li data-val="11">11</li>
              <li data-val="12">12</li>
              <li data-val="14">14</li>
              <li data-val="16">16</li>
              <li data-val="18">18</li>
              <li data-val="24">24</li>
              <li data-val="30">30</li>
            </ul>
          </li>
        </ul>
      </div>
    `;
  }

  /**
   * Abstract function where the run-code, clear-term and additional
   * buttons and dropdown should be rendered.
   */
  initCustomContent() {
    console.info('initCustomContent() is not implemented');
  }

  /**
   * Apply a font size to all components: remember it (so new tabs are seeded
   * with it), broadcast the change, and reflect it in the font-size menu's active
   * state. A pure view update — the controller has already clamped and persisted
   * the value before calling this.
   *
   * @param {number} size - The new font size in px.
   */
  applyFontSize(size) {
    this.fontSize = size;
    this.emitToAllComponents('fontSizeChanged', size);
    const $items = $('#font-size-menu').find('li[data-val]');
    $items.removeClass('active');
    $items.filter(`[data-val="${size}"]`).addClass('active');
  }

  /**
   * Add event listeners to the buttons and dropdowns in the layout.
   */
  addButtonEventListeners() {
    // Several of these elements live in the persistent page chrome (the IDE
    // navbar/toolbar and settings menu) and survive a layout reset, while the
    // handlers close over `this` (the layout instance, recreated on reset).
    // Namespaced off-then-on rebinds the handlers to the current instance
    // instead of stacking a new handler on top of the old (destroyed) one.
    // The run and clear buttons' clicks are wired by the command surfaces
    // (buildToolbar / renderButton), not here. The font-size and theme value
    // lists are wired by the controller (wireSettingsControls), which owns the
    // persisted settings these change.

    // Add event listeners for setttings menu.
    $('.settings-menu').off('click.layout').on('click.layout', (event) => $(event.target).toggleClass('open'));
    $(document).off('click.settingsMenu').on('click.settingsMenu', (event) => {
      if (!$(event.target).is($('.settings-menu.open'))) {
        $('.settings-menu').removeClass('open');
      }
    });
  };

  /**
   * Set the active editor component. When it is a (text) editor, also remember
   * the stack it lives in, so newly opened files open next to the most recently
   * active editor — important when the editor area has been split into several
   * stacks.
   *
   * @param {EditorTab} editorComponent - The editor component to set as active.
   */
  setActiveEditor(editorComponent) {
    this.activeEditor = editorComponent;

    if (editorComponent instanceof EditorTab) {
      const stack = editorComponent.container?.parent?.parent;
      if (stack?.isStack) {
        this._lastEditorStack = stack;
      }
    }
  }

  /**
   * Get the active editor component.
   *
   * @returns {EditorTab} - The active editor component.
   */
  getActiveEditor() {
    return this.activeEditor;
  }

  /**
   * Re-point an open tab at a new file path: update its path/title, apply the
   * caller-supplied syntax highlighting for editor tabs, and persist the layout
   * state.
   *
   * @param {BaseTab} tabComponent - The tab to re-point.
   * @param {string} filepath - The new absolute file path.
   */
  repointTab(tabComponent, filepath) {
    tabComponent.setPath(filepath); // also updates the title + container state

    if (tabComponent instanceof EditorTab) {
      tabComponent.setProgLang();
    }

    // GoldenLayout doesn't emit on a programmatic path change; trigger
    // persistence (and any content reload) manually.
    this.emit('stateChanged');
  }

  /**
   * Re-point an already-open tab from one path to another (e.g. after a file is
   * renamed or moved in the VFS). A no-op when no tab is open for `srcPath`.
   *
   * @param {string} srcPath - The previous absolute file path.
   * @param {string} destPath - The new absolute file path.
   * @returns {?BaseTab} The repointed tab, or null when no tab matched.
   */
  repointTabByPath(srcPath, destPath) {
    const tabComponent = this.getFileTabComponents().find(
      (component) => component.getPath() === srcPath
    );
    if (!tabComponent) return null;

    this.repointTab(tabComponent, destPath);
    return tabComponent;
  }

  /**
   * Open a file in the editor, or switch to the tab if it's already open.
   *
   * N.B. This function assumes that another editor tab is already present.
   *
   * @param {string} filepath - The path of the file to open.
   */
  addFileTab(filepath) {
    let tabComponents = this.getFileTabComponents();

    // Switch to the selected file if that is already open.
    const tabComponent = tabComponents.find(
      (component) => component.getPath() === filepath
    );
    if (tabComponent) {
      tabComponent.setActive();
      return;
    }

    const filename = filepath.split('/').pop();
    const isImage = isImageExtension(filename);

    // Opening a real editor file replaces the active empty Untitled editor (if
    // any). Images open in the output stack, so they leave the editor untouched.
    const untitled = isImage ? null : this.getReplaceableUntitledEditor?.();

    // Editors open in the editor stack with the most recently active editor;
    // images open in the output stack (alongside the terminal/canvas).
    const stack = isImage ? this.getOutputStack() : this.getEditorStack();
    stack.addItem(
      this._createEditorTab({
        title: filename,
        componentState: { path: filepath },
        kind: isImage ? 'image' : 'editor',
        isClosable: this.tabsClosable,
      })
    );

    // Close the replaced Untitled *after* adding the new tab, so its stack never
    // momentarily empties (which would auto-remove it). resetLayout suppresses
    // the onTabDestroy Untitled-replacement during this close.
    if (untitled) {
      this.resetLayout = true;
      untitled.close();
      this.resetLayout = false;
    }

    // An image is added to the output area, where the user's remembered
    // split/merge choice applies.
    if (isImage) {
      this._applyOutputArrangementPreference();
    }
  }

  /**
   * Open the canvas output tab, or reuse the existing one. The canvas is a
   * singleton (like the terminal): there is only ever one, so repeated calls
   * return the same instance instead of stacking up duplicates. It opens next to
   * the terminal (falling back to the editor stack if there is no terminal).
   *
   * @param {object} opts
   * @param {string} opts.title - The tab title.
   * @returns {CanvasTab} The (new or reused) canvas component instance.
   */
  addCanvasTab({ title }) {
    // Reuse the existing canvas if there is one.
    if (this.canvas) {
      this.canvas.setActive();
      return this.canvas;
    }

    this.getOutputStack().addItem(createTabConfig({
      kind: 'canvas',
      title,
      isClosable: true, // Movable but not user-closable; see FIXTURE_KINDS.
    }));

    // The output area now holds more than the terminal, so the user's remembered
    // split/merge choice becomes meaningful again.
    this._applyOutputArrangementPreference();

    // GoldenLayout creates the component synchronously during addChild, so
    // onCanvasTabCreated has already set this.canvas.
    return this.canvas;
  }

  /**
   * Close the canvas output tab. Its 'destroy' handler (see onCanvasTabCreated)
   * clears this.canvas. No-op when no canvas is open.
   */
  closeCanvas() {
    this.canvas?.close();
  }

  // ── Layout areas (content-based) ──
  // The editor and output "areas" cannot be identified by tree position:
  // GoldenLayout flattens a same-axis split into the parent, so splitting the
  // editors horizontally in a horizontal layout makes the root row hold
  // [editor, editor, output] with no editor/output subtree boundary. Instead we
  // classify each stack by what it contains — a stack holds either editors or
  // output tabs (terminal/canvas/image), never a mix (the drag constraint keeps
  // them apart) — and drive everything off that.

  /** @returns {?ContentItem} The root row/column holding the stacks. */
  getMainContainer() {
    // rootItem throws before init(); the layout is queried during teardown and
    // early setup, so treat "no tree yet" as no container.
    if (!this.isInitialised) return null;
    return this.rootItem ?? null;
  }

  /**
   * Build a content item from a plain (unresolved) item config, without adding
   * it anywhere. GoldenLayout 2 only creates items from *resolved* configs, and
   * leaves initialisation to whoever adds the item — `addChild` inits it, which
   * is the order the DOM setup expects.
   *
   * @param {object} config - A plain item config (row/column/stack/component).
   * @param {ContentItem} parent - The item it will be added to.
   * @returns {ContentItem} The new, uninitialised content item.
   */
  _createItem(config, parent) {
    return this.createContentItem(ItemConfig.resolve(config, false), parent);
  }

  /**
   * Every leaf stack in the layout, in tree (visual) order.
   *
   * @returns {Stack[]}
   */
  _allStacks() {
    const stacks = [];
    const walk = (item) => {
      if (!item) return;
      if (item.isStack) { stacks.push(item); return; }
      (item.contentItems || []).forEach(walk);
    };
    walk(this.getMainContainer());
    return stacks;
  }

  /** @returns {boolean} Whether the stack holds editor tab(s). */
  _isEditorStack(stack) {
    return stack.contentItems.some(isEditorItem);
  }

  /** @returns {boolean} Whether the stack holds output tab(s) (terminal/canvas/image). */
  _isOutputStack(stack) {
    return stack.contentItems.some(isOutputItem);
  }

  /** @returns {?Stack} The first (topmost/leftmost) output stack. */
  _firstOutputStack() {
    return this._allStacks().find((stack) => this._isOutputStack(stack)) ?? null;
  }

  /**
   * The stack new editor tabs should open in: the most recently active editor's
   * stack when it is still attached, else the first editor stack.
   *
   * @returns {?Stack}
   */
  getEditorStack() {
    const stacks = this._allStacks();
    if (this._lastEditorStack && stacks.includes(this._lastEditorStack)) {
      return this._lastEditorStack;
    }
    return stacks.find((stack) => this._isEditorStack(stack)) || this.editorStack;
  }

  /**
   * The stack new output tabs (canvas, images) should open in: next to the
   * terminal, falling back to the first output stack.
   *
   * @returns {?Stack}
   */
  getOutputStack() {
    if (this.term) return this.term.container.parent.parent;
    return this._firstOutputStack() || this.outputStack || this.editorStack;
  }
}
