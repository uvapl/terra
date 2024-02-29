/*
 * Copyright 2020 WebAssembly Community Group participants
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

$(window).on('resize', () => {
  if (window._layout) {
    window._layout.updateSize(window.innerWidth, window.innerHeight);
  }
});

function getActiveEditor() {
  return window._layout.root.contentItems[0].contentItems[0].getActiveContentItem();
}

const runCode = async () => {
  const $button = $('#run');
  if ($button.prop('disabled')) return;

  $button.prop('disabled', true);

  const editor = getActiveEditor();
  const title = editor.config.title;
  const contents = editor.container.getState().value;
  return api.compileLinkRun(title, contents);
};

function EditorComponent(container, state) {
  // To make sure GoldenLayout doensn't override the editor styles, we create
  // another child container for the editor instance.
  const contentContainer = container.getElement()[0];
  const editorContainer = document.createElement('div');
  editorContainer.classList.add('editor');
  contentContainer.appendChild(editorContainer);

  this.editor = ace.edit(editorContainer);
  this.editor.session.setMode('ace/mode/c_cpp');
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
      'Click the "Clear terminal" to clear this terminal screen',
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

  constructor(options) {
    let layoutConfig = getLocalStorageItem('layout');
    if (layoutConfig) {
      layoutConfig = JSON.parse(layoutConfig);
    } else {
      layoutConfig = options.defaultLayoutConfig;
    }

    super(layoutConfig, $('#layout'));

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

    // Add the buttons to the header.
    $('.terminal-component-container .lm_header').prepend('<button id="clear-term" class="button clear-term-btn">Clear terminal</button>');
    $('.terminal-component-container .lm_header').prepend(`<button id="run" class="button run-code-btn">Run (${runCodeShortcut})</button>`);

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
    $('#run').click(() => runCode());
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
