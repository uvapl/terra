/**
 * Queue that allows scheduling tasks to be executed sequentially.
 */
export default class TaskQueue {
  /**
   * The name of the queue that appears in the logs.
   * @type {string}
   */
  name = null;

  /**
   * The queue that holds the scheduled tasks.
   * @type {Function[]}
   */
  queue = null;

  constructor(name) {
    this.name = name;
    this.queue = [];
    this.isProcessing = false;
  }

  /**
   * Schedule a task to be executed.
   *
   * @param {Function} taskFn - The function to be executed.
   */
  schedule(taskFn) {
    this.queue.push(taskFn);
    this._processQueue();
  }

  _info(...args) {
    console.info(`[QUEUE::${this.name}]`, ...args);
  }

  _error(...args) {
    console.error(`[QUEUE::${this.name}]`, ...args);
  }

  async _processQueue() {
    if (this.isProcessing) return;

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift();

      if (this.queue.length > 0) {
        this._info(`Processing task (${this.queue.length} remaining)`);
      } else {
        this._info(`Processing task`);
      }

      try {
        await task();
      } catch (err) {
        this._error("Task failed:", err);
      }
    }

    this.isProcessing = false;
  }
}
