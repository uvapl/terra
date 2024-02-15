// ===========================================================================
// Here's the start of the application.
// ===========================================================================

// After the app has initialized (config loaded, components loaded) we want to
// call additional functions.
initApp().then(({ layout, config }) => {
  window._layout = layout;
  window._editorIsDirty = false;

  registerEventListeners();
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
 * Register auto-save by calling the auto-save function every X seconds.
 *
 * @param {string} url - The endpoint URL where the files will be submitted to.
 * @param {string} uuid - Unique user ID that the POST request needs for
 *                        verification purposes.
 */
function registerAutoSave(url, uuid) {
  setInterval(async () => {
    // Explicitly use a try-catch to make sure this auto-save never stops.
    try {
      if (window._editorIsDirty) {
        // Save the editor content.
        await doAutoSave(url, uuid);

        // Reset the dirty flag as the response is successful at this point.
        window._editorIsDirty = false;

        // Update the last saved timestamp in the UI.
        updateLastSaved();
      }
    } catch (err) {
      console.error('Auto-save failed:', err);
    }
  }, AUTOSAVE_INTERVAL);
}

/**
 * Update the last saved timestamp in the UI.
 */
function updateLastSaved() {
  const d = new Date();
  const hours = d.getHours() < 10 ? '0' + d.getHours() : d.getHours();
  const minutes = d.getMinutes() < 10 ? '0' + d.getMinutes() : d.getMinutes();


  $('.last-saved').html('Last saved: ' + hours + ':' + minutes);
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

  // Go through each tab and create a Blob to be appended to the form data.
  editorComponent.contentItems.forEach((contentItem) => {
    const filename = contentItem.config.title;
    const fileContent = contentItem.container.getState().value;
    const blob = new Blob([fileContent], { type: 'text/plain' });
    formData.append(`files[${filename}]`, blob, filename);
  });

  return fetch(url, { method: 'POST', body: formData, });
}

/**
 * Load the config through query params with a fallback on the local storage.
 *
 * @returns {Promise<object>} The configuration for the app.
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
        setLocalStorageItem('config', JSON.stringify(config));

        // Remove query params from the URL.
        history.replaceState({}, null, window.location.origin + window.location.pathname);
      } catch (err) {
        console.error('Failed to fetch config:', err);
        return;
      }
    } else {
      // Fallback on local storage.
      config = JSON.parse(getLocalStorageItem('config', {}));
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
 * Register all event listeners for the application.
 */
function registerEventListeners() {
  // Update font-size for all components on change.
  $('.font-size').change((event) => {
    const newFontSize = parseInt(event.target.value);
    window._layout.root.contentItems[0].contentItems.forEach((contentItem) => {
      contentItem.contentItems.forEach((item) => {
        item.container.emit('fontSizeChanged', newFontSize);
      })
    });
    setLocalStorageItem('font-size', newFontSize);
  });
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
