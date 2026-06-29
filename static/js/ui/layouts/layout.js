import { BASE_FONT_SIZE, DEMO_FONT_SIZE } from '../../constants.js';
import {
  isImageExtension,
  isObject,
  mergeObjects,
} from '../../lib/helpers.js';
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
          // Closable so an editor stack emptied after a split is auto-removed
          // (merging the split back). At least one editor is still guaranteed by
          // onTabDestroy, which inserts an Untitled when the last editor closes.
          type: 'stack',
          id: 'editorStack',
        },
        {
          type: 'stack',
          id: 'outputStack',
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
   * value and kept in sync by setTheme(); the layout never reads it from
   * storage itself.
   * @type {string}
   */
  theme = 'light';

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

    if (isObject(options.hiddenFiles)) {
      this.hiddenFiles = options.hiddenFiles;
    }

    this.on('initialised', () => this.onInitialised(options));
    this.on('stackCreated', (stack) => this.onStackCreated(stack, options));
    this.on('tabCreated', (tab) => this.onTabCreated(tab));

    this.registerComponent('image', ImageTab);
    this.registerComponent('editor', EditorTab);
    this.registerComponent('canvas', CanvasTab);

    // A plain function is used (not an arrow) so GoldenLayout can `new` it;
    // returning an object makes `new` yield it.
    this.registerComponent('terminal', function (container, state) {
      return new TerminalTab(container, state);
    });

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

  /**
   * Switch the layout orientation at runtime. Captures the full current layout
   * (open editors, terminal, canvas, images — toConfig() keeps the whole tree),
   * flips the root row/column, and reloads through the controller. A no-op when
   * already in the requested orientation.
   *
   * @param {string} orientation - 'horizontal' | 'vertical'.
   */
  setOrientation(orientation) {
    if (orientation !== 'horizontal' && orientation !== 'vertical') return;
    if (this._orientation === orientation) return;

    const config = this.toConfig();
    config.content[0].type = orientation === 'vertical' ? 'column' : 'row';
    this.delegate.loadLayout(config);
  }

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
    this.setTheme(this.theme);
    this.addActiveStates();
    this.addButtonEventListeners();
    this.showTermStartupMessage();
    this.delegate.onLayoutLoaded();

    if (Array.isArray(options.autocomplete) && options.autocomplete.every(isObject)) {
      this.emitToTabComponents('setCustomAutocompleter', options.autocomplete);
    }

    this._tagAreas();
    if (this.renderOutputArrangeControls()) {
      const { sig, firstEl } = this._outputSignature();
      this._outputSig = sig;
      this._outputFirstEl = firstEl;
    }

    // Keep the area tags and the output controls in sync with any structural
    // change (tab add/remove/move, manual split/merge via drag).
    this.on('stateChanged', () => this._scheduleOutputControlsRefresh());
  }

  /**
   * Keyboard shortcuts for editor tabs, for all variants of the app.
   *
   * @param {EditorTab} editorComponent
   */
  registerEditorCommands(editorComponent) {
    // Apply editor-scope commands declared in the registry (core + plugins).
    this.delegate.surfaces.registerEditorCommands(editorComponent);
  }

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
   * Invoked when an image is opened.
   *
   * @param {GoldenLayout.Tab} tab - The tab instance that has been created.
   */
  onImageTabCreated(tab) {
    const imageComponent = tab.contentItem.instance;

    // Mark this tab active as soon as it is shown, before the delegate reacts.
    // Registered first so it runs before the 'show' forwarding below, which
    // triggers an availability re-pull that reads the active tab.
    imageComponent.addEventListener('show', () => this.setActiveEditor(imageComponent));

    // Forward component events to the controller delegate.
    const imageEvents = {
      'show': 'onSwitchToImageTab',
      'hide': 'onImageHidden',
    };

    for (const [event, method] of Object.entries(imageEvents)) {
      imageComponent.addEventListener(event, () => this.delegate[method](imageComponent));
    }

    imageComponent.addEventListener('destroy', () => {
      this.onTabDestroy(imageComponent);
      this.delegate.onImageDestroyed(imageComponent);
    });
  }

  /**
   * Invoked when a text file is opened.
   *
   * @param {GoldenLayout.Tab} tab - The tab instance that has been created.
   */
  onEditorTabCreated(tab) {
    const editorComponent = tab.contentItem.instance;

    this.registerEditorCommands(editorComponent);

    // Mark this tab active as soon as it is shown, before the delegate reacts.
    // Registered first so it runs before the 'show' forwarding below, which
    // triggers an availability re-pull (canRunActiveTab) that reads the active
    // tab — otherwise the re-pull would see the previously active tab.
    editorComponent.addEventListener('show', () => this.setActiveEditor(editorComponent));

    // Forward component events to the controller delegate.
    // Required events: app always implements these (they carry plugin events).
    const requiredEvents = {
      'change': 'onEditorTextChanged',
      'show': 'onSwitchToEditorTab',
      'hide': 'onEditorHidden',
      'lock': 'onEditorLocked',
      'unlock': 'onEditorUnlocked',
      'resize': 'onEditorResized',
    };

    for (const [event, method] of Object.entries(requiredEvents)) {
      editorComponent.addEventListener(event, () => this.delegate[method](editorComponent));
    }

    // Optional events: only some app variants react to these.
    const optionalEvents = {
      'startEditing': 'onEditorEditingStarted',
      'stopEditing': 'onEditorEditingStopped',
    };

    for (const [event, method] of Object.entries(optionalEvents)) {
      editorComponent.addEventListener(event, () => this.delegate?.[method]?.(editorComponent));
    }

    editorComponent.addEventListener('tabDragStop', (e) => {
      this.delegate.onTabDragStopped(e.detail.event, e.detail.tab);
    });

    editorComponent.addEventListener('focus', () => this.onEditorFocus(editorComponent));
    editorComponent.addEventListener('destroy', () => {
      this.onTabDestroy(editorComponent);
      this.delegate.onEditorDestroyed(editorComponent);
    });
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
      // Canvas tabs emit no events, so there is no delegate hook; just track
      // them so they show up in getTabComponents() (used to find/reuse a canvas).
      this.registerTab(tab);
    } else {
      console.warn('Unknown tab type:', tab.contentItem);
    }

    this._scheduleOutputControlsRefresh();
  }

  /**
   * Callback when an editor is focused.
   *
   * @param {EditorTab} editorComponent
   */
  onEditorFocus(editorComponent) {
    this.setActiveEditor(editorComponent);
    this.delegate.onEditorFocused(editorComponent);
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
        fontSize: this.getCurrentFontSize(),
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
      if (typeof param?.container?.getComponent === 'function') {
        this.setActiveEditor(param.container.getComponent());
      }
    });
  }

  /**
   * Add active states in the UI for certain dropdowns.
   */
  addActiveStates() {
    // Add active state to font-size dropdown.
    const $fontSizeMenu = $('#font-size-menu');
    const currentFontSize = this.getCurrentFontSize()
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
   * Callback function when the user selects a new theme, which consequently
   * changes the theme of the layout and all components.
   *
   * @param {string} theme - Either 'dark' or 'light'.
   */
  setTheme(theme) {
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
    this.delegate?.setStoredTheme(theme);
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

  getCurrentFontSize() {
    return this.delegate.getStoredFontSize();
  }

  changeFontSize(newSize) {
    newSize = Math.max(8, Math.min(72, newSize));
    this.emitToAllComponents('fontSizeChanged', newSize);
    this.delegate.setStoredFontSize(newSize);
    const $items = $('#font-size-menu').find('li[data-val]');
    $items.removeClass('active');
    $items.filter(`[data-val="${newSize}"]`).addClass('active');
  }

  increaseFontSize() {
    this.changeFontSize(this.getCurrentFontSize() + 1);
  }

  decreaseFontSize() {
    this.changeFontSize(this.getCurrentFontSize() - 1);
  }

  setFontSizeDefault() {
    this.changeFontSize(BASE_FONT_SIZE);
  }

  setFontSizeDemo() {
    this.changeFontSize(DEMO_FONT_SIZE);
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
    // (buildToolbar / renderButton), not here.

    // Update font-size for all components on change.
    $('#font-size-menu').find('li[data-val]').off('click.layout').on('click.layout', (event) => {
      this.changeFontSize(parseInt($(event.target).data('val')));
    });

    // Update theme on change.
    $('#editor-theme-menu').find('li').off('click.layout').on('click.layout', (event) => {
      const $element = $(event.target);
      this.setTheme($element.data('val'));
      $element.addClass('active').siblings().removeClass('active');
    });

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
    const tabComponent = this.getTabComponents().find(
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
    let tabComponents = this.getTabComponents();

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

    // Opening a real editor file replaces a lone empty Untitled editor. Images
    // open in the output stack, so they leave the editor stack untouched.
    if (!isImage && this.onlyHasEmptyUntitled?.()) {
      this.resetLayout = true;
      tabComponents[0].close();
      this.resetLayout = false;
    }

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
  }

  /**
   * Open a canvas output tab, or reuse the existing one with the same synthetic
   * path. The path is not a real file; it only identifies the canvas so repeated
   * calls reuse the same tab instead of stacking up duplicates. The canvas opens
   * next to the terminal (falling back to the editor stack if there is no
   * terminal).
   *
   * @param {object} opts
   * @param {string} opts.title - The tab title.
   * @param {string} opts.path - Synthetic identifier, e.g. '/.canvas/karel'.
   * @returns {CanvasTab} The (new or reused) canvas component instance.
   */
  addCanvasTab({ title, path }) {
    // Reuse an existing canvas with the same synthetic path.
    const existing = this.getTabComponents().find(
      (component) => component.getPath() === path
    );
    if (existing) {
      existing.setActive();
      return existing;
    }

    this.getOutputStack().addChild({
      type: 'component',
      componentName: 'canvas',
      title,
      componentState: { path },
      isClosable: this.tabsClosable,
    });

    // GoldenLayout creates the component synchronously during addChild, so the
    // instance is now retrievable from the tracked tab list.
    return this.getTabComponents().find(
      (component) => component.getPath() === path
    );
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
   * Stamp every stack with a `_terraArea` marker ('editor' | 'output') based on
   * its content, so the drag constraint can tell which area a drop target
   * belongs to regardless of how the tree is split or flattened. Empty stacks
   * (transient mid-drag) keep their previous tag.
   */
  _tagAreas() {
    this._allStacks().forEach((stack) => {
      if (this._isEditorStack(stack)) stack._terraArea = 'editor';
      else if (stack.contentItems.length > 0) stack._terraArea = 'output';
    });
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

  /** @returns {boolean} Whether the output tabs are spread across multiple stacks. */
  isOutputSplit() {
    return this._allStacks().filter((stack) => this._isOutputStack(stack)).length > 1;
  }

  /**
   * Resolve a live stack to drop a dragged tab into when it was released with no
   * valid target (the drag constraint's safety net). Returns null to leave
   * GoldenLayout's normal revert in place when the tab's original stack is still
   * alive; otherwise returns a stack of the tab's kind (creating a fresh one in
   * the main container if its area was emptied and removed mid-drag), so the tab
   * is never lost.
   *
   * @param {GoldenLayout.ContentItem} contentItem - The dragged tab.
   * @param {?GoldenLayout.Stack} originalParent - The tab's stack at drag start.
   * @returns {?GoldenLayout.Stack}
   */
  ensureDropHome(contentItem, originalParent) {
    const stacks = this._allStacks();

    // Original stack still in the tree: let GoldenLayout revert there as usual.
    if (originalParent && stacks.includes(originalParent)) return null;

    const isEditor = contentItem?.config?.componentName === 'editor';
    const home = stacks.find((stack) => isEditor ? this._isEditorStack(stack) : this._isOutputStack(stack));
    if (home) return home;

    // No stack of this kind remains: add a fresh non-closable stack to the main
    // container (editors first, output last) for the tab to land in.
    const main = this.getMainContainer();
    if (!main) return null;

    const index = isEditor ? 0 : main.contentItems.length;
    main.addChild({ type: 'stack', isClosable: false }, index);
    return main.contentItems[index] ?? null;
  }

  /**
   * Rearrange the output tabs, leaving the editor stacks untouched. 'stacked'
   * collapses the output tabs into one stack; 'split' gives each its own stack
   * laid out perpendicular to the main orientation (a row when the layout is
   * vertical, a column when horizontal — perpendicular nesting survives
   * GoldenLayout's same-axis flattening). Rebuilt from the full config and
   * reloaded through the controller, so it works from any current arrangement.
   *
   * @param {string} mode - 'stacked' | 'split'.
   */
  arrangeOutput(mode) {
    const config = this.toConfig();
    const root = config.content[0];
    if (!root?.content) return;

    // Each root child is "pure" (only editors or only output), so classify the
    // children, keep the editor ones verbatim, and rebuild a single output node.
    const containsOutput = (node) => {
      if (!node) return false;
      if (node.type === 'component') return node.componentName !== 'editor';
      return (node.content || []).some(containsOutput);
    };
    const collectOutputs = (node, out) => {
      if (!node) return;
      if (node.type === 'component') { if (node.componentName !== 'editor') out.push(node); return; }
      (node.content || []).forEach((child) => collectOutputs(child, out));
    };

    const outputs = [];
    root.content.filter(containsOutput).forEach((child) => collectOutputs(child, outputs));
    if (outputs.length === 0) return;

    const outputNode = (mode === 'split' && outputs.length > 1)
      ? {
          type: this.vertical ? 'row' : 'column',
          id: 'outputStack',
          content: outputs.map((component) => ({ type: 'stack', content: [component] })),
        }
      : { type: 'stack', id: 'outputStack', content: outputs };

    // Editor children first (left/top), the rebuilt output node last (right/bottom).
    root.content = [...root.content.filter((child) => !containsOutput(child)), outputNode];

    this.delegate.loadLayout(config);
  }

  /**
   * Re-tag the areas and, when the output structure actually changed, re-render
   * the output controls. Coalesced to once per tick so bursts of GoldenLayout
   * `stateChanged` events (e.g. typing, or dragging a splitter) collapse to one
   * pass — and the signature guard skips the DOM work entirely when only
   * content changed.
   */
  _scheduleOutputControlsRefresh() {
    if (this._outputRefreshScheduled) return;
    this._outputRefreshScheduled = true;
    setTimeout(() => {
      this._outputRefreshScheduled = false;
      this._tagAreas();

      const { sig, firstEl } = this._outputSignature();
      if (sig === this._outputSig && firstEl === this._outputFirstEl) return;

      // Cache only on a successful render, so a transient miss (controls not yet
      // in the DOM) is retried on the next structural change rather than poisoning
      // the cache and leaving the toggle permanently missing.
      if (this.renderOutputArrangeControls()) {
        this._outputSig = sig;
        this._outputFirstEl = firstEl;
      }
    });
  }

  /**
   * A signature of what determines the output toggle: whether the output is
   * split, the number of extra output tabs (visibility), and the first output
   * stack element (where the toggle is anchored).
   *
   * @returns {{ sig: string, firstEl: ?Element }}
   */
  _outputSignature() {
    const firstStack = this._firstOutputStack();
    const firstEl = firstStack?.element?.[0] ?? null;
    const extra = this.getTabComponents().filter(
      (c) => c instanceof ImageTab || c instanceof CanvasTab
    ).length;
    return { sig: `${this.isOutputSplit()}|${extra}`, firstEl };
  }

  /**
   * Render the single split/merge toggle into the controls of the topmost or
   * leftmost output stack. The button reflects the current state: it splits the
   * output when it is a single stack, and merges it back when it is split. Shown
   * only when the output area holds more than one tab. Idempotent.
   *
   * Returns false (without disturbing any existing button) when the target
   * controls element is not in the DOM yet, so a transient miss never destroys a
   * good toggle.
   *
   * @returns {boolean} Whether the toggle was (re)rendered.
   */
  renderOutputArrangeControls() {
    const firstStack = this._firstOutputStack();
    const $controls = firstStack
      ? $(firstStack.element).children('.lm_header').children('.lm_controls').first()
      : $();
    if ($controls.length === 0) return false;

    $('.output-arrange').remove();

    const split = this.isOutputSplit();
    const action = split ? 'stacked' : 'split';
    const icon = split ? '▤' : (this.vertical ? '▥' : '⬓');
    const title = split ? 'Merge the output tabs into one stack' : 'Split the output tabs';

    const $group = $(`
      <span class="output-arrange">
        <button type="button" class="output-arrange-btn" data-arrange="${action}"
          title="${title}">${icon}</button>
      </span>
    `);

    $group.on('click', '.output-arrange-btn', (event) => {
      this.arrangeOutput($(event.currentTarget).data('arrange'));
    });

    $controls.prepend($group);
    this.updateOutputControlsVisibility();
    return true;
  }

  /**
   * Show the output split/merge toggle only when the output area holds more than
   * one tab (i.e. the terminal plus at least one canvas/image).
   */
  updateOutputControlsVisibility() {
    const hasExtraOutput = this.getTabComponents().some(
      (component) => component instanceof ImageTab || component instanceof CanvasTab
    );
    $('.output-arrange').toggleClass('hidden', !hasExtraOutput);
  }
}
