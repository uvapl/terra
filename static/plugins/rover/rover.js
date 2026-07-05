import { TerraPlugin } from '../../js/lib/plugin-manager.js';
import { seconds } from '../../js/lib/helpers.js';
import Terra from '../../js/terra.js';

// CDN for the classic (global `clippy`, jQuery-based) build of clippyjs. This
// build exposes `clippy.load(name, successCb, failCb, basePath)` and, unlike
// the newer ESM rewrite, works with the classic JSONP agent assets below.
const CLIPPY_JS_URL = 'https://cdn.jsdelivr.net/npm/clippyjs@0.0.3/dist/clippy.min.js';

// The agent asset bundles (agent.js / map.png / sound files). clippyjs' own
// default base path (gitcdn.xyz) is dead, so we point at the smore-inc mirror
// which still serves the original classic JSONP agents.
const CLIPPY_AGENTS_BASE = 'https://cdn.jsdelivr.net/gh/smore-inc/clippy.js@master/agents/';

// Which character to summon. Rover is the Windows XP search dog.
const AGENT_NAME = 'Rover';

// Rover's frame size in pixels (from its agent.js "framesize"). Used to place
// them so their bottom edge lines up with the top of the editor/terminal area.
const ROVER_SIZE = 80;

// Gap between Rover and the right edge of the layout area.
const RIGHT_MARGIN = 20;

// Additional margin from top to Rover.
const TOP_MARGIN = 40;

// How often Rover does a little unprompted movement, and how much that interval
// jitters, so the doesn't feel metronomic.
const IDLE_INTERVAL = seconds(60);
const IDLE_JITTER = seconds(30);

// A hand-picked subset of Rover's animations that read as "cute idle fidgeting"
// rather than something purposeful/loud. Kept short so they stay unobtrusive.
const CUTE_ANIMATIONS = [
  'GetAttentionMinor',
  'LookUp',
  'LookUpLeft',
  'Pleased',
  'Acknowledge',
  'Thinking',
  'Idle',
];

/**
 * Displays "Rover" (the clippyjs assistant) as a small, cute overlay in the
 * top-right corner of the workspace. On its own it just fidgets sporadically;
 * other plugins can drive it through the small public API (play / speak / ask).
 *
 * Other plugins reach this via `getPlugin('rover')`, e.g.:
 *
 *   const rover = getPlugin('rover');
 *   rover.play('Congratulate');
 *   rover.speak('Nice work!');
 *   const answer = await rover.ask('Run the tests?', ['Yes', 'No']);
 */
export default class RoverPlugin extends TerraPlugin {
  name = 'rover';
  css = [
    // Base clippy styling (the .clippy / .clippy-balloon rules).
    'https://cdn.jsdelivr.net/gh/smore-inc/clippy.js@master/build/clippy.css',
    // Our own overrides: positioning + the custom question balloon.
    'static/plugins/rover/rover.css',
  ];

  /**
   * Persisted in local storage (via the base plugin's state helpers, which use
   * js/lib/local-storage-manager under the hood):
   *   - active:   whether Rover is currently summoned. Off by default.
   *   - position: { top, right } offsets in pixels once the user has dragged
   *               them, or null to use the default top-right anchor. Stored from
   *               the top and right edges so they keeps their corner on resize.
   * @type {object}
   */
  defaultState = {
    active: false,
    position: null,
  };

  /**
   * The loaded clippy Agent instance, or null until it has finished loading.
   * @type {object|null}
   */
  agent = null;

  /**
   * Handle of the pending idle-movement timer so we can reschedule/clear it.
   * @type {number|null}
   */
  _idleTimer = null;

  /**
   * The answer-button row injected into clippy's own speech balloon while a
   * question is on screen, or null when none is pending.
   * @type {jQuery.Element|null}
   */
  _questionButtons = null;

  onLayoutLoaded = () => {
    // Expose the public API as `Terra.assistant` so other code can drive Rover
    // without importing the plugin manager.
    Terra.assistant = this;

    // Add the "Show Rover" toggle to the View menu (once; see _registerMenuItem)
    // and reflect its checked state on every (re)load.
    this._registerMenuItem();
    this._reflectMenuState();

    // Summon them only when the persisted toggle says so (off by default).
    if (this.getState('active')) {
      this._enable();
    }
  }

  /**
   * Register the "View > Show Rover" toggle command and rebuild the menubar so
   * it appears. Its checked (bold) state mirrors whether Rover is active.
   *
   * onLayoutLoaded re-fires on every layout reset, but the menubar is page
   * chrome that survives a reset, so we only register + rebuild once. Rebuilding
   * clears the runtime "active" classes on the theme/font-size/orientation menus
   * (added by the layout's addActiveStates before this hook), so we re-apply
   * them afterwards.
   */
  _registerMenuItem() {
    if (this._menuRegistered) return;
    this._menuRegistered = true;

    Terra.app.commands.register([{
      name: 'toggleRover',
      scope: 'global',
      menuItem: { path: 'View/Show Rover', position: 250 },
      exec: () => this._toggle(),
    }]);
    Terra.app.view.refreshMenu();
    Terra.app.view.layout?.addActiveStates?.();
    this._reflectMenuState();
  }

  /**
   * Flip Rover on/off from the menu, persist the choice and reflect it.
   */
  _toggle() {
    const active = !this.getState('active');
    this.setState('active', active);
    this._reflectMenuState();

    console.log(active)
    if (active) {
      this._enable();
    } else {
      this._disable();
    }
  }

  /**
   * Reflect the active state onto the menu item (bold, like the orientation
   * toggles) so the user can see whether Rover is on.
   */
  _reflectMenuState() {
    $('#menu-item--toggle-rover').toggleClass('active', !!this.getState('active'));
  }

  /**
   * Summon Rover (loading clippy on first use), or just re-show them if they were
   * only hidden. Guards against overlapping loads.
   */
  _enable() {
    if (this.agent) {
      this.agent.show();
      this._reposition();
      this._scheduleIdleMovement();
      return;
    }

    if (this._loading) return;
    this._loading = true;

    this._loadClippyScript()
      .then(() => this._summonRover())
      .catch((err) => {
        console.error('Rover: failed to load clippyjs', err);
        this._loading = false;
      });
  }

  /**
   * Hide Rover and stop their idle fidgeting, keeping the loaded agent around so a
   * later re-enable is instant.
   */
  _disable() {
    clearTimeout(this._idleTimer);
    this._removeQuestionBalloon();
    if (this.agent) {
      this.agent.hide();
    }
  }

  /**
   * Inject the clippyjs CDN script once and resolve when the global `clippy`
   * object is available.
   *
   * @returns {Promise<void>}
   */
  _loadClippyScript() {
    if (window.clippy) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = CLIPPY_JS_URL;
      script.onload = () => resolve();
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  /**
   * Load the Rover agent, show it, position it and start its idle fidgeting.
   */
  _summonRover() {
    window.clippy.load(AGENT_NAME, (agent) => {
      this.agent = agent;
      this._loading = false;

      // Keep Rover glued to their corner on resize (their saved top/right offsets
      // are re-applied, so a dragged position survives a resize too).
      $(window).on('resize.rover', () => this._reposition());

      // Clippy owns the drag itself; we just record where they ended up once the
      // mouse is released, so a dragged position persists across reloads.
      agent._el.on('mousedown.rover', () => {
        $(document).one('mouseup.rover', () => setTimeout(() => this._savePosition(), 0));
      });

      // Anchor them first so the 'Show' animation plays in the top-right corner
      // instead of clippy's default spot down at the bottom-right.
      this._reposition();
      agent.show();
      this._scheduleIdleMovement();
    }, (err) => {
      console.error('Rover: failed to load agent', err);
      this._loading = false;
    }, CLIPPY_AGENTS_BASE);
  }

  /**
   * Position Rover. If the user has dragged them before, restore that spot
   * (measured from the top and right edges so it holds on resize); otherwise
   * anchor them overlaying the top-right of the editor/terminal area, with their
   * bottom edge roughly aligned to the top of that area. Uses fixed positioning
   * (via the .clippy rule) so they never takes up layout space.
   */
  _reposition = () => {
    if (!this.agent) return;

    const saved = this.getState('position');
    let left;
    let top;

    if (saved) {
      left = window.innerWidth - saved.right - ROVER_SIZE;
      top = saved.top;
    } else {
      const layout = document.getElementById('layout');
      const rect = layout
        ? layout.getBoundingClientRect()
        : { top: ROVER_SIZE, right: window.innerWidth };

      left = rect.right - ROVER_SIZE - RIGHT_MARGIN;
      // Line their bottom up with the top of the editor area, but never let
      // them slide off the top of the viewport.
      top = Math.max(5, rect.top - ROVER_SIZE + TOP_MARGIN);
    }

    // Set the position directly rather than via agent.moveTo(): moveTo queues a
    // move onto the agent (waking them from idle). We just place the element and
    // let clippy's own reposition() clamp them to the viewport and move their
    // speech balloon (which is where our question buttons live) along with them.
    this.agent._el.css({ left, top });
    this.agent.reposition();
  }

  /**
   * Record Rover's current on-screen position as top/right offsets and persist
   * it, so a user-dragged spot survives resizes and reloads.
   */
  _savePosition() {
    if (!this.agent) return;

    const offset = this.agent._el.offset();
    const width = this.agent._el.outerWidth() || ROVER_SIZE;
    this.setState('position', {
      top: Math.round(offset.top),
      right: Math.round(window.innerWidth - offset.left - width),
    });
  }

  /**
   * Schedule the next little idle movement, then reschedule itself. The
   * interval jitters so Rover doesn't fidget on a fixed metronome.
   */
  _scheduleIdleMovement() {
    clearTimeout(this._idleTimer);
    const delay = IDLE_INTERVAL + Math.random() * IDLE_JITTER;

    this._idleTimer = setTimeout(() => {
      // Only fidget when Rover is active, nothing else is going on and the tab
      // is visible, so we don't stack animations behind a hidden tab.
      if (this.agent && this.getState('active') && !document.hidden && !this._questionButtons) {
        const anim = CUTE_ANIMATIONS[Math.floor(Math.random() * CUTE_ANIMATIONS.length)];
        this.agent.play(anim);
      }
      this._scheduleIdleMovement();
    }, delay);
  }

  // ---------------------------------------------------------------------------
  // Public API for other plugins.
  // ---------------------------------------------------------------------------

  /**
   * Play a specific Rover animation by name (see CUTE_ANIMATIONS for examples;
   * `animationNames()` returns the full list). Unknown names are ignored.
   *
   * @param {string} name - The animation name, e.g. 'Congratulate'.
   * @returns {boolean} Whether the animation was known and queued.
   */
  play(name) {
    if (!this.agent || !this.agent.hasAnimation(name)) return false;
    this.agent.play(name);
    return true;
  }

  /**
   * Play a random animation ("just be cute" on demand).
   */
  animate() {
    if (this.agent) this.agent.animate();
  }

  /**
   * Show a speech-balloon message.
   *
   * @param {string} text - The message to display.
   * @param {boolean} [hold=false] - When true, the balloon stays open until the
   * next action instead of auto-hiding.
   */
  speak(text, hold = false) {
    if (this.agent) this.agent.speak(text, hold);
  }

  /**
   * List every animation Rover supports.
   *
   * @returns {string[]}
   */
  animationNames() {
    return this.agent ? this.agent.animations() : [];
  }

  /**
   * Ask the user a question via a balloon with one clickable button per option.
   *
   * @param {string} question - The question text.
   * @param {string[]} [options=['Yes', 'No']] - The answer buttons to offer.
   * @returns {Promise<string>} Resolves with the chosen option's label.
   */
  ask(question, options = ['Yes', 'No']) {
    return new Promise((resolve) => {
      if (!this.agent) {
        resolve(null);
        return;
      }

      // Only one question at a time. stopCurrent() skips whatever Rover is doing
      // and calls the balloon's close() — which releases a previously held
      // question balloon so clippy's action queue isn't left stuck (a held
      // speak() never completes on its own) and the new question shows promptly.
      this._removeQuestionButtons();
      this.agent.stopCurrent();

      const balloon = this.agent._balloon;

      // Build the answer buttons and drop them straight into clippy's own
      // speech balloon, below its text content. Appending them before speak()
      // means speak()'s own reposition() already accounts for their height, and
      // clippy keeps repositioning them with the balloon from then on.
      const $buttons = $('<div class="rover-question-buttons"></div>');
      options.forEach((option) => {
        $('<button type="button" class="rover-question-btn"></button>')
          .text(option)
          .on('click', () => {
            this._removeQuestionButtons();
            // close() advances the (held) queue so Rover can idle again;
            // hide(true) drops the balloon immediately rather than after the
            // usual close delay.
            balloon.close();
            balloon.hide(true);
            resolve(option);
          })
          .appendTo($buttons);
      });
      balloon._balloon.append($buttons);
      this._questionButtons = $buttons;

      // Speak the question and hold the balloon open until an answer is clicked.
      this.agent.speak(question, true);
    });
  }

  /**
   * Remove the answer buttons from clippy's balloon, if any are showing.
   */
  _removeQuestionButtons() {
    if (this._questionButtons) {
      this._questionButtons.remove();
      this._questionButtons = null;
    }
  }
}
