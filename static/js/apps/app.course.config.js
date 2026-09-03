/**
 * Handles the mechanics of the course configuration: reading the connection
 * params from the URL, fetching the config from the course-site, and
 * persisting/restoring the resolved config through local storage.
 *
 * The lab half of a config — where its files and instructions come from — is
 * resolved by lab-source.js.
 */

import {
  isObject,
  isValidUrl,
  makeUrl,
  objectHasKeys,
  parseQueryParams,
} from '../lib/helpers.js';
import {
  isDefaultLocalStoragePrefix,
  setLocalStorageItem,
  getLocalStorageItem,
  updateLocalStoragePrefix,
} from '../lib/local-storage-manager.js';

/**
 * How each page names its storage. Both schemes predate the merge of the exam
 * and lab apps and have to keep addressing the exact same keys: a changed key
 * silently orphans the work a student has stored under the old one. That is
 * also why the exam prefix lacks the `exam-` its VFS folder has — an
 * inconsistency worth preserving over fixing.
 */
const SCHEMES = {
  exam: {
    pointerKey: 'last-used',
    storageKey: (slug) => slug,
    vfsFolder: (slug) => `exam-${slug}`,
  },
  lab: {
    pointerKey: 'last-used-lab',
    storageKey: (slug) => `lab-${slug}`,
    vfsFolder: (slug) => `lab-${slug}`,
  },
};

/**
 * Validate whether the given object is a config as served by a course-site.
 *
 * A config has to name at least one source for its content: `tabs` for the
 * files themselves, or `lab_url` for a lab to take them from.
 *
 * @param {object} config - The config object to validate.
 * @returns {boolean} True when the given object is a valid config object.
 */
export function isValidServerConfig(config) {
  return isObject(config)
    && typeof config.postback === 'string'
    && (isObject(config.tabs) || typeof config.lab_url === 'string');
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
 * Fetch the config from the course-site.
 *
 * @async
 * @param {string} configUrl - The URL that returns a JSON config.
 * @param {string} code - Unique user code, sent along for verification.
 * @returns {Promise<object>} The JSON config object.
 */
export async function fetchServerConfig(configUrl, code) {
  const response = await fetch(makeUrl(configUrl, { code }));
  const configData = await response.json();

  if (!isValidServerConfig(configData)) {
    throw new Error('Invalid config received from server');
  }

  return configData;
}

/**
 * The VFS folder holding the files of the session identified by the slug.
 *
 * @param {string} scheme - The page's storage scheme, 'exam' or 'lab'.
 * @param {string} slug - The slug identifying the session.
 * @returns {string} The VFS base folder.
 */
export function vfsFolder(scheme, slug) {
  return SCHEMES[scheme].vfsFolder(slug);
}

/**
 * Point local storage at the prefix for the given slug and remember that
 * prefix for subsequent visits.
 *
 * @param {string} scheme - The page's storage scheme, 'exam' or 'lab'.
 * @param {string} slug - The slug identifying the session.
 */
export function selectConfigStorage(scheme, slug) {
  const storageKey = SCHEMES[scheme].storageKey(slug);

  // Written before the prefix moves, so the pointer stays under the default
  // prefix where loadStoredConfig() can find it again.
  setLocalStorageItem(SCHEMES[scheme].pointerKey, storageKey);
  updateLocalStoragePrefix(storageKey);
}

/**
 * Persist the given config in local storage.
 *
 * The file contents in `tabs` are left out: they live in the VFS, and a second
 * copy here would only go stale the moment the student types. Their names are
 * kept, because they are the tab list when a session boots from storage.
 *
 * @param {object} config - The config object to store.
 */
export function saveConfig(config) {
  const stored = { ...config };

  if (isObject(config.tabs)) {
    stored.tabs = Object.fromEntries(Object.keys(config.tabs).map((name) => [name, '']));
  }

  setLocalStorageItem('config', JSON.stringify(stored));
}

/**
 * Load the most recently used config from local storage, restoring its local
 * storage prefix if needed.
 *
 * @param {string} scheme - The page's storage scheme, 'exam' or 'lab'.
 * @returns {object|null} The stored config object, or null when absent.
 */
export function loadStoredConfig(scheme) {
  // This should only update the local storage prefix if it's
  // not the default prefix.
  if (isDefaultLocalStoragePrefix()) {
    const storageKey = getLocalStorageItem(SCHEMES[scheme].pointerKey);

    if (storageKey) {
      updateLocalStoragePrefix(storageKey);
    }
  }

  return JSON.parse(getLocalStorageItem('config'));
}
