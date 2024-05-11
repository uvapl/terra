$(window).on('resize', () => {
  if (window._layout) {
    window._layout.updateSize(window.innerWidth, window.innerHeight);
  }
});

/**
 * Get the active tab its editor instance.
 *
 * @returns {object} The active editor instance.
 */
function getActiveEditor() {
  return window._layout._lastActiveEditor;
}

/**
 * Gathers all files from the editor and returns them as an array of objects.
 *
 * @returns {array} List of objects, each containing the filename and contents of
 * the corresponding editor tab.
 */
function getAllEditorFiles() {
  return getAllEditorTabs().map((tab) => ({
    filename: tab.config.title,
    contents: tab.container.getState().value,
  }));
}

/**
 * Gather all editor tab components recursively from the layout.
 *
 * @param {GoldenLayout.ContentItem} [contentItem] - Starting contentItem where
 * the recursive search will start.
 * @returns {array} List of all the editor tabs.
 */
function getAllEditorTabs(contentItem = window._layout.root) {
  if (contentItem.isComponent) {
    return contentItem;
  }

  let files = [];
  contentItem.contentItems.forEach((childContentItem) => {
    if (!childContentItem.isTerminal) {
      files = files.concat(getAllEditorTabs(childContentItem));
    }
  });

  return files;
}

/**
 * Disposes the user input when active. This is actived once user input is
 * requested through the `waitForInput` function.
 */
function disposeUserInput() {
  if (isObject(window._userInputDisposable) && typeof window._userInputDisposable.dispose === 'function') {
    window._userInputDisposable.dispose();
    window._userInputDisposable = null;
  }
}

/**
 * Runs the code inside the worker by sending all files to the worker along with
 * the current active tab name.
 *
 * @param {boolean} [clearTerm=false] Whether to clear the terminal before
 * printing the output.
 */
function runCode(clearTerm = false) {
  if (clearTerm) term.reset();

  if ($('#run-code').prop('disabled')) {
    return;
  } else if (window._workerApi.isRunningCode) {
    hideTermCursor();
    term.write('\nProcess terminated\n');
    disposeUserInput();
    return window._workerApi.terminate();
  }

  const activeTabName = getActiveEditor().config.title;
  const files = getAllEditorFiles();
  window._workerApi.runUserCode(activeTabName, files);

  $('#run-code').prop('disabled', true);

  // Change the run-code button to a stop-code button if after 1 second the code
  // has not finished running (potentially infinite loop scenario).
  window._showStopCodeButtonTimeoutId = setTimeout(() => {
    const $button = $('#run-code');
    const newText = $button.text().replace('Run', 'Stop');
    $button.text(newText)
      .prop('disabled', false)
      .removeClass('run-code-btn')
      .addClass('stop-code-btn');
  }, 1000);
}

/**
 * Run the command of a custom config button.
 *
 * @param {string} selector - Unique selector for the button, used to
 * disable it when running and disable it when it's done running.
 * @param {array} cmd - List of commands to execute.
 */
function runButtonCommand(selector, cmd) {
  const $button = $(selector);
  if ($button.prop('disabled')) return;
  $button.prop('disabled', true);

  const activeTabName = getActiveEditor().config.title;
  const files = getAllEditorFiles();

  window._workerApi.runButtonCommand(selector, activeTabName, cmd, files);
}

/**
 * Get default Ace editor completers.
 *
 * @returns {array} List of completers.
 */
function getAceCompleters() {
  const langTools = ace.require('ace/ext/language_tools');

  const completers = [];

  // Only use textCompleter that completes text inside the file.
  // Alter the results of the textCompleter by removing the 'meta', as it is
  // always 'local' which isn't useful for the user.
  completers.push({
    getCompletions(editor, session, pos, prefix, callback) {
      langTools.textCompleter.getCompletions(editor, session, pos, prefix, (_, completions) => {
        callback(null, completions.map((completion) => ({
          ...completion,
          meta: ''
        })));
      });
    }
  });

  return completers;
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
  this.editor.setOption('enableSnippets', false);
  this.editor.setOption('enableBasicAutocompletion', true);
  this.editor.setOption('enableLiveAutocompletion', true);
  this.editor.setValue(state.value || '');
  this.editor.clearSelection();
  this.editor.completers = getAceCompleters();

  this.editor.commands.addCommand({
    name: 'run',
    bindKey: { win: 'Ctrl+Enter', mac: 'Command+Enter' },
    exec: () => runCode(),
  });

  this.editor.commands.addCommand({
    name: 'save',
    bindKey: { win: 'Ctrl+S', mac: 'Command+S' },
    exec: () => { }
  });

  if (isIDE) {
    this.editor.commands.addCommand({
      name: 'closeFile',
      bindKey: 'Ctrl+W',
      exec: VFS.closeFile,
    });

    this.editor.commands.addCommand({
      name: 'createNewFileTreeFile',
      bindKey: 'Ctrl+T',
      exec: () => createNewFileTreeFile(),
    });

    this.editor.commands.addCommand({
      name: 'creteNewFileTreeFolder',
      bindKey: 'Ctrl+Shift+T',
      exec: () => createNewFileTreeFolder(),
    });
  }

  const getParentComponentElement = () => container.parent.parent.element[0];

  const setActiveEditor = (value) =>
    window._layout._lastActiveEditor = typeof value !== 'undefined'
      ? value
      : container.parent;

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

    switch (proglang.toLowerCase()) {
      case 'py':
        mode = 'python';
        break;

      case 'cpp':
      case 'c':
        mode = 'c_cpp';
        break;

      case 'rs':
        mode = 'rust';
        break;

      case 'bash':
        mode = 'sh';
        break;

      case 'jsx':
      case 'js':
      case 'ts':
      case 'typescript':
        mode = 'tsx';
        break;

      case 'md':
        mode = 'markdown';
        break;

      default:
        mode = proglang.toLowerCase();
        break;
    }

    console.log('Seting mode', mode);
    this.proglang = proglang;
    this.editor.getSession().setMode(`ace/mode/${mode}`);
  };

  setFontSize(state.fontSize || BASE_FONT_SIZE);

  this.editor.on('load', () => {
    this.editor.getSession().getUndoMananger().reset();
  });

  this.editor.on('change', () => {
    window._editorIsDirty = true;
    container.extendState({ value: this.editor.getValue() });

    if (isIDE) {
      VFS.updateFile(container.getState().fileId, {
        content: this.editor.getValue(),
      });
    }
  });

  this.editor.on('focus', () => {
    setActiveEditor();
  });

  container.on('show', () => {
    setProgLang(container.parent.config.title.split('.').pop());
    this.editor.focus();

    // Add custom class for styling purposes.
    getParentComponentElement().classList.add('component-container', 'editor-component-container');

    if (!getActiveEditor()) {
      setActiveEditor();
    }
  });

  container.on('lock', () => {
    this.editor.setReadOnly(true);
  });

  container.on('setCustomAutocompleter', (completions) => {
    this.editor.completers.push({
      getCompletions: (editor, session, pos, prefix, callback) => {
        if (prefix.length === 0) { callback(null, []); return }

        callback(null, completions);
      }
    });
  });

  container.on('unlock', () => {
    this.editor.setReadOnly(false);
  });

  container.on('themeChanged', setTheme);
  container.on('fontSizeChanged', setFontSize);

  container.on('resize', () => {
    this.editor.setAutoScrollEditorIntoView(true);
    this.editor.resize();
  });

  container.on('afterFirstRender', () => {
    // Reset the session after the first initial page render to prevent the
    // initial content is removed when users hit ctrl+z or cmd+z.
    this.editor.getSession().getUndoManager().reset();
  });

  container.on('destroy', () => {
    // If it's the last tab being closed, then we insert another 'Untitled' tab,
    // because we always need at least one tab open.
    if (getAllEditorTabs().length === 1) {
      getActiveEditor().parent.addChild({
        type: 'component',
        componentName: 'editor',
        componentState: {
          fontSize: BASE_FONT_SIZE,
        },
        title: 'Untitled',
      });
    } else {
      setActiveEditor(null);
    }

    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }
  });
}

/**
 * Hide the cursor inside the terminal component.
 */
function hideTermCursor() {
  term.write('\x1b[?25l');
}

/**
 * Show the cursor inside the terminal component.
 */
function showTermCursor() {
  term.write('\x1b[?25h');
}

/**
 * Enable stdin in the terminal and record the user's keystrokes. Once the user
 * presses ENTER, the promise is resolved with the user's input.
 *
 * @returns {Promise<string>} The user's input.
 */
function waitForInput() {
  return new Promise(resolve => {
    // Immediately focus the terminal when user input is requested.
    showTermCursor();
    term.focus();

    // Disable some special characters.
    // For all input sequences, see http://xtermjs.org/docs/api/vtfeatures/#c0
    const blacklistedKeys = [
      '\u007f', // Backspace
      '\t',     // Tab
      '\r',     // Enter
    ]

    // Keep track of the value that is typed by the user.
    let value = '';
    window._userInputDisposable = term.onKey(e => {
      // Only append allowed characters.
      if (!blacklistedKeys.includes(e.key)) {
        term.write(e.key);
        value += e.key;
      }

      // Remove the last character when pressing backspace. This is done by
      // triggering a backspace '\b' character and then insert a space at that
      // position to clear the character.
      if (e.key === '\u007f' && value.length > 0) {
        term.write('\b \b');
        value = value.slice(0, -1);
      }

      // If the user presses enter, resolve the promise.
      if (e.key === '\r') {
        disposeUserInput();

        // Trigger a real enter in the terminal.
        term.write('\n');
        value += '\n';

        hideTermCursor();
        resolve(value);
      }
    });
  });
}

let term;
const fitAddon = new FitAddon.FitAddon();
function TerminalComponent(container, state) {
  container.parent.isTerminal = true;

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
      cursorBlink: true,
      fontSize,
      lineHeight: 1.2
    })
    term.loadAddon(fitAddon);
    term.open(container.getElement()[0]);
    fitAddon.fit();

    // Trigger a single resize after the terminal has rendered to make sure it
    // fits the whole parent width and doesn't leave any gaps near the edges.
    setTimeout(() => {
      $(window).trigger('resize');
    }, 0);


    setFontSize(fontSize);
    hideTermCursor();
  });

  container.on('verticalLayout', () => {
    container.tab.header.position(false);
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
  vertical = false;
  iframe = false;

  constructor(proglang, defaultLayoutConfig, options = {}) {
    let layoutConfig = getLocalStorageItem('layout');
    if (layoutConfig) {
      layoutConfig = JSON.parse(layoutConfig);
    } else {
      layoutConfig = defaultLayoutConfig;
    }

    super(layoutConfig, $('#layout'));

    this.proglang = proglang;
    this.iframe = $('body').hasClass('examide-embed');
    this.vertical = options.vertical;

    if (isObject(options.buttonConfig)) {
      this.buttonConfig = options.buttonConfig;
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
          this.createControls();
          this.setTheme(getLocalStorageItem('theme') || 'light');
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
    const msg = ['Click the "Run" button to execute code'];

    if (!this.iframe) {
      msg.push('Click the "Clear terminal" button to clear this screen');
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
    })
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
    return `<button id="run-code" class="button run-code-btn" disabled>Run (${runCodeShortcut})</button>`;
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
    $('#run-code').click(() => runCode(this.iframe));
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

class LayoutIDE extends Layout {
  constructor(proglang, defaultLayoutConfig, options = {}) {
    super(proglang, defaultLayoutConfig, options);
  }

  createControls = () => {
    const runCodeButtonHtml = this.getRunCodeButtonHtml();
    const clearTermButtonHtml = this.getClearTermButtonHtml();

    const $terminalContainer = $('.terminal-component-container');

    $terminalContainer.find('.lm_header').append(runCodeButtonHtml).append(clearTermButtonHtml)

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
}
