import { IS_IDE } from './constants.js';

/**
 * Handles anything regarding the local storage saving and retrieval.
 */
class LocalStorageManager {
  /**
   * The prefix for all local storage keys. This will be adjusted once the
   * config is loaded.
   */
  defaultLocalStoragePrefix = IS_IDE ? 'terra-ide' : 'terra';
  localStoragePrefix = this.defaultLocalStoragePrefix;

  /**
   * Checks whether the current prefix is the default prefix.
   *
   * @returns {bool} True if the current prefix is the default prefix.
   */
  isDefaultPrefix = () => {
    return this.localStoragePrefix === this.defaultLocalStoragePrefix;
  }

  /**
   * Set a given key and value in the local storage.
   *
   * @param {string} key - The key to be used.
   * @param {string} value - The value to set under the given key.
   */
  setLocalStorageItem = (key, value) => {
    localStorage.setItem(`${this.localStoragePrefix}-${key}`, value);
  }

  /**
   * Get a given key from the local storage.
   *
   * @param {string} key - The key to look for.
   * @param {string} defaultValue - The default value to return if the key is not found.
   * @returns {*} The value from the local storage or the default value.
   */
  getLocalStorageItem = (key, defaultValue) => {
    const value = localStorage.getItem(`${this.localStoragePrefix}-${key}`);
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
  removeLocalStorageItem = (key) => {
    localStorage.removeItem(`${this.localStoragePrefix}-${key}`);
  }

  /**
   * Update the local storage prefix with an additional key.
   *
   * @param {string} additionalKey - An additional prefix that will be appended to
   * the current local storage prefix.
   */
  updateLocalStoragePrefix = (additionalKey) => {
    this.localStoragePrefix = `${this.localStoragePrefix}-${additionalKey}`;
  }
}

export default new LocalStorageManager();
