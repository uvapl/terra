////////////////////////////////////////////////////////////////////////////////
// This file is the main entry point for the exam app.
////////////////////////////////////////////////////////////////////////////////

// ===========================================================================
// Here's the start of the application.
// ===========================================================================

// After the app has initialized (config loaded, components loaded) we want to
// call additional functions.
initApp().then(({ layout, config }) => {
  window._editorIsDirty = false;

  if (config.course_name && config.exam_name) {
    $('.page-title').html(`
      <span class="course-name">${config.course_name}</span>
      <span class="exam-name">${config.exam_name}</span>
    `);
  }

  // Register the auto-save after a certain auto-save offset time to prevent
  // the server receives many requests at once. This helps to spread them out
  // over a minute of time.
  const startTimeout = getRandNumBetween(0, AUTOSAVE_START_OFFSET);
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

}).catch((err) => {
  console.error('Failed to bootstrap app:', err);

  // Remove the right navbar when the application failed to initialise.
  $('.navbar-right').remove();
});

// ===========================================================================
// Functions
// ===========================================================================

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
  if (window._autoSaveIntervalId) {
    clearInterval(_autoSaveIntervalId);
  }

  const run = async () => {
    // Explicitly use a try-catch to make sure this auto-save never stops.
    try {
      if (window._editorIsDirty || force) {
        // Save the editor content.
        const res = await doAutoSave(url, uuid);

        if (typeof saveCallback === 'function') {
          saveCallback();
        }

        // Check if the response returns a "423 Locked" status, indicating
        // that the user the submission has been closed.
        if (res.status === 423) {
          clearInterval(window._autoSaveIntervalId);
          lockApp();
          return;
        }

        // If the response was not OK, throw an error.
        if (!res.ok) {
          throw new Error(`[${res.status} ${res.statusText}] ${res.url}`);
        }

        // Reset the dirty flag as the response is successful at this point.
        window._editorIsDirty = false;

        // Update the last saved timestamp in the UI.
        updateLastSaved();

      }
    } catch (err) {
      console.error('Auto-save failed:', err);
      updateLastSaved(true);
    }
  };

  window._autoSaveIntervalId = setInterval(run, AUTOSAVE_INTERVAL);

  if (force) run();
}

/**
 * Update the last saved timestamp in the UI.
 */
function updateLastSaved(showPrevAutoSaveTime) {
  const currDate = new Date();
  const autoSaveTime = formatDate(currDate);

  if (showPrevAutoSaveTime) {
    const msg = `Could not save at ${autoSaveTime}`;
    if (window._prevAutoSaveTime instanceof Date) {
      msg += ` (last save at ${formatDate(window._prevAutoSaveTime)})`
    }

    notifyError(msg);
  } else {
    notify(`Last save at ${autoSaveTime}`);
    window._prevAutoSaveTime = currDate;

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

  const editorComponent = window._layout.root.contentItems[0].contentItems[0];

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
 * Do another fallback by checking whether the examide-* local storage keys
 * exist from the previous app version. If so, migrate them to the new names.
 *
 * @returns {boolean} True when the migration was successful.
 */
function migrateOldLocalStorageKeys() {
  const configRaw = getLocalStorageItem('config', false);
  if (!configRaw) return false;

  const config = JSON.parse(configRaw);

  const newKeyPrefix = makeLocalStorageKey(config.configUrl);

  for (const oldKey of ['config', 'font-size', 'theme', 'layout']) {
    const value = getLocalStorageItem(oldKey, false);
    const newKey = `${newKeyPrefix}-${oldKey}`;

    // Ignore this key if it has no value or the new key already exists.
    if (!value || getLocalStorageItem(newKey)) continue;

    setLocalStorageItem(newKey, value);
    removeLocalStorageItem(oldKey);
  }

  setLocalStorageItem('last-used', newKeyPrefix);
  updateLocalStoragePrefix(newKeyPrefix);

  return true;
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
  if (window._prevAutoSaveTime instanceof Date) {
    lastSaveText += `<br/>🛅 Previous successful submit was at <span class="last-save">${formatDate(window._prevAutoSaveTime)}</span>.<br/>`;
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
  window._layout.root.contentItems[0].contentItems.forEach((contentItem) => {
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
    if (window._prevAutoSaveTime instanceof Date) {
      lastSubmissionText = `<br/><br/>✅ The last successful submit was at ${formatDate(window._prevAutoSaveTime)}.`;
    }

    $submitModal.find('.modal-body').html(`❌ The submission was locked since the last submit. ${lastSubmissionText}`);
  }

  $('#submit-btn').remove();
}

