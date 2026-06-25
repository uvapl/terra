import Layout from './layout.js';
import { BASE_FONT_SIZE, MAX_FILE_SIZE } from '../../constants.js';
import { createModal, hideModal, showModal } from '../components/modal.js';
import { createTooltip, destroyTooltip } from '../components/tooltip.js';

export default class IDELayout extends Layout {
  /**
   * Create the layout.
   *
   * @param {object} [options] - Controller-supplied options (theme,
   * restoredConfig, …) passed through to the base Layout.
   * @param {Array} [options.contentConfig=[]] The content configuration for the layout.
   */
  constructor(options = {}) {
    const { contentConfig = [] } = options;

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
              title: 'Terminal',
              componentState: { fontSize: BASE_FONT_SIZE },
              isClosable: false,
              reorderEnabled: true,
            }
          ]
        }
      ]
    };

    super(defaultLayoutConfig, options);
  }

  initCustomContent() {
    // No customizations here.
  };

  /**
   * Enable or disable the project-related items in the menubar.
   *
   * @param {object} state - The desired menu state.
   * @param {boolean} [state.openFolderEnabled] - Whether the "Open Folder"
   * menu item is enabled. Leave undefined to keep the current state.
   * @param {boolean} [state.closeProjectEnabled] - Whether the "Close Project"
   * menu item is enabled. Leave undefined to keep the current state.
   */
  setProjectMenuState({ openFolderEnabled, closeProjectEnabled } = {}) {
    if (typeof openFolderEnabled === 'boolean') {
      $('#menu-item--open-folder').toggleClass('disabled', !openFolderEnabled);
    }

    if (typeof closeProjectEnabled === 'boolean') {
      $('#menu-item--close-project').toggleClass('disabled', !closeProjectEnabled);
    }
  }

  /**
   * Keyboard shortcuts for editor tabs specific to the IDE.
   *
   * @param {*} editorComponent
   */
  registerEditorCommands(editorComponent) {
    super.registerEditorCommands(editorComponent);
    // 'save' (mod-s) and 'closeFile' (option-w) are now global commands in the
    // registry (commands/config.ide.js), so they fire from the terminal too and
    // are not registered as editor-scope Ace commands here.
    editorComponent.onCommandExec((event) => this._validateFileSizeLimit(event, editorComponent));
  }

  /**
   * Validates whether the file size exceeds the maximum size per keystroke.
   *
   * @param {Event} event - The event object.
   * @param {EditorTab} editorComponent - The editor component instance.
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

  /**
   * Creates the HTML for the folder options in the save file modal.
   *
   * @param {array<object>} folders - List of folder objects, each containing
   * an absolute `path` and a `depth` indicating how deeply it is nested.
   * @returns {string} The HTML string with the folder options.
   */
  _createFolderOptionsHtml(folders) {
    return folders.map(({ path, depth }) => {
      const indent = '--'.repeat(depth + 1);
      const folderName = path.split('/').pop();
      return `<option value="${path}">${indent} ${folderName}</option>`;
    }).join('');
  }

  /**
   * Prompt the user with a modal for a filename and in which folder to save it.
   *
   * @param {object} options - The save modal options.
   * @param {string} options.filename - The filename to prefill in the input.
   * @param {array<object>} options.folders - List of `{ path, depth }` folder
   * objects to choose from, in rendering order.
   * @param {function} options.onSave - Async callback that performs the actual
   * save. Called with `(filename, parentPath)` and should resolve to an error
   * message string when the save failed, or null on success.
   */
  showSaveFileModal({ filename, folders, onSave }) {
    const folderOptions = this._createFolderOptionsHtml(folders);

    const $modal = createModal({
      title: 'Save file',
      body: `
      <div class="form-grid">
        <div class="form-wrapper">
          <label>Enter a filename:</label>
          <div class="right-container">
            <input class="text-input" placeholder="Enter a filename" value="${filename}" maxlength="30" />
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
      const newFilename = $modal.find('.text-input').val();

      let parentPath = $modal.find('.select').val();
      if (parentPath === 'root') {
        parentPath = '';
      }

      const errorMsg = await onSave(newFilename, parentPath);

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

      hideModal($modal);
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
   * Close a tab by its file path, or the active tab when no path is given.
   *
   * @param {string} [filepath] - The absolute file path of the tab to close.
   */
  closeFile(filepath) {
    const component = filepath
      ? this.getTabComponents().find((component) => component.getPath() === filepath)
      : this.getActiveEditor();

    if (component) {
      component.close();
    }
  }

  /**
   * Close every open tab whose file lives under the given folder path,
   * including nested files in subfolders.
   *
   * @param {string} path - The absolute folderpath to close all files from.
   */
  closeFilesFromFolder(path) {
    this.getTabComponents().forEach((component) => {
      const subfilepath = component.getPath();
      if (subfilepath?.startsWith(path)) {
        this.closeFile(subfilepath);
      }
    });
  }

  /**
   * Snapshot all open tabs as a GoldenLayout content-config array, capturing
   * each tab's filename, component type, path and current content.
   *
   * @returns {Array<object>} The content configuration for the open tabs.
   */
  serializeTabs() {
    return this.getTabComponents().map((component) => ({
      title: component.getFilename(),
      componentName: component.getComponentName(),
      componentState: {
        path: component.getPath(),
        value: component.getContent(),
      },
    }));
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
