import { BASE_FONT_SIZE } from '../constants.js';
import { isObject } from '../helpers/shared.js';
import Terra from '../terra.js';

/**
 * Terminal component for GoldenLayout.
 */
export default class TerminalComponent {
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
  term = null;

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
   * Write a message to the terminal.
   *
   * @param {string} msg - The message to write.
   */
  write = (msg) => {
    this.term.write(msg);
  }

  /**
   * Write a line to the terminal.
   *
   * @param {string} msg - The message to write.
   */
  writeln = (msg) => {
    this.term.writeln(msg);
  }

  /**
   * Clear the terminal screen.
   */
  clear = () => {
    this.term.reset();
  }

  /**
   * Focus the terminal component.
   */
  focus = () => {
    this.term.focus();
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

    const fontSize = this.state.fontSize || BASE_FONT_SIZE;

    this.term = new Terminal({
      convertEol: true,
      disableStdin: true,
      cursorBlink: true,
      fontSize,
      lineHeight: 1.2
    });
    this.term.loadAddon(this.fitAddon);
    this.term.open(this.container.getElement()[0]);
    this.fitAddon.fit();

    this.term._core._customKeyEventHandler = Terra.app.handleControlC;

    // Trigger a single resize after the terminal has rendered to make sure it
    // fits the whole parent width and doesn't leave any gaps near the edges.
    setTimeout(() => {
      $(window).trigger('resize');
    }, 0);


    this.setFontSize(fontSize);
    this.hideTermCursor();
  }

  /**
   * Callback to set the editor into a vertical layout.
   */
  onVerticalLayout = () => {
    this.container.tab.header.position(false);
  }

  /**
   * Callback when the container is destroyed.
   */
  onContainerDestroy = () => {
    if (this.term && typeof this.term.destroy === 'function') {
      this.term.destroy();
    }

    this.term = null;
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
    this.term.options.fontSize = fontSize;
    this.fitAddon.fit();
  };

  /**
   * Get the parent component element.
   */
  getParentComponentElement = () => {
    return this.container.parent.parent.element[0];
  }

  /**
   * Disposes the user input when active. This is actived once user input is
   * requested through the `waitForInput` function in order to remove the onKey
   * event listener that is binded by the `waitForInput` function.
   */
  disposeUserInput = () => {
    if (isObject(this.userInputDisposable) && typeof this.userInputDisposable.dispose === 'function') {
      this.userInputDisposable.dispose();
      this.userInputDisposable = null;
    }

    this.term.textarea.removeEventListener('paste', this.handleUserPaste);
  }

  /**
   * Hide the cursor inside the terminal component.
   */
  hideTermCursor = () => {
    this.term.write('\x1b[?25l');
  }

  /**
   * Show the cursor inside the terminal component.
   */
  showTermCursor = () => {
    this.term.write('\x1b[?25h');
  }

  handleUserPaste = (event) => {
    // Get the pasted text from the clipboard.
    const clipboardData = event.clipboardData || window.clipboardData;
    let pastedData = clipboardData.getData('Text').replace(/[\r\n]/g, '');

    // Remove blacklisted characters from the pasted text.
    const blacklistedCharsPattern = new RegExp(`[${this.blacklistedKeys.join('')}]`, 'g');
    pastedData = pastedData.replace(blacklistedCharsPattern, '');

    this.term.write(pastedData);
    this.userInput += pastedData;
  }


  /**
   * Enable stdin in the terminal and record the user's keystrokes. Once the
   * user presses ENTER, the promise is resolved with the user's input.
   *
   * @returns {Promise<string>} The user's input.
   */
  waitForInput = () => {
    return new Promise((resolve) => {
      // Immediately focus the terminal when user input is requested.
      this.showTermCursor();
      this.term.focus();

      // Keep track of the value that is typed by the user.
      this.userInput = '';

      this.term.textarea.addEventListener('paste', this.handleUserPaste);

      this.userInputDisposable = this.term.onKey(e => {
        // Only append allowed characters.
        if (!this.blacklistedKeys.includes(e.key)) {
          this.term.write(e.key);
          this.userInput += e.key;
        }

        // Remove the last character when pressing backspace. This is done by
        // triggering a backspace '\b' character and then insert a space at that
        // position to clear the character.
        if (e.key === '\u007f' && this.userInput.length > 0) {
          this.term.write('\b \b');
          this.userInput = this.userInput.slice(0, -1);
        }

        // If the user presses enter, resolve the promise.
        if (e.key === '\r') {
          this.disposeUserInput();

          // Trigger a real enter in the terminal.
          this.term.write('\n');
          this.userInput += '\n';

          this.hideTermCursor();
          resolve(this.userInput);
        }
      });
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
    if (this.term && this.term._core) {
      this.term._core._writeBuffer._writeBuffer = [];
    }
  }

  /**
   * Bind all container events with callbacks.
   */
  bindContainerEvents = () => {
    this.container.on('open', this.onShow);
    this.container.on('verticalLayout', this.onVerticalLayout);
    this.container.on('fontSizeChanged', this.setFontSize);
    this.container.on('resize', this.onContainerResize);
    this.container.on('destroy', this.onContainerDestroy);
  }
}
