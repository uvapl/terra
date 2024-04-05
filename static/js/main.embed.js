////////////////////////////////////////////////////////////////////////////////
// This file is the main entry point for the iframe-embedded app.
////////////////////////////////////////////////////////////////////////////////

// ===========================================================================
// Here's the start of the application.
// ===========================================================================

initApp().then(({ layout }) => {

  // Listen for the contents of the file to be received.
  window.addEventListener('message', function(event) {
    const editor = getActiveEditor().instance.editor;
    editor.setValue(event.data);
    editor.clearSelection();
  });

}).catch((err) => {
  console.error('Failed to bootstrap examide iframe:', err);
});

// ===========================================================================
// Functions
// ===========================================================================

/**
 * Initialise the app.
 *
 * @returns {Promise<{ layout: Layout }>} Object containing the layout instance.
 */
function initApp() {
  return new Promise((resolve, reject) => {
    const queryParams = parseQueryParams();
    if (!isValidQueryParams(queryParams)) {
      return reject('No filename provided in query params');
    }

    // Update local storage key.
    const currentStorageKey = makeLocalStorageKey(window.location.href);
    updateLocalStoragePrefix(currentStorageKey);

    // Create tabs with the filename as key and empty string as the contents.
    const tabs = {}
    tabs[queryParams.filename] = '';

    // Get the programming language based on the filename.
    const proglang = queryParams.filename.split('.').pop();

    // Initialise the programming language specific worker API.
    window._workerApi = new WorkerAPI(proglang);

    // Get the font-size stored in local storage or use fallback value.
    const fontSize = getLocalStorageItem('font-size', BASE_FONT_SIZE);

    // Create the content objects that represent each tab in the editor.
    const content = generateConfigContent(tabs, fontSize);

    // Create the layout object.
    const layout = createLayout(content, proglang, fontSize, { vertical: true });

    // Call the init function that creates all components.
    layout.init();

    // Make layout instance available at all times.
    window._layout = layout;

    resolve({ layout });
  });
}

/**
 * Validate whether the given query params are valid.
 *
 * @param {object} params - The query params object.
 * @returns {boolean} True if valid, false otherwise.
 */
function isValidQueryParams(params) {
  return typeof params.filename === 'string';
}
