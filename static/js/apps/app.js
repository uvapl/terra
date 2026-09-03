import { getFileExtension, isImageExtension, isObject, seconds } from '../lib/helpers.js'
import { createScheduler } from '../lib/scheduler.js';
import { FileExistsError, FileNotFoundError, FileTooLargeError } from '../fs/vfs.js';
import BaseApp from './app.base.js';
import { triggerPluginEvent, triggerPluginEventFor } from '../lib/plugin-manager.js';
import { MAX_FILE_SIZE } from '../constants.js';

/**
 * The toolbar buttons the app puts there itself, keyed by the name a config
 * uses to address them. Giving such a name an empty value in the `buttons`
 * config removes the button.
 */
const BUILTIN_BUTTONS = {
  run: { command: 'runTab', id: 'run-code' },
};

/**
 * Whether a configured button holds no command, which is how a config asks for
 * a button to be removed instead of added.
 *
 * @param {*} cmd - The value the config gave the button.
 * @returns {boolean} True when the value is empty.
 */
function isEmptyCommand(cmd) {
  if (cmd === null || typeof cmd === 'undefined') return true;
  if (Array.isArray(cmd)) return cmd.length === 0;

  return typeof cmd === 'string' && cmd.trim() === '';
}

/**
 * Base class that is extended for each of the apps.
 *
 * Composition and wiring live in BaseApp; this class holds the handlers
 * (grouped below by the source that fires them) and the basic app methods.
 */
export default class App extends BaseApp {
  /**
   * Whether last command finished.
   *
   * @type {?function}
   */
  _runEndResolver = null;

  /**
   * Whether the editor should take focus back when the current run ends.
   *
   * @type {boolean}
   */
  _refocusEditorOnRunEnd = true;

  /** Timer ID for the delayed run-button → stop-button flip, or null. */
  _runButtonTimer = null;

  /** Scheduler holding the pending editor writes, keyed by path. */
  _editorWrites = createScheduler();

  /**
   * Maps a proglang to the output surface kind it pairs with (currently only
   * 'canvas'). A plugin links its languages here via registerSurface(); the core
   * then opens that surface on demand when such an editor is active and closes it
   * again once no linked editor remains. The terminal is the default surface for
   * any proglang not listed.
   * @type {Object<string, string>}
   */
  _surfaces = {};

  constructor() {
    super();

    // Best-effort write of unsaved editor content. This handler must not return
    // a value, as jQuery turns that into a request for the leave-site dialog.
    $(window).on('beforeunload', () => {
      this.writeEditorsNow();
    });
  }

  // ─────────────────────────── Editor handlers ───────────────────────────

  /**
   * Callback function for when the content has changed of an editor.
   *
   * This is default functionality and super.onEditorTextChanged() must be
   * called first in child classes before any additional functionality.
   *
   * @param {EditorTab} editorComponent - The editor component instance.
   */
  onEditorTextChanged(editorComponent) {
    const path = editorComponent.getPath();
    const content = editorComponent.getContent();

    // each keystroke replaces the previously scheduled write, so the last
    // content wins
    this._editorWrites.schedule(path, seconds(0.2), () => this.vfs.updateFile(path, content));

    triggerPluginEvent('onEditorTextChanged', editorComponent);
  }

  /**
   * Write scheduled editor content right now, without waiting out its delay.
   *
   * @async
   * @param {?string} [path] - A single path, or null for every scheduled path.
   * @returns {Promise<void>} Resolves once the writes have completed.
   */
  async writeEditorsNow(path = null) {
    if (path === null) {
      await this._editorWrites.runAllNow();
    } else {
      await this._editorWrites.runNow(path);
    }
  }

  /**
   * Callback function when an editor instance becomes visible/active.
   *
   * This is default functionality and super.onSwitchToEditorTab() must be
   * called first in child classes before any additional functionality.
   *
   * @param {EditorTab} editorComponent - The editor component instance.
   */
  async onSwitchToEditorTab(editorComponent) {
    if (editorComponent.ready) {
      this.createLangWorker(editorComponent.proglang);
    }

    // Let menu and toolbar items set their enabled state
    this.view.invalidateActions();

    // Reload from VFS, which may have been changed externally
    await this.reloadEditorFileContent(editorComponent);

    // Activate the output tab this editor pairs with (opening it if needed)
    this._showSurface(editorComponent);

    triggerPluginEvent('onSwitchToEditorTab', editorComponent);
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
      await this.reloadEditorFileContent(editorComponent, { clearUndoStack: true });
    }
  }

  // ─────────────────────────── Image handlers ────────────────────────────

  onSwitchToImageTab(imageComponent) {
    // Do not terminate the language worker, because a switch back
    // to an editor tab may require loading of the same worker anyway.
    // this.terminateWorker();

    // Allow menus and buttons to consider state.
    this.view.invalidateActions();

    // Load file, currently regardless of whether it has changed.
    this.setImageFileContent(imageComponent);
    triggerPluginEvent('onSwitchToImageTab', imageComponent);
  }

  onImageReloadRequested(imageComponent) {
    if (!this.isFSReloadSuspended()) {
      this.setImageFileContent(imageComponent);
    }
  }

  onImageHidden(imageComponent) {
    triggerPluginEvent('onImageHide', imageComponent);
  }

  onImageDestroyed(imageComponent) {
    triggerPluginEvent('onImageDestroy', imageComponent);
  }

  // ─────────────────────────── Layout handlers ───────────────────────────

  onLayoutLoaded() {
    triggerPluginEvent('onLayoutLoaded');
  }

  // ─────────────────────────── Editor handlers (plugin events) ───────────

  onEditorFocused(editorComponent) {
    this.createLangWorker(editorComponent.proglang);
    triggerPluginEvent('onEditorFocus', editorComponent);
  }

  onEditorHidden(editorComponent) {
    triggerPluginEvent('onEditorHide', editorComponent);
  }

  onEditorLocked(editorComponent) {
    triggerPluginEvent('onEditorLock', editorComponent);
  }

  onEditorUnlocked(editorComponent) {
    triggerPluginEvent('onEditorUnlock', editorComponent);
  }

  onEditorResized(editorComponent) {
    triggerPluginEvent('onEditorContainerResize', editorComponent);
  }

  onEditorDestroyed(editorComponent) {
    this.writeEditorsNow(editorComponent.getPath());
    triggerPluginEvent('onEditorDestroy', editorComponent);
    // Retire any surface that just lost its last linked editor.
    this._pruneSurfaces(editorComponent);
  }

  onTabDragStopped(event, tab) {
    triggerPluginEvent('onTabDragStop', event, tab);
  }

  // ───────────────────────── Terminal key handlers ───────────────────────

  /** Stop the program currently running. A no-op when nothing is running. */
  stopProgram() {
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

  /**
   * Set the editor/terminal font size to an absolute value (e.g. picked from the
   * font-size menu). Named for the editor font specifically — this is unrelated
   * to browser zoom, which scales the page without going through this path.
   *
   * @param {number} size - The new font size in px.
   */
  setFontSize(size) {
    this.view.setFontSize(size);
  }

  /** Increase the editor font size by one step. */
  increaseFontSize() {
    this.view.increaseFontSize();
  }

  /** Decrease the editor font size by one step. */
  decreaseFontSize() {
    this.view.decreaseFontSize();
  }

  /** Reset the editor font size to the default. */
  setFontSizeDefault() {
    this.view.setFontSizeDefault();
  }

  /** Set the editor font size to the larger "demo" size. */
  setFontSizeDemo() {
    this.view.setFontSizeDemo();
  }

  /**
   * Set the editor theme.
   *
   * @param {string} theme - 'light' | 'dark'.
   */
  setTheme(theme) {
    this.view.setTheme(theme);
  }

  /**
   * Switch the layout between horizontal and vertical orientation.
   *
   * @param {string} orientation - 'horizontal' | 'vertical'.
   */
  setLayoutOrientation(orientation) {
    this.view.setOrientation(orientation);
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
   * Register a worker script for a programming language. Used by plugins to add
   * a language (e.g. Karel) to the same run pipeline as the built-in languages.
   *
   * @param {string} proglang - The programming language (= file extension).
   * @param {string} workerPath - Path to the worker script.
   * @param {string} pluginName - Name of the registering plugin; receives this
   *   language's custom worker messages via onWorkerMessage.
   */
  registerLangWorker(proglang, workerPath, pluginName) {
    this.langWorkerClient.registerLang(proglang, workerPath, pluginName);
  }

  // ─────────────────────────── Output surfaces ───────────────────────────

  /**
   * Link a proglang to an output surface. While an editor of that proglang is
   * active, the core keeps the surface open and frontmost; it is closed again
   * once no open editor links to it. Used by plugins (e.g. Karel links its
   * `karel` and `w` files to the canvas).
   *
   * @param {string} proglang - The programming language (= file extension).
   * @param {string} kind - The surface kind to open. Only 'canvas' is supported.
   */
  registerSurface(proglang, kind) {
    this._surfaces[proglang] = kind;
  }

  /**
   * Bring the surface paired with an editor to the front, opening it on demand;
   * for an unlinked editor, fall back to the terminal — but only once a canvas
   * exists, so a project that never uses one is left untouched. Activating an
   * already-frontmost tab (or one the user dragged into its own stack) is a
   * no-op, so a custom arrangement is preserved.
   *
   * @param {EditorTab} editorComponent - The newly active editor.
   */
  _showSurface(editorComponent) {
    if (this._surfaces[editorComponent?.proglang] === 'canvas') {
      this.view.addCanvasTab({ title: 'Canvas' });
    } else if (this.view.canvas) {
      this.term?.setActive();
    }
  }

  /**
   * Close the canvas once it has no linked editor left to serve. Counting the
   * survivors (rather than the editor being closed) makes this independent of
   * teardown ordering.
   *
   * @param {EditorTab} [closingEditor] - An editor being destroyed, excluded
   *   from the survivor count.
   */
  _pruneSurfaces(closingEditor = null) {
    if (!this.view.canvas) return;

    const stillLinked = this.view.getEditorComponents().some(
      (component) => component !== closingEditor && this._surfaces[component.proglang] === 'canvas'
    );
    if (!stillLinked) this.view.closeCanvas();
  }

  /**
  * Terminate the current language worker if it exists.
   */
  terminateWorker() {
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
       * A custom message from the worker that the core transport does not
       * recognise (e.g. a plugin language's draw commands). Route it to the
       * plugin that registered this proglang's worker; no other plugin sees it.
       *
       * @param {object} msg - The raw message posted by the worker.
       * @param {?string} owner - Name of the plugin that owns this language.
       */
      onWorkerMessage: (msg, owner) => {
        triggerPluginEventFor(owner, 'onWorkerMessage', msg);
      },

      /**
       * The worker is requesting a line of standard input from the terminal.
       */
      onRequestStdin: () => this.term.waitForInput(),

      /**
       * The worker is requesting the content of a single project file.
       *
       * Throws FileNotFoundError / FileTooLargeError, which the client turns
       * into a status for the worker.
       *
       * @param {string} path - The (VFS-absolute) file to read.
       * @returns {Promise<string|ArrayBuffer>} The file content.
       */
      onReadFile: (path) => this.vfs.readFile(path, MAX_FILE_SIZE),

      /**
       * A custom config button's command has finished executing.
       */
      onRunSnippetDone: () => {
        this.view.invalidateActions();
      },

      /**
       * The user's code has started running. If it does not finish quickly,
       * turn the run button into a stop button so the user can abort it.
       */
      onRunStarted: () => {
        this._runButtonTimer = setTimeout(() => {
          this._runButtonTimer = null;
          this.view.invalidateActions();
        }, 200);
      },

      /**
       * The user's code has finished running or was aborted. Reset the run/stop
       * button and clean up the terminal. Safe on normal completion too: there
       * is nothing pending to dispose and the cursor is already hidden.
       */
      onRunEnded: () => {
        // If the run finished before the stop-button delay elapsed, cancel it
        // so the button never flips — avoiding a flash for very short runs.
        if (this._runButtonTimer) {
          clearTimeout(this._runButtonTimer);
          this._runButtonTimer = null;
        }

        // Print inverted `%` to terminal if last line of output was not terminated by a `\n`.
        this.term?.printForgotNewline();

        // Dispose any pending stdin prompt left by an aborted run and hide the cursor.
        this.term?.disposeUserInput();

        // Set focus to the active editor.
        if (this._refocusEditorOnRunEnd) {
          this.view.getActiveEditor().focus?.();
        }

        this.view.invalidateActions();

        // Clean up resolver.
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
       * @param {array} newOrModifiedFiles - List of file objects, each with a
       * `path`, its `content`, and `temporary` when it is a build artifact.
       */
      onNewOrModifiedFiles: async (newOrModifiedFiles) => {
        if (!Array.isArray(newOrModifiedFiles)) {
          return;
        }

        var lastImage = null;

        for (const file of newOrModifiedFiles) {
          // One unwritable file must not cost us the rest of the batch.
          try {
            await this.vfs.writeProducedFile(file.path, file.content, file.temporary);
          } catch (err) {
            if (!(err instanceof FileExistsError)) throw err;
            this.term?.write(
              `\x1b[1;31mCannot write '${file.path}': a file or folder with that name already exists\x1b[0m\n`
            );
            continue;
          }

          if (isImageExtension(file.path)) {
            lastImage = file;
          }
        }

        if (lastImage) {
          this.view.addFileTab(lastImage.path);
        }

        // Recreate the file tree (IDE app only).
        await this.refreshFileTree?.();
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

          const tabComponent = this.view.layout.getFileTabComponents().find(
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

  getRunStatus() {
    if (this.langWorkerClient.isRunningCode) return "running";
    if (this.langWorkerClient.hasPendingCommand()) return "loading";
    // The worker could still be loading, but is ready to receive a pending command.
    if (this.langWorkerClient.isReady) return "ready";
  }

  /**
   * Run a file from the VFS. Returns a Promise that resolves when the run ends
   * (normally or aborted). Fire-and-forget callers (e.g. the run button via
   * runActiveTab) simply do not await it.
   *
   * @async
   * @param {string} filepath - The (VFS-absolute) file to run.
   * @param {object} [options]
   * @param {boolean} [options.clearTerm] - Clear the terminal before running.
   * @param {boolean} [options.runAs] - Use the runAs config.
   * @param {boolean} [options.fromShell] - The user typed this command.
   * @returns {Promise<void>} Resolves when the run has ended.
   */
  async runFile(filepath, options = {}) {
    if (!this.langWorkerClient.supports(getFileExtension(filepath))) {
      throw new Error(`cannot run '${filepath}': unsupported file type`);
    }
    if (this.langWorkerClient.isRunningCode) {
      throw new Error('a program is already running');
    }
    if (options.clearTerm) this.term.clear();
    this._refocusEditorOnRunEnd = !options.fromShell;

    // Notify plugins that a run is starting (e.g. the shell, to yield the
    // terminal and start program output on a fresh line).
    triggerPluginEvent('onRunStart');
    this.term.focus();

    await this.writeEditorsNow();
    const files = await this.getRunFiles(getFileExtension(filepath));

    // Only resolve the runAs config when actually running "as", because
    // getRunAsConfig() reads the active editor's path and throws when there is
    // no runnable active tab (e.g. when the shell launches a program).
    const runAsConfig = options.runAs ? this.getRunAsConfig() || undefined : undefined;

    // Set up the completion promise before starting the run so onRunEnded can
    // resolve it regardless of how quickly the worker responds.
    const runEnded = new Promise(resolve => { this._runEndResolver = resolve; });
    await this.langWorkerClient.runFile(
      getFileExtension(filepath), filepath, files, runAsConfig, !options.fromShell);
    return runEnded;
  }

  /**
   * Compile a source file without running it.
   *
   * @async
   * @param {string} filepath - The source file to compile.
   * @returns {Promise<void>} Resolves when the build has ended.
   */
  async compileFile(filepath) {
    const proglang = getFileExtension(filepath);
    if (proglang !== 'c') {
      throw new Error(`cannot compile '${filepath}': not a C file`);
    }
    if (this.langWorkerClient.isRunningCode) {
      throw new Error('a program is already running');
    }

    this._refocusEditorOnRunEnd = false;
    triggerPluginEvent('onRunStart');
    this.term.focus();

    await this.writeEditorsNow();
    const files = await this.getRunFiles(proglang);

    const compileEnded = new Promise(resolve => { this._runEndResolver = resolve; });
    await this.langWorkerClient.compileFile(proglang, filepath, files, false);
    return compileEnded;
  }

  /**
   * Run a previously generated binary by path.
   *
   * @async
   * @param {string} path - The (VFS-absolute) path of the binary.
   * @param {string[]} args - The command-line arguments.
   * @param {string} [cmd] - The command as the user typed it, used as argv[0].
   * @returns {Promise<void>} Resolves when the run has ended.
   */
  async execBinary(path, args = [], cmd = path) {
    if (!(await this.vfs.isTempBinary(path))) {
      throw new Error(`cannot run '${path}': not an executable`);
    }
    if (this.langWorkerClient.isRunningCode) {
      throw new Error('a program is already running');
    }

    this._refocusEditorOnRunEnd = false;
    triggerPluginEvent('onRunStart');
    this.term.focus();

    const binary = await this.vfs.readFile(path);
    await this.writeEditorsNow();
    const files = await this.getRunFiles('c');

    const runEnded = new Promise(resolve => { this._runEndResolver = resolve; });
    await this.langWorkerClient.runBinary(cmd, binary, args, files, path, false);
    return runEnded;
  }

  /** Run the active editor tab. A no-op when code is already running. */
  runActiveTab(options = {}) {
    if (this.langWorkerClient.isRunningCode) return;
    return this.runFile(this.view.getActiveEditor().getPath(), options);
  }

  /**
   * Run the command of a custom config button.
   *
   * @param {string} selector - Unique selector for the button, used to disable
   * it when running and disable it when it's done running.
   * @param {array} cmd - List of commands to execute.
   */
  async runSnippet(selector, cmd) {
    const $button = $(selector);
    if ($button.prop('disabled')) return;

    this.term.clear();

    const filename = this.view.getActiveEditor().getFilename();
    const proglang = getFileExtension(filename);
    await this.writeEditorsNow();
    const files = await this.getRunFiles(proglang);

    this.langWorkerClient.runSnippet(proglang, selector, filename, cmd, files);
  }

  /**
   * Render a set of config-declared buttons into the toolbar, each running its
   * own snippet in the language worker. The snippet is a list of lines, or a
   * single string that is split on newlines; `<filename>` inside it is replaced
   * by the active tab's module name when it runs.
   *
   * A button named after one of the app's own (see BUILTIN_BUTTONS) and given
   * an empty snippet is removed instead, so a config can drop the run button
   * for a lab where running the file makes no sense:
   *
   *   buttons:
   *     run:
   *
   * Called after the layout is set up, so the toolbar these are appended to
   * already exists.
   *
   * @param {object} buttons - Map of button label to its snippet.
   */
  addToolbarButtons(buttons) {
    if (!isObject(buttons)) return;

    Object.keys(buttons).forEach((name, index) => {
      const id = name.replace(/\s/g, '-').toLowerCase();
      const selector = `#${id}`;

      let cmd = buttons[name];
      if (isEmptyCommand(cmd)) {
        this.removeToolbarButton(name);
        return;
      }

      if (!Array.isArray(cmd)) {
        cmd = cmd.split('\n');
      }

      this.commands.register([{
        name: `config-${id}`,
        button: { id, label: name, class: `config-btn ${id}-btn`, position: 300 + index * 10 },
        isAvailable: ({ app }) => app.canRunActiveTab(),
        exec: ({ app }) => app.runSnippet(selector, cmd),
      }]);

      this.view.surfaces.renderButton(`config-${id}`, $('#toolbar'));
    });
  }

  /**
   * Drop one of the app's own toolbar buttons, along with the command behind
   * it, so any keyboard shortcut for it stops working as well. Names that are
   * not one of those buttons are ignored.
   *
   * @param {string} name - The name the config uses for the button.
   */
  removeToolbarButton(name) {
    const button = BUILTIN_BUTTONS[name.trim().toLowerCase()];
    if (!button) return;

    this.commands.removeCommand(button.command);
    $(`#${button.id}`).remove();
  }

  /**
   * Stop the program the user is currently running: restart the worker so the
   * next run starts fresh, then clear any pending output and print a termination
   * notice. The restart triggers onRunEnded, which resets the UI and terminal.
   */
  stopRunningProgramManually() {
    this.term?.clearTermWriteBuffer();
    this.term?.cleanWriteln('\x1b[1;31mProcess terminated\x1b[0m');
    this.langWorkerClient.restart();
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
   * Build the file payload for a run.
   *
   * Languages whose worker reads files on demand get a list without content,
   * so a large project costs nothing to start; the worker pulls what it opens
   * back through `onReadFile`. Everything else still gets full content up front.
   *
   * Course-supplied files that the student never sees are ordinary (read-only)
   * VFS files, so they need nothing special here.
   *
   * @param {string} proglang - The language about to run.
   * @returns {Promise<object[]>} Objects with `path`, and `content` when eager.
   */
  async getRunFiles(proglang) {
    return this.langWorkerClient.usesLazyFiles(proglang)
      ? this.vfs.getFileList()
      : this.vfs.getAllFiles();
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
    const status = this.getRunStatus();
    if (status === "running" || status === "loading") return false;
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
  async reloadEditorFileContent(editorComponent, { clearUndoStack = false } = {}) {
    const path = editorComponent.getPath();
    if (!path) return;

    try {
      const content = await this.vfs.readFile(path, MAX_FILE_SIZE);

      triggerPluginEvent('onEditorBeforeReload', editorComponent);
      try {
        editorComponent.reloadContent(content, { clearUndoStack });
      } finally {
        triggerPluginEvent('onEditorContentChanged', editorComponent);
      }
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
  reloadOpenFiles() {
    for (const component of this.view.getTabComponents()) {
      if (component.getComponentName() === 'editor') {
        this.onEditorReloadRequested(component);
      } else if (component.getComponentName() === 'image') {
        this.onImageReloadRequested(component);
      }
    }
  }
}
