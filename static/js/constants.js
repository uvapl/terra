/**
 * Checks whether the current app is the IDE or the embed.
 */
export const IS_IDE = $('body').hasClass('terra-ide');
export const IS_IFRAME = $('body').hasClass('terra-embed');

/**
 * Sets the default font-size for the upper-right select element.
 */
export const BASE_FONT_SIZE = 18;

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

/**
 * Checks whether the current app is running in development mode.
 */
export const IS_DEV = window.location.hostname === 'localhost';

// The modal's animation duration in milliseconds.
export const MODAL_ANIM_DURATION = 300;

// The maximum file size in bytes allowed for LFS.
export const LFS_MAX_FILE_SIZE = 1024 * 1024; // 1MB
