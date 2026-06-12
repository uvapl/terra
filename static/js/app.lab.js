import App from './app.js';
import { BASE_FONT_SIZE } from './constants.js';
import {
  getLabUrlParam,
  fetchConfig,
  isValidConfig,
  labSlug,
  selectConfigStorage,
  saveConfig,
  loadStoredConfig,
} from './app.lab.config.js';
import { getFileExtension } from './helpers/shared.js';
import LabLayout from './layout/layout.lab.js';
import { loadReadme } from './app.lab.readme.js';
import { getLocalStorageItem } from './local-storage-manager.js';

export default class LabApp extends App {
  /**
   * Reference to the lab layout instance.
   * @type {LabLayout}
   */
  layout = null;

  /**
   * Contains a reference to the lab config.
   * @type {object}
   */
  config = null;

  async init() {
    let isNewLab;
    try {
      isNewLab = await this.loadConfig();
    } catch (err) {
      console.error('Failed to load lab config:', err);
      this.showLandingForm(err.message);
      return;
    }

    if (!this.config) {
      // First visit without a lab URL: let the user paste one.
      this.showLandingForm();
      return;
    }

    this.isNewLab = isNewLab;

    // Changing the hash (pasting another lab URL in the address bar) does
    // not reload the page by itself, so do it ourselves to switch labs.
    $(window).on('hashchange', () => window.location.reload());

    await super.init();
  }

  async setupLayout() {
    const config = this.config;

    // Files for a specific lab are hosted in a subdirectory of the VFS.
    await this.vfs.setBaseFolder(labSlug(config));

    // Download lab files that are not in the VFS yet. Files the student
    // already has (and may have edited) are never overwritten, which is what
    // makes labs persistent across visits.
    await Promise.all(
      config.files.map(async (filename) => {
        if (await this.vfs.pathExists(filename)) return;

        let content = '';
        try {
          const response = await fetch(config.baseUrl + filename);
          // Files listed in the config but absent from the repo are created
          // empty, per the lab50 spec.
          if (response.ok) {
            content = await response.text();
          }
        } catch (err) {
          console.error(`Failed to download lab file ${filename}:`, err);
        }

        await this.vfs.createFile(filename, content);
      })
    );

    // Get the programming language based on the first filename.
    const proglang = getFileExtension(config.files[0]);

    // Get the font-size stored in local storage or use fallback value.
    const fontSize = getLocalStorageItem('font-size', BASE_FONT_SIZE);

    // Create the content objects that represent each tab in the editor. The
    // file contents are not embedded: each editor loads them from the VFS
    // when it is shown.
    const content = config.files.map((filename) => ({
      type: 'component',
      componentName: 'editor',
      componentState: {
        fontSize,
        path: filename,
      },
      title: filename,
      isClosable: false,
    }));

    // A lab without files (e.g. the minimal `lab50: true` form) still needs
    // at least one tab in the editor stack.
    if (content.length === 0) {
      content.push({
        type: 'component',
        componentName: 'editor',
        componentState: { fontSize },
        title: 'Untitled',
        isClosable: false,
      });
    }

    this.layout = new LabLayout(content, fontSize, {
      proglang,
      forceDefaultLayout: this.isNewLab,
    });
  }

  postSetupLayout() {
    this.layout.setPageTitle(this.config);

    loadReadme(this.config, $('#readme'));
  }

  /**
   * Load the lab configuration from the URL query param, or fall back to the
   * most recently used lab in local storage.
   *
   * Sets `this.config` on success; leaves it null when there is no lab URL
   * and no stored lab.
   *
   * @async
   * @returns {Promise<boolean>} Whether this lab is opened for the first time.
   */
  async loadConfig() {
    const labUrl = getLabUrlParam();

    if (!labUrl) {
      const config = loadStoredConfig();
      if (config && isValidConfig(config)) {
        this.config = config;
      }
      return false;
    }

    const config = await fetchConfig(labUrl);
    if (!isValidConfig(config)) {
      throw new Error('Invalid lab configuration');
    }

    selectConfigStorage(config);

    // The lab is new when nothing has been stored under its slug before.
    const isNewLab = !getLocalStorageItem('config');
    saveConfig(config);

    // Remove query params from the URL, but keep the hash: a hash-form lab
    // URL stays in the address bar so the link remains shareable.
    history.replaceState({}, null,
      window.location.origin + window.location.pathname + window.location.hash);

    this.config = config;
    return isNewLab;
  }

  /**
   * Show the form where the user can paste a GitHub lab URL, used when the
   * app is opened without (a valid) lab URL and no stored lab exists.
   *
   * @param {string} [errorMessage] - Error to display inside the form.
   */
  showLandingForm(errorMessage) {
    const $container = $('.lab-landing-form');
    $container.removeClass('hidden');

    if (errorMessage) {
      $container.find('.form-error').removeClass('hidden').text(errorMessage);
    }

    $container.find('#lab-url-form').on('submit', (event) => {
      event.preventDefault();
      const url = $container.find('#lab-url-input').val().trim();
      if (url) {
        // Setting the hash alone does not reload the page; the hashchange
        // handler is not registered when the landing form is shown.
        window.location.hash = url;
        window.location.reload();
      }
    });
  }
}
