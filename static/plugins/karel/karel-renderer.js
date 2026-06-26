// Draws a Karel world snapshot onto a CanvasTab. Pure rendering: it takes the
// plain-object snapshots posted by the worker and paints the grid, walls,
// beepers and Karel. The world uses 1-indexed (x, y) with (1, 1) at the
// bottom-left, so the y axis is flipped to screen coordinates here.

const COLORS = {
  background: '#ffffff',
  grid: '#d8d8d8',
  corner: '#b0b0b0',
  wall: '#222222',
  beeper: '#7ec8a9',
  beeperText: '#0c3b29',
  karel: '#2a6fb0',
  karelFace: '#dceaf6',
  karelOutline: '#16456f',
  message: '#333333',
  messageError: '#c0392b',
};

// Karel's body sketched in a local unit frame as the upright east-facing pose
// (screen axes: +x right, +y down). The whole sprite is rotated to face the
// robot's direction. A small upward offset keeps the feet-heavy figure centred.
const KAREL = {
  offsetY: -0.10,
  // Body outline: a portrait rectangle with the top-right and bottom-left
  // corners chamfered (top-right cut a little longer).
  body: [
    [-0.45, -0.62],
    [0.05, -0.62],
    [0.45, -0.22],
    [0.45, 0.62],
    [-0.21, 0.62],
    [-0.45, 0.38],
  ],
  // Inner panel, same chamfered style, in the upper half.
  inner: [
    [-0.26, -0.40],
    [-0.08, -0.40],
    [0.26, -0.06],
    [0.26, 0.16],
    [-0.15, 0.16],
    [-0.26, 0.05],
  ],
  // "Disk drive" slot below the panel.
  disk: [[-0.28, 0.32], [0.28, 0.32]],
  // Two L-shaped feet: out from the body, then a 90° left turn.
  feet: [
    [[-0.45, 0.20], [-0.69, 0.20], [-0.69, 0.44]], // left side, above the corner
    [[0.00, 0.62], [0.00, 0.86], [0.24, 0.86]],    // bottom, from the middle
  ],
};

const PADDING = 16;

// Message band (below the world): font size and the gap separating it from the
// world above and the canvas edge below. The band is always reserved so the
// world keeps its position whether or not a message is shown.
const MESSAGE_FONT = 16;
const MESSAGE_GAP = 20;

export default class KarelRenderer {
  /**
   * @param {CanvasTab} canvasTab - The canvas tab to draw into.
   */
  constructor(canvasTab) {
    this.canvasTab = canvasTab;

    /**
     * The latest program message to show beneath the world (normal output or an
     * error), or null for none. Karel reports its results on the canvas rather
     * than the terminal.
     * @type {?{ text: string, isError: boolean }}
     */
    this.message = null;
  }

  /**
   * Set (or clear) the message shown centered below the world. Pass null to
   * clear it, e.g. at the start of a fresh run.
   *
   * @param {?string} text - The message text, or null/empty to clear.
   * @param {boolean} [isError=false] - Render in the error color when true.
   */
  setMessage(text, isError = false) {
    this.message = text ? { text, isError } : null;
  }

  /**
   * Draw a world snapshot, fitting it to the current canvas size.
   *
   * @param {object} world - Snapshot from KarelWorld.snapshot().
   */
  draw(world) {
    const { width: cssW, height: cssH } = this.canvasTab.resizeToContainer();
    const ctx = this.canvasTab.getContext('2d');

    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, cssW, cssH);

    // Always reserve a band at the bottom for the message, so the world keeps a
    // fixed position whether or not a message is currently shown.
    const worldH = cssH - (MESSAGE_FONT + MESSAGE_GAP);

    const cell = Math.min(
      (cssW - 2 * PADDING) / world.width,
      (worldH - 2 * PADDING) / world.height
    );
    if (!(cell > 0)) return;

    const gridW = cell * world.width;
    const gridH = cell * world.height;
    const originX = (cssW - gridW) / 2;
    const originY = (worldH - gridH) / 2;

    // Geometry helpers. north (+y) is up, so screen y is flipped.
    const cellRect = (x, y) => {
      const left = originX + (x - 1) * cell;
      const top = originY + (world.height - y) * cell;
      return { left, top, right: left + cell, bottom: top + cell };
    };
    const cellCenter = (x, y) => {
      const r = cellRect(x, y);
      return { cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 };
    };

    this._drawGrid(ctx, world, originX, originY, gridW, gridH, cell, cellCenter);
    this._drawWalls(ctx, world, cell, cellRect);
    this._drawBeepers(ctx, world, cell, cellCenter);
    this._drawKarel(ctx, world, cell, cellRect);
    this._drawMessage(ctx, cssW, cssH);
  }

  /**
   * Draw the current message centered horizontally in the reserved bottom band.
   *
   * @param {number} cssW - Canvas CSS width.
   * @param {number} cssH - Canvas CSS height.
   */
  _drawMessage(ctx, cssW, cssH) {
    if (!this.message) return;

    ctx.font = `${MESSAGE_FONT}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = this.message.isError ? COLORS.messageError : COLORS.message;
    ctx.fillText(this.message.text, cssW / 2, cssH - (MESSAGE_FONT + MESSAGE_GAP) / 2);
  }

  _drawGrid(ctx, world, originX, originY, gridW, gridH, cell, cellCenter) {
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= world.width; x++) {
      const px = originX + x * cell;
      ctx.moveTo(px, originY);
      ctx.lineTo(px, originY + gridH);
    }
    for (let y = 0; y <= world.height; y++) {
      const py = originY + y * cell;
      ctx.moveTo(originX, py);
      ctx.lineTo(originX + gridW, py);
    }
    ctx.stroke();

    // Corner dots at each cell centre.
    ctx.fillStyle = COLORS.corner;
    const r = Math.max(1, cell * 0.04);
    for (let x = 1; x <= world.width; x++) {
      for (let y = 1; y <= world.height; y++) {
        const { cx, cy } = cellCenter(x, y);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _drawWalls(ctx, world, cell, cellRect) {
    ctx.strokeStyle = COLORS.wall;
    ctx.lineWidth = Math.max(2, cell * 0.08);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const { x, y, dir } of world.walls) {
      const r = cellRect(x, y);
      if (dir === 'north') { ctx.moveTo(r.left, r.top); ctx.lineTo(r.right, r.top); }
      else if (dir === 'south') { ctx.moveTo(r.left, r.bottom); ctx.lineTo(r.right, r.bottom); }
      else if (dir === 'east') { ctx.moveTo(r.right, r.top); ctx.lineTo(r.right, r.bottom); }
      else if (dir === 'west') { ctx.moveTo(r.left, r.top); ctx.lineTo(r.left, r.bottom); }
    }
    ctx.stroke();
  }

  _drawBeepers(ctx, world, cell, cellCenter) {
    const s = cell * 0.32;
    ctx.font = `${Math.round(cell * 0.28)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const { x, y, count } of world.beepers) {
      const { cx, cy } = cellCenter(x, y);
      ctx.fillStyle = COLORS.beeper;
      ctx.beginPath();
      ctx.moveTo(cx, cy - s);
      ctx.lineTo(cx + s, cy);
      ctx.lineTo(cx, cy + s);
      ctx.lineTo(cx - s, cy);
      ctx.closePath();
      ctx.fill();

      if (count > 1) {
        ctx.fillStyle = COLORS.beeperText;
        ctx.fillText(String(count), cx, cy);
      }
    }
  }

  _drawKarel(ctx, world, cell, cellRect) {
    const { x, y, dir } = world.karel;
    const r = cellRect(x, y);
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    const s = cell * 0.42;

    // The sketch is drawn upright as the east-facing pose (feet to the left and
    // bottom). Each turnLeft rotates the whole sprite a quarter turn
    // counter-clockwise: east -> north -> west -> south.
    const angles = { east: 0, south: Math.PI / 2, west: Math.PI, north: 3 * Math.PI / 2 };
    const cos = Math.cos(angles[dir]);
    const sin = Math.sin(angles[dir]);
    const tx = (px, py) => {
      const ly = py + KAREL.offsetY;
      return [cx + (px * cos - ly * sin) * s, cy + (px * sin + ly * cos) * s];
    };
    const trace = (points, close) => {
      ctx.beginPath();
      points.forEach(([px, py], i) => {
        const [sx, sy] = tx(px, py);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      if (close) ctx.closePath();
    };

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Feet first, so the body sits on top of where they attach.
    ctx.strokeStyle = COLORS.karel;
    ctx.lineWidth = s * 0.18;
    for (const foot of KAREL.feet) {
      trace(foot, false);
      ctx.stroke();
    }

    // Body.
    ctx.fillStyle = COLORS.karel;
    ctx.strokeStyle = COLORS.karelOutline;
    ctx.lineWidth = Math.max(1, s * 0.05);
    trace(KAREL.body, true);
    ctx.fill();
    ctx.stroke();

    // Inner panel.
    ctx.fillStyle = COLORS.karelFace;
    trace(KAREL.inner, true);
    ctx.fill();
    ctx.stroke();

    // Disk-drive slot.
    ctx.lineWidth = s * 0.08;
    trace(KAREL.disk, false);
    ctx.stroke();
  }
}
