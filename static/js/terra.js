// Create the main terra object.
const Terra = {};

// Contains (temporary) variables that are used throughout all apps where 'v'
// is an abbreviation for 'variables'.
Terra.v = {};

// Reference to the language worker API class instance.
Terra.langWorkerApi = null;

// ===========================================================================
// IDE-only properties.
// ===========================================================================

if ($('body').hasClass('terra-ide')) {
  // Reference to the local filesystem if loaded.
  // Terra.lfs = null;

  // Reference to the virtual filesystem if loaded.
  // Terra.vfs = null;

  // Reference to the git filesystem if loaded.
  Terra.gitfs = null;

  // Contains timeout handlers.
  Terra.timeoutHandlers = {};
}

export default Terra;
