/**
 * Disposes the user input when active. This is actived once user input is
 * requested through the `waitForInput` function.
 */
Terra.f.disposeUserInput = () => {
  if (Terra.f.isObject(Terra.v.userInputDisposable) && typeof Terra.v.userInputDisposable.dispose === 'function') {
    Terra.v.userInputDisposable.dispose();
    Terra.v.userInputDisposable = null;
  }
}

/**
 * Hide the cursor inside the terminal component.
 */
Terra.f.hideTermCursor = () => {
  term.write('\x1b[?25l');
}

/**
 * Show the cursor inside the terminal component.
 */
Terra.f.showTermCursor = () => {
  term.write('\x1b[?25h');
}

/**
 * Enable stdin in the terminal and record the user's keystrokes. Once the user
 * presses ENTER, the promise is resolved with the user's input.
 *
 * @returns {Promise<string>} The user's input.
 */
Terra.f.waitForInput = () => {
  return new Promise(resolve => {
    // Immediately focus the terminal when user input is requested.
    Terra.f.showTermCursor();
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
    Terra.v.userInputDisposable = term.onKey(e => {
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
        Terra.f.disposeUserInput();

        // Trigger a real enter in the terminal.
        term.write('\n');
        value += '\n';

        Terra.f.hideTermCursor();
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
Terra.f.clearTermWriteBuffer = () => {
  if (term) {
    term._core._writeBuffer._writeBuffer = [];
  }
}
