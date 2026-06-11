/**
 * Handles the mechanics of the exam configuration: reading it from the URL
 * query params, fetching it from the exam server and persisting/restoring it
 * through local storage.
 */

import {
  isObject,
  isValidUrl,
  makeUrl,
  objectHasKeys,
  parseQueryParams,
  slugify,
} from './helpers/shared.js';
import {
  isDefaultLocalStoragePrefix,
  setLocalStorageItem,
  getLocalStorageItem,
  updateLocalStoragePrefix,
} from './local-storage-manager.js';

/**
 * Validate whether the given config object is valid.
 *
 * @param {object} config - The config object to validate.
 * @returns {boolean} True when the given object is a valid config object.
 */
export function isValidConfig(config) {
  return isObject(config) && objectHasKeys(config, ['tabs', 'postback']);
}

/**
 * Get the config params from the current URL's query params.
 *
 * @returns {object|null} The `{ url, code }` params when present and valid,
 * otherwise null.
 */
export function getConfigUrlParams() {
  const queryParams = parseQueryParams();
  if (!isObject(queryParams) || !objectHasKeys(queryParams, ['url', 'code'])) {
    return null;
  }

  // At this point, we know we have a 'url' and 'code' param.
  const configUrl = window.decodeURI(queryParams.url);
  if (!isValidUrl(configUrl)) {
    console.error('Invalid config URL');
    return null;
  }

  return queryParams;
}

/**
 * Fetch the config from the exam server.
 *
 * @async
 * @param {string} configUrl - The URL that returns a JSON config.
 * @param {string} code - Unique user code, sent along for verification.
 * @returns {Promise<object>} The JSON config object.
 */
export async function fetchConfig(configUrl, code) {
  const response = await fetch(makeUrl(configUrl, { code }));
  const configData = await response.json();

  if (!isValidConfig(configData)) {
    throw new Error('Invalid config received from server');
  }

  return configData;
}

/**
 * Derive the slug that identifies an exam, based on its config URL. Used for
 * the exam-specific local storage prefix and VFS folder.
 *
 * @param {string} configUrl - The URL the config was fetched from.
 * @returns {string} The exam slug.
 */
export function examSlug(configUrl) {
  return slugify(configUrl);
}

/**
 * Point local storage at the exam-specific prefix derived from the config URL
 * and remember that prefix for subsequent visits.
 *
 * @param {string} configUrl - The URL the config was fetched from.
 */
export function selectConfigStorage(configUrl) {
  const storageKey = examSlug(configUrl);
  setLocalStorageItem('last-used', storageKey);
  updateLocalStoragePrefix(storageKey);
}

/**
 * Persist the given config in local storage.
 *
 * @param {object} config - The config object to store.
 */
export function saveConfig(config) {
  setLocalStorageItem('config', JSON.stringify(config));
}

/**
 * Load the most recently used config from local storage, restoring the
 * exam-specific local storage prefix if needed.
 *
 * @returns {object|null} The stored config object, or null when absent.
 */
export function loadStoredConfig() {
  // This should only update the local storage prefix if it's
  // not the default prefix.
  if (isDefaultLocalStoragePrefix()) {
    const storageKey = getLocalStorageItem('last-used');

    if (storageKey) {
      updateLocalStoragePrefix(storageKey);
    }
  }

  return JSON.parse(getLocalStorageItem('config'));
}
