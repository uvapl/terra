////////////////////////////////////////////////////////////////////////////////
// This file is the main entry point for the exam app.
////////////////////////////////////////////////////////////////////////////////

// ===========================================================================
// Here's the start of the application.
// ===========================================================================

// After the app has initialized (config loaded, components loaded) we want to
// call additional functions.
initApp().then(({ layout, config }) => {
  Terra.v.editorIsDirty = false;

  if (config.course_name && config.exam_name) {
    $('.page-title').html(`
      <span class="course-name">${config.course_name}</span>
      <span class="exam-name">${config.exam_name}</span>
    `);
  }

  // Register the auto-save after a certain auto-save offset time to prevent
  // the server receives many requests at once. This helps to spread them out
  // over a minute of time.
  const startTimeout = Terra.f.getRandNumBetween(0, Terra.c.AUTOSAVE_START_OFFSET);
  setTimeout(() => {
    registerAutoSave(config.postback, config.code);
  }, startTimeout);

  // Make the right navbar visible and add the click event listener to the
  // submit button.
  $('.navbar-right')
    .removeClass('hidden')
    .find('#submit-btn')
    .click(showSubmitExamModal);

  // Immediately lock everything if this exam is locked.
  if (config.locked === true) {
    lockApp();
  }

  // Catch ctrl-w and cmd-w to prevent the user from closing the tab.
  $(window).on('beforeunload', (e) => {
    const message = 'Are you sure you want to leave this page?';
    e.preventDefault();
    e.returnValue = message;
    return message;
  });

}).catch((err) => {
  console.error('Failed to bootstrap exam app:', err);

  // Remove the right navbar when the application failed to initialise.
  $('.navbar-right').remove();
});

// ===========================================================================
// Functions
// ===========================================================================

/**
 * Initialise the app by loading the config and create the layout.
 *
 * @returns {Promise<{ layout: Layout, config: object }>} Object containing
 * the layout instance and the config object.
 */
function initApp() {
  return new Promise((resolve, reject) => {
    loadConfig()
      .then(async (config) => {
        if (!config.tabs) {
          config.tabs = {};
        }

        // Get the programming language based on tabs filename.
        const proglang = Terra.f.getFileExtension(Object.keys(config.tabs)[0]);

        // Initialise the programming language specific worker API.
        Terra.langWorkerApi = new LangWorkerAPI(proglang);

        // Get the font-size stored in local storage or use fallback value.
        const fontSize = Terra.f.getLocalStorageItem('font-size', Terra.c.BASE_FONT_SIZE);

        // Create the content objects that represent each tab in the editor.
        const content = generateConfigContent(config.tabs, fontSize);

        // Create the files inside the virtual file system.
        content.forEach((file) => {
          Terra.vfs.createFile({
            id: file.componentState.fileId,
            name: file.title,
            content: file.componentState.value,
          })
        });

        // Create the layout object.
        const layout = createLayout(content, fontSize, {
          proglang,
          buttonConfig: config.buttons,
          autocomplete: config.autocomplete,
        });

        // Make layout instance available at all times.
        Terra.layout = layout;

        // Call the init function that creates all components.
        layout.init();

        // Use timeout trick to make sure layout.root exists.
        layout.on('initialised', () => {
          resolve({ layout, config });
        });
      })
      .catch((err) => reject(err));
  });
}

/**
 * Load the config through query params with a fallback on the local storage.
 *
 * @returns {Promise<object|string>} The configuration for the app once
 * resolved, or an error when rejected.
 */
function loadConfig() {
  return new Promise(async (resolve, reject) => {
    let config;

    // First, check if there are query params given. If so, validate them.
    // Next, get the config data and when fetched succesfully, save it into
    // local storage and remove the query params from the URL.
    const queryParams = Terra.f.parseQueryParams();
    if (validateQueryParams(queryParams)) {
      try {
        config = await getConfig(Terra.f.makeUrl(queryParams.url, { code: queryParams.code }));
        config.code = queryParams.code;
        config.configUrl = queryParams.url;

        const currentStorageKey = Terra.f.makeLocalStorageKey(config.configUrl);
        Terra.f.setLocalStorageItem('last-used', currentStorageKey);
        Terra.f.updateLocalStoragePrefix(currentStorageKey);
        Terra.f.setLocalStorageItem('config', JSON.stringify(config));

        // Remove query params from the URL.
        history.replaceState({}, null, window.location.origin + window.location.pathname);

        notify('Connected to server', { fadeOutAfterMs: 10 * 1000 });
      } catch (err) {
        console.error('Failed to fetch config:', err);
        notifyError('Could not connect to server');
        return;
      }
    } else {
      // Fallback on local storage.

      // This function should only update the local storage prefix if it's
      // not the default prefix.
      if (Terra.c.LOCAL_STORAGE_PREFIX === Terra.c.DEFAULT_LOCAL_STORAGE_PREFIX) {
        const currentStorageKey = Terra.f.getLocalStorageItem('last-used');

        if (currentStorageKey) {
          Terra.f.updateLocalStoragePrefix(currentStorageKey);
        } else if (!migrateOldLocalStorageKeys()) {
          reject('Last-used local storage key not available and failed to migrate old keys.');
        }
      }

      const localConfig = JSON.parse(Terra.f.getLocalStorageItem('config'));

      // Check immediately if the server is reachable by retrieving the
      // config again. If it is reachable, use the localConfig as the actual
      // config, otherwise notify the user that we failed to connect.
      try {
        const newConfig = await getConfig(Terra.f.makeUrl(localConfig.configUrl, { code: localConfig.code }))

        // While we fallback on localstorage, we still need to check whether
        // the exam is locked, so we have to update the `locked` property.
        localConfig.locked = newConfig.locked;
        Terra.f.setLocalStorageItem('config', JSON.stringify(localConfig));

        config = localConfig;
        notify('Connected to server', { fadeOutAfterMs: 10 * 1000 });
      } catch (err) {
        console.error('Failed to connect to server:');
        console.error(err);
        notifyError('Failed to connect to server');
      }
    }

    if (!isValidConfig(config)) {
      reject('Invalid config file');
    } else {
      resolve(config);
    }
  });
}

/**
 * Validate whether the given config object is valid.
 *
 * @param {object} config - The config object to validate.
 * @returns {boolean} True when the given object is a valid config object.
 */
function isValidConfig(config) {
  return Terra.f.isObject(config) && Terra.f.objectHasKeys(config, ['tabs', 'postback']);
}

/**
 * Validate the query parameters for this application.
 *
 * @param {object} queryParams - The query parameters object.
 * @returns {boolean} True when the query params passes all validation checks.
 */
function validateQueryParams(queryParams) {
  if (!Terra.f.isObject(queryParams) || !Terra.f.objectHasKeys(queryParams, ['url', 'code'])) {
    return false;
  }

  // At this point, we know we have a 'url' and 'code' param.
  const configUrl = window.decodeURI(queryParams.url);
  if (!Terra.f.isValidUrl(configUrl)) {
    console.error('Invalid config URL');
    return false;
  }

  return true;
}

/**
 * Get the config from a given URL.
 *
 * @async
 * @param {string} url - The URL that returns a JSON config.
 * @returns {Promise<object>} The JSON config object.
 */
async function getConfig(url) {
  return new Promise((resolve, reject) => {
    fetch(url)
      .then((response) => response.json())
      .then((configData) => {
        if (!isValidConfig(configData)) {
          reject();
        } else {
          resolve(configData)
        }
      })
      .catch((err) => reject(err));
  });
}

/**
 * Do another fallback by checking whether the terra-* local storage keys
 * exist from the previous app version. If so, migrate them to the new names.
 *
 * @returns {boolean} True when the migration was successful.
 */
function migrateOldLocalStorageKeys() {
  const configRaw = Terra.f.getLocalStorageItem('config', false);
  if (!configRaw) return false;

  const config = JSON.parse(configRaw);

  const newKeyPrefix = Terra.f.makeLocalStorageKey(config.configUrl);

  for (const oldKey of ['config', 'font-size', 'theme', 'layout']) {
    const value = Terra.f.getLocalStorageItem(oldKey, false);
    const newKey = `${newKeyPrefix}-${oldKey}`;

    // Ignore this key if it has no value or the new key already exists.
    if (!value || Terra.f.getLocalStorageItem(newKey)) continue;

    Terra.f.setLocalStorageItem(newKey, value);
    Terra.f.removeLocalStorageItem(oldKey);
  }

  Terra.f.setLocalStorageItem('last-used', newKeyPrefix);
  Terra.f.updateLocalStoragePrefix(newKeyPrefix);

  return true;
}

/**
 * Register auto-save by calling the auto-save function every X seconds.
 *
 * @param {string} url - The endpoint where the files will be submitted to.
 * @param {string} uuid - Unique user ID that the POST request needs for
 *                        verification purposes.
 * @param {boolean} [force] - Whether to trigger the auto-save immediately.
 * @param {function} [saveCallback] - Callback function when the save has been
 * done.
 */
function registerAutoSave(url, uuid, force, saveCallback) {
  if (Terra.v.autoSaveIntervalId) {
    clearInterval(_autoSaveIntervalId);
  }

  const run = async () => {
    // Explicitly use a try-catch to make sure this auto-save never stops.
    try {
      if (Terra.v.editorIsDirty || force) {
        // Save the editor content.
        const res = await doAutoSave(url, uuid);

        if (typeof saveCallback === 'function') {
          saveCallback();
        }

        // Check if the response returns a "423 Locked" status, indicating
        // that the user the submission has been closed.
        if (res.status === 423) {
          clearInterval(Terra.v.autoSaveIntervalId);
          lockApp();
          return;
        }

        // If the response was not OK, throw an error.
        if (!res.ok) {
          throw new Error(`[${res.status} ${res.statusText}] ${res.url}`);
        }

        // Reset the dirty flag as the response is successful at this point.
        Terra.v.editorIsDirty = false;

        // Update the last saved timestamp in the UI.
        updateLastSaved();

      }
    } catch (err) {
      console.error('Auto-save failed:', err);
      updateLastSaved(true);
    }
  };

  Terra.v.autoSaveIntervalId = setInterval(run, Terra.c.AUTOSAVE_INTERVAL);

  if (force) run();
}

/**
 * Update the last saved timestamp in the UI.
 */
function updateLastSaved(showPrevAutoSaveTime) {
  const currDate = new Date();
  const autoSaveTime = Terra.f.formatDate(currDate);

  if (showPrevAutoSaveTime) {
    const msg = `Could not save at ${autoSaveTime}`;
    if (Terra.v.prevAutoSaveTime instanceof Date) {
      msg += ` (last save at ${Terra.f.formatDate(Terra.v.prevAutoSaveTime)})`
    }

    notifyError(msg);
  } else {
    notify(`Last save at ${autoSaveTime}`);
    Terra.v.prevAutoSaveTime = currDate;

    const $modal = $('#submit-exam-model');
    if ($modal.length > 0) {
      $modal.find('.modal-body').html(`
        <p>
          ✅ Your files have been submitted successfully.<br/><br/>
          🛂 Make sure that you sign off at the desk before leaving.
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
function doAutoSave(url, uuid) {
  const formData = new FormData();
  formData.append('code', uuid);

  const editorComponent = Terra.layout.root.contentItems[0].contentItems[0];

  // Go through each tab and create a Blob with the file contents of that tab
  // and append it to the form data.
  editorComponent.contentItems.forEach((contentItem) => {
    const filename = contentItem.config.title;
    const fileContent = contentItem.container.getState().value;
    const blob = new Blob([fileContent], { type: 'text/plain' });
    formData.append(`files[${filename}]`, blob, filename);
  });

  return fetch(url, { method: 'POST', body: formData, });
}

/**
 * Hide the submit exam modal by removing it completely out of the DOM, which
 * simplifies our code a bit as we can handle a bit less.
 */
function hideSubmitExamModal() {
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
function showSubmitExamModal() {
  let lastSaveText = '';
  if (Terra.v.prevAutoSaveTime instanceof Date) {
    lastSaveText += `<br/>🛅 Previous successful submit was at <span class="last-save">${Terra.f.formatDate(Terra.v.prevAutoSaveTime)}</span>.<br/>`;
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

  $modal = $('#submit-exam-model');
  $modal.find('.dismiss-modal-btn').click(hideSubmitExamModal);

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
    const config = await loadConfig();
    registerAutoSave(config.postback, config.code, true, () => {
      // Stop all timeouts after the first successful save.
      clearTimeout(infoMsgTimeoutId);
      clearTimeout(submitTimeoutId);
    });

  }, 300);
}

/**
 * Lock the entire app, which gets triggered once the exam is over.
 */
function lockApp() {
  notify('Your code is now locked and cannot be edited anymore.');

  // Lock all components, making them read-only.
  Terra.layout.root.contentItems[0].contentItems.forEach((contentItem) => {
    contentItem.contentItems.forEach((component) => {
      component.container.emit('lock');
    });
  });

  // Disable the controls and remove the 'click' event listeners.
  $('#run').prop('disabled', true).off('click');
  $('#clear-term').prop('disabled', true).off('click');

  // Lock the drag handler between the editor and terminal.
  $('.lm_splitter').addClass('locked');

  // Show lock screen for both containers.
  $('.component-container').addClass('locked');

  // Check if the submit modal is open.
  $submitModal = $('#submit-exam-model');
  if ($submitModal.length > 0) {
    let lastSubmissionText = '';
    if (Terra.v.prevAutoSaveTime instanceof Date) {
      lastSubmissionText = `<br/><br/>✅ The last successful submit was at ${Terra.f.formatDate(Terra.v.prevAutoSaveTime)}.`;
    }

    $submitModal.find('.modal-body').html(`❌ The submission was locked since the last submit. ${lastSubmissionText}`);
  }

  $('#submit-btn').remove();
}

/**
 * Wrapper function to render a notification as an error type.
 *
 * @param {string} msg - The message to be displayed.
 * @param {object} options - Additional options for the notification.
 */
function notifyError(msg, options) {
  notify(msg, { ...options, type: 'error' });
}

/**
 * Render a given message inside the notification container in the UI.
 *
 * @param {string} msg - The message to be displayed.
 * @param {object} options - Additional options for the notification.
 * @param {string} options.type - The type of notification (e.g. 'error').
 * @param {number} options.fadeOutAfterMs - The time in milliseconds to fade.
 */
function notify(msg, options = {}) {
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
