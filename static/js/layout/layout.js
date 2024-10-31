$(window).on('resize', () => {
  if (window._layout) {
    window._layout.updateSize(window.innerWidth, window.innerHeight);
  }
});

class Layout extends GoldenLayout {
  initialised = false;
  proglag = null;
  buttonConfig = null;
  vertical = false;
  iframe = false;

  constructor(defaultLayoutConfig, options = {}) {
    let layoutConfig = getLocalStorageItem('layout');
    if (layoutConfig) {
      layoutConfig = JSON.parse(layoutConfig);
    } else {
      layoutConfig = defaultLayoutConfig;
    }

    super(layoutConfig, $('#layout'));

    this.proglang = options.proglang;
    this.iframe = $('body').hasClass('terra-embed');
    this.vertical = options.vertical;

    if (isObject(options.buttonConfig)) {
      this.buttonConfig = options.buttonConfig;
    }

    this.on('stateChanged', () => this.onStateChanged());

    this.on('stackCreated', (stack) => {
      if (!this.initialised) {
        this.initialised = true;
        // Do a set-timeout trick to make sure the components are registered
        // through the registerComponent() function, prior to calling this part.
        setTimeout(() => {
          this.emitToAllComponents('afterFirstRender');
          this.setTheme(getLocalStorageItem('theme') || 'light');
          this.createControls();
          this.showTermStartupMessage();

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

  showTermStartupMessage = () => {
    const msg = ['Click the "Run" button to execute code.'];

    if (!this.iframe) {
      msg.push('Click the "Clear terminal" button to clear this screen.');
    }

    for (const line of msg) {
      term.write(line + '\n');
    }

    term.write('\n');
  }

  // Emit an event recursively to all components.
  _emit = (contentItem, event, data) => {
    if (contentItem.isComponent) {
      contentItem.container.emit(event, data);
    } else {
      contentItem.contentItems.forEach((childContentItem) => {
        this._emit(childContentItem, event, data);
      });
    }
  }

  emitToAllComponents = (event, data) => {
    window._layout.root.contentItems[0].contentItems.forEach((contentItem) => {
      this._emit(contentItem, event, data);
    });
  }

  emitToEditorComponents = (event, data) => {
    window._layout.root.contentItems[0].contentItems[0].contentItems.forEach((contentItem) => {
      this._emit(contentItem, event, data);
    });
  }

  onStateChanged = () => {
    const config = this.toConfig();
    const state = JSON.stringify(config);
    setLocalStorageItem('layout', state);
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
    setLocalStorageItem('theme', theme);
  }

  getRunCodeButtonHtml = () => {
    const runCodeShortcut = isMac() ? '&#8984;+Enter' : 'Ctrl+Enter';
    return `<button id="run-code" class="button primary-btn" disabled>Run (${runCodeShortcut})</button>`;
  };

  getClearTermButtonHtml = () => '<button id="clear-term" class="button clear-term-btn" disabled>Clear terminal</button>';

  createControls = () => {
    const runCodeButtonHtml = this.getRunCodeButtonHtml();
    const clearTermButtonHtml = this.getClearTermButtonHtml();

    const settingsMenuHtml = `
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

    const $editorContainer = $('.editor-component-container');
    const $terminalContainer = $('.terminal-component-container');

    if (this.iframe && this.vertical) {
      $editorContainer
        .find('.lm_controls')
        .append(runCodeButtonHtml)
        .append(settingsMenuHtml);
    } else if (this.iframe) {
      // Horizontal layout.
      $terminalContainer.find('.lm_controls')
        .append(runCodeButtonHtml)
        .append(settingsMenuHtml);
    } else {
      // Exam layout.
      $terminalContainer.find('.lm_header').append(runCodeButtonHtml).append(clearTermButtonHtml)
      $terminalContainer.find('.lm_controls').append(settingsMenuHtml);
    }

    // Add custom buttons to the header.
    if (this.proglang === 'py' && isObject(this.buttonConfig)) {
      Object.keys(this.buttonConfig).forEach((name) => {
        const id = name.replace(/\s/g, '-').toLowerCase();
        const selector = `#${id}`;

        let cmd = this.buttonConfig[name];
        if (!Array.isArray(cmd)) {
          cmd = cmd.split('\n');
        }

        $('.terminal-component-container .lm_header')
          .append(`<button id="${id}" class="button ${id}-btn" disabled>${name}</button>`);

        $(selector).click(() => runButtonCommand(selector, cmd));
      });
    }

    // Add active state to font-size dropdown.
    const $fontSizeMenu = $('#font-size-menu');
    const currentFontSize = getLocalStorageItem('font-size') || BASE_FONT_SIZE;
    $fontSizeMenu.find(`li[data-val=${currentFontSize}]`).addClass('active');

    // Add active state to theme dropdown.
    const currentTheme = getLocalStorageItem('theme') || 'light';
    const $editorThemeMenu = $('#editor-theme-menu');
    $editorThemeMenu.find(`li[data-val=${currentTheme}]`).addClass('active');

    // Add event listeners for setttings menu.
    $('.settings-menu').click((event) => $(event.target).toggleClass('open'));
    $(document).click((event) => {
      if (!$(event.target).is($('.settings-menu.open'))) {
        $('.settings-menu').removeClass('open');
      }
    });

    this.addControlsEventListeners();
  }

  addControlsEventListeners = () => {
    $('#run-code').click(() => runCode(null, this.iframe));
    $('#clear-term').click(() => term.reset());

    // Update font-size for all components on change.
    $('#font-size-menu').find('li').click((event) => {
      const $element = $(event.target);
      const newFontSize = parseInt($element.data('val'));
      this.emitToAllComponents('fontSizeChanged', newFontSize);
      setLocalStorageItem('font-size', newFontSize);
      $element.addClass('active').siblings().removeClass('active');
    });

    // Update theme on change.
    $('#editor-theme-menu').find('li').click((event) => {
      const $element = $(event.target);
      this.setTheme($element.data('val'));
      $element.addClass('active').siblings().removeClass('active');
    });
  };
}
