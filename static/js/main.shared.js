////////////////////////////////////////////////////////////////////////////////
// This file contains functions that are used inside all main.*.js files.
////////////////////////////////////////////////////////////////////////////////

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
        // Get the programming language based on tabs filename.
        const proglang = Object.keys(config.tabs)[0].split('.').pop();

        // Initialise the programming language specific worker API.
        window._workerApi = new WorkerAPI(proglang);

        // Get the font-size stored in local storage or use fallback value.
        const fontSize = getLocalStorageItem('font-size', BASE_FONT_SIZE);

        // Create the content objects that represent each tab in the editor.
        const content = generateConfigContent(config.tabs, fontSize);

        // Create the layout object.
        const layout = createLayout(content, proglang, fontSize, config.buttons);

        // Call the init function that creates all components.
        layout.init();

        // Make layout instance available at all times.
        window._layout = layout;

        resolve({ layout, config });
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
        config = await getConfig(makeUrl(queryParams.url, { code: queryParams.code }));
        config.code = queryParams.code;
        config.configUrl = queryParams.url;

        const currentStorageKey = makeLocalStorageKey(config.configUrl);
        setLocalStorageItem('last-used', currentStorageKey);
        updateLocalStoragePrefix(currentStorageKey);
        setLocalStorageItem('config', JSON.stringify(config));

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
      if (LOCAL_STORAGE_PREFIX === DEFAULT_LOCAL_STORAGE_PREFIX) {
        const currentStorageKey = getLocalStorageItem('last-used');

        if (currentStorageKey) {
          updateLocalStoragePrefix(currentStorageKey);
        } else if (!migrateOldLocalStorageKeys()) {
          reject('Last-used local storage key not available and failed to migrate old keys.');
        }
      }

      const localConfig = JSON.parse(getLocalStorageItem('config'));

      // Check immediately if the server is reachable by retrieving the
      // config again. If it is reachable, use the localConfig as the actual
      // config, otherwise notify the user that we failed to connect.
      try {
        const newConfig = await getConfig(makeUrl(localConfig.configUrl, { code: localConfig.code }))

        // While we fallback on localstorage, we still need to check whether
        // the exam is locked, so we have to update the `locked` property.
        localConfig.locked = newConfig.locked;
        setLocalStorageItem('config', JSON.stringify(localConfig));

        config = localConfig;
        notify('Connected to server', { fadeOutAfterMs: 10 * 1000 });
      } catch (err) {
        console.error('Failed to connect to server:');
        console.error(err);
        notifyError('Failed to connect to server');
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
 * @param {string} proglang - The programming language to be used
 * @param {number} fontSize - The default font-size to be used.
 * @param {object} buttonConfig - Object containing buttons with their
 * commands that will be rendered by the layout.
 * @returns {Layout} The layout instance.
 */
function createLayout(content, proglang, fontSize, buttonConfig) {
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

  return new Layout(proglang, defaultLayoutConfig, buttonConfig);
}

/**
 * Create a list of content objects based on the tabs config data.
 *
 * @param {object} tabs - An object where each key is the filename and the
 * value is the default value the editor should have when the file is opened.
 * @param {number} fontSize - The default font-size used for the content.
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
    reorderEnabled: false,
  }));
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
