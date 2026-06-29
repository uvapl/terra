import { BASE_FONT_SIZE } from '../../constants.js';

/**
 * Terminal component for GoldenLayout.
 */
export default class TerminalTab {
  /**
   * An addon for xterm.js that enables fitting the terminal's dimensions to a
   * containing element. This addon requires xterm.js v4+.
   * @see https://github.com/xtermjs/xterm.js/blob/a260f7d2889142d6566a66cb9856a07050dea611/addons/addon-fit/README.md
   *
   * @type {FitAddon}
   */
  fitAddon = new FitAddon.FitAddon();

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
   * Reference to the xterm.js component.
   * @type {Terminal}
   */
  terminalInstance = null;

  /**
   * Identifies who currently owns keyboard input on the terminal. One of
   * `null` (nobody — keystrokes are dropped, the default e.g. in the exam),
   * `'shell'` (the shell plugin's input loop) or `'program'` (a running
   * program reading stdin via waitForInput). Only the owner receives keys.
   * @type {string|null}
   */
  inputOwner = null;

  /**
   * Per-keystroke handler for the current input owner, or null when there is
   * no owner. Receives xterm.js onKey events.
   * @type {?function}
   */
  inputHandler = null;

  /**
   * Paste handler for the current input owner, called with the cleaned
   * (blacklist-stripped) pasted text, or null when there is no owner.
   * @type {?function}
   */
  inputPasteHandler = null;

  /**
   * Saved input owners, so that releasing input restores the previous owner
   * rather than dropping to nobody. This lets a program transiently take over
   * input (e.g. for stdin) while the shell is active and hand it back when the
   * run ends. Each entry is { owner, onKey, onPaste }.
   * @type {array}
   */
  inputStack = [];

  // Disable some special characters when input is enabled.
  // For all input sequences, see http://xtermjs.org/docs/api/vtfeatures/#c0
  blacklistedKeys = [
    '\u007f', // Backspace
    '\t',     // Tab
    '\r',     // Enter
  ]

  constructor(container, state) {
    this.container = container;
    this.state = state;

    this.init();
  }

  init = () => {
    this.container.parent.isTerminal = true;
    this.bindContainerEvents();
  }

  /**
   * Tracks whether the last write() did not end in a newline, so a run can
   * print the inverted `%` marker (see printForgotNewline).
   * @type {boolean}
   */
  lastWriteNotTerminated = false;

  /**
   * Write a message to the terminal.
   *
   * If writing throws, the write buffer has likely 'exploded' (e.g. an infinite
   * loop printing to the terminal); clear it to stop most of the flood.
   *
   * @param {string} msg - The message to write.
   */
  write = (msg) => {
    this.lastWriteNotTerminated = !(typeof msg === 'string' && msg.endsWith("\n"));

    try {
      this.terminalInstance.write(msg);
    } catch (e) {
      console.log('Caught write error on the terminal - clearing buffer;');
      console.log(e);
      this.clearTermWriteBuffer();
    }
  }

  /**
   * Write a line to the terminal.
   *
   * @param {string} msg - The message to write.
   */
  writeln = (msg) => {
    this.terminalInstance.writeln(msg);
  }

  cleanWriteln = (msg) => {
    if (this.lastWriteNotTerminated) msg = "\n" + msg;
    this.lastWriteNotTerminated = false;
    this.terminalInstance.writeln(msg);
  }

  /**
   * Clear current line.
   */
  clearCurrentLine = (msg) => {
    this.terminalInstance.write('\r\x1b[2K');
  }

  /**
   * Print an inverted `%` when the last write did not end in a newline (zsh
   * style), so trailing output without a final newline stays visible. Called
   * at the end of a run.
   */
  printForgotNewline = () => {
    if (this.lastWriteNotTerminated) {
      this.lastWriteNotTerminated = false;
      this.writeln('\x1b[7m%\x1b[0m');
    }
  }

  /**
   * Clear the terminal screen.
   */
  clear = () => {
    this.terminalInstance.reset();
  }

  /**
   * Focus the terminal component.
   */
  focus = () => {
    this.terminalInstance.focus();
  }

  hasFocus = () => {
    if (this.terminalInstance.textarea) {
      return document.activeElement === this.terminalInstance.textarea;
    } else {
      console.log("non area")
    }
  }

  /**
   * Emit an event to the container.
   *
   * @param {string} event - The name of the event.
   * @param {object} data - Data to pass to the event handler.
   */
  emit = (event, data) => {
    this.container.emit(event, data);
  }

  /**
   * Callback when the editor is opened for the first time or it is already open
   * and becomes active (i.e. the user clicks on the tab in the UI).
   */
  onShow = () => {
    // Add custom class for styling purposes.
    this.getParentComponentElement().classList.add('component-container', 'terminal-component-container');

    const fontFamily = "12px/normal 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', 'Source Code Pro', 'source-code-pro', monospace";
    const fontSize = this.state.fontSize || BASE_FONT_SIZE;

    this.terminalInstance = new Terminal({
      convertEol: true,
      disableStdin: true,
      cursorStyle: 'bar',
      cursorBlink: true,
      fontFamily,
      fontSize,
      lineHeight: 1.2
    });
    this.terminalInstance.loadAddon(this.fitAddon);
    this.terminalInstance.open(this.container.getElement()[0]);
    // show cursor immediately
    this.terminalInstance.write('\x1b[?25h');
    this.fitAddon.fit();

    // A single, persistent input pipeline: every keystroke and paste is routed
    // to whoever currently owns input (see acquireInput/releaseInput). When
    // there is no owner the events are dropped, which is the default behaviour
    // for environments without a shell (e.g. the exam).
    this.terminalInstance.onKey((e) => {
      if (this.inputHandler) this.inputHandler(e);
    });
    this.terminalInstance.textarea.addEventListener('paste', this._handlePaste);

    // Trigger a single resize after the terminal has rendered to make sure it
    // fits the whole parent width and doesn't leave any gaps near the edges.
    setTimeout(() => {
      $(window).trigger('resize');
    }, 0);

    this.setFontSize(fontSize);
  }

  /**
   * Callback when the container is destroyed.
   */
  onContainerDestroy = () => {
    if (this.terminalInstance && typeof this.terminalInstance.destroy === 'function') {
      this.terminalInstance.destroy();
    }

    this.terminalInstance = null;
  }

  /**
   * Callback when the container is resized.
   */
  onContainerResize = () => {
    this.fitAddon.fit();
  }

  /**
   * Set the font size of the editor.
   *
   * @param {number} fontSize - The font size in pixels.
   */
  setFontSize = (fontSize) => {
    this.container.extendState({ fontSize });
    this.terminalInstance.options.fontSize = fontSize;
    this.fitAddon.fit();
  };

  /**
   * Get the parent component element.
   */
  getParentComponentElement = () => {
    return this.container.parent.parent.element[0];
  }

  /**
   * Acquire keyboard input for a given owner. Any subsequent keystroke or
   * paste is routed to the supplied handlers until the same owner releases it.
   * The cursor is shown and the terminal focused so the user can start typing.
   *
   * @param {string} owner - One of 'shell' or 'program'.
   * @param {object} handlers
   * @param {function} handlers.onKey - Called with each xterm.js onKey event.
   * @param {function} [handlers.onPaste] - Called with cleaned pasted text.
   */
  acquireInput = (owner, { onKey, onPaste } = {}) => {
    // Remember the current owner so releasing restores it (e.g. a program
    // taking over input while the shell is active hands back to the shell).
    this.inputStack.push({
      owner: this.inputOwner,
      onKey: this.inputHandler,
      onPaste: this.inputPasteHandler,
    });

    this.inputOwner = owner;
    this.inputHandler = onKey || null;
    this.inputPasteHandler = onPaste || null;
  }

  /**
   * Release keyboard input held by the given owner, restoring the previous
   * owner. No-op when a different owner currently holds input, so a stale
   * release cannot steal it.
   *
   * @param {string} owner - The owner that previously acquired input.
   */
  releaseInput = (owner) => {
    if (this.inputOwner !== owner) return;

    const prev = this.inputStack.pop() || { owner: null, onKey: null, onPaste: null };
    this.inputOwner = prev.owner;
    this.inputHandler = prev.onKey;
    this.inputPasteHandler = prev.onPaste;
  }

  /**
   * Disposes the program's stdin input. Kept for the run lifecycle in app.js,
   * which calls this when a run ends or is aborted; it simply releases input
   * held by the running program.
   */
  disposeUserInput = () => {
    this.releaseInput('program');
  }

  /**
   * Show the cursor inside the terminal component.
   */
  showTermCursor = () => {
    this.terminalInstance.write('\x1b[?25h');
  }

  /**
   * Persistent paste handler. Cleans the pasted text (stripping newlines and
   * blacklisted control characters) and forwards it to the current input
   * owner's paste handler, if any.
   *
   * @param {ClipboardEvent} event
   */
  _handlePaste = (event) => {
    if (!this.inputPasteHandler) return;

    // Get the pasted text from the clipboard.
    const clipboardData = event.clipboardData || window.clipboardData;
    let pastedData = clipboardData.getData('Text').replace(/[\r\n]/g, '');

    // Remove blacklisted characters from the pasted text.
    const blacklistedCharsPattern = new RegExp(`[${this.blacklistedKeys.join('')}]`, 'g');
    pastedData = pastedData.replace(blacklistedCharsPattern, '');

    this.inputPasteHandler(pastedData);
  }

  /**
   * Enable stdin for a running program and record the user's keystrokes. Once
   * the user presses ENTER, the promise is resolved with the user's input.
   * This is the 'program' input owner expressed through acquireInput.
   *
   * @returns {Promise<string>} The user's input.
   */
  waitForInput = () => {
    return new Promise((resolve) => {
      // Keep track of the value that is typed by the user.
      this.userInput = '';

      const onKey = (e) => {
        // Only append allowed characters.
        if (!this.blacklistedKeys.includes(e.key)) {
          this.terminalInstance.write(e.key);
          this.userInput += e.key;
        }

        // Remove the last character when pressing backspace. This is done by
        // triggering a backspace '\b' character and then insert a space at that
        // position to clear the character.
        if (e.key === '\u007f' && this.userInput.length > 0) {
          this.terminalInstance.write('\b \b');
          this.userInput = this.userInput.slice(0, -1);
        }

        // If the user presses enter, resolve the promise.
        if (e.key === '\r') {
          this.releaseInput('program');

          // Trigger a real enter in the terminal.
          this.terminalInstance.write('\n');
          this.userInput += '\n';

          resolve(this.userInput);
        }
      };

      const onPaste = (text) => {
        this.terminalInstance.write(text);
        this.userInput += text;
      };

      this.acquireInput('program', { onKey, onPaste });
    });
  }

  /**
   * If the writing goes wrong, this might be due to an infinite loop that
   * contains a print statement to the terminal. This results in the write
   * buffer 'exploding' with data that is queued for printing. This function
   * clears the write buffer which stops (most of the) printing immediately.
   *
   * Furthermore, this function is called either when the user pressed the
   * 'stop' button or when the xtermjs component throws the error:
   *
   *   'Error: write data discarded, use flow control to avoid losing data'
   */
  clearTermWriteBuffer = () => {
    if (this.terminalInstance && this.terminalInstance._core) {
      this.terminalInstance._core._writeBuffer._writeBuffer = [];
    }
  }

  /**
   * Bind all container events with callbacks.
   */
  bindContainerEvents = () => {
    this.container.on('open', this.onShow);
    this.container.on('fontSizeChanged', this.setFontSize);
    this.container.on('resize', this.onContainerResize);
    this.container.on('destroy', this.onContainerDestroy);
  }
}
