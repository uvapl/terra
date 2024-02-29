self.importScripts('../vendor/pyodide.min.js');
self.importScripts('base-api.js')

class API extends BaseAPI {
  pyodide = null;

  constructor(options) {
    super(options);

    loadPyodide({ indexURL: '../../wasm/py/' }).then((pyodide) => {
      this.pyodide = pyodide;

      // Initialise stdout with some other modules.
      const pyVersion = this.pyodide.runPython(`
        import io, sys
        sys.stdout = io.StringIO()
        sys.version.split(' ')[0]
      `);

      console.log(`Started Python v${pyVersion}`);
    });
  }

  async compileLinkRun(data) {
    try {
      const { filename, contents } = data;

      // Reset stdout value.
      this.pyodide.runPython("sys.stdout = io.StringIO()");

      // Run user code.
      this.hostWriteCmd(`python3 ${filename}`);
      this.pyodide.runPython(contents);

      // Get the output.
      const stdout = this.pyodide.runPython("sys.stdout.getvalue()");
      this.hostWrite(stdout);
    } finally {
      if (typeof this.compileLinkRunCallback === 'function') {
        this.compileLinkRunCallback();
      }
    }
  }
}

// =============================================================================
// Worker message handling.
// =============================================================================

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
