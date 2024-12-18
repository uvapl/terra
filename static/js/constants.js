/**
 * The prefix for all local storage keys. This will be adjusted once the config
 * is loaded.
 */
const DEFAULT_LOCAL_STORAGE_PREFIX = 'terra';
let LOCAL_STORAGE_PREFIX = DEFAULT_LOCAL_STORAGE_PREFIX;

/**
 * Sets the default font-size for the upper-right select element.
 */
const BASE_FONT_SIZE = 18;

/**
 * The interval time between auto-saves, defined in milliseconds.
 */
const AUTOSAVE_INTERVAL = 60 * 1000;

/**
 * To prevent each user will do a POST request for the auto-save at the exact
 * same time, each user will start the app with a time offset between 0 and the
 * AUTOSAVE_START_OFFSET value. After this time, the actual timer will start.
 * The offset is defined in milliseconds.
 */
const AUTOSAVE_START_OFFSET = 60 * 1000;

/**
 * Checks whether the current app is the IDE or the embed.
 */
const isIDE = $('body').hasClass('terra-ide');
const isIframe = $('body').hasClass('terra-embed');

/**
 * Checks whether the current app is running in development mode.
 */
const isDev = window.location.hostname === 'localhost';

// The modal's animation duration in milliseconds.
const MODAL_ANIM_DURATION = 300;

// The maximum file size in bytes allowed for LFS.
const LFS_MAX_FILE_SIZE = 1024 * 1024; // 1MB
