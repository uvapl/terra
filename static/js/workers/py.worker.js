self.importScripts('https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js');
self.importScripts('base-api.js')

class API extends BaseAPI {
  pyodide = null;

  constructor(options) {
    super(options);
    this.runTestsCallback = options.runTestsCallback;
    const packages = ['pytest'];

    loadPyodide({ packages }).then((pyodide) => {
      this.pyodide = pyodide;

      // Import some basic modules.
      this.pyodide.runPython('import io, sys, importlib');

      // Print python version to console.
      const pyVersion = this.pyodide.runPython("sys.version.split(' ')[0]");
      console.log(`Started Python v${pyVersion}`);

      options.readyCallback();
    });
  }

  runUserCode(data) {
    try {
      const { filename, contents } = data;
      this.hostWriteCmd(`python3 ${filename}`);
      this.hostWrite(this.run(contents));
    } finally {
      if (typeof this.runUserCodeCallback === 'function') {
        this.runUserCodeCallback();
      }
    }
  }

  /**
   * Run a string or an array of python code.
   *
   * @example run("print('Hello World!')"
   * @example run(["print('Hello World!')", "print('Hello World 2!')"]
   *
   * @param {string} code - The python code to run.
   * @returns {string} The output of the python code.
   */
  run(code) {
    if (!Array.isArray(code)) {
      code = code.split('\n')
    }

    return this.pyodide.runPython([
      'sys.stdout = io.StringIO()',
      ...code,
      'sys.stdout.getvalue()',
    ].join('\n'));
  }

  runTests(files) {
    try {
      // Put each test_* file in the virtual file system.
      for (const file of files) {
        if (file.filename.startsWith('test_')) {
          this.pyodide.FS.writeFile(file.filename, file.contents, { encoding: 'utf8' })

          // Because pyodide always runs the same session, we have to remove the
          // test_* as a module from sys.modules to make sure pytest always uses
          // the latest version.
          const module = file.filename.replace('.py', '');
          this.run(`sys.modules.pop('${module}', None)`);
        }
      }

      const results = this.run("import pytest; pytest.main()");

      this.hostWrite(results);
    } finally {
      this.runTestsCallback();
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

        readyCallback() {
          port.postMessage({ id: 'ready' });
        },

        runUserCodeCallback() {
          port.postMessage({ id: 'runUserCodeCallback' });
        },

        runTestsCallback() {
          port.postMessage({ id: 'runTestsCallback' });
        }
      });
      break;

    case 'runTests':
      api.runTests(event.data.data);
      break;

    case 'runUserCode':
      api.runUserCode(event.data.data);
      break;
  }
};

self.onmessage = onAnyMessage;
