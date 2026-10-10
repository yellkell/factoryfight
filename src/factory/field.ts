/**
 * THE FIELD — how the horde finds the core from anywhere in the room.
 *
 * There are no roads. A crawler can come out of any stretch of any wall,
 * so instead of each one finding its own way, the ROOM knows the way:
 * one Dijkstra pass over the lattice, rooted at the core, gives every
 * cell its cost to the core and the direction to walk from it. A step
 * for a crawler is then a lookup, however many thousand there are.
 *
 * TOWERS ARE IN THE WAY. Open floor costs a step; a cell under a tower
 * costs a step plus a CHEW price that grows with the tower's hit points.
 * So the tide pours round a lone tower like water round a rock, a ring
 * with a gap gets walked round to the gap, and a closed ring gets chewed
 * through at its weakest point.
 *
 * THE CROWD. A second, finer grid counts how much body stands in each
 * patch of floor (rebuilt every tick, one add per crawler); every
 * crawler is pushed down its slope. That is what turns ten thousand
 * paths into a tide that spreads, bunches at a choke and fills a gap,
 * for four reads each — no crawler ever looks at another.
 *
 * Every distance is PLANT metres (factory/frame.ts).
 */

import { SIEGE } from '../config.js';
import { CELL } from '../floor/grid.js';
import type { Unit } from './state.js';

const SQRT2 = Math.SQRT2;
/** The eight ways out of a cell: di, dj, length. */
const DI = [1, -1, 0, 0, 1, 1, -1, -1];
const DJ = [0, 0, 1, -1, 1, -1, 1, -1];
const DL = [1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2];

/** The crowd's grid edge (plant m): about a mite and a half across. */
export const CROWD_CELL = 0.12;

export class Field {
  /** The lattice cell at the field's corner, and its size in cells. */
  i0 = 0;
  j0 = 0;
  w = 0;
  h = 0;
  /** The core's cell (where every road ends). */
  coreI = 0;
  coreJ = 0;
  /** Cost to the core from each cell, in cells of walking (chews priced in). */
  dist = new Float32Array(0);
  /** Which way to walk from each cell (unit vector on the plan). */
  dx = new Float32Array(0);
  dz = new Float32Array(0);
  /** The cell the cheapest way leaves by (index; −1 at the core). */
  step = new Int32Array(0);
  /** The tower standing in each cell (the core is not in the way: it is
   *  where they are going). */
  tower: Array<Unit | undefined> = [];
  /** 1 where a tower stands in the cell or any cell round it: nowhere
   *  else can a step run into one, so nowhere else needs to look. */
  nearTower = new Uint8Array(0);

  /** The crowd: body per patch of floor, and its grid's corner and size. */
  crowd = new Float32Array(0);
  cx0 = 0;
  cz0 = 0;
  cw = 0;
  ch = 0;

  /** Is there a field at all (no core, no field)? */
  get live(): boolean {
    return this.w > 0;
  }

  /** The field's index for plan point (x, z) — −1 off it. */
  at(x: number, z: number): number {
    const i = Math.floor(x / CELL) - this.i0;
    const j = Math.floor(z / CELL) - this.j0;
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }

  /**
   * Lay the field: over the plan rectangle (x0, z0)–(x1, z1) plus a
   * margin, rooted at the core's cell, with every unit but the core in
   * the way.
   */
  build(core: { i: number; j: number }, units: readonly Unit[], x0: number, z0: number, x1: number, z1: number): void {
    const pad = 2;
    this.i0 = Math.min(core.i, Math.floor(x0 / CELL)) - pad;
    this.j0 = Math.min(core.j, Math.floor(z0 / CELL)) - pad;
    this.w = Math.max(core.i, Math.floor(x1 / CELL)) + pad + 1 - this.i0;
    this.h = Math.max(core.j, Math.floor(z1 / CELL)) + pad + 1 - this.j0;
    this.coreI = core.i;
    this.coreJ = core.j;
    const n = this.w * this.h;
    if (this.dist.length < n) {
      this.dist = new Float32Array(n);
      this.dx = new Float32Array(n);
      this.dz = new Float32Array(n);
      this.step = new Int32Array(n);
      this.nearTower = new Uint8Array(n);
    }
    this.nearTower.fill(0, 0, n);
    this.tower = new Array(n);
    const price = new Float32Array(n).fill(1);
    for (const u of units) {
      if (u.type === 'dock') continue;
      const i = u.i - this.i0;
      const j = u.j - this.j0;
      if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
      const k = j * this.w + i;
      this.tower[k] = u;
      price[k] = 1 + SIEGE.chewBase + u.hp * SIEGE.chewPerHp;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ni = i + di;
          const nj = j + dj;
          if (ni >= 0 && nj >= 0 && ni < this.w && nj < this.h) this.nearTower[nj * this.w + ni] = 1;
        }
      }
    }
    const W = this.w;
    const H = this.h;
    const dist = this.dist;
    dist.fill(Infinity, 0, n);
    this.step.fill(-1, 0, n);
    // A diagonal may not squeeze between two towers.
    const diagOpen = (i: number, j: number, di: number, dj: number): boolean =>
      !this.tower[j * W + i + di] && !this.tower[(j + dj) * W + i];

    // Dijkstra off the core, on a flat binary heap of (cost, index). The
    // field is walked BACKWARDS, so the price paid stepping from `k` out
    // to a neighbour is `k`'s own: the cell a crawler would step INTO.
    const heap: number[] = [];
    const push = (c: number, k: number): void => {
      heap.push(c, k);
      let m = heap.length / 2 - 1;
      while (m > 0) {
        const p = (m - 1) >> 1;
        if (heap[p * 2] <= heap[m * 2]) break;
        [heap[p * 2], heap[m * 2]] = [heap[m * 2], heap[p * 2]];
        [heap[p * 2 + 1], heap[m * 2 + 1]] = [heap[m * 2 + 1], heap[p * 2 + 1]];
        m = p;
      }
    };
    const pop = (): number => {
      const k = heap[1];
      const lc = heap[heap.length - 2];
      const lk = heap[heap.length - 1];
      heap.length -= 2;
      if (heap.length > 0) {
        heap[0] = lc;
        heap[1] = lk;
        let m = 0;
        const len = heap.length / 2;
        for (;;) {
          const l = m * 2 + 1;
          const r = l + 1;
          let b = m;
          if (l < len && heap[l * 2] < heap[b * 2]) b = l;
          if (r < len && heap[r * 2] < heap[b * 2]) b = r;
          if (b === m) break;
          [heap[b * 2], heap[m * 2]] = [heap[m * 2], heap[b * 2]];
          [heap[b * 2 + 1], heap[m * 2 + 1]] = [heap[m * 2 + 1], heap[b * 2 + 1]];
          m = b;
        }
      }
      return k;
    };
    const start = (core.j - this.j0) * W + (core.i - this.i0);
    dist[start] = 0;
    push(0, start);
    const done = new Uint8Array(n);
    while (heap.length > 0) {
      const k = pop();
      if (done[k]) continue;
      done[k] = 1;
      const i = k % W;
      const j = (k - i) / W;
      for (let d = 0; d < 8; d++) {
        const ni = i + DI[d];
        const nj = j + DJ[d];
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        // (Except into the core itself: touching its corner is arriving.)
        if (d >= 4 && k !== start && !diagOpen(i, j, DI[d], DJ[d])) continue;
        const nk = nj * W + ni;
        const nc = dist[k] + DL[d] * price[k];
        if (nc < dist[nk]) {
          dist[nk] = nc;
          this.step[nk] = k;
          push(nc, nk);
        }
      }
    }

    // THE WAY: each cell points at the cell it leaves by, then the
    // pointers are blurred with their open neighbours' — so the tide
    // flows in curves rather than in the lattice's eight directions.
    const rx = new Float32Array(n);
    const rz = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const s = this.step[k];
      if (s < 0) continue;
      const di = (s % W) - (k % W);
      const dj = Math.floor(s / W) - Math.floor(k / W);
      const l = Math.hypot(di, dj) || 1;
      rx[k] = di / l;
      rz[k] = dj / l;
    }
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        let sx = rx[k] * 2;
        let sz = rz[k] * 2;
        // A tower's own cell keeps its pointer: whoever is chewing it
        // is chewing it, not drifting off it.
        if (!this.tower[k]) {
          for (let d = 0; d < 8; d++) {
            const ni = i + DI[d];
            const nj = j + DJ[d];
            if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
            const nk = nj * W + ni;
            if (this.tower[nk]) continue;
            sx += rx[nk];
            sz += rz[nk];
          }
        }
        const l = Math.hypot(sx, sz);
        this.dx[k] = l > 1e-6 ? sx / l : rx[k];
        this.dz[k] = l > 1e-6 ? sz / l : rz[k];
      }
    }

    // The crowd grid covers the same ground.
    this.cx0 = this.i0 * CELL;
    this.cz0 = this.j0 * CELL;
    this.cw = Math.ceil((W * CELL) / CROWD_CELL) + 1;
    this.ch = Math.ceil((H * CELL) / CROWD_CELL) + 1;
    if (this.crowd.length < this.cw * this.ch) this.crowd = new Float32Array(this.cw * this.ch);
  }

  /** No core, no field. */
  clear(): void {
    this.w = this.h = 0;
    this.tower = [];
  }

  /**
   * Which way to walk from plan point (x, z): the four nearest cells'
   * ways, blended by distance — written into out.x, out.z (unit length;
   * straight at the core off the field's edge).
   */
  way(x: number, z: number, out: { x: number; z: number }): void {
    const fx = x / CELL - 0.5 - this.i0;
    const fz = z / CELL - 0.5 - this.j0;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    if (i < 0 || j < 0 || i + 1 >= this.w || j + 1 >= this.h) {
      const ax = (this.coreI + 0.5) * CELL - x;
      const az = (this.coreJ + 0.5) * CELL - z;
      const l = Math.sqrt(ax * ax + az * az) || 1;
      out.x = ax / l;
      out.z = az / l;
      return;
    }
    const tx = fx - i;
    const tz = fz - j;
    const k = j * this.w + i;
    const W = this.w;
    const a = (1 - tx) * (1 - tz);
    const b = tx * (1 - tz);
    const c = (1 - tx) * tz;
    const d = tx * tz;
    const vx = this.dx[k] * a + this.dx[k + 1] * b + this.dx[k + W] * c + this.dx[k + W + 1] * d;
    const vz = this.dz[k] * a + this.dz[k + 1] * b + this.dz[k + W] * c + this.dz[k + W + 1] * d;
    // (sqrt, not hypot: this runs for every crawler, every tick.)
    const l = Math.sqrt(vx * vx + vz * vz);
    if (l > 1e-4) {
      out.x = vx / l;
      out.z = vz / l;
    } else {
      out.x = this.dx[k];
      out.z = this.dz[k];
    }
  }

  /** How far from the core (plant m, by the road) plan point (x, z) is. */
  distAt(x: number, z: number): number {
    const k = this.at(x, z);
    if (k < 0) return Math.hypot((this.coreI + 0.5) * CELL - x, (this.coreJ + 0.5) * CELL - z) + 1;
    return this.dist[k] * CELL;
  }

  /* ── the crowd ──────────────────────────────────────────────────────── */

  /** Start a tick's count. */
  crowdReset(): void {
    this.crowd.fill(0, 0, this.cw * this.ch);
  }

  /** One body of radius r stands at (x, z). */
  crowdAdd(x: number, z: number, r: number): void {
    const i = Math.floor((x - this.cx0) / CROWD_CELL);
    const j = Math.floor((z - this.cz0) / CROWD_CELL);
    if (i < 0 || j < 0 || i >= this.cw || j >= this.ch) return;
    // Share of the patch it covers (a full patch reads 1).
    this.crowd[j * this.cw + i] += (Math.PI * r * r) / (CROWD_CELL * CROWD_CELL);
  }

  /** The crowd's push at (x, z): down the slope of the count, as a
   *  velocity (plant m/s) written into out. */
  crowdPush(x: number, z: number, out: { x: number; z: number }): void {
    const i = Math.floor((x - this.cx0) / CROWD_CELL);
    const j = Math.floor((z - this.cz0) / CROWD_CELL);
    out.x = 0;
    out.z = 0;
    if (i < 1 || j < 1 || i + 1 >= this.cw || j + 1 >= this.ch) return;
    const C = this.crowd;
    const W = this.cw;
    const k = j * W + i;
    const here = C[k];
    // Room to spare: no shove.
    if (here < SIEGE.crowdFull) return;
    out.x = (C[k - 1] - C[k + 1]) * SIEGE.crowdShove;
    out.z = (C[k - W] - C[k + W]) * SIEGE.crowdShove;
    const l2 = out.x * out.x + out.z * out.z;
    const cap = SIEGE.crowdShoveMax;
    if (l2 > cap * cap) {
      const l = Math.sqrt(l2);
      out.x *= cap / l;
      out.z *= cap / l;
    }
  }
}
