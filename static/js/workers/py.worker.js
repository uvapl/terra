self.importScripts('../vendor/pyodide.min.js');

class API {
  pyodide = null;

  constructor(options) {
    this.hostWrite = options.hostWrite;
    this.compileLinkRunCallback = options.compileLinkRunCallback;

    loadPyodide({ indexURL: '../../wasm/py/' }).then((pyodide) => {
      this.pyodide = pyodide;

      // Initialise stdout with some other modules.
      this.pyodide.runPython(`
        import io, sys
        sys.stdout = io.StringIO()
        sys.version.split(' ')[0]
      `);
    });
  }

  hostWriteCmd(message) {
    this.hostWrite(`\$ ${message}\n`);
  }

  async compileLinkRun(data) {
    console.log('data', data);
    const { filename, contents } = data;

    // Reset stdout value.
    this.pyodide.runPython("sys.stdout = io.StringIO()");

    // Run user code.
    this.pyodide.runPython(contents);

    // Get the output.
    const stdout = this.pyodide.runPython("sys.stdout.getvalue()");
    this.hostWrite(stdout);

    if (typeof this.compileLinkRunCallback === 'function') {
      this.compileLinkRunCallback();
    }
  }
}

let api;
let port;

const onAnyMessage = async event => {
  switch (event.data.id) {
    case 'constructor':
      port = event.data.data;
      port.onmessage = onAnyMessage;
      api = new API({
        hostWrite(s) {
          port.postMessage({ id: 'write', data: s });
        },

        compileLinkRunCallback() {
          port.postMessage({ id: 'compileLinkRunCallback' });
        },
      });
      break;

    case 'compileLinkRun':
      await api.compileLinkRun(event.data.data);
      break;
  }
};

self.onmessage = onAnyMessage;
