/**
 * Checks whether the current app is the IDE or the embed.
 */
let IS_IDE = null;
let IS_IFRAME = null;

// Checks whether the current app is running in development mode.
let IS_DEV = null;

// The constants may be indirectly imports inside workers, in which there is no
// `window` or `document` available.
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

// The modal's animation duration in milliseconds.
export const MODAL_ANIM_DURATION = 300;

// The maximum file size in bytes allowed for files.
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
