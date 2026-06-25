// Create the main terra object.
const Terra = {};

// Contains a reference to the current active app instance (Exam/IDE/Embed).
Terra.app = null;

// Expose the Terra global on the window so it can be inspected from the browser
// console for debugging and testing. This is the same object every app variant
// assigns `Terra.app` to, so the console always sees the live app instance.
// Guarded for any non-window (e.g. worker) context.
if (typeof window !== 'undefined') {
  window.Terra = Terra;
}

export default Terra;
