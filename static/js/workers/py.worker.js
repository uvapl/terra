self.importScripts('../vendor/pyodide-0.25.0.min.js');
self.importScripts('../helpers.js')
self.importScripts('base-api.js')

class API extends BaseAPI {
  pyodide = null;

  constructor(options) {
    super(options);
    this.hostRead = options.hostRead;
    this.sharedMem = options.sharedMem;
    this.runButtonCommandCallback = options.runButtonCommandCallback;

    this.initPyodide();
  }

  /**
   * Initialise pyodide and load custom python modules.
   */
  initPyodide() {
    loadPyodide({
      indexURL: '../../wasm/py/',
      stdout: this.hostWrite,
      stdin: this.stdinHandler,
    }).then(async (pyodide) => {
      this.pyodide = pyodide;

      // By default, pyodide uses batch mode, which only flushes data when a
      // newline character is received. We override the options by using raw
      // mode, which gets triggered on every character the stdout receives.
      this.pyodide.setStdout({
        raw: (charCode) => this.hostWrite(String.fromCharCode(charCode))
      })

      // Import some basic modules.
      this.pyodide.runPython('import io, sys');

      // Get pyodide's Python version.
      const pyVersion = this.pyodide.runPython("sys.version.split(' ')[0]");
      const [pyMajorVersion, pyMinorVersion, _] = pyVersion.split('.');
      console.log(`Started Python v${pyVersion}`);

      // Load custom libraries and extract them in the virtual filesystem.
      let zipResponse = await fetch('../../wasm/py/custom_stdlib.zip');
      let zipBinary = await zipResponse.arrayBuffer();
      this.pyodide.unpackArchive(zipBinary, 'zip', {
        extractDir: `/lib/python${pyMajorVersion}.${pyMinorVersion}/site-packages/`
      });

      this.readyCallback();
    });
  }

  stdinHandler = () => {
    this.hostRead();
    Atomics.wait(new Int32Array(this.sharedMem.buffer), 0, 0);

    let str = '';

    // Read the value stored in memory.
    const sharedMem = new Uint8Array(this.sharedMem.buffer);
    for (let i = 0; i < sharedMem.length; i++) {
      if (sharedMem[i] === 0) {
        // Null terminator found, terminate the loop.
        break;
      }

      str += String.fromCharCode(sharedMem[i]);
    }

    // Clean shared memory.
    sharedMem.fill(0);

    return str;
  }

  /**
   * Writes a list of files to pyodide's virtual filesystem.
   *
   * @param {array} files - The files to write to the filesystem.
   */
  writeFilesToVirtualFS(files) {
    for (const file of files) {
      // Put each file in the virtual file system.
      this.pyodide.FS.writeFile(file.filename, file.contents, { encoding: 'utf8' });

      // Because pyodide always runs the same session, we have to remove the
      // file as a module from sys.modules to make sure the command runs on
      // a clean state.
      const module = file.filename.replace('.py', '');
      this.pyodide.runPython(`sys.modules.pop('${module}', None)`);
    }
  }

  /**
   * Run the user's code and print the output to the terminal.
   *
   * @param {object} data - The data object coming from the worker.
   * @param {string} data.activeTabName - The name of the active editor tab.
   * @param {array} data.files - List of objects, each containing the filename
   * and contents of the corresponding editor tab.
   */
  runUserCode({ activeTabName, files }) {
    try {
      this.writeFilesToVirtualFS(files);

      const activeTab = files.find(file => file.filename === activeTabName);

      this.hostWriteCmd(`python3 ${activeTab.filename}`);
      const stdout = this.run(activeTab.contents, activeTabName);
      if (stdout) {
        this.hostWrite(stdout);
      }
    } finally {
      if (typeof this.runUserCodeCallback === 'function') {
        this.runUserCodeCallback();
      }
    }
  }

  /**
   * Run a given command with the given files.
   *
  * @param {object} data - The data object coming from the worker.
   * @param {string} data.selector - Contains the button selector, which is
   * solely needed for the callback to enable the button after the code ran.
   * @param {string} activeTabName - The name of the active editor tab.
   * @param {array} data.cmd - A list of python commands to execute.
   * @param {array} data.files - List of objects, each containing the filename
   * and contents of the corresponding editor tab.
   */
  runButtonCommand({ selector, activeTabName, cmd, files }) {
    try {
      this.writeFilesToVirtualFS(files);

      // Replace <filename> placeholder with the active editor tab name.
      const moduleName = activeTabName.replace('.py', '');
      cmd = cmd.map((line) => line.replace('<filename>', moduleName));

      // Run the command and gather its results.
      const results = this.run(cmd, activeTabName);

      // Print the reults to the terminal in the UI.
      this.hostWrite(results);
    } finally {
      this.runButtonCommandCallback(selector);
    }
  }

  /**
   * Format the pyodide error message.
   *
   * @param {string} msg - The error message.
   * @param {string} activeTabName - The filename of the active editor tab.
   * @returns {str} Filtered error message.
   */
  formatErrorMsg(msg, activeTabName) {
    // When running e.g. "print(x)" where x is undefined, the following
    // Pyodide error message will be shown to the user:
    //
    //     Traceback (most recent call last):
    //       File "/lib/python311.zip/_pyodide/_base.py", line 499, in eval_code
    //         .run(globals, locals)
    //          ^^^^^^^^^^^^^^^^^^^^
    //       File "/lib/python311.zip/_pyodide/_base.py", line 340, in run
    //         coroutine = eval(self.code, globals, locals)
    //                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    //       File "<exec>", line 1, in <module>
    //       NameError: name 'x' is not defined
    //
    // while regular Python shows the following:
    //
    //     Traceback (most recent call last):
    //       File "/Users/koomen/tech/uva/examide/src/example.py", line 1, in <module>
    //         print(x)
    //               ^
    //     NameError: name 'x' is not defined
    //
    // Therefore, we'll remove line 2-7.
    msg = msg.split('\n');
    msg = [msg[0]].concat(msg.slice(7));

    // Furthermore, apply line postprocessing.
    msg = msg.map((line, index) => {
      // Do not alter the last line, as the user can control this output.
      if (index === msg.length - 2) return line;

      // Replace "<exec>" with the active tab's filename.
      line = line.replace('<exec>', activeTabName);

      // Remove `/home/pyodide` prefix when an error occurs in an imported file.
      // Unfiltered output will look like this:
      //
      //     Traceback (most recent call last):
      //       File "main.py", line 3, in <module>
      //       File "/home/pyodide/helpers.py", line 2, in say_hello
      //         print(x)
      //               ^
      //     NameError: name 'x' is not defined
      line = line.replace(/File "\/home\/pyodide\/(.+?\.py)"/, 'File "$1"');

      return line;
    });

    return msg.join('\n');
  }

  /**
   * Run a string or an array of python code.
   *
   * @example run("print('Hello World!')"
   * @example run(["print('Hello World!')", "print('Hello World 2!')"]
   *
   * @param {string} code - The python code to run.
   * @param {string} activeTabName - The filename of the active editor tab.
   * @returns {string} The output of the python code.
   */
  run(code, activeTabName) {
    if (!Array.isArray(code)) {
      code = code.split('\n')
    }

    // Gather the current globals (i.e. vars, funcs, classes).
    const globals = this.pyodide.globals.get('dict')();

    try {
      this.pyodide.runPython(code.join('\n'), { globals, locals: globals });
    } catch (err) {
      return this.formatErrorMsg(err.message, activeTabName);
    } finally {
      // Clear the globals after the code has run such that the next execution
      // will be called with a clean state.
      globals.destroy();
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
      const { port, sharedMem } = event.data.data;
      port.onmessage = onAnyMessage;
      api = new API({
        sharedMem,

        hostWrite(s) {
          port.postMessage({ id: 'write', data: s });
        },

        hostRead() {
          port.postMessage({ id: 'readStdin' });
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
