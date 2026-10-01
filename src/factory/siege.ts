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
  ENEMIES,
  FACTORY,
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
import { CELL, cellCenter, cellInFloor, worldToCell } from '../floor/grid.js';
import { floorLayout, type FloorSide } from '../floor/plan.js';
import { cycleFactor, rangeFactor } from '../game/progress.js';
import { mulberry32 } from '../game/rng.js';
import type { Wall } from '../room/walls.js';
import { PLANT_SCALE } from './frame.js';
import { dockUnit, isWeapon, placeUnit, removeUnit } from './sim.js';
import {
  plant,
  runSeatedAt,
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
    while (sg.queue.length > 0 && sg.queue[0].at <= sg.waveT) {
      const q = sg.queue.shift()!;
      spawn(q.enemy, q.breach);
    }
  }

  tickEnemies(dt);
  if (plant.siege.phase === 'fallen') return;
  tickWeapons(dt);
  tickShots(dt);
  tickFires(dt);

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
    kvx: 0,
    kvz: 0,
    kT: 0,
    stunT: 0,
    burnT: 0,
    burnDps: 0,
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

    // ON FIRE: it burns where it stands, and it still comes.
    if (e.burnT > 0) {
      e.burnT -= dt;
      damageEnemy(e, e.burnDps * dt, 'flamer', false);
      if (!sg.enemies.includes(e)) continue;
    }
    // PUNCHED: thrown back, then reeling.
    if (e.kT > 0) {
      e.kT -= dt;
      e.x += e.kvx * dt;
      e.z += e.kvz * dt;
      continue;
    }
    if (e.stunT > 0) {
      e.stunT -= dt;
      continue;
    }

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

/* ── THE ARSENAL ────────────────────────────────────────────────────────── */

const SHOT_Y = 0.12; // where a shot lands on a body (plant m up)

function rangeOf(w: WeaponId): number {
  return WEAPONS[w].range * rangeFactor();
}

/** The enemy a weapon at (x, z) should engage: in range (and outside any
 *  blind spot), nearest the core along the FIELD — the one about to
 *  arrive is the one that matters. */
function pickTarget(x: number, z: number, range: number, minRange = 0): Enemy | null {
  let best: Enemy | null = null;
  let bestD = Infinity;
  for (const e of plant.siege.enemies) {
    if (e.phase === 'emerge' && e.phaseT < 0.3) continue;
    const d = Math.hypot(e.x - x, e.z - z);
    if (d > range || d < minRange) continue;
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
  for (const u of plant.units) {
    if (!isWeapon(u.type)) continue;
    const w = u.type as WeaponId;
    const spec = WEAPONS[w];
    u.cool = Math.max(0, (u.cool ?? 0) - dt);
    u.firedT = (u.firedT ?? 99) + dt;
    if (!fuelled(u)) continue;
    cellCenter(u.i, u.j, _c);
    const target = pickTarget(_c.x, _c.z, rangeOf(w), spec.minRange ?? 0);
    if (!target) continue;
    const want = Math.atan2(target.x - _c.x, target.z - _c.z);
    const aimed = slew(u, want, dt, w === 'flamer' ? 0.5 : 0.3);
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
    fx({ kind: 'fire', x: mx, y: my, z: mz, weapon: w, unit: u.id, yaw });
    if (w === 'tesla') arc(target, mx, my, mz);
    else if (w === 'piston') punch(u, target, yaw);
    else shoot(w, mx, my, mz, target);
  }
}

/** A round in flight (turret slugs, mortar shells). */
function shoot(w: WeaponId, x: number, y: number, z: number, target: Enemy): void {
  const spec = WEAPONS[w];
  const sg = plant.siege;
  const d = Math.hypot(target.x - x, target.z - z);
  // A shell leads its target: it lands where the crawler WILL be.
  const lead = w === 'mortar' ? d / (spec.speed ?? 3) : 0;
  const hd = target.heading;
  const pace = ENEMIES[target.kind].speed * target.slowF;
  sg.shots.push({
    id: sg.nextShot++,
    weapon: w,
    x0: x,
    y0: y,
    z0: z,
    x1: target.x + Math.sin(hd) * pace * lead,
    y1: SHOT_Y,
    z1: target.z + Math.cos(hd) * pace * lead,
    target: w === 'mortar' ? -1 : target.id,
    t: 0,
    dur: Math.max(0.05, d / (spec.speed ?? 10)) * (w === 'mortar' ? 1.6 : 1),
  });
}

/** TESLA: bites one, jumps to the next nearest, and on. */
function arc(target: Enemy, x: number, y: number, z: number): void {
  const spec = WEAPONS.tesla;
  const hit = new Set<number>();
  const path: number[] = [x, y, z];
  let cur: Enemy | null = target;
  let dmg = spec.damage;
  for (let hop = 0; cur && hop <= (spec.chain ?? 0); hop++) {
    hit.add(cur.id);
    path.push(cur.x, SHOT_Y + 0.05, cur.z);
    const was: Enemy = cur;
    damageEnemy(was, dmg, 'tesla');
    was.stunT = Math.max(was.stunT, 0.15);
    dmg *= 0.85;
    let next: Enemy | null = null;
    let nd = spec.chainReach ?? 0.6;
    for (const e of plant.siege.enemies) {
      if (hit.has(e.id)) continue;
      const d = Math.hypot(e.x - was.x, e.z - was.z);
      if (d < nd) {
        nd = d;
        next = e;
      }
    }
    cur = next;
  }
  fx({ kind: 'arc', x, y, z, weapon: 'tesla', path });
}

/** PISTON: the ram drives out and throws it back the way it came. */
function punch(u: Unit, target: Enemy, yaw: number): void {
  const spec = WEAPONS.piston;
  cellCenter(u.i, u.j, _c);
  damageEnemy(target, spec.damage, 'piston');
  if (!plant.siege.enemies.includes(target)) return;
  // Brutes are heavy: a third of the throw.
  const mass = target.kind === 'brute' ? 0.35 : target.kind === 'grub' ? 0.7 : 1;
  const dist = (spec.knock ?? 0.8) * mass;
  const kt = 0.22;
  target.kvx = (Math.sin(yaw) * dist) / kt;
  target.kvz = (Math.cos(yaw) * dist) / kt;
  target.kT = kt;
  target.stunT = (spec.stunS ?? 0.5) * mass;
  target.phase = 'walk';
  target.target = -1;
  fx({ kind: 'punch', x: target.x, y: 0.2, z: target.z, weapon: 'piston', unit: u.id, yaw });
}

/** FLAMER: one tick of the cone — everything inside it scorches and
 *  catches, and now and then the floor where it lands goes up too. */
function flame(u: Unit, x: number, y: number, z: number, yaw: number): void {
  const spec = WEAPONS.flamer;
  const reach = rangeOf('flamer');
  const cone = spec.cone ?? 0.5;
  let hits = 0;
  for (const e of [...plant.siege.enemies]) {
    const dx = e.x - x;
    const dz = e.z - z;
    const d = Math.hypot(dx, dz);
    if (d > reach + ENEMIES[e.kind].radius) continue;
    const off = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - yaw), Math.cos(Math.atan2(dx, dz) - yaw)));
    if (off > cone && d > 0.15) continue;
    hits++;
    e.burnT = Math.max(e.burnT, spec.burn?.s ?? 2);
    e.burnDps = Math.max(e.burnDps, spec.burn?.dps ?? 5);
    damageEnemy(e, spec.damage, 'flamer');
  }
  fx({ kind: 'flame', x, y, z, weapon: 'flamer', unit: u.id, yaw, reach });
  // Every so often the flame sets the floor alight where it lands.
  if (hits > 0 && Math.random() < 0.18) {
    const fl = plant.siege.fires;
    if (fl.length < 24) {
      const d = reach * (0.55 + Math.random() * 0.4);
      fl.push({ x: x + Math.sin(yaw) * d, z: z + Math.cos(yaw) * d, r: 0.22, t: 0, life: 3 });
    }
  }
}

/** Burning floor: anything standing in it catches. */
function tickFires(dt: number): void {
  const sg = plant.siege;
  for (const f of [...sg.fires]) {
    f.t += dt;
    if (f.t >= f.life) {
      sg.fires.splice(sg.fires.indexOf(f), 1);
      continue;
    }
    for (const e of sg.enemies) {
      if (Math.hypot(e.x - f.x, e.z - f.z) > f.r + ENEMIES[e.kind].radius) continue;
      e.burnT = Math.max(e.burnT, 1.2);
      e.burnDps = Math.max(e.burnDps, 6);
    }
  }
}

function tickShots(dt: number): void {
  const sg = plant.siege;
  for (const s of [...sg.shots]) {
    s.t += dt;
    // Slugs home on a live target (a round that misses a walking skitter
    // is a round nobody believes); shells fall where they were aimed.
    const tgt = s.target >= 0 ? sg.enemies.find((e) => e.id === s.target) : undefined;
    if (tgt) {
      s.x1 = tgt.x;
      s.z1 = tgt.z;
    }
    if (s.t < s.dur) continue;
    sg.shots.splice(sg.shots.indexOf(s), 1);
    const spec = WEAPONS[s.weapon];
    if (spec.splash) {
      for (const e of [...sg.enemies]) {
        const d = Math.hypot(e.x - s.x1, e.z - s.z1);
        if (d > spec.splash + ENEMIES[e.kind].radius) continue;
        damageEnemy(e, spec.damage * (d < spec.splash * 0.5 ? 1 : 0.55), s.weapon);
      }
      fx({ kind: 'shell', x: s.x1, y: s.y1, z: s.z1, weapon: s.weapon, radius: spec.splash });
    } else if (tgt) {
      damageEnemy(tgt, spec.damage, s.weapon);
      fx({ kind: 'hit', x: s.x1, y: s.y1, z: s.z1, weapon: s.weapon });
    }
  }
}

function damageEnemy(e: Enemy, dmg: number, by: WeaponId, flash = true): void {
  if (!plant.siege.enemies.includes(e)) return;
  e.hp -= dmg;
  if (flash) e.flash = 0.12;
  void by;
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
  // A crawler is born at a breach; a portrait needs one even before the
  // wall has cracked, so stand one in for the moment of the spawn.
  const real = plant.siege.breaches;
  if (real.length === 0) plant.siege.breaches = [{ x, z, nx: 0, nz: 1, wall: 1 }];
  spawn(kind, 0);
  plant.siege.breaches = real;
  const e = plant.siege.enemies[plant.siege.enemies.length - 1];
  if (!e) return;
  e.x = x;
  e.z = z;
  e.heading = heading;
  e.phase = 'walk';
  e.phaseT = 0;
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
  sg.enemies.length = 0;
  sg.shots.length = 0;
  sg.fires.length = 0;
  if (sg.phase === 'build') sg.buildT = 9999;
}

/** Headless: every crawler on the floor this many times as hard to
 *  kill — so a portrait can wait for the shot without the sitter dying. */
export function debugTough(mult: number): void {
  for (const e of plant.siege.enemies) {
    e.hp *= mult;
    e.maxHp *= mult;
  }
}

/** Headless: drop an enemy at a breach right now. */
export function debugSpawn(kind: EnemyId, breach = 0): void {
  spawn(kind, breach);
}
