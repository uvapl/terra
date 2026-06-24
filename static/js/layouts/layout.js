import { BASE_FONT_SIZE, DEMO_FONT_SIZE } from '../constants.js';
import {
  isImageExtension,
  isObject,
  mergeObjects,
} from '../lib/helpers.js';
import ImageTab from '../components/image.tab.js';
import EditorTab from '../components/editor.tab.js';
import TerminalTab from '../components/terminal.tab.js';
import { triggerPluginEvent } from '../plugin-manager.js';
import commands from '../commands.js';

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
          type: 'stack',
          id: 'editorStack',
          isClosable: false,
        },
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
   * The button config only available in the Exam app.
   * @type {object}
   */
  buttonConfig = null;

  /**
   * Wether to show a vertical layout where the terminal is below the editor
   * instead of the horizontal layout where the terminal is on the right.
   * @type {boolean}
   */
  vertical = false;

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
    const layoutConfig = options.restoredConfig
      || mergeObjects(DEFAULT_LAYOUT_CONFIG, additionalLayoutConfig);

    super(layoutConfig, $('#layout'));

    this.vertical = options.vertical;
    this.theme = options.theme || 'light';

    if (isObject(options.hiddenFiles)) {
      this.hiddenFiles = options.hiddenFiles;
    }

    if (isObject(options.buttonConfig)) {
      this.buttonConfig = options.buttonConfig;
    }

    this.on('initialised', () => this.onInitialised(options));
    this.on('stackCreated', (stack) => this.onStackCreated(stack, options));
    this.on('tabCreated', (tab) => this.onTabCreated(tab));

    this.registerComponent('image', ImageTab);
    this.registerComponent('editor', EditorTab);

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
    this.emitToAllComponents('afterFirstRender');
    this.setTheme(this.theme);
    this.renderButtons();
    this.showTermStartupMessage();
    triggerPluginEvent('onLayoutLoaded');

    if (Array.isArray(options.autocomplete) && options.autocomplete.every(isObject)) {
      this.emitToTabComponents('setCustomAutocompleter', options.autocomplete);
    }

    if (this.vertical) {
      this.emitToAllComponents('verticalLayout');
    }

    // The run button now exists; tell the controller the layout is ready so it
    // (via the app) can spawn the language worker for the active tab and sync
    // the run button. Replaces the app's old `.on('initialised')` worker hook.
    this.delegate?.onReady?.();
  }

  /**
   * Keyboard shortcuts for editor tabs, for all variants of the app.
   *
   * @param {EditorTab} editorComponent
   */
  registerEditorCommands(editorComponent) {
    // Apply editor-scope commands declared in the registry (core + plugins).
    commands.registerEditorCommands(editorComponent);
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

    // Forward custom image component events to the controller delegate.
    // key = local component event name
    // value = delegate method the controller forwards to the app
    const events = {
      'show': 'onImageSwitchedTo',
      'vfsChanged': 'onImageReloadRequested',
    }

    for (const [internalEventName, delegateMethod] of Object.entries(events)) {
      imageComponent.addEventListener(internalEventName, () => {
        this.delegate?.[delegateMethod]?.(imageComponent);
      });
    }

    imageComponent.addEventListener('destroy', () => this.onTabDestroy());
  }

  /**
   * Invoked when a text file is opened.
   *
   * @param {GoldenLayout.Tab} tab - The tab instance that has been created.
   */
  onEditorTabCreated(tab) {
    const editorComponent = tab.contentItem.instance;

    this.registerEditorCommands(editorComponent);

    // Forward custom editor component events to the controller delegate.
    // key = local component event name
    // value = delegate method the controller forwards to the app
    const events = {
      'startEditing': 'onEditorEditingStarted',
      'stopEditing': 'onEditorEditingStopped',
      'change': 'onEditorTextChanged',
      'show': 'onEditorSwitchedTo',
      'vfsChanged': 'onEditorReloadRequested',
    }

    for (const [internalEventName, delegateMethod] of Object.entries(events)) {
      editorComponent.addEventListener(internalEventName, () => {
        this.delegate?.[delegateMethod]?.(editorComponent);
      });
    }

    editorComponent.addEventListener('focus', () => this.onEditorFocus(editorComponent));
    editorComponent.addEventListener('destroy', () => this.onTabDestroy());
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
    } else {
      console.warn('Unknown tab type:', tab.contentItem);
    }
  }

  /**
   * Callback when an editor is focused.
   *
   * @param {EditorTab} editorComponent
   */
  onEditorFocus(editorComponent) {
    this.setActiveEditor(editorComponent);
  }

  /**
   * Callback when a tab is about to be destroyed.
   */
  onTabDestroy() {
    // If it's the last tab being closed, then we insert another 'Untitled' tab,
    // because we always need at least one tab open.
    const tabComponents = this.getTabComponents();

    if (tabComponents.length === 1 && !this.resetLayout) {
      tabComponents[0].container.parent.parent.addChild(
        this._createEditorTab()
      );
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
    // When we find a newly made code editor stack, register it locally
    // and use it to keep track of the currently selected tab.
    if (stack.config.id === 'editorStack') {
      this.editorStack = stack;

      // This partially duplicates what happens in onEditorFocus, but
      // it's needed to be able to close image tabs, which do not get focus.
      this.editorStack.on('activeContentItemChanged', (param) => {
        if (typeof param.container.getComponent === 'function') {
          this.setActiveEditor(param.container.getComponent());
        }
      });
    }
  }

  /**
   * Selector for the container that holds the run/clear/plugin action buttons.
   *
   * Defaults to the terminal component header. When a navbar toolbar is present
   * (the IDE), the buttons live there instead so they read as a single mini
   * toolbar aligned to the right of the navbar.
   *
   * @returns {string}
   */
  get buttonContainerSelector() {
    return $('.navbar-toolbar').length
      ? '.navbar-toolbar'
      : '.terminal-component-container .lm_header';
  }

  /**
   * Render the config buttons through the app config.
   */
  renderConfigButtons() {
    if (isObject(this.buttonConfig)) {
      Object.keys(this.buttonConfig).forEach((name) => {
        const id = name.replace(/\s/g, '-').toLowerCase();
        const selector = `#${id}`;

        let cmd = this.buttonConfig[name];
        if (!Array.isArray(cmd)) {
          cmd = cmd.split('\n');
        }

        $(this.buttonContainerSelector)
          .append(`<button id="${id}" class="button config-btn ${id}-btn">${name}</button>`);

        $(selector).click(() => this.delegate?.onConfigButtonCommand?.(selector, cmd));
      });
    }
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
  }

  /**
   * Display the terminal startup message.
   */
  showTermStartupMessage() {
    for (const line of this.termStartupMessage) {
      this.term.write(line + '\n');
    }

    this.term.write('\n');
  }

  /**
   * Emit an event (optionally with data) to all components in the layout.
   *
   * @param {string} event - The event name.
   * @param {object} data - Data object to pass along with the event.
   */
  emitToAllComponents(event, data) {
    this.emitToTabComponents(event, data);
    this.term.emit(event, data);
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
   * Retrieve the HTML for the run code button.
   *
   * @returns {string}
   */
  getRunCodeButtonHtml() {
    // Rendered disabled by default; enabled once a supported language's worker
    // is ready (or when switching to a runnable tab). Prevents the button from
    // being clickable for a non-runnable initial tab such as an Untitled file.
    return `<button id="run-code" class="button primary-btn run-user-code-btn" disabled>Run</button>`;
  };

  /**
   * Retrieve the HTML for the clear terminal button.
   *
   * @returns {string}
   */
  getClearTermButtonHtml() {
    return `<button id="clear-term" class="button clear-term-btn" title="Clear terminal"></button>`;
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
  renderButtons() {
    console.info('renderButtons() is not implemented');
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
    $('#run-code').off('click.layout').on('click.layout', () => this.onRunCodeButtonClick());
    $('#clear-term').off('click.layout').on('click.layout', () => this.onClearTermButtonClick());

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
   * Callback when the user clicks the run-code button or pressed ctrl/cmd+enter.
   */
  onRunCodeButtonClick() {
    this.delegate?.onRunCode?.({ clearTerm: false });
  }

  /**
   * Callback when the user clicks the clear-term button.
   */
  onClearTermButtonClick() {
    this.delegate?.onClearTerm?.();
  }

  /**
   * Set the active editor component.
   *
   * @param {EditorTab} editorComponent - The editor component to set as active.
   */
  setActiveEditor(editorComponent) {
    this.activeEditor = editorComponent;
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
   * Set the run button to 'run' or 'stop' presentation. Mechanical primitive:
   * the layout owns the button DOM but knows nothing about run lifecycle — the
   * controller decides when to switch modes.
   *
   * @param {'run'|'stop'} mode
   */
  setRunButtonMode(mode) {
    const $button = $('#run-code');
    if (mode === 'stop') {
      $button.text('Stop').removeClass('primary-btn').addClass('danger-btn');
    } else {
      $button.text('Run').removeClass('danger-btn').addClass('primary-btn');
    }
  }

  /**
   * Enable or disable the run button.
   *
   * @param {boolean} enabled
   */
  setRunButtonEnabled(enabled) {
    $('#run-code').prop('disabled', !enabled);
  }

  /**
   * Enable or disable the app-config buttons (Exam/Embed extra run buttons).
   *
   * @param {boolean} enabled
   */
  setConfigButtonsEnabled(enabled) {
    $('.config-btn').prop('disabled', !enabled);
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

    // An empty Untitled tab will be removed before adding the new tab.
    if (this.onlyHasEmptyUntitled?.()) {
      this.resetLayout = true;
      tabComponents[0].close();
      this.resetLayout = false;
    }

    // Add new tab.
    const filename = filepath.split('/').pop();
    this.editorStack.addChild(
      this._createEditorTab({
        title: filename,
        componentState: { path: filepath },
        componentName: isImageExtension(filename) ? 'image' : 'editor',
        isClosable: this.tabsClosable,
      })
    );
  }
}
