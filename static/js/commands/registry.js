// Command registry: manages commands available in the application.
//
// A command is the declaration of an action:
//
//    - the assigned name
//    - an optional keyboard shortcut
//    - an optional menu location
//    - an optional `button` surface
//    - an optional `isAvailable` predicate
//    - and the function to run
//
// Commands act on a target, which is the app itself. Additionally, a currently
// active editor may be determined and provided to the command.
//
// This registry catalogs all the commands, and the CommandSurfaces class in
// surfaces.js hooks these into the UI and binds keyboard shortcuts.
//
// An example command definition:
//
//   {
//     name: 'quicksave',                          // unique id
//     scope: 'editor' | 'global',                 // where the key is dispatched
//     bindKey: 'mod-s',                            // optional shortcut (see surfaces)
//     keys: 'mod-s',                               // optional display-only keystroke
//     menuItem: { path: 'File/Save', position: 210 }, // optional menu entry
//     button: { id, label, class },               // optional toolbar button surface
//     isAvailable: ({ app, editor }) => bool,      // optional availability guard
//     exec: ({ app, editor }) => { … },            // function, OR…
//     command: 'undo',                            // …name of a native Ace command
//   }

export default class CommandRegistry {
  /**
   * @param {object} target - the app that commands act on
   */
  constructor(target) {
    this.target = target;
    this._commands = new Map(); // name to command
    this._submenus = new Map(); // 'View/Font size' to { position, id }
    this._rawItems = [];        // { path (parent), position, html }
  }

  /**
   * Provides the context for an action.
   *
   * @returns {{ app: object, editor: ?object }}
   */
  context() {
    return {
      app: this.target,
      editor: this.target.view?.getActiveEditor?.() ?? null,
    };
  }

  // ── Registration ──

  /**
   * Add a single command to the registry.
   *
   * @param {object} cmd
   */
  addCommand(cmd) {
    if (!cmd || !cmd.name) {
      throw new Error('CommandRegistry.addCommand: a command needs a unique `name`');
    }
    this._commands.set(cmd.name, cmd);
    return cmd;
  }

  /**
   * Add a number of commands to the registry.
   *
   * @param {object[]} list
   */
  addCommands(list) {
    list.forEach((cmd) => this.addCommand(cmd));
  }

  /**
   * Populate the registry from a variant's command config.
   *
   * @param {object[]} [commandList] - commands to register
   * @param {object} [opts]
   * @param {object} [opts.submenus] - map of container path to { position, id }
   * @param {object[]} [opts.rawItems] - raw menu items ({ path, position, html })
   */
  register(commandList = [], { submenus = {}, rawItems = [] } = {}) {
    this.addCommands(commandList);
    for (const [path, opts] of Object.entries(submenus)) {
      this.configureSubmenu(path, opts);
    }
    rawItems.forEach((item) => this.addMenuItem(item));
  }

  /**
   * Clear the catalog.
   */
  reset() {
    this._commands.clear();
    this._submenus.clear();
    this._rawItems.length = 0;
  }

  /**
   * Add a menu or submenu.
   *
   * @param {string} path - full container path, e.g. 'View/Font size'
   * @param {object} opts - { position, id } position among siblings and optionally a fixed
   * DOM id on its <ul>
   */
  configureSubmenu(path, opts) {
    this._submenus.set(path, opts);
  }

  /**
   * Add a submenu for which the action is defined elsewhere; e.g. the
   * theme or font-size value lists, or the Git branch placeholder.
   *
   * @param {object} item - { path (parent container), position, html }
   */
  addMenuItem(item) {
    this._rawItems.push(item);
  }

  // ── Accessors (read by CommandSurfaces) ──

  get(name) {
    return this._commands.get(name);
  }

  getCommands() {
    return [...this._commands.values()];
  }

  getSubmenu(path) {
    return this._submenus.get(path) || {};
  }

  getRawItems() {
    return this._rawItems;
  }

  // ── Dispatch ──

  /**
   * Run a command by name, against the current context. Handles both `exec`
   * functions and native Ace `command` aliases. Unknown commands are ignored.
   *
   * @param {string} name
   */
  run(name) {
    const cmd = this._commands.get(name);
    if (!cmd) return;

    const ctx = this.context();
    if (cmd.exec) {
      cmd.exec(ctx);
    } else if (cmd.command && ctx.editor) {
      ctx.editor.editor.execCommand(cmd.command);
    }
  }

  /**
   * Whether a command is currently available. Commands that do not define
   * an `isAvailable` flag are always available.
   *
   * @param {object} cmd
   * @returns {boolean}
   */
  available(cmd) {
    return cmd.isAvailable ? !!cmd.isAvailable(this.context()) : true;
  }
}
