self.importScripts('../vendor/pyodide-0.25.0.min.js');
// self.importScripts('../helpers.js')
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

      // Disable buffering, needed when the user uses the end kwarg:
      //     -> print('..', end='')
      args: ['-u'],
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
    // Ensure that we always operate from the home directory.
    this.pyodide.FS.chdir("/home/pyodide");

    for (const file of files) {
      if (file.filepath.includes('/')) {
        // Create the parent folders.
        const parentFolders = file.filepath.split("/").slice(0, -1);
        for (let i = 0; i < parentFolders.length; i++) {
          const folderpath = parentFolders.slice(0, i + 1).join("/");
          // Check if the folder already exists.
          if (!this.directoryExists(folderpath)) {
            this.pyodide.FS.mkdir(folderpath);
          }
        }
      }

      // Put each file in the virtual file system. Only do this when the file
      // content is not empty, otherwise pyodide throws an error.
      if (file.content) {
        this.pyodide.FS.writeFile(file.filepath, file.content, { encoding: 'utf8' });
      }
    }
  }

  /**
   * Delete a list of files from pyodide's virtual filesystem.
   *
   * @param {array} files - The files to delete from the filesystem.
   */
  deleteFilesFromVirtualFS(files) {
    // Ensure that we always operate from the home directory.
    this.pyodide.FS.chdir("/home/pyodide");

    const parentFolderPaths = [];

    // Since new files can be created when a python file is executed, we just
    // gather all parent directories and then delete their files, followed by
    // deleting the folder itself, going bottom-up direction.

    // Gather all parent folder paths.
    for (const file of files) {
      if (file.filepath.includes('/')) {
        const parentFolderPath = file.filepath.split('/').slice(0, -1).join('/');
        if (!parentFolderPaths.includes(parentFolderPath)) {
          parentFolderPaths.push(parentFolderPath);
        }
      }
    }

    // Sort the parent folders based on how many subfolders they have.
    parentFolderPaths.sort((a, b) => {
      const aCount = a.split('/').length;
      const bCount = b.split('/').length;
      if (aCount < bCount) return 1;
      if (aCount > bCount) return -1;
      return 0;
    });

    // Delete the parent folders if they are empty and exist, bottom-up.
    for (const folderpath of parentFolderPaths) {
      if (this.directoryExists(folderpath)) {
        // Delete all files in the folder.
        const subFolderFilePaths = this.pyodide.FS.readdir(folderpath);
        for (const file of subFolderFilePaths) {
          const filepath = `${folderpath}/${file}`;
          if (this.fileExists(filepath)) {
            this.pyodide.FS.unlink(filepath);
          }
        }

        // Delete the folder itself.
        this.pyodide.FS.rmdir(folderpath);
      }
    }

    // Finally, delete all the files inside the home directory.
    const rootFilePaths = this.pyodide.FS.readdir('/home/pyodide');
    for (const filepath of rootFilePaths) {
      if (this.fileExists(filepath)) {
        this.pyodide.FS.unlink(filepath);
      }
    }
  }

  /**
   * Check if a given folderpath exists in the pyodide filesystem.
   *
   * @param {string} folderpath - The folderpath to check.
   * @returns {boolean} True if the path exists, false otherwise.
   */
  directoryExists(folderpath) {
    try {
      const stat = this.pyodide.FS.stat(folderpath);
      return this.pyodide.FS.isDir(stat.mode);
    } catch (err) {
      return false;
    }
  }

  /**
   * Check if a given filepath exists in the pyodide filesystem.
   *
   * @param {string} filepath - The filepath to check.
   * @returns {boolean} True if the path exists, false otherwise.
   */
  fileExists(filepath) {
    try {
      const stat = this.pyodide.FS.stat(filepath);
      return this.pyodide.FS.isFile(stat.mode);
    } catch (err) {
      return false;
    }
  }

  /**
   * Run the user's code and print the output to the terminal.
   *
   * @param {object} data - The data object coming from the worker.
   * @param {string} data.activeTabName - The name of the active editor tab.
   * @param {array} data.files - List of objects, each containing the filename
   * and content of the corresponding editor tab.
   */
  runUserCode({ activeTabName, files }) {
    try {
      this.writeFilesToVirtualFS(files);

      const activeTab = files.find(file => file.name === activeTabName);
      if (activeTab.filepath.includes('/')) {
        // change directory to the folder of the active file
        const folderpath = activeTab.filepath.split('/').slice(0, -1).join('/');
        this.pyodide.FS.chdir(folderpath);
      }

      this.hostWriteCmd(`python3 ${activeTab.name}`);
      const error = this.run(activeTab.content, activeTabName);
      if (error) {
        this.hostWrite(error);
      }
    } finally {
      this.deleteFilesFromVirtualFS(files);

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
   * and content of the corresponding editor tab.
   */
  runButtonCommand({ selector, activeTabName, cmd, files }) {
    try {
      this.writeFilesToVirtualFS(files);

      // Replace <filename> placeholder with the active editor tab name.
      const moduleName = activeTabName.replace('.py', '');
      cmd = cmd.map((line) => line.replace('<filename>', moduleName));

      const error = this.run(cmd, activeTabName);
      if (error) {
        this.hostWrite(error);
      }
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
    //       File "/Users/<user>/terra/src/example.py", line 1, in <module>
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
   * Request the list of modules that are currently loaded in the pyodide.
   *
   * @returns {array} List of loaded modules.
   */
  getSysModules() {
    return this.pyodide.runPython(`','.join(sys.modules.keys())`).split(',');
  }

  /**
   * Run a string or an array of python code.
   *
   * @example run("print('Hello World!')"
   * @example run(["print('Hello World!')", "print('Hello World 2!')"]
   *
   * @param {string} code - The python code to run.
   * @param {string} activeTabName - The filename of the active editor tab.
   * @returns {string|undefined} The error message or undefined.
   */
  run(code, activeTabName) {
    if (!Array.isArray(code)) {
      code = code.split('\n')
    }

    // Gather the current globals (i.e. vars, funcs, classes).
    const globals = this.pyodide.globals.get('dict')();

    // Allow the user to run code in the __main__ scope.
    globals.set('__name__', '__main__');

    const sysModulesBefore = this.getSysModules();

    try {
      // Most of the output will end up in the raw stdout handler defined
      // earlier, but some output will still end up in the console, which
      // generally happens solely for config buttons.
      const result = this.pyodide.runPython(code.join('\n'), { globals, locals: globals });
      if (result) {
        this.hostWrite(result);
      }
    } catch (err) {
      // When the error starts with Traceback, the error is from the code that
      // was executed. Otherwise, it's an internal error within the codebase.
      if (err.message.startsWith('Traceback')) {
        return this.formatErrorMsg(err.message, activeTabName);
      }
    } finally {
      // Remove all modules that were imported when executing the code.
      const sysModulesAfter = this.getSysModules();
      const addedModules = sysModulesAfter.filter(module => !sysModulesBefore.includes(module));
      for (const module of addedModules) {
        this.pyodide.runPython(`sys.modules.pop('${module}', None)`);
      }

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
