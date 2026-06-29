import BaseTab from './base.tab.js';

/**
 * Canvas component for GoldenLayout.
 *
 * A non-interactive drawing surface: it owns a `<canvas>` element and exposes a
 * small access API (getContext/clear/resizeToContainer) for other features to
 * draw into. It dispatches no outward events — nothing comes back from the
 * canvas, it is purely an output surface.
 */
export default class CanvasTab extends BaseTab {
  /**
   * Optional callback invoked (coalesced to one animation frame) when the canvas
   * is resized or (re)shown, so the owner can repaint at the new size. Set by
   * whoever draws into the canvas.
   * @type {?Function}
   */
  onResize = null;

  _redrawScheduled = false;

  constructor(container, state) {
    super(container, state);

    this.init();
  }

  init = () => {
    this.container.parent.isCanvas = true;

    this.bindContainerEvents();
    this.initCanvasElement();
  }

  initCanvasElement = () => {
    const contentContainer = this.container.getElement()[0];
    this.canvas = document.createElement('canvas');

    contentContainer.appendChild(this.canvas);
  }

  /**
   * Get the underlying canvas element.
   *
   * @returns {HTMLCanvasElement} The canvas element.
   */
  getCanvas = () => {
    return this.canvas;
  }

  /**
   * Get a rendering context for the canvas.
   *
   * @param {string} [type] - The context type, defaults to '2d'.
   * @returns {RenderingContext} The canvas rendering context.
   */
  getContext = (type = '2d') => {
    return this.canvas.getContext(type);
  }

  /**
   * Size the canvas backing store to its container, accounting for the device
   * pixel ratio so drawings stay crisp on high-DPI screens. Returns the logical
   * (CSS pixel) size so callers can lay out their drawing in CSS pixels.
   *
   * @returns {{ width: number, height: number }} Logical canvas size in CSS px.
   */
  resizeToContainer = () => {
    const el = this.container.getElement()[0];
    const dpr = window.devicePixelRatio || 1;
    const width = el.clientWidth;
    const height = el.clientHeight;

    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    // Draw in CSS-pixel coordinates regardless of the backing store scale.
    const ctx = this.canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    return { width, height };
  }

  /**
   * Clear the entire canvas.
   */
  clear = () => {
    const ctx = this.canvas.getContext('2d');
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
  }

  /**
   * Callback function when the canvas component is shown/opened.
   */
  onShow = () => {
    this.getParentComponentElement().classList.add('component-container', 'canvas-component-container');
    // The container may have been resized while this tab was hidden; repaint it.
    this.requestRedraw();
  }

  /**
   * Ask the owner to repaint, coalescing bursts of resize events into a single
   * redraw on the next animation frame to keep the cost low.
   */
  requestRedraw = () => {
    if (!this.onResize || this._redrawScheduled) return;
    this._redrawScheduled = true;
    requestAnimationFrame(() => {
      this._redrawScheduled = false;
      if (this.onResize) this.onResize();
    });
  }

  /**
   * Bind all container events with callbacks.
   */
  bindContainerEvents = () => {
    this.container.on('show', () => this.onShow());
    this.container.on('resize', () => this.requestRedraw());
    this.container.on('destroy', () => this.dispatchEvent(new Event('destroy')));
  }
}
