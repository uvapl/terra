/**
 * @type {object<string, number>}
 */
const timeoutHandlers = {};

/**
 * Debounce a callback based on an ID.
 *
 * @param {string} id - Some unique identifier (e.g., uuidv4).
 * @param {number} timeout - The amount of time in ms to wait.
 * @param {function} callback - Callback function to invoke.
 */
export default function debounce(id, timeout, callback) {
  if (typeof timeoutHandlers[id] !== 'undefined') {
    clearTimeout(timeoutHandlers[id]);
  }

  timeoutHandlers[id] = setTimeout(() => {
    callback();
    clearTimeout(timeoutHandlers[id]);
    delete timeoutHandlers[id];
  }, timeout);
}
