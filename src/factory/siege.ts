/**
 * THE SIEGE — the fight, pure of scene and speaker (sim.ts's discipline:
 * anything visible or audible that HAPPENS here leaves as a SiegeFx, and
 * SiegeSystem draws and voices it).
 *
 * Classic tower defence, in your room:
 *
 *   core   — the floor waits for its CORE. Where it lands decides the
 *            LANES: up to four glowing roads from cracks at the foot of
 *            your real walls to the core, laid once and kept.
 *   build  — the clock runs down (or the horn is sounded early). Towers
 *            go anywhere on the floor except on a lane.
 *   wave   — the tide pours out of the open cracks and marches its lanes.
 *            The towers fire on their own. Anything that reaches the core
 *            takes a bite out of it and is gone. Every kill drops coins;
 *            clearing the wave pays a bonus, and the next one opens.
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
import { mulberry32 } from '../game/rng.js';
import type { Wall } from '../room/walls.js';
import { PLANT_SCALE } from './frame.js';
import { HORDE_CAP, PHASE_EMERGE, PHASE_FLY, PHASE_HELD, PHASE_RETURN, PHASE_WALK } from './horde.js';
import { laneAt, laneCellSet, layLanes } from './lanes.js';
import { dockUnit, isWeapon, noBuild, placeUnit, removeUnit } from './sim.js';
import { plant, unitAtCell, type Breach, type SiegeFx, type Unit } from './state.js';

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
 * the CORE. Where it stands decides where the lanes run, so nothing else
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
  sg.lanes = [];
  sg.open = 0;
  sg.laneCells = new Set();
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

/** THE LANES are laid once, the first time a build phase opens: one per
 *  breach the siege will ever crack, from the wall's foot to the core. */
function layTheLanes(): void {
  const sg = plant.siege;
  const core = dockUnit();
  if (!core) return;
  sg.breaches = pickBreaches(SIEGE.lanes, 0x5eed + core.i * 131 + core.j * 977);
  sg.lanes = layLanes(sg.breaches, core, 0x1a7e + core.i * 31 + core.j * 17);
  sg.laneCells = laneCellSet(sg.lanes);
  // A tower standing where a lane now runs (a retry, a tool) gives way.
  for (const u of [...plant.units]) {
    if (u.type !== 'dock' && laneBlocked(u.i, u.j)) {
      refundTower(u);
      removeUnit(u);
    }
  }
  plant.generation++;
}

/** Is (i, j) on a lane, or in the core's clearing? Nothing is built there. */
export function laneBlocked(i: number, j: number): boolean {
  return noBuild(i, j);
}

function beginBuild(n: number): void {
  const sg = plant.siege;
  const spec = waveSpec(n);
  if (sg.lanes.length === 0) layTheLanes();
  const was = sg.open;
  sg.phase = 'build';
  sg.wave = n;
  sg.buildT = spec.buildS;
  sg.waveT = 0;
  sg.streams = [];
  sg.open = Math.max(1, Math.min(spec.breaches, sg.lanes.length));
  // A crack that opens this wave flares as it goes.
  for (let k = was; k < sg.open; k++) {
    const b = sg.breaches[k];
    if (b) fx({ kind: 'breach', x: b.x, y: 0, z: b.z });
  }
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

/* ── the tick ───────────────────────────────────────────────────────────── */

const _c = { x: 0, z: 0 };
const _p = { x: 0, z: 0, dx: 0, dz: 1 };

/** Specs by horde kind index. */
const SPECS = HORDE_KINDS.map((k) => ENEMIES[k]);
const MAX_R = Math.max(...SPECS.map((sp) => sp.radius));
const KIND_INDEX: Record<EnemyId, number> = Object.fromEntries(HORDE_KINDS.map((k, i) => [k, i])) as Record<
  EnemyId,
  number
>;
/** A crawler placed by a tool, standing still off any lane. */
const NO_LANE = 255;

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

export function siegeTick(dt: number): void {
  const t0 = performance.now();
  tickSiege(dt);
  simAvg = simAvg * 0.9 + (performance.now() - t0) * 0.1;
}

function tickSiege(dt: number): void {
  const sg = plant.siege;
  if (frozen || sg.phase === 'off' || sg.phase === 'fallen') return;
  // The core just landed: the lanes are laid and the siege begins.
  if (sg.phase === 'core') {
    if (dockUnit()) beginBuild(sg.wave);
    return;
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

/** The wave is down: pay the bonus, open the next. */
function waveCleared(): void {
  const sg = plant.siege;
  const core = dockUnit();
  if (core) cellCenter(core.i, core.j, _c);
  const bonus = SIEGE.waveBonus + SIEGE.bonusPerWave * (sg.wave + 1);
  sg.coins += bonus;
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

/** One crawler out of an open crack, onto its lane. */
function spawn(kind: EnemyId, laneIdx: number): number {
  const sg = plant.siege;
  const open = Math.max(1, Math.min(sg.open, sg.lanes.length));
  const k = laneIdx % open;
  const lane = sg.lanes[k];
  if (!lane) return -1;
  const h = sg.horde;
  const w = plant.siege.wave;
  const hp = ENEMIES[kind].hp * (1 + SIEGE.hpPerWave * w + SIEGE.hpPerWave2 * w * w);
  const i = h.add(KIND_INDEX[kind], lane.pts[0], lane.pts[1], hp, 0, k);
  if (i < 0) return -1;
  // A little behind the crack's mouth, so it climbs out rather than pops.
  h.s[i] = -Math.random() * 0.1;
  place(i);
  return i;
}

/** Stand crawler i where its lane says it is (s along, `lane` sideways). */
function place(i: number): void {
  const sg = plant.siege;
  const h = sg.horde;
  const lane = sg.lanes[h.breach[i]];
  if (!lane) return;
  laneAt(lane, Math.max(0, h.s[i]), _p);
  const side = h.lane[i] * SIEGE.laneWidth;
  // Inside the wall: it comes out along the wall's own normal.
  const back = Math.min(0, h.s[i]);
  h.x[i] = _p.x - _p.dz * side + lane.breach.nx * back;
  h.z[i] = _p.z + _p.dx * side + lane.breach.nz * back;
  h.fd[i] = lane.len - h.s[i];
}

/** Every crawler, one step: burn, reel, climb out, march, and — at the
 *  end of the lane — hit the core and be gone. */
function tickHorde(dt: number): void {
  const sg = plant.siege;
  const h = sg.horde;
  const core = dockUnit();
  for (let i = 0; i < h.n; i++) {
    if (h.dead[i]) continue;
    const spec = SPECS[h.kind[i]];
    if (h.flash[i] > 0) h.flash[i] -= dt;
    h.phaseT[i] += dt;

    // ON FIRE: it burns as it walks.
    if (h.burnT[i] > 0) {
      h.burnT[i] -= dt;
      h.hp[i] -= h.burnDps[i] * dt;
      if (h.hp[i] <= 0) {
        die(i, W.flamer);
        continue;
      }
    }
    const ph = h.phase[i];
    if (ph === PHASE_HELD) continue;
    if (ph === PHASE_FLY) {
      fly(i, dt);
      continue;
    }
    if (ph === PHASE_RETURN) {
      scrabble(i, dt);
      continue;
    }
    if (h.breach[i] === NO_LANE) continue;
    const lane = sg.lanes[h.breach[i]];
    if (!lane) continue;
    // THROWN back down its lane, then reeling.
    if (h.kT[i] > 0) {
      h.kT[i] -= dt;
      h.s[i] = Math.max(SIEGE.emergeDepth, h.s[i] - h.ks[i] * dt);
      place(i);
      continue;
    }
    if (h.stunT[i] > 0) {
      h.stunT[i] -= dt;
      continue;
    }
    const step = spec.speed * h.pace[i] * dt;
    h.s[i] += step;
    h.stride[i] += step;
    h.phase[i] = h.s[i] < SIEGE.emergeDepth ? PHASE_EMERGE : PHASE_WALK;
    // THE END OF THE LANE: it hits the core and is spent.
    if (h.s[i] >= lane.len - (CELL * 0.5 + spec.radius)) {
      if (core) hitCore(core, spec.leak);
      h.kill(i, LEAK);
      if (plant.siege.phase === 'fallen') return;
      continue;
    }
    place(i);
    // Face along the lane (eased, so a corner reads as a turn).
    const want = Math.atan2(_p.dx, _p.dz);
    const d = Math.atan2(Math.sin(want - h.heading[i]), Math.cos(want - h.heading[i]));
    h.heading[i] += d * Math.min(1, dt * 8);
  }
}

/* ── THE THROW ──────────────────────────────────────────────────────────
 * Your own hands are a weapon of last resort: close a fist on a mite or
 * a beetle (not a hulk) and it is yours — it thrashes in your grip, the
 * towers hold their fire on it, and when you open your hand it flies
 * with your hand's speed. Where it lands it breaks, and so does what it
 * lands on; whatever survives scrabbles back to its lane.
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
  if (Math.abs(h.vx[i]) + Math.abs(h.vz[i]) > 0.05) h.heading[i] += dt * 14;
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

/** Landed and alive: dazed a moment, then back to the nearest point of
 *  its lane on foot; there it falls in and marches on. */
function scrabble(i: number, dt: number): void {
  const sg = plant.siege;
  const h = sg.horde;
  if (h.stunT[i] > 0) {
    h.stunT[i] -= dt;
    return;
  }
  // Pick (once) the lane and the place on it to make for.
  if (h.phaseT[i] < 1e6) {
    let best = Infinity;
    let bl = -1;
    let bs = 0;
    sg.lanes.forEach((l, li) => {
      if (li >= Math.max(1, sg.open)) return;
      const p = l.pts;
      for (let k = 0; k + 1 < p.length / 2; k++) {
        const ax = p[k * 2];
        const az = p[k * 2 + 1];
        const dx = p[k * 2 + 2] - ax;
        const dz = p[k * 2 + 3] - az;
        const L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((h.x[i] - ax) * dx + (h.z[i] - az) * dz) / L2));
        const d = Math.hypot(ax + dx * t - h.x[i], az + dz * t - h.z[i]);
        if (d < best) {
          best = d;
          bl = li;
          bs = l.cum[k] + Math.sqrt(L2) * t;
        }
      }
    });
    if (bl < 0) {
      h.phase[i] = PHASE_WALK; // no lanes: it just stands
      h.breach[i] = NO_LANE;
      return;
    }
    h.breach[i] = bl;
    h.s[i] = Math.max(SIEGE.emergeDepth, bs);
    h.lane[i] = Math.random() - 0.5;
    h.phaseT[i] = 1e6 + 1;
  }
  const lane = sg.lanes[h.breach[i]];
  if (!lane) return;
  laneAt(lane, h.s[i], _p);
  const side = h.lane[i] * SIEGE.laneWidth;
  const tx = _p.x - _p.dz * side;
  const tz = _p.z + _p.dx * side;
  const dx = tx - h.x[i];
  const dz = tz - h.z[i];
  const d = Math.hypot(dx, dz);
  const step = SPECS[h.kind[i]].speed * 1.3 * dt;
  h.heading[i] = Math.atan2(dx, dz);
  h.stride[i] += step;
  if (d <= step) {
    h.phase[i] = PHASE_WALK;
    place(i);
    return;
  }
  h.x[i] += (dx / d) * step;
  h.z[i] += (dz / d) * step;
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
  u.level = levelOf(u) + 1;
  u.spent = (u.spent ?? 0) + cost;
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
 *  blind spot), FIRST — the one with least lane left to the core. */
function pickTarget(x: number, z: number, range: number, minRange = 0): number {
  const h = plant.siege.horde;
  let best = -1;
  let bestD = Infinity;
  const r2 = range * range;
  const m2 = minRange * minRange;
  for (let i = 0; i < h.n; i++) {
    if (h.dead[i] || (h.phase[i] === PHASE_EMERGE && h.phaseT[i] < 0.3)) continue;
    // Not the one in your hand, nor one in the air.
    if (h.phase[i] === PHASE_HELD || h.phase[i] === PHASE_FLY) continue;
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
    if (u.tgt && hint >= 0 && hint < h.n && h.uid[hint] === u.tgt && !h.dead[hint]) {
      const dx = h.x[hint] - _c.x;
      const dz = h.z[hint] - _c.z;
      const d = Math.sqrt(dx * dx + dz * dz);
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
  if (w === 'mortar' && h.breach[ti] !== NO_LANE) {
    const lane = sg.lanes[h.breach[ti]];
    const flight = (d / (spec.speed ?? 3)) * 1.6;
    if (lane) {
      laneAt(lane, h.s[ti] + SPECS[h.kind[ti]].speed * h.pace[ti] * flight, _p);
      tx = _p.x;
      tz = _p.z;
    }
  }
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
    damage: damageOf(u),
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

/** Throw crawler i back down its lane by `dist` over `kt` seconds. */
function knock(i: number, dist: number, kt: number, stun: number): void {
  const h = plant.siege.horde;
  if (h.breach[i] === NO_LANE || dist <= 0) return;
  h.ks[i] = dist / kt;
  h.kT[i] = kt;
  h.stunT[i] = Math.max(h.stunT[i], stun);
}

/** HAMMER: the head goes up. It lands HAMMER_SWING seconds later, on
 *  the spot the target was walking into. */
const HAMMER_SWING = 0.22;
function swing(u: Unit, ti: number): void {
  const sg = plant.siege;
  const h = sg.horde;
  let x = h.x[ti];
  let z = h.z[ti];
  // Lead it: by the time the head comes down it has walked on.
  const lane = h.breach[ti] !== NO_LANE ? sg.lanes[h.breach[ti]] : undefined;
  if (lane) {
    laneAt(lane, h.s[ti] + SPECS[h.kind[ti]].speed * h.pace[ti] * HAMMER_SWING, _p);
    x = _p.x;
    z = _p.z;
  }
  u.strike = { x, z, t: HAMMER_SWING };
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
    const dmg = s.damage ?? spec.damage;
    if (spec.splash) {
      const r = spec.splash;
      h.near(s.x1, s.z1, r + MAX_R, (i, d) => {
        hurt(i, dmg * (d < r * 0.5 ? 1 : 0.6), cause);
        // The blast throws the survivors back down their lane.
        if (!h.dead[i]) knock(i, 0.3 * SPECS[h.kind[i]].give * (1 - d / (r + MAX_R)), 0.18, 0);
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
        hurt(ti, dmg, cause);
        fx({ kind: 'hit', x: s.x1, y: s.y1, z: s.z1, weapon: s.weapon });
      }
    }
  }
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

/** TOOLS ONLY. Stand the siege down: no clock, no breaches, no crawlers,
 *  and the core lifted. */
export function standDown(): void {
  const sg = plant.siege;
  sg.phase = 'off';
  sg.streams = [];
  sg.horde.clear();
  sg.shots = [];
  sg.fires = [];
  sg.breaches = [];
  sg.lanes = [];
  sg.open = 0;
  sg.laneCells = new Set();
  const core = dockUnit();
  if (core) removeUnit(core);
}

/** The cracks and lanes glow the tide's own magenta. */
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

/** TOOLS ONLY: stand a crawler anywhere, off every lane (it stands
 *  still and can be shot — a sitter for a portrait). */
export function debugPlace(kind: EnemyId, x: number, z: number, heading = 0): void {
  const h = plant.siege.horde;
  const i = h.add(KIND_INDEX[kind], x, z, ENEMIES[kind].hp, heading, NO_LANE);
  if (i < 0) return;
  h.phase[i] = PHASE_WALK;
  h.fd[i] = 1e4;
}

/** Headless: every tower in the catalogue now. */
export function debugWakeAll(): void {
  applyWakes(WAVES.length - 1);
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

/** Headless: open `n` lanes now. */
export function debugBreaches(n: number): void {
  const sg = plant.siege;
  const was = sg.open;
  sg.open = Math.max(1, Math.min(n, sg.lanes.length));
  for (let k = was; k < sg.open; k++) {
    const b = sg.breaches[k];
    if (b) fx({ kind: 'breach', x: b.x, y: 0, z: b.z });
  }
}

/** Headless: drop crawlers onto a lane right now. */
export function debugSpawn(kind: EnemyId, breach = 0, count = 1): void {
  for (let k = 0; k < count; k++) spawn(kind, breach);
}

/** Headless: a whole tide at once, strung out along every open lane. */
export function debugFlood(kind: EnemyId, count: number): void {
  const sg = plant.siege;
  const h = sg.horde;
  const open = Math.max(1, sg.open);
  for (let k = 0; k < count; k++) {
    const i = spawn(kind, k % open);
    if (i < 0) break;
    const lane = sg.lanes[h.breach[i]];
    if (!lane) continue;
    h.s[i] = SIEGE.emergeDepth + Math.random() * lane.len * 0.5;
    h.phase[i] = PHASE_WALK;
    place(i);
  }
}

/** Headless: coins into the purse. */
export function debugCoins(n: number): void {
  plant.siege.coins += n;
}

