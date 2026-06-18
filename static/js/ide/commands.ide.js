////////////////////////////////////////////////////////////////////////////////
// Core IDE command declarations.
//
// Every menubar entry and keyboard shortcut of the IDE is declared here, in one
// place, and assembled into the menu + key bindings by commands.js. Each `exec`
// is a thin binding of a command to behaviour that lives on the app or one of
// its concerns (read lazily via Terra.app, at call time), never real logic.
//
// Command kinds used below:
//   - global   : scope 'global' + bindKey -> custom document key listener.
//   - editor   : scope 'editor' + `command` -> native Ace command (Ace owns the
//                key; `keys` is display-only) or + bindKey+exec -> Ace command.
//   - menu-only: no bindKey -> menu entry that runs `exec` on click.
//
// Menu placement uses `menuItem: { path, position }`. Within a dropdown, a
// separator is inserted automatically wherever the position "hundreds bucket"
// changes (e.g. 110 -> 200), reproducing the old manual separators.
////////////////////////////////////////////////////////////////////////////////

import commands from '../commands.js';
import Terra from '../terra.js';

// The editor of the currently active tab, resolved at call time.
const editor = () => Terra.app.getActiveEditor();

// Container ordering + fixed ids for the data-driven submenus (so layout.js can
// keep targeting #editor-theme-menu / #font-size-menu unchanged).
commands.configureSubmenu('File', { position: 100 });
commands.configureSubmenu('Edit', { position: 200 });
commands.configureSubmenu('Text', { position: 300 });
commands.configureSubmenu('View', { position: 400 });
commands.configureSubmenu('Run', { position: 500 });
commands.configureSubmenu('Git', { position: 600 });
commands.configureSubmenu('Edit/Find', { position: 200 });
commands.configureSubmenu('View/Theme', { position: 200, id: 'editor-theme-menu' });
commands.configureSubmenu('View/Font size', { position: 210, id: 'font-size-menu' });

commands.addCommands([
  // File ---------------------------------------------------------------------
  {
    name: 'newFile', scope: 'global', bindKey: 'option-n',
    menuItem: { path: 'File/New File', position: 100 }, exec: () => Terra.app.createFile(),
  },
  {
    name: 'newFolder', scope: 'global', bindKey: 'option-shift-n',
    menuItem: { path: 'File/New Folder', position: 110 }, exec: () => Terra.app.createFolder(),
  },
  {
    name: 'connectRepo', scope: 'global',
    menuItem: { path: 'File/Connect GitHub Repository', position: 200 },
    exec: () => Terra.app.connectRepo(),
  },
  {
    name: 'openFolder', scope: 'global', bindKey: 'ctrl-shift-o',
    menuItem: { path: 'File/Open Local Folder', position: 210 },
    exec: () => Terra.app.openLFSFolder(),
  },
  {
    name: 'closeFile', scope: 'global', bindKey: 'option-w',
    menuItem: { path: 'File/Close File', position: 300 }, exec: () => Terra.app.closeFile(),
  },
  {
    name: 'closeProject', scope: 'global', disabled: true,
    menuItem: { path: 'File/Close Project', position: 310 },
    exec: () => Terra.app.closeProject(),
  },

  // Edit ---------------------------------------------------------------------
  {
    name: 'undo', scope: 'editor', command: 'undo', keys: 'mod-z',
    menuItem: { path: 'Edit/Undo', position: 100 },
  },
  {
    name: 'redo', scope: 'editor', command: 'redo', keys: 'mod-shift-z',
    menuItem: { path: 'Edit/Redo', position: 110 },
  },
  {
    name: 'search', scope: 'editor', command: 'find', keys: 'mod-f',
    menuItem: { path: 'Edit/Find/Find', position: 100 },
  },
  {
    name: 'findNext', scope: 'editor', command: 'findnext', keys: 'ctrl-g',
    menuItem: { path: 'Edit/Find/Find Next', position: 110 },
  },
  {
    name: 'findPrevious', scope: 'editor', command: 'findprevious', keys: 'ctrl-shift-g',
    menuItem: { path: 'Edit/Find/Find Previous', position: 120 },
  },
  {
    name: 'replace', scope: 'editor', command: 'replace', keys: 'mod-alt-f',
    menuItem: { path: 'Edit/Find/Replace', position: 200 },
  },
  {
    name: 'copy', scope: 'editor', keys: 'mod-c',
    menuItem: { path: 'Edit/Copy', position: 300 }, exec: () => editor().copyToClipboard(),
  },
  {
    name: 'cut', scope: 'editor', keys: 'mod-x',
    menuItem: { path: 'Edit/Cut', position: 310 }, exec: () => editor().cutToClipboard(),
  },
  {
    name: 'paste', scope: 'editor', keys: 'mod-v',
    menuItem: { path: 'Edit/Paste', position: 320 }, exec: () => editor().pasteFromClipboard(),
  },
  {
    name: 'selectAll', scope: 'editor', command: 'selectall', keys: 'mod-a',
    menuItem: { path: 'Edit/Select All', position: 400 },
  },

  // Text ---------------------------------------------------------------------
  {
    name: 'toggleComment', scope: 'editor', command: 'togglecomment', keys: 'mod-/',
    menuItem: { path: 'Text/Toggle comment', position: 100 },
  },
  {
    name: 'moveLinesUp', scope: 'editor', command: 'movelinesup', keys: 'alt-up',
    menuItem: { path: 'Text/Move Lines Up', position: 200 },
  },
  {
    name: 'moveLinesDown', scope: 'editor', command: 'movelinesdown', keys: 'alt-down',
    menuItem: { path: 'Text/Move Lines Down', position: 210 },
  },
  {
    name: 'duplicateLine', scope: 'editor', command: 'duplicateSelection', keys: 'mod-shift-d',
    menuItem: { path: 'Text/Duplicate Line', position: 300 },
  },
  {
    name: 'indent', scope: 'editor', command: 'blockindent', keys: 'tab',
    menuItem: { path: 'Text/Indent', position: 400 },
  },
  {
    name: 'outdent', scope: 'editor', command: 'blockoutdent', keys: 'shift-tab',
    menuItem: { path: 'Text/Outdent', position: 410 },
  },

  // View ---------------------------------------------------------------------
  {
    name: 'resetLayout', scope: 'global',
    menuItem: { path: 'View/Reset Layout', position: 100 }, exec: () => Terra.app.resetLayout(),
  },
  {
    name: 'increaseFontSize', scope: 'global', bindKey: 'ctrl-=',
    menuItem: { path: 'View/Font size/Increase', position: 100 },
    exec: () => Terra.app.layout.increaseFontSize(),
  },
  {
    name: 'decreaseFontSize', scope: 'global', bindKey: 'ctrl--',
    menuItem: { path: 'View/Font size/Decrease', position: 110 },
    exec: () => Terra.app.layout.decreaseFontSize(),
  },
  {
    name: 'defaultFontSize', scope: 'global', bindKey: 'ctrl-0',
    menuItem: { path: 'View/Font size/Default', position: 120 },
    exec: () => Terra.app.layout.setFontSizeDefault(),
  },
  {
    name: 'demoFontSize', scope: 'global', bindKey: 'ctrl-9',
    menuItem: { path: 'View/Font size/Demo Mode', position: 130 },
    exec: () => Terra.app.layout.setFontSizeDemo(),
  },
  {
    name: 'clearTerminal', scope: 'global', bindKey: 'mod-k',
    menuItem: { path: 'View/Clear Terminal', position: 310 }, exec: () => Terra.app.clearTerminal(),
  },
  {
    name: 'toggleFocus', scope: 'global', bindKey: 'ctrl-`',
    menuItem: { path: ['View', 'Toggle Editor/Terminal Focus'], position: 320 },
    exec: () => Terra.app.toggleEditorTerminalFocus(),
  },

  // Run ----------------------------------------------------------------------
  {
    name: 'runTab', scope: 'editor', bindKey: 'mod-enter',
    menuItem: { path: 'Run/Current Tab', position: 100 }, exec: () => Terra.app.runCode(),
  },
  {
    // Ctrl-C interrupts a running program from anywhere. The isAvailable guard
    // means it only intercepts the key while code is running; otherwise the key
    // falls through so editor/terminal copy keeps working.
    name: 'killProcess', scope: 'global', bindKey: 'ctrl-c',
    menuItem: { path: 'Run/Kill Process', position: 110 },
    isAvailable: () => Terra.app.langWorkerClient.isRunningCode,
    exec: () => Terra.app.terminateWorker(),
  },

  // Global, no menu entry -----------------------------------------------------
  {
    name: 'save', scope: 'global', bindKey: 'mod-s',
    exec: () => Terra.app.layout.dispatchEvent(new CustomEvent('saveFile')),
  },
]);

// Data-driven submenu items (not commands): the theme + font-size value lists
// and the Git branch placeholder. Their click handlers are wired by layout.js
// (theme/font size) and git.js (branch), keyed off the ids/data-val below.
commands.addMenuItem({ path: 'View/Theme', position: 100, html: '<li data-val="light">Light</li>' });
commands.addMenuItem({ path: 'View/Theme', position: 110, html: '<li data-val="dark">Dark</li>' });

[10, 11, 12, 14, 16, 18, 24, 30].forEach((size, index) => {
  commands.addMenuItem({
    path: 'View/Font size',
    position: 200 + index * 10,
    html: `<li data-val="${size}">${size}</li>`,
  });
});

commands.addMenuItem({
  path: 'Git',
  position: 100,
  html: '<li id="menu-item--branch" class="disabled">Branch</li>',
});
