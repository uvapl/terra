// Shared terminal command(s).
//
// clearTerminal is used by every variant that has a terminal, plus a global
// mod-k shortcut for variants that install the global keyboard. It carries no
// `button` surface by default: the IDE exposes it only as a menu entry, while
// the exam/lab variants add a `button` surface when registering it. This keeps
// the rule "a command with a `button` surface is a toolbar button" clean.

export const clearTerminalCommand = {
  name: 'clearTerminal',
  scope: 'global',
  bindKey: 'mod-k',
  exec: ({ app }) => app.clearTerminal(),
};

// The button surface variants add when they want clear-terminal in the toolbar.
export const clearTerminalButton = { id: 'clear-term', class: 'clear-term-btn', title: 'Clear terminal', position: 200 };
