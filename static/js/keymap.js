import { isMac } from './helpers/shared.js';

/**
 * Declarative keyboard bindings, grouped by scope.
 *
 * A *scope* is the context a binding applies to. For now only the terminal
 * scope exists (consumed by App via xterm's custom key handler), but the
 * structure anticipates editor/global scopes that will later absorb the
 * shortcuts currently scattered across menubar.js.
 *
 * This module is intentionally pure: it only describes which key combo triggers
 * which *named action*. The action implementations live with whatever owns them
 * (e.g. App.zoomIn), so the keymap never reaches into the app, layout or DOM.
 *
 * A binding is `{ key, action, preventDefault?, <modifiers> }` where the
 * modifiers are any of:
 *   - ctrl / shift / alt / meta - the literal modifier keys.
 *   - mod - the platform-conventional command modifier: cmd on Mac, ctrl
 *     elsewhere. Use this for shortcuts that should follow the OS convention
 *     (so menubar's isMac() binds can migrate here verbatim later).
 */

export const KeymapScope = {
  TERMINAL: 'terminal',
  // EDITOR: 'editor',   // later
  // GLOBAL: 'global',   // later
};

const BINDINGS = {
  [KeymapScope.TERMINAL]: [
    { key: 'c', ctrl: true, action: 'handleControlC' },
    { key: '=', ctrl: true, action: 'zoomIn', preventDefault: true },
    { key: '-', ctrl: true, action: 'zoomOut', preventDefault: true },
    { key: '0', ctrl: true, action: 'resetZoom', preventDefault: true },
    { key: '9', ctrl: true, action: 'zoomDemo', preventDefault: true },
  ],
};

/**
 * Whether a single binding matches a keyboard event. Every modifier the binding
 * declares must match the event exactly; modifiers it omits must be absent. The
 * `mod` modifier resolves to meta on Mac and ctrl elsewhere.
 *
 * @param {object} binding - A binding from BINDINGS.
 * @param {KeyboardEvent} event - The keyboard event to test.
 * @returns {boolean}
 */
function comboMatches(binding, event) {
  if (binding.key !== event.key) return false;

  // Resolve `mod` to the platform-conventional modifier, then fold it into the
  // ctrl/meta expectations so a single comparison covers both.
  const modIsMeta = isMac();
  const wantCtrl = !!binding.ctrl || (!!binding.mod && !modIsMeta);
  const wantMeta = !!binding.meta || (!!binding.mod && modIsMeta);

  return wantCtrl === event.ctrlKey
    && wantMeta === event.metaKey
    && !!binding.shift === event.shiftKey
    && !!binding.alt === event.altKey;
}

/**
 * Find the binding within a scope that matches the given keyboard event.
 *
 * @param {string} scope - A KeymapScope value.
 * @param {KeyboardEvent} event - The keyboard event to match.
 * @returns {?object} The matching binding, or null when none matches.
 */
export function matchKeyBinding(scope, event) {
  return (BINDINGS[scope] || []).find((binding) => comboMatches(binding, event)) || null;
}
