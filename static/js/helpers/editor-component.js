import {
  getFileExtension,
  hasLFSApi,
  isObject,
  isValidFilename
} from './shared.js';
import { createModal, hideModal, showModal } from '../modal.js';
import VFS from '../vfs.js';
import LFS from '../lfs.js';
import { createLangWorkerApi } from '../lang-worker-api.js';
import Terra from '../terra.js';
import fileTreeManager from '../file-tree-manager.js';

/**
 * Gathers all files from the editor and returns them as an array of objects.
 *
 * @returns {Promise<array>} List of objects, each containing the filename and
 * content of the corresponding editor tab.
 */
export function getAllEditorFiles() {
  return Promise.all(
    Terra.app.layout.getEditorComponents().map(async (editorComponent) => {
      const containerState = editorComponent.getState()
      let content = editorComponent.getContent();
      if (!content && hasLFSApi() && LFS.loaded) {
        content = await LFS.getFileContent(containerState.fileId);
      }

      return {
        name: editorComponent.getFilename(),
        content,
      }
    })
  );
}

/**
 * Close the active tab in the editor.
 */
export function closeFile() {
  const editorComponent = Terra.app.layout.getActiveEditor();
  if (editorComponent) {
    editorComponent.close();
  }
}

/**
 * Close all tabs in the editor.
 */
export function closeAllFiles() {
  Terra.app.layout.getEditorComponents().forEach((editorComponent) => {
    editorComponent.close();
  });
}

/**
 * Open a file in the editor, otherwise switch to the tab of the filename.
 * Next, spawn a new worker based on the file extension.
 *
 * @param {string} id - The file id. Leave empty to create new file.
 * @param {string} filename - The name of the file to open.
 */
export function openFile(id, filename) {
  let editorComponents = Terra.app.layout.getEditorComponents();

  // Try to find the editor component with the given filename or id.
  const editorComponent = editorComponents.find(
    (editorComponent) => id === null
      ? editorComponent.getFilename() === filename
      : editorComponent.getState().fileId === id
  );

  if (editorComponent) {
    // Switch to the active tab that is already open.
    editorComponent.setActive();
  } else {
    let removeFirstTab = false;

    // Check if first tab is an Untitled tab with no content. If so, then remove
    // it after we've inserted the new tab.
    if (editorComponents.length === 1 && editorComponents[0].getFilename() === 'Untitled') {
      if (editorComponents[0].getContent() === '') {
        removeFirstTab = true;
      } else {
        editorComponents[0].clearContent();
        return;
      }
    }

    const activeEditorComponent = Terra.app.layout.getActiveEditor();
    if (activeEditorComponent) {
      // Add a new tab next to the current active tab.
      activeEditorComponent.addSiblingTab({
        title: filename,
        componentState: {
          fileId: id,
        },
      });

      editorComponents = Terra.app.layout.getEditorComponents();

      if (removeFirstTab) {
        editorComponents[0].fakeOnContainerOpenEvent = true;
        editorComponents[0].fakeOnEditorFocusEvent = true;
        editorComponents[1].fakeOnContainerOpenEvent = true;
        editorComponents[1].fakeOnEditorFocusEvent = true;

        // Close Untitled tab.
        editorComponents[0].close();
      }
    }
  }

  const proglang = getFileExtension(filename);
  createLangWorkerApi(proglang);
}

export function createFolderOptionsHtml(html = '', parentId = null, indent = '--') {
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
export function saveFile() {
  const editorComponent = Terra.app.layout.getActiveEditor();

  if (!editorComponent) return;

  // If the file exists in the vfs, then return, because the contents will be
  // auto-saved already in another part of the codebase.
  const existingFileId = editorComponent.getState().fileId;
  if (existingFileId) {
    const file = VFS.findFileById(existingFileId);
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
          <input class="text-input" placeholder="Enter a filename" value="${editorComponent.getFilename()}" maxlength="30" />
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
    if (!isValidFilename(filename)) {
      errorMsg = 'Name can\'t contain \\ / : * ? " < > |';
    } else if (VFS.existsWhere({ parentId: folderId, name: filename })) {
      errorMsg = `There already exists a "${filename}" file or folder`;
    }

    if (errorMsg) {
      if (isObject(Terra.v.saveFileTippy)) {
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
    if (isObject(Terra.v.saveFileTippy)) {
      Terra.v.saveFileTippy.destroy();
      Terra.v.saveFileTippy = null;
    }

    // Create a new file in the VFS and then refresh the file tree.
    const { id: nodeId } = VFS.createFile({
      parentId: folderId,
      name: filename,
      content: editorComponent.getContent(),
    });
    fileTreeManager.createFileTree();

    // Change the Untitled tab to the new filename.
    editorComponent.setFilename(filename);

    // Update the container state.
    editorComponent.extendState({ fileId: nodeId });

    // For some reason no layout update is triggered, so we trigger an update.
    Terra.app.layout.emit('stateChanged');

    hideModal($modal);

    const proglang = getFileExtension(filename);

    // Set correct syntax highlighting.
    editorComponent.setProgLang(proglang)

    createLangWorkerApi(proglang);
  });
}

/**
 * Change the run-code button to a stop-code button if after 1 second the code
 * has not finished running (potentially infinite loop scenario).
 */
export function checkForStopCodeButton() {
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
export async function runButtonCommand(selector, cmd) {
  const $button = $(selector);
  if ($button.prop('disabled')) return;
  $button.prop('disabled', true);

  const activeTabName = Terra.app.layout.getActiveEditor().getFilename();
  const files = await getAllEditorFiles();

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
export function getAceCompleters() {
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
