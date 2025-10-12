/**
 * Handles anything regarding the local storage saving and retrieval.
 */

import { IS_IDE } from './constants.js';



/**
 * The prefix for all local storage keys. will be adjusted once the
 * config is loaded.
 */
const defaultLocalStoragePrefix = IS_IDE ? 'terra-ide' : 'terra';
let localStoragePrefix = defaultLocalStoragePrefix;

/**
 * Checks whether the current prefix is the default prefix.
 *
 * @returns {bool} True if the current prefix is the default prefix.
 */
export function isDefaultPrefix() {
  return localStoragePrefix === defaultLocalStoragePrefix;
}

/**
 * Set a given key and value in the local storage.
 *
 * @param {string} key - The key to be used.
 * @param {string} value - The value to set under the given key.
 */
export function setLocalStorageItem(key, value) {
  localStorage.setItem(`${localStoragePrefix}-${key}`, value);
}

/**
 * Get a given key from the local storage.
 *
 * @param {string} key - The key to look for.
 * @param {string} defaultValue - The default value to return if the key is not found.
 * @returns {*} The value from the local storage or the default value.
 */
export function getLocalStorageItem(key, defaultValue) {
  const value = localStorage.getItem(`${localStoragePrefix}-${key}`);
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
export function removeLocalStorageItem(key) {
  localStorage.removeItem(`${localStoragePrefix}-${key}`);
}

/**
 * Update the local storage prefix with an additional key.
 *
 * @param {string} additionalKey - An additional prefix that will be appended to
 * the current local storage prefix.
 */
export function updateLocalStoragePrefix(additionalKey) {
  localStoragePrefix = `${localStoragePrefix}-${additionalKey}`;
}
