import App from './app.js';
import {
  BASE_FONT_SIZE,
  AUTOSAVE_INTERVAL,
  AUTOSAVE_START_OFFSET,
} from './constants.js';
import {
  getConfigUrlParams,
  fetchConfig,
  isValidConfig,
  examSlug,
  selectConfigStorage,
  saveConfig,
  loadStoredConfig,
} from './app.exam.config.js';
import {
  formatDate,
  getFileExtension,
  getRandNumBetween,
  seconds,
} from './lib/helpers.js';
import ExamLayout from './layout/layout.exam.js';
import {
  setLocalStorageItem,
  getLocalStorageItem,
  removeLocalStorageItem,
} from './lib/local-storage-manager.js';
import { notify, notifyError } from './layout/notifications.js';

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

  onEditorEditingStarted(editorComponent) {
    this.editorContentChanged = true;
  }

  async setupLayout() {
    let isNewExam;
    try {
      isNewExam = await this.loadConfig();
    } catch (err) {
      // Remove the right navbar when the application failed to initialise.
      ExamLayout.removeNavbar();
      throw err;
    }

    // Files for a specific exam are hosted in a subdirectory of the VFS.
    const slug = examSlug(this.config.configUrl);
    await this.vfs.setBaseFolder(`exam-${slug}`);

    if (!this.config.tabs) {
      this.config.tabs = {};
    }

    // Get the programming language based on tabs filename.
    const proglang = getFileExtension(Object.keys(this.config.tabs)[0]);

    // Get the font-size stored in local storage or use fallback value.
    const fontSize = getLocalStorageItem('font-size', BASE_FONT_SIZE);

    // Create the content objects that represent each tab in the editor.
    const content = this.generateConfigContent(this.config.tabs, fontSize);

    // Load the exam files.
    if (isNewExam) {
      await this.vfs.clear();

      await Promise.all(
        content.map((file) => this.vfs.createFile(
          file.title,
          file.componentState.value,
        ))
      )
    }

    // Initialize the layout.
    this.layout = new ExamLayout(content, fontSize, {
      proglang,
      hiddenFiles: this.config.hidden_tabs,
      buttonConfig: this.config.buttons,
      autocomplete: this.config.autocomplete,
      forceDefaultLayout: isNewExam,
    });
  }

  postSetupLayout() {
    // The previous session may have ended with changes the server never
    // received; in that case start with the changed flag raised so the
    // content is saved again.
    this.editorContentChanged = getLocalStorageItem('editor-content-changed', false);

    this.layout.setPageTitle(this.config.course_name, this.config.exam_name);

    // Register the auto-save after a certain auto-save offset time to prevent
    // the server receives many requests at once. This helps to spread them out
    // over a minute of time.
    const startTimeout = getRandNumBetween(0, AUTOSAVE_START_OFFSET);
    setTimeout(() => {
      this.registerAutoSave();

      // Push content the previous session never managed to save.
      if (this.editorContentChanged) {
        this.runAutoSave(this.config.postback, this.config.code);
      }
    }, startTimeout);

    // Make the right navbar visible and add the click event listener to the
    // submit button.
    this.layout.showNavbar(this.onSubmitButtonClicked);

    // Immediately lock everything if this exam is configured as being locked.
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
   * Sets `this.config` on success.
   *
   * @async
   * @returns {Promise<boolean>} Whether this is a new exam, or an error
   * when rejected.
   */
  async loadConfig() {
    const queryParams = getConfigUrlParams();
    const { config, isNewExam } = queryParams
      ? await this.loadConfigFromUrl(queryParams)
      : await this.loadConfigFromStorage();

    if (!isValidConfig(config)) {
      throw new Error('Invalid config file');
    }

    this.config = config;
    return isNewExam;
  }

  /**
   * Fetch a fresh config from the exam server pointed to by the URL query
   * params, persist it into local storage and remove the query params from
   * the URL.
   *
   * @async
   * @param {object} queryParams - The validated `{ url, code }` query params.
   * @returns {Promise<object>} An `{ config, isNewExam }` object.
   */
  async loadConfigFromUrl(queryParams) {
    try {
      const config = await fetchConfig(queryParams.url, queryParams.code);
      config.code = queryParams.code;
      config.configUrl = queryParams.url;

      selectConfigStorage(config.configUrl);
      saveConfig(config);

      // Remove query params from the URL.
      history.replaceState({}, null, window.location.origin + window.location.pathname);

      notify('Connected to server', { fadeOutAfterMs: seconds(10) });
      return { config, isNewExam: true };
    } catch (err) {
      console.error('Failed to fetch config:', err);
      notifyError('Could not connect to server');
      throw err;
    }
  }

  /**
   * Boot from the most recently used config in local storage, verifying that
   * the exam server is still reachable and refreshing the `locked` status.
   *
   * @async
   * @returns {Promise<object>} An `{ config, isNewExam }` object.
   */
  async loadConfigFromStorage() {
    console.log('Trying to loading previous exam config from localStorage...')

    const config = loadStoredConfig();

    // On a first visit (or after clearing storage) there is no stored
    // config, so there is nothing to fall back on.
    if (!config) {
      notifyError('No configuration present.');
      throw new Error('No configuration present');
    }

    // Check immediately if the server is reachable by retrieving the
    // config again. If it is reachable, use the stored config as the actual
    // config, otherwise notify the user that we failed to connect.
    try {
      const newConfig = await fetchConfig(config.configUrl, config.code);

      // While we fallback on localstorage, we still need to check whether
      // the exam is locked, so we have to update the `locked` property.
      config.locked = newConfig.locked;
      saveConfig(config);

      notify('Connected to server', { fadeOutAfterMs: seconds(10) });
      return { config, isNewExam: false };
    } catch (err) {
      console.error('Failed to connect to server:', err);
      notifyError('Could not connect to server');
      throw err;
    }
  }

  /**
   * Lock the entire app, which gets triggered once the exam is over.
   */
  lock() {
    notify('Your code is now locked and cannot be edited anymore.');

    // Disable language worker.
    this.terminateLangWorker();

    // Make the entire UI read-only.
    this.layout.showLockedState({ prevAutoSaveTime: this.prevAutoSaveTime });
  }

  /**
   * Register auto-save by calling the auto-save every X seconds, but only
   * when there are changes the server has not successfully received yet.
   * The postback URL and code are read from the config at save time, so a
   * config refresh (e.g. on submit) is picked up automatically.
   */
  registerAutoSave() {
    if (this.autoSaveIntervalId) {
      clearInterval(this.autoSaveIntervalId);
    }

    this.autoSaveIntervalId = setInterval(() => {
      if (this.editorContentChanged) {
        this.runAutoSave(this.config.postback, this.config.code);
      }
    }, AUTOSAVE_INTERVAL);
  }

  /**
   * Save the editor content and handle the server response. Saves
   * unconditionally: whether a save is needed is up to the caller. On
   * failure the changed flag is left raised, so the auto-save interval
   * will retry.
   *
   * @async
   * @param {string} url - The endpoint where the files will be submitted to.
   * @param {string} uuid - Unique user ID that the POST request needs for
   * verification purposes.
   */
  async runAutoSave(url, uuid) {
    // Explicitly use a try-catch to make sure this auto-save never stops.
    try {
      // Save the editor content.
      const res = await this.doAutoSave(url, uuid);

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
    } catch (err) {
      console.error('Auto-save failed:', err);
      this.updateLastSaved(true);
    }
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
    setTimeout(async () => {
      try {
        await this.loadConfig();
      } catch (err) {
        console.error('Failed to reload config on submit:', err);
        return;
      }

      // The submit must end in a confirmed save, even when nothing changed
      // since the last auto-save. Raise the changed flag so a failed save
      // below is retried by the auto-save interval, and a successful save
      // renders the success message in the submit modal.
      this.editorContentChanged = true;
      this.runAutoSave(this.config.postback, this.config.code);
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
