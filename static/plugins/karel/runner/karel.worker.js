// Karel language worker. Mirrors the C/Python workers' message glue so it plugs
// into the existing LangWorkerClient pipeline: it builds a BaseAPI subclass,
// signals 'ready', and handles 'runUserCode'. Beyond terminal output it posts
// custom 'karelInit'/'karelRender' messages — these fall through the client's
// switch to onWorkerMessage and reach the Karel plugin on the main thread, which
// draws them onto the canvas tab.

import BaseAPI from '../../../js/platforms/base-api.js';
import { getPartsFromPath } from '../../../js/lib/helpers.js';
import { tokenize } from './karel-lexer.js';
import { parse } from './karel-parser.js';
import KarelWorld from '../karel-world.js';
import KarelInterpreter from './karel-interpreter.js';

// Delay between animated steps, in milliseconds, at the fastest (speed 1.0) and
// slowest (speed 0.0) world speeds. Speed 1.0 is the normal pace.
const MIN_STEP_DELAY = 120;
const MAX_STEP_DELAY = 600;

// Multipliers applied to the world's step delay by the SPEED SLOW / SPEED FAST
// directives — a quick way for students to slow down or speed up a run.
const SPEED_FACTORS = { slow: 2, slower: 3, slowest: 5, fast: 0.35 };

// How long the traced instruction is highlighted before it actually runs, at
// SPEED SLOWEST, split into two beats: first plain (so the highlight itself is
// easy to spot), then with the "about to run" arrow. Both are carved out of
// that step's own delay (see runUserCode), not added on top, so the overall
// pace is unchanged. Their sum should stay under the minimum possible SPEED
// SLOWEST step delay (MIN_STEP_DELAY * SPEED_FACTORS.slowest = 900ms) so the
// "perform" phase never gets a negative remainder.
const TRACE_LOCATE_DELAY = 500;
const TRACE_ARROW_DELAY = 500;
const TRACE_MARK_DELAY = TRACE_LOCATE_DELAY + TRACE_ARROW_DELAY;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Map a world's speed (0 slowest .. 1 fastest) to a per-step delay. Linear
 * between the min and max delays; a missing/invalid speed falls back to fastest.
 *
 * @param {number} speed
 * @returns {number} Delay in milliseconds.
 */
const stepDelayForSpeed = (speed) => {
  const s = Number.isFinite(speed) ? Math.min(1, Math.max(0, speed)) : 1;
  return MIN_STEP_DELAY + (1 - s) * (MAX_STEP_DELAY - MIN_STEP_DELAY);
};

class KarelAPI extends BaseAPI {
  constructor(options) {
    super(options);
    this.postRender = options.postRender;

    // No heavy runtime to load — ready immediately.
    this.readyCallback();
  }

  /**
   * Parse and run the active Karel program, animating each step.
   *
   * @param {object} data
   * @param {string} data.activeTabPath - Absolute path of the file to run.
   * @param {array} data.vfsFiles - All VFS files (program + any world files).
   */
  async runUserCode({ activeTabPath, vfsFiles }) {
    const activeTab = vfsFiles.find((file) => file.path === activeTabPath);
    const filename = activeTab.path.includes('/')
      ? getPartsFromPath(activeTab.path).name
      : activeTab.path;
    this.hostWriteCmd(`karel ${filename}`);

    try {
      const program = parse(tokenize(activeTab.content));
      const world = await this.loadWorld(program.worldFile, vfsFiles);

      // Live-trace the executing instruction only at the slowest named speed —
      // at any faster pace the highlight would lag behind or just flicker.
      const traceEnabled = ['slowest', 'slower'].includes(program.speedOverride);
      this.postRender('karelInit', { ...world.snapshot(), traceEnabled });

      let stepDelay = stepDelayForSpeed(world.speed);
      if (program.speedOverride) {
        stepDelay *= SPEED_FACTORS[program.speedOverride];
      }

      // Pause on the initial position so it is visible before Karel starts.
      await sleep(stepDelay);

      const interpreter = new KarelInterpreter(world, program.definitions, {
        // A user-instruction call, and each loop iteration, is its own step:
        // highlight just the call site / loop clause and hold it for one full
        // step before the steps inside it begin.
        onEnter: traceEnabled
          ? (trace) => {
              this.postRender('karelTrace', { trace, marking: false });
              return sleep(stepDelay/2);
            }
          : undefined,
        // Highlight the instruction first, with the world untouched — plain at
        // first (so the highlight itself is easy to spot), then with the
        // "about to run" arrow — and only then let the remainder of the
        // step's own delay play out after it actually runs. Same total pace
        // per step, just split into "located", "armed" and "performed".
        onMark: traceEnabled
          ? async (trace) => {
              this.postRender('karelTrace', { trace, marking: false });
              await sleep(TRACE_LOCATE_DELAY);
              this.postRender('karelTrace', { trace, marking: true });
              await sleep(TRACE_ARROW_DELAY);
            }
          : undefined,
        onStep: (trace) => {
          this.postRender('karelRender', world.snapshot());
          const remaining = traceEnabled ? Math.max(0, stepDelay - TRACE_MARK_DELAY) : stepDelay;
          return sleep(remaining);
        },
      });

      await interpreter.run(program.body);
      // Report results on the canvas (below the world) rather than the terminal.
      this.postRender('karelOutput', { text: 'Karel has shut off.', isError: false });
    } catch (err) {
      this.postRender('karelOutput', { text: err.message, isError: true });
    } finally {
      this.runUserCodeCallback();
    }
  }

  /**
   * Resolve the world named by a WORLD directive. Prefer a matching file from
   * the VFS (so students can ship their own worlds); otherwise fetch a bundled
   * world from the plugin's worlds/ directory. With no directive, start from a
   * blank default world.
   *
   * @param {?string} name - The world filename, or null.
   * @param {array} vfsFiles - All VFS files.
   * @returns {Promise<KarelWorld>}
   */
  async loadWorld(name, vfsFiles) {
    if (!name) return new KarelWorld();

    // The ".w" extension is optional in the WORLD directive.
    const candidates = name.endsWith('.w') ? [name] : [`${name}.w`, name];

    for (const candidate of candidates) {
      const fromVfs = vfsFiles.find(
        (file) => file.path === candidate || file.path.split('/').pop() === candidate
      );
      if (fromVfs && typeof fromVfs.content === 'string') {
        return KarelWorld.parse(fromVfs.content);
      }
    }

    for (const candidate of candidates) {
      const res = await fetch(`../worlds/${candidate}`);
      if (res.ok) {
        return KarelWorld.parse(await res.text());
      }
    }

    throw new Error(`Could not find world file '${name}'.`);
  }
}

// =============================================================================
// Worker message handling (mirrors py.worker.js / clang.worker.js).
// =============================================================================

let api;

const onAnyMessage = async (event) => {
  // Whether or not a fake prompt + command is echoed on the terminal
  if (api) api.echoCmd = event.data.data?.echoCmd !== false;

  switch (event.data.id) {
    case 'constructor': {
      const { port } = event.data.data;
      port.onmessage = onAnyMessage;
      api = new KarelAPI({
        hostWrite(s) {
          port.postMessage({ id: 'write', data: s });
        },
        runUserCodeCallback() {
          port.postMessage({ id: 'runUserCodeCallback' });
        },
        readyCallback() {
          port.postMessage({ id: 'ready' });
        },
        postRender(id, data) {
          port.postMessage({ id, data });
        },
      });
      break;
    }

    case 'runUserCode':
      api.runUserCode(event.data.data);
      break;
  }
};

self.onmessage = onAnyMessage;
