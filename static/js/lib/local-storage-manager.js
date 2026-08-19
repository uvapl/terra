/**
 * Handles saving to and retrieving from local storage. The app can set
 * a prefix to distinguish settings belonging to different app variants or
 * even different projects within an app.
 */

import { IS_IDE } from '../constants.js';

/**
 * The prefix for all local storage keys. Will be adjusted once the
 * config is loaded.
 */
const defaultLocalStoragePrefix = IS_IDE ? 'terra-ide' : 'terra';
let localStoragePrefix = defaultLocalStoragePrefix;

/**
 * Whether the current prefix is the default prefix.
 *
 * @returns {boolean}
 */
export function isDefaultLocalStoragePrefix() {
  return localStoragePrefix === defaultLocalStoragePrefix;
}

/**
 * Set a given key-value pair in the local storage.
 *
 * @param {string} key
 * @param {string} value
 */
export function setLocalStorageItem(key, value) {
  localStorage.setItem(`${localStoragePrefix}-${key}`, value);
}

/**
 * Get a given key from the local storage.
 *
 * @param {string} key
 * @param {string} defaultValue - returned if the key is not found
 * @returns {*} the requested value
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
 * @param {string} key
 */
export function removeLocalStorageItem(key) {
  localStorage.removeItem(`${localStoragePrefix}-${key}`);
}

/**
 * Set the local storage prefix's additional key.
 *
 * @param {string} additionalKey
 */
export function updateLocalStoragePrefix(additionalKey) {
  localStoragePrefix = `${localStoragePrefix}-${additionalKey}`;
}
