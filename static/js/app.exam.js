import App from './app.js';
import {
  BASE_FONT_SIZE,
  AUTOSAVE_INTERVAL,
  AUTOSAVE_START_OFFSET,
} from './constants.js';
import {
  formatDate,
  getFileExtension,
  getRandNumBetween,
  isObject,
  isValidUrl,
  slugify,
  makeUrl,
  objectHasKeys,
  parseQueryParams,
  seconds,
} from './helpers/shared.js';
import LangWorker from './lang-worker.js';
import ExamLayout from './layout/layout.exam.js';
import {
  isDefaultLocalStoragePrefix,
  setLocalStorageItem,
  getLocalStorageItem,
  removeLocalStorageItem,
  updateLocalStoragePrefix
} from './local-storage-manager.js';
import { notify, notifyError } from './notifications.js';

export default class ExamApp extends App {
  /**
   * Reference to the exam layout instance.
   * @type {ExamLayout}
   */
  layout = null;

  /**
   * Contains a reference to the exam config.
   * @type {object}
   */
  config = null;

  /**
   * Whether the user has made any changes in any editor.
   * @type {boolean}
   */
  editorContentChanged = false;

  onEditorStartEditing(editorComponent) {
    this.editorContentChanged = true;
  }

  setupLayout() {
    return new Promise((resolve, reject) => {
      this.loadConfig().then(async (isNewExam) => {
        // Files for a specific exam are hosted in a subdirectory of the VFS.
        const slug = slugify(this.config.configUrl);
        await this.vfs.setBaseFolder(`exam-${slug}`);

        if (!this.config.tabs) {
          this.config.tabs = {};
        }

        // Get the programming language based on tabs filename.
        const proglang = getFileExtension(Object.keys(this.config.tabs)[0]);

        // Initialise the programming language specific worker API.
        this.langWorker = new LangWorker(proglang);

        // Get the font-size stored in local storage or use fallback value.
        const fontSize = getLocalStorageItem('font-size', BASE_FONT_SIZE);

        // Create the content objects that represent each tab in the editor.
        const content = this.generateConfigContent(this.config.tabs, fontSize);

        if (isNewExam) {
          await this.vfs.clear();

          // Create the files inside the VFS.
          await Promise.all(
            content.map((file) => this.vfs.createFile(
              file.title,
              file.componentState.value,
            ))
          )
        }

        // Create the layout object.
        const layout = new ExamLayout(content, fontSize, {
          proglang,
          hiddenFiles: this.config.hidden_tabs,
          buttonConfig: this.config.buttons,
          autocomplete: this.config.autocomplete,
          forceDefaultLayout: isNewExam,
        });

        // Make layout instance available at all times.
        this.layout = layout;

        resolve();
      })
      .catch((err) => {
        // Remove the right navbar when the application failed to initialise.
        ExamLayout.removeNavbar();
      });
    });
  }

  postSetupLayout() {
    this.editorContentChanged = false;

    this.layout.setPageTitle(this.config.course_name, this.config.exam_name);

    // Register the auto-save after a certain auto-save offset time to prevent
    // the server receives many requests at once. This helps to spread them out
    // over a minute of time.
    const forceAutoSave = getLocalStorageItem('editor-content-changed', false);
    const startTimeout = getRandNumBetween(0, AUTOSAVE_START_OFFSET);
    setTimeout(() => {
      this.registerAutoSave(this.config.postback, this.config.code, forceAutoSave);
    }, startTimeout);

    // Make the right navbar visible and add the click event listener to the
    // submit button.
    this.layout.showNavbar(this.onSubmitButtonClicked);

    // Immediately lock everything if this exam is locked.
    if (this.config.locked === true) {
      this.lock();
    }

    // Catch ctrl/cmd+w (aka page reloading) to prevent the user from closing the tab.
    $(window).on('beforeunload', (e) => {
      if (this.editorContentChanged) {
        setLocalStorageItem('editor-content-changed', true);
      }

      const message = 'Are you sure you want to leave this page?';
      e.preventDefault();
      e.returnValue = message;
      return message;
    });
  }

  /**
   * Load the exam configuration from query params. However,
   * if there are no query params, the app can also boot from
   * a recent configuration in localStorage.
   *
   * @returns {Promise<object|string>} The configuration for the app once
   * resolved, or an error when rejected.
   */
  loadConfig() {
    return new Promise(async (resolve, reject) => {
      let isNewExam = false;
      let config;

      // First, check if there are query params given. If so, validate them.
      // Next, get the config data and when fetched succesfully, save it into
      // local storage and remove the query params from the URL.
      const queryParams = parseQueryParams();
      if (this.validateQueryParams(queryParams)) {
        try {
          isNewExam = true;

          config = await this.getConfig(makeUrl(queryParams.url, { code: queryParams.code }));
          config.code = queryParams.code;
          config.configUrl = queryParams.url;

          const currentStorageKey = slugify(config.configUrl);
          setLocalStorageItem('last-used', currentStorageKey);
          updateLocalStoragePrefix(currentStorageKey);
          setLocalStorageItem('config', JSON.stringify(config));

          // Remove query params from the URL.
          history.replaceState({}, null, window.location.origin + window.location.pathname);

          notify('Connected to server', { fadeOutAfterMs: seconds(10) });
        } catch (err) {
          console.error('Failed to fetch config:', err);
          notifyError('Could not connect to server');
          return;
        }
      } else {
        console.log('Trying to loading previous exam config from localStorage...')

        // This should only update the local storage prefix if it's
        // not the default prefix.
        if (isDefaultLocalStoragePrefix()) {
          const currentStorageKey = getLocalStorageItem('last-used');

          if (currentStorageKey) {
            updateLocalStoragePrefix(currentStorageKey);
          }
        }

        const localConfig = JSON.parse(getLocalStorageItem('config'));

        // On a first visit (or after clearing storage) there is no stored
        // config, so there is nothing to fall back on.
        if (!localConfig) {
          notifyError('No configuration present.');
          reject('No configuration present');
          return;
        }

        // Check immediately if the server is reachable by retrieving the
        // config again. If it is reachable, use the localConfig as the actual
        // config, otherwise notify the user that we failed to connect.
        try {
          const newConfig = await this.getConfig(makeUrl(localConfig.configUrl, { code: localConfig.code }))

          // While we fallback on localstorage, we still need to check whether
          // the exam is locked, so we have to update the `locked` property.
          localConfig.locked = newConfig.locked;
          setLocalStorageItem('config', JSON.stringify(localConfig));

          config = localConfig;
          notify('Connected to server', { fadeOutAfterMs: seconds(10) });
        } catch (err) {
          console.error('Failed to connect to server:');
          console.error(err);
          notifyError('Failed to connect to server');
        }
      }

      if (!this.isValidConfig(config)) {
        reject('Invalid config file');
      } else {
        this.config = config;
        resolve(isNewExam);
      }
    });
  }

  /**
   * Get the config from a given URL.
   *
   * @async
   * @param {string} url - The URL that returns a JSON config.
   * @returns {Promise<object>} The JSON config object.
   */
  async getConfig(url) {
    return new Promise((resolve, reject) => {
      fetch(url)
        .then((response) => response.json())
        .then((configData) => {
          if (!this.isValidConfig(configData)) {
            reject();
          } else {
            resolve(configData)
          }
        })
        .catch((err) => reject(err));
    });
  }

  /**
   * Lock the entire app, which gets triggered once the exam is over.
   */
  lock() {
    notify('Your code is now locked and cannot be edited anymore.');

    // Disable language worker.
    this.langWorker.terminate();

    // Make the entire UI read-only.
    this.layout.showLockedState({ prevAutoSaveTime: this.prevAutoSaveTime });
  }

  /**
   * Validate whether the given config object is valid.
   *
   * @param {object} config - The config object to validate.
   * @returns {boolean} True when the given object is a valid config object.
   */
  isValidConfig(config) {
    return isObject(config) && objectHasKeys(config, ['tabs', 'postback']);
  }

  /**
   * Validate the query parameters for this application.
   *
   * @param {object} queryParams - The query parameters object.
   * @returns {boolean} True when the query params passes all validation checks.
   */
  validateQueryParams(queryParams) {
    if (!isObject(queryParams) || !objectHasKeys(queryParams, ['url', 'code'])) {
      return false;
    }

    // At this point, we know we have a 'url' and 'code' param.
    const configUrl = window.decodeURI(queryParams.url);
    if (!isValidUrl(configUrl)) {
      console.error('Invalid config URL');
      return false;
    }

    return true;
  }

  /**
   * Register auto-save by calling the auto-save every X seconds.
   *
   * @param {string} url - The endpoint where the files will be submitted to.
   * @param {string} uuid - Unique user ID that the POST request needs for
   * verification purposes.
   * @param {boolean} [force] - Whether to trigger the auto-save immediately.
   * @param {function} [saveCallback] - Callback when the save has been done.
   */
  registerAutoSave(url, uuid, force, saveCallback) {
    if (this.autoSaveIntervalId) {
      clearInterval(this.autoSaveIntervalId);
    }

    const run = async () => {
      // Explicitly use a try-catch to make sure this auto-save never stops.
      try {
        if (this.editorContentChanged || force) {
          // Save the editor content.
          const res = await this.doAutoSave(url, uuid);

          if (typeof saveCallback === 'function') {
            saveCallback();
          }

          // Check if the response returns a "423 Locked" status, indicating
          // that the user the submission has been closed.
          if (res.status === 423) {
            clearInterval(this.autoSaveIntervalId);
            this.lock();
            return;
          }

          // If the response was not OK, throw an error.
          if (!res.ok) {
            throw new Error(`[${res.status} ${res.statusText}] ${res.url}`);
          }

          // The response is successful at this point, thus reset flag.
          this.editorContentChanged = false;
          removeLocalStorageItem('editor-content-changed');

          // Update the last saved timestamp in the UI.
          this.updateLastSaved();

        }
      } catch (err) {
        console.error('Auto-save failed:', err);
        this.updateLastSaved(true);
      }
    };

    this.autoSaveIntervalId = setInterval(run, AUTOSAVE_INTERVAL);

    if (force) run();
  }

  /**
   * Update the last saved timestamp in the UI.
   */
  updateLastSaved(showPrevAutoSaveTime) {
    const currDate = new Date();
    const autoSaveTime = formatDate(currDate);

    if (showPrevAutoSaveTime) {
      let msg = `Could not save at ${autoSaveTime}`;
      if (this.prevAutoSaveTime instanceof Date) {
        msg += ` (last save at ${formatDate(this.prevAutoSaveTime)})`
      }

      notifyError(msg);
    } else {
      notify(`Last save at ${autoSaveTime}`);
      this.prevAutoSaveTime = currDate;

      this.layout.setSubmitModalSuccess({ evalLink: this.config.eval_link });
    }
  }

  /**
   * Gather all files from the editor and submit them to the given URL.
   *
   * @async
   * @param {string} url - The endpoint URL where the files will be submitted to.
   * @param {string} uuid - Unique user ID that the POST request needs for
   *                        verification purposes.
   * @returns {Promise<Response>} The response from the submission endpoint.
   */
  async doAutoSave(url, uuid) {
    const formData = new FormData();
    formData.append('code', uuid);

    // Go through each tab and create a Blob with the file contents of that tab
    // and append it to the form data.
    await Promise.all(
      this.layout.getEditorComponents().map(async (editorComponent) => {
        const filename = editorComponent.getFilename();
        const filepath = editorComponent.getPath();
        const content = await this.vfs.readFile(filepath);
        const blob = new Blob([content], { type: 'text/plain' });
        formData.append(`files[${filename}]`, blob, filename);
      })
    )

    return fetch(url, { method: 'POST', body: formData, });
  }

  /**
   * Show the submit exam modal and do one final submit of all the contents.
   */
  onSubmitButtonClicked() {
    this.layout.showSubmitExamModal({ prevAutoSaveTime: this.prevAutoSaveTime });

    // Wait for the modal to be shown and then execute the code.
    // interval = 300ms for the opening transition to be completed.
    const submitTimeoutId = setTimeout(async () => {
      await this.loadConfig();
      this.registerAutoSave(this.config.postback, this.config.code, true, () => {
        // Stop all timeouts after the first successful save.
        this.layout.cancelSubmitPendingMessage();
        clearTimeout(submitTimeoutId);
      });

    }, 300);
  }

  /**
   * Get the hidden files defined in the exam config's `hidden_tabs` property.
   *
   * @returns {array<object<string,string>>} List of (hidden) file objects.
   */
  getHiddenFiles() {
    const hiddenFileKeys = Object.keys(this.layout.hiddenFiles);
    if (hiddenFileKeys.length > 0) {
      return hiddenFileKeys.map((filename) => ({
        path: filename,
        name: filename,
        content: this.layout.hiddenFiles[filename],
      }));
    }

    return [];
  }
}
