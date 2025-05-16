class NotImplemented extends Error {
  constructor(modname, fieldname) {
    super(`${modname}.${fieldname} not implemented.`);
  }
}

/**
 * Base class for API implementations for each programming language worker.
 */
export default class BaseAPI {
  constructor(options) {
    for (const fn of ['hostWrite', 'runUserCodeCallback', 'readyCallback']) {
      if (!(options[fn] instanceof Function)) {
        throw new Error(`Missing required option: ${fn}`);
      }

      this[fn] = options[fn];
    }
  }

  /**
   * Write back to the terminal.
   *
   * @param {string} message - The message to print.
   */
  hostWriteCmd(message) {
    this.hostWrite(`\$ ${message}\n`);
  }

  /**
   * Abstract method to compile, link, and run the user's code.
   *
   * @async
   * @throws {NotImplemented} - This method must be implemented by the subclass.
   */
  async runUserCode() {
    throw NotImplemented('BaseAPI', 'runUserCode');
  }
}
