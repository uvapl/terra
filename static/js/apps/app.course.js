import App from './app.js';
import {
  AUTOSAVE_INTERVAL,
  AUTOSAVE_START_OFFSET,
} from '../constants.js';
import {
  getConfigUrlParams,
  fetchServerConfig,
  isValidServerConfig,
  vfsFolder,
  selectConfigStorage,
  saveConfig,
  loadStoredConfig,
} from './app.course.config.js';
import {
  getLabUrlParam,
  fetchLabConfig,
  isValidLabConfig,
} from './lab-source.js';
import { loadReadme } from './app.course.readme.js';
import {
  formatDate,
  getFileExtension,
  getRandNumBetween,
  isObject,
  seconds,
  slugify,
} from '../lib/helpers.js';
import CourseController from '../ui/controllers/course.js';
import courseCommandConfig from '../commands/config.course.js';
import {
  setLocalStorageItem,
  getLocalStorageItem,
  removeLocalStorageItem,
} from '../lib/local-storage-manager.js';
import { notify, notifyError } from '../ui/components/notifications.js';

/**
 * What a page is when it says nothing: a standalone lab.
 */
const DEFAULT_PAGE = {
  /** Whether the page talks to a course-site. */
  connected: false,
  /** Editor/terminal arrangement, for a session without instructions. */
  orientation: 'vertical',
  /** Which storage scheme names this page's keys, 'exam' or 'lab'. */
  storage: 'lab',
  /** Whether booting from URL params starts from a clean file system. */
  resetOnBoot: false,
  /** Whether the page offers a form to open a lab by URL. */
  landingForm: false,
  /** Name of the page, used as the suffix of the browser tab title. */
  name: null,
};

/**
 * A session on a piece of coursework, which is two independent things:
 *
 * - A **course-site connection**, which supplies the files a student left
 *   behind, takes them back through auto-save and a submit button, and can
 *   lock the session once submission closes. The exam page always has one.
 * - **Lab content**: the file list, instructions and buttons declared by a
 *   `lab.yml` somewhere on the web. The lab page always has this; a connected
 *   session has it when the course-site config names a `lab_url`.
 *
 * Either can be present without the other, which is what makes a lab
 * optionally connected: the same lab runs standalone from the lab page, or
 * connected from the exam page when a course-site hands it out.
 */
export default class CourseApp extends App {
  /**
   * Contains a reference to the resolved config.
   * @type {object}
   */
  config = null;

  /**
   * Whether the user has made any changes in any editor.
   * @type {boolean}
   */
  editorContentChanged = false;

  /**
   * @param {object} [page] - What this page is; see DEFAULT_PAGE.
   */
  constructor(page = {}) {
    super();
    this.page = { ...DEFAULT_PAGE, ...page };
  }

  async init() {
    let isNew;
    try {
      isNew = await this.loadConfig();
    } catch (err) {
      console.error('Failed to load configuration:', err);

      // Only a page that can open a lab by URL has anything to offer here. A
      // connected page deliberately has none: falling back to a form that
      // opens a lab without its course-site would invite the student around
      // the connection.
      if (this.page.landingForm) {
        this.showLandingForm(err.message);
      }
      return;
    }

    if (!this.config) {
      // First visit with nothing to open: let the user paste a lab URL.
      if (this.page.landingForm) {
        this.showLandingForm();
      }
      return;
    }

    this.isNew = isNew;

    if (!this.page.connected) {
      // Changing the hash (pasting another lab URL in the address bar) does
      // not reload the page by itself, so do it ourselves to switch labs.
      $(window).on('hashchange', () => window.location.reload());
    }

    await super.init();
  }

  /**
   * Whether this session has a lab behind it, and so instructions to render
   * and a place to download files from.
   *
   * @returns {boolean}
   */
  hasLabContent() {
    return typeof this.config?.baseUrl === 'string';
  }

  /**
   * The slug identifying this session, which its VFS folder and local storage
   * prefix are derived from. A connected session is identified by the
   * course-site it belongs to rather than by the lab it happens to show, so
   * that the same lab opened standalone keeps its own separate files.
   *
   * @returns {string}
   */
  sessionSlug() {
    return this.page.connected ? slugify(this.config.configUrl) : this.config.slug;
  }

  /**
   * Whether a session showing these files needs a terminal. It goes without one
   * only when it has a file that draws on a canvas and no file that a
   * terminal-writing language can run: a Karel-only exam shows the canvas alone,
   * while a session mixing Karel and Python keeps its terminal and opens the
   * canvas next to it (see _showSurface).
   *
   * @param {string[]} filenames - The files the session opens.
   * @returns {boolean} Whether the session needs a terminal.
   */
  needsTerminalFor(filenames) {
    const proglangs = filenames.map(getFileExtension);

    return !proglangs.some((proglang) => this.needsCanvas(proglang))
      || proglangs.some((proglang) =>
        this.langWorkerClient.supports(proglang) && !this.needsCanvas(proglang));
  }

  async setupLayout() {
    const config = this.config;

    // Files for a specific session are hosted in a subdirectory of the VFS.
    await this.vfs.setBaseFolder(vfsFolder(this.page.storage, this.sessionSlug()));

    const tabs = isObject(config.tabs) ? config.tabs : {};
    const files = Array.isArray(config.files) ? config.files : [];

    if (this.isNew) {
      await this.vfs.clear();
    }

    // The course-site's copy is the student's own work, so it goes in before
    // the lab's pristine copy.
    for (const [filename, content] of Object.entries(tabs)) {
      if (await this.vfs.pathExists(filename)) continue;
      await this.vfs.createFile(filename, content);
    }

    // Download the lab files the server did not supply. Files the student
    // already has (and may have edited) are never overwritten, which is what
    // makes a standalone lab persistent across visits.
    const failedDownloads = [];
    await Promise.all(
      files.map(async (filename) => {
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
          // The download was blocked or the network is down. Creating an empty
          // file here would look like an assignment that ships blank files, so
          // record it and leave the file absent instead.
          console.error(`Failed to download lab file ${filename}:`, err);
          failedDownloads.push(filename);
          return;
        }

        await this.vfs.createFile(filename, content);
      })
    );

    if (failedDownloads.length > 0) {
      notifyError(
        `Could not download: ${failedDownloads.join(', ')}. `
        + 'Check your network connection and reload the page.'
      );
    }

    // put all hidden tabs from the config into the VFS as read-only
    const hidden = isObject(config.hidden_tabs) ? config.hidden_tabs : {};
    await Promise.all(
      Object.entries(hidden).map(([filename, content]) =>
        this.vfs.updateFile(filename, content, false)
      )
    );
    this.vfs.setReadOnlyPaths(Object.keys(hidden));

    // The lab's own order first, so the language is taken from the file the
    // lab leads with, then anything else the course-site sent.
    const filenames = files.concat(
      Object.keys(tabs).filter((filename) => !files.includes(filename))
    );

    // enable css flag for readme panel
    if (this.hasLabContent()) {
      $('body').addClass('has-readme');
    }

    // check whether terminal is needed
    const terminal = this.needsTerminalFor(filenames);

    // register terminal commands
    this.commands.register(
      terminal
        ? courseCommandConfig.commands
        : courseCommandConfig.commands.filter((cmd) => cmd.name !== 'clearTerminal')
    );

    this.view = new CourseController({
      delegate: this,
      commandRegistry: this.commands,
      files: filenames,
      terminal,
      autocomplete: config.autocomplete,

      // Instructions already take the horizontal room, so a session showing
      // them stacks the editor over the terminal whatever the page prefers.
      orientation: this.hasLabContent() ? 'vertical' : this.page.orientation,
      forceDefaultLayout: this.isNew,
    });
  }

  afterSetupLayout() {
    this.view.setPageTitle(this.config, this.page.name);

    if (this.hasLabContent()) {
      loadReadme(this.config, $('#readme'));
    }

    if (this.page.connected) {
      this.startPostback();
    }

    this.addToolbarButtons(this.config.buttons);
  }

  // ── Configuration ──

  /**
   * Load the configuration for this page.
   *
   * Sets `this.config` on success; leaves it null when a lab page has no lab
   * to open.
   *
   * @async
   * @returns {Promise<boolean>} Whether this session starts from scratch, or
   * an error when rejected.
   */
  async loadConfig() {
    return this.page.connected
      ? this.loadConnectedConfig()
      : this.loadStandaloneLabConfig();
  }

  /**
   * Load the configuration from the course-site pointed to by the query
   * params, or from the most recently used one in local storage.
   *
   * @async
   * @returns {Promise<boolean>} Whether this session starts from scratch.
   */
  async loadConnectedConfig() {
    const queryParams = getConfigUrlParams();
    const { config, isNew } = queryParams
      ? await this.loadConfigFromUrl(queryParams)
      : await this.loadConfigFromStorage();

    if (!isValidServerConfig(config)) {
      throw new Error('Invalid config file');
    }

    // A course-site can hand out a lab rather than a set of files of its own.
    // The lab is resolved on every boot, because its file list and
    // instructions can have moved on since the last visit.
    if (config.lab_url) {
      await this.mergeLabContent(config);
    }

    this.config = config;
    return isNew;
  }

  /**
   * Fetch a fresh config from the course-site pointed to by the URL query
   * params, persist it into local storage and remove the query params from
   * the URL.
   *
   * @async
   * @param {object} queryParams - The validated `{ url, code }` query params.
   * @returns {Promise<object>} An `{ config, isNew }` object.
   */
  async loadConfigFromUrl(queryParams) {
    try {
      const config = await fetchServerConfig(queryParams.url, queryParams.code);
      config.code = queryParams.code;
      config.configUrl = queryParams.url;

      selectConfigStorage(this.page.storage, slugify(config.configUrl));
      saveConfig(config);

      // Remove query params from the URL.
      history.replaceState({}, null, window.location.origin + window.location.pathname);

      notify('Connected to server', { fadeOutAfterMs: seconds(10) });
      return { config, isNew: this.page.resetOnBoot };
    } catch (err) {
      console.error('Failed to fetch config:', err);
      notifyError('Could not connect to server');
      throw err;
    }
  }

  /**
   * Boot from the most recently used config in local storage, verifying that
   * the course-site is still reachable and refreshing the `locked` status.
   *
   * @async
   * @returns {Promise<object>} An `{ config, isNew }` object.
   */
  async loadConfigFromStorage() {
    console.log('Trying to load previous config from localStorage...')

    const config = loadStoredConfig(this.page.storage);

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
      const newConfig = await fetchServerConfig(config.configUrl, config.code);

      // While we fallback on localstorage, we still need to check whether
      // submission is locked, so we have to update the `locked` property.
      config.locked = newConfig.locked;
      saveConfig(config);

      notify('Connected to server', { fadeOutAfterMs: seconds(10) });
      return { config, isNew: false };
    } catch (err) {
      console.error('Failed to connect to server:', err);
      notifyError('Could not connect to server');
      throw err;
    }
  }

  /**
   * Resolve the lab a course-site config points at and fold what it declares
   * into that config.
   *
   * @async
   * @param {object} config - The course-site config, modified in place.
   */
  async mergeLabContent(config) {
    const lab = await fetchLabConfig(config.lab_url);

    if (!isValidLabConfig(lab)) {
      throw new Error('Invalid lab configuration');
    }

    Object.assign(config, {
      labUrl: lab.labUrl,
      baseUrl: lab.baseUrl,
      linkBaseUrl: lab.linkBaseUrl,
      files: lab.files,
      readme: lab.readme,
      name: config.exam_name || lab.name,

      // What the course-site says about a button wins over what the lab says,
      // so a course can adjust a lab it does not own.
      buttons: { ...lab.buttons, ...(isObject(config.buttons) ? config.buttons : {}) },
    });

    // The lab's own slug is deliberately not copied: a connected session is
    // stored under the course-site it came from. See sessionSlug().
  }

  /**
   * Load a lab from the URL param, or fall back to the most recently used lab
   * in local storage.
   *
   * @async
   * @returns {Promise<boolean>} Whether this lab is opened for the first time.
   */
  async loadStandaloneLabConfig() {
    const labUrl = getLabUrlParam();

    if (!labUrl) {
      const config = loadStoredConfig(this.page.storage);
      if (config && isValidLabConfig(config)) {
        this.config = config;
      }
      return false;
    }

    const config = await fetchLabConfig(labUrl);
    if (!isValidLabConfig(config)) {
      throw new Error('Invalid lab configuration');
    }

    selectConfigStorage(this.page.storage, config.slug);

    // The lab is new when nothing has been stored under its slug before.
    const isNew = !getLocalStorageItem('config');
    saveConfig(config);

    // Remove query params from the URL, but keep the hash: a hash-form lab
    // URL stays in the address bar so the link remains shareable.
    history.replaceState({}, null,
      window.location.origin + window.location.pathname + window.location.hash);

    this.config = config;
    return isNew;
  }

  /**
   * Re-fetch the course-site config, picking up a moved postback URL and the
   * current lock state. Cheaper than a full config load, which would also
   * resolve the lab again.
   *
   * @async
   */
  async refreshServerConfig() {
    const config = await fetchServerConfig(this.config.configUrl, this.config.code);

    this.config.postback = config.postback;
    this.config.locked = config.locked;

    saveConfig(this.config);
  }

  /**
   * Show the form where the user can paste a lab URL, used when the app is
   * opened without (a valid) lab URL and no stored lab exists.
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

  // ── Course-site connection ──

  onEditorEditingStarted(editorComponent) {
    this.editorContentChanged = true;
  }

  /**
   * Start talking to the course-site: schedule the auto-save, reveal the
   * submit button and apply a lock that is already in place.
   */
  startPostback() {
    // The previous session may have ended with changes the server never
    // received; in that case start with the changed flag raised so the
    // content is saved again.
    this.editorContentChanged = getLocalStorageItem('editor-content-changed', false);

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

    // Reveal the submit button and add its click event listener.
    this.view.showSubmitButton(this.onSubmitButtonClicked);

    // Immediately lock everything if this session is configured as locked.
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
   * Lock the entire app, which gets triggered once submission is closed.
   */
  lock() {
    notify('Your code is now locked and cannot be edited anymore.');

    // Disable language worker.
    this.terminateWorker();

    // Make the entire UI read-only.
    this.view.showLockedState({ prevAutoSaveTime: this.prevAutoSaveTime });
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
      // that the submission has been closed.
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

      this.view.setSubmitModalSuccess({
        evalLink: this.config.eval_link,
        isLab: this.hasLabContent(),
      });
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
    // Post what is in the editors, not what the delayed writes have reached.
    await this.writeEditorsNow();

    const formData = new FormData();
    formData.append('code', uuid);

    // Go through each tab and create a Blob with the file contents of that tab
    // and append it to the form data.
    await Promise.all(
      this.view.getEditorComponents().map(async (editorComponent) => {
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
   * Show the submit modal and do one final submit of all the contents.
   */
  onSubmitButtonClicked() {
    this.view.showSubmitModal({
      prevAutoSaveTime: this.prevAutoSaveTime,
      isLab: this.hasLabContent(),
    });

    // Wait for the modal to be shown and then execute the code.
    // interval = 300ms for the opening transition to be completed.
    setTimeout(async () => {
      try {
        await this.refreshServerConfig();
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
}
