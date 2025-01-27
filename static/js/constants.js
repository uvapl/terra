/**
 * The prefix for all local storage keys. This will be adjusted once the config
 * is loaded.
 */
Terra.c.DEFAULT_LOCAL_STORAGE_PREFIX = 'terra';
Terra.c.LOCAL_STORAGE_PREFIX = Terra.c.DEFAULT_LOCAL_STORAGE_PREFIX;

/**
 * Sets the default font-size for the upper-right select element.
 */
Terra.c.BASE_FONT_SIZE = 18;

/**
 * The interval time between auto-saves, defined in milliseconds.
 */
Terra.c.AUTOSAVE_INTERVAL = 60 * 1000;

/**
 * To prevent each user will do a POST request for the auto-save at the exact
 * same time, each user will start the app with a time offset between 0 and the
 * AUTOSAVE_START_OFFSET value. After this time, the actual timer will start.
 * The offset is defined in milliseconds.
 */
Terra.c.AUTOSAVE_START_OFFSET = 60 * 1000;

/**
 * Checks whether the current app is the IDE or the embed.
 */
Terra.c.IS_IDE = $('body').hasClass('terra-ide');
Terra.c.IS_IFRAME = $('body').hasClass('terra-embed');

/**
 * Checks whether the current app is running in development mode.
 */
Terra.c.IS_DEV = window.location.hostname === 'localhost';

// The modal's animation duration in milliseconds.
Terra.c.MODAL_ANIM_DURATION = 300;

// The maximum file size in bytes allowed for LFS.
Terra.c.LFS_MAX_FILE_SIZE = 1024 * 1024; // 1MB
