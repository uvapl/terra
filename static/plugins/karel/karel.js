import { TerraPlugin } from '../../js/lib/plugin-manager.js';
import Terra from '../../js/terra.js';
import KarelRenderer from './karel-renderer.js';
import KarelWorld from './karel-world.js';
import { tokenize } from './runner/karel-lexer.js';
import { parse } from './runner/karel-parser.js';
import './mode-karel.js';

// Matches the `WORLD "name"` directive at the start of a statement line.
const WORLD_DIRECTIVE = /^[ \t]*WORLD\s+"([^"]*)"/im;

// Matches a line whose cursor sits inside the open quote of a WORLD directive,
// capturing what has been typed so far (the world-name prefix). Used to switch
// completion from keywords to world filenames.
const WORLD_NAME_CONTEXT = /^[ \t]*WORLD\s+"([^"]*)$/i;

// Bundled worlds shipped under static/plugins/karel/worlds/. A fetch can't list
// a directory, so the names we offer for completion are listed here explicitly.
const BUNDLED_WORLDS = ['test'];

const completions = (words, meta) =>
  words.map((value) => ({ caption: value, value, meta, score: 1000 }));

// Autocomplete entries, grouped by kind for a clearer popup. Structural keywords
// are conventionally uppercase, instructions camelCase, tests hyphen-lowercase —
// the language itself is case-insensitive.
const KAREL_COMPLETIONS = [
  ...completions([
    'BEGINNING-OF-PROGRAM', 'END-OF-PROGRAM', 'BEGINNING-OF-EXECUTION',
    'END-OF-EXECUTION', 'DEFINE', 'AS', 'BEGIN', 'END', 'ITERATE', 'TIMES',
    'WHILE', 'DO', 'IF', 'THEN', 'ELSE', 'WORLD', 'NOT',
    'SPEED', 'SLOW', 'SLOWER', 'SLOWEST', 'FAST',
  ], 'keyword'),
  ...completions(['move', 'turnLeft', 'pickbeeper', 'putbeeper', 'turnoff'], 'instruction'),
  ...completions([
    'front-is-clear', 'front-is-blocked', 'left-is-clear', 'left-is-blocked',
    'right-is-clear', 'right-is-blocked', 'next-to-a-beeper', 'not-next-to-a-beeper',
    'facing-north', 'not-facing-north', 'facing-south', 'not-facing-south',
    'facing-east', 'not-facing-east', 'facing-west', 'not-facing-west',
    'any-beepers-in-beeper-bag', 'no-beepers-in-beeper-bag',
  ], 'test'),
];

/**
 * List the world names (without the `.w` extension) that the `WORLD` directive
 * could resolve to: every `.w` file in the VFS, by basename, plus the bundled
 * worlds. Mirrors what `_loadWorldText` resolves against, so a completed name is
 * one a run can actually load.
 *
 * @returns {Promise<string[]>} Sorted, de-duplicated world names.
 */
const listWorldNames = async () => {
  const files = await Terra.app.vfs.getAllFiles();
  const fromVfs = files
    .map((file) => file.path.split('/').pop())
    .filter((name) => name.endsWith('.w'))
    .map((name) => name.slice(0, -'.w'.length));
  return [...new Set([...fromVfs, ...BUNDLED_WORLDS])].sort();
};

// A single shared Ace completer for Karel. Inside the `WORLD "…"` directive it
// offers the available world filenames; everywhere else it offers the keyword
// vocabulary. It only contributes inside `ace/mode/karel`, and declares hyphens
// as identifier characters so prefixes like "front-is-" complete correctly
// (Ace's default word regex stops at "-").
const KAREL_COMPLETER = {
  identifierRegexps: [/[a-zA-Z0-9\-]/],
  getCompletions: (editor, session, pos, prefix, callback) => {
    const modeId = session.$modeId || session.getMode?.().$id;
    if (modeId !== 'ace/mode/karel') {
      callback(null, []);
      return;
    }

    // Inside the open quote of a WORLD directive: offer world filenames. Ace's
    // identifier regex stops at the quote and at "." so we filter on the name
    // typed so far ourselves rather than relying on `prefix`.
    const fullLine = session.getLine(pos.row);
    const line = fullLine.slice(0, pos.column);
    const worldContext = line.match(WORLD_NAME_CONTEXT);
    if (worldContext) {
      const typed = worldContext[1].toLowerCase();
      // Close the string ourselves unless the directive already has a closing
      // quote right after the cursor. The quote rides along in `value`, so Ace's
      // own insert path adds it (and leaves the caret past it) when a name is
      // chosen.
      const closing = fullLine.slice(pos.column).startsWith('"') ? '' : '"';
      listWorldNames().then((names) => {
        callback(null, names
          .filter((name) => name.toLowerCase().startsWith(typed))
          .map((name) => ({
            caption: name,
            value: name + closing,
            meta: 'world',
            score: 1000,
          })));
      }).catch(() => callback(null, []));
      return;
    }

    callback(null, KAREL_COMPLETIONS);
  },
};

/**
 * Karel the robot language support. Registers a worker for the `.karel`
 * extension so the core Run button runs Karel through the same pipeline as C and
 * Python, and renders the world (both live runs and a static preview of the
 * declared WORLD) onto a canvas tab.
 */
export default class KarelPlugin extends TerraPlugin {
  name = 'karel';

  css = [];

  /**
   * Renderer and the canvas tab it is bound to.
   * @type {?KarelRenderer}
   */
  renderer = null;
  canvasTab = null;

  /**
   * Latest world snapshot awaiting a draw, and whether a draw is already
   * scheduled for the next animation frame.
   */
  _latestWorld = null;
  _drawScheduled = false;

  /**
   * Monotonic counter so a slower (async) world preview cannot overwrite a newer
   * one when the user switches tabs quickly.
   */
  _previewSeq = 0;

  onLayoutLoaded = () => {
    // Join the run pipeline. Idempotent, so re-firing on a layout reset is fine.
    Terra.app.registerLangWorker('karel', 'static/plugins/karel/runner/karel.worker.js', this.name);

    Terra.app.registerSurface('karel', 'canvas');
    Terra.app.registerSurface('w', 'canvas');
  }

  /**
   * When a Karel source or world file becomes the active tab (on open or
   * switch), show the world it declares on the canvas the core has already
   * opened — immediately, without running.
   *
   * @param {EditorTab} editorComponent - The newly active editor.
   */
  onSwitchToEditorTab = (editorComponent) => {
    this._installCompleter(editorComponent);
    // Seed the remembered WORLD directive so the first edit after a switch only
    // re-previews when the directive actually changes.
    this._worldDirectiveChanged(editorComponent);
    this._previewWorld(editorComponent);
    // Show any syntax error immediately on open, without waiting for an edit.
    this._lintKarel(editorComponent);
  }

  /**
   * Live-update the canvas while a Karel or world file is being edited.
   *
   * For a `.w` file the whole file is the world, so every change re-renders.
   * For a `.karel` program only its WORLD directive selects what is shown, so we
   * re-preview just when that directive changes — pointing it at a different
   * (valid) world file immediately shows that world, while ordinary code edits
   * leave the canvas alone.
   *
   * @param {EditorTab} editorComponent - The editor whose text changed.
   */
  onEditorTextChanged = (editorComponent) => {
    const proglang = editorComponent?.proglang;
    if (proglang === 'w') {
      this._previewWorld(editorComponent);
    } else if (proglang === 'karel') {
      if (this._worldDirectiveChanged(editorComponent)) {
        this._previewWorld(editorComponent);
      }
      this._maybePopupWorldCompletion(editorComponent);
      this._scheduleLint(editorComponent);
    }
  }

  /**
   * Debounce timer for the linter, so markers settle after typing pauses rather
   * than flashing on every keystroke.
   * @type {?number}
   */
  _lintTimer = null;

  /**
   * Re-lint shortly after the latest edit. A single shared timer is fine because
   * only the active editor receives text-change events.
   *
   * @param {EditorTab} editorComponent
   */
  _scheduleLint = (editorComponent) => {
    clearTimeout(this._lintTimer);
    this._lintTimer = setTimeout(() => this._lintKarel(editorComponent), 250);
  }

  /**
   * Parse the Karel source and surface the first syntax error as an Ace gutter
   * annotation (red marker + hover message) on the matching line; clear the
   * gutter when the program parses. Same lexer/parser the run pipeline uses, so
   * the editor flags exactly what a run would reject. No-op for non-Karel tabs.
   *
   * @param {EditorTab} editorComponent
   */
  _lintKarel = (editorComponent) => {
    if (editorComponent?.proglang !== 'karel') return;

    const aceEditor = editorComponent.editor;
    const session = aceEditor?.session || aceEditor?.getSession?.();
    if (!session) return;

    const content = editorComponent.getContent ? editorComponent.getContent() : '';

    let annotations = [];
    try {
      parse(tokenize(content));
    } catch (err) {
      // Prefer the structured line the error carries; fall back to the message.
      let line = Number.isInteger(err?.line) ? err.line : null;
      if (line === null) {
        const match = /line (\d+)/i.exec(err?.message || '');
        line = match ? parseInt(match[1], 10) : 1;
      }
      annotations = [{
        row: Math.max(0, line - 1),
        column: 0,
        text: err.message,
        type: 'error',
      }];
    }
    session.setAnnotations(annotations);
  }

  /**
   * Pop the autocomplete list open when an edit leaves the cursor inside the
   * open quote of a WORLD directive (e.g. just after typing the `"`, or after
   * clearing the name). Ace won't trigger live-autocomplete there itself because
   * the quote and an empty string aren't identifier characters, so we start it
   * explicitly. No-op while the list is already showing — Ace keeps it filtered
   * as you type.
   *
   * @param {EditorTab} editorComponent
   */
  _maybePopupWorldCompletion = (editorComponent) => {
    const aceEditor = editorComponent?.editor;
    if (!aceEditor || aceEditor.completer?.activated) return;

    const pos = aceEditor.getCursorPosition();
    const line = aceEditor.session.getLine(pos.row).slice(0, pos.column);
    if (WORLD_NAME_CONTEXT.test(line)) {
      aceEditor.execCommand('startAutocomplete');
    }
  }

  /**
   * Report whether a Karel source file's WORLD directive now names a different
   * world than the last time we looked, remembering the value on the editor
   * itself. Returns false for non-Karel editors. This keeps the live preview
   * limited to changes that affect which world is shown, rather than firing on
   * every keystroke.
   *
   * @param {EditorTab} editorComponent
   * @returns {boolean} True when the declared world name changed.
   */
  _worldDirectiveChanged = (editorComponent) => {
    if (editorComponent?.proglang !== 'karel') return false;

    const content = editorComponent.getContent ? editorComponent.getContent() : '';
    const match = content.match(WORLD_DIRECTIVE);
    const name = match ? match[1] : null;
    if (name === editorComponent._karelWorldName) return false;

    editorComponent._karelWorldName = name;
    return true;
  }

  /**
   * Make the Karel keyword completer the only completer in a Karel editor.
   * The editor builds its own completers list at creation (the default text
   * completer), so for Karel files we replace that list entirely rather than
   * augment it — the keyword list is the complete vocabulary and the
   * document-word completer only adds noise.
   *
   * @param {EditorTab} editorComponent
   */
  _installCompleter = (editorComponent) => {
    if (!editorComponent || editorComponent.proglang !== 'karel') return;

    const aceEditor = editorComponent.editor;
    if (aceEditor && aceEditor.completers[0] !== KAREL_COMPLETER) {
      aceEditor.completers = [KAREL_COMPLETER];
    }
  }

  /**
   * Draw commands streamed from the Karel worker. `karelInit` opens (or reuses)
   * the world canvas and draws the starting state; `karelRender` paints each
   * subsequent animated step. Other worker messages are ignored.
   *
   * @param {object} msg - The raw worker message.
   */
  onWorkerMessage = (msg) => {
    if (msg.id === 'karelInit') {
      if (!this._ensureRenderer()) return;
      // A fresh run starts with no message; the previous result is cleared.
      this.renderer.setMessage(null);
      this._scheduleDraw(msg.data);
    } else if (msg.id === 'karelRender' && this.renderer) {
      this._scheduleDraw(msg.data);
    } else if (msg.id === 'karelOutput' && this.renderer) {
      // Normal output and errors are drawn centered below the world.
      this.renderer.setMessage(msg.data.text, msg.data.isError);
      this._scheduleDraw(this._latestWorld);
    }
  }

  /**
   * Show a world on the canvas: the one a Karel source file declares via its
   * WORLD directive, or — for a `.w` world file — the world the file itself
   * spells out. No-op for unrelated tabs, and skipped while a program is running
   * so a live animation is never interrupted.
   *
   * @param {EditorTab} editorComponent - The Karel or world editor to read from.
   */
  _previewWorld = async (editorComponent) => {
    const proglang = editorComponent?.proglang;
    if (proglang !== 'karel' && proglang !== 'w') return;

    const status = Terra.app.getRunStatus();
    if (status === 'running' || status === 'loading') return;

    const seq = ++this._previewSeq;
    const content = editorComponent.getContent ? editorComponent.getContent() : '';

    let world;
    try {
      if (proglang === 'w') {
        // The file is the world.
        world = KarelWorld.parse(content);
      } else {
        const match = content.match(WORLD_DIRECTIVE);
        world = match && match[1]
          ? KarelWorld.parse(await this._loadWorldText(match[1]))
          : new KarelWorld();
      }
    } catch (err) {
      // World missing/invalid: fall back to a blank world rather than surfacing
      // an error for a passive preview. A run will report the problem.
      world = new KarelWorld();
    }

    // A newer tab switch superseded this async preview; drop this stale frame.
    if (seq !== this._previewSeq) return;

    // The core opens the canvas for Karel/world tabs; bail if it is somehow gone.
    if (!this._ensureRenderer()) return;
    // A passive preview carries no run result.
    this.renderer.setMessage(null);
    this._scheduleDraw(world.snapshot());
  }

  /**
   * Read a world file's text, preferring a matching VFS file (by full path or
   * basename) and falling back to the plugin's bundled worlds directory.
   *
   * @param {string} name - The world filename from the WORLD directive.
   * @returns {Promise<string>} The world file contents.
   */
  _loadWorldText = async (name) => {
    // The ".w" extension is optional in the WORLD directive.
    const candidates = name.endsWith('.w') ? [name] : [`${name}.w`, name];

    const files = await Terra.app.vfs.getAllFiles();
    for (const candidate of candidates) {
      const fromVfs = files.find(
        (file) => file.path === candidate || file.path.split('/').pop() === candidate
      );
      if (fromVfs && typeof fromVfs.content === 'string') {
        return fromVfs.content;
      }
    }

    for (const candidate of candidates) {
      const res = await fetch(`static/plugins/karel/worlds/${candidate}`);
      if (res.ok) {
        return res.text();
      }
    }

    throw new Error(`Could not find world file '${name}'.`);
  }

  /**
   * Bind a renderer + resize hook to the core-owned canvas. The core opens the
   * canvas whenever a Karel or world file is active, so this only adopts whatever
   * canvas is currently open — it never creates one. The renderer is recreated
   * when the canvas is a fresh instance (e.g. closed and reopened, or after a
   * layout restore).
   *
   * @returns {?KarelRenderer} The bound renderer, or null when no canvas is open.
   */
  _ensureRenderer = () => {
    const tab = Terra.app.view.canvas;
    if (!tab) return null;

    if (tab !== this.canvasTab) {
      this.canvasTab = tab;
      this.renderer = new KarelRenderer(tab);
      // Repaint the current world whenever the canvas is resized or reshown.
      tab.onResize = () => {
        if (this.renderer && this._latestWorld) {
          this.renderer.draw(this._latestWorld);
        }
      };
    }
    return this.renderer;
  }

  /**
   * Batch draws to the next animation frame, always painting the most recent
   * snapshot. This keeps the canvas in sync regardless of message ordering (so a
   * deferred init can never clobber a newer frame) and guarantees a freshly
   * created tab is sized before its first paint.
   *
   * @param {object} world - The world snapshot to draw.
   */
  _scheduleDraw = (world) => {
    this._latestWorld = world;
    if (this._drawScheduled) return;

    this._drawScheduled = true;
    requestAnimationFrame(() => {
      this._drawScheduled = false;
      if (this.renderer && this._latestWorld) {
        this.renderer.draw(this._latestWorld);
      }
    });
  }
}
