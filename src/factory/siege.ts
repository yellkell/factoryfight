/**
 * THE SIEGE — the fight, pure of scene and speaker (sim.ts's discipline:
 * anything visible or audible that HAPPENS here leaves as a SiegeFx, and
 * SiegeSystem draws and voices it).
 *
 * A horde, in your room:
 *
 *   core   — the floor waits for its CORE. Where it lands roots THE FIELD
 *            (factory/field.ts): from then on every spot of the room
 *            knows its way to the core.
 *   build  — the clock runs down (or START is pressed early). Towers
 *            go anywhere on the floor, right up against the core.
 *   wave   — they come out of EVERY wall: a tide climbing out of the
 *            plaster all round the room, and PACKS splitting the floor
 *            somewhere you didn't guess. The towers fire on their own.
 *            Whatever reaches the core takes a bite out of it and is
 *            gone; a tower that stands in the way gets chewed. Every
 *            kill drops coins; clearing the wave pays a bonus, and the
 *            next one opens.
 *   fallen — the core went.
 *
 * Every distance here is PLANT metres (factory/frame.ts).
 */

import {
  ENEMIES,
  HORDE_KINDS,
  SIEGE,
  WAVES,
  WEAPONS,
  type EnemyId,
  type WaveSpec,
  type WeaponId,
} from '../config.js';
import { CELL, cellCenter, cellInFloor, worldToCell } from '../floor/grid.js';
import { floorLayout } from '../floor/plan.js';
import type { Wall } from '../room/walls.js';
import { Field } from './field.js';
import { PLANT_SCALE } from './frame.js';
import { HORDE_CAP, PHASE_BITE, PHASE_EMERGE, PHASE_FLY, PHASE_HELD, PHASE_RETURN, PHASE_WALK } from './horde.js';
import { dockUnit, isWeapon, placeUnit, removeUnit } from './sim.js';
import { plant, unitAtCell, type Breach, type SiegeFx, type Unit } from './state.js';

/* ── the room, as the siege sees it ─────────────────────────────────────── */

/** The wall registry (bound by SiegeSystem — the sim never imports a
 *  system). The horde climbs out of these. */
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
    buildS: 45,
    spawns: last.spawns.map((sp) => ({
      ...sp,
      count: Math.max(1, Math.round(sp.count * grow)),
      gap: Math.max(0.015, sp.gap / Math.sqrt(grow)),
    })),
    wakes: {},
  };
}

/** Everything waves 0..n put in the catalogue — cumulative, so arriving
 *  at any wave (a tool's jump, a retry) is self-sufficient. */
function applyWakes(n: number): void {
  for (let w = 0; w <= n && w < WAVES.length; w++) {
    for (const u of WAVES[w].wakes.units ?? []) {
      if (!plant.unitsAvailable.includes(u)) plant.unitsAvailable.push(u);
    }
  }
  plant.generation++;
}

/**
 * MAN THE WALLS. A siege opens on a bare floor and asks for ONE thing:
 * the CORE. Where it stands roots the horde's way, so nothing else
 * is offered and no clock runs until it lands.
 */
export function startSiege(atWave = 0): void {
  const sg = plant.siege;
  plant.mode = 'shop';
  plant.orderIndex = -1;
  plant.goalsDone = false;
  plant.bank = {};
  plant.unitsAvailable = [];
  sg.phase = 'core';
  sg.wave = Math.max(0, atWave);
  sg.kills = 0;
  sg.coins = SIEGE.startCoins;
  sg.coinDust = 0;
  sg.horde.clear();
  sg.streams = [];
  sg.won = sg.wave >= WAVES.length;
  sg.breaches = [];
  rim = [];
  field.clear();
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
  if (rim.length === 0) buildRim();
  sg.phase = 'build';
  sg.wave = n;
  sg.buildT = spec.buildS;
  sg.waveT = 0;
  sg.streams = [];
  sg.breaches = [];
}

/** START THE WAVE — the build phase ends now (the START buttons, and the
 *  clock running out, both come through here). */
export function startWave(): void {
  const sg = plant.siege;
  if (sg.phase !== 'build') return;
  const spec = waveSpec(sg.wave);
  sg.phase = 'wave';
  sg.waveT = 0;
  sg.buildT = 0;
  sg.breaches = [];
  // Every PACK gets its own crack in the floor, as far round the room
  // from the others as it can. They gather now (a few seconds' warning)
  // and split wide when their pack starts to pour.
  sg.streams = spec.spawns.map((sp) => ({
    enemy: sp.enemy,
    left: sp.count,
    gap: sp.gap,
    next: sp.at,
    rift: sp.pack ? openRift() : -1,
  }));
  const core = dockUnit();
  if (core) {
    cellCenter(core.i, core.j, _c);
    fx({ kind: 'wave-start', x: _c.x, y: 0, z: _c.z });
  }
}

/* ── THE RIM ────────────────────────────────────────────────────────────── */

/** A stretch of wall foot they can climb out of: where it starts, its run
 *  along the floor (unit) and length, and its into-the-room normal. */
interface Seg {
  ax: number;
  az: number;
  tx: number;
  tz: number;
  len: number;
  nx: number;
  nz: number;
}
/** Every stretch of every real wall's foot, and their lengths summed. */
let rim: Seg[] = [];
let rimLen = 0;

/**
 * THE RIM: the foot of every real wall, a hand's width in from its ends.
 * No walls at all (a tool with no room): a ring round the core.
 */
function buildRim(): void {
  rim = [];
  rimLen = 0;
  for (const w of roomWalls) {
    if (w.kind !== 'wall' || w.halfW < 0.3) continue;
    const half = (w.halfW - 0.12) / PLANT_SCALE;
    const tl = Math.hypot(w.right.x, w.right.z) || 1;
    const nl = Math.hypot(w.normal.x, w.normal.z) || 1;
    const tx = w.right.x / tl;
    const tz = w.right.z / tl;
    rim.push({
      ax: w.center.x / PLANT_SCALE - tx * half,
      az: w.center.z / PLANT_SCALE - tz * half,
      tx,
      tz,
      len: half * 2,
      nx: w.normal.x / nl,
      nz: w.normal.z / nl,
    });
  }
  if (rim.length === 0) {
    const core = dockUnit();
    if (!core) return;
    cellCenter(core.i, core.j, _c);
    const R = 3;
    const N = 24;
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * Math.PI * 2;
      const a1 = ((k + 1) / N) * Math.PI * 2;
      const ax = _c.x + Math.sin(a0) * R;
      const az = _c.z + Math.cos(a0) * R;
      const bx = _c.x + Math.sin(a1) * R;
      const bz = _c.z + Math.cos(a1) * R;
      const len = Math.hypot(bx - ax, bz - az);
      const am = (a0 + a1) / 2;
      rim.push({ ax, az, tx: (bx - ax) / len, tz: (bz - az) / len, len, nx: -Math.sin(am), nz: -Math.cos(am) });
    }
  }
  for (const sg of rim) rimLen += sg.len;
}

/** A spot on the rim, anywhere, by length — but not right by the core.
 *  Written into _s (x, z, nx, nz) with the stretch it is on and how far
 *  along it. */
const _s = { x: 0, z: 0, nx: 0, nz: 1, seg: -1, u: 0 };
function rimSpot(): boolean {
  if (rim.length === 0) return false;
  const core = dockUnit();
  if (core) cellCenter(core.i, core.j, _c);
  for (let tries = 0; tries < 12; tries++) {
    let r = Math.random() * rimLen;
    let k = 0;
    while (k < rim.length - 1 && r > rim[k].len) r -= rim[k++].len;
    const g = rim[k];
    const u = Math.min(g.len, r);
    _s.x = g.ax + g.tx * u;
    _s.z = g.az + g.tz * u;
    _s.nx = g.nx;
    _s.nz = g.nz;
    _s.seg = k;
    _s.u = u;
    if (!core || Math.hypot(_s.x - _c.x, _s.z - _c.z) >= SIEGE.spawnClear) return true;
  }
  return true;
}

/** A RIFT for a pack: a crack split open in the FLOOR, out in the room
 *  between a wall and the core. Of a handful of candidates, the one
 *  furthest round the core from the rifts already open, and never on
 *  or against a tower. Returns its index (−1: nowhere would do). */
function openRift(): number {
  const sg = plant.siege;
  const core = dockUnit();
  if (!core || rim.length === 0) return -1;
  cellCenter(core.i, core.j, _c);
  const half = SIEGE.packSpread / 2;
  const clear = Math.max(SIEGE.spawnClear, 1.5);
  let best: Breach | null = null;
  let bestScore = -Infinity;
  for (let k = 0; k < 12; k++) {
    if (!rimSpot()) break;
    // Somewhere on the way in from that stretch of wall.
    const d = Math.hypot(_s.x - _c.x, _s.z - _c.z);
    if (d < clear + 0.2) continue;
    const room = Math.min(0.4, 1 - (clear + 0.1) / d - 0.15);
    if (room < 0.05) continue;
    const t = 0.15 + Math.random() * room;
    const x = _s.x + (_c.x - _s.x) * t;
    const z = _s.z + (_c.z - _s.z) * t;
    const a = Math.random() * Math.PI;
    const tx = Math.cos(a);
    const tz = Math.sin(a);
    // Not through a tower, nor against one.
    let blocked = false;
    for (const u of [-1, -0.5, 0, 0.5, 1]) {
      const f = field.at(x + tx * half * u, z + tz * half * u);
      if (f >= 0 && field.nearTower[f]) blocked = true;
    }
    if (blocked) continue;
    const ang = Math.atan2(x - _c.x, z - _c.z);
    let sep = Math.PI;
    for (const o of sg.breaches) {
      const oa = Math.atan2(o.x - _c.x, o.z - _c.z);
      sep = Math.min(sep, Math.abs(Math.atan2(Math.sin(ang - oa), Math.cos(ang - oa))));
    }
    const score = sep + Math.random() * 0.3;
    if (score > bestScore) {
      bestScore = score;
      best = { x, z, tx, tz, half, state: 'gathering' };
    }
  }
  if (!best) return -1;
  sg.breaches.push(best);
  return sg.breaches.length - 1;
}

/* ── THE FIELD ──────────────────────────────────────────────────────────── */

/** The room's way to the core (rebuilt whenever the plant changes). */
export const field = new Field();
let fieldGen = -1;
let fieldCore = -1;

/** Keep the field true to what stands: re-laid when anything is built,
 *  sold, upgraded or chewed to scrap (each bumps plant.generation). */
function ensureField(): void {
  const core = dockUnit();
  if (!core) {
    if (field.live) field.clear();
    fieldCore = -1;
    return;
  }
  if (field.live && fieldGen === plant.generation && fieldCore === core.id) return;
  fieldGen = plant.generation;
  fieldCore = core.id;
  // It covers the floor and the whole rim.
  let x0 = floorLayout.left / PLANT_SCALE;
  let x1 = floorLayout.right / PLANT_SCALE;
  let z0 = floorLayout.far / PLANT_SCALE;
  let z1 = floorLayout.near / PLANT_SCALE;
  for (const g of rim) {
    for (const u of [0, g.len]) {
      const x = g.ax + g.tx * u;
      const z = g.az + g.tz * u;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
  }
  field.build(core, plant.units, x0, z0, x1, z1);
}

/* ── the tick ───────────────────────────────────────────────────────────── */

const _c = { x: 0, z: 0 };
const _w = { x: 0, z: 0 };
const _p = { x: 0, z: 0 };

/** Specs by horde kind index, and each kind's radius. */
const SPECS = HORDE_KINDS.map((k) => ENEMIES[k]);
const RADII = new Float32Array(SPECS.map((sp) => sp.radius));
const MAX_R = Math.max(...SPECS.map((sp) => sp.radius));
const KIND_INDEX: Record<EnemyId, number> = Object.fromEntries(HORDE_KINDS.map((k, i) => [k, i])) as Record<
  EnemyId,
  number
>;

/** Weapons by index — what killed a crawler, in the horde's death log. */
export const WEAPON_ORDER: WeaponId[] = ['turret', 'mortar', 'tesla', 'flamer', 'hammer'];
const W: Record<WeaponId, number> = { turret: 0, mortar: 1, tesla: 2, flamer: 3, hammer: 4 };
/** The death log's cause for one that reached the core. */
export const LEAK = 9;
/** Cause of death: thrown (it hit the floor, or was hit by one that did). */
export const THROWN = 8;

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

/** The longest step the fight takes at once (s). A long frame (a hitch,
 *  or time sped up) is cut into steps no longer than this — or a gun
 *  that fires once a step would fire a quarter as often, and a crawler
 *  would stride through a tower's corner. */
const MAX_STEP = 1 / 30;
/** …but no more than this many a frame (times the time-scale, so a sped-
 *  up tool still steps finely): on a headset that is already behind,
 *  more steps make the next frame later still. */
const MAX_STEPS = 3;

export function siegeTick(dt: number): void {
  const t0 = performance.now();
  const n = Math.min(MAX_STEPS * Math.max(1, Math.ceil(plant.timeScale)), Math.ceil(dt / MAX_STEP - 1e-6));
  for (let k = 0; k < n; k++) tickSiege(dt / n);
  simAvg = simAvg * 0.9 + (performance.now() - t0) * 0.1;
}

function tickSiege(dt: number): void {
  const sg = plant.siege;
  if (frozen || sg.phase === 'off' || sg.phase === 'fallen') return;
  // The core just landed: the field is rooted and the siege begins.
  if (sg.phase === 'core') {
    if (dockUnit()) beginBuild(sg.wave);
    return;
  }
  ensureField();

  if (sg.phase === 'build') {
    sg.buildT -= dt;
    if (sg.buildT <= 0) startWave();
  } else if (sg.phase === 'wave') {
    sg.waveT += dt;
    // THE STREAMS pour, as fast as their gap — and hold while the floor
    // is at the horde's cap, so a flood can't outrun the arrays.
    for (const st of sg.streams) {
      const rift = st.rift >= 0 ? sg.breaches[st.rift] : undefined;
      if (rift && rift.state === 'gathering' && st.next <= sg.waveT) {
        rift.state = 'pouring';
        fx({ kind: 'breach', x: rift.x, y: 0, z: rift.z, radius: rift.half });
      }
      while (st.left > 0 && st.next <= sg.waveT && sg.horde.n < HORDE_CAP) {
        spawn(st.enemy, st.rift);
        st.left--;
        st.next += st.gap;
      }
      if (rift && st.left <= 0) rift.state = 'spent';
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

/** The wave is down: pay the bonus, patch the towers up, open the next. */
function waveCleared(): void {
  const sg = plant.siege;
  const core = dockUnit();
  if (core) cellCenter(core.i, core.j, _c);
  const bonus = SIEGE.waveBonus + SIEGE.bonusPerWave * (sg.wave + 1);
  sg.coins += bonus;
  for (const u of plant.units) if (u.type !== 'dock') u.hp = u.maxHp;
  const next = sg.wave + 1;
  if (next === WAVES.length && !sg.won) {
    sg.won = true;
    fx({ kind: 'victory', x: _c.x, y: 0, z: _c.z, radius: bonus });
  } else {
    fx({ kind: 'clear', x: _c.x, y: 0, z: _c.z, radius: bonus });
  }
  applyWakes(next);
  beginBuild(next);
}

/** One crawler out: up out of a pack's crack in the floor, or (rift −1)
 *  anywhere along any wall. */
function spawn(kind: EnemyId, rift: number): number {
  const sg = plant.siege;
  const r = rift >= 0 ? sg.breaches[rift] : undefined;
  const h = sg.horde;
  const w = sg.wave;
  const hp = ENEMIES[kind].hp * (1 + SIEGE.hpPerWave * w + SIEGE.hpPerWave2 * w * w);
  if (r) {
    // UP OUT OF THE CRACK: somewhere along it, below the floor, and it
    // climbs out over one lip or the other.
    const u = (Math.random() * 2 - 1) * r.half * 0.85;
    const side = Math.random() < 0.5 ? -1 : 1;
    const px = -r.tz * side;
    const pz = r.tx * side;
    const x = r.x + r.tx * u + px * 0.01;
    const z = r.z + r.tz * u + pz * 0.01;
    const i = h.add(KIND_INDEX[kind], x, z, hp, Math.atan2(px, pz));
    if (i < 0) return -1;
    h.vx[i] = px * 0.5;
    h.vz[i] = pz * 0.5;
    h.y[i] = -RADII[KIND_INDEX[kind]] * 1.3;
    h.fd[i] = field.distAt(x, z);
    return i;
  }
  if (!rimSpot()) return -1;
  // A little inside the plaster, so it climbs out rather than pops.
  const i = h.add(KIND_INDEX[kind], _s.x - _s.nx * 0.05, _s.z - _s.nz * 0.05, hp, Math.atan2(_s.nx, _s.nz));
  if (i < 0) return -1;
  h.vx[i] = _s.nx;
  h.vz[i] = _s.nz;
  h.fd[i] = field.distAt(h.x[i], h.z[i]);
  return i;
}

/** Is there a tower in the way at field index k (and not where the
 *  crawler already stands)? The tower, or undefined. */
function blocker(k: number, here: number): Unit | undefined {
  if (k < 0 || k === here) return undefined;
  const u = field.tower[k];
  return u && u.hp > 0 ? u : undefined;
}

/** Ticks run (a crawler re-reads its way every other one). */
let tickNo = 0;

/** Every crawler, one step: burn, reel, climb out, follow the way, chew
 *  what stands in it, and — at the core — hit it and be gone.
 *
 *  This is the hottest loop in the game (every crawler, every frame), so
 *  the columns are held in locals and the way is re-read every other
 *  tick (it is kept in vx/vz between: the field changes slowly under a
 *  crawler's feet, and a heading eases anyway). */
function tickHorde(dt: number): void {
  const sg = plant.siege;
  const h = sg.horde;
  const core = dockUnit();
  if (core) cellCenter(core.i, core.j, _c);
  const cx = _c.x;
  const cz = _c.z;
  const live = field.live;
  const veer = SIEGE.veer;
  const ease = Math.min(1, dt * 16);
  // The core's reach: its cell, and a little past it, so one that comes
  // in at a corner between two towers still gets there.
  const reach = CELL * 0.72;
  const parity = tickNo++ & 1;
  const { x: X, z: Z, phase: PH, phaseT: PT, kind: KD, dead: DEAD, vx: VX, vz: VZ } = h;
  const { heading: HD, stride: SD, pace: PC, fd: FD, stunT: ST, kT: KT, burnT: BT, flash: FL } = h;
  const dist = field.dist;
  const steps = field.step;
  const nearTower = field.nearTower;

  // THE CROWD: who stands where, this tick.
  if (live) {
    field.crowdReset();
    for (let i = 0; i < h.n; i++) {
      const ph = PH[i];
      if (DEAD[i] || ph === PHASE_HELD || ph === PHASE_FLY) continue;
      field.crowdAdd(X[i], Z[i], RADII[KD[i]]);
    }
  }

  for (let i = 0; i < h.n; i++) {
    if (DEAD[i]) continue;
    const spec = SPECS[KD[i]];
    if (FL[i] > 0) FL[i] -= dt;
    PT[i] += dt;

    // ON FIRE: it burns as it walks.
    if (BT[i] > 0) {
      BT[i] -= dt;
      h.hp[i] -= h.burnDps[i] * dt;
      if (h.hp[i] <= 0) {
        die(i, W.flamer);
        continue;
      }
    }
    const ph = PH[i];
    if (ph === PHASE_HELD) continue;
    if (ph === PHASE_FLY) {
      fly(i, dt);
      continue;
    }
    if (ph === PHASE_EMERGE) {
      // Climbing out: straight off the wall, or up out of a crack in the
      // floor (it starts below it, and rises as it comes).
      const step = spec.speed * 0.5 * dt;
      X[i] += VX[i] * step;
      Z[i] += VZ[i] * step;
      SD[i] += step;
      if (h.y[i] < 0) h.y[i] = Math.min(0, h.y[i] + ((RADII[KD[i]] * 1.3) / SIEGE.emergeS) * dt);
      if (PT[i] >= SIEGE.emergeS) {
        PH[i] = PHASE_WALK;
        VX[i] = 0; // (out: now it reads the way)
        VZ[i] = 0;
        h.y[i] = 0;
      }
      continue;
    }
    if (ST[i] > 0) {
      ST[i] -= dt;
      // THROWN back by a blast: it slides while it reels.
      if (KT[i] > 0) {
        KT[i] -= dt;
        const nx = X[i] + h.kvx[i] * dt;
        const nz = Z[i] + h.kvz[i] * dt;
        if (!live || !blocker(field.at(nx, nz), field.at(X[i], Z[i]))) {
          X[i] = nx;
          Z[i] = nz;
        }
      }
      continue;
    }
    // Landed and over the daze: back on its way.
    if (ph === PHASE_RETURN) PH[i] = PHASE_WALK;
    // A sitter (a tool's portrait) stands still.
    const pace = PC[i];
    if (pace === 0 || !core) continue;

    const x = X[i];
    const z = Z[i];
    const r = RADII[KD[i]];
    // THE CORE: close enough, and it bites and is spent.
    const dcx = cx - x;
    const dcz = cz - z;
    const dc2 = dcx * dcx + dcz * dcz;
    if (dc2 <= (reach + r) * (reach + r)) {
      hitCore(core, spec.leak);
      h.kill(i, LEAK);
      if (plant.siege.phase === 'fallen') return;
      continue;
    }

    // THE WAY (re-read every other tick, and always off a fresh start).
    let wx = VX[i];
    let wz = VZ[i];
    if (((i & 1) === parity || ph !== PHASE_WALK) || (wx === 0 && wz === 0)) {
      if (live) {
        field.way(x, z, _w);
        wx = _w.x;
        wz = _w.z;
      } else {
        const dc = Math.sqrt(dc2);
        wx = dcx / dc;
        wz = dcz / dc;
      }
      VX[i] = wx;
      VZ[i] = wz;
    }
    // …leaned by its own veer, which fades as it closes on the core so
    // the fan comes back together at the end.
    const a = h.veer[i] * veer * Math.min(1, dc2 * 0.64);
    const speed = (spec.speed * pace) / Math.sqrt(1 + a * a);
    let vx = (wx - wz * a) * speed;
    let vz = (wz + wx * a) * speed;
    // THE CROWD shoves it off the thick of it.
    if (live) {
      field.crowdPush(x, z, _p);
      vx += _p.x;
      vz += _p.z;
    }
    let nx = x + vx * dt;
    let nz = z + vz * dt;

    // A TOWER IN THE WAY: if the road runs through it, chew; if not,
    // slide along it.
    const here = live ? field.at(x, z) : -1;
    if (here >= 0 && nearTower[here]) {
      const ml = Math.sqrt(vx * vx + vz * vz) || 1;
      const lx = (vx / ml) * r * 0.8;
      const lz = (vz / ml) * r * 0.8;
      const k = field.at(nx + lx, nz + lz);
      const t = blocker(k, here);
      if (t) {
        if (steps[here] === k) {
          bite(i, t, spec.bite, dt);
          continue;
        }
        if (!blocker(field.at(nx + lx, z), here)) nz = z;
        else if (!blocker(field.at(x, nz + lz), here)) nx = x;
        else {
          nx = x;
          nz = z;
        }
      }
    }
    PH[i] = PHASE_WALK;
    const mx = nx - x;
    const mz = nz - z;
    X[i] = nx;
    Z[i] = nz;
    const moved = Math.sqrt(mx * mx + mz * mz);
    SD[i] += moved;
    FD[i] = here >= 0 ? dist[here] * CELL : Math.sqrt(dc2);
    // Face the way it goes (eased, so a turn reads as a turn), on the
    // same every-other tick as the way. The wrap is by hand: two more
    // trig calls a crawler is a whole tick.
    if (moved > 1e-5 && (i & 1) === parity) {
      let d = Math.atan2(mx, mz) - HD[i];
      if (d > Math.PI) d -= TAU;
      else if (d < -Math.PI) d += TAU;
      HD[i] = wrap(HD[i] + d * ease);
    }
  }
}

const TAU = Math.PI * 2;
/** An angle back into −π..π. */
function wrap(a: number): number {
  return a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a;
}

/** Crawler i is up against tower t, and the way runs through it: chew. */
function bite(i: number, t: Unit, dps: number, dt: number): void {
  const h = plant.siege.horde;
  h.phase[i] = PHASE_BITE;
  h.stride[i] += dt * 0.3;
  cellCenter(t.i, t.j, _p);
  h.heading[i] = Math.atan2(_p.x - h.x[i], _p.z - h.z[i]);
  t.hp -= dps * dt;
  t.hurtT = 0;
  if (Math.random() < dt * 1.5) fx({ kind: 'bite', x: h.x[i], y: 0, z: h.z[i], unit: t.id });
  if (t.hp > 0) return;
  // CHEWED TO SCRAP: the tower goes, and the field re-lays round the hole.
  t.hp = 0;
  fx({ kind: 'blast', x: _p.x, y: 0, z: _p.z, unit: t.id, radius: 0.32 });
  removeUnit(t);
}

/* ── THE THROW ──────────────────────────────────────────────────────────
 * Your own hands are a weapon of last resort: close a fist on a mite or
 * a beetle (not a hulk) and it is yours — it thrashes in your grip, the
 * towers hold their fire on it, and when you open your hand it flies
 * with your hand's speed. Where it lands it breaks, and so does what it
 * lands on; whatever survives shakes it off and comes on again.
 */

/** How close a fist must be to take one (plant m, body to hand). */
export const GRAB_REACH = 0.16;
/** Gravity in plant metres (the room's 9.8, at the plant's scale). */
const G = 9.8 / 0.7;
/** Damage on landing per (plant m/s) of speed past a gentle drop. */
const IMPACT = 34;
const SOFT = 1.2;

const held: [number, number] = [0, 0];
const heldAt: [number, number] = [-1, -1];

/** Who a fist is holding (−1 none) — looked up by uid each time. */
function heldIndex(hand: 0 | 1): number {
  if (!held[hand]) return -1;
  const h = plant.siege.horde;
  const i = h.find(held[hand], heldAt[hand]);
  if (i < 0 || h.phase[i] !== PHASE_HELD) {
    held[hand] = 0;
    return -1;
  }
  heldAt[hand] = i;
  return i;
}

/** A fist closes at (x, y, z): take the nearest mite or beetle in reach. */
export function grabEnemy(hand: 0 | 1, x: number, y: number, z: number): boolean {
  if (heldIndex(hand) >= 0) return false;
  const h = plant.siege.horde;
  let best = -1;
  let bestD = GRAB_REACH;
  for (let k = 0; k < h.n; k++) {
    if (h.dead[k] || h.phase[k] === PHASE_HELD || HORDE_KINDS[h.kind[k]] === 'hulk') continue;
    const r = SPECS[h.kind[k]].radius;
    const d = Math.hypot(h.x[k] - x, h.y[k] + r * 0.6 - y, h.z[k] - z) - r;
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  if (best < 0) return false;
  h.phase[best] = PHASE_HELD;
  h.kT[best] = 0;
  h.stunT[best] = 0;
  held[hand] = h.uid[best];
  heldAt[hand] = best;
  holdEnemy(hand, x, y, z);
  fx({ kind: 'grab', x, y, z });
  return true;
}

/** Carry it with the fist (call every frame while it is held). */
export function holdEnemy(hand: 0 | 1, x: number, y: number, z: number): boolean {
  const i = heldIndex(hand);
  if (i < 0) return false;
  const h = plant.siege.horde;
  const r = SPECS[h.kind[i]].radius;
  h.x[i] = x;
  h.z[i] = z;
  h.y[i] = Math.max(0, y - r * 0.6);
  return true;
}

/** The fist opens: it goes with (vx, vy, vz) plant m/s. */
export function throwEnemy(hand: 0 | 1, vx: number, vy: number, vz: number): boolean {
  const i = heldIndex(hand);
  held[hand] = 0;
  if (i < 0) return false;
  const h = plant.siege.horde;
  const sp = Math.hypot(vx, vy, vz);
  const k = sp > 12 ? 12 / sp : 1;
  h.vx[i] = vx * k;
  h.vy[i] = vy * k;
  h.vz[i] = vz * k;
  h.phase[i] = PHASE_FLY;
  h.phaseT[i] = 0;
  return true;
}

/** Is a fist holding one? */
export function holding(hand: 0 | 1): boolean {
  return heldIndex(hand) >= 0;
}

/** One step of the arc; on the floor, the landing. */
function fly(i: number, dt: number): void {
  const h = plant.siege.horde;
  h.vy[i] -= G * dt;
  h.x[i] += h.vx[i] * dt;
  h.y[i] += h.vy[i] * dt;
  h.z[i] += h.vz[i] * dt;
  if (Math.abs(h.vx[i]) + Math.abs(h.vz[i]) > 0.05) h.heading[i] = wrap(h.heading[i] + dt * 14);
  if (h.y[i] > 0) return;
  // THE LANDING.
  const speed = Math.hypot(h.vx[i], h.vy[i], h.vz[i]);
  h.y[i] = 0;
  h.vx[i] = 0;
  h.vy[i] = 0;
  h.vz[i] = 0;
  const dmg = Math.max(0, speed - SOFT) * IMPACT;
  const x = h.x[i];
  const z = h.z[i];
  const me = h.uid[i];
  if (dmg > 0) {
    // What it lands on takes the blow too.
    const r = 0.09 + Math.min(0.12, speed * 0.015);
    h.near(x, z, r, (k) => {
      if (h.uid[k] !== me) hurt(k, dmg * 0.6, THROWN);
    });
    fx({ kind: 'slam', x, y: 0.02, z, radius: r });
  }
  // (`near` can sweep nothing, so i is still i.)
  h.phase[i] = PHASE_RETURN;
  h.phaseT[i] = 0;
  h.stunT[i] = 0.5;
  hurt(i, dmg, THROWN);
}

/** Something reached the core. */
function hitCore(core: Unit, dmg: number): void {
  core.hp -= dmg;
  core.hurtT = 0;
  cellCenter(core.i, core.j, _c);
  fx({ kind: 'core-hit', x: _c.x, y: 0, z: _c.z, unit: core.id, radius: dmg });
  if (core.hp > 0) return;
  core.hp = 0;
  plant.siege.phase = 'fallen';
  fx({ kind: 'fallen', x: _c.x, y: 0, z: _c.z });
}

/* ── THE TOWERS ─────────────────────────────────────────────────────────── */

const SHOT_Y = 0.08; // where a shot lands on a body (plant m up)

/** A tower's level (1–3). */
export function levelOf(u: Unit): number {
  return u.level ?? 1;
}
const lv = (u: Unit) => SIEGE.levels[Math.min(SIEGE.levels.length, levelOf(u)) - 1];

export function rangeOf(u: Unit): number {
  return WEAPONS[u.type as WeaponId].range * lv(u).range;
}
function damageOf(u: Unit): number {
  return WEAPONS[u.type as WeaponId].damage * lv(u).damage;
}

/** What the next level costs (null at the top). */
export function upgradeCost(u: Unit): number | null {
  if (!isWeapon(u.type) || levelOf(u) >= SIEGE.levels.length) return null;
  return Math.round(WEAPONS[u.type as WeaponId].cost * SIEGE.levels[levelOf(u)].cost);
}

/** Buy the next level. */
export function upgradeTower(u: Unit): boolean {
  const cost = upgradeCost(u);
  const sg = plant.siege;
  if (cost === null || sg.coins < cost) return false;
  sg.coins -= cost;
  // Thicker plate with every level: the new hit points come on whole.
  const was = lv(u).hp;
  u.level = levelOf(u) + 1;
  u.spent = (u.spent ?? 0) + cost;
  const max = u.maxHp * (lv(u).hp / was);
  u.hp += max - u.maxHp;
  u.maxHp = max;
  cellCenter(u.i, u.j, _c);
  fx({ kind: 'upgrade', x: _c.x, y: 0, z: _c.z, unit: u.id, weapon: u.type as WeaponId });
  plant.generation++;
  return true;
}

/** What selling it would return. */
export function sellValue(u: Unit): number {
  return Math.round((u.spent ?? 0) * SIEGE.sellBack);
}

/** Its coins back (a share), as it is taken off the floor. */
export function refundTower(u: Unit): void {
  plant.siege.coins += sellValue(u);
}

/** The crawler a tower at (x, z) should engage: in range (and outside any
 *  blind spot), FIRST — the one with least road left to the core — but
 *  with the head's turn priced in: they come from every side, and a gun
 *  that swung to whichever was a hair closer would spend the wave
 *  turning. One behind it has to be SIEGE.turnPrice m nearer to win. */
function pickTarget(x: number, z: number, range: number, minRange: number, yaw: number): number {
  const h = plant.siege.horde;
  pickBest = -1;
  pickD = Infinity;
  pickMin = minRange;
  pickX = x;
  pickZ = z;
  pickFx = Math.sin(yaw);
  pickFz = Math.cos(yaw);
  // Through the buckets: a hammer's reach is a handful of them, not the
  // whole horde (and `near` walks everyone when the reach is wider).
  h.near(x, z, range, pickOne);
  return pickBest;
}
let pickBest = -1;
let pickD = Infinity;
let pickMin = 0;
let pickX = 0;
let pickZ = 0;
let pickFx = 0;
let pickFz = 1;
function pickOne(i: number, d: number): void {
  const h = plant.siege.horde;
  if (d < pickMin || h.fd[i] >= pickD) return;
  const ph = h.phase[i];
  // Not one still in the plaster, the one in your hand, nor one in the air
  // — nor one with enough already flying at it to finish it.
  if ((ph === PHASE_EMERGE && h.phaseT[i] < 0.3) || ph === PHASE_HELD || ph === PHASE_FLY) return;
  if (h.pend[i] >= h.hp[i]) return;
  // 0 dead ahead, 1 square to the side, 2 straight behind.
  const off = d > 1e-4 ? 1 - ((h.x[i] - pickX) * pickFx + (h.z[i] - pickZ) * pickFz) / d : 0;
  const score = h.fd[i] + off * SIEGE.turnPrice * 0.5;
  if (score >= pickD) return;
  pickD = score;
  pickBest = i;
}

/** Slew a tower's head toward a yaw; true once it is near enough to fire. */
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
    if (u.strike) {
      u.strike.t -= dt;
      if (u.strike.t <= 0) smash(u);
      continue; // mid-swing: it neither turns nor fires
    }
    cellCenter(u.i, u.j, _c);
    const range = rangeOf(u);
    // Keep the one it has while it is alive and in reach; look again
    // twice a second for one nearer the core.
    let ti = -1;
    const hint = u.tgtAt ?? -1;
    if (u.tgt && hint >= 0 && hint < h.n && h.uid[hint] === u.tgt && !h.dead[hint] && h.pend[hint] < h.hp[hint]) {
      const dx = h.x[hint] - _c.x;
      const dz = h.z[hint] - _c.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d <= range && d >= (spec.minRange ?? 0)) ti = hint;
    }
    if (ti < 0 || u.look <= 0) {
      ti = pickTarget(_c.x, _c.z, range, spec.minRange ?? 0, u.yaw ?? 0);
      u.look = 0.5;
    }
    u.tgt = ti >= 0 ? h.uid[ti] : 0;
    u.tgtAt = ti;
    if (ti < 0) continue;
    const want = Math.atan2(h.x[ti] - _c.x, h.z[ti] - _c.z);
    const aimed = slew(u, want, dt, w === 'flamer' ? 0.5 : 0.3);
    if (!aimed || u.cool > 0) continue;
    u.cool = spec.cycleS / lv(u).rate;
    u.firedT = 0;
    const yaw = u.yaw ?? want;
    const reach = w === 'mortar' ? 0.22 : 0.18;
    const mx = _c.x + Math.sin(yaw) * reach;
    const mz = _c.z + Math.cos(yaw) * reach;
    const my = spec.muzzleY;
    if (w === 'flamer') {
      flame(u, mx, my, mz, yaw);
      continue;
    }
    if (w === 'hammer') {
      swing(u, ti);
      continue;
    }
    fx({ kind: 'fire', x: mx, y: my, z: mz, weapon: w, unit: u.id, yaw });
    if (w === 'tesla') arc(u, ti, mx, my, mz);
    else shoot(u, mx, my, mz, ti);
  }
}

/** A round in flight (turret slugs, mortar shells). */
function shoot(u: Unit, x: number, y: number, z: number, ti: number): void {
  const w = u.type as WeaponId;
  const spec = WEAPONS[w];
  const sg = plant.siege;
  const h = sg.horde;
  const d = Math.hypot(h.x[ti] - x, h.z[ti] - z);
  // A shell leads its target: it lands where the crawler WILL be.
  let tx = h.x[ti];
  let tz = h.z[ti];
  if (w === 'mortar') {
    ahead(ti, (d / (spec.speed ?? 3)) * 1.6, _p);
    tx = _p.x;
    tz = _p.z;
  }
  const damage = damageOf(u);
  // A slug is as good as landed: book its damage on the target now.
  if (w !== 'mortar') h.pend[ti] += damage;
  sg.shots.push({
    id: sg.nextShot++,
    weapon: w,
    x0: x,
    y0: y,
    z0: z,
    x1: tx,
    y1: SHOT_Y,
    z1: tz,
    target: w === 'mortar' ? -1 : h.uid[ti],
    at: ti,
    t: 0,
    dur: Math.max(0.05, d / (spec.speed ?? 10)) * (w === 'mortar' ? 1.6 : 1),
    damage,
  });
}

/** TESLA: bites one, jumps to the nearest it hasn't bitten, and on. */
function arc(u: Unit, ti: number, x: number, y: number, z: number): void {
  const spec = WEAPONS.tesla;
  const h = plant.siege.horde;
  const hit: number[] = [];
  const path: number[] = [x, y, z];
  let cur = ti;
  let dmg = damageOf(u);
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

/** Throw crawler i `dist` away from (x, z) over `kt` seconds, reeling. */
function knock(i: number, x: number, z: number, dist: number, kt: number): void {
  const h = plant.siege.horde;
  if (dist <= 0 || h.pace[i] === 0) return;
  const dx = h.x[i] - x;
  const dz = h.z[i] - z;
  const l = Math.hypot(dx, dz) || 1;
  h.kvx[i] = (dx / l) * (dist / kt);
  h.kvz[i] = (dz / l) * (dist / kt);
  h.kT[i] = kt;
  h.stunT[i] = Math.max(h.stunT[i], kt);
}

/** Where crawler i will be in `t` seconds, walking its way (into out). */
function ahead(i: number, t: number, out: { x: number; z: number }): void {
  const h = plant.siege.horde;
  const go = SPECS[h.kind[i]].speed * h.pace[i] * t;
  if (field.live && h.phase[i] === PHASE_WALK) {
    field.way(h.x[i], h.z[i], _w);
    out.x = h.x[i] + _w.x * go;
    out.z = h.z[i] + _w.z * go;
  } else {
    out.x = h.x[i];
    out.z = h.z[i];
  }
}

/** HAMMER: the head goes up. It lands HAMMER_SWING seconds later, on
 *  the spot the target was walking into. */
const HAMMER_SWING = 0.22;
function swing(u: Unit, ti: number): void {
  // Lead it: by the time the head comes down it has walked on.
  ahead(ti, HAMMER_SWING, _p);
  u.strike = { x: _p.x, z: _p.z, t: HAMMER_SWING };
}

/** The head comes down: everything under it is flattened and stunned. */
function smash(u: Unit): void {
  const st = u.strike;
  if (!st) return;
  u.strike = undefined;
  const spec = WEAPONS.hammer;
  const h = plant.siege.horde;
  const r = spec.splash ?? 0.2;
  const dmg = damageOf(u);
  h.near(st.x, st.z, r + MAX_R, (i, d) => {
    hurt(i, dmg * (d < r * 0.6 ? 1 : 0.6), W.hammer);
    if (!h.dead[i]) h.stunT[i] = Math.max(h.stunT[i], spec.stunS ?? 0.4);
  });
  fx({ kind: 'punch', x: st.x, y: 0.02, z: st.z, weapon: 'hammer', unit: u.id, yaw: u.yaw ?? 0, radius: r });
}

/** FLAMER: one tick of the cone — everything inside it scorches and
 *  catches, and now and then the floor where it lands goes up too. */
function flame(u: Unit, x: number, y: number, z: number, yaw: number): void {
  const spec = WEAPONS.flamer;
  const h = plant.siege.horde;
  const reach = rangeOf(u);
  const cone = spec.cone ?? 0.5;
  const dmg = damageOf(u);
  const burnDps = (spec.burn?.dps ?? 5) * lv(u).damage;
  let hits = 0;
  h.near(x, z, reach + MAX_R, (i, d) => {
    const a = Math.atan2(h.x[i] - x, h.z[i] - z);
    const off = Math.abs(Math.atan2(Math.sin(a - yaw), Math.cos(a - yaw)));
    if (off > cone && d > 0.15) return;
    hits++;
    h.burnT[i] = Math.max(h.burnT[i], spec.burn?.s ?? 2);
    h.burnDps[i] = Math.max(h.burnDps[i], burnDps);
    hurt(i, dmg, W.flamer, false);
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

/** Burning floor: anything walking through it catches. */
function tickFires(dt: number): void {
  const sg = plant.siege;
  const h = sg.horde;
  let keep = 0;
  for (const f of sg.fires) {
    f.t += dt;
    if (f.t >= f.life) continue;
    sg.fires[keep++] = f;
    h.near(f.x, f.z, f.r + MAX_R, (i) => {
      h.burnT[i] = Math.max(h.burnT[i], 1.2);
      h.burnDps[i] = Math.max(h.burnDps[i], 6);
    });
  }
  sg.fires.length = keep;
}

function tickShots(dt: number): void {
  const sg = plant.siege;
  const h = sg.horde;
  // Landed rounds drop out as the list is walked (kept in order, no
  // copies: a wall of turrets has hundreds in the air).
  const list = sg.shots;
  const n = list.length;
  let keep = 0;
  for (let k = 0; k < n; k++) {
    const s = list[k];
    s.t += dt;
    // Slugs home on a live target (a round that misses a running mite is
    // a round nobody believes); shells fall where they were aimed. The
    // target is held by uid: the horde packs down every tick, so the
    // index it was fired at can move under it.
    let ti = -1;
    if (s.target > 0) {
      ti = h.find(s.target, s.at ?? -1);
      if (ti >= 0) {
        s.at = ti;
        s.x1 = h.x[ti];
        s.z1 = h.z[ti];
      } else {
        s.target = 0; // gone: it lands where it was
      }
    }
    if (s.t < s.dur) {
      list[keep++] = s;
      continue;
    }
    const spec = WEAPONS[s.weapon];
    const cause = W[s.weapon];
    const dmg = s.damage ?? spec.damage;
    if (spec.splash) {
      const r = spec.splash;
      h.near(s.x1, s.z1, r + MAX_R, (i, d) => {
        hurt(i, dmg * (d < r * 0.5 ? 1 : 0.6), cause);
        // The blast throws the survivors out of it.
        if (!h.dead[i]) knock(i, s.x1, s.z1, 0.3 * SPECS[h.kind[i]].give * (1 - d / (r + MAX_R)), 0.18);
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
        // Its booking comes off the one it was fired at (if it lives).
        if (s.target > 0) h.pend[ti] = Math.max(0, h.pend[ti] - dmg);
        hurt(ti, dmg, cause);
        fx({ kind: 'hit', x: s.x1, y: s.y1, z: s.z1, weapon: s.weapon });
      }
    }
  }
  list.length = keep;
}

/** Damage one crawler; it dies at zero. */
function hurt(i: number, dmg: number, cause: number, flash = true): void {
  const h = plant.siege.horde;
  if (h.dead[i] || h.phase[i] === PHASE_HELD) return; // your fist shields it
  h.hp[i] -= dmg;
  if (flash) h.flash[i] = 0.12;
  if (h.hp[i] <= 0) die(i, cause);
}

/** It goes down: logged for the renderer, and its coins drop. */
function die(i: number, cause: number): void {
  const sg = plant.siege;
  const h = sg.horde;
  if (h.dead[i]) return;
  h.kill(i, cause);
  sg.kills++;
  sg.coinDust += SPECS[h.kind[i]].coin;
  const whole = Math.floor(sg.coinDust + 1e-9);
  sg.coins += whole;
  sg.coinDust -= whole;
}

/* ── tools ──────────────────────────────────────────────────────────────── */

/** TOOLS ONLY. Stand the siege down: no clock, no rifts, no crawlers,
 *  and the core lifted. */
export function standDown(): void {
  const sg = plant.siege;
  sg.phase = 'off';
  sg.streams = [];
  sg.horde.clear();
  sg.shots = [];
  sg.fires = [];
  sg.breaches = [];
  rim = [];
  field.clear();
  const core = dockUnit();
  if (core) removeUnit(core);
}

/** The rifts glow the tide's own magenta. */
export function breachHex(): number {
  return 0xff2bd6;
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

/** TOOLS ONLY: stand a crawler anywhere (it stands still and can be
 *  shot — a sitter for a portrait). */
export function debugPlace(kind: EnemyId, x: number, z: number, heading = 0): void {
  const h = plant.siege.horde;
  const i = h.add(KIND_INDEX[kind], x, z, ENEMIES[kind].hp, heading);
  if (i < 0) return;
  h.phase[i] = PHASE_WALK;
  h.pace[i] = 0;
  h.fd[i] = 1e4;
}

/** Headless: every tower in the catalogue now. */
export function debugWakeAll(): void {
  applyWakes(WAVES.length - 1);
}

/** Headless: a clean floor for a portrait — every crawler, round, fire
 *  and rift gone, and the build clock held so no wave interrupts. */
export function debugClear(): void {
  const sg = plant.siege;
  sg.horde.clear();
  sg.streams = [];
  sg.breaches = [];
  sg.shots.length = 0;
  sg.fires.length = 0;
  if (sg.phase === 'build') sg.buildT = 9999;
  // …and the core whole again (a stress test may have let it fall).
  const core = dockUnit();
  if (core) core.hp = core.maxHp;
  if (sg.phase === 'fallen') sg.phase = 'build';
}

/** Headless: every crawler on the floor this many times as hard to kill. */
export function debugTough(mult: number): void {
  const h = plant.siege.horde;
  for (let i = 0; i < h.n; i++) {
    h.hp[i] *= mult;
    h.maxHp[i] *= mult;
  }
}

/** Headless: jump the ladder to wave `n`'s build phase. */
export function debugJump(n: number): void {
  const sg = plant.siege;
  sg.horde.clear();
  sg.streams = [];
  sg.shots.length = 0;
  sg.fires.length = 0;
  applyWakes(n);
  beginBuild(n);
}

/** Headless: split `n` rifts open now, pouring (a portrait's cracks). */
export function debugRifts(n: number): void {
  const sg = plant.siege;
  if (rim.length === 0) buildRim();
  for (let k = 0; k < n; k++) {
    const r = sg.breaches[openRift()];
    if (!r) break;
    r.state = 'pouring';
    fx({ kind: 'breach', x: r.x, y: 0, z: r.z, radius: r.half });
  }
}

/** Headless: crawlers climbing out right now — up out of rift
 *  `rift`, or (−1) anywhere along any wall. */
export function debugSpawn(kind: EnemyId, rift = -1, count = 1): void {
  if (rim.length === 0) buildRim();
  ensureField();
  for (let k = 0; k < count; k++) spawn(kind, rift);
}

/** Headless: a whole tide at once, out of every wall and already up to
 *  halfway in toward the core. */
export function debugFlood(kind: EnemyId, count: number): void {
  const sg = plant.siege;
  const h = sg.horde;
  const core = dockUnit();
  if (!core) return;
  if (rim.length === 0) buildRim();
  ensureField();
  for (let k = 0; k < count; k++) {
    const i = spawn(kind, -1);
    if (i < 0) break;
    cellCenter(core.i, core.j, _c);
    const t = Math.random() * 0.5;
    const x = h.x[i] + (_c.x - h.x[i]) * t;
    const z = h.z[i] + (_c.z - h.z[i]) * t;
    if (!blocker(field.at(x, z), -1)) {
      h.x[i] = x;
      h.z[i] = z;
    }
    h.phase[i] = PHASE_WALK;
    h.phaseT[i] = 1;
    h.fd[i] = field.distAt(h.x[i], h.z[i]);
  }
}

/** Headless: coins into the purse. */
export function debugCoins(n: number): void {
  plant.siege.coins += n;
}

