class Debouncer {
  /**
   * @type {object<string, number>}
   */
  timeoutHandlers = {};

  /**
   * Debounce a callback based on an ID.
   *
   * @param {string} id - Some unique identifier (e.g., uuidv4).
   * @param {number} timeout - The amount of time in ms to wait.
   * @param {function} callback - Callback function to invoke.
   */
  debounce(id, timeout, callback) {
    if (typeof this.timeoutHandlers[id] !== 'undefined') {
      clearTimeout(this.timeoutHandlers[id]);
    }

    this.timeoutHandlers[id] = setTimeout(() => {
      callback();
      clearTimeout(this.timeoutHandlers[id]);
      delete this.timeoutHandlers[id];
    }, timeout);
  }
}

export default new Debouncer();
