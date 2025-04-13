// Create the main terra object.
const Terra = {};

// Contains (temporary) variables that are used throughout all apps where 'v'
// is an abbreviation for 'variables'.
Terra.v = {};

// ===========================================================================
// IDE-only properties.
// ===========================================================================

if ($('body').hasClass('terra-ide')) {
  // Reference to the git filesystem if loaded.
  Terra.gitfs = null;

  // Contains timeout handlers.
  Terra.timeoutHandlers = {};
}

export default Terra;
