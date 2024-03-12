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

  runUserCode(filename, contents) {
    this.port.postMessage({
      id: 'runUserCode',
      data: { filename, contents },
    });
  }

  runButtonCommand(selector, cmd, files) {
    this.port.postMessage({
      id: 'runButtonCommand',
      data: { selector, cmd, files },
    });
  }

  getWorkerPath(proglang) {
    let name = proglang;

    if (proglang === 'c') {
      name = 'clang';
    }

    return `static/js/workers/${name}.worker.js`;
  }

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
