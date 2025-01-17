/**
 * Set a given key and value in the local storage.
 *
 * @param {string} key - The key to be used.
 * @param {string} value - The value to set under the given key.
 */
Terra.f.setLocalStorageItem = (key, value) => {
  localStorage.setItem(`${Terra.c.LOCAL_STORAGE_PREFIX}-${key}`, value);
}

/**
 * Get a given key from the local storage.
 *
 * @param {string} key - The key to look for.
 * @param {string} defaultValue - The default value to return if the key is not found.
 * @returns {*} The value from the local storage or the default value.
 */
Terra.f.getLocalStorageItem = (key, defaultValue) => {
  const value = localStorage.getItem(`${Terra.c.LOCAL_STORAGE_PREFIX}-${key}`);
  if (value === null && typeof defaultValue !== 'undefined') {
    return defaultValue
  }

  if (['true', 'false'].includes(value)) {
    return value === 'true';
  }

  return value;
}

/**
 * Remove a given key from the local storage.
 *
 * @param {string} key - The key to remove.
 */
Terra.f.removeLocalStorageItem = (key) => {
  localStorage.removeItem(`${Terra.c.LOCAL_STORAGE_PREFIX}-${key}`);
}

/**
 * Update the local storage prefix with an additional key.
 *
 * @param {string} additionalKey - An additional prefix that will be appended to
 * the current local storage prefix.
 */
Terra.f.updateLocalStoragePrefix = (additionalKey) => {
  Terra.c.LOCAL_STORAGE_PREFIX = `${Terra.c.LOCAL_STORAGE_PREFIX}-${additionalKey}`;
}

/**
 * Check whether an object is a real object, because essentially, everything
 * is an object in JavaScript.
 *
 * @param {object} obj - The object to validate.
 * @returns {boolean} True if the given object is a real object.
 */
Terra.f.isObject = (obj) => {
  return obj !== null && typeof obj === 'object' && !Array.isArray(obj);
}

/**
 * Prefix the given number with a zero if below 10.
 *
 * @param {string|number} num - The number to be prefixed.
 * @returns {string|number} Returns the original if above 10, otherwise it will
 * return a string prefixed with a zero.
 */
Terra.f.prefixZero = (num) => {
  return num < 10 ? '0' + num : num;
}

/**
 * Format a given date object to a human-readable format.
 *
 * @param {Date} date - The date object to use.
 * @returns {string} Formatted string in human-readable format.
 */
Terra.f.formatDate = (date) => {
  const hours = Terra.f.prefixZero(date.getHours());
  const minutes = Terra.f.prefixZero(date.getMinutes());
  return hours + ':' + minutes;
}

/**
 * Parse the query parameters from the window.location.search.
 *
 * @returns {object} A key-value object with all the query params.
 */
Terra.f.parseQueryParams = () => {
  const queryString = window.location.search.substring(1);
  if (!queryString) return {};

  return queryString
    .split('&')
    .reduce((obj, param) => {
      const [key, value] = param.split('=');
      obj[key] = value;
      return obj;
    }, {});
}

/**
 * Check whether a given object contains specific keys.
 *
 * @param {object} obj - The object to check.
 * @param {array} keys - A list of keys the object is required to have.
 * @returns {boolean} True when the object contains all keys specified.
 */
Terra.f.objectHasKeys = (obj, keys) => {
  for (let key of keys) {
    if (typeof obj[key] === 'undefined') return false;
  }

  return true;
}

/**
 * Check whether a given URL is valid by checking if it starts with either
 * `http://` or `https://`
 *
 * @param {string} url - The URL to be checked.
 * @returns {boolean} True when the url is valid.
 */
Terra.f.isValidUrl = (url) => {
  return /^https:?\/\//g.test(url);
}

/**
 * Generate a random integer between a lower and upper bound, both inclusive.
 *
 * @param {number} lower - The lower bound.
 * @param {number} upper - The uppper bound.
 * @returns {number} Random integer between the specified bounds.
 */
Terra.f.getRandNumBetween = (lower, upper) => {
  return Math.floor(Math.random() * (upper - lower + 1)) + lower;
}

/**
 * Check whether the current user OS is Mac.
 *
 * @returns {boolean} True when the system is detected as a Mac-like system.
 */
Terra.f.isMac = () => {
  return /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform);
}

/**
 * Make a url with a given query params object.
 *
 * @param {string} url - The URL where the query params will be appended to.
 * @param {object} queryParams - The params that will be converted to the URL.
 * @returns {string} A concatenation of the URL and query params.
 */
Terra.f.makeUrl = (url, queryParams) => {
  const query = Object.keys(queryParams)
    .reduce((query, key) => query.concat(`${key}=${queryParams[key]}`), [])
    .join('&');

  return `${url}?${query}`;
}

/**
 * Converts a string to be a local storage suitable key by replacing
 * non-suitable characters with a hyphen.
 *
 * @param {string} key - The key to convert.
 * @returns {string} A local storage suitable key.
 */
Terra.f.makeLocalStorageKey = (key) => {
  return key.replace(/[^0-9a-z]+/g, '-');
}

/**
 * Remove the minimum indent at a given string.
 *
 * @param {string} text - The input string.
 * @returns {str} Modified string with minimum indent removed.
 */
Terra.f.removeIndent = (text) => {
  // Remove leading newlines.
  while (text.startsWith('\n')) {
    text = text.slice(1);
  }

  // Remove trailing newlines.
  text = text.replace(/([\n\s])*$/, '');

  // Get the minimum indentation.
  const indent = text.match(/^[\s\t]*/)[0];

  // Remove minimum indent from each line.
  return text
    .split('\n')
    .map(line => line.replace(new RegExp(`^${indent}`), ''))
    .join('\n');
}

/**
 * Generate a random UUIDv4.
 *
 * @returns {string} The UUID.
 */
Terra.f.uuidv4 = () => {
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
    (+c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> +c / 4).toString(16)
  );
}

/**
 * Get the file extension from a given filename.
 *
 * @param {string} filename - The filename to get the extension from.
 * @returns {string|null} The file extension without the dot, or null if there
 * is no file extension.
 */
Terra.f.getFileExtension = (filename) => {
  return typeof filename === 'string' && filename.includes('.')
    ? filename.split('.').pop()
    : null;
}

/**
 * Adds a new line character at the end of a given text if it doesn't exist.
 *
 * @param {string} text - The text to add the new line character to.
 * @returns {string} Updated text with a new line character at the end.
 */
Terra.f.addNewLineCharacter = (text) => {
  return text.replace(/\n?$/g, '\n');
}

/**
 * Convert a given number of seconds to milliseconds.
 *
 * @param {number} secs - The amount of seconds to convert.
 * @returns {number} The amount of seconds in milliseconds.
 */
Terra.f.seconds = (secs) => {
  return 1000 * secs;
}

/**
 * Check whether the GitFS worker has been initialised.
 *
 * @returns {boolean} True if the worker has been initialised, false otherwise.
 */
Terra.f.hasGitFSWorker = () => {
  return Terra.c.IS_IDE && Terra.gitfs instanceof GitFS;
}

/**
 * Check whether the browser has support for the Local Filesystem API.
 *
 * @returns {boolean} True if the browser supports the api.
 */
Terra.f.hasLFSApi = () => {
  return 'showOpenFilePicker' in window;
}

/**
 * Check whether the LFS has been initialized.
 *
 * @returns {boolean} True when LFS has been initialized, false otherwise.
 */
Terra.f.hasLFS = () => {
  return !['undefined', null].includes(Terra.lfs);
}

/**
 * Set the file tree title.
 *
 * @param {string} title - The title to set.
 */
Terra.f.setFileTreeTitle = (title) => {
  $('#file-tree-title').text(title);
}

/**
 * Get the repo name and username of a given repo link.
 *
 * @example getRepoName('https://github.com/<user>/<repo>')
 *   => { user: '<user>', repo: '<repo>' }
 *
 * @param {string} repoLink - Absolute link to the repository.
 */
Terra.f.getRepoInfo = (repoLink) => {
  if (!repoLink) return null;

  const match = repoLink.match(/^https:\/\/(?:www\.)?github.com\/([^/]+)\/([\w-]+)/);
  if (!match) return null;

  return {
    'user': match[1],
    'repo': match[2],
  }
}

/**
 * Check whether a given filename is valid for a fileystem.
 *
 * @param {string} filename - The filename to check.
 * @returns {boolean} True if the filename is valid, false otherwise.
 */
Terra.f.isValidFilename = (filename) => {
  return !/[\/\\:*?"<>|]/.test(filename) && !['&lt;', '&gt;'].includes(filename);
}

/**
 * Removes the local storage warning from the DOM.
 */
Terra.f.removeLocalStorageWarning = () => {
  $('.file-tree-container').removeClass('localstorage-mode')
  $('#local-storage-warning').remove();
}

/**
 * Add the local storage warning to the DOM.
 */
Terra.f.showLocalStorageWarning = () => {
  if ($('#local-storage-warning').length > 0) return;

  const html = `
    <div id="local-storage-warning" class="local-storage-warning">
      <div class="warning-title">
        <img src="static/img/icons/warning.png" alt="warning icon" class="warning-icon" /> Warning
      </div>
      <p>
        You're currently using temporary browser storage. Clearing website data will
        delete project files and folders permanently.
      </p>
    </div>
  `;

  $('.file-tree-container').addClass('localstorage-mode').append(html);
}

/**
 * Register a timeout handler based on an ID. This is mainly used for
 * files/folders where a user could potentially trigger another file onchange
 * event, while the previous file change of another file hasn't been synced. In
 * that case, it shouldn't overwrite the previous file it's timeout. Therefore,
 * we use this function to register a timeout handler per file/folder.
 *
 * @param {string} id - Some unique identifier, like uuidv4.
 * @param {number} timeout - The amount of time in milliseconds to wait.
 * @param {function} callback - Callback function that will be invoked.
 */
Terra.f.registerTimeoutHandler = (id, timeout, callback) => {
  if (!Terra.f.isObject(Terra.timeoutHandlers)) {
    Terra.timeoutHandlers = {};
  }

  if (typeof Terra.timeoutHandlers[id] !== 'undefined') {
    clearTimeout(Terra.timeoutHandlers[id]);
  }

  Terra.timeoutHandlers[id] = setTimeout(() => {
    callback();
    clearTimeout(Terra.timeoutHandlers[id]);
    delete Terra.timeoutHandlers[id];
  }, timeout);
}
