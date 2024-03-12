self.importScripts('../vendor/pyodide.min.js');
self.importScripts('../helpers.js')
self.importScripts('base-api.js')

class API extends BaseAPI {
  pyodide = null;

  constructor(options) {
    super(options);
    this.runTestsCallback = options.runTestsCallback;
    this.runButtonCommandCallback = options.runButtonCommandCallback;

    loadPyodide({ indexURL: '../../wasm/py/' }).then((pyodide) => {
      this.pyodide = pyodide;

      // Import some basic modules.
      this.pyodide.runPython('import io, sys, importlib, pytest');

      // Print python version to console.
      const pyVersion = this.pyodide.runPython("sys.version.split(' ')[0]");
      console.log(`Started Python v${pyVersion}`);

      options.readyCallback();
    });
  }

  runUserCode({ filename, contents }) {
    try {
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

  /**
   * Run a given command with the given files.
   *
   * @param {object} data - The data object retrieved.
   * @param {string} data.selector - Contains the button selector, which is
   * solely needed for the callback to enable the button after the code ran.
   * @param {array} data.cmd - A list of python commands to execute.
   * @param {array} data.files - A list of objects, each containing the filename
   * and the file contents coming from the front-end editor. If '<filename>'
   * exists in the data.cmd, then this will be a list containing solely the file
   * the user is currently looking at.
   */
  runButtonCommand({ selector, cmd, files }) {
    try {
      for (const file of files) {
        // Put each file in the virtual file system.
        this.pyodide.FS.writeFile(file.filename, file.contents, { encoding: 'utf8' });

        // Because pyodide always runs the same session, we have to remove the
        // file as a module from sys.modules to make sure the command runs on
        // a clean state.
        const module = file.filename.replace('.py', '');
        this.run(`sys.modules.pop('${module}', None)`);
      }

      // If '<filename>' exists in the commands, then we execute the commands
      // solely on the current file the user has open in the UI.
      const hasFilenameToken = cmd.filter((line) => line.includes('<filename>')).length > 0;
      if (hasFilenameToken) {
        // Replace <filename> with the actual filename.
        const filename = files[0].filename.replace('.py', '');
        cmd = cmd.map((line) => line.replace('<filename>', filename));
      }

      // Run the command.
      const results = this.run(cmd);

      // Print the reults to the terminal in the UI.
      this.hostWrite(results);
    } finally {
      this.runButtonCommandCallback(selector);
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

        runButtonCommandCallback(selector) {
          port.postMessage({ id: 'runButtonCommandCallback', selector });
        }
      });
      break;

    case 'runButtonCommand':
      api.runButtonCommand(event.data.data);
      break;

    case 'runUserCode':
      api.runUserCode(event.data.data);
      break;
  }
};

self.onmessage = onAnyMessage;
