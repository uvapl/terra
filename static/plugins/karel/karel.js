import { TerraPlugin } from '../../js/lib/plugin-manager.js';
import Terra from '../../js/terra.js';
import KarelRenderer from './karel-renderer.js';
import KarelWorld from './karel-world.js';
import './mode-karel.js';

// Matches the `WORLD "name"` directive at the start of a statement line.
const WORLD_DIRECTIVE = /^[ \t]*WORLD\s+"([^"]*)"/im;

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

// A single shared Ace completer for Karel keywords. It only contributes inside
// `ace/mode/karel`, and declares hyphens as identifier characters so prefixes
// like "front-is-" complete correctly (Ace's default word regex stops at "-").
const KAREL_COMPLETER = {
  identifierRegexps: [/[a-zA-Z0-9\-]/],
  getCompletions: (editor, session, pos, prefix, callback) => {
    const modeId = session.$modeId || session.getMode?.().$id;
    callback(null, modeId === 'ace/mode/karel' ? KAREL_COMPLETIONS : []);
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
    this._previewWorld(editorComponent);
  }

  /**
   * Live-update the canvas while a world file is being edited, so the world you
   * are writing renders as you type. Limited to `.w` files: a Karel program's
   * canvas keeps showing its last result until you switch tabs.
   *
   * @param {EditorTab} editorComponent - The editor whose text changed.
   */
  onEditorTextChanged = (editorComponent) => {
    if (editorComponent?.proglang === 'w') {
      this._previewWorld(editorComponent);
    }
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
