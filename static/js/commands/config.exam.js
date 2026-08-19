// Exam command config: the run button, plus keyboard shortcuts for run and
// clear (there is no menubar in this layout).
//
// The exam-specific config buttons are registered at render time by the
// layout (addToolbarButtonsFromConfig).

import { makeRunButtonCommand } from './run.js';
import { clearTerminalCommand, clearTerminalButton } from './terminal.js';

export default {
  commands: [
    { ...makeRunButtonCommand(), scope: 'editor', bindKey: 'mod-enter' },
    { ...clearTerminalCommand, button: clearTerminalButton },
  ],
};
