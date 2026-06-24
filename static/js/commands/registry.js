////////////////////////////////////////////////////////////////////////////////
// Command registry — the catalog of "things the user can do" and their dispatch.
//
// A *command* is the single declaration of an action: its name, an optional
// keyboard shortcut, an optional menu location, an optional `button` surface, an
// optional `isAvailable` predicate, and the function to run. Commands act on a
// *target* (the app): the registry is constructed with that target and injects a
// dispatch context into every exec/isAvailable, so command definitions never
// reach for a global. They are pure: "given an app (and the active editor), do
// X".
//
// This registry owns the catalog and the dispatch only — it knows nothing about
// the DOM. Rendering the menubar/buttons, binding the keyboard and reflecting
// availability onto the UI is the job of CommandSurfaces (commands/surfaces.js),
// which reads this registry. The app owns the registry; the controller owns the
// surfaces.
//
// Command shape:
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
////////////////////////////////////////////////////////////////////////////////

export default class CommandRegistry {
  /**
   * @param {object} target - The object commands act on (the app). Injected into
   * every exec/isAvailable via context(), so command defs stay global-free.
   */
  constructor(target) {
    this.target = target;
    this._commands = new Map(); // name -> command
    this._submenus = new Map(); // 'View/Font size' -> { position, id }
    this._rawItems = [];        // { path (parent), position, html }
  }

  /**
   * The dispatch context handed to every exec/isAvailable. The registry derives
   * the active editor itself so commands never reach for it.
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

  addCommand(cmd) {
    if (!cmd || !cmd.name) {
      throw new Error('CommandRegistry.addCommand: a command needs a unique `name`');
    }
    this._commands.set(cmd.name, cmd);
    return cmd;
  }

  addCommands(list) {
    list.forEach((cmd) => this.addCommand(cmd));
  }

  /**
   * Populate the registry from a variant's command config: the commands plus any
   * submenu metadata and raw (non-command) menu items they carry. This is the
   * single, explicit entry point each variant controller calls.
   *
   * @param {object[]} [commandList] - Commands to register.
   * @param {object} [opts]
   * @param {object} [opts.submenus] - Map of container path -> { position, id }.
   * @param {object[]} [opts.rawItems] - Raw menu items ({ path, position, html }).
   */
  register(commandList = [], { submenus = {}, rawItems = [] } = {}) {
    this.addCommands(commandList);
    for (const [path, opts] of Object.entries(submenus)) {
      this.configureSubmenu(path, opts);
    }
    rawItems.forEach((item) => this.addMenuItem(item));
  }

  /**
   * Clear the catalog. Rarely needed within a single app (commands are not
   * layout-bound and persist across a layout reset).
   */
  reset() {
    this._commands.clear();
    this._submenus.clear();
    this._rawItems.length = 0;
  }

  /**
   * Declare metadata for a submenu / top-level menu container (its position among
   * siblings and, optionally, a fixed DOM id on its <ul>).
   *
   * @param {string} path - Full container path, e.g. 'View/Font size'.
   * @param {object} opts - { position, id }.
   */
  configureSubmenu(path, opts) {
    this._submenus.set(path, opts);
  }

  /**
   * Register a raw <li> (or fragment) that is not a command, e.g. the data-driven
   * theme / font-size value lists or the Git branch placeholder.
   *
   * @param {object} item - { path (parent container), position, html }.
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
   * Run a command by name against the current context. Handles both `exec`
   * functions and native Ace `command` aliases (which run on the active editor).
   * A no-op for an unknown command.
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
   * Whether a command is currently available. Commands without an `isAvailable`
   * predicate are always available.
   *
   * @param {object} cmd
   * @returns {boolean}
   */
  available(cmd) {
    return cmd.isAvailable ? !!cmd.isAvailable(this.context()) : true;
  }
}
