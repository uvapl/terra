////////////////////////////////////////////////////////////////////////////////
// This file is the main entry point for the IDE app.
////////////////////////////////////////////////////////////////////////////////

// ===========================================================================
// Here's the start of the application.
// ===========================================================================

initApp().then(({ layout }) => {
  // Fetch the repo files or the local storage files (vfs) otherwise.
  const repoLink = getLocalStorageItem('connected-repo');
  if (repoLink) {
    createGitFSWorker();
  } else {
    createFileTree();
  }

  if (hasLFSApi()) {
    // Enable code for local filesystem.
    $('body').append('<script src="static/js/lfs.js"></script>');
  } else {
    // Disable open-folder if the FileSystemAPI is not supported.
    $('#menu-item--open-folder').remove();
  }

  if (!repoLink && !hasLFSApi()) {
    showLocalStorageWarning();
  }

  $(window).resize();
}).catch((err) => {
  console.error('Failed to bootstrap IDE app:', err);
});

// ===========================================================================
// Functions
// ===========================================================================

/**
 * Initialise the app by loading the config and create the layout.
 *
 * @returns {Promise<{ layout: Layout }>} Object containing the layout instance.
 */
function initApp() {
  return new Promise((resolve) => {
    // Create the layout object.
    const layout = createLayout();

    // Call the init function that creates all components.
    layout.init();

    // Make layout instance available at all times.
    window._layout = layout;

    // Use timeout trick to make sure layout.root exists.
    setTimeout(() => {
      resolve({ layout });
    }, 10);
  });
}


/**
 * Create the layout object with the given content objects and font-size.
 *
 * @returns {Layout} The layout instance.
 */
function createLayout() {
  const defaultLayoutConfig = {
    settings: {
      showCloseIcon: false,
      showPopoutIcon: false,
      showMaximiseIcon: true,
      reorderEnabled: true,
    },
    dimensions: {
      headerHeight: 30,
      borderWidth: 10,
    },
    content: [
      {
        type: 'column',
        content: [
          {
            type: 'stack',
            content: [
              {
                type: 'component',
                componentName: 'editor',
                componentState: {
                  fontSize: BASE_FONT_SIZE,
                },
                title: 'Untitled',
              },
            ],
          },
          {
            type: 'component',
            componentName: 'terminal',
            componentState: { fontSize: BASE_FONT_SIZE },
            isClosable: false,
          }
        ]
      }
    ]
  };

  return new LayoutIDE(defaultLayoutConfig);
}
