import { seconds } from './shared.js';

/**
 * Queue that allows scheduling tasks to be executed sequentially.
 *
 * Implements the following events:
 * - busy: Emitted when the queue has 4+ items or takes 2+ seconds to process.
 * - done: Emitted when the queue is completely processed.
 */
export default class TaskQueue extends EventTarget {
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

  /**
   * Whether the queue is processing tasks.
   * @type {boolean}
   */
  isProcessing = false;

  // Internal state when the queue has 4+ items or takes 2+ seconds to process.
  _busyEventEmitted = false;
  _busyEventTimeoutId = null;

  constructor(name) {
    super();
    this.name = name;
    this.queue = [];
  }

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
    // There will only be one processing instance at a time, so if already
    // processing, exit early.
    if (this.isProcessing) return;

    // When this part is reached, we know the queue has exactly 1 item.

    this.isProcessing = true;
    this._busyEventEmitted = false;

    // Trigger busy event if the queue is still processing after 2 seconds.
    this._busyEventTimeoutId = setTimeout(() => {
      if (!this._busyEventEmitted) {
        this._emitBusyEvent();
      }
    }, seconds(2));

    // Tasks may be added while processing, so we loop until the queue is empty.
    while (this.queue.length > 0) {
      // If the queue has 4 or more tasks, emit "busy" event.
      if (this.queue.length >= 4 && !this._busyEventEmitted) {
        this._emitBusyEvent();
      }

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

    // Clear the timer and flags once processing is done.
    clearTimeout(this._busyEventTimeoutId);
    this._busyEventTimeoutId = null;
    this._busyEventEmitted = false;
    this.isProcessing = false;

    // Dispatch "done" event to notify that processing is complete.
    this.dispatchEvent(new Event("done"));
  }

  _emitBusyEvent() {
    this._busyEventEmitted = true;
    this.dispatchEvent(new Event("busy"));
    this._info("Heavy load detected");
  }
}
