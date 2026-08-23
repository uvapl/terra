/**
 * Checks whether the current app is the IDE or the embed.
 */
let IS_IDE = null;
let IS_IFRAME = null;

// Checks whether the current app is running in development mode.
let IS_DEV = null;

// The constants may be indirectly imported inside workers, in which there
// is no `window` or `document` available.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const $body = $('body');
  IS_IDE = $body.hasClass('terra-ide');
  IS_IFRAME = $body.hasClass('terra-embed');

  IS_DEV = window.location.hostname === 'localhost';
}

export { IS_DEV, IS_IFRAME, IS_IDE };

/**
 * Sets the default font-size for the upper-right select element.
 */
export const BASE_FONT_SIZE = 16;
export const DEMO_FONT_SIZE = 26;

/**
 * The interval time between auto-saves, defined in milliseconds.
 */
export const AUTOSAVE_INTERVAL = 60 * 1000;

/**
 * To prevent each user will do a POST request for the auto-save at the exact
 * same time, each user will start the app with a time offset between 0 and the
 * AUTOSAVE_START_OFFSET value. After this time, the actual timer will start.
 * The offset is defined in milliseconds.
 */
export const AUTOSAVE_START_OFFSET = 60 * 1000;

// The maximum file size in bytes allowed for files.
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Allowed URLs for git connections in the IDE.
export const GITHUB_URL_PATTERN = /^https:\/\/github.com\/([\w-]+)\/([\w-]+)(?:\.git)?/;

/**
 * Files and folders left out of every listing.
 *
 * The flag `tracked: false` marks something that is not managed by Terra,
 * and then fully ignored. Otherwise, the file is hidden but still readable,
 * moveable, etc.
 *
 * A rule matches a single path segment by exact `name`, by `suffix`, or by
 * `pattern` (a RegExp source).
 */
export const IGNORED_PATHS = [
  ...[
    'site-packages', // when user folder has python virtual env
    '__pycache__', // Python cache directory
    '.mypy_cache', // Mypy cache directory
    '.venv',
    'venv',
    'env', // virtual environment
    '.DS_Store', // Macos metadata file
    'dist',
    'build',  // compiled assets for various languages
    'coverage',
    '.nyc_output', // code coverage reports
    '.git',  // Git directory
    'node_modules', // NodeJS projects
    'default.profraw',
  ].map((name) => ({ name, tracked: false })),

  // Written by the browser file system API while a save is in progress.
  { suffix: '.crswap', tracked: false },
];
