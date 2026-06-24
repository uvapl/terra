////////////////////////////////////////////////////////////////////////////////
// Command surfaces — the view side of the command system.
//
// Everything that touches the DOM or the keyboard for commands lives here:
// building the menubar, rendering toolbar buttons, binding the global keyboard,
// registering editor-scope shortcuts into Ace, and reflecting availability onto
// the UI (invalidate). It reads the catalog and dispatches through a
// CommandRegistry; it never executes a command directly, so the "what an action
// does" (registry, app-owned) stays separate from "how it is surfaced" (here,
// view-owned).
//
// bindKey
// -------
// Either a single token string (preferred) or a `{ mac, win }` escape hatch.
// Token modifiers in the string form:
//   - mod    -> Cmd on Mac, Ctrl on Win/Linux (the OS "command" modifier).
//   - option -> Ctrl on Mac, Alt on Win/Linux (browser-conflict-safe).
//   - ctrl / alt / shift / meta -> the literal modifier keys.
//   ⚠️ `option` resolves to Mac Ctrl, NOT the ⌥ key — use `alt` for ⌥.
//
// keys (display only): when Ace owns a shortcut natively we must not bind it but
// still show its keystroke; such commands omit `bindKey` and set `keys`.
//
// scope: 'editor' commands are dispatched through Ace (focus-scoped); 'global'
// commands by the single capture-phase document listener installed here.
////////////////////////////////////////////////////////////////////////////////

export default class CommandSurfaces {
  /**
   * @param {CommandRegistry} registry - The catalog + dispatch this surfaces.
   */
  constructor(registry) {
    this.registry = registry;

    // Precomputed [{ binding, cmd }] for global shortcuts, filled by
    // installGlobalKeyboard so the keydown handler does not re-parse each press.
    this._globalBindings = [];
  }

  // ===========================================================================
  // Enablement
  // ===========================================================================

  /**
   * Re-evaluate every command's availability and reflect it onto its surfaces:
   * the menu `<li>` (a `disabled` class) and, if present, the `button` surface's
   * `disabled` property. Commands without an `isAvailable` predicate are left
   * untouched (their static state stands).
   *
   * This is the single "pull" pass: the app rings the bell by calling this on
   * the transitions that change availability (tab switch, worker load/ready, run
   * end) and every control re-decides its enabled state from one predicate.
   */
  invalidate() {
    for (const cmd of this.registry.getCommands()) {
      if (!cmd.isAvailable) continue;
      const enabled = this.registry.available(cmd);
      $(`#menu-item--${kebab(cmd.name)}`).toggleClass('disabled', !enabled);
      if (cmd.button) {
        $(`#${cmd.button.id}`).prop('disabled', !enabled);
      }
    }
  }

  // ===========================================================================
  // Button surfaces
  // ===========================================================================

  /**
   * Build the toolbar: render every registered command that has a `button`
   * surface into the given container, ordered by `button.position`. The mirror
   * of buildMenu — a single config-driven pass into a static container, so the
   * toolbar and menubar are built the same way at the same time, with no layout
   * reaching into GoldenLayout internals. Each button's click dispatches through
   * the registry (see renderButton).
   *
   * @param {string} containerSelector - Selector for the toolbar container.
   */
  buildToolbar(containerSelector) {
    const $container = $(containerSelector);
    const buttonCommands = this.registry.getCommands()
      .filter((cmd) => cmd.button)
      .sort((a, b) => (a.button.position ?? Infinity) - (b.button.position ?? Infinity));

    for (const cmd of buttonCommands) {
      this.renderButton(cmd.name, $container);
    }
  }

  /**
   * Render a command's `button` surface into the given container and wire its
   * click to dispatch through the registry. Placement is the caller's decision
   * (it supplies the container); the command declares only id/label/class and an
   * optional title (for icon buttons with no visible text).
   *
   * The button may live in persistent page chrome (e.g. the IDE navbar) that
   * survives a layout reset, so it is created only once but its click is always
   * (re)bound. Its initial enabled state matches the command's availability now,
   * so a command with no predicate (e.g. clear terminal) renders enabled rather
   * than waiting for an invalidate() that would never touch it.
   *
   * @param {string} name - The command name.
   * @param {jQuery} $container - The container to append the button to.
   */
  renderButton(name, $container) {
    const cmd = this.registry.get(name);
    if (!cmd || !cmd.button) return;

    const { id, label = '', class: cls = '', title, position = 0 } = cmd.button;
    const selector = `#${id}`;

    if (!$(selector).length) {
      const titleAttr = title ? ` title="${title}"` : '';
      const disabledAttr = this.registry.available(cmd) ? '' : ' disabled';
      $container.append(`<button id="${id}" class="button ${cls}"${titleAttr}${disabledAttr} style="order:${position}">${label}</button>`);
    }

    $(selector).off('click.cmd').on('click.cmd', () => {
      if (!$(selector).prop('disabled')) this.registry.run(name);
    });
  }

  // ===========================================================================
  // Keyboard dispatch
  // ===========================================================================

  /**
   * Install the single capture-phase document listener for global-scope
   * commands. Capture phase is required so the shortcut fires before the editor
   * or terminal textarea consumes the key. Idempotent.
   */
  installGlobalKeyboard() {
    this._globalBindings = this.registry.getCommands()
      .filter((cmd) => cmd.scope === 'global' && cmd.bindKey)
      .map((cmd) => ({ binding: parseBindKey(cmd.bindKey), cmd }))
      .filter((entry) => entry.binding);

    document.removeEventListener('keydown', this._onGlobalKeydown, true);
    document.addEventListener('keydown', this._onGlobalKeydown, true);
  }

  // Arrow field so the reference is stable across (re)install for remove/add.
  _onGlobalKeydown = (event) => {
    for (const { binding, cmd } of this._globalBindings) {
      if (!comboMatches(binding, event)) continue;
      if (!this.registry.available(cmd)) continue;
      event.preventDefault();
      this.registry.run(cmd.name);
      return;
    }
  };

  /**
   * Register the registry's editor-scope commands onto a freshly created editor.
   * Only commands with both `bindKey` and `exec` are translated into Ace
   * commands; native aliases (carrying `command`) are already bound by Ace. The
   * Ace exec is wrapped to dispatch through the registry, so Ace's own editor
   * argument is ignored and the registry builds its own context.
   *
   * @param {EditorTab} editorComponent
   */
  registerEditorCommands(editorComponent) {
    const editorCommands = this.registry.getCommands()
      .filter((cmd) => cmd.scope === 'editor' && cmd.bindKey && cmd.exec)
      .map((cmd) => ({
        name: cmd.name,
        bindKey: toAceBindKey(cmd.bindKey),
        exec: () => this.registry.run(cmd.name),
      }));

    if (editorCommands.length) {
      editorComponent.addCommands(editorCommands);
    }
  }

  // ===========================================================================
  // Menu building
  // ===========================================================================

  /**
   * (Re)build the menubar DOM from the registered commands into the given
   * container. Top-level menus list without separators; their dropdowns carry
   * the bucketed separators.
   *
   * @param {string} containerSelector - Selector for the `<ul class="menubar">`.
   */
  buildMenu(containerSelector) {
    const $menubar = $(containerSelector);
    $menubar.empty();

    for (const topNode of this._buildTree()) {
      const $li = $('<li>');
      $li.append(document.createTextNode(topNode.label));
      $li.append(this._renderDropdown(topNode));
      $menubar.append($li);
    }
  }

  /**
   * Build the in-memory menu tree from registered commands, raw items and
   * submenu configuration. Returns the ordered list of top-level container
   * nodes.
   */
  _buildTree() {
    const root = { children: new Map() };

    const ensureContainer = (segments) => {
      let node = root;
      let pathSoFar = [];
      for (const segment of segments) {
        pathSoFar.push(segment);
        if (!node.children.has(segment)) {
          const cfg = this.registry.getSubmenu(pathSoFar.join('/'));
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

    // Command leaves: the full path's last segment is the item label. `path` is
    // a '/'-separated string, or an array of segments when a label itself
    // contains a '/' (e.g. 'Toggle Editor/Terminal Focus').
    for (const cmd of this.registry.getCommands()) {
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
    this.registry.getRawItems().forEach((item, index) => {
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

  _renderCommandLi(node) {
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
      this.registry.run(cmd.name);
      this.registry.context().editor?.focus();
    });

    return $li;
  }

  /**
   * Render a container's dropdown <ul>, inserting a separator whenever the
   * position "hundreds bucket" changes between consecutive children.
   */
  _renderDropdown(node) {
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
        $ul.append(this._renderContainerLi(child, true));
      } else if (child.type === 'command') {
        $ul.append(this._renderCommandLi(child));
      } else {
        $ul.append(child.html);
      }
    }
    return $ul;
  }

  _renderContainerLi(node, isSubmenu) {
    const $li = $('<li>');
    if (isSubmenu) $li.addClass('has-dropdown');
    $li.append(document.createTextNode(node.label));
    $li.append(this._renderDropdown(node));
    return $li;
  }
}

// ===========================================================================
// bindKey parsing / formatting (pure helpers)
// ===========================================================================

/**
 * Resolve a single-char alpha key to a stable lowercase form so Shift-cased
 * events ('N') still match a binding written as 'n'. Other keys pass through.
 */
function normalizeKey(key) {
  return key.toLowerCase();
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

function kebab(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Check whether the current user OS is Mac.
 *
 * @returns {boolean} True when the system is detected as a Mac-like system.
 */
function isMac() {
  return /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform);
}
