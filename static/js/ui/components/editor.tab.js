import { BASE_FONT_SIZE } from '../../constants.js';
import { getFileExtension, seconds } from '../../lib/helpers.js';
import FileTab from './file.tab.js';

/**
 * Editor component for GoldenLayout, based on the Ace editor.
 */
export default class EditorTab extends FileTab {
  /**
   * Whether the editor has been rendered.
   * @type {boolean}
   */
  ready = false;

  /**
   * Instance of the editor for the current tab.
   * @type {Ace.Editor}
   */
  editor = null;

  /**
   * Indicates whether the user is currently typing in the editor.
   * @type {boolean}
   */
  userIsEditing = false;

  /**
   * Indicates whether it is the first time loading the content. This check is
   * needed to prevent the 'change' event being triggered when the tab opens for
   * the first time.
   * @type {boolean}
   */
  firstTimeLoadingContent = true;

  constructor(container) {
    super(container);

    this.init();
  }

  init = () => {
    this.bindContainerEvents();
    this.initEditor();
    this.bindEditorEvents();

    this.setTheme(this.container.getState().theme || 'light');
    this.setFontSize(this.container.getState().fontSize || BASE_FONT_SIZE);

    this.setProgLang();

    // Remove default Ctrl+N and Ctrl+Shift+N keybindings since we want them to
    // be handled by Terra globally.
    // Only the keybinding must be removed, because the commands have other
    // shortcuts (e.g. just the down arrow!).
    for (const cmd of ['golinedown', 'selectdown']) {
      this.editor.commands.commands[cmd].bindKey.mac = this.editor.commands.commands[cmd].bindKey.mac
        .split('|')
        .filter((cmd) => !['Ctrl-N', 'Ctrl-Shift-N'].includes(cmd))
        .join('|');
    }
  }

  /**
   * Initialize the editor instance, including rendering it in the DOM.
   */
  initEditor = () => {
    // To make sure GoldenLayout doensn't override the editor styles, we create
    // another child container for the editor instance.
    const contentContainer = this.container.element;
    const editorContainer = document.createElement('div');
    editorContainer.classList.add('editor');
    contentContainer.appendChild(editorContainer);

    this.editor = ace.edit(editorContainer);
    this.editor.setOption('enableSnippets', false);
    this.editor.setOption('enableBasicAutocompletion', true);
    this.editor.setOption('enableLiveAutocompletion', true);
    this.editor.setValue(this.container.getState().value || '');
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
   * Focus the editor instance.
   */
  focus = () => {
    if (this.editor) {
      this.editor.focus();
    }
  }

  /** Copy the editor's selection to the system clipboard. */
  copyToClipboard = () => {
    if (!this.editor.selection.isEmpty()) {
      navigator.clipboard.writeText(this.editor.getSelectedText());
    }
  }

  /** Copy the editor's selection, then delete it. */
  cutToClipboard = () => {
    this.copyToClipboard();
    this.editor.insert('');
  }

  /** Insert the clipboard contents at the editor's cursor. */
  pasteFromClipboard = () => {
    navigator.clipboard.readText().then((text) => {
      this.editor.insert(text);
    });
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
    this.dispatchEvent(new Event('focus'));
  }

  /**
   * Callback when the editor is opened for the first time or it is already open
   * and becomes active (i.e. the user clicks on the tab in the UI).
   */
  onShow = () => {
    if (!this.editor) return;

    // This focus is needed when switching between tabs where we use a
    // set-timeout to make sure the editor is fully rendered.
    setTimeout(() => {
      if (this.editor) {
        this.editor.focus();
      }
    }, 100);

    // Add custom class for styling purposes.
    this.getParentComponentElement().classList.add('component-container', 'editor-component-container');
  }

  onHide = () => {
    // Remove class that was added.
    // Function deleted because removing the classes only causes problems.
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
   * Disable the editor if the content is too large.
   */
  exceededFileSize = () => {
    this.editor.container.parentNode.classList.add('exceeded-filesize');
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

    if (this.firstTimeLoadingContent) {
      this.clearUndoStack();
      this.firstTimeLoadingContent = false;
    }
  }

  /**
   * Add content to the end of the file, separated from what is already there
   * by a blank line, and focus the editor. When the snippet carries a
   * placeholder body its `...` is selected, so the user can type the body
   * straight over it; otherwise the caret goes to the snippet's first line,
   * which at least shows where it landed. Inserting (rather than replacing the
   * whole value) keeps the undo history intact, so the addition can be undone.
   *
   * @param {string} content - The content to append.
   */
  appendContent = (content) => {
    if (!this.editor || typeof content !== 'string') return;

    const text = content.replace(/\s+$/, '');
    const doc = this.editor.session.getDocument();
    const lastRow = doc.getLength() - 1;
    const end = { row: lastRow, column: doc.getLine(lastRow).length };

    const isEmpty = doc.getValue().trim() === '';
    const separator = isEmpty ? '' : '\n\n';
    doc.insert(end, separator + text + '\n');

    const startRow = isEmpty ? 0 : end.row + 2;
    this.editor.scrollToLine(startRow, false, true);

    const placeholder = findPlaceholder(text);
    if (placeholder) {
      // Anchor first, then move the cursor: that spans the selection over the
      // placeholder instead of extending whatever was selected before.
      const row = startRow + placeholder.row;
      const selection = this.editor.getSelection();
      selection.setSelectionAnchor(row, placeholder.column);
      selection.moveCursorTo(row, placeholder.column + PLACEHOLDER.length);
      this.editor.renderer.scrollCursorIntoView();
    } else {
      this.editor.moveCursorTo(startRow, 0);
      this.editor.clearSelection();
    }

    this.focus();
  }

  /**
   * Find the line matching the given text and bring it into view, putting the
   * caret at its start. Leading and trailing whitespace is ignored on both
   * sides of the comparison.
   *
   * @param {string} line - The line to look for.
   * @returns {boolean} Whether such a line was found.
   */
  revealLine = (line) => {
    if (!this.editor || typeof line !== 'string') return false;

    const target = line.trim();
    const row = this.editor.session.getDocument().getAllLines()
      .findIndex((text) => text.trim() === target);

    if (row === -1) return false;

    this.editor.moveCursorTo(row, 0);
    this.editor.clearSelection();
    this.editor.scrollToLine(row, true, true);
    this.focus();

    return true;
  }

  /**
   * Reload the editor with new content while keeping the caret where the user
   * left it. Optionally reset the undo history (used after an external/VFS
   * reload so the reload itself is not undoable).
   *
   * @param {string} content - The new editor content.
   * @param {object} [options]
   * @param {boolean} [options.clearUndoStack=false] - Whether to clear the
   * undo stack after applying the content.
   */
  reloadContent = (content, { clearUndoStack = false } = {}) => {
    const cursorPos = this.getCursorPosition();
    this.setContent(content);
    this.setCursorPosition(cursorPos);

    if (clearUndoStack) {
      this.clearUndoStack();
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
   * Set the font size of the editor.
   *
   * @param {number} fontSize - The font size in pixels.
   */
  setFontSize = (fontSize) => {
    this.container.extendState({ fontSize });
    this.editor.setFontSize(fontSize);
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
  setProgLang = () => {
    // Set the proglang, or use 'text' as the filetype if there's no file ext.
    const filename = this.getFilename();
    const proglang = filename.includes('.') ? getFileExtension(filename) : 'text';

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
      case 'w': // Karel world files: plain text, previewed on the canvas.
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
      // Only trigger a change event when the content actually changed.
      // This excludes the first time the content is loaded when the tab opened.
      if (!this.firstTimeLoadingContent) {
        this.onEditorChange();
      }
    });

    this.editor.on('focus', () => {
      this.onEditorFocus();
    });
  }

  /**
   * Bind all container events with callbacks.
   */
  bindContainerEvents = () => {
    // Do not trigger the plugin manager here, this is handeld elsewhere.
    this.container.on('afterFirstRender', this.onContainerAfterFirstRender);

    this.container.on('onTabDragStop', ({ event, tab }) => {
      this.dispatchEvent(new CustomEvent('tabDragStop', { detail: { event, tab } }));
    });

    this.container.on('show', () => {
      this.onShow();
      this.dispatchEvent(new Event('show'));
    });

    this.container.on('hide', () => {
      this.onHide();
      this.dispatchEvent(new Event('hide'));
    });

    this.container.on('lock', () => {
      this.lock();
      this.dispatchEvent(new Event('lock'));
    });

    this.container.on('unlock', () => {
      this.unlock();
      this.dispatchEvent(new Event('unlock'));
    });

    this.container.on('setCustomAutocompleter', (completions) => {
      this.onContainerSetCustomAutoCompleter(completions);
    });

    this.container.on('themeChanged', (theme) => {
      this.setTheme(theme);
    });

    // Triggers when font changed by user (not on first load)
    this.container.on('fontSizeChanged', (fontSize) => {
      this.setFontSize(fontSize);
    });

    this.container.on('resize', () => {
      this.onContainerResize();
      this.dispatchEvent(new Event('resize'));
    });

    this.container.on('destroy', () => {
      this.onDestroy();
    });

  }
}

/** The stand-in for a body the user still has to write. */
const PLACEHOLDER = '...';

/**
 * Locate the placeholder in a snippet: the first line that is nothing but a
 * bare `...`, or a `return ...`. Requiring the whole line to match keeps an
 * ellipsis that is part of a string or a comment (`'loud...'`) out of it.
 *
 * @param {string} text - The snippet to search.
 * @returns {?object} An `{ row, column }` position, or null when the snippet
 * has no placeholder.
 */
function findPlaceholder(text) {
  const lines = text.split('\n');

  for (let row = 0; row < lines.length; row++) {
    if (/^\s*(return\s+)?\.\.\.\s*$/.test(lines[row])) {
      return { row, column: lines[row].indexOf(PLACEHOLDER) };
    }
  }

  return null;
}
