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
 * @returns {array} List of objects, each containing the filename and content of
 * the corresponding editor tab.
 */
function getAllEditorFiles() {
  return getAllEditorTabs().map((tab) => ({
    name: tab.config.title,
    content: tab.container.getState().value,
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
 * Close the active tab in the editor, except when it is an untitled tab.
 */
function closeFile() {
  const currentTab = getActiveEditor();
  if (currentTab) {
    currentTab.parent.removeChild(currentTab);
  }
}

/**
 * Close all tabs in the editor.
 */
function closeAllFiles() {
  const tabs = getAllEditorTabs();
  tabs.forEach((tab) => tab.parent.removeChild(tab));
}

/**
 * Open a file in the editor, otherwise switch to the tab of the filename.
 * Next, spawn a new worker based on the file extension.
 *
 * @param {string} id - The file id. Leave empty to create new file.
 * @param {string} filename - The name of the file to open.
 */
function openFile(id, filename) {
  const tab = getAllEditorTabs().filter((tab) =>
    id === null
      ? tab.config.title === filename
      : tab.container.getState().fileId === id
  );

  if (tab.length > 0) {
    // Switch to the active tab.
    tab[0].parent.setActiveContentItem(tab[0]);
    tab[0].instance.editor.focus();
  } else {
    const currentTab = getActiveEditor();
    if (currentTab) {
      // Add a new tab next to the current active tab.
      currentTab.parent.addChild({
        type: 'component',
        componentName: 'editor',
        componentState: {
          fontSize: BASE_FONT_SIZE,
          fileId: id,
        },
        title: filename,
      });

      // Check if the current tab is an untitled tab with no content.
      if (currentTab.config.title === 'Untitled' && currentTab.instance.editor.getValue() === '') {
        currentTab.parent.removeChild(currentTab);
      }
    }
  }

  const proglang = getFileExtension(filename);
  createWorkerApi(proglang);
}

function createFolderOptionsHtml(html = '', parentId = null, indent = '--') {
  VFS.findFoldersWhere({ parentId }).forEach((folder, index) => {
    html += `<option value="${folder.id}">${indent} ${folder.name}</option>`;
    html += createFolderOptionsHtml('', folder.id, indent + '--');
  });

  return html;
}

/**
 * Save the current file. Another piece of code in the codebase is responsible
 * for auto-saving the file, but this saveFile will be used mainly for any file
 * that doesn't exist in th vfs yet. It will prompt the user with a modal for a
 * filename and where to save the file. Finally, the file will be created in the
 * file-tree which automatically creates the file in the vfs.
 *
 * This function get's triggered on each 'save' keystroke, i.e. <cmd/ctrl + s>.
 */
function saveFile() {
  const tab = getActiveEditor();

  if (!tab) return;

  // If the file exists in the vfs, then return, because the contents will be
  // auto-saved already in another part of the codebase.
  if (tab.container.getState().fileId) {
    const file = VFS.findFileById(tab.container.getState().fileId);
    if (file) return;
  }

  const folderOptions = createFolderOptionsHtml();

  const $modal = createModal({
    title: 'Save file',
    body: `
    <div class="form-grid">
      <div class="form-wrapper">
        <label>Enter a filename:</label>
        <div class="right-container">
          <input class="text-input" placeholder="Enter a filename" value="${tab.config.title}" maxlength="30" />
        </div>
      </div>
      <div class="form-wrapper">
        <label>Select a folder:</label>
        <div class="right-container">
          <select class="select">
            <option value="root">/</option>
            ${folderOptions}
          </select>
        </div>
      </div>
    </div>
    `,
    footer: `
      <button type="button" class="button cancel-btn">Cancel</button>
      <button type="button" class="button confirm-btn primary-btn">Save</button>
    `,
    attrs: {
      id: 'ide-save-file-modal',
      class: 'modal-width-small'
    }
  });

  showModal($modal);
  $modal.find('.text-input').focus().select();

  $modal.find('.cancel-btn').click(() => hideModal($modal));
  $modal.find('.primary-btn').click(() => {
    const filename = $modal.find('.text-input').val();

    let folderId = $modal.find('.select').val();
    if (folderId === 'root') {
      folderId = null;
    }

    // Create a new file in the file-tree, which automatically creates the
    // file for us in the vfs.
    const nodeId = $('#file-tree').jstree('create_node', folderId, {
      text: filename,
      type: 'file',
    });

    // Change the Untitled tab to the new filename.
    tab.container.setTitle(filename);

    // Update the container state.
    tab.container.setState({ fileId: nodeId });

    // For some reason no layout update is triggered, so we trigger an update.
    window._layout.emit('stateChanged');

    hideModal($modal);
  });
}

/**
 * Runs the code inside the worker by sending all files to the worker along with
 * the current active tab name. If the `fileId` is set, then solely that file
 * will be run.
 *
 * @param {string} [id] - The ID of the file to run.
 * @param {boolean} [clearTerm=false] Whether to clear the terminal before
 * printing the output.
 */
function runCode(fileId = null, clearTerm = false) {
  if (clearTerm) term.reset();

  if (window._workerApi) {
    if (!window._workerApi.isReady) {
      // Worker API is busy, wait for it to be done.
      return;
    } else if (window._workerApi.isRunningCode) {
      // Terminate worker in cases of infinite loops.
      return window._workerApi.restart(true);
    }
  }

  $('#run-code').prop('disabled', true);

  let filename = null;
  let files = null;

  if (fileId) {
    const file = VFS.findFileById(fileId);
    filename = file.name;
    files = [file];
  } else {
    filename = getActiveEditor().config.title;
    files = getAllEditorFiles();
  }

  // Create a new worker instance if needed.
  const proglang = getFileExtension(filename);
  createWorkerApi(proglang);

  // Wait for the worker to be ready before running the code.
  if (window._workerApi && !window._workerApi.isReady) {
    const runFileIntervalId = setInterval(() => {
      if (window._workerApi && window._workerApi.isReady) {
        window._workerApi.runUserCode(filename, files);
        checkForStopCodeButton();
        clearInterval(runFileIntervalId);
      }
    }, 200);
  } else if (window._workerApi) {
    // If the worker is ready, run the code immediately.
    window._workerApi.runUserCode(filename, files);
    checkForStopCodeButton();
  }
}

/**
 * Change the run-code button to a stop-code button if after 1 second the code
 * has not finished running (potentially infinite loop scenario).
 */
function checkForStopCodeButton() {
  window._showStopCodeButtonTimeoutId = setTimeout(() => {
    const $button = $('#run-code');
    const newText = $button.text().replace('Run', 'Stop');
    $button.text(newText)
      .prop('disabled', false)
      .removeClass('primary-btn')
      .addClass('danger-btn');
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
    exec: () => {
      if (isIDE) {
        saveFile();
      }
    }
  });

  if (isIDE) {
    this.editor.commands.addCommand({
      name: 'closeFile',
      bindKey: 'Ctrl+W',
      exec: () => closeFile(),
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

      case 'untitled':
        mode = 'text';
        break;

      case 'svg':
        mode = 'html'
        break;

      case 'yml':
        mode = 'yaml'
        break;

      default:
        mode = proglang.toLowerCase();
        break;
    }

    this.proglang = proglang;
    this.editor.getSession().setMode(`ace/mode/${mode}`);
  };

  this.editor.on('load', () => {
    this.editor.getSession().getUndoMananger().reset();
  });

  this.editor.commands.on('exec', (e) => {
    if (LFS.loaded && ['paste', 'insertstring'].includes(e.command.name)) {
      const inputText = e.args.text || '';
      const filesize = new Blob([this.editor.getValue() + inputText]).size;
      if (filesize >= LFS_MAX_FILE_SIZE) {
        // Prevent the event from happening.
        e.preventDefault();

        const $modal = createModal({
          title: 'Exceeded maximum file size',
          body: 'The file size exceeds the maximum file size. This limit is solely required when you are connected to your local filesystem. Please reduce the file size beforing adding more content.',
          footer: ' <button type="button" class="button primary-btn confirm-btn">Go back</button>',
          footerClass: 'flex-end',
          attrs: {
            id: 'ide-exceeded-file-size-modal',
            class: 'modal-width-small',
          }
        });

        showModal($modal);
        $modal.find('.confirm-btn').click(() => hideModal($modal));
      }
    }
  });

  this.editor.on('change', () => {
    window._editorIsDirty = true;
    container.extendState({ value: this.editor.getValue() });

    const { fileId } = container.getState();
    if (fileId && !isIframe) {
      VFS.updateFile(fileId, {
        content: this.editor.getValue(),
      }, false);
    }

    if (isIDE && hasGitFSWorker() && this.initialized) {
      if (this.gitCommitTimeoutId) {
        clearTimeout(this.gitCommitTimeoutId);
      }

      // Only commit changes after 2 seconds of inactivity.
      this.gitCommitTimeoutId = setTimeout(() => {
        const filename = container.parent.config.title;
        window._gitFS.commit(
          filename,
          this.editor.getValue(),
        );

        const node = $('#file-tree').jstree('get_node', fileId);
        addGitDiffIndicator(node);
      }, seconds(2));
    }

    if (!this.initialized) {
      this.initialized = true;
    }
  });

  this.editor.on('focus', () => {
    setActiveEditor();

    // Spawn a new worker if necessary.
    createWorkerApi(this.proglang);
  });

  container.on('show', () => {
    this.editor.focus();

    // If we ran into a layout state from localStorage that doesn't have
    // a file ID, or the file ID is not the same, then we should sync the
    // filesystem ID with this tab state's file ID. We can only do this for
    // non-IDE versions, because the ID always uses IDs properly and can have
    // multiple filenames. It can be assumed that both the exam and iframe wil
    // not have duplicate filenames.
    if (!isIDE) {
      const file = VFS.findFileWhere({ name: container.parent.config.title });
      const { fileId } = container.getState();
      if (!fileId || (file && fileId !== file.id)) {
        container.extendState({ fileId: file.id });
      }
    }

    if (isIDE && this.editor.getValue() === '') {
      // Load file content from vfs.
      const file = VFS.findFileById(container.getState().fileId);
      if (file) {
        if (LFS.loaded && typeof file.size === 'number' && file.size > LFS_MAX_FILE_SIZE) {
          // Disable the editor if the file is too large.
          this.editor.container.classList.add('exceeded-filesize');
          this.editor.setReadOnly(true);
          this.editor.clearSelection();
          this.editor.blur();
        } else if (!file.content && typeof LFS !== 'undefined') {
          LFS.getFileContent(file.id).then((content) => {
            this.editor.setValue(content);
            this.editor.clearSelection();
          });
        } else {
          this.editor.setValue(file.content);
          this.editor.clearSelection();
        }
      }
    }

    // Add custom class for styling purposes.
    getParentComponentElement().classList.add('component-container', 'editor-component-container');

    if (!getActiveEditor()) {
      setActiveEditor();
    }

    // Spawn a new worker if necessary.
    if (this.ready) {
      createWorkerApi(this.proglang);
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
    this.ready = true;

    // Reset the session after the first initial page render to prevent the
    // initial content is removed when users hit ctrl+z or cmd+z.
    this.editor.getSession().getUndoManager().reset();
  });

  container.on('destroy', () => {
    // If it's the last tab being closed, then we insert another 'Untitled' tab,
    // because we always need at least one tab open.
    if (getAllEditorTabs().length === 1) {
      const currentTab = getActiveEditor();
      if (currentTab) {
        currentTab.parent.addChild({
          type: 'component',
          componentName: 'editor',
          componentState: {
            fontSize: BASE_FONT_SIZE,
          },
          title: 'Untitled',
        });
      }
    } else {
      setActiveEditor(null);
    }

    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }
  });

  setTheme(getLocalStorageItem('theme') || 'light');
  setFontSize(state.fontSize || BASE_FONT_SIZE);

  // Set the proglang, or use 'text' as the filetype if there's no file ext.
  const filename = container.parent.config.title;
  const proglang = filename.includes('.') ? getFileExtension(filename) : 'text';
  setProgLang(proglang);
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

/**
 * If the writing goes wrong, this might be due to an infinite loop
 * that contains a print statement to the terminal. This results in the
 * write buffer 'exploding' with data that is queued for printing.
 * This function clears the write buffer which stops (most of the) printing
 * immediately.
 *
 * Furthermore, this function is called either when the user
 * pressed the 'stop' button or when the xtermjs component throws the error:
 *
 *   'Error: write data discarded, use flow control to avoid losing data'
 */
function clearTermWriteBuffer() {
  if (term) {
    term._core._writeBuffer._writeBuffer = [];
  }
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

  constructor(defaultLayoutConfig, options = {}) {
    let layoutConfig = getLocalStorageItem('layout');
    if (layoutConfig) {
      layoutConfig = JSON.parse(layoutConfig);
    } else {
      layoutConfig = defaultLayoutConfig;
    }

    super(layoutConfig, $('#layout'));

    this.proglang = options.proglang;
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

class LayoutIDE extends Layout {
  constructor(defaultLayoutConfig, options = {}) {
    super(defaultLayoutConfig, options);
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
