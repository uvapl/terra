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
import { applyDragConstraints } from './drag-constraints.js';

/**
 * Default layout config that is used when the layout is created for the first
 * time (and thus not saved in local storage yet) or when the layout is reset.
 * @type {object}
 */
const DEFAULT_LAYOUT_CONFIG = {
  settings: {
    showPopoutIcon: false,
    showMaximiseIcon: false,
    showCloseIcon: false,
    reorderEnabled: false,
  },
  dimensions: {
    headerHeight: 30,
    borderWidth: 10,
  },
  content: [
    {
      type: 'row',
      isClosable: false,
      content: [
        {
          // Starts non-closable as the sole editor stack; closability is then
          // managed at runtime by _syncEditorStacksClosable() — false while a
          // single stack (so the editor area can't collapse), true once split
          // (so an emptied split-off stack is auto-removed, merging back).
          type: 'stack',
          id: 'editorStack',
          isClosable: false,
        },
        {
          type: 'stack',
          id: 'outputStack',
          isClosable: false,
          content: [
            {
              type: 'component',
              componentName: 'terminal',
              title: 'Terminal',
              componentState: { fontSize: BASE_FONT_SIZE },
              isClosable: false,
            }
          ]
        }
      ]
    }
  ]
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
   * @type {GoldenLayout.Tab[]}
   */
  tabs = [];

  /**
   * Reference to tab Stack element in the GoldenLayout hierarchy.
   * @type {GoldenLayout.Stack}
   */
  editorStack = null;

  /**
   * Reference to the Stack the terminal lives in, used to open output panes
   * (e.g. a canvas tab) next to the terminal.
   * @type {GoldenLayout.Stack}
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
    const orientation = Layout.resolveOrientation(options);

    let layoutConfig;
    if (options.restoredConfig) {
      layoutConfig = options.restoredConfig;
    } else {
      // Clone the shared default before merging so the module constant is never
      // mutated, and stamp the root type from the resolved orientation so the
      // base owns the editor/output skeleton (variants no longer hand-roll it).
      const base = JSON.parse(JSON.stringify(DEFAULT_LAYOUT_CONFIG));
      base.content[0].type = orientation === 'vertical' ? 'column' : 'row';
      layoutConfig = mergeObjects(base, additionalLayoutConfig);
    }

    super(layoutConfig, $('#layout'));

    if (Layout.constrainDrag) {
      applyDragConstraints(GoldenLayout);
    }

    this._orientation = orientation;
    this.theme = options.theme || 'light';
    this.fontSize = options.fontSize || BASE_FONT_SIZE;

    if (isObject(options.hiddenFiles)) {
      this.hiddenFiles = options.hiddenFiles;
    }

    this.on('initialised', () => this.onInitialised(options));
    this.on('stackCreated', (stack) => this.onStackCreated(stack, options));
    this.on('tabCreated', (tab) => this.onTabCreated(tab));

    this.registerComponent('image', ImageTab);
    this.registerComponent('editor', EditorTab);
    this.registerComponent('canvas', CanvasTab);
    this.registerComponent('terminal', TerminalTab);

    $(window).on('resize', () => {
      this.updateSize(window.innerWidth, window.innerHeight);
    });
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
    const restoredType = options.restoredConfig?.content?.[0]?.type;
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

  /** Hook: keep editor-stack closability in sync as stacks appear. No-op in base. */
  _syncEditorStacksClosable() {}

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
    return this.tabs.map((tab) => tab.contentItem.instance);
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
   * @param {GoldenLayout.Tab} tab - The tab instance that has been created.
   */
  onTermTabCreated(tab) {
    this.term = tab.contentItem.instance;
    tab.contentItem.container.on('destroy', () => {
      this.term = null;
    });
  }

  /**
   * Invoked when the canvas tab is created. Like the terminal, the canvas is a
   * singleton, so we keep a reference to reuse rather than identifying it by a
   * path.
   *
   * @param {GoldenLayout.Tab} tab - The tab instance that has been created.
   */
  onCanvasTabCreated(tab) {
    this.canvas = tab.contentItem.instance;
    tab.contentItem.container.on('destroy', () => {
      this.canvas = null;
    });
  }

  /**
   * Invoked when an image is opened.
   *
   * @param {GoldenLayout.Tab} tab - The tab instance that has been created.
   */
  onImageTabCreated(tab) {
    const imageComponent = tab.contentItem.instance;

    // Layout-internal wiring, registered *before* the component is announced so
    // the layout's own state settles before the controller (and app) react:
    // 'show' marks the tab active (the controller's 'show' forward re-pulls
    // availability, which reads the active tab) and 'destroy' runs the
    // last-editor bookkeeping.
    imageComponent.addEventListener('show', () => this.setActiveEditor(imageComponent));
    imageComponent.addEventListener('destroy', () => this.onTabDestroy(imageComponent));

    // Announce the component; the controller subscribes to its events and
    // forwards them to the app. Emitted last so the listeners above are set.
    this.delegate.onImageCreated(imageComponent);
  }

  /**
   * Invoked when a text file is opened.
   *
   * @param {GoldenLayout.Tab} tab - The tab instance that has been created.
   */
  onEditorTabCreated(tab) {
    const editorComponent = tab.contentItem.instance;

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
   * @param {GoldenLayout.Tab} tab - The tab instance to register.
   */
  registerTab(tab) {
    // If the current active tab is not set, set it to the current tab.
    // When the layout is loaded from local storage, the first tab that will be
    // created by GoldenLayout is the one the user has opened. Additionally, the
    // active tab will be overridden when another editor becomes active.
    if (!this.getActiveEditor()) {
      this.setActiveEditor(tab.contentItem.instance);
    }

    // The onTabCreated is *also* triggered when a user is dragging tabs around,
    // thus if the tab is already in the list, we return early.
    const newTabInstance = tab.contentItem.instance;
    const tabExists = this.tabs.some((existingTab) => {
      return existingTab.contentItem.instance === newTabInstance;
    });
    if (tabExists) return;

    // Add a regular component to the tabs list.
    // Remove the tab from the list when it is destroyed.
    this.tabs.push(tab);
    tab.contentItem.container.on('destroy', () => {
      this.tabs.splice(this.tabs.indexOf(tab), 1);
    });
  }

  /**
   * Callback function when a new tab has been created in the layout.
   *
   * @param {GoldenLayout.Tab} tab - The tab instance that has been created.
   */
  onTabCreated(tab) {
    if (tab.contentItem.isTerminal) {
      this.onTermTabCreated(tab);
    } else if (tab.contentItem.isImage) {
      this.registerTab(tab);
      this.onImageTabCreated(tab);
    } else if (tab.contentItem.isEditor) {
      this.registerTab(tab);
      this.onEditorTabCreated(tab);
    } else if (tab.contentItem.isCanvas) {
      this.registerTab(tab);
      this.onCanvasTabCreated(tab);
    } else {
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
      target?.addChild(this._createEditorTab());
    }
  }

  /**
   * Create a new editor tab with provided config, or default to Untitled.
   *
   * @param {GoldenLayout.ContentItem} config - Content item config object.
   * @returns {object} - Fully configured object.
   */
  _createEditorTab(config = {}) {
    const { componentState, ...rest } = config;
    return {
      type: 'component',
      componentName: 'editor',
      title: 'Untitled',
      ...rest,
      componentState: {
        fontSize: this.fontSize,
        theme: this.theme,
        ...componentState
      },
    };
  }

  /**
   * Callback when the layout is initialised and a stack is created.
   *
   * There are two stacks in some layouts: one for the code editors, and
   * one for the terminal. Here, we're interested in the code editor stack.
   *
   * @param {GoldenLayout.Stack} stack - Object representing the root structure.
   * @param {object} options - Options passed to the layout.
   */
  onStackCreated(stack, options) {
    // Seed the initial stack references from the default config's ids. These are
    // only the *initial* single stacks; once either area is split they may go
    // stale, so runtime logic uses the dynamic area getters / `_terraArea` tags
    // instead. They remain handy fallbacks for the common unsplit case.
    if (stack.config.id === 'editorStack') {
      this.editorStack = stack;
    }
    if (stack.config.id === 'outputStack') {
      this.outputStack = stack;
    }

    // Track the active tab for every stack (the editor area may be split into
    // several stacks). This also marks images active, which do not get focus.
    stack.on('activeContentItemChanged', (param) => {
      // Only editors and images become the "active editor"; the terminal and
      // the (pure output) canvas must not, or activating one would leave the
      // run button reading a non-runnable tab.
      const component = param?.container?.getComponent?.();
      if (['editor', 'image'].includes(component?.getComponentName?.())) {
        this.setActiveEditor(component);
      }
    });

    // Keep editor-stack closability in sync as stacks appear (initial load and
    // splits): non-closable while a single editor stack, closable once split.
    this._syncEditorStacksClosable();
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
      tab.contentItem.container.emit(event, data);
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
    stack.addChild(
      this._createEditorTab({
        title: filename,
        componentState: { path: filepath },
        componentName: isImage ? 'image' : 'editor',
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

    this.getOutputStack().addChild({
      type: 'component',
      componentName: 'canvas',
      title,
      isClosable: false, // Like a terminal tab.
    });

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

  /** @returns {?GoldenLayout.ContentItem} The root row/column holding the stacks. */
  getMainContainer() {
    return this.root?.contentItems?.[0] ?? null;
  }

  /**
   * Every leaf stack in the layout, in tree (visual) order.
   *
   * @returns {GoldenLayout.Stack[]}
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
    return stack.contentItems.some((item) => item.config.componentName === 'editor');
  }

  /** @returns {boolean} Whether the stack holds output tab(s) (terminal/canvas/image). */
  _isOutputStack(stack) {
    return stack.contentItems.some((item) => item.config.componentName !== 'editor');
  }

  /** @returns {?GoldenLayout.Stack} The first (topmost/leftmost) output stack. */
  _firstOutputStack() {
    return this._allStacks().find((stack) => this._isOutputStack(stack)) ?? null;
  }

  /**
   * The stack new editor tabs should open in: the most recently active editor's
   * stack when it is still attached, else the first editor stack.
   *
   * @returns {?GoldenLayout.Stack}
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
   * @returns {?GoldenLayout.Stack}
   */
  getOutputStack() {
    if (this.term) return this.term.container.parent.parent;
    return this._firstOutputStack() || this.outputStack || this.editorStack;
  }
}
