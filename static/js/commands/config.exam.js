// Exam command config: the run button plus keyboard shortcuts for run and clear
// (no menubar). The exam-specific config buttons are data-driven and registered
// at render time by the layout (addToolbarButtonsFromConfig).
import { makeRunButtonCommand } from './run.js';
import { clearTerminalCommand, clearTerminalButton } from './terminal.js';

export default {
  commands: [
    // Run: the toolbar button plus Cmd/Ctrl-Enter while an editor is focused
    // (editor-scope, dispatched through Ace — matches the IDE). Editor-scope
    // shortcuts bind via the controller's onEditorCreated (surfaces
    // .registerEditorCommands) in every variant, so no global keyboard install
    // is needed for this one.
    { ...makeRunButtonCommand(), scope: 'editor', bindKey: 'mod-enter' },

    // Clear: the toolbar button plus a global Cmd/Ctrl-K shortcut (so it fires
    // from the terminal too). The shortcut needs installGlobalKeyboard() in the
    // exam controller.
    { ...clearTerminalCommand, button: clearTerminalButton },
  ],
};
