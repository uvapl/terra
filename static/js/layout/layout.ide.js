import Layout from './layout.js';
import { hasLFSApi } from '../helpers/shared.js';
import LFS from '../lfs.js';
import localStorageManager from '../local-storage-manager.js';
import fileTreeManager from '../file-tree-manager.js';
import { BASE_FONT_SIZE, LFS_MAX_FILE_SIZE } from '../constants.js';

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

  getClearTermButtonHtml() {
    return '<button id="clear-term" class="button clear-term-btn">Clear terminal</button>';
  }

  registerEditorCommands(editorComponent) {
    super.registerEditorCommands(editorComponent);

    editorComponent.addCommands([
      {
        name: 'closeFile',
        bindKey: 'Ctrl+W',
        exec: () => this.closeFile(),
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
    if (hasLFSApi() && LFS.loaded && ['paste', 'insertstring'].includes(event.command.name)) {
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
    $terminalContainer.find('.lm_header').append(runCodeButtonHtml);
    $terminalContainer.find('.lm_header > .lm_controls').prepend(clearTermButtonHtml)

    this.addButtonEventListeners();
  };

  onStateChanged() {
    let config = this.toConfig();

    // Exclude the content from all editors for the IDE when LFS is enabled,
    // because for LFS we use lazy loading, i.e. only load the content when
    // opening the file.
    if (hasLFSApi() && LFS.loaded) {
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
}
