////////////////////////////////////////////////////////////////////////////////
// This file is the main entry point for the iframe-embedded app.
////////////////////////////////////////////////////////////////////////////////

// ===========================================================================
// Here's the start of the application.
// ===========================================================================

// After the app has initialized (config loaded, components loaded) we want to
// call additional functions.
initApp().then(({ layout, config }) => {
  console.log('Successfully bootstrapped app');
}).catch((err) => {
  console.error('Failed to bootstrap app:', err);
});

