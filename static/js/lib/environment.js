/**
 * Checks on the environment the app is served in, done once before it starts.
 */

/**
 * Whether the page can create a SharedArrayBuffer.
 *
 * This is not an optional capability. Stdin is implemented by blocking the
 * worker on `Atomics.wait` against shared memory, so without it a program can
 * print but can never read input, and the C runtime cannot read project files
 * while running. The browser only allows it when the page is served with the
 * COOP/COEP headers.
 *
 * @returns {boolean} True when shared memory is available.
 */
export function hasSharedMemory() {
  try {
    new SharedArrayBuffer(1024);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check that the app can run here, and explain it in the page when it cannot.
 *
 * A missing header is a deployment problem that no user action can work around,
 * so the app stops instead of starting and then failing at the first `input()`
 * with an error that says nothing about the cause.
 *
 * @returns {boolean} True when the app may start.
 */
export function checkEnvironment() {
  if (hasSharedMemory()) return true;

  // The app's own page styles (a fixed, shrink-to-fit body with hidden
  // overflow) would clip this, so undo them before rendering into it.
  document.documentElement.style.overflow = 'auto';
  document.body.className = '';
  document.body.setAttribute('style', [
    'position: static',
    'width: 100%',
    'height: auto',
    'min-width: 0',
    'overflow: auto',
    'margin: 0',
    'background: #fff',
    'color: #111',
    'font-family: system-ui, sans-serif',
    'line-height: 1.5',
  ].join(';'));

  document.body.innerHTML = `
    <div style="max-width: 40em; margin: 0 auto; padding: 3em 1.5em;">
      <h1 style="font-size: 1.4em;">This page is missing two required headers</h1>
      <p>Terra needs to be served with:</p>
      <pre style="padding: 1em; background: #f4f4f4; overflow-x: auto;">Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp</pre>
      <p>
        Without them the browser refuses to create shared memory, which is how
        the editor passes keyboard input to a running program. Nothing that
        reads input would work, so the app does not start.
      </p>
      <p>See the “Enable stdin” section of the README for how to set them.</p>
    </div>
  `;

  return false;
}
