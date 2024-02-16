/**
 * The prefix for all local storage keys.
 */
const LOCAL_STORAGE_PREFIX = 'examide';

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
