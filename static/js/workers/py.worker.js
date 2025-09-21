import { getPartsFromPath, isImageExtension } from '../helpers/shared.js';
import BaseAPI from './base-api.js';
import { loadPyodide } from '../vendor/pyodide-0.25.0.min.js';

const HOME_DIR = '/home/pyodide';

class API extends BaseAPI {
  pyodide = null;

  constructor(options) {
    super(options);
    this.hostRead = options.hostRead;
    this.sharedMem = options.sharedMem;
    this.newOrModifiedFilesCallback = options.newOrModifiedFilesCallback;
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
        raw: (charCode) => this.hostWrite(String.fromCharCode(charCode)),
        isatty: true
      });

      // Import some basic modules.
      this.pyodide.runPython('import io, sys');

      // Pyodide sets the sys path to /home/pyodide, but native python has this
      // set to an empty string. This allows for relative imports.
      // @see https://github.com/pyodide/pyodide/discussions/5629#discussioncomment-13107855
      this.pyodide.runPython('sys.path[0] = ""');

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
      if (file.path.includes('/')) {
        // Create the parent folders.
        const parentFolders = file.path.split("/").slice(0, -1);
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
        if (file.content instanceof ArrayBuffer) {
          this.pyodide.FS.writeFile(file.path, new Uint8Array(file.content));
        } else {
          this.pyodide.FS.writeFile(file.path, file.content, { encoding: 'utf8' });
        }

        // Keep track of when the file was created.
        const stat = this.pyodide.FS.stat(file.path);
        file.ctime = stat.ctime;
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
    this.pyodide.FS.chdir(HOME_DIR);

    // Since new files can be created when a python file is executed, we just
    // gather all parent directories and then delete their files, followed by
    // deleting the folder itself, going bottom-up direction.
    const parentFolderPaths = this.getParentFolderPaths(files);

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
    const rootFilePaths = this.pyodide.FS.readdir(HOME_DIR);
    for (const filepath of rootFilePaths) {
      if (this.fileExists(filepath)) {
        this.pyodide.FS.unlink(filepath);
      }
    }
  }

  /**
   * Get all the parent folder paths of the given list of files, sorted by how
   *  many subfolders they have.
   *
   * @param {array} files - List of files to get the parent folder paths from.
   * @returns {array} List of strings containing the parent folder paths.
   */
  getParentFolderPaths(files) {
    const parentFolderPaths = [];

    // Gather all parent folder paths.
    for (const file of files) {
      if (file.path.includes('/')) {
        const parentFolderPath = file.path.split('/').slice(0, -1).join('/');
        if (!parentFolderPaths.includes(parentFolderPath)) {
          parentFolderPaths.push(parentFolderPath);
        }
      }
    }

    // Sort the parent folders based on how many subfolders they have.
    // Example: '/dir1/dir2/dir3' -> ['dir1', 'dir2', 'dir3'] -> len = 3
    parentFolderPaths.sort((a, b) => {
      const aCount = a.split('/').length;
      const bCount = b.split('/').length;
      if (aCount < bCount) return 1;
      if (aCount > bCount) return -1;
      return 0;
    });

    return parentFolderPaths;
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
   * Get the content of a file in the pyodide filesystem.
   *
   * @param {string} filepath - The path of the file to read.
   * @returns {string} The content of the file.
   */
  getFileContent(filepath) {
    let content = null;

    if (isImageExtension(filepath)) {
      content = this.pyodide.FS.readFile(filepath).buffer;
    } else {
      content = this.pyodide.FS.readFile(filepath, { encoding: 'utf8' });
    }

    return content;
  }

  /**
   * Check if new files have been created in the virtual filesystem, based on
   * the files that were passed to the runUserCode function.
   */
  checkForNewFiles(files) {
    const parentFolderPaths = this.getParentFolderPaths(files);
    const newFiles = [];

    // Iterate bottoms-up over the parent folders and read all filenames inside
    // the coresponding folder. Then, check if any of those files exist inside
    // the `files` parameter. If not, it's a new file.
    for (const folderpath of parentFolderPaths) {
      const subFolderFilePaths = this.pyodide.FS.readdir(folderpath);
      for (const filename of subFolderFilePaths) {
        const filepath = `${folderpath}/${filename}`;

        if (this.fileExists(filepath)) {
          // Check if the file already exists in the files parameter.
          const existingFile = files.find((f) => f.path === filepath);
          const isNewFile = !existingFile;

          const stat = this.pyodide.FS.stat(filepath);
          const isModified = !isNewFile && existingFile.ctime.getTime() !== stat.mtime.getTime();
          if (isNewFile || isModified) {
            const content = this.getFileContent(filepath);
            newFiles.push({ name: filename, path: filepath, content });
          }
        }
      }
    }

    // Finally, check for new files in the home directory.
    const subFolderFilePaths = this.pyodide.FS.readdir(HOME_DIR);
    for (const filepath of subFolderFilePaths) {
      if (this.fileExists(filepath)) {
        // Check if the file already exists in the files parameter.
        const existingFile = files.find((f) => f.path === filepath);
        const isNewFile = !existingFile;

        const stat = this.pyodide.FS.stat(filepath);
        const isModified = !isNewFile && existingFile.ctime.getTime() !== stat.mtime.getTime();
        if (isNewFile || isModified) {
          const content = this.getFileContent(filepath);
          newFiles.push({ name: filepath, path: filepath, content });
        }
      }
    }

    return newFiles;
  }

  /**
   * Run the user's code and print the output to the terminal.
   *
   * @param {object} data - The data object coming from the worker.
   * @param {string} data.activeTabPath - The active tab's absolute file path.
   * @param {array} data.vfsFiles - List of all file objects from the VFS, each
   * containing the filename and content of the corresponding editor tab.
   */
  runUserCode({ activeTabPath, vfsFiles }) {
    try {
      // Ensure that we always operate from the home directory as a fresh start.
      this.pyodide.FS.chdir(HOME_DIR);

      this.writeFilesToVirtualFS(vfsFiles);

      const activeTab = vfsFiles.find((file) => file.path === activeTabPath);
      let filename = activeTab.path;
      if (activeTab.path.includes('/')) {
        // Change directory to the folder of the active file.
        const { name, parentPath } = getPartsFromPath(activeTab.path);
        filename = name;
        this.pyodide.FS.chdir(parentPath);
      }

      this.hostWriteCmd(`python3 ${filename}`);

      const error = this.run(activeTab.content, activeTabPath);
      if (error) {
        this.hostWrite(error);
      }
    } finally {
      // Ensure that we always operate from the home directory, because the cwd
      // might have changed during execution.
      this.pyodide.FS.chdir(HOME_DIR);

      const newFiles = this.checkForNewFiles(vfsFiles);

      this.deleteFilesFromVirtualFS(vfsFiles);

      if (newFiles.length > 0) {
        this.newOrModifiedFilesCallback(newFiles);
      }

      this.runUserCodeCallback();
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

    try {
      // Use matplotlib's Agg backend for static images.
      this.pyodide.runPython("import matplotlib; matplotlib.use('Agg')");

      // Unload all modules that would be imported from the Terra editor.
      this.pyodide.runPython(`
        import importlib, sys, types

        # allow python to pick up new files in FS etc
        importlib.invalidate_caches()

        # reload local modules
        for name, mod in list(sys.modules.items()):
            if isinstance(mod, types.ModuleType):
                file = getattr(mod, "__file__", "")
                if file and file.startswith("/home/pyodide/"):
                    importlib.reload(mod)
      `);

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

        newOrModifiedFilesCallback(newOrModifiedFiles) {
          port.postMessage({
            id: 'newOrModifiedFilesCallback',
            newOrModifiedFiles
          });
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
