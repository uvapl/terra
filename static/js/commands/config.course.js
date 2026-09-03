// Command config shared by the exam and lab pages: the run button, plus the
// clear-terminal button and its global Cmd/Ctrl-K shortcut. Neither page has a
// menubar, so the shortcut needs installGlobalKeyboard() in the controller.
//
// Buttons declared in a course-site config or a lab.yml are registered at
// render time by the app (addToolbarButtons).

import { makeRunButtonCommand } from './run.js';
import { clearTerminalCommand, clearTerminalButton } from './terminal.js';

export default {
  commands: [
    { ...makeRunButtonCommand(), scope: 'editor', bindKey: 'mod-enter' },
    { ...clearTerminalCommand, button: clearTerminalButton },
  ],
};
