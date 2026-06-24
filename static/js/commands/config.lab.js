// Lab command config: the run button, plus the clear-terminal button and its
// global Cmd/Ctrl-K shortcut (no menubar). The shortcut needs
// installGlobalKeyboard() in the lab controller.
import { makeRunButtonCommand } from './run.js';
import { clearTerminalCommand, clearTerminalButton } from './terminal.js';

export default {
  commands: [
    { ...makeRunButtonCommand(), scope: 'editor', bindKey: 'mod-enter' },
    { ...clearTerminalCommand, button: clearTerminalButton },
  ],
};
