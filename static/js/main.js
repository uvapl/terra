((window, document) => {
  main();

  // Update font-size for all components on change.
  $('.font-size').change((event) => {
    const newFontSize = parseInt(event.target.value);
    layout.root.contentItems[0].contentItems.forEach((contentItem) => {
      contentItem.contentItems.forEach((item) => {
        item.container.emit('fontSizeChanged', newFontSize);
      })
    });
    setLocalStorageItem('font-size', newFontSize);
  });

  // ===========================================================================
  // Functions
  // ===========================================================================

  async function main() {
    const queryParams = parseQueryParams();
    if (!validateQueryParams(queryParams)) {
      alert('Application failed to bootstrap');
      console.error('Invalid query params');
      return;
    }

    const { url: configUrl, id } = queryParams;

    // Collect the configuration
    let config;
    try {
      config = await getConfig(configUrl);
    } catch (err) {
      console.error('Failed to get config:', err);
    }

    // Get the font-size stored in local storage or use fallback value.
    const fontSize = getLocalStorageItem('font-size', BASE_FONT_SIZE);

    // Create the content items.
    const content = generateConfigContent(config.tabs, fontSize);

    // Create the layout object.
    const layout = createLayout(content, fontSize);

    // Call the init function that creates all components.
    layout.init();
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

    return new Layout({
      configKey: `${LOCAL_STORAGE_PREFIX}-layout`,
      defaultLayoutConfig,
    });
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

        obj[key] = value;
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
    if (!isObject(queryParams) || !objectHasKeys(queryParams, ['url', 'id'])) {
      return false;
    }

    // At this point, we know we have a 'url' and 'id' param.
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

})(window, document);
