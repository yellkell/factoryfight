/**
 * THE SIEGE — the fight, pure of scene and speaker (sim.ts's discipline:
 * anything visible or audible that HAPPENS here leaves as a SiegeFx, and
 * SiegeSystem draws and voices it).
 *
 *   build  — the horn hasn't gone. The NEXT wave's breaches are already
 *            chosen and glowing on your real walls, so you know which
 *            side to wall; the clock runs down (or the horn is sounded
 *            early from the card).
 *   wave   — things climb out of the plaster and path for the CORE.
 *            Turrets fire what they are fed. When the last one is down,
 *            the ladder advances and the next build phase begins.
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
  AMMO,
  ENEMIES,
  FACTORY,
  LINES,
  SIEGE,
  WAVES,
  type EnemyId,
  type ItemId,
  type LineId,
  type WaveSpec,
} from '../config.js';
import { CELL, cellCenter, cellInFloor, worldToCell } from '../floor/grid.js';
import { floorLayout, type FloorSide } from '../floor/plan.js';
import { cycleFactor, rangeFactor } from '../game/progress.js';
import { mulberry32 } from '../game/rng.js';
import type { Wall } from '../room/walls.js';
import { PLANT_SCALE } from './frame.js';
import { dockUnit, placeUnit, removeUnit } from './sim.js';
import {
  plant,
  unitAtCell,
  unitById,
  type Breach,
  type Enemy,
  type SiegeFx,
  type Unit,
} from './state.js';

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
      gap: Math.max(0.25, sp.gap / Math.sqrt(grow)),
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
 * MAN THE WALLS. A siege opens on a bare floor with the CORE already
 * standing in the middle of it — the one piece of plant you never have
 * to find a place for — a starting stock in its bank, and the first
 * wave's breaches already cracking.
 */
export function startSiege(atWave = 0): void {
  const sg = plant.siege;
  plant.mode = 'shop';
  plant.orderIndex = -1;
  plant.goalsDone = false;
  plant.bank = { ...SIEGE.startBank };
  sg.phase = 'build';
  sg.wave = Math.max(0, atWave);
  sg.kills = 0;
  sg.won = sg.wave >= WAVES.length;
  applyWakes(sg.wave);
  standCore();
  beginBuild(sg.wave);
}

/** The core stands on the floor cell nearest the tape's middle. */
function standCore(): void {
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
  sg.queue = [];
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
  sg.queue = [];
  for (const sp of spec.spawns) {
    for (let k = 0; k < sp.count; k++) {
      sg.queue.push({ enemy: sp.enemy, at: sp.at + k * sp.gap, breach: sp.breach });
    }
  }
  sg.queue.sort((a, b) => a.at - b.at);
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

/** What it costs an enemy to make a cell its own: a step, plus chewing
 *  through whatever stands on it. */
function enterCost(i: number, j: number): number {
  const u = unitAtCell(i, j);
  if (!u || u.type === 'dock') return 1;
  return 1 + SIEGE.chewBase + u.hp * SIEGE.chewPerHp;
}

/** A diagonal step may not squeeze between two pieces of plant. */
function diagonalOpen(i: number, j: number, di: number, dj: number): boolean {
  return !unitAtCell(i + di, j) && !unitAtCell(i, j + dj);
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
  // The field covers the floor, every breach, and a margin round both.
  let i0 = core.i;
  let i1 = core.i;
  let j0 = core.j;
  let j1 = core.j;
  const grow = (x: number, z: number): void => {
    const c = worldToCell(x, z);
    i0 = Math.min(i0, c.i);
    i1 = Math.max(i1, c.i);
    j0 = Math.min(j0, c.j);
    j1 = Math.max(j1, c.j);
  };
  grow(floorLayout.left / PLANT_SCALE, floorLayout.far / PLANT_SCALE);
  grow(floorLayout.right / PLANT_SCALE, floorLayout.near / PLANT_SCALE);
  for (const b of plant.siege.breaches) grow(b.x, b.z);
  for (const e of plant.siege.enemies) grow(e.x, e.z);
  const pad = SIEGE.fieldPad;
  fI0 = i0 - pad;
  fJ0 = j0 - pad;
  fW = i1 - i0 + 1 + pad * 2;
  fH = j1 - j0 + 1 + pad * 2;
  const n = fW * fH;
  if (field.length < n) field = new Float32Array(n);
  field.fill(Infinity, 0, n);
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
  const start = (core.j - fJ0) * fW + (core.i - fI0);
  field[start] = 0;
  push(0, start);
  while (heap.length > 0) {
    const [cost, idx] = pop();
    if (cost > field[idx]) continue;
    const ci = (idx % fW) + fI0;
    const cj = Math.floor(idx / fW) + fJ0;
    for (const [di, dj, step] of NB) {
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < fI0 || nj < fJ0 || ni >= fI0 + fW || nj >= fJ0 + fH) continue;
      if (di !== 0 && dj !== 0 && !diagonalOpen(ci, cj, di, dj)) continue;
      // The field is walked BACKWARDS (from the core outward), so the
      // price paid is the one for the cell being left on the way in —
      // i.e. the cell we are standing in now.
      const nc = cost + step * enterCost(ci, cj);
      const nidx = (nj - fJ0) * fW + (ni - fI0);
      if (nc < field[nidx]) {
        field[nidx] = nc;
        push(nc, nidx);
      }
    }
  }
}

/** The field's distance-to-core at a cell (Infinity off the field). */
export function fieldAt(i: number, j: number): number {
  if (i < fI0 || j < fJ0 || i >= fI0 + fW || j >= fJ0 + fH) return Infinity;
  return field[(j - fJ0) * fW + (i - fI0)];
}

/* ── the tick ───────────────────────────────────────────────────────────── */

const _c = { x: 0, z: 0 };
const _n = { x: 0, z: 0 };

function fx(e: SiegeFx): void {
  const list = plant.siege.fx;
  if (list.length < 400) list.push(e);
}

export function siegeTick(dt: number): void {
  const sg = plant.siege;
  if (sg.phase === 'off' || sg.phase === 'fallen') return;

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
    while (sg.queue.length > 0 && sg.queue[0].at <= sg.waveT) {
      const q = sg.queue.shift()!;
      spawn(q.enemy, q.breach);
    }
  }

  tickEnemies(dt);
  if (plant.siege.phase === 'fallen') return;
  tickTurrets(dt);
  tickShots(dt);

  if (sg.phase === 'wave' && sg.queue.length === 0 && sg.enemies.length === 0) {
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

function spawn(kind: EnemyId, breachIdx: number): void {
  const sg = plant.siege;
  const b = sg.breaches[breachIdx % Math.max(1, sg.breaches.length)];
  if (!b) return;
  const spec = ENEMIES[kind];
  // A little spread along the crack, so a column is a crowd.
  const along = (Math.random() - 0.5) * Math.min(0.5, b.wall * 0.3);
  const tx = -b.nz;
  const tz = b.nx;
  sg.enemies.push({
    id: sg.nextEnemy++,
    kind,
    x: b.x + tx * along - b.nx * 0.08,
    z: b.z + tz * along - b.nz * 0.08,
    hp: spec.hp,
    maxHp: spec.hp,
    heading: Math.atan2(b.nx, b.nz),
    phase: 'emerge',
    phaseT: 0,
    breach: breachIdx,
    target: -1,
    biteT: 0,
    slowT: 0,
    slowF: 1,
    lane: (Math.random() - 0.5) * 0.12,
    flash: 0,
    stride: Math.random() * 10,
  });
}

/** Which neighbour cell an enemy at (i, j) should step to: the one the
 *  field says is nearest the core. Null when it is already beside it. */
function nextCell(i: number, j: number): { i: number; j: number } | null {
  let best: { i: number; j: number } | null = null;
  let bestD = fieldAt(i, j);
  for (const [di, dj, step] of NB) {
    if (di !== 0 && dj !== 0 && !diagonalOpen(i, j, di, dj)) continue;
    const d = fieldAt(i + di, j + dj) + (step - 1) * 0.01;
    if (d < bestD) {
      bestD = d;
      best = { i: i + di, j: j + dj };
    }
  }
  return best;
}

function tickEnemies(dt: number): void {
  const sg = plant.siege;
  const core = dockUnit();
  for (const e of [...sg.enemies]) {
    const spec = ENEMIES[e.kind];
    e.flash = Math.max(0, e.flash - dt);
    if (e.slowT > 0) {
      e.slowT -= dt;
      if (e.slowT <= 0) e.slowF = 1;
    }
    const pace = spec.speed * e.slowF;
    e.phaseT += dt;

    if (e.phase === 'emerge') {
      // Out of the plaster, along the wall's normal, for emergeDepth.
      const b = sg.breaches[e.breach % Math.max(1, sg.breaches.length)];
      const step = (pace * 0.7 * dt);
      if (b) {
        e.x += b.nx * step;
        e.z += b.nz * step;
        e.heading = Math.atan2(b.nx, b.nz);
      }
      e.stride += step;
      if (e.phaseT * pace * 0.7 >= SIEGE.emergeDepth + 0.08) {
        e.phase = 'walk';
        e.phaseT = 0;
      }
      continue;
    }

    if (!core) continue;
    const here = worldToCell(e.x, e.z);
    cellCenter(core.i, core.j, _c);
    const toCore = Math.hypot(_c.x - e.x, _c.z - e.z);
    const reach = CELL * 0.5 + spec.radius + 0.06;

    // At the core: bite it.
    if (toCore <= reach + CELL * 0.2) {
      bite(e, core, dt);
      continue;
    }

    // The field's next step. Off the field (or lost) — straight at it.
    let tx = _c.x;
    let tz = _c.z;
    let blocker: Unit | undefined;
    const nxt = fieldAt(here.i, here.j) < Infinity ? nextCell(here.i, here.j) : null;
    if (nxt) {
      cellCenter(nxt.i, nxt.j, _n);
      tx = _n.x;
      tz = _n.z;
      const standing = unitAtCell(nxt.i, nxt.j);
      if (standing && standing.type !== 'dock') blocker = standing;
    } else {
      // Standing IN a cell with plant on it (spawned over a wall?) —
      // chew out of it.
      const own = unitAtCell(here.i, here.j);
      if (own && own.type !== 'dock') blocker = own;
    }

    if (blocker) {
      cellCenter(blocker.i, blocker.j, _n);
      const d = Math.hypot(_n.x - e.x, _n.z - e.z);
      if (d <= reach) {
        bite(e, blocker, dt);
        continue;
      }
    }

    e.phase = 'walk';
    e.target = -1;
    // A per-enemy lane, perpendicular to travel, so a column spreads.
    let dx = tx - e.x;
    let dz = tz - e.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const ox = tx + -dz * e.lane;
    const oz = tz + dx * e.lane;
    dx = ox - e.x;
    dz = oz - e.z;
    const l2 = Math.hypot(dx, dz) || 1;
    const step = Math.min(l2, pace * dt);
    e.x += (dx / l2) * step;
    e.z += (dz / l2) * step;
    e.stride += step;
    turnToward(e, Math.atan2(dx, dz), dt);
  }
}

function turnToward(e: Enemy, want: number, dt: number): void {
  const d = Math.atan2(Math.sin(want - e.heading), Math.cos(want - e.heading));
  e.heading += d * Math.min(1, dt * 8);
}

/** One enemy chewing one piece of plant (the core included). */
function bite(e: Enemy, u: Unit, dt: number): void {
  const spec = ENEMIES[e.kind];
  cellCenter(u.i, u.j, _n);
  turnToward(e, Math.atan2(_n.x - e.x, _n.z - e.z), dt);
  if (e.phase !== 'bite' || e.target !== u.id) {
    e.phase = 'bite';
    e.target = u.id;
    e.biteT = spec.biteS * 0.5;
  }
  // THE SAPPER goes off on contact.
  if (spec.blast) {
    blast(e.x, e.z, spec.blast.damage, spec.blast.radius);
    killEnemy(e, false);
    return;
  }
  e.biteT -= dt;
  if (e.biteT > 0) return;
  e.biteT = spec.biteS;
  hurtUnit(u, spec.bite);
  fx({ kind: u.type === 'dock' ? 'core-hit' : 'bite', x: _n.x, y: 0, z: _n.z, unit: u.id, enemy: e.kind });
}

/** A sapper's charge: every piece of plant inside the radius takes it. */
function blast(x: number, z: number, damage: number, radius: number): void {
  fx({ kind: 'blast', x, y: 0.1, z, radius });
  for (const u of [...plant.units]) {
    cellCenter(u.i, u.j, _n);
    const d = Math.hypot(_n.x - x, _n.z - z);
    if (d > radius + CELL * 0.5) continue;
    hurtUnit(u, damage * (d < CELL ? 1 : 0.6));
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
}

function fall(): void {
  const sg = plant.siege;
  sg.phase = 'fallen';
  const core = dockUnit();
  if (core) cellCenter(core.i, core.j, _c);
  fx({ kind: 'fallen', x: _c.x, y: 0, z: _c.z });
}

/* ── THE GUNS ───────────────────────────────────────────────────────────── */

const SHOT_Y = 0.12; // where a shot lands on a body (plant m up)

function turretRange(item: ItemId | null): number {
  const reach = item ? AMMO[item].reach : 1;
  return SIEGE.turret.range * reach * rangeFactor();
}

/** The enemy a gun at (x, z) should shoot: the one in range nearest the
 *  core along the FIELD (not as the crow flies — the one about to arrive
 *  is the one that matters). */
function pickTarget(x: number, z: number, range: number): Enemy | null {
  let best: Enemy | null = null;
  let bestD = Infinity;
  for (const e of plant.siege.enemies) {
    const d = Math.hypot(e.x - x, e.z - z);
    if (d > range) continue;
    const c = worldToCell(e.x, e.z);
    let f = fieldAt(c.i, c.j);
    if (!Number.isFinite(f)) f = 1e4 + d;
    if (f < bestD) {
      bestD = f;
      best = e;
    }
  }
  return best;
}

function tickTurrets(dt: number): void {
  for (const u of plant.units) {
    if (u.type !== 'turret') continue;
    u.cool = Math.max(0, (u.cool ?? 0) - dt);
    // Chamber the next part when the last is spent.
    if (!u.rounds && u.ammo && u.ammo.length > 0) {
      u.loaded = u.ammo.shift()!;
      u.rounds = AMMO[u.loaded].rounds;
    }
    if (!u.rounds || !u.loaded) continue;
    cellCenter(u.i, u.j, _c);
    const spec = AMMO[u.loaded];
    const target = pickTarget(_c.x, _c.z, turretRange(u.loaded));
    if (!target) continue;
    const want = Math.atan2(target.x - _c.x, target.z - _c.z);
    const yaw = u.yaw ?? 0;
    const d = Math.atan2(Math.sin(want - yaw), Math.cos(want - yaw));
    const turn = SIEGE.turret.slew * dt;
    u.yaw = yaw + Math.max(-turn, Math.min(turn, d));
    if (Math.abs(d) > 0.3 || u.cool > 0) continue;
    // FIRE.
    u.cool = spec.cycleS * cycleFactor();
    u.rounds--;
    const item = u.loaded;
    if (!u.rounds) u.loaded = null;
    const mx = _c.x + Math.sin(u.yaw) * 0.16;
    const mz = _c.z + Math.cos(u.yaw) * 0.16;
    const my = SIEGE.turret.muzzleY;
    fx({ kind: 'fire', x: mx, y: my, z: mz, ammo: item, unit: u.id });
    fire(item, mx, my, mz, target, u.loaded === null ? 0 : u.rounds);
  }
}

function fire(item: ItemId, x: number, y: number, z: number, target: Enemy, _left: number): void {
  void _left;
  const spec = AMMO[item];
  const sg = plant.siege;
  if (spec.kind === 'arc') {
    // ARC: no flight — it bites now and jumps.
    const hit = new Set<number>();
    const path: number[] = [x, y, z];
    let cur: Enemy | null = target;
    let dmg = spec.damage;
    for (let hop = 0; cur && hop <= (spec.chain ?? 0); hop++) {
      hit.add(cur.id);
      path.push(cur.x, SHOT_Y, cur.z);
      damageEnemy(cur, dmg, item);
      dmg *= 0.85;
      let next: Enemy | null = null;
      let nd = spec.chainReach ?? 0.6;
      for (const e of sg.enemies) {
        if (hit.has(e.id)) continue;
        const d = Math.hypot(e.x - cur.x, e.z - cur.z);
        if (d < nd) {
          nd = d;
          next = e;
        }
      }
      cur = next;
    }
    fx({ kind: 'arc', x, y, z, ammo: item, path });
    return;
  }
  if (spec.kind === 'beam') {
    // BEAM: a lance to the end of the range, through everything on it.
    const dx = target.x - x;
    const dz = target.z - z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    const reach = turretRange(item) + 0.3;
    const ex = x + ux * reach;
    const ez = z + uz * reach;
    for (const e of [...sg.enemies]) {
      const t = (e.x - x) * ux + (e.z - z) * uz;
      if (t < 0 || t > reach) continue;
      const off = Math.abs((e.x - x) * uz - (e.z - z) * ux);
      if (off <= spec.splash + ENEMIES[e.kind].radius) damageEnemy(e, spec.damage, item);
    }
    fx({ kind: 'beam', x, y, z, ammo: item, path: [x, y, z, ex, SHOT_Y, ez] });
    return;
  }
  const d = Math.hypot(target.x - x, target.z - z);
  sg.shots.push({
    id: sg.nextShot++,
    ammo: item,
    x0: x,
    y0: y,
    z0: z,
    x1: target.x,
    y1: SHOT_Y,
    z1: target.z,
    target: target.id,
    t: 0,
    dur: Math.max(0.05, d / spec.speed),
  });
}

function tickShots(dt: number): void {
  const sg = plant.siege;
  for (const s of [...sg.shots]) {
    s.t += dt;
    // Shells home on a live target (a lob that misses a walking grub is
    // a lob nobody believes); a dead one's spot is still a spot.
    const tgt = sg.enemies.find((e) => e.id === s.target);
    if (tgt) {
      s.x1 = tgt.x;
      s.z1 = tgt.z;
    }
    if (s.t < s.dur) continue;
    sg.shots.splice(sg.shots.indexOf(s), 1);
    const spec = AMMO[s.ammo];
    if (spec.splash > 0) {
      for (const e of [...sg.enemies]) {
        const d = Math.hypot(e.x - s.x1, e.z - s.z1);
        if (d > spec.splash + ENEMIES[e.kind].radius) continue;
        damageEnemy(e, spec.damage * (d < spec.splash * 0.5 ? 1 : 0.6), s.ammo);
        if (spec.slow) {
          e.slowF = Math.min(e.slowF, spec.slow);
          e.slowT = Math.max(e.slowT, spec.slowS ?? 2);
        }
      }
      fx({
        kind: spec.kind === 'frost' ? 'frost' : 'blast',
        x: s.x1,
        y: s.y1,
        z: s.z1,
        ammo: s.ammo,
        radius: spec.splash,
      });
    } else if (tgt) {
      damageEnemy(tgt, spec.damage, s.ammo);
      fx({ kind: 'hit', x: s.x1, y: s.y1, z: s.z1, ammo: s.ammo });
    }
  }
}

function damageEnemy(e: Enemy, dmg: number, item: ItemId): void {
  if (!plant.siege.enemies.includes(e)) return;
  e.hp -= dmg;
  e.flash = 0.12;
  void item;
  if (e.hp <= 0) killEnemy(e, true);
}

function killEnemy(e: Enemy, pays: boolean): void {
  const sg = plant.siege;
  const at = sg.enemies.indexOf(e);
  if (at < 0) return;
  sg.enemies.splice(at, 1);
  if (pays) {
    sg.kills++;
    for (const [item, n] of Object.entries(ENEMIES[e.kind].bounty) as Array<[ItemId, number]>) {
      plant.bank[item] = (plant.bank[item] ?? 0) + n;
    }
    fx({ kind: 'kill', x: e.x, y: 0.08, z: e.z, enemy: e.kind });
  }
}

/* ── tools ──────────────────────────────────────────────────────────────── */

/** TOOLS ONLY. Stand the siege down: no clock, no breaches, no crawlers,
 *  and the core lifted — the look tools that shoot the shop want TUBES'
 *  free floor, not a fight going on under the camera. */
export function standDown(): void {
  const sg = plant.siege;
  sg.phase = 'off';
  sg.queue = [];
  sg.enemies = [];
  sg.shots = [];
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

/** Headless: drop an enemy at a breach right now. */
export function debugSpawn(kind: EnemyId, breach = 0): void {
  spawn(kind, breach);
}
