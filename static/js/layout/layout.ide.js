import Layout from './layout.js';
import localStorageManager from '../local-storage-manager.js';
import fileTreeManager from '../file-tree-manager.js';
import {
  isValidFilename,
  getFileExtension,
  isImageExtension
} from '../helpers/shared.js';
import { BASE_FONT_SIZE, MAX_FILE_SIZE } from '../constants.js';
import { createModal, hideModal, showModal } from '../modal.js';
import Terra from '../terra.js';
import { createTooltip, destroyTooltip } from '../tooltip-manager.js';

export default class IDELayout extends Layout {
  /**
   * Create the layout.
   *
   * @param {boolean} [forceDefaultLayout=false] Whether to force the default layout.
   * @param {Array} [contentConfig=[]] The content configuration for the layout.
   */
  constructor(forceDefaultLayout = false, contentConfig = []) {
    const defaultContentConfig = contentConfig.map((tab) => ({
      type: 'component',
      componentName: 'editor',
      reorderEnabled: true,
      componentState: {
        fontSize: BASE_FONT_SIZE,
        ...tab.componentState,
      },
      title: 'Untitled',
      ...tab,
    }))

    const defaultLayoutConfig = {
      settings: {
        reorderEnabled: true,
      },
      content: [
        {
          type: 'column',
          content: [
            {
              type: 'stack',
              content: defaultContentConfig.length > 0 ? defaultContentConfig : [
                {
                  type: 'component',
                  componentName: 'editor',
                  componentState: {
                    fontSize: BASE_FONT_SIZE,
                  },
                  title: 'Untitled',
                },
              ],
            },
            {
              type: 'component',
              componentName: 'terminal',
              componentState: { fontSize: BASE_FONT_SIZE },
              isClosable: false,
              reorderEnabled: false,
            }
          ]
        }
      ]
    };

    super(defaultLayoutConfig, { forceDefaultLayout });
  }

  registerEditorCommands(editorComponent) {
    super.registerEditorCommands(editorComponent);

    editorComponent.addCommands([
      {
        name: 'save',
        bindKey: { win: 'Ctrl+S', mac: 'Command+S' },
        exec: () => {
          Terra.app.saveFile();
        }
      },
      {
        name: 'closeFile',
        bindKey: 'Ctrl+W',
        exec: () => Terra.app.closeFile(),
        readOnly: true,
      },
      {
        name: 'createNewFileTreeFile',
        bindKey: 'Ctrl+T',
        exec: () => fileTreeManager.createFile(),
      },
      {
        name: 'createNewFileTreeFolder',
        bindKey: 'Ctrl+Shift+T',
        exec: () => fileTreeManager.createFolder(),
      },
    ]);

    editorComponent.onCommandExec((event) => this._validateFileSizeLimit(event, editorComponent));
  }

  /**
   * Validates whether the file size exceeds the maximum size per keystroke.
   *
   * @param {Event} event - The event object.
   * @param {EditorComponent} editorComponent - The editor component instance.
   */
  _validateFileSizeLimit(event, editorComponent) {
    // Verify whether the user exceeded the maximum file size when either
    // pasting from the clipboard or inserting text (i.e. on each keystroke).
    if (['paste', 'insertstring'].includes(event.command.name)) {
      const inputText = event.args.text || '';
      const filesize = new Blob([editorComponent.getContent() + inputText]).size;
      if (filesize >= MAX_FILE_SIZE) {
        // Prevent the event from happening.
        event.preventDefault();

        const $modal = createModal({
          title: 'Maximum file size reached',
          body: 'This file reached the maximum file size of 1MB.',
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
  }

  renderButtons() {
    const runCodeButtonHtml = this.getRunCodeButtonHtml();
    const clearTermButtonHtml = this.getClearTermButtonHtml();

    // Add run-code and clear-term to the DOM.
    const $terminalContainer = $('.terminal-component-container');
    $terminalContainer.find('.lm_header')
      .append(clearTermButtonHtml)
      .append(runCodeButtonHtml);

    this.addButtonEventListeners();
    this.addActiveStates();
  };

  onStateChanged() {
    let config = this.toConfig();

    // Exclude the content from all editors for the IDE when LFS is enabled,
    // because for LFS we use lazy loading, i.e. only load the content when
    // opening the file.
    if (Terra.app.hasLFSProjectLoaded) {
      config = this._removeEditorValue(config);
    }

    const state = JSON.stringify(config);
    localStorageManager.setLocalStorageItem('layout', state);
  }

  _removeEditorValue(config) {
    if (config.content) {
      config.content.forEach((item) => {
        if (item.type === 'component') {
          item.componentState.value = '';
        } else {
          this._removeEditorValue(item);
        }
      });
    }
    return config;
  }

  /**
   * Creates the HTML recursively for the folder options in the save file modal.
   *
   * @async
   * @param {string} [parentPath] - The absolute parent folder path where
   * subfolders will be fetched from.
   * @param {string} [html] - The HTML string to append to.
   * @param {string} [indent] - The visual indent indicator.
   * @returns {Promise<string>} The HTML string with the folder options.
   */
  async createFolderOptionsHtml(parentPath = '', html = '', indent = '--') {
    const subfolders = await Terra.app.vfs.listFoldersInFolder(parentPath);

    for (const folderName of subfolders) {
      const subfolderpath = parentPath ? `${parentPath}/${folderName}` : folderName;
      html += `<option value="${subfolderpath}">${indent} ${folderName}</option>`;
      html += await this.createFolderOptionsHtml(subfolderpath, '', indent + '--');
    }

    return html;
  }

  /**
   * Prompt the user with a modal for a filename and in which folder to save it.
   * This function gets triggered on each 'save' keystroke, i.e. <cmd/ctrl + s>.
   *
   * @async
   * @param {EditorComponent} editorComponent - The editor component instance.
   */
  async promptSaveFile(editorComponent) {
    const folderOptions = await this.createFolderOptionsHtml();

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
      destroyTooltip('saveFile');
      hideModal($modal);
    });

    $modal.find('.primary-btn').click(async () => {
      const filename = $modal.find('.text-input').val();

      let parentPath = $modal.find('.select').val();
      if (parentPath === 'root') {
        parentPath = '';
      }

      const filepath = parentPath ? `${parentPath}/${filename}` : filename;

      let errorMsg;
      if (!isValidFilename(filename)) {
        errorMsg = 'Name can\'t contain \\ / : * ? " < > |';
      } else if ((await Terra.app.vfs.pathExists(filepath))) {
        errorMsg = `There already exists a "${filename}" file or folder`;
      }

      if (errorMsg) {
        const anchor = $modal.find('input').parent()[0];
        createTooltip('saveFile', anchor, errorMsg, {
          placement: 'top',
          theme: 'error',
        });
        $modal.find('input').focus().select();
        return;
      }

      // Remove the tooltip if it exists.
      destroyTooltip('saveFile');

      // Create a new file in the VFS and then refresh the file tree.
      await Terra.app.vfs.createFile(
        filepath,
        editorComponent.getContent(),
      );
      await fileTreeManager.createFileTree();

      // Change the Untitled tab to the new filename.
      editorComponent.setPath(filepath);

      // Update the container state.
      editorComponent.extendState({ path: filepath });

      // For some reason no layout update is triggered, so we trigger an update.
      this.emit('stateChanged');

      hideModal($modal);

      const proglang = getFileExtension(filename);

      // Set correct syntax highlighting.
      editorComponent.setProgLang(proglang)

      Terra.app.createLangWorker(proglang);
    });
  }

  /**
   * Checks if an Untitled tab is the only one open in the editor,
   * and that no content has been added to it (and thus unsaved).
   *
   * @returns {boolean}
   */
  onlyHasEmptyUntitled() {
    let tabComponents = this.getTabComponents();
    return (
      tabComponents.length === 1 &&
      tabComponents[0].getFilename() === 'Untitled' &&
      !tabComponents[0].getPath() &&
      tabComponents[0].getContent() === ''
    );
  }

  /**
   * Open a file in the editor, or switch to the tab if it's already open.
   *
   * N.B. This function assumes that another editor tab is already present.
   *
   * @param {string} filepath - The path of the file to open.
   */
  addFileTab(filepath) {
    let tabComponents = this.getTabComponents();

    // Switch to the selected file if that is already open.
    const tabComponent = tabComponents.find(
      (component) => component.getPath() === filepath
    );
    if (tabComponent) {
      tabComponent.setActive();
      return;
    }

    // An empty Untitled tab will be removed before adding the new tab.
    if (this.onlyHasEmptyUntitled()) {
      this.resetLayout = true;
      tabComponents[0].close();
      this.resetLayout = false;
    }

    // Add new tab.
    const filename = filepath.split('/').pop();
    this.editorStack.addChild(
      this._createEditorTab({
        title: filename,
        componentState: { path: filepath },
        componentName: isImageExtension(filename) ? 'image' : 'editor',
      })
    );
  }

  closeAllTabs() {
    const stack = this.editorStack;
    const originalSetActive = stack.setActiveContentItem;
    const tabs = [...stack.contentItems];

    // Temporarily disable activation of next tab by switching off a function.
    stack.setActiveContentItem = () => {};

    for (let i = 0; i < tabs.length; i++) {
      // If this is the last tab, restore the original activation logic,
      // so it will be nicely replaced by an active Untitled tab.
      if (i === tabs.length - 1) {
        stack.setActiveContentItem = originalSetActive;
      }
      tabs[i].remove();
    }
  }
}
