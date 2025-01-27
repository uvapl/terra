////////////////////////////////////////////////////////////////////////////////
// This file is the main entry point for the iframe-embedded app.
////////////////////////////////////////////////////////////////////////////////

// ===========================================================================
// Here's the start of the application.
// ===========================================================================

initApp().then(({ layout }) => {

  // Listen for the content of the file to be received.
  window.addEventListener('message', function(event) {
    const editor = Terra.f.getActiveEditor().instance.editor;
    editor.setValue(Terra.f.removeIndent(event.data));
    editor.clearSelection();
  });

}).catch((err) => {
  console.error('Failed to bootstrap terra iframe:', err);
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
    const queryParams = Terra.f.parseQueryParams();
    if (!isValidQueryParams(queryParams)) {
      return reject('No filename provided in query params');
    }

    const isHorizontal = queryParams.layout === 'horizontal';
    const isVertical = !isHorizontal;

    // Update local storage key.
    const currentStorageKey = Terra.f.makeLocalStorageKey(window.location.href);
    Terra.f.updateLocalStoragePrefix(currentStorageKey);

    // Create tabs with the filename as key and empty string as the content.
    const tabs = {}
    tabs[queryParams.filename] = '';

    // Get the programming language based on the filename.
    const proglang = Terra.f.getFileExtension(queryParams.filename);

    // Initialise the programming language specific worker API.
    Terra.langWorkerApi = new LangWorkerAPI(proglang);

    // Get the font-size stored in local storage or use fallback value.
    const fontSize = Terra.f.getLocalStorageItem('font-size', Terra.c.BASE_FONT_SIZE);

    // Create the content objects that represent each tab in the editor.
    const content = generateConfigContent(tabs, fontSize);

    // Create the layout object.
    const layout = createLayout(content, fontSize, {
      proglang,
      vertical: isVertical,
    });

    $('body').addClass(isVertical ? 'vertical' : 'horizontal');

    // Make layout instance available at all times.
    Terra.layout = layout;

    // Call the init function that creates all components.
    layout.init();

    // Use timeout trick to make sure layout.root exists.
    setTimeout(() => {
      resolve({ layout });
    }, 10);
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
