/**
 * THE LANES — the roads the tide walks, from a crack in your real wall to
 * the core.
 *
 * Classic tower defence: the enemy has a PATH, you build beside it. A
 * lane is laid once, when the core lands, from each breach the siege will
 * ever open; later waves only open more of them. A lane is a run of grid
 * cells (you cannot build on it) and the polyline through their centres
 * (what the crawlers walk), from the foot of the wall to the core.
 *
 * ROUTING. Dijkstra over the lattice from the breach's first cell to the
 * core's, four-way, where every cell has a seeded bit of noise and every
 * turn a small price — so a lane wanders a little and bends a few times
 * instead of running dead straight or zig-zagging. Cells another lane
 * already uses cost extra (lanes run separately and only meet near the
 * core).
 *
 * Every distance is PLANT metres (factory/frame.ts).
 */

import { CELL, worldToCell } from '../floor/grid.js';
import { mulberry32 } from '../game/rng.js';
import type { Breach } from './state.js';

export interface Lane {
  /** The breach it starts at (foot of the wall, plant m). */
  breach: Breach;
  /** Its cells, breach to core (the core's own cell excluded). */
  cells: Array<{ i: number; j: number }>;
  /** The walk: x, z pairs from the wall to the core's centre. */
  pts: Float32Array;
  /** Cumulative length at each point. */
  cum: Float32Array;
  len: number;
}

const key = (i: number, j: number): number => (i + 4096) * 8192 + (j + 4096);

/** Lay one lane per breach, from its wall to the core cell. */
export function layLanes(breaches: Breach[], core: { i: number; j: number }, seed: number): Lane[] {
  const rng = mulberry32(seed);
  const noise = new Map<number, number>();
  const noiseAt = (i: number, j: number): number => {
    const k = key(i, j);
    let v = noise.get(k);
    if (v === undefined) {
      v = rng();
      noise.set(k, v);
    }
    return v;
  };
  const used = new Set<number>();
  const lanes: Lane[] = [];
  for (const b of breaches) {
    // The first cell is just inside the wall.
    const start = worldToCell(b.x + b.nx * CELL * 0.6, b.z + b.nz * CELL * 0.6);
    const cells = route(start, core, (i, j) => {
      const near = Math.abs(i - core.i) + Math.abs(j - core.j) <= 2;
      return 1 + noiseAt(i, j) * 0.9 + (used.has(key(i, j)) && !near ? 3 : 0);
    });
    for (const c of cells) used.add(key(c.i, c.j));
    // The walk: out of the wall, along the cells' centres, into the core.
    const raw: number[] = [b.x, b.z];
    for (const c of cells) raw.push((c.i + 0.5) * CELL, (c.j + 0.5) * CELL);
    raw.push((core.i + 0.5) * CELL, (core.j + 0.5) * CELL);
    const pts = simplify(raw);
    const cum = new Float32Array(pts.length / 2);
    for (let k = 1; k < cum.length; k++) {
      cum[k] = cum[k - 1] + Math.hypot(pts[k * 2] - pts[k * 2 - 2], pts[k * 2 + 1] - pts[k * 2 - 1]);
    }
    lanes.push({ breach: b, cells, pts, cum, len: cum[cum.length - 1] });
  }
  return lanes;
}

/** Cheapest four-way route from `a` to beside `b` (b itself excluded). */
function route(
  a: { i: number; j: number },
  b: { i: number; j: number },
  cost: (i: number, j: number) => number,
): Array<{ i: number; j: number }> {
  const pad = 4;
  const i0 = Math.min(a.i, b.i) - pad;
  const j0 = Math.min(a.j, b.j) - pad;
  const W = Math.abs(a.i - b.i) + 1 + pad * 2;
  const H = Math.abs(a.j - b.j) + 1 + pad * 2;
  // State = cell × arriving direction (so a turn can be priced).
  const N = W * H * 4;
  // Float64: a cost stored at float32 can round below the one popped
  // beside it, and the stale-entry check would then drop live states.
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const DI = [1, -1, 0, 0];
  const DJ = [0, 0, 1, -1];
  const heap: number[] = [];
  const push = (c: number, s: number): void => {
    heap.push(c, s);
    let k = heap.length / 2 - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p * 2] <= heap[k * 2]) break;
      [heap[p * 2], heap[k * 2]] = [heap[k * 2], heap[p * 2]];
      [heap[p * 2 + 1], heap[k * 2 + 1]] = [heap[k * 2 + 1], heap[p * 2 + 1]];
      k = p;
    }
  };
  const pop = (): [number, number] => {
    const top: [number, number] = [heap[0], heap[1]];
    const lc = heap[heap.length - 2];
    const ls = heap[heap.length - 1];
    heap.length -= 2;
    if (heap.length > 0) {
      heap[0] = lc;
      heap[1] = ls;
      let k = 0;
      const n = heap.length / 2;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let m = k;
        if (l < n && heap[l * 2] < heap[m * 2]) m = l;
        if (r < n && heap[r * 2] < heap[m * 2]) m = r;
        if (m === k) break;
        [heap[m * 2], heap[k * 2]] = [heap[k * 2], heap[m * 2]];
        [heap[m * 2 + 1], heap[k * 2 + 1]] = [heap[k * 2 + 1], heap[m * 2 + 1]];
        k = m;
      }
    }
    return top;
  };
  const idx = (i: number, j: number, d: number): number => ((j - j0) * W + (i - i0)) * 4 + d;
  const inside = (i: number, j: number): boolean => i >= i0 && j >= j0 && i < i0 + W && j < j0 + H;
  for (let d = 0; d < 4; d++) {
    dist[idx(a.i, a.j, d)] = 0;
    push(0, idx(a.i, a.j, d));
  }
  let end = -1;
  while (heap.length > 0) {
    const [c, s] = pop();
    if (c > dist[s]) continue;
    const cell = Math.floor(s / 4);
    const d = s % 4;
    const ci = (cell % W) + i0;
    const cj = Math.floor(cell / W) + j0;
    // Arrived: beside the core (four-way).
    if (Math.abs(ci - b.i) + Math.abs(cj - b.j) === 1) {
      end = s;
      break;
    }
    for (let nd = 0; nd < 4; nd++) {
      const ni = ci + DI[nd];
      const nj = cj + DJ[nd];
      if (!inside(ni, nj) || (ni === b.i && nj === b.j)) continue;
      // (The start is seeded in every direction, so its first step is free.)
      const turn = nd === d ? 0 : 0.7;
      const nc = c + cost(ni, nj) + turn;
      const ns = idx(ni, nj, nd);
      if (nc < dist[ns]) {
        dist[ns] = nc;
        prev[ns] = s;
        push(nc, ns);
      }
    }
  }
  const out: Array<{ i: number; j: number }> = [];
  for (let s = end; s >= 0; s = prev[s]) {
    const cell = Math.floor(s / 4);
    out.push({ i: (cell % W) + i0, j: Math.floor(cell / W) + j0 });
  }
  out.reverse();
  // Dijkstra seeds every direction at the start: drop the repeat.
  return out.filter((c, k) => k === 0 || c.i !== out[k - 1].i || c.j !== out[k - 1].j);
}

/** Drop points that sit on a straight line between their neighbours. */
function simplify(raw: number[]): Float32Array {
  const out: number[] = [raw[0], raw[1]];
  for (let k = 1; k < raw.length / 2 - 1; k++) {
    const ax = out[out.length - 2];
    const az = out[out.length - 1];
    const bx = raw[k * 2];
    const bz = raw[k * 2 + 1];
    const cx = raw[k * 2 + 2];
    const cz = raw[k * 2 + 3];
    const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    if (Math.abs(cross) > 1e-6) out.push(bx, bz);
  }
  out.push(raw[raw.length - 2], raw[raw.length - 1]);
  return new Float32Array(out);
}

/** A point `s` metres along a lane, and its direction there. */
export function laneAt(l: Lane, s: number, out: { x: number; z: number; dx: number; dz: number }): void {
  const n = l.cum.length;
  if (s <= 0) s = 0;
  if (s >= l.len) s = l.len - 1e-4;
  // Binary search for the segment.
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (l.cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const seg = l.cum[hi] - l.cum[lo] || 1;
  const t = (s - l.cum[lo]) / seg;
  const ax = l.pts[lo * 2];
  const az = l.pts[lo * 2 + 1];
  const bx = l.pts[hi * 2];
  const bz = l.pts[hi * 2 + 1];
  out.x = ax + (bx - ax) * t;
  out.z = az + (bz - az) * t;
  out.dx = (bx - ax) / seg;
  out.dz = (bz - az) / seg;
}

/** Every lane cell, for "can I build here?". */
export function laneCellSet(lanes: Lane[]): Set<number> {
  const s = new Set<number>();
  for (const l of lanes) for (const c of l.cells) s.add(key(c.i, c.j));
  return s;
}

export function laneKey(i: number, j: number): number {
  return key(i, j);
}
