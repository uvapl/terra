import App from './app.js';
import { BASE_FONT_SIZE } from './constants.js';
import {
  getFileExtension,
  makeLocalStorageKey,
  parseQueryParams,
  removeIndent,
} from './helpers/shared.js';
import VFS from './vfs.js';
import Terra from './terra.js';
import LangWorkerAPI from './lang-worker-api.js';
import localStorageManager from './local-storage-manager.js';
import EmbedLayout from './layout/layout.embed.js';

export default class EmbedApp extends App {
  setupLayout() {
    const queryParams = parseQueryParams();
    if (typeof queryParams.filename !== 'string') {
      throw Error('No filename provided in query params');
    }

    const isHorizontal = queryParams.layout === 'horizontal';
    const isVertical = !isHorizontal;

    // Update local storage key.
    const currentStorageKey = makeLocalStorageKey(window.location.href);
    localStorageManager.updateLocalStoragePrefix(currentStorageKey);

    // Create the tab in the virtual filesystem.
    VFS.createFile({ name: queryParams.filename });

    // Create tabs with the filename as key and empty string as the content.
    const tabs = {}
    tabs[queryParams.filename] = '';

    // Get the programming language based on the filename.
    const proglang = getFileExtension(queryParams.filename);

    // Initialise the programming language specific worker API.
    Terra.langWorkerApi = new LangWorkerAPI(proglang);

    // Get the font-size stored in local storage or use fallback value.
    const fontSize = localStorageManager.getLocalStorageItem('font-size', BASE_FONT_SIZE);

    // Create the content objects that represent each tab in the editor.
    const content = this.generateConfigContent(tabs, fontSize);

    // Create the layout object.
    const layout = this.createLayout(content, fontSize, {
      proglang,
      vertical: isVertical,
    });

    $('body').addClass(isVertical ? 'vertical' : 'horizontal');

    // Make layout instance available at all times.
    this.layout = layout;

    return layout;
  }

  postSetupLayout() {
    // Listen for the content of the file to be received.
    window.addEventListener('message', (event) => {
      const editorComponent = this.layout.getActiveEditor();
      const { fileId } = editorComponent.getState();
      const content = removeIndent(event.data);
      if (content) {
        VFS.updateFile(fileId, { content });
        editorComponent.setContent(content);
      }
    });
  }

  /**
   * Create the layout object with the given content objects and font-size.
   *
   * @param {array} content - List of content objects.
   * @param {number} fontSize - The default font-size to be used.
   * @param {object} options - Additional options object.
   * @param {boolean} options.vertical - Whether the layout should be vertical.
   * @param {string} options.proglang - The programming language to be used
   * @returns {EmbedLayout} The layout instance.
   */
  createLayout(content, fontSize, options = {}) {
    return new EmbedLayout(content, fontSize, options);
  }
}
