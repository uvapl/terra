/**
 * Set a given key and value in the local storage.
 *
 * @param {[TODO:type]} key - [TODO:description]
 * @param {[TODO:type]} value - [TODO:description]
 */
function setLocalStorageItem(key, value) {
  localStorage.setItem(`${LOCAL_STORAGE_PREFIX}-${key}`, value);
}

/**
 * Get a given key from the local storage.
 *
 * @param {string} key - The key to get from the local storage.
 * @param {string} defaultValue - The default value to return if the key is not found.
 * @returns {*} The value from the local storage or the default value.
 */
function getLocalStorageItem(key, defaultValue) {
  const value = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}-${key}`);
  return typeof value === 'undefined' && typeof defaultValue !== 'undefined' ? defaultValue : value;
}
