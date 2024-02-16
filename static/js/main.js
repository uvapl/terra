// ===========================================================================
// Here's the start of the application.
// ===========================================================================

// After the app has initialized (config loaded, components loaded) we want to
// call additional functions.
initApp().then(({ layout, config }) => {
  window._layout = layout;
  window._editorIsDirty = false;

  registerAutoSave(config.postback, config.code);
}).catch((err) => {
    console.error('Failed to bootstrap app:', err);
});

// ===========================================================================
// Functions
// ===========================================================================

/**
 * Initialise the app by loading the config and create the layout.
 *
 * @returns {Promise<{ layout: Layout, config: object }>} Object containing the
 * layout instance and the config object.
 */
function initApp() {
  return new Promise((resolve, reject) => {
    loadConfig()
      .then(async (config) => {
        // Get the font-size stored in local storage or use fallback value.
        const fontSize = getLocalStorageItem('font-size', BASE_FONT_SIZE);

        // Create the content objects that represent each tab in the editor.
        const content = generateConfigContent(config.tabs, fontSize);

        // Create the layout object.
        const layout = createLayout(content, fontSize);

        // Call the init function that creates all components.
        layout.init();

        resolve({ layout, config });
      })
      .catch((err) => reject(err));
  });
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
}

/**
 * Register auto-save by calling the auto-save function every X seconds.
 *
 * @param {string} url - The endpoint URL where the files will be submitted to.
 * @param {string} uuid - Unique user ID that the POST request needs for
 *                        verification purposes.
 */
function registerAutoSave(url, uuid) {
  const autoSaveIntervalId = setInterval(async () => {
    // Explicitly use a try-catch to make sure this auto-save never stops.
    try {
      if (window._editorIsDirty) {
        // Save the editor content.
        const res = await doAutoSave(url, uuid);

        // Check if the response returns a "423 Locked" status, indicating that
        // the user the submission has been closed.
        if (res.status === 423) {
          clearInterval(autoSaveIntervalId);
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
  }, AUTOSAVE_INTERVAL);
}

/**
 * Prefix the given number with a zero if below 10.
 *
 * @param {string|number} num - The number to be prefixed.
 * @returns {string|number} Returns the original if above 10, otherwise it will
 * return a string prefixed with a zero.
 */
function prefixZero(num) {
  return num < 10 ? '0' + num : num;
}

/**
 * Format a given date object to a human-readable format.
 *
 * @param {Date} date - The date object to use.
 * @returns {string} Formatted string in human-readable format.
 */
function formatDate(date) {
  const hours = prefixZero(date.getHours());
  const minutes = prefixZero(date.getMinutes());
  return hours + ':' + minutes;
}

/**
 * Update the last saved timestamp in the UI.
 */
function updateLastSaved(showPrevAutoSaveTime) {
  const currDate = new Date();
  const autoSaveTime = formatDate(currDate);

  let msg;
  if (showPrevAutoSaveTime) {
    msg = `Could not save at ${autoSaveTime}`;
    if (window._prevAutoSaveTime instanceof Date) {
      msg += ` (last save at ${formatDate(window._prevAutoSaveTime)})`
    }
  } else {
    msg = `Last save at ${autoSaveTime}`;
    window._prevAutoSaveTime = currDate;
  }

  notify(msg);
}

/**
 * Render a given message inside the notification container in the UI.
 *
 * @param {string} msg - The message to be displayed.
 */
function notify(msg) {
  $('.msg-container').html(msg);
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
 * Check whether a given server URL is reachable.
 *
 * @param {string} url - The server URL to check for.
 * @returns {Promise<boolean>} Resolves `true` when the server is reachable.
 */
function checkServerConnection(url) {
  return new Promise((resolve, reject) => {
    fetch(url)
      .then((response) => {
        if (response.ok) {
          resolve();
        } else {
          reject();
        }
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
    const queryParams = parseQueryParams();
    if (validateQueryParams(queryParams)) {
      try {
        config = await getConfig(queryParams.url);
        config.code = queryParams.code;
        config.configUrl = queryParams.url;
        setLocalStorageItem('config', JSON.stringify(config));

        // Remove query params from the URL.
        history.replaceState({}, null, window.location.origin + window.location.pathname);

        notify('Connected to server');
      } catch (err) {
        console.error('Failed to fetch config:', err);
        notify('Could not connect to server');
        return;
      }
    } else {
      // Fallback on local storage.
      const tmpConfig = JSON.parse(getLocalStorageItem('config', {}));

      // Check immediately if the server is reachable.
      // If it is reachable, use the tmpConfig as the actual config,
      // otherwise notify the user that we failed to connect.
      let testUrl = tmpConfig.configUrl;
      try {
        await checkServerConnection(testUrl);
        config = tmpConfig;
        notify('Connected to server');
      } catch (err) {
        console.error('Failed to connect to', testUrl);
        console.error(err);
        notify('Failed to connect to server');
      }
    }

    if (!isValidConfig(config)) {
      reject('Invalid config file contents');
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
  return isObject(config) && objectHasKeys(config, ['tabs', 'postback']);
}

/**
 * Create the layout object with the given content objects and font-size.
 *
 * @param {array} content - List of content objects.
 * @param {number} fontSize - The default font-size to be used.
 * @returns {Layout} The layout instance.
 */
function createLayout(content, fontSize) {
  const defaultLayoutConfig = {
    settings: {
      showCloseIcon: false,
      showPopoutIcon: false,
      showMaximiseIcon: false,
      showCloseIcon: false,
    },
    dimensions: {
      headerHeight: 30,
      borderWidth: 10,
    },
    content: [
      {
        type: 'row',
        isClosable: false,
        content: [
          {
            type: 'stack',
            isClosable: false,
            content: content,
          },
          {
            type: 'component',
            componentName: 'terminal',
            componentState: { fontSize: fontSize },
            isClosable: false,
          }
        ]
      }
    ]
  };

  return new Layout({ defaultLayoutConfig });
}

/**
 * Create a list of content objects based on the tabs config data.
 *
 * @param {object} tabs - An object where each key is the filename and the
 * value is the default value the editor should have when the file is opened.
 * @param {number} fontSize - The default font-size to be used for the content.
 * @returns {array} List of content objects.
 */
function generateConfigContent(tabs, fontSize) {
  return Object.keys(tabs).map((filename) => ({
    type: 'component',
    componentName: 'editor',
    componentState: {
      fontSize: fontSize,
      value: tabs[filename],
    },
    title: filename,
    isClosable: false,
  }));
}

/**
 * Parse the query parameters from the window.location.search.
 *
 * @returns {object} A key-value object with all the query params.
 */
function parseQueryParams() {
  return window.location.search
    .substring(1)
    .split('&')
    .reduce((obj, param) => {
      const [key, value] = param.split('=');
      if (key !== '') {
        obj[key] = value;
      }
      return obj;
    }, {});
}

/**
 * Check whether an object is a real object, because essentially, everything
 * is an object in JavaScript.
 *
 * @param {object} obj - The object to validate.
 * @returns {boolean} True if the given object is a real object.
 */
function isObject(obj) {
  return obj !== null && typeof obj === 'object' && !Array.isArray(obj);
}

/**
 * Check whether a given object contains specific keys.
 *
 * @param {object} obj - The object to check.
 * @param {array} keys - A list of keys the object is required to have.
 * @returns {boolean} True when the object contains all keys specified.
 */
function objectHasKeys(obj, keys) {
  for (let key of keys) {
    if (typeof obj[key] === 'undefined') return false;
  }

  return true;
}

/**
 * Validate the query parameters for this application.
 *
 * @param {object} queryParams - The query parameters object.
 * @returns {boolean} True when the query params passes all validation checks.
 */
function validateQueryParams(queryParams) {
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
 * Check whether a given URL is valid by checking if it starts with https://`
 *
 * @param {string} url - The URL to be checked.
 * @returns {boolean} True when the url is valid.
 */
function isValidUrl(url) {
  return /^https:\/\//g.test(url);
}

/**
 * Get the config from a given URL.
 *
 * @async
 * @param {string} url - The URL that returns a JSON config.
 * @returns {Promise<object>} JSON config
 */
async function getConfig(url) {
  return new Promise((resolve, reject) => {
    fetch(url)
      .then((response) => response.json())
      .then((configData) => {
        if (!objectHasKeys(configData, ['tabs', 'postback'])) {
          reject();
        } else {
          resolve(configData)
        }
      })
      .catch((err) => reject(err));
  });
}
