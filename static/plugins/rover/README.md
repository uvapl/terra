# Rover plugin

Displays **Rover** (the Windows XP search dog, via [clippyjs](https://github.com/pi0/clippyjs)) as a small, cute overlay in the top-right of the workspace.

- Hidden by default. Toggle him from **View ▸ Show Rover** (the item is bold while he's on). The choice is persisted in local storage, so he comes back on reload if he was on.
- Positioned top-right, overlaid (fixed position — never takes up layout space), with his bottom edge aligned to the top of the editor/terminal area. Follows the layout on window resize. Drag him anywhere and that position (measured from the top and right edges) is persisted too.
- On his own he does a little unprompted movement roughly every minute (with jitter), picked from a hand-selected set of gentle "idle fidget" animations.
- clippyjs and the Rover agent assets are loaded from CDN (see the constants at the top of `rover.js`). The classic `clippyjs@0.0.3` global build is used; agent assets come from the `smore-inc/clippy.js` mirror because clippyjs' own default asset host is dead.

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
