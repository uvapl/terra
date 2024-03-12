$(window).on('resize', () => {
  if (window._layout) {
    window._layout.updateSize(window.innerWidth, window.innerHeight);
  }
});

function getActiveEditor() {
  return window._layout.root.contentItems[0].contentItems[0].getActiveContentItem();
}

function runCode() {
  const $button = $('#run-code');
  if ($button.prop('disabled')) return;
  $button.prop('disabled', true);

  const editor = getActiveEditor();
  const title = editor.config.title;
  const contents = editor.container.getState().value;
  window._workerApi.runUserCode(title, contents);
}

function runButtonCommand(selector, cmd) {
  const $button = $(selector);
  if ($button.prop('disabled')) return;
  $button.prop('disabled', true);

  let files;

  // If <filename> exists in the commands, then we execute the commands solely
  // for the current file the user has open in the UI.
  const hasFilenameToken = cmd.filter((line) => line.includes('<filename>')).length > 0;
  if (hasFilenameToken) {
    const editor = getActiveEditor();
    files = [{
      filename: editor.config.title,
      contents: editor.container.getState().value
    }];
  } else {
    // Otherwise, gather all files from the editor.
    files = window._layout.root.contentItems[0].contentItems[0].contentItems
      .map((item) => ({
        filename: item.config.title,
        contents: item.container.getState().value,
      }));
  }

  window._workerApi.runButtonCommand(selector, cmd, files);
}

function EditorComponent(container, state) {
  // To make sure GoldenLayout doensn't override the editor styles, we create
  // another child container for the editor instance.
  const contentContainer = container.getElement()[0];
  const editorContainer = document.createElement('div');
  editorContainer.classList.add('editor');
  contentContainer.appendChild(editorContainer);

  this.editor = ace.edit(editorContainer);
  this.editor.setKeyboardHandler('ace/keyboard/sublime');
  this.editor.setOption('fontSize');
  this.editor.setValue(state.value || '');
  this.editor.clearSelection();

  this.editor.commands.addCommand({
    name: 'run',
    bindKey: { win: 'Ctrl+Enter', mac: 'Command+Enter' },
    exec: runCode
  });

  this.editor.commands.addCommand({
    name: 'save',
    bindKey: { win: 'Ctrl+S', mac: 'Command+S' },
    exec: () => { }
  });

  const getParentComponentElement = () => container.parent.parent.element[0];

  const setFontSize = (fontSize) => {
    container.extendState({ fontSize });
    this.editor.setFontSize(`${fontSize}px`);
  };

  const setTheme = (theme) => {
    this.editor.setTheme(
      theme === 'dark'
        ? 'ace/theme/cloud_editor_dark'
        : 'ace/theme/textmate'
    );
  }

  const setProgLang = (proglang) => {
    let mode;

    switch (proglang) {
      case 'py':
        mode = 'python';
        break;

      case 'c':
        mode = 'c_cpp';
        break;
    }

    this.proglang = proglang;
    this.editor.session.setMode(`ace/mode/${mode}`);
  };

  setFontSize(state.fontSize || BASE_FONT_SIZE);

  this.editor.on('load', () => {
    this.editor.session.getUndoMananger().reset();
  });

  this.editor.on('change', () => {
    window._editorIsDirty = true;
    container.extendState({ value: this.editor.getValue() });
  });

  container.on('show', () => {
    // Add custom class for styling purposes.
    getParentComponentElement().classList.add('component-container', 'editor-component-container');
  });

  container.on('lock', () => {
    this.editor.setReadOnly(true);
  });

  container.on('unlock', () => {
    this.editor.setReadOnly(false);
  });

  container.on('themeChanged', setTheme);
  container.on('fontSizeChanged', setFontSize);
  container.on('setProgLang', setProgLang);

  container.on('resize', () => {
    this.editor.setAutoScrollEditorIntoView(true);
    this.editor.resize();
  });

  container.on('afterFirstRender', () => {
    // Reset the session after the first initial page render to prevent the
    // initial content is removed when users hit ctrl+z or cmd+z.
    this.editor.session.getUndoManager().reset();
  });

  container.on('destroy', () => {
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }
  });
}

let term;
const fitAddon = new FitAddon.FitAddon();
function TerminalComponent(container, state) {
  const setFontSize = (fontSize) => {
    container.extendState({ fontSize });
    term.options.fontSize = fontSize;
    fitAddon.fit();
  };

  const getParentComponentElement = () => container.parent.parent.element[0];

  container.on('open', () => {
    // Add custom class for styling purposes.
    getParentComponentElement().classList.add('component-container', 'terminal-component-container');

    const fontSize = state.fontSize || BASE_FONT_SIZE;

    term = new Terminal({
      convertEol: true,
      disableStdin: true,
      fontSize,
      lineHeight: 1.2
    })
    term.loadAddon(fitAddon);
    term.open(document.querySelector('.terminal-component-container .lm_content'));
    fitAddon.fit();

    startingMessage = [
      'Click the "Run" button to execute code',
      'Click the "Clear terminal" button to clear this screen',
    ];
    for (const line of startingMessage) {
      term.write(line + '\n');
    }
    term.write('\n');
    term.open(container.getElement()[0]);
    setFontSize(fontSize);
  });

  container.on('fontSizeChanged', setFontSize);
  container.on('resize', () => fitAddon.fit());
  container.on('destroy', () => {
    if (term) {
      term.destroy();
      term = null;
    }
  });
}

class Layout extends GoldenLayout {
  initialised = false;
  proglag = null;
  buttonConfig = null;

  constructor(proglang, defaultLayoutConfig, buttonConfig) {
    let layoutConfig = getLocalStorageItem('layout');
    if (layoutConfig) {
      layoutConfig = JSON.parse(layoutConfig);
    } else {
      layoutConfig = defaultLayoutConfig;
    }

    super(layoutConfig, $('#layout'));

    this.proglang = proglang;

    if (isObject(buttonConfig)) {
      this.buttonConfig = buttonConfig;
    }

    this.on('stateChanged', () => {
      const config = this.toConfig();
      const state = JSON.stringify(config);
      setLocalStorageItem('layout', state);
    });

    this.on('stackCreated', (stack) => {
      if (!this.initialised) {
        this.initialised = true;
        // Do a set-timeout trick to make sure the components are registered
        // through the registerComponent() function, prior to calling this part.
        setTimeout(() => {
          this.emitToAllComponents('afterFirstRender');
          this.emitToAllComponents('setProgLang', this.proglang);
          this.createControls();
          this.setTheme(getLocalStorageItem('theme') || 'light');

          // Focus the editor when clicking anywhere in the editor header.
          $('.editor-component-container .lm_header').click(() => {
            getActiveEditor().instance.editor.focus();
          });
        }, 0);
      }
    });

    this.registerComponent('editor', EditorComponent);
    this.registerComponent('terminal', TerminalComponent);
  }

  emitToAllComponents = (event, data) => {
    window._layout.root.contentItems[0].contentItems.forEach((contentItem) => {
      contentItem.contentItems.forEach((component) => {
        component.container.emit(event, data);
      });
    });
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

  createControls = () => {
    const runCodeShortcut = isMac() ? '&#8984;+Enter' : 'Ctrl+Enter';

    // Add custom buttons to the header.
    if (this.proglang === 'py' && isObject(this.buttonConfig)) {
      Object.keys(this.buttonConfig).forEach((name) => {
        const id = name.replace(/\s/g, '-').toLowerCase();
        const selector = `#${id}`;
        const cmd = this.buttonConfig[name];

        $('.terminal-component-container .lm_header')
          .prepend(`<button id="${id}" class="button ${id}-btn" disabled>${name}</button>`);

        $(selector).click(() => runButtonCommand(selector, cmd));
      });
    }

    $('.terminal-component-container .lm_header').prepend('<button id="clear-term" class="button clear-term-btn" disabled>Clear terminal</button>');
    $('.terminal-component-container .lm_header').prepend(`<button id="run-code" class="button run-code-btn" disabled>Run (${runCodeShortcut})</button>`);

    // Create setting dropdown menu.
    $('.terminal-component-container .lm_controls').append(`
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
    `);

    // Add active state to font-size dropdown.
    const $fontSizeMenu = $('#font-size-menu');
    const currentFontSize = getLocalStorageItem('font-size') || BASE_FONT_SIZE;
    $fontSizeMenu.find(`li[data-val=${currentFontSize}]`).addClass('active');

    // Add active state to theme dropdown.
    const currentTheme = getLocalStorageItem('theme') || 'light';
    const $editorThemeMenu = $('#editor-theme-menu');
    $editorThemeMenu.find(`li[data-val=${currentTheme}]`).addClass('active');

    // Add event listeners.
    $('.settings-menu').click((event) => $(event.target).toggleClass('open'));
    $('#run-code').click(() => runCode());
    $('#clear-term').click(() => term.clear());
    $(document).click((event) => {
      if (!$(event.target).is($('.settings-menu.open'))) {
        $('.settings-menu').removeClass('open');
      }
    });

    // Update font-size for all components on change.
    $fontSizeMenu.find('li').click((event) => {
      const $element = $(event.target);
      const newFontSize = parseInt($element.data('val'));
      this.emitToAllComponents('fontSizeChanged', newFontSize);
      setLocalStorageItem('font-size', newFontSize);
      $element.addClass('active').siblings().removeClass('active');
    });

    // Update theme on change.
    $editorThemeMenu.find('li').click((event) => {
      const $element = $(event.target);
      this.setTheme($element.data('val'));
      $element.addClass('active').siblings().removeClass('active');
    });
  }
}
