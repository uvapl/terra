import Layout from './layout.js';
import localStorageManager from '../local-storage-manager.js';
import fileTreeManager from '../file-tree-manager.js';
import { isValidFilename, isObject, getFileExtension } from '../helpers/shared.js';
import { isImageExtension } from '../helpers/image.js';
import { BASE_FONT_SIZE, LFS_MAX_FILE_SIZE } from '../constants.js';
import { createModal, hideModal, showModal } from '../modal.js';
import Terra from '../terra.js';

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
        path: 'Untitled',
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
                    path: 'Untitled',
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
   * Validates whether the file size exceeds the maximum file size limit when
   * the LFS is enabled.
   *
   * @param {Event} event - The event object.
   * @param {EditorComponent} editorComponent - The editor component instance.
   */
  _validateFileSizeLimit(event, editorComponent) {
    // Verify whether the user exceeded the maximum file size when either
    // pasting from the clipboard or inserting text (i.e. on each keystroke).
    if (Terra.app.hasLFSProjectLoaded && ['paste', 'insertstring'].includes(event.command.name)) {
      const inputText = event.args.text || '';
      const filesize = new Blob([editorComponent.getContent() + inputText]).size;
      if (filesize >= LFS_MAX_FILE_SIZE) {
        // Prevent the event from happening.
        event.preventDefault();

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
   * @param {string} [html] - The HTML string to append to.
   * @param {string} [parentId] - The parent folder ID where subfolders will be fetched from.
   * @param {string} [indent] - The visual indent indicator.
   * @returns {string} The HTML string with the folder options.
   */
  createFolderOptionsHtml(html = '', parentId = null, indent = '--') {
    Terra.app.vfs.findFoldersWhere({ parentId }).forEach((folder, index) => {
      html += `<option value="${folder.id}">${indent} ${folder.name}</option>`;
      html += this.createFolderOptionsHtml('', folder.id, indent + '--');
    });

    return html;
  }

  /**
   * Prompt the user with a modal for a filename and in which folder to save it.
   * This function gets triggered on each 'save' keystroke, i.e. <cmd/ctrl + s>.
   *
   * @param {EditorComponent} editorComponent - The editor component instance.
   */
  promptSaveFile(editorComponent) {
    const folderOptions = this.createFolderOptionsHtml();

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
      } else if (Terra.app.vfs.existsWhere({ parentId: folderId, name: filename })) {
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
      const { id: nodeId } = Terra.app.vfs.createFile({
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
      this.emit('stateChanged');

      hideModal($modal);

      const proglang = getFileExtension(filename);

      // Set correct syntax highlighting.
      editorComponent.setProgLang(proglang)

      Terra.app.createLangWorker(proglang);
    });
  }

  /**
   * Open a file in the editor, or switch to the tab if it's already open.
   *
   * @param {string} filepath - The path of the file to open.
   */
  addFileTab(filepath) {
    let tabComponents = this.getTabComponents();

    // Try to find the tab component with the given filepath.
    const tabComponent = tabComponents.find(
      (component) => component.getPath() === filepath
    );

    if (tabComponent) {
      // Switch to the active tab that is already open.
      tabComponent.setActive();
    } else {
      let removeFirstTab = false;

      // Check if first tab is an Untitled tab with no content.
      // If so, then remove it after we've inserted the new tab.
      if (tabComponents.length === 1 && tabComponents[0].getFilename() === 'Untitled') {
        if (tabComponents[0].getContent() === '') {
          removeFirstTab = true;
        } else {
          tabComponents[0].clearContent();
          return;
        }
      }

      const activeEditorComponent = this.getActiveEditor();
      if (activeEditorComponent) {
        const filename = filepath.split('/').pop();

        // Add a new tab next to the current active tab.
        activeEditorComponent.addSiblingTab({
          title: filename,
          componentState: { path: filepath },
          componentName: isImageExtension(filename) ? 'image' : 'editor',
        });

        tabComponents = this.getTabComponents();

        if (removeFirstTab) {
          tabComponents[0].fakeOnContainerOpenEvent = true;
          tabComponents[0].fakeOnEditorFocusEvent = true;
          tabComponents[1].fakeOnContainerOpenEvent = true;
          tabComponents[1].fakeOnEditorFocusEvent = true;

          // Close Untitled tab.
          tabComponents[0].close();
        }
      }
    }
  }

}
