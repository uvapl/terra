/**
 * Get the active tab its editor instance.
 *
 * @returns {object} The active editor instance.
 */
Terra.f.getActiveEditor = () => {
  return Terra.layout._lastActiveEditor;
}

/**
 * Gathers all files from the editor and returns them as an array of objects.
 *
 * @returns {Promise<array>} List of objects, each containing the filename and
 * content of the corresponding editor tab.
 */
Terra.f.getAllEditorFiles = () => {
  return Promise.all(
    Terra.f.getAllEditorTabs().map(async (tab) => {
      const containerState = tab.container.getState()
      let content = containerState.value;
      if (!content && Terra.f.hasLFS() && Terra.lfs.loaded) {
        content = await Terra.lfs.getFileContent(containerState.fileId);
      }

      return {
        name: tab.config.title,
        content,
      }
    })
  );
}

/**
 * Gather all editor tab components recursively from the layout.
 *
 * @param {GoldenLayout.ContentItem} [contentItem] - Starting contentItem where
 * the recursive search will start.
 * @returns {array} List of all the editor tabs.
 */
Terra.f.getAllEditorTabs = (contentItem = Terra.layout.root) => {
  if (contentItem.isComponent) {
    return contentItem;
  }

  let files = [];
  contentItem.contentItems.forEach((childContentItem) => {
    if (!childContentItem.isTerminal) {
      files = files.concat(Terra.f.getAllEditorTabs(childContentItem));
    }
  });

  return files;
}


/**
 * Close the active tab in the editor, except when it is an untitled tab.
 */
Terra.f.closeFile = () => {
  const currentTab = Terra.f.getActiveEditor();
  if (currentTab) {
    currentTab.parent.removeChild(currentTab);
  }
}

/**
 * Close all tabs in the editor.
 */
Terra.f.closeAllFiles = () => {
  const tabs = Terra.f.getAllEditorTabs();
  tabs.forEach((tab) => tab.parent.removeChild(tab));
}

/**
 * Open a file in the editor, otherwise switch to the tab of the filename.
 * Next, spawn a new worker based on the file extension.
 *
 * @param {string} id - The file id. Leave empty to create new file.
 * @param {string} filename - The name of the file to open.
 */
Terra.f.openFile = (id, filename) => {
  const tabs = Terra.f.getAllEditorTabs();
  const tab = tabs.filter((tab) =>
    id === null
      ? tab.config.title === filename
      : tab.container.getState().fileId === id
  )[0];


  if (tab) {
    // Switch to the active tab.
    tab.parent.setActiveContentItem(tab);
    tab.instance.editor.focus();
  } else {
    let removeFirstTab = false;

    // Check if the current tab is an untitled tab with no content. If so,
    // then remove it after we've inserted the new tab.
    if (tabs.length === 1 && tabs[0].config.title === 'Untitled' && tabs[0].instance.editor.getValue() === '') {
      removeFirstTab = true;
    }

    const currentTab = Terra.f.getActiveEditor();
    if (currentTab) {
      // Add a new tab next to the current active tab.
      currentTab.parent.addChild({
        type: 'component',
        componentName: 'editor',
        componentState: {
          fontSize: Terra.c.BASE_FONT_SIZE,
          fileId: id,
        },
        title: filename,
      });

      if (removeFirstTab) {
        Terra.f.getAllEditorTabs()[1].instance.fakeOnContainerOpenEvent = true;
        currentTab.parent.removeChild(tabs[0]);
      }
    }
  }

  const proglang = Terra.f.getFileExtension(filename);
  createLangWorkerApi(proglang);
}

Terra.f.createFolderOptionsHtml = (html = '', parentId = null, indent = '--') => {
  Terra.vfs.findFoldersWhere({ parentId }).forEach((folder, index) => {
    html += `<option value="${folder.id}">${indent} ${folder.name}</option>`;
    html += Terra.f.createFolderOptionsHtml('', folder.id, indent + '--');
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
Terra.f.saveFile = () => {
  const tab = Terra.f.getActiveEditor();

  if (!tab) return;

  // If the file exists in the vfs, then return, because the contents will be
  // auto-saved already in another part of the codebase.
  const existingFileId = tab.container.getState().fileId;
  if (existingFileId) {
    const file = Terra.vfs.findFileById(existingFileId);
    if (file) return;
  }

  const folderOptions = Terra.f.createFolderOptionsHtml();

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
    if (Terra.v.saveFileTippy) {
      Terra.v.saveFileTippy.destroy();
      Terra.v.saveFileTippy = null;
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
    if (!Terra.f.isValidFilename(filename)) {
      errorMsg = 'Name can\'t contain \\ / : * ? " < > |';
    } else if (Terra.vfs.existsWhere({ parentId: folderId, name: filename })) {
      errorMsg = `There already exists a "${filename}" file or folder`;
    }

    if (errorMsg) {
      if (Terra.f.isObject(Terra.v.saveFileTippy)) {
        Terra.v.saveFileTippy.destroy();
        Terra.v.saveFileTippy = null;
      }

      // Create new tooltip.
      Terra.v.saveFileTippy = tippy($modal.find('input').parent()[0], {
        content: errorMsg,
        animation: false,
        showOnCreate: true,
        placement: 'top',
        theme: 'error',
      });

      $modal.find('input').focus().select();

      return;
    }

    // Remove the tooltip if it exists.
    if (Terra.f.isObject(Terra.v.saveFileTippy)) {
      Terra.v.saveFileTippy.destroy();
      Terra.v.saveFileTippy = null;
    }

    // Create a new file in the VFS and then refresh the file tree.
    const { id: nodeId } = Terra.vfs.createFile({
      parentId: folderId,
      name: filename,
      content: tab.instance.editor.getValue(),
    });
    Terra.f.createFileTree();

    // Change the Untitled tab to the new filename.
    tab.container.setTitle(filename);

    // Update the container state.
    tab.container.setState({ fileId: nodeId });

    // For some reason no layout update is triggered, so we trigger an update.
    Terra.layout.emit('stateChanged');

    hideModal($modal);

    const proglang = Terra.f.getFileExtension(filename);

    // Set correct syntax highlighting.
    tab.instance.setProgLang(proglang)

    createLangWorkerApi(proglang);
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
Terra.f.runCode = async (fileId = null, clearTerm = false) => {
  if (clearTerm) term.reset();

  if (Terra.langWorkerApi) {
    if (!Terra.langWorkerApi.isReady) {
      // Worker API is busy, wait for it to be done.
      return;
    } else if (Terra.langWorkerApi.isRunningCode) {
      // Terminate worker in cases of infinite loops.
      return Terra.langWorkerApi.restart(true);
    }
  }

  $('#run-code').prop('disabled', true);

  let filename = null;
  let files = null;

  if (!fileId) {
    // Run the active editor tab.
    fileId = Terra.f.getActiveEditor().instance.container.getState().fileId;
  }

  // Run given file id.
  const file = Terra.vfs.findFileById(fileId);
  filename = file.name;
  files = [file];

  if (!file.content && Terra.f.hasLFS() && Terra.lfs.loaded) {
    const content = await Terra.lfs.getFileContent(file.id);
    files = [{ ...file, content }];
  }

  // Create a new worker instance if needed.
  const proglang = Terra.f.getFileExtension(filename);
  createLangWorkerApi(proglang);

  // Get file args (IDE only).
  let args = [];
  if (Terra.c.IS_IDE) {
    const filepath = Terra.vfs.getAbsoluteFilePath(fileId);
    const fileArgsPlugin = Terra.f.getPlugin('file-args').getState('fileargs');
    const fileArgs = fileArgsPlugin[filepath];

    const parseArgsRegex = /("[^"]*"|'[^']*'|\S+)/g;
    args = fileArgs.match(parseArgsRegex) || [];
  }

  // Wait for the worker to be ready before running the code.
  if (Terra.langWorkerApi && !Terra.langWorkerApi.isReady) {
    const runFileIntervalId = setInterval(() => {
      if (Terra.langWorkerApi && Terra.langWorkerApi.isReady) {
        Terra.langWorkerApi.runUserCode(filename, files, args);
        Terra.f.checkForStopCodeButton();
        clearInterval(runFileIntervalId);
      }
    }, 200);
  } else if (Terra.langWorkerApi) {
    // If the worker is ready, run the code immediately.
    Terra.langWorkerApi.runUserCode(filename, files, args);
    Terra.f.checkForStopCodeButton();
  }
}

/**
 * Change the run-code button to a stop-code button if after 1 second the code
 * has not finished running (potentially infinite loop scenario).
 */
Terra.f.checkForStopCodeButton = () => {
  Terra.v.showStopCodeButtonTimeoutId = setTimeout(() => {
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
Terra.f.runButtonCommand = async (selector, cmd) => {
  const $button = $(selector);
  if ($button.prop('disabled')) return;
  $button.prop('disabled', true);

  const activeTabName = Terra.f.getActiveEditor().config.title;
  const files = await Terra.f.getAllEditorFiles();

  if (Terra.langWorkerApi && Terra.langWorkerApi.isReady) {
    Terra.langWorkerApi.runButtonCommand(selector, activeTabName, cmd, files);
  }
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
Terra.f.getAceCompleters = () => {
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
