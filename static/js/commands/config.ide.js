////////////////////////////////////////////////////////////////////////////////
// IDE command config.
//
// The full set of menubar entries and keyboard shortcuts for the IDE. The
// controller imports this and hands it to the command registry. Each
// `exec`/`isAvailable` receives a `{ app, editor }` context.
//
// Menu placement uses `menuItem: { path, position }`. Within a dropdown, a
// separator is inserted automatically wherever the position "hundreds bucket"
// changes (e.g. 110 -> 200), reproducing the old manual separators.
////////////////////////////////////////////////////////////////////////////////

import { ideRunCommands } from './run.js';
import { clearTerminalCommand } from './terminal.js';

// Container ordering + fixed ids for the data-driven submenus.
export const submenus = {
  'File': { position: 100 },
  'Edit': { position: 200 },
  'Text': { position: 300 },
  'View': { position: 400 },
  'Run': { position: 500 },
  'Git': { position: 600 },
  'Edit/Find': { position: 200 },
  'View/Theme': { position: 200, id: 'editor-theme-menu' },
  'View/Font size': { position: 210, id: 'font-size-menu' },
};

export const commands = [
  // File ---------------------------------------------------------------------
  {
    name: 'newFile', scope: 'global', bindKey: 'option-n',
    menuItem: { path: 'File/New File', position: 100 }, exec: ({ app }) => app.createFile(),
  },
  {
    name: 'newFolder', scope: 'global', bindKey: 'option-shift-n',
    menuItem: { path: 'File/New Folder', position: 110 }, exec: ({ app }) => app.createFolder(),
  },
  {
    name: 'connectRepo', scope: 'global',
    menuItem: { path: 'File/Connect GitHub Repository', position: 200 },
    exec: ({ app }) => app.connectRepo(),
  },
  {
    name: 'openFolder', scope: 'global', bindKey: 'ctrl-shift-o',
    menuItem: { path: 'File/Open Local Folder', position: 210 },
    exec: ({ app }) => app.openLFSFolder(),
  },
  {
    name: 'closeFile', scope: 'global', bindKey: 'option-w',
    menuItem: { path: 'File/Close File', position: 300 }, exec: ({ app }) => app.closeFile(),
  },
  {
    name: 'closeProject', scope: 'global', disabled: true,
    menuItem: { path: 'File/Close Project', position: 310 },
    exec: ({ app }) => app.closeProject(),
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
    menuItem: { path: 'Edit/Copy', position: 300 }, exec: ({ editor }) => editor.copyToClipboard(),
  },
  {
    name: 'cut', scope: 'editor', keys: 'mod-x',
    menuItem: { path: 'Edit/Cut', position: 310 }, exec: ({ editor }) => editor.cutToClipboard(),
  },
  {
    name: 'paste', scope: 'editor', keys: 'mod-v',
    menuItem: { path: 'Edit/Paste', position: 320 }, exec: ({ editor }) => editor.pasteFromClipboard(),
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
    menuItem: { path: 'View/Reset Layout', position: 100 }, exec: ({ app }) => app.resetLayout(),
  },
  {
    name: 'increaseFontSize', scope: 'global', bindKey: 'ctrl-=',
    menuItem: { path: 'View/Font size/Increase', position: 100 },
    exec: ({ app }) => app.view.increaseFontSize(),
  },
  {
    name: 'decreaseFontSize', scope: 'global', bindKey: 'ctrl--',
    menuItem: { path: 'View/Font size/Decrease', position: 110 },
    exec: ({ app }) => app.view.decreaseFontSize(),
  },
  {
    name: 'defaultFontSize', scope: 'global', bindKey: 'ctrl-0',
    menuItem: { path: 'View/Font size/Default', position: 120 },
    exec: ({ app }) => app.view.setFontSizeDefault(),
  },
  {
    name: 'demoFontSize', scope: 'global', bindKey: 'ctrl-9',
    menuItem: { path: 'View/Font size/Demo Mode', position: 130 },
    exec: ({ app }) => app.view.setFontSizeDemo(),
  },
  {
    ...clearTerminalCommand,
    menuItem: { path: 'View/Clear Terminal', position: 310 },
  },
  {
    name: 'toggleFocus', scope: 'global', bindKey: 'ctrl-`',
    menuItem: { path: ['View', 'Toggle Editor/Terminal Focus'], position: 320 },
    exec: ({ app }) => app.toggleEditorTerminalFocus(),
  },

  // Run ----------------------------------------------------------------------
  ...ideRunCommands,

  // Global, no menu entry -----------------------------------------------------
  {
    name: 'save', scope: 'global', bindKey: 'mod-s',
    exec: ({ app }) => app.saveFile(),
  },
];

// Data-driven submenu items (not commands): the theme + font-size value lists
// and the Git branch placeholder. Their click handlers are wired by layout.js
// (theme/font size) and git.js (branch), keyed off the ids/data-val below.
export const rawItems = [
  { path: 'View/Theme', position: 100, html: '<li data-val="light">Light</li>' },
  { path: 'View/Theme', position: 110, html: '<li data-val="dark">Dark</li>' },
  ...[10, 11, 12, 14, 16, 18, 24, 30].map((size, index) => ({
    path: 'View/Font size',
    position: 200 + index * 10,
    html: `<li data-val="${size}">${size}</li>`,
  })),
  { path: 'Git', position: 100, html: '<li id="menu-item--branch" class="disabled">Branch</li>' },
];

export default { commands, submenus, rawItems };
