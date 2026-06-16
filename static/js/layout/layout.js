import { BASE_FONT_SIZE } from '../constants.js';
import {
  isImageExtension,
  isObject,
  mergeObjects,
  eventTargetMixin,
  seconds,
} from '../helpers/shared.js';
import ImageComponent from './image.component.js';
import EditorComponent from './editor.component.js';
import TerminalComponent from './term.component.js';
import { triggerPluginEvent } from '../plugin-manager.js';
import {
  setLocalStorageItem,
  getLocalStorageItem
} from '../local-storage-manager.js';
import Terra from '../terra.js';

/**
 * Current version of the default layout config. Increase if breaking changes
 * require all users to reload a fresh config.
 */
const LAYOUT_CONFIG_VERSION = 3;

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

export default class Layout extends eventTargetMixin(GoldenLayout) {
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
   * Only for the Exam app we will have only one programming language,
   * which we bind in the layout class, in order to check whether we should
   * render additional config buttons.
   * @type {string}
   */
  proglang = null;

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
   * Handler for terminal-level key shortcuts, provided by the app and injected
   * into the terminal component. Null until the app sets it.
   * @type {?function}
   */
  onTerminalKey = null;

  /**
   * Default terminal startup message.
   * Each element in the array is written on a separate line.
   * @type {array}
   */
  termStartupMessage = [
    'Click the "Run" button to execute code.',
    'Click the trash bin icon to clear this terminal screen.'
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
   * @type {TabComponent}
   */
  activeTab = null;

  constructor(additionalLayoutConfig, options = {}) {
    let layoutConfig = getLocalStorageItem('layout');

    const layoutConfigVersion = getLocalStorageItem('layout-version');
    const layoutConfigVersionNumber = parseInt(layoutConfigVersion, 10);

    if (
      !layoutConfig ||
      options.forceDefaultLayout ||
      isNaN(layoutConfigVersionNumber) ||
      layoutConfigVersionNumber < LAYOUT_CONFIG_VERSION
    ) {
      // Load default config.
      layoutConfig = mergeObjects(DEFAULT_LAYOUT_CONFIG, additionalLayoutConfig);
      setLocalStorageItem('layout-version', LAYOUT_CONFIG_VERSION)
    } else {
      // Load previous config from user's storage.
      layoutConfig = JSON.parse(layoutConfig);
    }

    super(layoutConfig, $('#layout'));

    this.proglang = options.proglang;
    this.vertical = options.vertical;

    if (isObject(options.hiddenFiles)) {
      this.hiddenFiles = options.hiddenFiles;
    }

    if (isObject(options.buttonConfig)) {
      this.buttonConfig = options.buttonConfig;
    }

    this.on('stateChanged', () => {
      if (this.isInitialised) {
        this.onStateChanged();
      }
    });

    this.on('initialised', () => this.onInitialised(options));
    this.on('stackCreated', (stack) => this.onStackCreated(stack, options));
    this.on('tabCreated', (tab) => this.onTabCreated(tab));

    this.registerComponent('image', ImageComponent);
    this.registerComponent('editor', EditorComponent);

    // Inject the terminal key handler (set by the app) so the component never
    // reaches out to the app itself. A plain function is used (not an arrow) so
    // GoldenLayout can `new` it; returning an object makes `new` yield it.
    const layout = this;
    this.registerComponent('terminal', function (container, state) {
      return new TerminalComponent(container, state, {
        onKeyEvent: (event) => layout.onTerminalKey?.(event),
      });
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
    this.setTheme(getLocalStorageItem('theme') || 'light');
    this.renderButtons();
    this.showTermStartupMessage();
    triggerPluginEvent('onLayoutLoaded');

    if (Array.isArray(options.autocomplete) && options.autocomplete.every(isObject)) {
      this.emitToTabComponents('setCustomAutocompleter', options.autocomplete);
    }

    if (this.vertical) {
      this.emitToAllComponents('verticalLayout');
    }
  }

  /**
   * Register commands for the editor component.
   *
   * @param {EditorComponent} editorComponent - The editor component instance.
   */
  registerEditorCommands(editorComponent) {
    editorComponent.addCommands([
      {
        name: 'run',
        bindKey: { win: 'Ctrl+Enter', mac: 'Command+Enter' },
        exec: () => this.onRunCodeButtonClick(),
      },
    ]);
  }

  /**
   * Retrieve components from the layout.
   *
   * @returns {TabComponent[]} List containing all open tab components.
   */
  getTabComponents() {
    return this.tabs.map((tab) => tab.contentItem.instance);
  }

  /**
   * Retrieve all editor components from the layout.
   *
   * @returns {EditorComponent[]} List containing all open editor tabs' components.
   */
  getEditorComponents() {
    return this.getTabComponents().filter((component) => component instanceof EditorComponent);
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

    // Bind event listeners to custom image component events.
    // key = local editor event name
    // value = external event name that the app will listen to
    const events = {
      'show': 'onImageSwitchedTo',
      'vfsChanged': 'onImageReloadRequested',
    }

    for (const [internalEventName, externalEventName] of Object.entries(events)) {
      imageComponent.addEventListener(internalEventName, () => {
        this.dispatchEvent(new CustomEvent(externalEventName, {
          detail: { tabComponent: imageComponent }
        }));
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

    // Bind event listeners to custom editor component events.
    // key = local editor event name
    // value = external event name that the app will listen to
    const events = {
      'startEditing': 'onEditorEditingStarted',
      'stopEditing': 'onEditorEditingStopped',
      'change': 'onEditorTextChanged',
      'show': 'onEditorSwitchedTo',
      'vfsChanged': 'onEditorReloadRequested',
    }

    for (const [internalEventName, externalEventName] of Object.entries(events)) {
      editorComponent.addEventListener(internalEventName, () => {
        this.dispatchEvent(new CustomEvent(externalEventName, {
          detail: { tabComponent: editorComponent }
        }));
      });
    }

    editorComponent.addEventListener('focus', () => this.onEditorFocus(editorComponent));
    editorComponent.addEventListener('destroy', () => this.onTabDestroy());

    // Seems redundant
    // editorComponent.addCommands([
    //   {
    //     name: 'new-file',
    //     bindKey: {win: 'Ctrl-N', mac: 'Ctrl-N'},
    //     exec: () => {
    //       fileTreeManager.createFile();
    //     }
    //   },
    //   {
    //     name: 'new-folder',
    //     bindKey: {win: 'Ctrl-Shift-N', mac: 'Ctrl-Shift-N'},
    //     exec: () => {
    //       fileTreeManager.createFolder();
    //     }
    //   },
    // ])
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
    if (!this.activeTab) {
      this.activeTab = tab.contentItem.instance;
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
   * @param {EditorComponent} editorComponent
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
    return({
      type: 'component',
      componentName: 'editor',
      title: 'Untitled',
      componentState: {
        fontSize: BASE_FONT_SIZE,
        ...config.componentState
      },
      ...config,
    });
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
          this.activeTab = param.container.getComponent();
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
    if (this.proglang === 'py' && isObject(this.buttonConfig)) {
      Object.keys(this.buttonConfig).forEach((name) => {
        const id = name.replace(/\s/g, '-').toLowerCase();
        const selector = `#${id}`;

        let cmd = this.buttonConfig[name];
        if (!Array.isArray(cmd)) {
          cmd = cmd.split('\n');
        }

        $(this.buttonContainerSelector)
          .append(`<button id="${id}" class="button config-btn ${id}-btn">${name}</button>`);

        $(selector).click(() => Terra.app.runButtonCommand(selector, cmd));
      });
    }
  }

  /**
   * Add active states in the UI for certain dropdowns.
   */
  addActiveStates() {
    // Add active state to font-size dropdown.
    const $fontSizeMenu = $('#font-size-menu');
    const currentFontSize = getLocalStorageItem('font-size', BASE_FONT_SIZE);
    $fontSizeMenu.find(`li[data-val=${currentFontSize}]`).addClass('active');

    // Add active state to theme dropdown.
    const currentTheme = getLocalStorageItem('theme') || 'light';
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
   * Invoked on any change happening inside the internal GoldenLayout structure.
   */
  onStateChanged() {
    const config = this.toConfig();
    const state = JSON.stringify(config);
    setLocalStorageItem('layout', state);
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
    setLocalStorageItem('theme', theme);
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
    return parseInt(getLocalStorageItem('font-size', BASE_FONT_SIZE));
  }

  changeFontSize(newSize) {
    newSize = Math.max(8, Math.min(72, newSize));
    this.emitToAllComponents('fontSizeChanged', newSize);
    setLocalStorageItem('font-size', newSize);
    const $items = $('#font-size-menu').find('li[data-val]');
    $items.removeClass('active');
    $items.filter(`[data-val="${newSize}"]`).addClass('active');
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
    this.dispatchEvent(new CustomEvent('runCode', {
      detail: { clearTerm: false },
    }));
  }

  /**
   * Callback when the user clicks the clear-term button.
   */
  onClearTermButtonClick() {
    Terra.app.clearTerminal();
  }

  /**
   * Set the active editor component.
   *
   * @param {EditorComponent} editorComponent - The editor component to set as active.
   */
  setActiveEditor(editorComponent) {
    this.activeTab = editorComponent;
  }

  /**
   * Get the active editor component.
   *
   * @returns {EditorComponent} - The active editor component.
   */
  getActiveEditor() {
    return this.activeTab;
  }

  /**
   * Change the run-code button to a stop-code button if the code
   * does not finish immediately (potentially infinite loop scenario).
   */
  checkForStopCodeButton() {
    this.showStopCodeButtonTimeoutId = setTimeout(() => {
      const $button = $('#run-code');
      const newText = $button.text().replace('Run', 'Stop');
      $button.text(newText)
        .prop('disabled', false)
        .removeClass('primary-btn')
        .addClass('danger-btn');
    }, seconds(0.2));
  }

  /**
   * Change the stop-code button back to a run-code button.
   */
  onRunEnded({ disableRunBtn }) {
    const $button = $('#run-code');
    const newText = $button.text().replace('Stop', 'Run');
    $button.text(newText)
      .prop('disabled', disableRunBtn)
      .addClass('primary-btn')
      .removeClass('danger-btn');

    if (!disableRunBtn) {
      $('.config-btn').prop('disabled', false);
    }

    if (this.showStopCodeButtonTimeoutId) {
      clearTimeout(this.showStopCodeButtonTimeoutId);
      this.showStopCodeButtonTimeoutId = null;
    }
  }

  /**
   * Re-point an open tab at a new file path: update its path/title, apply the
   * caller-supplied syntax highlighting for editor tabs, and persist the layout
   * state. The proglang is derived by the caller; it is ignored for non-editor
   * tabs such as images.
   *
   * @param {TabComponent} tabComponent - The tab to re-point.
   * @param {string} filepath - The new absolute file path.
   * @param {string} proglang - The programming language for the editor tab.
   */
  repointTab(tabComponent, filepath, proglang) {
    tabComponent.setPath(filepath); // also updates the title + container state

    if (tabComponent instanceof EditorComponent) {
      tabComponent.setProgLang(proglang);
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
   * @param {string} proglang - The programming language for the editor tab.
   * @returns {?TabComponent} The repointed tab, or null when no tab matched.
   */
  repointTabByPath(srcPath, destPath, proglang) {
    const tabComponent = this.getTabComponents().find(
      (component) => component.getPath() === srcPath
    );
    if (!tabComponent) return null;

    this.repointTab(tabComponent, destPath, proglang);
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
