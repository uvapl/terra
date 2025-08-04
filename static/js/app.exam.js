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
import localStorageManager from './local-storage-manager.js';
import Terra from './terra.js';

export default class ExamApp extends App {
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
        await this.vfs.setBaseFolder(`exam-${slug}`)

        if (!this.config.tabs) {
          this.config.tabs = {};
        }

        // Get the programming language based on tabs filename.
        const proglang = getFileExtension(Object.keys(this.config.tabs)[0]);

        // Initialise the programming language specific worker API.
        Terra.app.langWorker = new LangWorker(proglang);

        // Get the font-size stored in local storage or use fallback value.
        const fontSize = localStorageManager.getLocalStorageItem('font-size', BASE_FONT_SIZE);

        // Create the content objects that represent each tab in the editor.
        const content = this.generateConfigContent(this.config.tabs, fontSize);

        if (isNewExam) {
          await Terra.app.vfs.clear();

          // Create the files inside the VFS.
          await Promise.all(
            content.map((file) => Terra.app.vfs.createFile(
              file.title,
              file.componentState.value,
            ))
          )
        }

        // Create the layout object.
        const layout = this.createLayout(content, fontSize, {
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
        $('.navbar-right').remove();
      });
    });
  }

  /**
   * Create the layout object with the given content objects and font-size.
   *
   * @param {array} content - List of content objects.
   * @param {number} fontSize - The default font-size to be used.
   * @param {object} options - Additional options object.
   * @param {string} options.proglang - The programming language to be used.
   * @param {object} options.buttonConfig - Object containing buttons with their
   * commands that will be rendered by the layout.
   * @returns {ExamLayout} The layout instance.
   */
  createLayout(content, fontSize, options = {}) {
    return new ExamLayout(content, fontSize, options);
  }

  postSetupLayout() {
    this.editorContentChanged = false;

    if (this.config.course_name && this.config.exam_name) {
      $('.page-title').html(`
        <span class="course-name">${this.config.course_name}</span>
        <span class="exam-name">${this.config.exam_name}</span>
      `);
    }

    // Register the auto-save after a certain auto-save offset time to prevent
    // the server receives many requests at once. This helps to spread them out
    // over a minute of time.
    const forceAutoSave = localStorageManager.getLocalStorageItem('editor-content-changed', false);
    const startTimeout = getRandNumBetween(0, AUTOSAVE_START_OFFSET);
    setTimeout(() => {
      Terra.app.registerAutoSave(this.config.postback, this.config.code, forceAutoSave);
    }, startTimeout);

    // Make the right navbar visible and add the click event listener to the
    // submit button.
    $('.navbar-right')
      .removeClass('hidden')
      .find('#submit-btn')
      .click(Terra.app.showSubmitExamModal);

    // Immediately lock everything if this exam is locked.
    if (this.config.locked === true) {
      Terra.app.lock();
    }

    // Catch ctrl/cmd+w (aka page reloading) to prevent the user from closing the tab.
    $(window).on('beforeunload', (e) => {
      if (this.editorContentChanged) {
        localStorageManager.setLocalStorageItem('editor-content-changed', true);
      }

      const message = 'Are you sure you want to leave this page?';
      e.preventDefault();
      e.returnValue = message;
      return message;
    });
  }

  /**
   * Load the config through query params with a fallback on the local storage.
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
          localStorageManager.setLocalStorageItem('last-used', currentStorageKey);
          localStorageManager.updateLocalStoragePrefix(currentStorageKey);
          localStorageManager.setLocalStorageItem('config', JSON.stringify(config));

          // Remove query params from the URL.
          history.replaceState({}, null, window.location.origin + window.location.pathname);

          this.notify('Connected to server', { fadeOutAfterMs: seconds(10) });
        } catch (err) {
          console.error('Failed to fetch config:', err);
          this.notifyError('Could not connect to server');
          return;
        }
      } else {
        console.log('fallback local storage')
        // Fallback on local storage.

        // This should only update the local storage prefix if it's
        // not the default prefix.
        if (localStorageManager.isDefaultPrefix()) {
          const currentStorageKey = localStorageManager.getLocalStorageItem('last-used');

          if (currentStorageKey) {
            localStorageManager.updateLocalStoragePrefix(currentStorageKey);
          }
        }

        const localConfig = JSON.parse(localStorageManager.getLocalStorageItem('config'));

        // Check immediately if the server is reachable by retrieving the
        // config again. If it is reachable, use the localConfig as the actual
        // config, otherwise notify the user that we failed to connect.
        try {
          const newConfig = await this.getConfig(makeUrl(localConfig.configUrl, { code: localConfig.code }))

          // While we fallback on localstorage, we still need to check whether
          // the exam is locked, so we have to update the `locked` property.
          localConfig.locked = newConfig.locked;
          localStorageManager.setLocalStorageItem('config', JSON.stringify(localConfig));

          config = localConfig;
          this.notify('Connected to server', { fadeOutAfterMs: seconds(10) });
        } catch (err) {
          console.error('Failed to connect to server:');
          console.error(err);
          this.notifyError('Failed to connect to server');
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
    this.notify('Your code is now locked and cannot be edited anymore.');

    // Lock all components, making them read-only.
    this.layout.emitToTabComponents('lock');

    // Disable language worker.
    Terra.app.langWorker.terminate();

    // Use set-timeout to ensure these locks happen after the DOM has been
    // rendered at least once.
    setTimeout(() => {
      // Disable the controls and remove their 'click' event listeners.
      $('.terminal-component-container .button').prop('disabled', true).off('click');

      // Lock the drag handler between the editor and terminal.
      $('.lm_splitter').addClass('locked');

      // Show lock screen for both containers.
      $('.component-container').addClass('locked');
    });

    // Check if the submit modal is open.
    const $submitModal = $('#submit-exam-model');
    if ($submitModal.length > 0) {
      let lastSubmissionText = '';
      if (this.prevAutoSaveTime instanceof Date) {
        lastSubmissionText = `<br/><br/>✅ The last successful submit was at ${formatDate(this.prevAutoSaveTime)}.`;
      }

      $submitModal.find('.modal-body').html(`❌ The submission was locked since the last submit. ${lastSubmissionText}`);
    }

    $('#submit-btn').remove();
  }

  /**
   * Wrapper to render a notification as an error type.
   *
   * @param {string} msg - The message to be displayed.
   * @param {object} options - Additional options for the notification.
   */
  notifyError(msg, options) {
    this.notify(msg, { ...options, type: 'error' });
  }

  /**
   * Render a given message inside the notification container in the UI.
   *
   * @param {string} msg - The message to be displayed.
   * @param {object} options - Additional options for the notification.
   * @param {string} options.type - The type of notification (e.g. 'error').
   * @param {number} options.fadeOutAfterMs - The time in milliseconds to fade.
   */
  notify(msg, options = {}) {
    if (window.notifyTimeoutId !== null) {
      clearTimeout(window.notifyTimeoutId);
      window.notifyTimeoutId = null;
    }

    const $msgContainer = $('.msg-container');

    if (options.type === 'error') {
      $msgContainer.addClass('error');
    }

    $msgContainer.html(`<span>${msg}</span>`);

    if (options.fadeOutAfterMs) {
      window.notifyTimeoutId = setTimeout(() => {
        $('.msg-container span').fadeOut();
      }, options.fadeOutAfterMs);
    }
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
            Terra.app.lock();
            return;
          }

          // If the response was not OK, throw an error.
          if (!res.ok) {
            throw new Error(`[${res.status} ${res.statusText}] ${res.url}`);
          }

          // The response is successful at this point, thus reset flag.
          this.editorContentChanged = false;
          localStorageManager.removeLocalStorageItem('editor-content-changed');

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

      this.notifyError(msg);
    } else {
      Terra.app.notify(`Last save at ${autoSaveTime}`);
      this.prevAutoSaveTime = currDate;

      const $modal = $('#submit-exam-model');
      if ($modal.length > 0) {
        const evaluationFormLink = this.config.eval_link
          ? `<br/><br/>🙏 <a href="${this.config.eval_link}" target="_blank">Fill in the evaluation form for the course</a>`
          : '';

        $modal.find('.modal-body').html(`
          <p>
            ✅ Your files have been submitted successfully<br/><br/>
            🛂 Make sure that you sign off at the desk before leaving
            ${evaluationFormLink}
          </p>
          <p>You can still return to the exam if you would like to make more changes to your code.</p>
        `);
      }
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
        const content = await Terra.app.vfs.readFile(filepath);
        const blob = new Blob([content], { type: 'text/plain' });
        formData.append(`files[${filename}]`, blob, filename);
      })
    )

    return fetch(url, { method: 'POST', body: formData, });
  }

  /**
   * Hide the submit exam modal by removing it completely out of the DOM, which
   * simplifies our code a bit as we can handle a bit less.
   */
  hideSubmitExamModal() {
    let $modal = $('#submit-exam-model');

    if ($modal.length === 0) return;

    $modal.removeClass('show');

    // Use a timeout to wait for the model animation to be completed before
    // completely removing it from the DOM.
    setTimeout(() => {
      $modal.remove();
    }, 300);
  }

  /**
   * Show the modal that does one final submit of all the contents.
   */
  showSubmitExamModal() {
    let lastSaveText = '';
    if (this.prevAutoSaveTime instanceof Date) {
      lastSaveText += `<br/>🛅 Previous successful submit was at <span class="last-save">${formatDate(this.prevAutoSaveTime)}</span>.<br/>`;
    }

    const modalHtml = `
      <div id="submit-exam-model" class="modal" tabindex="-1">
        <div class="modal-content">
          <div class="modal-header">
            <p class="modal-title">You're done!</p>
          </div>
          <div class="modal-body">
            <div class="spinner"></div>
          </div>
          <div class="modal-footer">
            <button type="button" class="button dismiss-modal-btn">Return to exam</button>
          </div>
        </div>
      </div>
    `;
    $('body').append(modalHtml);

    const $modal = $('#submit-exam-model');
    $modal.find('.dismiss-modal-btn').click(this.hideSubmitExamModal);

    // Use setTimeout trick to add the class after the modal HTML has been
    // rendered to the DOM to show the fade-in animation.
    setTimeout(() => $modal.addClass('show'), 10);

    // If for some reason the auto-save POST request takes more than 1 second,
    // we will show a message to the user.
    //
    // interval = 300ms for the opening transition to be completed + 1 second of
    // time to wait for the POST request. If the submission was successful, then
    // this timeout will be cleared automatically.
    const infoMsgTimeoutId = setTimeout(() => {
      $modal.find('.modal-body').html(`
        <p>
          🈲 NOTE: DO NOT CLOSE THIS BROWSER WINDOW<br/><br/>
          🛄 Trying to submit your final changes to the server.<br/>
          ${lastSaveText}
        </p>
        <p>You can still return to the exam if you would like to make more changes to your code.</p>
      `);
    }, 1300);

    // Wait for the modal to be shown and then execute the code.
    // interval = 300ms for the opening transition to be completed.
    const submitTimeoutId = setTimeout(async () => {
      await this.loadConfig();
      this.registerAutoSave(this.config.postback, this.config.code, true, () => {
        // Stop all timeouts after the first successful save.
        clearTimeout(infoMsgTimeoutId);
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
