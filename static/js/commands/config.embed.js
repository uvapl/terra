// Embed command config: only the run button (no menubar, no keyboard shortcuts).
// The embed variant clears the terminal before each run, so its run command is
// built with that option.
import { makeRunButtonCommand } from './run.js';

export default { commands: [makeRunButtonCommand({ clearTerm: true })] };
