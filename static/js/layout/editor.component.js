import { BASE_FONT_SIZE } from '../constants.js';
import { getFileExtension, seconds } from '../helpers/shared.js';
import { createLangWorkerApi } from '../lang-worker-api.js';
import pluginManager from '../plugin-manager.js';
import localStorageManager from '../local-storage-manager.js';

/**
 * Editor component for GoldenLayout.
 */
export default class EditorComponent extends EventTarget {
  /**
   * Whether the editor has been rendered.
   * @type {boolean}
   */
  ready = false;

  /**
   * Component container object.
   * @type {GoldenLayout.ItemContainer}
   */
  container = null;

  /**
   * Initialization state.
   * @type {object}
   */
  state = null;

  /**
   * Instance of the editor for the current tab.
   * @type {Ace.Editor}
   */
  editor = null;

  /**
   * Whether the onContainerOpen event has been triggered falsely.
   * This happens when there is a single empty Untitled tab where the user
   * clicks on the left-sidebar to open another file. At this moment, the
   * Untitled tab will be closed, however, GoldenLayout switches to the Untitled
   * tab, closes it and then switches back to the newly inserted tab, which
   * triggers another 'show' event, which leads to code being run twice and thus
   * leading in an unexpected onfilechange event triggered, while the only thing
   * that the user did was open file.
   */
  fakeOnContainerOpenEvent = false;
  fakeOnEditorFocusEvent = false;

  /**
   * Indicates whether the user is currently typing in the editor.
   * @type {boolean}
   */
  userIsEditing = false;

  constructor(container, state) {
    super();
    this.container = container;
    this.state = state;

    this.init();
  }

  init = () => {
    this.bindContainerEvents();
    this.initEditor();
    this.bindEditorEvents();

    this.setTheme(localStorageManager.getLocalStorageItem('theme') || 'light');
    this.setFontSize(this.state.fontSize || BASE_FONT_SIZE);

    // Set the proglang, or use 'text' as the filetype if there's no file ext.
    const filename = this.getFilename();
    const proglang = filename.includes('.') ? getFileExtension(filename) : 'text';
    this.setProgLang(proglang);

    // Remove default sublime Ctrl+Enter command.
    this.editor.commands.removeCommand('addLineAfter');
  }

  /**
   * Initialize the editor instance, including rendering it in the DOM.
   */
  initEditor = () => {
    // To make sure GoldenLayout doensn't override the editor styles, we create
    // another child container for the editor instance.
    const contentContainer = this.container.getElement()[0];
    const editorContainer = document.createElement('div');
    editorContainer.classList.add('editor');
    contentContainer.appendChild(editorContainer);

    this.editor = ace.edit(editorContainer);
    this.editor.setKeyboardHandler('ace/keyboard/sublime');
    this.editor.setOption('fontSize');
    this.editor.setOption('enableSnippets', false);
    this.editor.setOption('enableBasicAutocompletion', true);
    this.editor.setOption('enableLiveAutocompletion', true);
    this.editor.setValue(this.state.value || '');
    this.editor.clearSelection();
    this.editor.completers = this.getAceCompleters();
  }

  /**
   * Register a new single command to the editor.
   *
   * @param {Ace.Command} command - Object with the command properties.
   * See https://ajaxorg.github.io/ace-api-docs/interfaces/ace.Ace.Command.html
   */
  addCommand = (command) => {
    this.editor.commands.addCommand(command);
  }

  /**
   * Register multiple new commands to the editor.
   *
   * @param {Ace.Command} command - Object with the command properties.
   * See https://ajaxorg.github.io/ace-api-docs/interfaces/ace.Ace.Command.html
   */
  addCommands = (commands) => {
    this.editor.commands.addCommands(commands);
  }

  /**
   * Register a callback function when a command is executed.
   *
   * @param {Function} callback - Function to be invoked.
   */
  onCommandExec = (callback) => {
    this.editor.commands.on('exec', callback);
  }

  /**
   * Move the current line under the cursor up.
   */
  moveLinesUp = () => {
    this.editor.moveLinesUp();
  }

  /**
   * Move the current line under the cursor down.
   */
  moveLinesDown = () => {
    this.editor.moveLinesDown();
  }

  /**
   * Callback when the editor content changes, triggered each keystroke.
   */
  onEditorChange = () => {
    this.container.extendState({ value: this.getContent() });

    if (!this.userIsEditing) {
      this.userIsEditing = true;
      this.dispatchEvent(new Event('startEditing'));
    }

    this.dispatchEvent(new Event('change'));

    clearTimeout(this.userIsTypingTimeoutId);
    this.userIsTypingTimeoutId = setTimeout(() => {
      this.userIsEditing = false;
      this.dispatchEvent(new Event('stopEditing'));
    }, seconds(2));
  }

  /**
   * Callback when the user's cursor is focused on the editor.
   */
  onEditorFocus = () => {
    if (this.fakeOnEditorFocusEvent) {
      this.fakeOnEditorFocusEvent = false;
      return;
    }

    this.dispatchEvent(new Event('focus'));

    // Spawn a new worker if necessary.
    createLangWorkerApi(this.proglang);
  }

  /**
   * Callback when the editor is opened for the first time or it is already open
   * and becomes active (i.e. the user clicks on the tab in the UI).
   */
  onShow = () => {
    if (!this.editor) return;

    if (this.fakeOnContainerOpenEvent) {
      this.fakeOnContainerOpenEvent = false;
      return;
    }

    setTimeout(() => {
      if (this.editor) {
        this.editor.focus();
      }
    }, 0);

    // Add custom class for styling purposes.
    this.getParentComponentElement().classList.add('component-container', 'editor-component-container');
  }

  /**
   * Get the cursor position in the editor.
   *
   * @returns {Ace.Point} Contains the row and column of the cursor.
   */
  getCursorPosition = () => {
    if (this.editor) {
      return this.editor.getCursorPosition();
    }
  }

  /**
   * Set the cursor position in the editor.
   *
   * @param {Ace.Point} point - Contains the row and column of the cursor.
   */
  setCursorPosition = (point) => {
    if (this.editor) {
      this.editor.moveCursorToPosition(point);
    }
  }

  /**
   * Get the current state of the editor.
   *
   * @returns {object} The state of the editor.
   */
  getState = () => {
    return this.container.getState();
  }

  /**
   * Extend the curent state of the editor.
   *
   * @param {object} state - Additional values to overwrite or set.
   */
  extendState = (state) => {
    this.container.extendState(state);
  }

  /**
   * Get the filename of the corresponding tab.
   *
   * @returns {string} The name of the tab.
   */
  getFilename = () => {
    return this.container.parent.config.title;
  }

  /**
   * Set the filename of the corresponding tab.
   *
   * @param {string} filename - The new name of the tab.
   */
  setFilename = (filename) => {
    this.container.parent.setTitle(filename);
  }

  /**
   * Disable the editor if the content is too large.
   */
  exceededFileSize = () => {
    this.editor.container.classList.add('exceeded-filesize');
    this.lock();
  }

  /**
   * Set the file content only when it has changed to prevent triggering
   * unnecessary or redundant events.
   *
   * @param {string} content - The content to set.
   */
  setContent = (content) => {
    if (typeof content === 'string' && this.getContent() !== content) {
      this.editor.setValue(content);
      this.editor.clearSelection();
    }
  }

  /**
   * Retrieve the current content of the editor.
   *
   * @returns {string} All editor lines concatenated with \n characters.
   */
  getContent = () => {
    if (!this.editor) return '';

    return this.editor.getValue();
  }

  /**
   * Clear the content of the editor.
   */
  clearContent = () => {
    this.editor.setValue('');
    this.editor.clearSelection();
  }

  /**
   * Close the current editor, which will completely destroy the editor.
   */
  close = () => {
    this.container.close();
  }

  /**
   * Lock the current editor by disabling any user input and any selection.
   */
  lock = () => {
    this.editor.setOptions({
      readOnly: true,
      highlightActiveLine: false,
      highlightGutterLine: false,
      highlightSelectedWord: false,
      highlightIndentGuides: false,
    });

    this.editor.clearSelection();
    this.editor.blur();
  }

  /**
   * Unlock the current editor, allowing user input and selection.
   */
  unlock = () => {
    this.editor.setOptions({
      readOnly: false,
      highlightActiveLine: true,
      highlightGutterLine: true,
      highlightSelectedWord: true,
      highlightIndentGuides: true,
    });
  }

  /**
   * Add a new Untitled sibling tab next to the current editor.
   *
   * @param {GoldenLayout.ContentItem} config - Content item config object.
   */
  addSiblingTab = (config = {}) => {
    this.container.parent.parent.addChild({
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
   * Callback to set the custom autocompleter for the editor.
   *
   * @param {array} completions - List of objects with 'name' and 'value' keys.
   */
  onContainerSetCustomAutoCompleter = (completions) => {
    this.editor.completers.push({
      getCompletions: (editor, session, pos, prefix, callback) => {
        if (prefix.length === 0) {
          callback(null, []);
          return;
        }

        callback(null, completions);
      }
    });
  }

  /**
   * Callback when the container is resized.
   */
  onContainerResize = () => {
    this.editor.setAutoScrollEditorIntoView(true);
    this.editor.resize();
  }

  /**
   * Callback when the container is rendered for the first time.
   */
  onContainerAfterFirstRender = () => {
    this.ready = true;

    // Reset the session after the first initial page render to prevent the
    // initial content is removed when users hit ctrl+z or cmd+z.
    this.clearUndoStack();

    // Prevent the user from selecting text when the editor is locked.
    this.editor.getSession().selection.on('changeSelection', (e) => {
      if (this.editor.getReadOnly()) {
        this.editor.getSession().selection.clearSelection();
      }
    });
  }

  /**
   * Clear the undo stack of the editor.
   */
  clearUndoStack = () => {
    this.editor.getSession().getUndoManager().reset();
  }

  setActive = () => {
    this.container.parent.parent.setActiveContentItem(this.container.parent);
  }

  /**
   * Callback before the container is destroyed.
   */
  onDestroy = () => {
    if (!this.editor) return;
    this.dispatchEvent(new Event('destroy'));

    this.editor.destroy();
    this.editor = null;
  }

  /**
   * Get the parent component element.
   */
  getParentComponentElement = () => {
    return this.container.parent.parent.element[0];
  }

  /**
   * Set the font size of the editor.
   *
   * @param {number} fontSize - The font size in pixels.
   */
  setFontSize = (fontSize) => {
    this.container.extendState({ fontSize });
    this.editor.setFontSize(`${fontSize}px`);
  }

  /**
   * Set the theme of the editor.
   *
   * @param {string} theme - Either 'dark' or 'light'.
   */
  setTheme = (theme) => {
    const newTheme = (theme === 'dark')
      ? 'ace/theme/cloud_editor_dark'
      : 'ace/theme/textmate'

    this.editor.setTheme(newTheme);
  }

  /**
   * Create local text completer.
   *
   * Largely based on text_completer.js from ajaxorg/ace
   * under the BSD license included in the ace project
   * https://github.com/ajaxorg/ace/blob/master/LICENSE
   *
   * @returns {array} List of completers.
   */
  getAceCompleters = () => {
    const Range = ace.Range;

    const splitRegex = /[^a-zA-Z_0-9\$\-\u00C0-\u1FFF\u2C00-\uD7FF\w]+/;

    function getWordIndex(doc, pos) {
      const textBefore = doc.getTextRange(Range.fromPoints({
        row: 0,
        column: 0
      }, pos));
      return textBefore.split(splitRegex).length - 1;
    }

    /**
     * Does a distance analysis of the word `prefix` at position `pos` in `doc`.
     * @return Map
     */
    function wordDistance(doc, pos) {
      const prefixPos = getWordIndex(doc, pos);
      const words = [];
      const wordScores = Object.create(null);
      const rowCount = doc.getLength();

      // Extract tokens via the ace tokenizer
      for (let row = 0; row < rowCount; row++) {
        const tokens = doc.getTokens(row);

        tokens.forEach(token => {
          // Only include non-comment tokens
          if (!['string', 'comment'].includes(token.type)) {
            const tokenWords = token.value.split(splitRegex);
            words.push(...tokenWords);
          }
        });
      }

      // Create a score list
      const currentWord = words[prefixPos];

      words.forEach(function(word, idx) {
        if (!word || word === currentWord) return;
        if (/^[0-9]/.test(word)) return; // Custom: exclude numbers

        const distance = Math.abs(prefixPos - idx);
        const score = words.length - distance;
        if (wordScores[word]) {
          wordScores[word] = Math.max(score, wordScores[word]);
        }
        else {
          wordScores[word] = score;
        }
      });
      return wordScores;
    }

    const customCompleter = {
      getCompletions: function(editor, session, pos, prefix, callback) {
        const wordScore = wordDistance(session, pos);
        const wordList = Object.keys(wordScore);
        callback(null, wordList.map(function(word) {
          return {
            caption: word,
            value: word,
            score: wordScore[word],
            meta: "" // note: this used to be "local" but is removed to make UI cleaner
          };
        }));
      }
    }

    return [customCompleter];
  }

  /**
   * Set the programming language of the editor.
   *
   * @param {string} proglang - File extension or programming language.
   */
  setProgLang = (proglang) => {
    let mode;

    // By default, the mode is just the proglang itself.
    // However, we need to convert some file extensions (=proglang) to the
    // correct corresponding mode.
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

      case 'txt':
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
  }

  /**
   * Bind all editor events with callbacks.
   */
  bindEditorEvents = () => {
    this.editor.on('change', () => {
      this.onEditorChange();
      pluginManager.triggerEvent('onEditorChange', this);
    });

    this.editor.on('focus', () => {
      this.onEditorFocus();
      pluginManager.triggerEvent('onEditorFocus', this);
    });
  }

  /**
   * Bind all container events with callbacks.
   */
  bindContainerEvents = () => {
    // Do not trigger the plugin manager here, this is handeld elsewhere.
    this.container.on('afterFirstRender', this.onContainerAfterFirstRender);

    this.container.on('onTabDragStop', ({ event, tab }) => {
      pluginManager.triggerEvent('onTabDragStop', event, tab);
    });

    this.container.on('show', () => {
      this.onShow();
      this.dispatchEvent(new Event('show'));
      pluginManager.triggerEvent('onEditorShow', this);
    });

    this.container.on('lock', () => {
      this.lock();
      pluginManager.triggerEvent('onEditorLock', this);
    });

    this.container.on('unlock', () => {
      this.unlock();
      pluginManager.triggerEvent('onEditorUnlock', this);
    });

    this.container.on('setCustomAutocompleter', (completions) => {
      this.onContainerSetCustomAutoCompleter(completions);
    });

    this.container.on('themeChanged', (theme) => {
      this.setTheme(theme);
      pluginManager.triggerEvent('setEditorTheme', theme, this);
    });

    this.container.on('fontSizeChanged', (fontSize) => {
      this.setFontSize(fontSize);
      pluginManager.triggerEvent('setEditorFontSize', fontSize, this);
    });

    this.container.on('resize', () => {
      this.onContainerResize();
      pluginManager.triggerEvent('onEditorContainerResize', this);
    });

    this.container.on('destroy', () => {
      this.onDestroy();
      pluginManager.triggerEvent('onEditorDestroy', this);
    });

    this.container.on('vfsChanged', () => {
      this.dispatchEvent(new Event('vfsChanged'));
      pluginManager.triggerEvent('onEditorContentChanged', this);
    });
  }
}
