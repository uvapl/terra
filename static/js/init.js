// Create the main terra object.
Terra = {
  // Contains constants that are used throughout all apps where 'c' is an
  // abbrevation for 'constants'.
  c: {},

  // Contains (temporary) variables that are used throughout all apps where 'v'
  // is an abbreviation for 'variables'.
  v: {},

  // Contains all global (helper) functions that are used throughout all apps
  // where 'f' is an abbreviation for 'functions'.
  f: {},

  // Contians all plugins that are loaded.
  plugins: {},

  // Reference to the GoldenLayout instance.
  layout: null,

  // Reference to the language worker API class instance.
  langWorkerApi: null,

  // Reference to the virtual file system if loaded (IDE-only).
  vfs: null,

  // Reference to the git filesystem class instance if loaded (IDE-only).
  gitfs: null,

  // Reference to the filetree instance if loaded (IDE-only).
  filetree: null,

  // Contains timeout handlers (IDE-only).
  timeoutHandlers: {},
};
