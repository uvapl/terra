import { IS_IDE } from '../constants.js';
import LFS from '../lfs.js';
import GitFS from '../gitfs.js';
import Terra from '../terra.js';

/**
 * Check whether an object is a real object, because essentially, everything
 * is an object in JavaScript.
 *
 * @param {object} obj - The object to validate.
 * @returns {boolean} True if the given object is a real object.
 */
export function isObject(obj) {
  return obj !== null && typeof obj === 'object' && !Array.isArray(obj);
}

/**
 * Deep merge two objects together.
 *
 * @param {object} target
 * @param {object} source
 * @returns {object} A new object with the merged properties.
 */
export function mergeObjects(target, source) {
  // If both are arrays, merge them by index
  if (Array.isArray(target) && Array.isArray(source)) {
    source.forEach((item, index) => {
      if (target[index] === undefined) {
        target[index] = item;
      } else {
        target[index] = mergeObjects(target[index], item);
      }
    });
  } else if (source && typeof source === 'object' && !Array.isArray(source)) {
    // If source is an object, merge its properties
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object') {
        // Recursively merge nested objects or arrays
        target[key] = mergeObjects(target[key] || (Array.isArray(source[key]) ? [] : {}), source[key]);
      } else {
        target[key] = source[key];
      }
    }
  } else {
    // If it's neither an object nor array, just set the value
    target = source;
  }
  return target;
}

/**
 * Prefix the given number with a zero if below 10.
 *
 * @param {string|number} num - The number to be prefixed.
 * @returns {string|number} Returns the original if above 10, otherwise it will
 * return a string prefixed with a zero.
 */
export function prefixZero(num) {
  return num < 10 ? '0' + num : num;
}

/**
 * Format a given date object to a human-readable format.
 *
 * @param {Date} date - The date object to use.
 * @returns {string} Formatted string in human-readable format.
 */
export function formatDate(date) {
  const hours = prefixZero(date.getHours());
  const minutes = prefixZero(date.getMinutes());
  return hours + ':' + minutes;
}

/**
 * Parse the query parameters from the window.location.search.
 *
 * @returns {object} A key-value object with all the query params.
 */
export function parseQueryParams() {
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
export function objectHasKeys(obj, keys) {
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
export function isValidUrl(url) {
  return /^https:?\/\//g.test(url);
}

/**
 * Generate a random integer between a lower and upper bound, both inclusive.
 *
 * @param {number} lower - The lower bound.
 * @param {number} upper - The uppper bound.
 * @returns {number} Random integer between the specified bounds.
 */
export function getRandNumBetween(lower, upper) {
  return Math.floor(Math.random() * (upper - lower + 1)) + lower;
}

/**
 * Check whether the current user OS is Mac.
 *
 * @returns {boolean} True when the system is detected as a Mac-like system.
 */
export function isMac() {
  return /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform);
}

/**
 * Make a url with a given query params object.
 *
 * @param {string} url - The URL where the query params will be appended to.
 * @param {object} queryParams - The params that will be converted to the URL.
 * @returns {string} A concatenation of the URL and query params.
 */
export function makeUrl(url, queryParams) {
  const query = Object.keys(queryParams)
    .reduce((query, key) => query.concat(`${key}=${queryParams[key]}`), [])
    .join('&');

  return `${url}?${query}`;
}

/**
 * Generate a string of HTML attributes.
 *
 * @example makeHtmlAttrs({ id: 'my-id', class: 'my-class' }) -> 'id="my-id" class="my-class"'
 *
 * @param {object} attrs - The attributes to be converted to a string.
 */
export function makeHtmlAttrs(attrs) {
  return Object.keys(attrs)
    .map(key => `${key}="${attrs[key]}"`)
    .join(' ');
}

/**
 * Converts a string to be a local storage suitable key by replacing
 * non-suitable characters with a hyphen.
 *
 * @example makeLocalStorageKey('https://example.com') -> 'https-example-com'
 * @example makeLocalStorageKey('FooBar') -> 'foo-bar'
 *
 * @param {string} key - The key to convert.
 * @returns {string} A local storage suitable key.
 */
export function makeLocalStorageKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '-');
}

/**
 * Remove the minimum indent at a given string.
 *
 * @param {string} text - The input string.
 * @returns {str} Modified string with minimum indent removed.
 */
export function removeIndent(text) {
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
export function uuidv4() {
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
export function getFileExtension(filename) {
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
export function addNewLineCharacter(text) {
  return text.replace(/\n?$/g, '\n');
}

/**
 * Convert a given number of seconds to milliseconds.
 *
 * @param {number} secs - The amount of seconds to convert.
 * @returns {number} The amount of seconds in milliseconds.
 */
export function seconds(secs) {
  return 1000 * secs;
}

/**
 * Check whether the GitFS worker has been initialised.
 *
 * @returns {boolean} True if the worker has been initialised, false otherwise.
 */
export function hasGitFSWorker() {
  return IS_IDE && Terra.app.gitfs instanceof GitFS;
}

/**
 * Check whether the browser has support for the Local Filesystem API.
 *
 * @returns {boolean} True if the browser supports the api.
 */
export function hasLFSApi() {
  return 'showOpenFilePicker' in window;
}

/**
 * Get the repo name and username of a given repo link.
 *
 * @example getRepoName('https://github.com/<user>/<repo>')
 *   => { user: '<user>', repo: '<repo>' }
 *
 * @param {string} repoLink - Absolute link to the repository.
 */
export function getRepoInfo(repoLink) {
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
export function isValidFilename(filename) {
  return !/[\/\\:*?"<>|]/.test(filename) && !['&lt;', '&gt;'].includes(filename);
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
export function registerTimeoutHandler(id, timeout, callback) {
  if (!isObject(Terra.timeoutHandlers)) {
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

/**
 * Creates a mixin that adds event target functionality to a class.
 *
 * @param {class} base - The base class where the mixin will be applied to.
 * @returns {EventTargetMixin} New class with event target functionality.
 */
export function eventTargetMixin(base) {
  class EventTargetMixin extends base {
    constructor(...args) {
      super(...args);
      this._eventTarget = new EventTarget();
    }

    addEventListener(...args) {
      this._eventTarget.addEventListener(...args);
    }

    removeEventListener(...args) {
      this._eventTarget.removeEventListener(...args);
    }

    dispatchEvent(...args) {
      return this._eventTarget.dispatchEvent(...args);
    }
  }

  return EventTargetMixin;
}
