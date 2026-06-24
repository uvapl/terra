import App from './app.js';
import {
  getFileExtension,
  slugify,
  parseQueryParams,
  removeIndent,
} from './lib/helpers.js';
import Terra from './terra.js';
import {
  getLocalStorageItem,
  updateLocalStoragePrefix
} from './lib/local-storage-manager.js';
import EmbedController from './controllers/embed.js';

export default class EmbedApp extends App {
  /**
   * The content passed from the iframe.
   * @type {string|null}
   */
  frameContent = null;

  async setupLayout() {
    // Listen for the content of the file to be received.
    window.addEventListener('message', async (event) => {
      this.frameContent = removeIndent(event.data);
    });

    // Files for a specific embed are hosted in a subdirectory of the VFS.
    const slug = slugify(window.location.href);
    await this.vfs.setBaseFolder(`embed-${slug}`);

    const queryParams = parseQueryParams();
    if (typeof queryParams.filename !== 'string') {
      throw Error('No filename provided in query params');
    }

    const isHorizontal = queryParams.layout === 'horizontal';
    const isVertical = !isHorizontal;

    // Update local storage key.
    const currentStorageKey = slugify(window.location.href);
    updateLocalStoragePrefix(currentStorageKey);

    // Since embed's are temporary session, clear the VFS before making a new
    // temporary file.
    await this.vfs.clear();

    // Create the tab in the virtual filesystem.
    await this.vfs.createFile(queryParams.filename, this.frameContent);

    // Create tabs with the filename as key and empty string as the content.
    const tabs = {}
    tabs[queryParams.filename] = '';

    // Get the programming language based on the filename.
    const proglang = getFileExtension(queryParams.filename);

    // The embed controller reads persisted state and builds the embed layout.
    this.view = new EmbedController({
      delegate: this,
      commandRegistry: this.commands,
      tabs,
      proglang,
      vertical: isVertical,
    });

    $('body').addClass(isVertical ? 'vertical' : 'horizontal');
  }

  /**
   * Nothing to do in the post setup.
   */
  afterSetupLayout() { }
}
