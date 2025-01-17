// Create the main terra object.
const Terra = {};

// Contains constants that are used throughout all apps where 'c' is an
// abbrevation for 'constants'.
Terra.c = {};

// Contains (temporary) variables that are used throughout all apps where 'v'
// is an abbreviation for 'variables'.
Terra.v = {};

// Contains all global (helper) functions that are used throughout all apps
// where 'f' is an abbreviation for 'functions'.
Terra.f = {};

// Reference to the GoldenLayout instance.
Terra.layout = null;

// Reference to the language worker API class instance.
Terra.langWorkerApi = null;

// ===========================================================================
// IDE-only properties.
// ===========================================================================

// Reference to the local filesystem if loaded.
Terra.lfs = null;

// Reference to the virtual filesystem if loaded.
Terra.vfs = null;

// Reference to the git filesystem class instance if loaded.
Terra.gitfs = null;

// Reference to the filetree instance if loaded.
Terra.filetree = null;

// Contains timeout handlers.
Terra.timeoutHandlers = {};

// Contains a reference to the plugin manager.
Terra.pluginManager = null;
