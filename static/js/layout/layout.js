import { BASE_FONT_SIZE } from '../constants.js';
import {
  isMac,
  isObject,
  mergeObjects,
  eventTargetMixin,
  seconds,
} from '../helpers/shared.js';
import ImageComponent from './image.component.js';
import EditorComponent from './editor.component.js';
import TerminalComponent from './term.component.js';
import pluginManager from '../plugin-manager.js';
import localStorageManager from '../local-storage-manager.js';
import Terra from '../terra.js';

/**
 * Current version of the default layout config. Increase if breaking changes
 * require all users to reload a fresh config.
 */
const LAYOUT_CONFIG_VERSION = 2;

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
    let layoutConfig = localStorageManager.getLocalStorageItem('layout');

    const layoutConfigVersion =
      localStorageManager.getLocalStorageItem('layoutVersion');
    const layoutConfigVersionNumber = parseInt(layoutConfigVersion, 10);

    if (
      !layoutConfig ||
      options.forceDefaultLayout ||
      isNaN(layoutConfigVersionNumber) ||
      layoutConfigVersionNumber < LAYOUT_CONFIG_VERSION
    ) {
      // Load default config.
      layoutConfig =
        mergeObjects(DEFAULT_LAYOUT_CONFIG, additionalLayoutConfig);
      localStorageManager.setLocalStorageItem('layoutVersion',
        LAYOUT_CONFIG_VERSION)
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
    this.registerComponent('terminal', TerminalComponent);

    $(window).on('resize', () => {
      this.updateSize(window.innerWidth, window.innerHeight);
    });
  }

  /**
   * Executed after the layout has been initialised.
   *
   * @param {object} options - Options passed to the layout.
   */
  onInitialised(options) {
    this.emitToAllComponents('afterFirstRender');
    this.setTheme(localStorageManager.getLocalStorageItem('theme') || 'light');
    this.renderButtons();
    this.showTermStartupMessage();
    pluginManager.triggerEvent('onLayoutLoaded');

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
      {
        name: 'save',
        bindKey: { win: 'Ctrl+S', mac: 'Command+S' },
        exec: () => {
          // Literally do nothing here, because by default, we want to prevent
          // the user (accidentally) saving the file with <cmd/ctrl + s>, which
          // triggers the native browser save-file popup window.
        }
      },
      {
        name: 'moveLinesUp',
        bindKey: { win: 'Ctrl+Alt+Up', mac: 'Command+Option+Up' },
        exec: () => editorComponent.moveLinesUp(),
      },
      {
        name: 'moveLinesDown',
        bindKey: { win: 'Ctrl+Alt+Down', mac: 'Command+Option+Down' },
        exec: () => editorComponent.moveLinesDown(),
      }
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
   * Get all file IDs from the open tabs in the layout.
   *
   * @returns {string[]} List of file IDs.
   */
  getAllOpenTabFileIds() {
    return this.getTabComponents().map(
      (editorComponent) => editorComponent.getState().fileId
    );
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
      'show': 'onImageShow',
      'vfsChanged': 'onImageVFSChanged',
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
      'startEditing': 'onEditorStartEditing',
      'stopEditing': 'onEditorStopEditing',
      'change': 'onEditorChange',
      'show': 'onEditorShow',
      'vfsChanged': 'onEditorVFSChanged',
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
        this.activeTab = param.container.getComponent();
      });
    }

    setTimeout(() => {console.log('onStackCreated: initialised')}, 0);
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

        $('.terminal-component-container .lm_header')
          .append(`<button id="${id}" class="button config-btn ${id}-btn" disabled>${name}</button>`);

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
    const currentFontSize = localStorageManager.getLocalStorageItem('font-size', BASE_FONT_SIZE);
    $fontSizeMenu.find(`li[data-val=${currentFontSize}]`).addClass('active');

    // Add active state to theme dropdown.
    const currentTheme = localStorageManager.getLocalStorageItem('theme') || 'light';
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
    localStorageManager.setLocalStorageItem('layout', state);
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
    localStorageManager.setLocalStorageItem('theme', theme);
  }

  /**
   * Retrieve the HTML for the run code button.
   *
   * @returns {string}
   */
  getRunCodeButtonHtml() {
    const runCodeShortcut = isMac() ? '&#8984;+Enter' : 'Ctrl+Enter';
    return `<button id="run-code" class="button primary-btn run-user-code-btn" disabled>Run (${runCodeShortcut})</button>`;
  };

  /**
   * Retrieve the HTML for the clear terminal button.
   *
   * @returns {string}
   */
  getClearTermButtonHtml() {
    return `
      <button id="clear-term" class="button clear-term-btn" title="Clear terminal">
        <img src="static/img/icons/trash-bin.png" alt="trash bin" />
      </button>
    `;
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

  /**
   * Add event listeners to the buttons and dropdowns in the layout.
   */
  addButtonEventListeners() {
    $('#run-code').click(() => this.onRunCodeButtonClick());
    $('#clear-term').click(() => this.onClearTermButtonClick());

    // Update font-size for all components on change.
    $('#font-size-menu').find('li').click((event) => {
      const $element = $(event.target);
      const newFontSize = parseInt($element.data('val'));
      this.emitToAllComponents('fontSizeChanged', newFontSize);
      localStorageManager.setLocalStorageItem('font-size', newFontSize);
      $element.addClass('active').siblings().removeClass('active');
    });

    // Update theme on change.
    $('#editor-theme-menu').find('li').click((event) => {
      const $element = $(event.target);
      this.setTheme($element.data('val'));
      $element.addClass('active').siblings().removeClass('active');
    });

    // Add event listeners for setttings menu.
    $('.settings-menu').click((event) => $(event.target).toggleClass('open'));
    $(document).click((event) => {
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
    this.term.clear();
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
   * Change the run-code button to a stop-code button if after 1 second the code
   * has not finished running (potentially infinite loop scenario).
   */
  checkForStopCodeButton() {
    Terra.v.showStopCodeButtonTimeoutId = setTimeout(() => {
      const $button = $('#run-code');
      const newText = $button.text().replace('Run', 'Stop');
      $button.text(newText)
        .prop('disabled', false)
        .removeClass('primary-btn')
        .addClass('danger-btn');
    }, seconds(1));
  }
}
