/**
 * Create a scheduler that can manage multiple scheduled function calls.
 *
 * A schedule is debounced: scheduling again under the same ID replaces the
 * earlier call and restarts the wait, so a repeated caller (e.g. one call per
 * keystroke) yields a single run.
 *
 * @returns {object} The scheduler's methods.
 */
export function createScheduler() {
  /** @type {Map<string, { timer: number, callback: function }>} */
  const scheduled = new Map();

  /**
   * Schedule a callback to run once the delay has passed.
   *
   * @param {string} id - Identifier of the call.
   * @param {number} delay - The amount of time in ms to wait.
   * @param {function} callback - Callback function to invoke.
   */
  const schedule = (id, delay, callback) => {
    cancel(id);

    const timer = setTimeout(() => {
      scheduled.delete(id);
      callback();
    }, delay);

    scheduled.set(id, { timer, callback });
  };

  /**
   * Drop a scheduled call without running its callback.
   *
   * @param {string} id - Identifier of the call.
   * @returns {boolean} Whether a call was scheduled.
   */
  const cancel = (id) => {
    const entry = scheduled.get(id);
    if (!entry) return false;

    clearTimeout(entry.timer);
    scheduled.delete(id);
    return true;
  };

  /**
   * Run a scheduled call right now, without waiting out its delay.
   *
   * @param {string} id - Identifier of the call.
   * @returns {*} The callback's return value, or undefined when nothing was
   * scheduled, allowing an async callback to be awaited.
   */
  const runNow = (id) => {
    const entry = scheduled.get(id);
    if (!entry) return undefined;

    clearTimeout(entry.timer);
    scheduled.delete(id);
    return entry.callback();
  };

  /**
   * Run every scheduled call right now.
   *
   * @returns {Promise<void>} Resolves once all callbacks have completed.
   */
  const runAllNow = async () => {
    await Promise.all([...scheduled.keys()].map(runNow));
  };

  /** Drop every scheduled call without running its callback. */
  const cancelAll = () => {
    for (const { timer } of scheduled.values()) {
      clearTimeout(timer);
    }
    scheduled.clear();
  };

  /**
   * Whether a call is scheduled under an ID.
   *
   * @param {string} id - Identifier of the call.
   * @returns {boolean}
   */
  const isScheduled = (id) => scheduled.has(id);

  return { schedule, cancel, runNow, runAllNow, cancelAll, isScheduled };
}
