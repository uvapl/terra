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

  $modal.find('.cancel-btn').click(() => {
    if (window._saveFileTippy) {
      window._saveFileTippy.destroy();
      window._saveFileTippy = null;
    }

    hideModal($modal);
  });
  $modal.find('.primary-btn').click(() => {
    const filename = $modal.find('.text-input').val();

    let folderId = $modal.find('.select').val();
    if (folderId === 'root') {
      folderId = null;
    }

    let errorMsg;
    if (!isValidFilename(filename)) {
      errorMsg = 'Name can\'t contain \\ / : * ? " < > |';
    } else if (VFS.existsWhere({ parentId: folderId, name: filename })) {
      errorMsg = `There already exists a "${filename}" file or folder`;
    }

    if (errorMsg) {
      if (window._saveFileTippy) {
        window._saveFileTippy.destroy();
        window._saveFileTippy = null;
      }

      // Create new tooltip.
      window._saveFileTippy = tippy($modal.find('input').parent()[0], {
        content: errorMsg,
        showOnCreate: true,
        placement: 'top',
        theme: 'error',
      });

      $modal.find('input').focus().select();

      return;
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

    const proglang = getFileExtension(filename);

    // Set correct syntax highlighting.
    tab.instance.setProgLang(proglang)

    createWorkerApi(proglang);
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
