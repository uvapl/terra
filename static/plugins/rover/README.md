# Rover plugin

Displays **Rover** (the Windows XP search dog, via [clippyjs](https://github.com/pi0/clippyjs)) as a small, cute overlay in the top-right of the workspace.

- Hidden by default. Toggle it from **View ▸ Show Rover** (the item is bold while it's on). The choice is persisted in local storage, so it comes back on reload if it was on.
- Positioned top-right, with the bottom edge aligned to the top of the editor/terminal area. Follows the layout on window resize. Drag it anywhere and that position (measured from the top and right edges) is persisted too.
- On his own he does a little unprompted movement roughly every minute (with jitter), picked from a hand-selected set of gentle "idle fidget" animations.
- `clippyjs` is loaded from CDN as ESM modules via dynamic `import()` on first show (see the constants at the top of `rover.js`). The maintained `clippyjs@0.1.0` build is used; its sprite sheet and sounds are inlined as base64 data URIs and all styling is inline, so there's no separate asset host or stylesheet to keep alive.

State is persisted with the base plugin's local-storage helpers (`js/lib/local-storage-manager`) under the `plugin-rover` key: `active` (shown/hidden) and `position` (`{ top, right }`, or null for the default anchor).

## Controlling Rover from other code

The API is exposed globally as `Terra.assistant` (and is also reachable via `getPlugin('rover')`):

```js
const rover = Terra.assistant;

rover.play('Congratulate');        // play a named animation
rover.animate();                   // play a random animation
rover.speak('Nice work!');         // show a speech balloon
rover.speak('Hang on…', true);     // ...and keep it open until the next action

// Ask a question — resolves with the chosen option's label.
const answer = await rover.ask('Run the tests?', ['Yes', 'No']);
if (answer === 'Yes') { /* ... */ }

rover.animationNames();            // list every animation Rover supports
```

All methods no-op safely if Rover hasn't finished loading yet.
