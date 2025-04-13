// Create the main terra object.
const Terra = {};

// Contains (temporary) variables that are used throughout all apps where 'v'
// is an abbreviation for 'variables'.
Terra.v = {};

// ===========================================================================
// IDE-only properties.
// ===========================================================================

if ($('body').hasClass('terra-ide')) {
  // Contains timeout handlers.
  Terra.timeoutHandlers = {};
}

export default Terra;
