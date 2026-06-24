////////////////////////////////////////////////////////////////////////////////
// Shared run/stop command definitions.
//
// These are the only commands every app variant needs: the run button itself
// (a `button` surface gated by a predicate) and, for variants that install a
// global keyboard, the Ctrl-C "kill process" interrupt.
//
// Placement of the button is the layout's job — the command only declares its
// id/label/class. Whether a variant also exposes these as a menu entry or a
// keyboard shortcut is decided by the variant's command config (see
// config.<variant>.js); a command's `menuItem`/`bindKey` is simply inert in a
// variant that never builds a menu or installs the global keyboard.
////////////////////////////////////////////////////////////////////////////////

/**
 * Build the run-button command. The only per-variant difference is whether the
 * terminal is cleared before each run (the embed variant clears; the rest do
 * not), so that is parameterised here.
 *
 * @param {object} [runOptions] - Options forwarded to app.runCode().
 * @returns {object} A command with a `button` surface.
 */
export const makeRunButtonCommand = (runOptions = {}) => ({
  name: 'runTab',
  button: { id: 'run-code', label: 'Run', class: 'primary-btn run-user-code-btn', position: -100 },
  isAvailable: ({ app }) => app.canRunActiveTab(),
  exec: ({ app }) => app.runCode(runOptions),
});

/** The default run-button command (no terminal clear), used by most variants. */
export const runButtonCommand = makeRunButtonCommand();

/**
 * The IDE additionally binds the run action to a keyboard shortcut and a menu
 * entry, and exposes Ctrl-C to interrupt a running program. These ride on top
 * of the same button surface and predicate.
 */
export const ideRunCommands = [
  {
    ...runButtonCommand,
    scope: 'editor',
    bindKey: 'mod-enter',
    menuItem: { path: 'Run/Current Tab', position: 100 },
  },
  {
    // Ctrl-C interrupts a running program from anywhere. The isAvailable guard
    // means it only intercepts the key while code is running; otherwise the key
    // falls through so editor/terminal copy keeps working.
    name: 'killProcess', scope: 'global', bindKey: 'ctrl-c',
    menuItem: { path: 'Run/Kill Process', position: 110 },
    isAvailable: ({ app }) => app.langWorkerClient.isRunningCode,
    exec: ({ app }) => app.terminateWorker(),
  },
];
