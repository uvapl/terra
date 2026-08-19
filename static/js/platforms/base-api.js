class NotImplemented extends Error {
  constructor(modname, fieldname) {
    super(`${modname}.${fieldname} not implemented.`);
  }
}

/**
 * Base class for API implementations for each programming language worker.
 */
export default class BaseAPI {
  /**
   * Whether to print the command line for this run.
   *
   * @type {boolean}
   */
  echoCmd = true;

  constructor(options) {
    for (const fn of ['hostWrite', 'runUserCodeCallback', 'readyCallback']) {
      if (!(options[fn] instanceof Function)) {
        throw new Error(`Missing required option: ${fn}`);
      }

      this[fn] = options[fn];
    }
  }

  /**
   * Print a command line to the terminal, as a shell would echo it. Does
   * nothing when the user typed the command themselves (see `echoCmd`).
   *
   * @param {string} message - The command to print.
   */
  hostWriteCmd(message) {
    if (!this.echoCmd) return;
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
