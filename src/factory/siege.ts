/**
 * THE SIEGE — the fight, pure of scene and speaker (sim.ts's discipline:
 * anything visible or audible that HAPPENS here leaves as a SiegeFx, and
 * SiegeSystem draws and voices it).
 *
 *   build  — the horn hasn't gone. The NEXT wave's breaches are already
 *            chosen and glowing on your real walls, so you know which
 *            side to wall; the clock runs down (or the horn is sounded
 *            early from the card).
 *   wave   — the TIDE pours out of the plaster, hundreds and then
 *            thousands of them, and paths for the CORE. The guns fire on
 *            their own. When the last one is down, the ladder advances
 *            and the next build phase begins.
 *   fallen — the core went. Nothing moves; the flow takes it from here.
 *
 * THE PATH. Enemies don't steer, they FLOW: one Dijkstra field over the
 * lattice, rooted at the core, recomputed whenever the plant changes.
 * Free floor costs a step; a cell under standing plant costs a step plus
 * a CHEW price that grows with that plant's hit points. So a long wall
 * with a gap gets walked round (the gap is cheaper), and a closed ring
 * gets chewed through at its thinnest point — which is the whole of
 * tower defence's mazing-vs-blocking argument, settled by one number.
 *
 * Every distance here is PLANT metres (factory/frame.ts).
 */

import {
  ENEMIES,
  FACTORY,
  HORDE_KINDS,
  LINES,
  SIEGE,
  WAVES,
  type EnemyId,
  WEAPONS,
  type ItemId,
  type LineId,
  type WaveSpec,
  type WeaponId,
} from '../config.js';
import { HORDE_CAP, PHASE_BITE, PHASE_EMERGE, PHASE_WALK, crowdShove, type Horde } from './horde.js';
import { CELL, cellCenter, cellInFloor, worldToCell } from '../floor/grid.js';
import { floorLayout, type FloorSide } from '../floor/plan.js';
import { cycleFactor, rangeFactor } from '../game/progress.js';
import { mulberry32 } from '../game/rng.js';
import type { Wall } from '../room/walls.js';
import { PLANT_SCALE } from './frame.js';
import { dockUnit, isWeapon, placeUnit, removeUnit } from './sim.js';
import { plant, runSeatedAt, unitAtCell, unitById, type Breach, type SiegeFx, type Unit } from './state.js';

/* ── the room, as the siege sees it ─────────────────────────────────────── */

/** The wall registry (bound by SiegeSystem — the sim never imports a
 *  system). Breaches open in these. */
let roomWalls: readonly Wall[] = [];
export function bindRoom(walls: readonly Wall[]): void {
  roomWalls = walls;
}

/* ── the ladder ─────────────────────────────────────────────────────────── */

/** The spec for wave `n` — authored for the ladder, generated past it:
 *  the last authored wave, scaled up, forever. */
export function waveSpec(n: number): WaveSpec {
  if (n < WAVES.length) return WAVES[n];
  const last = WAVES[WAVES.length - 1];
  const k = n - WAVES.length + 1;
  const grow = SIEGE.endlessGrowth ** k;
  return {
    id: `endless-${k}`,
    name: `OVERTIME ${k}`,
    tip: 'The ladder is done. They are not.',
    breaches: 4,
    buildS: 45,
    spawns: last.spawns.map((sp) => ({
      ...sp,
      count: Math.max(1, Math.round(sp.count * grow)),
      gap: Math.max(0.015, sp.gap / Math.sqrt(grow)),
    })),
    wakes: {},
  };
}

/** Everything waves 0..n switch on — cumulative, so arriving at any wave
 *  (a tool's jump, a resumed siege) is self-sufficient. */
function applyWakes(n: number): void {
  for (let w = 0; w <= n && w < WAVES.length; w++) {
    const spec = WAVES[w];
    for (const feedLine of spec.wakes.feeds ?? []) {
      for (const [side, line] of Object.entries(FACTORY.sides) as Array<[FloorSide, LineId]>) {
        if (line === feedLine && !plant.feedsAwake[side]) {
          plant.feedsAwake[side] = true;
          plant.events.push({ kind: 'feed-wake', side });
        }
      }
    }
    for (const u of spec.wakes.units ?? []) {
      if (!plant.unitsAvailable.includes(u)) plant.unitsAvailable.push(u);
    }
  }
  plant.generation++;
}

/**
 * MAN THE WALLS. A siege opens on a bare floor and asks for ONE thing:
 * the CORE. It is what they come for, so where it stands is the first
 * decision of the game — and nothing else is offered, no clock runs and
 * no wall cracks until it does (the breaches are picked relative to it,
 * so they can't be chosen before it lands).
 */
export function startSiege(atWave = 0): void {
  const sg = plant.siege;
  plant.mode = 'shop';
  plant.orderIndex = -1;
  plant.goalsDone = false;
  plant.bank = { ...SIEGE.startBank };
  sg.phase = 'core';
  sg.wave = Math.max(0, atWave);
  sg.kills = 0;
  sg.scrap = 0;
  sg.horde.clear();
  sg.streams = [];
  sg.won = sg.wave >= WAVES.length;
  sg.breaches = [];
  applyWakes(sg.wave);
}

/** Is the floor still waiting for its core? While it is, the core is the
 *  only thing the catalogue offers. */
export function awaitingCore(): boolean {
  return plant.siege.phase === 'core';
}

/** TOOLS ONLY. Stand the core on the cell nearest the tape's middle. */
export function standCore(): void {
  if (dockUnit()) return;
  const cx = (floorLayout.left + floorLayout.right) / 2 / PLANT_SCALE;
  const cz = (floorLayout.far + floorLayout.near) / 2 / PLANT_SCALE;
  const c = worldToCell(cx, cz);
  for (let r = 0; r < 4; r++) {
    for (let di = -r; di <= r; di++) {
      for (let dj = -r; dj <= r; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        if (!cellInFloor(c.i + di, c.j + dj) || unitAtCell(c.i + di, c.j + dj)) continue;
        if (placeUnit('dock', c.i + di, c.j + dj, 0)) return;
      }
    }
  }
}

function beginBuild(n: number): void {
  const sg = plant.siege;
  const spec = waveSpec(n);
  sg.phase = 'build';
  sg.wave = n;
  sg.buildT = spec.buildS;
  sg.waveT = 0;
  sg.streams = [];
  sg.breaches = pickBreaches(spec.breaches, 0x5eed + n * 7919);
  for (const b of sg.breaches) fx({ kind: 'breach', x: b.x, y: 0, z: b.z });
}

/** SOUND THE HORN — the build phase ends now (the card's button, and the
 *  clock running out, both come through here). */
export function soundHorn(): void {
  const sg = plant.siege;
  if (sg.phase !== 'build') return;
  const spec = waveSpec(sg.wave);
  sg.phase = 'wave';
  sg.waveT = 0;
  sg.buildT = 0;
  sg.streams = spec.spawns.map((sp) => ({
    enemy: sp.enemy,
    left: sp.count,
    gap: sp.gap,
    next: sp.at,
    breach: sp.breach,
  }));
  const core = dockUnit();
  if (core) {
    cellCenter(core.i, core.j, _c);
    fx({ kind: 'horn', x: _c.x, y: 0, z: _c.z });
  }
  fieldDirty = true;
}

/* ── THE BREACHES ───────────────────────────────────────────────────────── */

/**
 * Where the plaster cracks. Candidates are spots along the FOOT of every
 * real wall (they come out at floor level and walk), far enough from the
 * core that there is a fight to be had; then the picker spreads them
 * round the core — each new breach the candidate that best splits the
 * angle from the ones already chosen, with a seeded nudge so two sieges
 * don't crack the same plaster in the same order.
 */
export function pickBreaches(n: number, seed: number): Breach[] {
  const rng = mulberry32(seed);
  const core = dockUnit();
  if (!core) return [];
  cellCenter(core.i, core.j, _c);
  const cands: Array<Breach & { ang: number; d: number }> = [];
  for (const w of roomWalls) {
    if (w.kind !== 'wall' || w.halfW < 0.35) continue;
    const steps = Math.max(2, Math.floor(w.halfW / 0.35));
    for (let k = 0; k <= steps; k++) {
      const u = (-1 + (2 * k) / steps) * (w.halfW - 0.3);
      const rx = w.center.x + w.right.x * u;
      const rz = w.center.z + w.right.z * u;
      const nx = w.normal.x;
      const nz = w.normal.z;
      const nl = Math.hypot(nx, nz) || 1;
      const x = rx / PLANT_SCALE;
      const z = rz / PLANT_SCALE;
      const d = Math.hypot(x - _c.x, z - _c.z);
      if (d < 1.6) continue;
      cands.push({
        x,
        z,
        nx: nx / nl,
        nz: nz / nl,
        wall: (w.halfW * 2) / PLANT_SCALE,
        ang: Math.atan2(x - _c.x, z - _c.z),
        d,
      });
    }
  }
  if (cands.length === 0) {
    // No walls at all (a tool with no room): a ring round the core.
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng() * 0.6;
      cands.push({
        x: _c.x + Math.sin(a) * 3,
        z: _c.z + Math.cos(a) * 3,
        nx: -Math.sin(a),
        nz: -Math.cos(a),
        wall: 1,
        ang: a,
        d: 3,
      });
    }
  }
  const out: typeof cands = [];
  const first = Math.floor(rng() * cands.length);
  out.push(cands[first]);
  while (out.length < n && out.length < cands.length) {
    let best = -1;
    let bestScore = -Infinity;
    for (let k = 0; k < cands.length; k++) {
      const c = cands[k];
      if (out.includes(c)) continue;
      let sep = Infinity;
      for (const o of out) {
        const da = Math.abs(Math.atan2(Math.sin(c.ang - o.ang), Math.cos(c.ang - o.ang)));
        sep = Math.min(sep, da);
      }
      const score = sep + rng() * 0.35 + Math.min(c.d, 5) * 0.05;
      if (score > bestScore) {
        bestScore = score;
        best = k;
      }
    }
    if (best < 0) break;
    out.push(cands[best]);
  }
  return out.map(({ x, z, nx, nz, wall }) => ({ x, z, nx, nz, wall }));
}

/* ── THE FLOW FIELD ─────────────────────────────────────────────────────── */

let fieldDirty = true;
let fieldGen = -1;
let fieldAge = 0;
let fI0 = 0;
let fJ0 = 0;
let fW = 0;
let fH = 0;
let field = new Float32Array(0);
/** Per field cell: the unit standing there (id, −1 none), whether it is
 *  the core, and the next cell toward the core (index, −1 none). Built
 *  with the field, so a crawler's step is three array reads. */
let occ = new Int32Array(0);
let occHp = new Float32Array(0);
let occDock = new Uint8Array(0);
let step = new Int32Array(0);

const SQRT2 = Math.SQRT2;
const NB: ReadonlyArray<[number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

/** A cell's index in the field (−1 off it). */
function fieldIndex(i: number, j: number): number {
  if (i < fI0 || j < fJ0 || i >= fI0 + fW || j >= fJ0 + fH) return -1;
  return (j - fJ0) * fW + (i - fI0);
}

function enterCost(idx: number): number {
  if (occ[idx] < 0 || occDock[idx]) return 1;
  return 1 + SIEGE.chewBase + occHp[idx] * SIEGE.chewPerHp;
}

/** A diagonal step may not squeeze between two pieces of plant. */
function diagonalOpen(i: number, j: number, di: number, dj: number): boolean {
  const a = fieldIndex(i + di, j);
  const b = fieldIndex(i, j + dj);
  return (a < 0 || occ[a] < 0) && (b < 0 || occ[b] < 0);
}

function rebuildField(): void {
  const core = dockUnit();
  fieldDirty = false;
  fieldGen = plant.generation;
  fieldAge = 0;
  if (!core) {
    fW = fH = 0;
    return;
  }
  // The field covers the floor, every breach, every crawler, and a
  // margin round them all.
  let i0 = core.i;
  let i1 = core.i;
  let j0 = core.j;
  let j1 = core.j;
  const grow = (x: number, z: number): void => {
    const i = Math.floor(x / CELL);
    const j = Math.floor(z / CELL);
    if (i < i0) i0 = i;
    if (i > i1) i1 = i;
    if (j < j0) j0 = j;
    if (j > j1) j1 = j;
  };
  grow(floorLayout.left / PLANT_SCALE, floorLayout.far / PLANT_SCALE);
  grow(floorLayout.right / PLANT_SCALE, floorLayout.near / PLANT_SCALE);
  for (const b of plant.siege.breaches) grow(b.x, b.z);
  const h = plant.siege.horde;
  for (let k = 0; k < h.n; k++) grow(h.x[k], h.z[k]);
  const pad = SIEGE.fieldPad;
  fI0 = i0 - pad;
  fJ0 = j0 - pad;
  fW = i1 - i0 + 1 + pad * 2;
  fH = j1 - j0 + 1 + pad * 2;
  const n = fW * fH;
  if (field.length < n) {
    field = new Float32Array(n);
    occ = new Int32Array(n);
    occHp = new Float32Array(n);
    occDock = new Uint8Array(n);
    step = new Int32Array(n);
  }
  field.fill(Infinity, 0, n);
  occ.fill(-1, 0, n);
  occDock.fill(0, 0, n);
  step.fill(-1, 0, n);
  for (const u of plant.units) {
    const idx = fieldIndex(u.i, u.j);
    if (idx < 0) continue;
    occ[idx] = u.id;
    occHp[idx] = u.hp;
    occDock[idx] = u.type === 'dock' ? 1 : 0;
  }
  // Dijkstra off the core, on a plain binary heap of (cost, index).
  const heap: number[] = [];
  const push = (cost: number, idx: number): void => {
    heap.push(cost, idx);
    let c = heap.length / 2 - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p * 2] <= heap[c * 2]) break;
      [heap[p * 2], heap[c * 2]] = [heap[c * 2], heap[p * 2]];
      [heap[p * 2 + 1], heap[c * 2 + 1]] = [heap[c * 2 + 1], heap[p * 2 + 1]];
      c = p;
    }
  };
  const pop = (): [number, number] => {
    const top: [number, number] = [heap[0], heap[1]];
    const lastI = heap.pop()!;
    const lastC = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = lastC;
      heap[1] = lastI;
      let c = 0;
      const len = heap.length / 2;
      for (;;) {
        const l = c * 2 + 1;
        const r = l + 1;
        let m = c;
        if (l < len && heap[l * 2] < heap[m * 2]) m = l;
        if (r < len && heap[r * 2] < heap[m * 2]) m = r;
        if (m === c) break;
        [heap[m * 2], heap[c * 2]] = [heap[c * 2], heap[m * 2]];
        [heap[m * 2 + 1], heap[c * 2 + 1]] = [heap[c * 2 + 1], heap[m * 2 + 1]];
        c = m;
      }
    }
    return top;
  };
  const start = fieldIndex(core.i, core.j);
  field[start] = 0;
  push(0, start);
  while (heap.length > 0) {
    const [cost, idx] = pop();
    if (cost > field[idx]) continue;
    const ci = (idx % fW) + fI0;
    const cj = Math.floor(idx / fW) + fJ0;
    for (const [di, dj, st] of NB) {
      const nidx = fieldIndex(ci + di, cj + dj);
      if (nidx < 0) continue;
      if (di !== 0 && dj !== 0 && !diagonalOpen(ci, cj, di, dj)) continue;
      // The field is walked BACKWARDS (from the core outward), so the
      // price paid is the one for the cell being left on the way in —
      // i.e. the cell we are standing in now.
      const nc = cost + st * enterCost(idx);
      if (nc < field[nidx]) {
        field[nidx] = nc;
        push(nc, nidx);
      }
    }
  }
  // Each cell's way down: the neighbour nearest the core.
  for (let idx = 0; idx < n; idx++) {
    const ci = (idx % fW) + fI0;
    const cj = Math.floor(idx / fW) + fJ0;
    let best = -1;
    let bestD = field[idx];
    for (const [di, dj, st] of NB) {
      const nidx = fieldIndex(ci + di, cj + dj);
      if (nidx < 0) continue;
      if (di !== 0 && dj !== 0 && !diagonalOpen(ci, cj, di, dj)) continue;
      const d = field[nidx] + (st - 1) * 0.01;
      if (d < bestD) {
        bestD = d;
        best = nidx;
      }
    }
    step[idx] = best;
  }
}

/** The field's distance-to-core at a cell (Infinity off the field). */
export function fieldAt(i: number, j: number): number {
  const idx = fieldIndex(i, j);
  return idx < 0 ? Infinity : field[idx];
}

/** Can a crawler stand at (x, z)? Not inside standing plant (they chew
 *  it from outside) — the core's cell included. */
function walkable(x: number, z: number): boolean {
  const idx = fieldIndex(Math.floor(x / CELL), Math.floor(z / CELL));
  return idx < 0 || occ[idx] < 0;
}

/* ── the tick ───────────────────────────────────────────────────────────── */

const _c = { x: 0, z: 0 };
const _n = { x: 0, z: 0 };

/** Specs by horde kind index, and each kind's radius (the crowd). */
const SPECS = HORDE_KINDS.map((k) => ENEMIES[k]);
const RADII = new Float32Array(SPECS.map((sp) => sp.radius));
const MAX_R = Math.max(...SPECS.map((sp) => sp.radius));
/** The largest kind that crowds like the rest (the hulk is bigger). */
const SMALL_MAX = Math.max(...SPECS.filter((sp) => sp.radius < 0.15).map((sp) => sp.radius));
const KIND_INDEX: Record<EnemyId, number> = Object.fromEntries(HORDE_KINDS.map((k, i) => [k, i])) as Record<
  EnemyId,
  number
>;

/** Weapons by index — what killed a crawler, in the horde's death log. */
export const WEAPON_ORDER: WeaponId[] = ['turret', 'mortar', 'tesla', 'flamer', 'piston'];
const W: Record<WeaponId, number> = { turret: 0, mortar: 1, tesla: 2, flamer: 3, piston: 4 };

function fx(e: SiegeFx): void {
  const list = plant.siege.fx;
  if (list.length < 400) list.push(e);
}

/** Crawlers still to come plus those on the floor. */
export function siegeLeft(): number {
  const sg = plant.siege;
  let n = sg.horde.n;
  for (const st of sg.streams) n += st.left;
  return n;
}

let simAvg = 0;
/** Smoothed milliseconds a siege tick takes (tools read it). */
export function simMs(): number {
  return simAvg;
}

export function siegeTick(dt: number): void {
  const t0 = performance.now();
  tickSiege(dt);
  simAvg = simAvg * 0.9 + (performance.now() - t0) * 0.1;
}

function tickSiege(dt: number): void {
  const sg = plant.siege;
  if (frozen || sg.phase === 'off' || sg.phase === 'fallen') return;
  // The core just landed: the siege begins.
  if (sg.phase === 'core') {
    if (dockUnit()) beginBuild(sg.wave);
    return;
  }

  if (plant.generation !== fieldGen) fieldDirty = true;
  fieldAge += dt;
  // Chew prices move as plant gets bitten, so a live wave re-walks the
  // field a few times a second even when nothing was built.
  if (fieldDirty || (sg.phase === 'wave' && fieldAge > 0.5)) rebuildField();

  // Plant knits itself back between bites.
  for (const u of plant.units) {
    u.hurtT += dt;
    if (u.hurtT > SIEGE.repairDelayS && u.hp < u.maxHp) {
      u.hp = Math.min(u.maxHp, u.hp + SIEGE.repairPerS * dt);
    }
  }

  if (sg.phase === 'build') {
    sg.buildT -= dt;
    if (sg.buildT <= 0) soundHorn();
  } else if (sg.phase === 'wave') {
    sg.waveT += dt;
    // THE STREAMS pour, as fast as their gap — and hold while the floor
    // is at the horde's cap, so a flood can't outrun the arrays.
    for (const st of sg.streams) {
      while (st.left > 0 && st.next <= sg.waveT && sg.horde.n < HORDE_CAP) {
        spawn(st.enemy, st.breach);
        st.left--;
        st.next += st.gap;
      }
    }
    sg.streams = sg.streams.filter((st) => st.left > 0);
  }

  tickHorde(dt);
  if (plant.siege.phase === 'fallen') return;
  sg.horde.rebucket();
  tickWeapons(dt);
  tickShots(dt);
  tickFires(dt);
  sg.horde.sweep();

  if (sg.phase === 'wave' && sg.streams.length === 0 && sg.horde.n === 0) {
    waveCleared();
  }
}

function waveCleared(): void {
  const sg = plant.siege;
  const core = dockUnit();
  if (core) cellCenter(core.i, core.j, _c);
  const next = sg.wave + 1;
  if (next === WAVES.length && !sg.won) {
    sg.won = true;
    fx({ kind: 'victory', x: _c.x, y: 0, z: _c.z });
  } else {
    fx({ kind: 'clear', x: _c.x, y: 0, z: _c.z });
  }
  applyWakes(next);
  beginBuild(next);
}

function spawn(kind: EnemyId, breachIdx: number): number {
  const sg = plant.siege;
  const nb = Math.max(1, sg.breaches.length);
  const b = sg.breaches[breachIdx % nb];
  if (!b) return -1;
  const spec = ENEMIES[kind];
  // Spread along the crack, so a stream is a crowd and not a queue.
  const along = (Math.random() - 0.5) * Math.min(0.8, b.wall * 0.45);
  const tx = -b.nz;
  const tz = b.nx;
  const back = 0.04 + Math.random() * 0.08;
  return sg.horde.add(
    KIND_INDEX[kind],
    b.x + tx * along - b.nx * back,
    b.z + tz * along - b.nz * back,
    spec.hp,
    Math.atan2(b.nx, b.nz),
    breachIdx % nb,
  );
}

/** Every crawler, one step: burn, reel, climb out, flow for the core,
 *  bite what is in the way. Then the crowd shoves itself apart. */
function tickHorde(dt: number): void {
  const sg = plant.siege;
  const h = sg.horde;
  const core = dockUnit();
  let coreX = 0;
  let coreZ = 0;
  if (core) {
    cellCenter(core.i, core.j, _c);
    coreX = _c.x;
    coreZ = _c.z;
  }
  const nb = Math.max(1, sg.breaches.length);
  for (let i = 0; i < h.n; i++) {
    if (h.dead[i]) continue;
    const spec = SPECS[h.kind[i]];
    if (h.flash[i] > 0) h.flash[i] -= dt;
    h.phaseT[i] += dt;

    // ON FIRE: it burns where it stands, and it still comes.
    if (h.burnT[i] > 0) {
      h.burnT[i] -= dt;
      h.hp[i] -= h.burnDps[i] * dt;
      if (h.hp[i] <= 0) {
        die(i, W.flamer);
        continue;
      }
    }
    // PUNCHED: thrown back, then reeling.
    if (h.kT[i] > 0) {
      h.kT[i] -= dt;
      const nx = h.x[i] + h.kvx[i] * dt;
      const nz = h.z[i] + h.kvz[i] * dt;
      if (walkable(nx, nz)) {
        h.x[i] = nx;
        h.z[i] = nz;
      }
      continue;
    }
    if (h.stunT[i] > 0) {
      h.stunT[i] -= dt;
      continue;
    }
    const pace = spec.speed;

    if (h.phase[i] === PHASE_EMERGE) {
      // Out of the plaster, along the wall's normal.
      const b = sg.breaches[h.breach[i] % nb];
      const st = pace * 0.8 * dt;
      if (b) {
        h.x[i] += b.nx * st;
        h.z[i] += b.nz * st;
      }
      h.stride[i] += st;
      if (h.phaseT[i] * pace * 0.8 >= SIEGE.emergeDepth + 0.1) {
        h.phase[i] = PHASE_WALK;
        h.phaseT[i] = 0;
      }
      continue;
    }
    if (!core) continue;

    const ci = Math.floor(h.x[i] / CELL);
    const cj = Math.floor(h.z[i] / CELL);
    const fidx = fieldIndex(ci, cj);
    const cdx = coreX - h.x[i];
    const cdz = coreZ - h.z[i];
    const toCore = Math.sqrt(cdx * cdx + cdz * cdz);
    h.fd[i] = fidx >= 0 && field[fidx] < Infinity ? field[fidx] : 1e4 + toCore;
    const reach = CELL * 0.5 + spec.radius + 0.04;

    // At the core: bite it.
    if (toCore <= reach + CELL * 0.15) {
      bite(i, core, coreX, coreZ, dt);
      continue;
    }

    // The field's next step. Off the field (or lost) — straight at it.
    let tx = coreX;
    let tz = coreZ;
    let blocker = -1;
    if (fidx >= 0 && field[fidx] < Infinity) {
      const nx = step[fidx];
      if (nx >= 0) {
        tx = ((nx % fW) + fI0 + 0.5) * CELL;
        tz = (Math.floor(nx / fW) + fJ0 + 0.5) * CELL;
        if (occ[nx] >= 0 && !occDock[nx]) blocker = nx;
      }
    } else if (fidx >= 0 && occ[fidx] >= 0 && !occDock[fidx]) {
      blocker = fidx;
    }

    if (blocker >= 0) {
      const bx = ((blocker % fW) + fI0 + 0.5) * CELL;
      const bz = (Math.floor(blocker / fW) + fJ0 + 0.5) * CELL;
      const bdx = bx - h.x[i];
      const bdz = bz - h.z[i];
      if (bdx * bdx + bdz * bdz <= reach * reach) {
        const u = unitById(occ[blocker]);
        if (u) {
          bite(i, u, bx, bz, dt);
          continue;
        }
      }
    }

    h.phase[i] = PHASE_WALK;
    h.target[i] = -1;
    // A per-crawler lane, perpendicular to travel, so a column spreads.
    let dx = tx - h.x[i];
    let dz = tz - h.z[i];
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    dx /= len;
    dz /= len;
    const lane = h.lane[i] * CELL * 1.1;
    const ox = tx - dz * lane - h.x[i];
    const oz = tz + dx * lane - h.z[i];
    const l2 = Math.sqrt(ox * ox + oz * oz) || 1;
    const st = Math.min(l2, pace * dt);
    const nx = h.x[i] + (ox / l2) * st;
    const nz = h.z[i] + (oz / l2) * st;
    if (walkable(nx, nz)) {
      h.x[i] = nx;
      h.z[i] = nz;
    }
    h.stride[i] += st;
    turnToward(h, i, Math.atan2(ox, oz), dt);
  }

  // THE CROWD. Overlapping crawlers shove apart — so a tide is a carpet,
  // not a column of ghosts on one line. Never into plant.
  h.rebucket();
  crowdShove(h, RADII, SMALL_MAX, SIEGE.shove, SIEGE.shoveMax, walkable, ++crowdTick);
  // The giants wade: everything small near a hulk is pushed out of its
  // way (they are few, so this one can afford to ask the buckets).
  for (let i = crowdTick & 1; i < h.n; i += 2) {
    if (h.dead[i] || RADII[h.kind[i]] <= SMALL_MAX) continue;
    const ri = RADII[h.kind[i]];
    const xi = h.x[i];
    const zi = h.z[i];
    h.near(xi, zi, ri + SMALL_MAX, (j, d) => {
      if (j === i || RADII[h.kind[j]] > SMALL_MAX) return;
      const want = (ri + RADII[h.kind[j]]) * 0.9;
      if (d >= want || d < 1e-4) return;
      const k = (want - d) / d;
      const nx = h.x[j] + (h.x[j] - xi) * k;
      const nz = h.z[j] + (h.z[j] - zi) * k;
      if (walkable(nx, nz)) {
        h.x[j] = nx;
        h.z[j] = nz;
      }
    });
  }
}

let crowdTick = 0;

function turnToward(h: Horde, i: number, want: number, dt: number): void {
  const d = Math.atan2(Math.sin(want - h.heading[i]), Math.cos(want - h.heading[i]));
  h.heading[i] += d * Math.min(1, dt * 8);
}

/** One crawler chewing one piece of plant (the core included). */
function bite(i: number, u: Unit, ux: number, uz: number, dt: number): void {
  const h = plant.siege.horde;
  const spec = SPECS[h.kind[i]];
  turnToward(h, i, Math.atan2(ux - h.x[i], uz - h.z[i]), dt);
  if (h.phase[i] !== PHASE_BITE || h.target[i] !== u.id) {
    h.phase[i] = PHASE_BITE;
    h.target[i] = u.id;
    h.biteT[i] = spec.biteS * (0.3 + Math.random() * 0.7);
  }
  h.stride[i] += dt * 0.15;
  h.biteT[i] -= dt;
  if (h.biteT[i] > 0) return;
  h.biteT[i] = spec.biteS;
  hurtUnit(u, spec.bite);
  // Hundreds biting at once would be hundreds of sparks a second: one
  // in four bites shows.
  if (u.type === 'dock' || Math.random() < 0.25) {
    fx({ kind: u.type === 'dock' ? 'core-hit' : 'bite', x: ux, y: 0, z: uz, unit: u.id, enemy: HORDE_KINDS[h.kind[i]] });
  }
}

function hurtUnit(u: Unit, dmg: number): void {
  if (!unitById(u.id)) return;
  u.hp -= dmg;
  u.hurtT = 0;
  if (u.hp > 0) return;
  if (u.type === 'dock') {
    u.hp = 0;
    fall();
    return;
  }
  cellCenter(u.i, u.j, _n);
  plant.events.push({ kind: 'wreck', unit: u.id });
  fx({ kind: 'blast', x: _n.x, y: 0.4, z: _n.z, radius: 0.25, unit: u.id });
  removeUnit(u);
  fieldDirty = true;
  // The cell is open NOW: a crawler mid-tick must be able to walk in.
  const idx = fieldIndex(u.i, u.j);
  if (idx >= 0) occ[idx] = -1;
}

function fall(): void {
  const sg = plant.siege;
  sg.phase = 'fallen';
  const core = dockUnit();
  if (core) cellCenter(core.i, core.j, _c);
  fx({ kind: 'fallen', x: _c.x, y: 0, z: _c.z });
}

/* ── THE ARSENAL ────────────────────────────────────────────────────────── */

const SHOT_Y = 0.08; // where a shot lands on a body (plant m up)

function rangeOf(w: WeaponId): number {
  return WEAPONS[w].range * rangeFactor();
}

/** The crawler a weapon at (x, z) should engage: in range (and outside
 *  any blind spot), nearest the core along the FIELD — the one about to
 *  arrive is the one that matters. −1 for none. */
function pickTarget(x: number, z: number, range: number, minRange = 0): number {
  const h = plant.siege.horde;
  let best = -1;
  let bestD = Infinity;
  const r2 = range * range;
  const m2 = minRange * minRange;
  for (let i = 0; i < h.n; i++) {
    if (h.dead[i] || (h.phase[i] === PHASE_EMERGE && h.phaseT[i] < 0.3)) continue;
    const dx = h.x[i] - x;
    const dz = h.z[i] - z;
    const d2 = dx * dx + dz * dz;
    if (d2 > r2 || d2 < m2) continue;
    if (h.fd[i] < bestD) {
      bestD = h.fd[i];
      best = i;
    }
  }
  return best;
}

/** Is a fuel-burning weapon plumbed: its line's tube seated and pouring? */
function fuelled(u: Unit): boolean {
  const need = WEAPONS[u.type as WeaponId].fuel;
  if (!need) return true;
  const run = runSeatedAt(u.id);
  return Boolean(run && run.phase === 'flowing' && run.line.id === need);
}

/** Slew a weapon's head toward a yaw; true once it is near enough to fire. */
function slew(u: Unit, want: number, dt: number, tolerance = 0.3): boolean {
  const yaw = u.yaw ?? 0;
  const d = Math.atan2(Math.sin(want - yaw), Math.cos(want - yaw));
  const turn = SIEGE.slew * dt;
  u.yaw = yaw + Math.max(-turn, Math.min(turn, d));
  return Math.abs(d) <= tolerance;
}

function tickWeapons(dt: number): void {
  const h = plant.siege.horde;
  for (const u of plant.units) {
    if (!isWeapon(u.type)) continue;
    const w = u.type as WeaponId;
    const spec = WEAPONS[w];
    u.cool = Math.max(0, (u.cool ?? 0) - dt);
    u.firedT = (u.firedT ?? 99) + dt;
    u.look = (u.look ?? 0) - dt;
    if (!fuelled(u)) continue;
    cellCenter(u.i, u.j, _c);
    const range = rangeOf(w);
    // Keep the one it has while it is alive and in reach; look again
    // twice a second for something nearer the core.
    let ti = -1;
    const hint = u.tgtAt ?? -1;
    if (u.tgt && hint >= 0 && hint < h.n && h.uid[hint] === u.tgt && !h.dead[hint]) {
      const d = Math.hypot(h.x[hint] - _c.x, h.z[hint] - _c.z);
      if (d <= range && d >= (spec.minRange ?? 0)) ti = hint;
    }
    if (ti < 0 || u.look <= 0) {
      ti = pickTarget(_c.x, _c.z, range, spec.minRange ?? 0);
      u.look = 0.5;
    }
    u.tgt = ti >= 0 ? h.uid[ti] : 0;
    u.tgtAt = ti;
    if (ti < 0) continue;
    const want = Math.atan2(h.x[ti] - _c.x, h.z[ti] - _c.z);
    const aimed = slew(u, want, dt, w === 'flamer' || w === 'piston' ? 0.5 : 0.3);
    if (!aimed || u.cool > 0) continue;
    u.cool = spec.cycleS * cycleFactor();
    u.firedT = 0;
    const yaw = u.yaw ?? want;
    const reach = w === 'mortar' ? 0.22 : w === 'piston' ? 0.12 : 0.18;
    const mx = _c.x + Math.sin(yaw) * reach;
    const mz = _c.z + Math.cos(yaw) * reach;
    const my = spec.muzzleY;
    if (w === 'flamer') {
      flame(u, mx, my, mz, yaw);
      continue;
    }
    if (w === 'piston') {
      punch(u, mx, mz, yaw);
      continue;
    }
    fx({ kind: 'fire', x: mx, y: my, z: mz, weapon: w, unit: u.id, yaw });
    if (w === 'tesla') arc(ti, mx, my, mz);
    else shoot(w, mx, my, mz, ti);
  }
}

/** A round in flight (turret slugs, mortar shells). */
function shoot(w: WeaponId, x: number, y: number, z: number, ti: number): void {
  const spec = WEAPONS[w];
  const sg = plant.siege;
  const h = sg.horde;
  const d = Math.hypot(h.x[ti] - x, h.z[ti] - z);
  // A shell leads its target: it lands where the crawler WILL be.
  const lead = w === 'mortar' ? (d / (spec.speed ?? 3)) * 1.6 : 0;
  const hd = h.heading[ti];
  const pace = h.phase[ti] === PHASE_WALK ? SPECS[h.kind[ti]].speed : 0;
  sg.shots.push({
    id: sg.nextShot++,
    weapon: w,
    x0: x,
    y0: y,
    z0: z,
    x1: h.x[ti] + Math.sin(hd) * pace * lead,
    y1: SHOT_Y,
    z1: h.z[ti] + Math.cos(hd) * pace * lead,
    target: w === 'mortar' ? -1 : h.uid[ti],
    at: ti,
    t: 0,
    dur: Math.max(0.05, d / (spec.speed ?? 10)) * (w === 'mortar' ? 1.6 : 1),
  });
}

/** TESLA: bites one, jumps to the nearest it hasn't bitten, and on. */
function arc(ti: number, x: number, y: number, z: number): void {
  const spec = WEAPONS.tesla;
  const h = plant.siege.horde;
  const hit: number[] = [];
  const path: number[] = [x, y, z];
  let cur = ti;
  let dmg = spec.damage;
  const reach = spec.chainReach ?? 0.5;
  for (let hop = 0; cur >= 0 && hop <= (spec.chain ?? 0); hop++) {
    hit.push(cur);
    const cx = h.x[cur];
    const cz = h.z[cur];
    path.push(cx, SHOT_Y + 0.05, cz);
    h.stunT[cur] = Math.max(h.stunT[cur], 0.2);
    hurt(cur, dmg, W.tesla);
    dmg *= 0.92;
    let next = -1;
    let nd = reach;
    h.near(cx, cz, reach, (j, d) => {
      if (d < nd && !hit.includes(j)) {
        nd = d;
        next = j;
      }
    });
    cur = next;
  }
  fx({ kind: 'arc', x, y, z, weapon: 'tesla', path });
}

/** PISTON: the ram drives out and throws the whole front rank back the
 *  way it came — everything in a short cone ahead of it. */
function punch(u: Unit, mx: number, mz: number, yaw: number): void {
  const spec = WEAPONS.piston;
  const h = plant.siege.horde;
  const reach = rangeOf('piston');
  const cone = spec.cone ?? 0.7;
  cellCenter(u.i, u.j, _c);
  let hits = 0;
  h.near(_c.x, _c.z, reach + MAX_R, (i, d) => {
    const a = Math.atan2(h.x[i] - _c.x, h.z[i] - _c.z);
    const off = Math.abs(Math.atan2(Math.sin(a - yaw), Math.cos(a - yaw)));
    if (off > cone && d > 0.12) return;
    hits++;
    hurt(i, spec.damage, W.piston);
    if (h.dead[i]) return;
    const give = SPECS[h.kind[i]].give;
    // Thrown along the ram, a little fanned so the rank scatters.
    const throwYaw = yaw + (a - yaw) * 0.5;
    const dist = (spec.knock ?? 0.9) * give * (1 - (d / (reach + MAX_R)) * 0.5);
    const kt = 0.22;
    h.kvx[i] = (Math.sin(throwYaw) * dist) / kt;
    h.kvz[i] = (Math.cos(throwYaw) * dist) / kt;
    h.kT[i] = kt;
    h.stunT[i] = (spec.stunS ?? 0.5) * give;
    h.phase[i] = PHASE_WALK;
    h.target[i] = -1;
  });
  void hits;
  fx({
    kind: 'punch',
    x: mx + Math.sin(yaw) * 0.2,
    y: 0.2,
    z: mz + Math.cos(yaw) * 0.2,
    weapon: 'piston',
    unit: u.id,
    yaw,
  });
}

/** FLAMER: one tick of the cone — everything inside it scorches and
 *  catches, and now and then the floor where it lands goes up too. */
function flame(u: Unit, x: number, y: number, z: number, yaw: number): void {
  const spec = WEAPONS.flamer;
  const h = plant.siege.horde;
  const reach = rangeOf('flamer');
  const cone = spec.cone ?? 0.5;
  let hits = 0;
  h.near(x, z, reach + MAX_R, (i, d) => {
    const a = Math.atan2(h.x[i] - x, h.z[i] - z);
    const off = Math.abs(Math.atan2(Math.sin(a - yaw), Math.cos(a - yaw)));
    if (off > cone && d > 0.15) return;
    hits++;
    h.burnT[i] = Math.max(h.burnT[i], spec.burn?.s ?? 2);
    h.burnDps[i] = Math.max(h.burnDps[i], spec.burn?.dps ?? 5);
    hurt(i, spec.damage, W.flamer, false);
  });
  fx({ kind: 'flame', x, y, z, weapon: 'flamer', unit: u.id, yaw, reach });
  // Every so often the flame sets the floor alight where it lands.
  if (hits > 0 && Math.random() < 0.2) {
    const fl = plant.siege.fires;
    if (fl.length < 32) {
      const d = reach * (0.55 + Math.random() * 0.4);
      fl.push({ x: x + Math.sin(yaw) * d, z: z + Math.cos(yaw) * d, r: 0.24, t: 0, life: 3 });
    }
  }
}

/** Burning floor: anything standing in it catches. */
function tickFires(dt: number): void {
  const sg = plant.siege;
  const h = sg.horde;
  for (const f of [...sg.fires]) {
    f.t += dt;
    if (f.t >= f.life) {
      sg.fires.splice(sg.fires.indexOf(f), 1);
      continue;
    }
    h.near(f.x, f.z, f.r + MAX_R, (i) => {
      h.burnT[i] = Math.max(h.burnT[i], 1.2);
      h.burnDps[i] = Math.max(h.burnDps[i], 6);
    });
  }
}

function tickShots(dt: number): void {
  const sg = plant.siege;
  const h = sg.horde;
  for (const s of [...sg.shots]) {
    s.t += dt;
    // Slugs home on a live target (a round that misses a running mite is
    // a round nobody believes); shells fall where they were aimed.
    let ti = -1;
    if (s.target > 0) {
      const at = s.at ?? -1;
      if (at >= 0 && at < h.n && h.uid[at] === s.target && !h.dead[at]) ti = at;
      if (ti >= 0) {
        s.x1 = h.x[ti];
        s.z1 = h.z[ti];
      }
    }
    if (s.t < s.dur) continue;
    sg.shots.splice(sg.shots.indexOf(s), 1);
    const spec = WEAPONS[s.weapon];
    const cause = W[s.weapon];
    if (spec.splash) {
      const r = spec.splash;
      h.near(s.x1, s.z1, r + MAX_R, (i, d) => {
        hurt(i, spec.damage * (d < r * 0.5 ? 1 : 0.6), cause);
        // The blast throws the survivors outward.
        if (!h.dead[i] && d > 1e-3) {
          const give = SPECS[h.kind[i]].give * (1 - d / (r + MAX_R));
          const kt = 0.18;
          h.kvx[i] = (((h.x[i] - s.x1) / d) * 0.35 * give) / kt;
          h.kvz[i] = (((h.z[i] - s.z1) / d) * 0.35 * give) / kt;
          h.kT[i] = kt;
        }
      });
      fx({ kind: 'shell', x: s.x1, y: s.y1, z: s.z1, weapon: s.weapon, radius: r });
    } else {
      // The target died in the air: the round finds whoever is standing
      // where it was — in a tide, there always is someone.
      if (ti < 0) {
        let nd = 0.14;
        h.near(s.x1, s.z1, 0.14, (i, d) => {
          if (d < nd) {
            nd = d;
            ti = i;
          }
        });
      }
      if (ti >= 0) {
        hurt(ti, spec.damage, cause);
        fx({ kind: 'hit', x: s.x1, y: s.y1, z: s.z1, weapon: s.weapon });
      }
    }
  }
}

/** Damage one crawler; it dies at zero. */
function hurt(i: number, dmg: number, cause: number, flash = true): void {
  const h = plant.siege.horde;
  if (h.dead[i]) return;
  h.hp[i] -= dmg;
  if (flash) h.flash[i] = 0.12;
  if (h.hp[i] <= 0) die(i, cause);
}

/** It goes down: logged for the renderer, and it PAYS — a sliver of a
 *  gear each, and the big ones in whole parts. */
function die(i: number, cause: number): void {
  const sg = plant.siege;
  const h = sg.horde;
  if (h.dead[i]) return;
  h.kill(i, cause);
  sg.kills++;
  const spec = SPECS[h.kind[i]];
  sg.scrap += spec.scrap;
  let paid = false;
  while (sg.scrap >= 1) {
    sg.scrap -= 1;
    plant.bank.gear = (plant.bank.gear ?? 0) + 1;
    paid = true;
  }
  for (const [item, n] of Object.entries(spec.bounty) as Array<[ItemId, number]>) {
    plant.bank[item] = (plant.bank[item] ?? 0) + n;
    paid = true;
  }
  if (paid) plant.events.push({ kind: 'bank' });
}

/* ── tools ──────────────────────────────────────────────────────────────── */

/** TOOLS ONLY. Stand the siege down: no clock, no breaches, no crawlers,
 *  and the core lifted — the look tools that shoot the shop want TUBES'
 *  free floor, not a fight going on under the camera. */
export function standDown(): void {
  const sg = plant.siege;
  sg.phase = 'off';
  sg.streams = [];
  sg.horde.clear();
  sg.shots = [];
  sg.fires = [];
  sg.breaches = [];
  const core = dockUnit();
  if (core) removeUnit(core);
}

/** A breach's line colour — the crack glows in the colour of the deepest
 *  line awake, because the thing in the wall has been drinking it. */
export function breachHex(): number {
  if (plant.feedsAwake.right) return LINES.volt.glow;
  if (plant.feedsAwake.left) return LINES.coolant.glow;
  return 0xff4a26;
}

/** The core's health, 0..1 (1 with no core standing). */
export function coreHealth(): number {
  const c = dockUnit();
  return c ? Math.max(0, c.hp / c.maxHp) : 1;
}

let frozen = false;
/** TOOLS ONLY: hold the fight still (a portrait session). */
export function debugFreeze(on: boolean): void {
  frozen = on;
}
export function siegeFrozen(): boolean {
  return frozen;
}

/** TOOLS ONLY: stand a crawler anywhere, already walking. */
export function debugPlace(kind: EnemyId, x: number, z: number, heading = 0): void {
  const h = plant.siege.horde;
  const i = h.add(KIND_INDEX[kind], x, z, ENEMIES[kind].hp, heading, 0);
  if (i < 0) return;
  h.phase[i] = PHASE_WALK;
}

/** Headless: everything every wave switches on, on now — every feed
 *  awake, every machine and weapon in the catalogue. */
export function debugWakeAll(): void {
  applyWakes(WAVES.length - 1);
  plant.generation++;
}

/** Headless: a clean floor for a portrait — every crawler, round and
 *  fire gone, and the build clock held so no horn interrupts. */
export function debugClear(): void {
  const sg = plant.siege;
  sg.horde.clear();
  sg.streams = [];
  sg.shots.length = 0;
  sg.fires.length = 0;
  if (sg.phase === 'build') sg.buildT = 9999;
}

/** Headless: every crawler on the floor this many times as hard to
 *  kill — so a portrait can wait for the shot without the sitter dying. */
export function debugTough(mult: number): void {
  const h = plant.siege.horde;
  for (let i = 0; i < h.n; i++) {
    h.hp[i] *= mult;
    h.maxHp[i] *= mult;
  }
}

/** Headless: jump the ladder to wave `n` (its build phase, its wakes,
 *  its breaches) — so a tool can sound a real tide. */
export function debugJump(n: number): void {
  const sg = plant.siege;
  sg.horde.clear();
  sg.streams = [];
  sg.shots.length = 0;
  sg.fires.length = 0;
  applyWakes(n);
  beginBuild(n);
}

/** Headless: crack `n` breaches now (a flood wants more than one door). */
export function debugBreaches(n: number): void {
  plant.siege.breaches = pickBreaches(n, 0xb4ea + n);
  for (const b of plant.siege.breaches) fx({ kind: 'breach', x: b.x, y: 0, z: b.z });
  fieldDirty = true;
}

/** Headless: drop crawlers at a breach right now. */
export function debugSpawn(kind: EnemyId, breach = 0, count = 1): void {
  for (let k = 0; k < count; k++) spawn(kind, breach);
}

/** Headless: a whole tide at once, spread over every breach, already
 *  out of the wall — for portraits and frame-time checks. */
export function debugFlood(kind: EnemyId, count: number): void {
  const sg = plant.siege;
  const nb = Math.max(1, sg.breaches.length);
  const h = sg.horde;
  for (let k = 0; k < count; k++) {
    const b = k % nb;
    const i = spawn(kind, b);
    if (i < 0) break;
    const br = sg.breaches[b];
    if (!br) continue;
    const out = SIEGE.emergeDepth + 0.15 + Math.random() * 1.6;
    h.x[i] += br.nx * out + (Math.random() - 0.5) * 0.6;
    h.z[i] += br.nz * out + (Math.random() - 0.5) * 0.6;
    h.phase[i] = PHASE_WALK;
  }
}
