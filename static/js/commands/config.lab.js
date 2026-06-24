// Lab command config: the run button, plus the clear-terminal button and its
// global Cmd/Ctrl-K shortcut (no menubar). The shortcut needs
// installGlobalKeyboard() in the lab controller.
import { runButtonCommand } from './run.js';
import { clearTerminalCommand, clearTerminalButton } from './terminal.js';

export default {
  commands: [
    runButtonCommand,
    { ...clearTerminalCommand, button: clearTerminalButton },
  ],
};
