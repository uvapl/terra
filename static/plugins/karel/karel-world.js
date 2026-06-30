// Karel world model + Stanford ".w" world-file parser.
//
// Coordinate system: 1-indexed (x = column 1..width, y = row 1..height) with
// (1, 1) at the bottom-left. North is +y, east is +x. This runs in the worker,
// so it has no DOM dependencies; it owns the authoritative world during a run
// and produces plain-object snapshots for the main thread to render.

const DIRECTIONS = ['east', 'north', 'west', 'south'];

// Movement delta per direction.
const DELTA = {
  east: { x: 1, y: 0 },
  north: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
  south: { x: 0, y: -1 },
};

// The opposite edge, used to mirror a wall onto its neighbouring cell.
const OPPOSITE = {
  east: 'west',
  west: 'east',
  north: 'south',
  south: 'north',
};

export default class KarelWorld {
  constructor() {
    this.width = 10;
    this.height = 10;
    this.karel = { x: 1, y: 1, dir: 'east' };
    this.beeperBag = 0; // number, or Infinity for an unlimited bag.
    this.beepers = new Map(); // "x,y" -> count
    this.walls = new Set();   // "x,y,dir" (stored for both adjacent cells)
    this.speed = 1;           // 0 (slowest) .. 1 (fastest, the default).
  }

  // ───────────────────────────── Parsing ─────────────────────────────

  /**
   * Parse a Stanford ".w" world file into a KarelWorld.
   *
   * Recognised lines (case-insensitive):
   *   Dimension: (w, h)
   *   Karel: (x, y) <direction>
   *   Beeper: (x, y) <count>
   *   Wall: (x, y) <direction>
   *   BeeperBag: INFINITE | INFINITY | <count>
   *   Speed: <0..1>   (0 slowest, 1 fastest)
   *
   * @param {string} text - The world file contents.
   * @returns {KarelWorld}
   */
  static parse(text) {
    const world = new KarelWorld();

    for (let raw of text.split(/\r\n|\r|\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith('//')) continue;

      const colon = line.indexOf(':');
      if (colon === -1) continue;

      const key = line.slice(0, colon).trim().toLowerCase();
      const rest = line.slice(colon + 1).trim();
      const nums = (rest.match(/-?\d+/g) || []).map(Number);
      const word = (rest.match(/[a-zA-Z]+/g) || []).pop();

      switch (key) {
        case 'dimension':
          if (nums.length >= 2) {
            world.width = nums[0];
            world.height = nums[1];
          }
          break;

        case 'karel':
          if (nums.length >= 2) {
            world.karel.x = nums[0];
            world.karel.y = nums[1];
          }
          if (word) world.karel.dir = world._normalizeDir(word);
          break;

        case 'beeper':
          if (nums.length >= 2) {
            const count = nums.length >= 3 ? nums[2] : 1;
            world.setBeepers(nums[0], nums[1], count);
          }
          break;

        case 'wall':
          if (nums.length >= 2 && word) {
            world.addWall(nums[0], nums[1], world._normalizeDir(word));
          }
          break;

        case 'beeperbag':
          world.beeperBag = /infinit[ey]/i.test(rest) ? Infinity : (nums[0] || 0);
          break;

        case 'speed': {
          // A decimal in [0, 1], so parse as a float (the integer regex above
          // would read "0.00" as two numbers).
          const speed = parseFloat(rest);
          if (Number.isFinite(speed)) {
            world.speed = Math.min(1, Math.max(0, speed));
          }
          break;
        }
      }
    }

    return world;
  }

  _normalizeDir(word) {
    const w = word.toLowerCase();
    if (w.startsWith('n')) return 'north';
    if (w.startsWith('s')) return 'south';
    if (w.startsWith('e')) return 'east';
    if (w.startsWith('w')) return 'west';
    return 'east';
  }

  // ───────────────────────────── Mutators ─────────────────────────────

  setBeepers(x, y, count) {
    const key = `${x},${y}`;
    if (count > 0) {
      this.beepers.set(key, count);
    } else {
      this.beepers.delete(key);
    }
  }

  beeperCount(x, y) {
    return this.beepers.get(`${x},${y}`) || 0;
  }

  /** Add a wall on one edge of a cell, mirrored onto the adjacent cell. */
  addWall(x, y, dir) {
    this.walls.add(`${x},${y},${dir}`);
    const d = DELTA[dir];
    this.walls.add(`${x + d.x},${y + d.y},${OPPOSITE[dir]}`);
  }

  hasWall(x, y, dir) {
    return this.walls.has(`${x},${y},${dir}`);
  }

  // ───────────────────────── Karel primitives ─────────────────────────
  // Each returns nothing on success or throws an Error to halt the run.

  move() {
    const { x, y, dir } = this.karel;
    if (this.hasWall(x, y, dir)) {
      throw new Error('Karel hit a wall while trying to move.');
    }
    const d = DELTA[dir];
    const nx = x + d.x;
    const ny = y + d.y;
    if (nx < 1 || nx > this.width || ny < 1 || ny > this.height) {
      throw new Error('Karel tried to move off the edge of the world.');
    }
    this.karel.x = nx;
    this.karel.y = ny;
  }

  turnLeft() {
    const i = DIRECTIONS.indexOf(this.karel.dir);
    this.karel.dir = DIRECTIONS[(i + 1) % DIRECTIONS.length];
  }

  pickBeeper() {
    const count = this.beeperCount(this.karel.x, this.karel.y);
    if (count <= 0) {
      throw new Error('Karel tried to pick up a beeper, but there is none here.');
    }
    this.setBeepers(this.karel.x, this.karel.y, count - 1);
    if (this.beeperBag !== Infinity) this.beeperBag += 1;
  }

  putBeeper() {
    if (this.beeperBag <= 0) {
      throw new Error('Karel tried to put down a beeper, but its bag is empty.');
    }
    this.setBeepers(this.karel.x, this.karel.y, this.beeperCount(this.karel.x, this.karel.y) + 1);
    if (this.beeperBag !== Infinity) this.beeperBag -= 1;
  }

  // ──────────────────────────── Conditions ────────────────────────────

  _clear(relativeTurns) {
    const i = DIRECTIONS.indexOf(this.karel.dir);
    const dir = DIRECTIONS[(i + relativeTurns + DIRECTIONS.length) % DIRECTIONS.length];
    const { x, y } = this.karel;
    if (this.hasWall(x, y, dir)) return false;
    const d = DELTA[dir];
    const nx = x + d.x;
    const ny = y + d.y;
    return nx >= 1 && nx <= this.width && ny >= 1 && ny <= this.height;
  }

  frontIsClear() { return this._clear(0); }
  leftIsClear() { return this._clear(1); }
  rightIsClear() { return this._clear(-1); }

  nextToABeeper() { return this.beeperCount(this.karel.x, this.karel.y) > 0; }
  anyBeepersInBag() { return this.beeperBag === Infinity || this.beeperBag > 0; }

  facingNorth() { return this.karel.dir === 'north'; }
  facingSouth() { return this.karel.dir === 'south'; }
  facingEast() { return this.karel.dir === 'east'; }
  facingWest() { return this.karel.dir === 'west'; }

  // ──────────────────────────── Snapshot ──────────────────────────────

  /**
   * Build a plain-object snapshot for the renderer. Walls are emitted once per
   * stored entry (both sides are present in the set, the renderer dedupes by
   * drawing on the shared edge).
   */
  snapshot() {
    return {
      width: this.width,
      height: this.height,
      karel: { ...this.karel },
      beeperBag: this.beeperBag === Infinity ? 'INFINITE' : this.beeperBag,
      beepers: [...this.beepers.entries()].map(([key, count]) => {
        const [x, y] = key.split(',').map(Number);
        return { x, y, count };
      }),
      walls: [...this.walls].map((key) => {
        const [x, y, dir] = key.split(',');
        return { x: Number(x), y: Number(y), dir };
      }),
    };
  }
}
