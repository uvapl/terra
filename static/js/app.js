import { getFileExtension, isImageExtension } from './lib/helpers.js'
import { FileNotFoundError, FileTooLargeError } from './fs/vfs.js';
import BaseApp from './app.base.js';
import { triggerPluginEvent } from './plugin-manager.js';
import { MAX_FILE_SIZE } from './constants.js';

/**
 * Base class that is extended for each of the apps.
 *
 * Composition and wiring live in BaseApp; this class holds the handlers
 * (grouped below by the source that fires them) and the basic app methods.
 */
export default class App extends BaseApp {
  /**
   * Resolver for the promise returned by the most recent runFile() call, or
   * null when no shell-initiated run is in flight. Resolved by onRunEnded.
   * @type {?function}
   */
  _runEndResolver = null;

  // ─────────────────────────── Editor handlers ───────────────────────────

  /**
   * Callback function for when the content has changed of an editor.
   *
   * This is default functionality and super.onEditorTextChanged() must be
   * called first in child classes before any additional functionality.
   *
   * @async
   * @param {EditorTab} editorComponent - The editor component instance.
   */
  async onEditorTextChanged(editorComponent) {
    const path = editorComponent.getPath();
    await this.vfs.updateFile(path, editorComponent.getContent());
  }

  /**
   * Callback function when an editor instance becomes visible/active.
   *
   * This is default functionality and super.onEditorSwitchedTo() must be
   * called first in child classes before any additional functionality.
   *
   * @param {EditorTab} editorComponent - The editor component instance.
   */
  async onEditorSwitchedTo(editorComponent) {
    if (editorComponent.ready) {
      this.createLangWorker(editorComponent.proglang);
    }

    this.view.invalidateActions();

    await this.setEditorFileContent(editorComponent);
  }

  /**
   * Invoked after each LFS polling where each editor instance gets notified
   * that the VFS content has been changed, which requires to reload the file
   * content from the vfs.
   *
   * @param {EditorTab} editorComponent - The editor component instance.
   */
  async onEditorReloadRequested(editorComponent) {
    if (!this.isFSReloadSuspended()) {
      await this.setEditorFileContent(editorComponent, { clearUndoStack: true });
    }
  }

  // ─────────────────────────── Image handlers ────────────────────────────

  onImageSwitchedTo(imageComponent) {
    this.terminateLangWorker();
    this.view.invalidateActions();
    this.setImageFileContent(imageComponent);
  }

  onImageReloadRequested(imageComponent) {
    if (!this.isFSReloadSuspended()) {
      this.setImageFileContent(imageComponent);
    }
  }

  // ───────────────────────── Terminal key handlers ───────────────────────

  /** Stop the program currently running. A no-op when nothing is running. */
  terminateWorker() {
    if (this.langWorkerClient.isRunningCode) {
      this.stopRunningProgramManually();
    }
  }

  /**
   * Clear the terminal at the user's request and notify plugins, so e.g. the
   * shell can render a fresh prompt. Pre-run clears use term.clear() directly
   * and deliberately do not notify.
   */
  clearTerminal() {
    this.term?.clear();
    triggerPluginEvent('onTerminalCleared');
  }

  /**
   * Toggle keyboard focus between the active editor and the terminal. If the
   * terminal currently holds focus, move to the editor, otherwise move to the
   * terminal.
   */
  toggleEditorTerminalFocus() {
    if (this.term?.hasFocus()) {
      this.view.getActiveEditor()?.focus();
    } else {
      this.term?.focus();
    }
  }

  focusActiveEditor() {
    const editorComponent = this.view.getActiveEditor();
    if (editorComponent && editorComponent.ready) {
      // Suspend reactive reloads to prevent file contents being reloaded
      this.suspendFSReload();
      editorComponent.focus();
      this.resumeFSReload();
    }
  }

  // ───────────────────── View handlers ────────────────────

  /** Increase the font size by one step. */
  zoomIn() {
    this.view.increaseFontSize();
  }

  /** Decrease the font size by one step. */
  zoomOut() {
    this.view.decreaseFontSize();
  }

  /** Reset the font size to the default. */
  resetZoom() {
    this.view.setFontSizeDefault();
  }

  /** Set the font size to the larger "demo" size. */
  zoomDemo() {
    this.view.setFontSizeDemo();
  }

  // ─────────────────────────── Language worker ───────────────────────────

  /**
   * Create a new language worker client if none exists already. The existing
   * client will be terminated and restarted if necessary. This is the single
   * place where a client is constructed, so its handlers are always wired.
   *
   * @param {string} proglang - The proglang to spawn the related worker for.
   */
  createLangWorker(proglang) {
    this.langWorkerClient.load(proglang);
  }

  /**
  * Terminate the current language worker if it exists.
   */
  terminateLangWorker() {
    if (this.langWorkerClient.hasActiveWorker()) {
      this.langWorkerClient.terminate();
    }
  }

  // ─────────────────────────── Worker handlers ───────────────────────────

  /**
   * Build the app-side reaction callbacks handed to a language worker client.
   * The client is pure transport and delegates every DOM/VFS/terminal reaction
   * to these handlers, which are grouped here as the single object that is
   * passed to the client. Arrow functions capture this instance, so they do not
   * rely on _bindThis().
   *
   * @returns {object} The handlers object.
   */
  getLangWorkerHandlers() {
    return {
      onLoad: (hasPendingCommand) => {
        if (hasPendingCommand) {
          this.term?.write('\x1b[2mWaiting for runtime to fully load, just a sec...\x1b[0m');
        }
        this.view.invalidateActions();
      },

      /**
       * The worker has finished initialising and is ready to run. Re-enable the
       * worker UI buttons unless a queued command is about to run.
       *
       * @param {boolean} hasPendingCommand - Whether a queued command will run.
       */
      onReady: (hasPendingCommand) => {
        if (hasPendingCommand) {
          this.term.clearCurrentLine();
        }
        if (!hasPendingCommand) {
          // The runtime finished loading: re-pull availability so the run and
          // config buttons enable for the (now runnable) active tab.
          this.view.invalidateActions();
        }
      },

      /**
       * Write a message produced by the worker to the terminal.
       *
       * @param {string} text - The message to write.
       */
      onWrite: (text) => {
        this.term?.write(text);
      },

      /**
       * Write an error message produced by the worker in red.
       *
       * @param {string} text - The error message to write.
       */
      onWriteError: (text) => {
        this.term?.write(`\x1b[1;31m${text}\x1b[0m`);
      },

      /**
       * The worker is requesting a line of standard input from the terminal.
       */
      onRequestStdin: () => this.term.waitForInput(),

      /**
       * A custom config button's command has finished executing.
       */
      onRunButtonCommandDone: () => {
        this.view.invalidateActions();
      },

      /**
       * The user's code has started running. If it does not finish quickly,
       * turn the run button into a stop button so the user can abort it.
       */
      onRunStarted: () => {
        this.view.runStarted();
      },

      /**
       * The user's code has finished running or was aborted. Reset the run/stop
       * button and clean up the terminal. Safe on normal completion too: there
       * is nothing pending to dispose and the cursor is already hidden.
       */
      onRunEnded: () => {
        // Print inverted `%` to terminal if last line of output was not terminated by a `\n`.
        this.term?.printForgotNewline();

        // Dispose any pending stdin prompt left by an aborted run and hide the cursor.
        this.term?.disposeUserInput();

        // Set focus to the active editor.
        this.view.getActiveEditor().focus();

        // Reset the run/stop button and re-pull availability. The run button's
        // predicate handles the case where the active tab is not runnable (e.g.
        // code was launched via the file-tree context menu in the IDE).
        this.view.runEnded();

        // If a run was started through runFile (e.g. by the shell), resolve its
        // promise now so the caller can resume.
        if (this._runEndResolver) {
          const resolve = this._runEndResolver;
          this._runEndResolver = null;
          resolve();
        }

        // Notify plugins that the run has ended, after the terminal cleanup
        // above (e.g. the shell, to restore its prompt and cursor).
        triggerPluginEvent('onRunEnded');
      },

      /**
       * Files were created or modified in the worker's internal filesystem
       * during execution. Reflect the changes in the VFS, open tabs and the
       * file tree.
       *
       * @async
       * @param {array} newOrModifiedFiles - List of file objects.
       */
      onNewOrModifiedFiles: async (newOrModifiedFiles) => {
        if (!Array.isArray(newOrModifiedFiles)) {
          return;
        }

        for (const file of newOrModifiedFiles) {
          // Check if the file already exists in the VFS.
          if ((await this.vfs.pathExists(file.path))) {
            // If there's an open tab for this file, update its content first.
            // Both editor and image tabs accept the raw content directly (image
            // tabs build a blob URL from the bytes). This must happen before the
            // updateFile() below, which transfers the content's ArrayBuffer to
            // the VFS worker and would leave it detached here.
            const tabComponent = this.view.getTabComponents().find((component) => {
              const path = component.getPath();
              return path == file.path;
            });
            if (tabComponent) {
              tabComponent.setContent(file.content);

              // Bring an updated image to the front so the change is visible.
              if (isImageExtension(file.path)) {
                tabComponent.setActive();
              }
            }

            // Persist the new content to the VFS. Write immediately (rather
            // than the debounced default) so that opening a tab below reads the
            // latest content instead of the previous version.
            await this.vfs.updateFile(file.path, file.content, true, true);

            // If an existing image isn't open yet, open it in a tab. This must
            // run after updateFile so the tab reads the latest content from the
            // VFS (the in-memory ArrayBuffer was transferred away above).
            if (!tabComponent && isImageExtension(file.path)) {
              this.view.addFileTab(file.path);
            }
          } else {
            // Otherwise, create a new file in the VFS.
            await this.vfs.createFile(
              file.path,
              file.content,
            );

            // Automatically open new image files in a tab.
            if (isImageExtension(file.path)) {
              this.view.addFileTab(file.path);
            }
          }

          // Recreate the file tree (IDE app only).
          await this.refreshFileTree?.();
        }
      },

      /**
       * Files were deleted from the worker's internal filesystem during
       * execution. Remove them from the VFS and close any open tabs.
       *
       * @async
       * @param {string[]} deletedPaths - List of file paths that were deleted.
       */
      onDeletedFiles: async (deletedPaths) => {
        if (!Array.isArray(deletedPaths)) {
          return;
        }

        for (const path of deletedPaths) {
          await this.vfs.deleteFile(path, false);

          const tabComponent = this.view.getTabComponents().find(
            (component) => component.getPath() === path
          );
          if (tabComponent) {
            tabComponent.close();
          }
        }
      },
    };
  }

  // ──────────────────────────── Running code ─────────────────────────────

  /**
   * Runs the code inside the worker by sending all files to the worker along with
   * the current active tab name. If the `options.filepath` is set, then solely
   * that file will be run.
   *
   * @async
   * @param {object} options - Options for running the code.
   * @param {string} options.filepath - Run a specific file.
   * @param {boolean} options.clearTerm Whether to clear the terminal before
   * printing the output.
   * @param {boolean} options.runAs - Whether the runAs config should be used.
   */
  async runCode(options = {}) {
    if (options.clearTerm) this.term.clear();

    if (this.langWorkerClient.isRunningCode) {
      // Act as stop button: abort the running program (e.g. an infinite loop).
      return this.stopRunningProgramManually();
    }

    // Run a given file path, or otherwise the active file.
    const filepath = options.filepath || this.view.getActiveEditor().getPath();
    await this._startRun({ filepath, runAs: options.runAs });
  }

  /**
   * Start running a single file in the language worker. Shared by runCode (the
   * run button) and runFile (the shell). Collects all files, spawns the worker
   * for the file's language if needed, and either runs immediately or queues
   * the command until the worker is ready.
   *
   * @async
   * @param {object} options
   * @param {string} options.filepath - The file to run.
   * @param {boolean} [options.runAs] - Whether the runAs config should be used.
   */
  async _startRun({ filepath, runAs = false }) {
    // Immediately find out language based on extension, and bail if
    // indeterminate.
    const proglang = getFileExtension(filepath);
    if (!proglang) return;

    // Notify plugins that a run is starting (e.g. the shell, to yield the
    // terminal and start program output on a fresh line).
    triggerPluginEvent('onRunStart');

    this.term.focus();

    this.view.runStarting();

    let files = await this.vfs.getAllFiles();

    // Append hidden files if present.
    files = files.concat(this.getHiddenFiles());

    // Build args to send to the worker's runUserCode function.
    const runUserCodeArgs = [filepath, files];

    // Only resolve the runAs config when actually running "as", because
    // getRunAsConfig() reads the active editor's path and throws when there is
    // no runnable active tab (e.g. when the shell launches a program).
    if (runAs) {
      const runAsConfig = this.getRunAsConfig();
      if (runAsConfig) {
        runUserCodeArgs.push(runAsConfig);
      }
    }

    this.langWorkerClient.start(proglang, runUserCodeArgs);
  }

  /**
   * Run a single file and resolve once the run has ended (whether it completed
   * normally or was aborted). This is the stable entry point the shell uses to
   * launch a program: the shell yields terminal input, awaits this, then takes
   * input back. It deliberately goes through the app rather than reaching into
   * the language worker client.
   *
   * @param {string} filepath - The (VFS-absolute) file to run.
   * @returns {Promise<void>} Resolves when the run has ended.
   */
  runFile(filepath) {
    return new Promise((resolve, reject) => {
      if (!this.langWorkerClient.supports(getFileExtension(filepath))) {
        reject(new Error(`cannot run '${filepath}': unsupported file type`));
        return;
      }

      if (this.langWorkerClient.isRunningCode) {
        reject(new Error('a program is already running'));
        return;
      }

      // onRunEnded resolves this once the worker reports the run has finished.
      this._runEndResolver = resolve;
      this._startRun({ filepath }).catch((err) => {
        this._runEndResolver = null;
        reject(err);
      });
    });
  }

  /**
   * Run the command of a custom config button.
   *
   * @param {string} selector - Unique selector for the button, used to disable
   * it when running and disable it when it's done running.
   * @param {array} cmd - List of commands to execute.
   */
  async runButtonCommand(selector, cmd) {
    const $button = $(selector);
    if ($button.prop('disabled')) return;
    this.view.runStarting();

    this.term.clear();

    const activeTabName = this.view.getActiveEditor().getFilename();
    let files = await this.vfs.getAllFiles();
    files = files.concat(this.getHiddenFiles());

    const run = () => this.langWorkerClient.runButtonCommand(selector, activeTabName, cmd, files);

    if (this.langWorkerClient.hasActiveWorker() && !this.langWorkerClient.isReady) {
      // Worker is still loading — queue the command to run once it's ready.
      this.langWorkerClient.pendingCommand = run;
      this.term?.write('\x1b[2mWaiting for runtime to fully load, just a sec...\x1b[0m');
    } else if (this.langWorkerClient.isReady) {
      run();
    }
  }

  /**
   * Stop the program the user is currently running: restart the worker so the
   * next run starts fresh, then clear any pending output and print a termination
   * notice. The restart triggers onRunEnded, which resets the UI and terminal.
   */
  stopRunningProgramManually() {
    this.langWorkerClient.restart();
    this.term?.clearTermWriteBuffer();
    this.term?.writeln('\x1b[1;31mProcess terminated\x1b[0m');
  }

  /**
   * Get the config object for the run-as button.
   * This is executed just before the user runs the code from an editor.
   * By default this returns null if not implemented in child classes.
   *
   * @returns {null|object} The config object if implemented.
   */
  getRunAsConfig() {
    return null;
  }

  /**
   * Get the hidden files that should be passed to the worker, but are not
   * displayed as visual tabs inside the UI for the user.
   *
   * @returns {array} List of (hidden) files.
   */
  getHiddenFiles() {
    return [];
  }

  /**
   * Whether the active tab is something the language worker can run. This is the
   * single fact the run-button (and config-button) predicates pull through the
   * command registry's invalidate() pass; the app decides it, the view applies
   * it. Returns false when there is no active editor (e.g. an image tab).
   *
   * @returns {boolean}
   */
  canRunActiveTab() {
    // `this.view` is briefly absent while the controller is still being
    // constructed (the toolbar's initial build evaluates this predicate before
    // the controller is assigned); treat that as not-runnable until onReady's
    // invalidate re-evaluates.
    const editor = this.view?.getActiveEditor?.();
    return !!editor && this.langWorkerClient.supports(getFileExtension(editor.getFilename()));
  }

  // ──────────────────────────── File content ─────────────────────────────

  /**
   * Reload the editor content from the VFS. The VFS read (and its file-size
   * cap) is the app/data concern handled here; applying the content to the view
   * (cursor preservation, undo stack) is delegated to the editor component.
   *
   * @async
   * @param {EditorTab} editorComponent - The editor component instance.
   * @param {object} [options]
   * @param {boolean} [options.clearUndoStack=false] - Whether to clear the undo
   * stack after the content is applied.
   */
  async setEditorFileContent(editorComponent, { clearUndoStack = false } = {}) {
    const path = editorComponent.getPath();
    if (!path) return;

    try {
      const content = await this.vfs.readFile(path, MAX_FILE_SIZE);
      editorComponent.reloadContent(content, { clearUndoStack });
    } catch (err) {
      this._applyFileReadError(err, editorComponent);
    }
  }

  async setImageFileContent(imageComponent) {
    const filepath = imageComponent.getPath();
    if (!filepath) return;

    try {
      await this.vfs.readFile(filepath, MAX_FILE_SIZE);
      const link = await this.vfs.getFileURL(filepath);
      imageComponent.setSrc(link);
    } catch (err) {
      this._applyFileReadError(err, imageComponent);
    }
  }

  /**
   * Translate a VFS read error into the matching component-level UI reaction.
   * Shared by the editor and image read paths.
   *
   * @param {Error} err - The error thrown by the VFS read.
   * @param {BaseTab} component - The component to react on (editor/image).
   */
  _applyFileReadError(err, component) {
    if (err instanceof FileTooLargeError) {
      component.exceededFileSize();
    } else if (err instanceof FileNotFoundError) {
      console.warn('File disappeared:', err.path);
    } else {
      console.error('Unexpected error reading file:', err);
    }
  }

  // ─────────────────────── Layout collaborator hooks ─────────────────────

  /**
   * Tell all open components to reload their content from the VFS. Called by the
   * Git backend after it rewrites files.
   */
  reloadComponentsFromVFS() {
    this.view.emitToAllComponents('vfsChanged');
  }
}
