import { IS_IDE, BASE_FONT_SIZE } from '../constants.js';
import { runButtonCommand } from '../helpers/editor-component.js';
import { isMac, isObject, mergeObjects } from '../helpers/shared.js';
import EditorComponent from './editor.component.js';
import TerminalComponent from './term.component.js';
import pluginManager from '../plugin-manager.js';
import Terra from '../terra.js';
import localStorageManager from '../local-storage-manager.js';

$(window).on('resize', () => {
  if (Terra.app.layout) {
    Terra.app.layout.updateSize(window.innerWidth, window.innerHeight);
  }
});

/**
 * Default layout config that is used when the layout is created for the first
 * time (and thus not saved in local storage) or when the layout is reset.
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

export default class Layout extends GoldenLayout {
  /**
   * Whether the layout has been initialised or not.
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
   * There can only be one terminal component inside any app.
   * @type {Terminal}
   */
  term = null;

  /**
   * Default terminal startup message. Each element in the array is written on a
   * separateline.
   * @type {array}
   */
  termStartupMessage = [
    'Click the "Run" button to execute code.',
    'Click the "Clear terminal" button to clear this screen.'
  ];

  constructor(additionalLayoutConfig, options = {}) {
    let layoutConfig = localStorageManager.getLocalStorageItem('layout');
    if (layoutConfig && !options.forceDefaultLayout) {
      layoutConfig = JSON.parse(layoutConfig);
    } else {
      layoutConfig = mergeObjects(DEFAULT_LAYOUT_CONFIG, additionalLayoutConfig);
    }

    super(layoutConfig, $('#layout'));

    this.proglang = options.proglang;
    this.vertical = options.vertical;

    if (isObject(options.buttonConfig)) {
      this.buttonConfig = options.buttonConfig;
    }

    this.on('stateChanged', () => {
      if (this.isInitialised) {
        this.onStateChanged();
      }
    });

    this.on('stackCreated', (stack) => {
      if (!this.initialised) {
        this.initialised = true;
        // Do a set-timeout trick to make sure the components are registered
        // through the registerComponent() function, prior to calling this part.
        setTimeout(() => {
          this.emitToAllComponents('afterFirstRender');
          this.setTheme(localStorageManager.getLocalStorageItem('theme') || 'light');
          this.renderButtons();
          this.showTermStartupMessage();
          if (IS_IDE) {
            pluginManager.triggerEvent('onLayoutLoaded');
          }

          if (Array.isArray(options.autocomplete) && options.autocomplete.every(isObject)) {
            this.emitToEditorComponents('setCustomAutocompleter', options.autocomplete);
          }

          if (this.vertical) {
            this.emitToAllComponents('verticalLayout');
          }
        }, 0);
      }
    });

    this.registerComponent('editor', EditorComponent);
    this.registerComponent('terminal', TerminalComponent);
  }

  renderConfigButtons = () => {
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

        $(selector).click(() => runButtonCommand(selector, cmd));
      });
    }
  }

  addActiveStates = () => {
    // Add active state to font-size dropdown.
    const $fontSizeMenu = $('#font-size-menu');
    const currentFontSize = localStorageManager.getLocalStorageItem('font-size') || BASE_FONT_SIZE;
    $fontSizeMenu.find(`li[data-val=${currentFontSize}]`).addClass('active');

    // Add active state to theme dropdown.
    const currentTheme = localStorageManager.getLocalStorageItem('theme') || 'light';
    const $editorThemeMenu = $('#editor-theme-menu');
    $editorThemeMenu.find(`li[data-val=${currentTheme}]`).addClass('active');
  }

  showTermStartupMessage = () => {
    for (const line of this.termStartupMessage) {
      Terra.app.layout.term.write(line + '\n');
    }

    Terra.app.layout.term.write('\n');
  }

  // Emit an event recursively to all components. Optionally the `fileId` can
  // be set to filter on only components with the given file ID.
  _emit = (contentItem, event, data, fileId) => {
    if (contentItem.isComponent) {
      if (fileId && contentItem.container.getState().fileId === fileId) {
        contentItem.container.emit(event, data);
      } else if (!fileId) {
        contentItem.container.emit(event, data);
      }
    } else {
      contentItem.contentItems.forEach((childContentItem) => {
        this._emit(childContentItem, event, data);
      });
    }
  }

  emitToAllComponents = (event, data) => {
    Terra.app.layout.root.contentItems[0].contentItems.forEach((contentItem) => {
      this._emit(contentItem, event, data);
    });
  }

  emitToEditorComponents = (event, data) => {
    Terra.app.layout.root.contentItems[0].contentItems[0].contentItems.forEach((contentItem) => {
      this._emit(contentItem, event, data);
    });
  }

  emitToEditorComponentWithFileId = (event, fileId, data) => {
    Terra.app.layout.root.contentItems[0].contentItems[0].contentItems.forEach((contentItem) => {
      this._emit(contentItem, event, data, fileId);
    });
  }

  onStateChanged = () => {
    const config = this.toConfig();
    const state = JSON.stringify(config);
    localStorageManager.setLocalStorageItem('layout', state);
  }

  setTheme = (theme) => {
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

  getRunCodeButtonHtml = () => {
    const runCodeShortcut = isMac() ? '&#8984;+Enter' : 'Ctrl+Enter';
    return `<button id="run-code" class="button primary-btn run-user-code-btn" disabled>Run (${runCodeShortcut})</button>`;
  };

  getClearTermButtonHtml = () => '<button id="clear-term" class="button clear-term-btn" disabled>Clear terminal</button>';

  getSettingsMenuHtml = () => `
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

  renderButtons = () => {
    console.log('renderButtons() is not implemented');
  }

  addButtonEventListeners = () => {
    $('#run-code').click(this.onRunCodeButtonClick);
    $('#clear-term').click(this.onClearTermButtonClick);

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

  onRunCodeButtonClick = () => {
    Terra.app.runCode();
  }

  onClearTermButtonClick = () => {
    Terra.app.layout.term.reset();
  }
}
