import App from './app.js';
import IDELayout from './layout/layout.ide.js';
import { BASE_FONT_SIZE } from './constants.js';
import {
  getActiveEditor,
  getAllEditorTabs
} from './helpers/editor-component.js';
import {
  getFileExtension,
  hasLFSApi,
  seconds,
} from './helpers/shared.js';
import VFS from './vfs.js';
import Terra from './terra.js';
import { hasWorker } from './lang-worker-api.js';
import localStorageManager from './local-storage-manager.js';
import fileTreeManager from './file-tree-manager.js';

export default class IDEApp extends App {
  setupLayout = () => {
    this.layout = this.createLayout();
  }

  postSetupLayout = () => {
    // Fetch the repo files or the local storage files (vfs) otherwise.
    const repoLink = localStorageManager.getLocalStorageItem('git-repo');
    if (repoLink) {
      VFS.createGitFSWorker();
    } else {
      fileTreeManager.createFileTree();
    }

    if (!hasLFSApi()) {
      // Disable open-folder if the FileSystemAPI is not supported.
      $('#menu-item--open-folder').remove();
    }

    if (!repoLink && !hasLFSApi()) {
      fileTreeManager.showLocalStorageWarning();
    }

    $(window).resize();
  }

  /**
   * Reset the layout to its initial state.
   */
  resetLayout = () => {
    const oldContentConfig = getAllEditorTabs().map((tab) => ({
      title: tab.config.title,
      componentState: {
        fileId: tab.container.getState().fileId,
      }
    }));

    this.layout.destroy();
    this.layout = this.createLayout(true, oldContentConfig);
    this.layout.on('initialised', () => {
      setTimeout(() => {
        const currentTab = getActiveEditor();
        const proglang = getFileExtension(currentTab.config.title);
        if (hasWorker(proglang) && Terra.langWorkerApi) {
          Terra.langWorkerApi.restart();
        }
      }, 10);
    });
    this.layout.init();
  }

  onEditorStartEditing = () => {
    Terra.v.blockLFSPolling = true;
  }

  onEditorStopEditing = () => {
    Terra.v.blockLFSPolling = false;
  }

  /**
   * Create the layout object with the given content objects and font-size.
   *
   * @param {boolean} [forceDefaultLayout=false] Whether to force the default layout.
   * @param {Array} [contentConfig=[]] The content configuration for the layout.
   * @returns {Layout} The layout instance.
   */
  createLayout = (forceDefaultLayout = false, contentConfig = []) => {
    const defaultContentConfig = contentConfig.map((tab) => ({
      type: 'component',
      componentName: 'editor',
      componentState: {
        fontSize: BASE_FONT_SIZE,
        ...tab.componentState,
      },
      title: 'Untitled',
      ...tab,
    }))

    const defaultLayoutConfig = {
      settings: {
        showCloseIcon: false,
        showPopoutIcon: false,
        showMaximiseIcon: true,
        reorderEnabled: true,
      },
      dimensions: {
        headerHeight: 30,
        borderWidth: 10,
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

    return new IDELayout(defaultLayoutConfig, { forceDefaultLayout });
  }

}
