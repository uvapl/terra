/**
 * Bridge class between the main app and the currently loaded worker.
 */
class WorkerAPI {
  constructor(proglang) {
    this.worker = new Worker(this.getWorkerPath(proglang));
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.onmessage = this.onmessage.bind(this);

    const remotePort = channel.port2;
    this.worker.postMessage({
      id: 'constructor',
      data: remotePort
    }, [remotePort]);
  }

  /**
   * Triggers the `runUserCode` event in the currently active worker.
   *
   * @param {string} activeTabName - The name of the currently active tab.
   * @param {array} files - List of objects, each containing the filename
   * and contents of the corresponding editor tab.
   */
  runUserCode(activeTabName, files) {
    this.port.postMessage({
      id: 'runUserCode',
      data: { activeTabName, files },
    });
  }

  /**
   * Triggers the `runButtonCommand` event in the currently active worker.
   *
   * @param {string} selector - Unique selector for the button, used to disable
   * it when running and disable it when it's done running.
   * @param {string} activeTabName - The name of the currently active tab.
   * @param {array} cmd - List of commands to execute.
   * @param {array} files - List of objects, each containing the filename and
   * contents of the corresponding editor tab.
   */
  runButtonCommand(selector, activeTabName, cmd, files) {
    this.port.postMessage({
      id: 'runButtonCommand',
      data: { selector, activeTabName, cmd, files },
    });
  }

  /**
   * Get the path to the worker file given a programming language.
   *
   * @param {string} proglang - The programming language to get the worker path for.
   * @returns {string} Path to the worker file.
   */
  getWorkerPath(proglang) {
    let name = proglang;

    if (proglang === 'c') {
      name = 'clang';
    }

    return `static/js/workers/${name}.worker.js`;
  }

  /**
   * Message event handler for the worker.
   *
   * @param {object} event - Event object coming from the UI.
   */
  onmessage(event) {
    switch (event.data.id) {
      case 'ready':
        $('.terminal-component-container .lm_header .button').prop('disabled', false);
        break;

      case 'write':
        term.write(event.data.data);
        break;

      case 'runButtonCommandCallback':
        $(event.data.selector).prop('disabled', false);
        break;

      case 'runUserCodeCallback':
        $('#run-code').prop('disabled', false);
        break;
    }
  }
}
