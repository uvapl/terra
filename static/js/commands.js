////////////////////////////////////////////////////////////////////////////////
// Command registry.
//
// Declares user-exposed commands.
//
// A *command* is the single declaration of "a thing the user can do": its name,
// an optional keyboard shortcut, an optional menu location, and the function to
// run. From this one registry we build the menubar dynamically and bind the
// keyboard, so a command (core or plugin) is declared in exactly one place.
//
//   commands.addCommand({
//     name: 'quicksave',                       // unique id
//     hint: 'save the active file to disk',    // description (optional)
//     scope: 'editor' | 'global',              // where the key is dispatched
//     bindKey: 'mod-s',                        // see bindKey below (optional)
//     menuItem: { path: 'File/Save', position: 210 }, // optional menu entry
//     isAvailable: (editor) => !!editor,       // optional guard (global scope)
//     exec: someFunction,                      // function reference, OR…
//     command: 'undo',                         // …name of a native Ace command
//   });
//
// bindKey
// -------
// Either a single token string (preferred) or a `{ mac, win }` escape hatch for
// the rare case that needs fully manual per-platform keys.
//
// Token modifiers in the string form:
//   - mod    -> Cmd on Mac, Ctrl on Win/Linux (the OS "command" modifier).
//   - option -> Ctrl on Mac, Alt on Win/Linux (the browser-conflict-safe one,
//               e.g. `option-w` to close a tab without hitting the browser's
//               own Ctrl-W on Windows).
//   - ctrl / alt / shift / meta -> the literal modifier keys.
//
//   ⚠️ NOTE: despite the name, `option` does NOT resolve to the Mac ⌥ key — it
//   resolves to Mac Ctrl. Use the literal `alt` token for ⌥. The name is a
//   deliberate project choice; keep this caveat in mind when reading bindings.
//
// keys (display only)
// -------------------
// When a shortcut is owned natively by Ace (undo, copy, …) we must not bind it
// ourselves, but still want to show its keystroke in the menu. Such commands
// omit `bindKey` and set `keys` (same token syntax) purely for display.
//
// scope
// -----
//   - 'editor': dispatched through Ace's own command system (focus-scoped). Only
//     commands with both `bindKey` and `exec` are registered into Ace; native
//     aliases (those carrying `command`) are left to Ace's built-in binding.
//   - 'global': dispatched by a single capture-phase document key listener here,
//     so it fires even while the editor or terminal textarea has focus.
////////////////////////////////////////////////////////////////////////////////

import Terra from './terra.js';

const _commands = new Map(); // name -> command
const _submenus = new Map(); // 'View/Font size' -> { position, id }
const _rawItems = [];        // { path (parent), position, html }

// Precomputed [{ binding, cmd }] for global shortcuts, filled by
// installGlobalKeyboard so the keydown handler does not re-parse on every press.
let _globalBindings = [];

// ===========================================================================
// Registration
// ===========================================================================

function addCommand(cmd) {
  if (!cmd || !cmd.name) {
    throw new Error('commands.addCommand: a command needs a unique `name`');
  }
  _commands.set(cmd.name, cmd);
  return cmd;
}

function addCommands(list) {
  list.forEach(addCommand);
}

/**
 * Declare metadata for a submenu / top-level menu container (its position among
 * siblings and, optionally, a fixed DOM id on its <ul> so existing code that
 * targets e.g. `#font-size-menu` keeps working).
 *
 * @param {string} path - Full container path, e.g. 'View/Font size'.
 * @param {object} opts - { position, id }.
 */
function configureSubmenu(path, opts) {
  _submenus.set(path, opts);
}

/**
 * Register a raw <li> (or fragment) that is not a command, e.g. the data-driven
 * theme / font-size value lists or the Git branch placeholder. Wired up by the
 * code that owns them (layout.js, git.js), not by this registry.
 *
 * @param {object} item - { path (parent container), position, html }.
 */
function addMenuItem(item) {
  _rawItems.push(item);
}

function getCommands() {
  return [..._commands.values()];
}

// ===========================================================================
// bindKey parsing / formatting
// ===========================================================================

/**
 * Resolve a single-char alpha key to a stable lowercase form so Shift-cased
 * events ('N') still match a binding written as 'n'. Other keys pass through.
 */
function normalizeKey(key) {
  return key.length === 1 ? key.toLowerCase() : key.toLowerCase();
}

/**
 * Pick the platform-relevant string from a bindKey value.
 *
 * @param {string|object} bindKey - Token string or `{ mac, win }`.
 * @returns {?string}
 */
function pickPlatformString(bindKey) {
  if (!bindKey) return null;
  if (typeof bindKey === 'string') return bindKey;
  return isMac() ? bindKey.mac : bindKey.win;
}

const MOD_TOKENS = new Set([
  'mod', 'option', 'cmd', 'command', 'meta', 'ctrl', 'control', 'alt', 'shift',
]);

/**
 * Split a combo string into its leading modifier tokens and the trailing key.
 * Parses modifiers greedily so the key may itself be a separator character
 * (e.g. 'ctrl--' -> mods ['ctrl'], key '-') or contain one.
 *
 * @param {string} str - e.g. 'mod-shift-d', 'ctrl--', 'ctrl-`'.
 * @returns {{ mods: string[], key: string }}
 */
function splitCombo(str) {
  const parts = str.split('-');
  const mods = [];
  let i = 0;
  while (i < parts.length - 1 && MOD_TOKENS.has(parts[i].toLowerCase())) {
    mods.push(parts[i]);
    i++;
  }
  return { mods, key: parts.slice(i).join('-') };
}

/**
 * Parse a bindKey into a normalized combo `{ key, ctrl, meta, shift, alt }`
 * resolved for the current platform.
 *
 * @param {string|object} bindKey
 * @returns {?object}
 */
function parseBindKey(bindKey) {
  const str = pickPlatformString(bindKey);
  if (!str) return null;

  const { mods, key } = splitCombo(str);
  const combo = { key: normalizeKey(key) };

  for (const part of mods) {
    switch (part.toLowerCase()) {
      case 'mod': isMac() ? (combo.meta = true) : (combo.ctrl = true); break;
      case 'option': isMac() ? (combo.ctrl = true) : (combo.alt = true); break;
      case 'cmd': case 'command': case 'meta': combo.meta = true; break;
      case 'ctrl': case 'control': combo.ctrl = true; break;
      case 'alt': combo.alt = true; break;
      case 'shift': combo.shift = true; break;
    }
  }

  return combo;
}

/**
 * Whether a parsed combo matches a keyboard event exactly (every modifier the
 * combo declares present, all others absent).
 */
function comboMatches(combo, event) {
  return normalizeKey(event.key) === combo.key
    && !!combo.ctrl === event.ctrlKey
    && !!combo.meta === event.metaKey
    && !!combo.shift === event.shiftKey
    && !!combo.alt === event.altKey;
}

/**
 * Convert a bindKey to Ace's `{ win, mac }` string form for editor commands.
 */
function toAceBindKey(bindKey) {
  if (bindKey && typeof bindKey === 'object') {
    return { win: bindKey.win, mac: bindKey.mac };
  }

  const { mods, key } = splitCombo(String(bindKey));
  const win = [];
  const mac = [];
  for (const part of mods) {
    switch (part.toLowerCase()) {
      case 'mod': win.push('Ctrl'); mac.push('Command'); break;
      case 'option': win.push('Alt'); mac.push('Ctrl'); break;
      case 'ctrl': case 'control': win.push('Ctrl'); mac.push('Ctrl'); break;
      case 'alt': win.push('Alt'); mac.push('Option'); break;
      case 'shift': win.push('Shift'); mac.push('Shift'); break;
      case 'cmd': case 'command': case 'meta': win.push('Ctrl'); mac.push('Command'); break;
    }
  }
  const cap = key.length === 1 ? key.toUpperCase() : key;
  return { win: [...win, cap].join('-'), mac: [...mac, cap].join('-') };
}

const KEY_GLYPHS = {
  enter: '⏎',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  tab: 'Tab',
  space: 'Space',
};

function formatKeyGlyph(key) {
  const lower = key.toLowerCase();
  if (KEY_GLYPHS[lower]) return KEY_GLYPHS[lower];
  return key.length === 1 ? key.toUpperCase() : key;
}

/**
 * Render a bindKey (or display-only `keys`) into the menu's keystroke string,
 * using ⌘ ⌃ ⌥ ⇧ glyphs on Mac and Ctrl/Alt/Shift words elsewhere.
 *
 * @param {string|object} spec
 * @returns {string} Empty string when there is nothing to show.
 */
function formatKeys(spec) {
  const str = pickPlatformString(spec);
  if (!str) return '';

  const mac = isMac();
  const { mods: modTokens, key } = splitCombo(str);
  const mods = modTokens.map((part) => {
    switch (part.toLowerCase()) {
      case 'mod': return mac ? '⌘' : 'Ctrl';
      case 'option': return mac ? '⌃' : 'Alt';
      case 'ctrl': case 'control': return mac ? '⌃' : 'Ctrl';
      case 'alt': return mac ? '⌥' : 'Alt';
      case 'shift': return mac ? '⇧' : 'Shift';
      case 'cmd': case 'command': case 'meta': return mac ? '⌘' : 'Win';
      default: return part;
    }
  });

  return [...mods, formatKeyGlyph(key)].join(mac ? '' : '+');
}

// ===========================================================================
// Keyboard dispatch
// ===========================================================================

/**
 * Install the single capture-phase document listener for global-scope commands.
 * Capture phase is required so the shortcut fires before the editor or terminal
 * textarea consumes the key. Idempotent.
 */
function installGlobalKeyboard() {
  _globalBindings = getCommands()
    .filter((cmd) => cmd.scope === 'global' && cmd.bindKey)
    .map((cmd) => ({ binding: parseBindKey(cmd.bindKey), cmd }))
    .filter((entry) => entry.binding);

  document.removeEventListener('keydown', _onGlobalKeydown, true);
  document.addEventListener('keydown', _onGlobalKeydown, true);
}

function _activeEditor() {
  return Terra.app && Terra.app.getActiveEditor ? Terra.app.getActiveEditor() : null;
}

function _onGlobalKeydown(event) {
  for (const { binding, cmd } of _globalBindings) {
    if (!comboMatches(binding, event)) continue;
    const editor = _activeEditor();
    if (cmd.isAvailable && !cmd.isAvailable(editor)) continue;
    event.preventDefault();
    cmd.exec(editor);
    return;
  }
}

/**
 * Register the registry's editor-scope commands onto a freshly created editor.
 * Only commands with both `bindKey` and `exec` are translated into Ace commands;
 * native aliases (carrying `command`) are already bound by Ace itself.
 *
 * @param {EditorTab} editorComponent
 */
function registerEditorCommands(editorComponent) {
  const editorCommands = getCommands()
    .filter((cmd) => cmd.scope === 'editor' && cmd.bindKey && cmd.exec)
    .map((cmd) => ({
      name: cmd.name,
      bindKey: toAceBindKey(cmd.bindKey),
      exec: cmd.exec,
    }));

  if (editorCommands.length) {
    editorComponent.addCommands(editorCommands);
  }
}

// ===========================================================================
// Menu building
// ===========================================================================

function kebab(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Build the in-memory menu tree from registered commands, raw items and submenu
 * configuration. Returns the ordered list of top-level container nodes.
 */
function buildTree() {
  const root = { children: new Map() };

  const ensureContainer = (segments) => {
    let node = root;
    let pathSoFar = [];
    for (const segment of segments) {
      pathSoFar.push(segment);
      if (!node.children.has(segment)) {
        const cfg = _submenus.get(pathSoFar.join('/')) || {};
        node.children.set(segment, {
          type: 'container',
          label: segment,
          position: cfg.position ?? Infinity,
          id: cfg.id,
          children: new Map(),
        });
      }
      node = node.children.get(segment);
    }
    return node;
  };

  // Command leaves: the full path's last segment is the item label. `path` is a
  // '/'-separated string, or an array of segments when a label itself contains
  // a '/' (e.g. 'Toggle Editor/Terminal Focus').
  for (const cmd of _commands.values()) {
    if (!cmd.menuItem) continue;
    const segments = Array.isArray(cmd.menuItem.path)
      ? [...cmd.menuItem.path]
      : cmd.menuItem.path.split('/');
    const label = segments.pop();
    const parent = ensureContainer(segments);
    parent.children.set(`cmd:${cmd.name}`, {
      type: 'command',
      cmd,
      label,
      position: cmd.menuItem.position ?? Infinity,
    });
  }

  // Raw leaves: path points at the parent container.
  _rawItems.forEach((item, index) => {
    const parent = ensureContainer(item.path.split('/'));
    parent.children.set(`raw:${index}`, {
      type: 'raw',
      html: item.html,
      position: item.position ?? Infinity,
    });
  });

  const sortChildren = (node) => {
    const list = [...node.children.values()].sort((a, b) => a.position - b.position);
    list.forEach((child) => {
      if (child.type === 'container') sortChildren(child);
    });
    node.sorted = list;
  };
  sortChildren(root);

  return root.sorted;
}

function renderCommandLi(node) {
  const cmd = node.cmd;
  const $li = $('<li>').attr('id', `menu-item--${kebab(cmd.name)}`);
  if (cmd.disabled) $li.addClass('disabled');

  const keyDisplay = formatKeys(cmd.keys || cmd.bindKey);
  if (keyDisplay) {
    $li.html(`<span class="text">${node.label}</span><span class="keystroke">${keyDisplay}</span>`);
  } else {
    $li.text(node.label);
  }

  $li.on('click', () => {
    if ($li.hasClass('disabled')) return;
    const editor = _activeEditor();
    if (cmd.exec) {
      cmd.exec(editor);
    } else if (cmd.command && editor) {
      editor.editor.execCommand(cmd.command);
    }
  });

  return $li;
}

/**
 * Render a container's dropdown <ul>, inserting a separator whenever the
 * position "hundreds bucket" changes between consecutive children (this mirrors
 * the manual separators the old hardcoded menu used).
 */
function renderDropdown(node) {
  const $ul = $('<ul>');
  if (node.id) $ul.attr('id', node.id);

  let prevBucket = null;
  for (const child of node.sorted) {
    const bucket = Math.floor(child.position / 100);
    if (prevBucket !== null && bucket !== prevBucket) {
      $ul.append('<div class="separator"></div>');
    }
    prevBucket = bucket;

    if (child.type === 'container') {
      $ul.append(renderContainerLi(child, true));
    } else if (child.type === 'command') {
      $ul.append(renderCommandLi(child));
    } else {
      $ul.append(child.html);
    }
  }
  return $ul;
}

function renderContainerLi(node, isSubmenu) {
  const $li = $('<li>');
  if (isSubmenu) $li.addClass('has-dropdown');
  $li.append(document.createTextNode(node.label));
  $li.append(renderDropdown(node));
  return $li;
}

/**
 * (Re)build the menubar DOM from the registered commands into the given
 * container. Top-level menus list without separators; their dropdowns carry the
 * bucketed separators.
 *
 * @param {string} containerSelector - Selector for the `<ul class="menubar">`.
 */
function buildMenu(containerSelector) {
  const $menubar = $(containerSelector);
  $menubar.empty();

  for (const topNode of buildTree()) {
    const $li = $('<li>');
    $li.append(document.createTextNode(topNode.label));
    $li.append(renderDropdown(topNode));
    $menubar.append($li);
  }
}

/**
 * Check whether the current user OS is Mac.
 *
 * @returns {boolean} True when the system is detected as a Mac-like system.
 */
function isMac() {
  return /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform);
}

// ===========================================================================

const commands = {
  addCommand,
  addCommands,
  configureSubmenu,
  addMenuItem,
  getCommands,
  buildMenu,
  installGlobalKeyboard,
  registerEditorCommands,
  formatKeys,
};

// Expose on Terra so plugins (and the console) can register commands.
Terra.commands = commands;

export default commands;
