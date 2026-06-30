import { getFileExtension, isImageExtension } from '../lib/helpers.js'
import { FileNotFoundError, FileTooLargeError } from '../fs/vfs.js';
import BaseApp from './app.base.js';
import { triggerPluginEvent, triggerPluginEventFor } from '../lib/plugin-manager.js';
import { MAX_FILE_SIZE } from '../constants.js';

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

  /** Timer ID for the delayed run-button → stop-button flip, or null. */
  _runButtonTimer = null;

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
    triggerPluginEvent('onEditorTextChanged', editorComponent);
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

    this.view.invalidateActions();

    await this.setEditorFileContent(editorComponent);
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
      await this.setEditorFileContent(editorComponent, { clearUndoStack: true });
    }
    triggerPluginEvent('onEditorContentChanged', editorComponent);
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
    triggerPluginEvent('onEditorDestroy', editorComponent);
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
        this.view.getActiveEditor().focus?.();

        // Reset the run/stop button and re-pull availability. The run button's
        // predicate handles the case where the active tab is not runnable (e.g.
        // code was launched via the file-tree context menu in the IDE).
        // this.view.runEnded();

        this.view.invalidateActions();

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
            const tabComponent = this.view.getFileTabComponents().find((component) => {
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

          const tabComponent = this.view.getFileTabComponents().find(
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

    // Notify plugins that a run is starting (e.g. the shell, to yield the
    // terminal and start program output on a fresh line).
    triggerPluginEvent('onRunStart');
    this.term.focus();

    let files = await this.vfs.getAllFiles();
    files = files.concat(this.getHiddenFiles());

    // Only resolve the runAs config when actually running "as", because
    // getRunAsConfig() reads the active editor's path and throws when there is
    // no runnable active tab (e.g. when the shell launches a program).
    const runAsConfig = options.runAs ? this.getRunAsConfig() || undefined : undefined;

    // Set up the completion promise before starting the run so onRunEnded can
    // resolve it regardless of how quickly the worker responds.
    const runEnded = new Promise(resolve => { this._runEndResolver = resolve; });
    await this.langWorkerClient.runFile(getFileExtension(filepath), filepath, files, runAsConfig);
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
    let files = await this.vfs.getAllFiles();
    files = files.concat(this.getHiddenFiles());

    this.langWorkerClient.runSnippet(proglang, selector, filename, cmd, files);
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
