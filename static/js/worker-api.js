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

  compileLinkRun(filename, contents) {
    this.port.postMessage({
      id: 'compileLinkRun',
      data: { filename, contents },
    });
  }

  runTests(files) {
    this.port.postMessage({
      id: 'runTests',
      data: files,
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
      case 'write':
        term.write(event.data.data);
        break;

      case 'runTestsCallback':
        console.log('runTestsCallback')
        $('#run-tests').prop('disabled', false);
        break;

      case 'compileLinkRunCallback':
        $('#run-code').prop('disabled', false);
        break;
    }
  }
}
