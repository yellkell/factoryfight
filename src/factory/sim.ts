/**
 * The sim — the factory's one heartbeat, pure of scene and speaker.
 *
 * Fixed-step in spirit (FactorySystem hands it scaled wall time): feeds
 * pour, makers drink and stamp, chutes push, belts carry, combiners fit,
 * the dock drinks and swallows and counts. Anything audible or visible
 * that HAPPENS here leaves as a PlantEvent; FactorySystem performs it.
 *
 * This file is also the plant's mutation library — placing and removing
 * units, retracting runs, delivering parts — so BuildSystem and
 * FactorySystem never reach into the records bare-handed, and the
 * headless walk drives the same doors the hands do.
 */

import { Vector3 } from 'three';
import {
  COMBINES,
  FACTORY,
  MAKES,
  SIEGE,
  UNITS,
  WEAPONS,
  combineKey,
  type ItemId,
  type UnitType,
  type WeaponId,
} from '../config.js';
import { CELL, cellCenter, cellInFloor, occupy, vacate, type Cell } from '../floor/grid.js';
import { chestBonus, craftFactor, hpFactor, postsUnlocked, railFactor } from '../game/progress.js';
import {
  DIRS,
  beltPart,
  chestParts,
  chuteParts,
  orderSpec,
  plant,
  runSeatedAt,
  unitAtCell,
  unitById,
  type Part,
  type Rot,
  type Unit,
} from './state.js';

const _c = { x: 0, z: 0 };

/* ── where parts sit (the sim's word; FactorySystem renders it) ─────────── */

/** The chute plane — where a part's origin rests at BENCH height: on a
 *  maker's anvil edge, on a combiner's stage. */
export const CHUTE_Y = UNITS.crate.benchTop + 0.045;

/**
 * THE CHUTE IS A SLIDE — and it lands ON the rail.
 *
 * A chute used to be a flat tray at bench height hanging 0.1 m out over
 * the neighbouring cell, six centimetres ABOVE the rail that stood
 * there: nothing joined the two, and a stamped part dropped straight
 * through the tray onto the tread. The same tray, mirrored, hovered
 * over the end of every rail feeding a combiner's port. So the chute
 * slopes now: it leaves the machine at bench height and comes down to
 * rail height just past the cell's edge, where its foot sits on the
 * rail's skids — a spout that the lane runs out of, and a lane that
 * runs up into a hopper. The builder draws it, partPose walks parts
 * down it, and the craft theatre slides its phantoms onto it, all off
 * these three numbers.
 */
export const CHUTE_SLIDE = {
  /** Where the slide leaves the machine's face (m from the centre)… */
  from: 0.13,
  /** …and where its foot lands, just over the cell edge (0.175) onto
   *  the next cell's rail. */
  to: 0.19,
  /** The slide's top surface at either end: bench height at the
   *  machine, and resting on the rail's skid tops at the foot. */
  topY: UNITS.crate.benchTop + 0.012,
  footY: UNITS.railTop + 0.01,
  /** A part's origin rides this far above the surface it sits on. */
  seat: 0.033,
};

/** Where a part's origin sits on a chute or port slide, `reach` out
 *  from the machine's centre — bench height on the machine, rail
 *  height once it is past the foot. */
export function chuteY(reach: number): number {
  const { from, to, topY, footY, seat } = CHUTE_SLIDE;
  const t = Math.min(1, Math.max(0, (reach - from) / (to - from)));
  return topY + (footY - topY) * t + seat;
}

/** How far a chute slot stands off its unit's centre, along OUT. Slot 0
 *  waits at the FOOT of the chute slide (units.chuteSlide), on the
 *  first centimetres of whatever rail stands there — at rail height,
 *  which is where the lane takes it from; slot 1 waits on the machine's
 *  front edge behind it, at bench height. (The slots used to start at
 *  0.105 and step 0.13 — the front part hung over the drum's edge short
 *  of the tray and the second one sat under the piston.) The craft
 *  theatre (factory/craft.ts) ends every craft by sliding the forming
 *  part to exactly this spot, so the real part appears where the ghost
 *  stopped. */
export function chuteReach(slot: number): number {
  return 0.21 - slot * 0.105;
}

/** A combiner's ports, off the centre to either side: a part waits at
 *  the foot of the port's slide (the chute slide, mirrored — the same
 *  numbers), on the end of the rail that fed it, at rail height. */
export const PORT_REACH = UNITS.crate.size / 2 + 0.05;

/** A part's world pose from its logical place. Hand parts are the one
 *  place the sim defers — FactorySystem pins those to the grip. */
export function partPose(part: Part, out: Vector3): Vector3 {
  const at = part.at;
  if (at.kind === 'loose') return out.set(at.x, at.y, at.z);
  if (at.kind === 'hand') return out; // caller pins it
  const unit = unitById(at.unit);
  if (!unit) return out.set(0, 0, 0);
  cellCenter(unit.i, unit.j, _c);
  const dir = DIRS[unit.rot];
  if (at.kind === 'chute') {
    const reach = chuteReach(at.slot);
    return out.set(_c.x + dir.di * reach, chuteY(reach), _c.z + dir.dj * reach);
  }
  if (at.kind === 'belt') {
    const p = Math.min(1, Math.max(0, part.p));
    // THE BRIDGE DECK: straight over the top, with the hop in the middle.
    if (at.over && unit.over !== undefined) {
      const od = DIRS[unit.over];
      const along = (p - 0.5) * CELL * 0.92;
      const rise = Math.sin(p * Math.PI) * UNITS.bridgeRise;
      return out.set(_c.x + od.di * along, UNITS.railTop + 0.05 + rise, _c.z + od.dj * along);
    }
    // THE CURVE: a corner rail carries its part round a real quarter-arc
    // — entry face to out face about the corner the two share — instead
    // of sliding it along a straight it isn't drawing.
    const e = beltEntry(unit);
    if (e !== unit.rot) {
      const ed = DIRS[e];
      const half = CELL / 2;
      const cx = _c.x + (dir.di - ed.di) * half;
      const cz = _c.z + (dir.dj - ed.dj) * half;
      const a = p * Math.PI * 0.5;
      const dx = -dir.di * Math.cos(a) + ed.di * Math.sin(a);
      const dz = -dir.dj * Math.cos(a) + ed.dj * Math.sin(a);
      return out.set(cx + dx * half, UNITS.railTop + 0.05, cz + dz * half);
    }
    const along = (p - 0.5) * CELL * 0.92;
    return out.set(_c.x + dir.di * along, UNITS.railTop + 0.05, _c.z + dir.dj * along);
  }
  if (at.kind === 'port') {
    const side = DIRS[portDir(unit, at.port)];
    return out.set(_c.x + side.di * PORT_REACH, chuteY(PORT_REACH), _c.z + side.dj * PORT_REACH);
  }
  // chest — a little stack on the crate's lid.
  return out.set(_c.x, UNITS.crate.benchTop + 0.05 + at.index * 0.05, _c.z);
}

/** A combiner port's world-facing direction index: port 0 sits left of
 *  OUT, port 1 right. */
export function portDir(unit: Unit, port: 0 | 1): Rot {
  return ((unit.rot + (port === 0 ? 3 : 1)) % 4) as Rot;
}

/**
 * THE GLAND SWIVELS. A unit's tube intake is a collar that ORBITS its
 * drum: hand it the point the tube is coming from and it swings round
 * to meet it, so a supply run is never refused for arriving on the
 * wrong side. (It used to be welded to the unit's back face, which made
 * every hookup a guessing game about which way the box was facing —
 * the whole "doorways, not keyholes" law, broken. Now the door turns to
 * face you.) With no `toward`, it rests on the back face.
 */
export function glandPose(unit: Unit, point: Vector3, normal: Vector3, toward?: Vector3): void {
  cellCenter(unit.i, unit.j, _c);
  let nx: number;
  let nz: number;
  const dx = toward ? toward.x - _c.x : 0;
  const dz = toward ? toward.z - _c.z : 0;
  const len = Math.hypot(dx, dz);
  if (toward && len > 1e-3) {
    nx = dx / len;
    nz = dz / len;
  } else {
    const back = DIRS[((unit.rot + 2) % 4) as Rot];
    nx = back.di;
    nz = back.dj;
  }
  const reach = glandReach(unit.type);
  point.set(_c.x + nx * reach, UNITS.glandHeight, _c.z + nz * reach);
  normal.set(nx, 0, nz);
}

/** How far a gland's face stands off its cell centre: the radius of the
 *  BODY it actually bolts to, sunk a few millimetres so the mounting
 *  boss presses in with no daylight at any swivel angle — the maker's
 *  drum, the vat's glass (where the sunk boss doubles as the intake
 *  stub you can see inside the tank). The seat maths, the live mesh and
 *  the build ghost all read this one number, so the collar can never
 *  seat where the metal isn't. (An angled-up variant of this record
 *  lived for one build and is reverted — see UNITS.glandHeight.) */
export function glandReach(type: UnitType): number {
  if (type === 'maker') return 0.131;
  if (type === 'vat') return 0.156;
  if (type === 'flamer') return 0.118;
  if (type === 'tesla') return 0.105;
  return UNITS.crate.size / 2;
}

/* ── mutations (BuildSystem / FactorySystem / the walk drive these) ─────── */

export function unitAvailable(type: UnitType): boolean {
  // No shift live = site dressing (the floor walk stamps test crates
  // before any sheet is posted); a shift obeys its catalogue — and FREE
  // PLAY's catalogue is simply everything.
  if (plant.mode === 'idle') return true;
  // A POST is bought, not unlocked by a sheet: it never joins the book's
  // ladder, so the catalogue would never list it.
  if (type === 'post') return postsUnlocked();
  // CORE FIRST: until it stands, it is the only thing on offer.
  if (plant.siege.phase === 'core') return type === 'dock';
  return plant.unitsAvailable.includes(type);
}

export function dockUnit(): Unit | undefined {
  return plant.units.find((u) => u.type === 'dock');
}

/**
 * THE CONNECTION LAW — what one piece of plant MEANS to another.
 *
 * A part travelling `travel` into `into` has somewhere to go only if the
 * two units actually relate: rails feed rails, docks, chests and a
 * combiner's two side PORTS — and never a maker, which drinks fluid off
 * a tube and has no use for a part at all. Occupancy is a separate
 * question (a full rail still LINKS, it is just busy); this is about
 * whether a join means anything.
 */
export function canLink(into: Unit, travel: Rot): boolean {
  // A POST is scaffolding, not plant: it holds a corner for a haul to
  // route through and has no more to do with a part than the floor does.
  if (into.type === 'post') return false;
  if (into.type === 'belt' || into.type === 'dock' || into.type === 'chest') return true;
  if (into.type === 'combiner') {
    const enterFrom = ((travel + 2) % 4) as Rot;
    return enterFrom === portDir(into, 0) || enterFrom === portDir(into, 1);
  }
  return false; // makers and the vat take a tube, not a rail
}

/** Does this unit push parts out of its OUT face? */
export function emits(unit: Unit): boolean {
  return unit.type === 'maker' || unit.type === 'combiner' || unit.type === 'belt';
}

/** Is there a live link from `unit` into whatever stands ahead of it? */
export function linkAhead(unit: Unit): Unit | null {
  if (!emits(unit)) return null;
  const d = DIRS[unit.rot];
  const ahead = unitAtCell(unit.i + d.di, unit.j + d.dj);
  return ahead && canLink(ahead, unit.rot) ? ahead : null;
}

/**
 * WHICH WAY A PART COMES INTO THIS RAIL — its out face is `rot`; this is
 * the travel direction it receives along, and when the two differ the
 * rail is a CORNER and draws (and carries) a quarter-curve. A feeder is
 * anything that hands parts across the shared face: an emitter pointing
 * at us, a bridge whose deck lands on us, or a lane we branched off. A
 * straight feeder always wins over a cornering one — a side-merge into a
 * through lane bends the MERGING rail, not the lane. Bridges themselves
 * are always straight underneath: the deck needs a level rail to cross.
 */
export function beltEntry(unit: Unit): Rot {
  if (unit.type !== 'belt' || unit.over !== undefined) return unit.rot;
  return beltEntryAt(unit.i, unit.j, unit.rot);
}

/** The same question asked of a rail that ISN'T THERE YET — the ghost
 *  wears the curve it would land with, so what you see is what you get. */
export function beltEntryAt(i: number, j: number, rot: Rot): Rot {
  let corner: Rot | null = null;
  for (let r = 0; r < 4; r++) {
    const d = r as Rot;
    if (d === ((rot + 2) % 4)) continue; // nothing curves back on itself
    const dd = DIRS[d];
    const n = unitAtCell(i - dd.di, j - dd.dj);
    if (!n) continue;
    const feeds =
      (emits(n) && n.rot === d) ||
      (n.type === 'belt' && n.over === d) ||
      // …or the piece IS a branch: standing beside a lane, pointing away.
      (d === rot && n.type === 'belt' && n.over === undefined && n.rot % 2 !== rot % 2);
    if (!feeds) continue;
    if (d === rot) return rot; // straight wins
    if (corner === null) corner = d;
  }
  return corner ?? rot;
}

/**
 * THE JOIN LAW's other half: a rail standing beside lane `unit`,
 * perpendicular to it and pointing AWAY, has JOINED ON — it is a branch,
 * and the lane deals it every other part (see the tap in simTick).
 * Bridges carry a second lane across their cell already; their laterals
 * are that deck's own doorway, so a crossing never doubles as a fork.
 */
export function beltBranches(unit: Unit): Unit[] {
  if (unit.type !== 'belt' || unit.over !== undefined) return [];
  const out: Unit[] = [];
  for (const side of [1, 3] as const) {
    const d = ((unit.rot + side) % 4) as Rot;
    const dd = DIRS[d];
    const n = unitAtCell(unit.i + dd.di, unit.j + dd.dj);
    if (n && n.type === 'belt' && n.rot === d) out.push(n);
  }
  return out;
}

/** Can a crossing lane travelling `rot` bridge over this standing unit?
 *  Only a straight, not-yet-bridged rail at right angles takes a deck. */
export function canBridge(standing: Unit, rot: Rot): boolean {
  return (
    standing.type === 'belt' &&
    standing.over === undefined &&
    standing.rot % 2 !== rot % 2 &&
    beltEntry(standing) === standing.rot
  );
}

/** Lay the deck: the standing rail becomes a crossing, carrying `rot`'s
 *  lane straight over its own. The one mutation that adds plant without
 *  claiming a cell. */
export function layBridge(standing: Unit, rot: Rot): boolean {
  if (!canBridge(standing, rot)) return false;
  standing.over = rot;
  plant.generation++;
  return true;
}

/**
 * THE FACING IS THE GAME'S PROBLEM, NOT YOURS. Given where your hand
 * points, pick the facing that actually connects: a rail turns to feed
 * the thing in front of it, a maker turns its chute toward a rail, a
 * combiner turns so its two ports face the lines that would fill them.
 * Your aim only breaks ties — which is exactly what a fitter would do
 * with a piece of plant already surrounded by other plant.
 */
export function bestRot(type: UnitType, i: number, j: number, handRot: Rot): Rot {
  // Sinks don't care which way they face; keep the hand honest. (The VAT
  // has no out face at all — what comes out of it walks.)
  if (
    type === 'dock' ||
    type === 'chest' ||
    type === 'post' ||
    type === 'vat' ||
    isWeapon(type) ||
    type === 'wall'
  ) {
    return handRot;
  }
  let best = handRot;
  let bestScore = -Infinity;
  for (let r = 0; r < 4; r++) {
    const rot = r as Rot;
    // A real link ahead is decisive; your aim beats everything else; a
    // line continuing from behind is only a gentle nudge. (Get that
    // order wrong and the piece fights you: an early cut let "carry on
    // straight" outrank the hand, so a rail laid off the back of a
    // maker refused to turn toward the dock.)
    let score = rot === handRot ? 1.5 : 0;
    const d = DIRS[rot];
    const ahead = unitAtCell(i + d.di, j + d.dj);
    const b = DIRS[((rot + 2) % 4) as Rot];
    const behind = unitAtCell(i + b.di, j + b.dj);
    // A RAIL FACING AWAY IS A JOIN TOO: away from a lane it taps half the
    // payload; away from a chest or the bank it PULLS. Scored under the
    // link-ahead 3 so a certain feed still wins cold, but over it once
    // the hand's own 1.5 says "away" — your aim picks which way the door
    // swings, exactly as the law promises.
    const joinBehind =
      type === 'belt' &&
      behind !== undefined &&
      ((behind.type === 'belt' && behind.over === undefined && behind.rot % 2 !== rot % 2) ||
        behind.type === 'chest' ||
        behind.type === 'dock');
    if (joinBehind) score += 2.5;
    // A dead face ahead normally counts against a rot — but not on a
    // join: an out-rail's purpose sits BEHIND it, and a hauled lane will
    // re-aim the head anyway. Without the waiver, pulling from the bank
    // toward standing plant was unreachable by hand.
    if (ahead) score += canLink(ahead, rot) ? 3 : joinBehind ? 0 : -1.5;
    if (behind && emits(behind) && behind.rot === rot) score += 0.75;
    if (type === 'combiner') {
      for (const port of [0, 1] as const) {
        const pd = DIRS[((rot + (port === 0 ? 3 : 1)) % 4) as Rot];
        const side = unitAtCell(i + pd.di, j + pd.dj);
        if (side && emits(side)) score += 1.5;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = rot;
    }
  }
  return best;
}

/* ── THE HAUL ──────────────────────────────────────────────────────────────
 * A rail run is PULLED, not stamped. You stand one rail and hold on; the
 * run ratchets out of it toward wherever you point, the way a tube
 * ratchets out of a wall. Everything about the shape of that run lives
 * here, so the ghost you drag and the rails that land can never disagree.
 *
 * AND IT BENDS. The first cut walked a plain Manhattan L and STOPPED
 * dead the moment it met anything — which meant that on a floor with any
 * plant on it at all (i.e. any floor worth laying a lane across) half
 * your hauls fetched up against the side of a maker and died. A lane
 * that will not go round a box is not a lane.
 *
 * So the route is a real search now: Dijkstra over (cell, direction),
 * one unit per step and TURN_COST per corner. The turn penalty is what
 * keeps a clear floor honest — with nothing in the way it still lays the
 * single-cornered L a hand would draw — while an obstructed floor gets a
 * lane that goes AROUND, hugging the straight line and bending only
 * where it has to. Posts stay what they always were: waypoints the run
 * visits in order, and the sticks are spent as the rail passes.
 */

/** A cell on a haul, in order, with the way the rail there must face.
 *  `bridge` marks a cell where a rail already stands ACROSS the run:
 *  laying the haul puts a deck over it rather than a rail on it. */
export interface HaulStep {
  i: number;
  j: number;
  rot: Rot;
  bridge?: boolean;
}

/** Corners cost. High enough that a clear floor gets one bend and not a
 *  staircase; low enough that going round a box never loses to giving
 *  up. (It cannot be free: every monotone Manhattan path is the same
 *  length, so with no penalty the search would pick an arbitrary one and
 *  the lane would writhe as you dragged.) */
const TURN_COST = 1.6;

/** Can a hauled rail stand on this cell? Posts are passable — the whole
 *  point of a stick is that the run goes THROUGH it and takes its place. */
function haulPassable(i: number, j: number): boolean {
  if (!cellInFloor(i, j)) return false;
  const standing = unitAtCell(i, j);
  return !standing || standing.type === 'post';
}

const KEY = (i: number, j: number): number => (i + 512) * 4096 + (j + 512);

/**
 * One leg of a haul: the cheapest bending path from `from` to `to`,
 * EXCLUDING `from` and including `to`. `blocked` is the set of cells
 * already claimed by earlier legs (so a route can never cross itself),
 * `enter` the direction the run is already travelling in (−1 = the first
 * leg, where any first step is free of a turn penalty).
 *
 * Search space is clamped to the box between the two ends, opened out by
 * SEARCH_PAD, so a haul across a small floor never walks the whole
 * unbounded lattice looking for a way round.
 */
const SEARCH_PAD = 6;

function routeLeg(
  from: Cell,
  to: Cell,
  blocked: Set<number>,
  enter: Rot | -1,
  limit: number,
): { cells: Cell[]; exit: Rot } | null {
  if (from.i === to.i && from.j === to.j) return { cells: [], exit: enter === -1 ? 0 : enter };
  const lo = { i: Math.min(from.i, to.i) - SEARCH_PAD, j: Math.min(from.j, to.j) - SEARCH_PAD };
  const hi = { i: Math.max(from.i, to.i) + SEARCH_PAD, j: Math.max(from.j, to.j) + SEARCH_PAD };

  interface Node {
    i: number;
    j: number;
    rot: Rot;
    cost: number;
    steps: number;
    prev: Node | null;
    /** Standing on a rail we would bridge — the next step must carry
     *  straight on (a deck has no corners) and cannot be the last. */
    crossing?: boolean;
  }
  const seen = new Map<number, number>(); // (cell,rot) → best cost
  // A tiny sorted frontier: the floors this runs on are at most a few
  // hundred cells, so an array with a linear extract-min is faster than
  // any heap once you count the allocations.
  const open: Node[] = [];
  const push = (n: Node): void => {
    const k = KEY(n.i, n.j) * 4 + n.rot;
    const was = seen.get(k);
    if (was !== undefined && was <= n.cost) return;
    seen.set(k, n.cost);
    open.push(n);
  };
  for (let r = 0; r < 4; r++) {
    const rot = r as Rot;
    if (enter !== -1 && rot !== enter) continue;
    push({ i: from.i, j: from.j, rot, cost: 0, steps: 0, prev: null });
  }
  if (enter === -1) {
    // No history: seed one zero-cost node per heading off the anchor.
    seen.clear();
    open.length = 0;
    for (let r = 0; r < 4; r++) {
      open.push({ i: from.i, j: from.j, rot: r as Rot, cost: 0, steps: 0, prev: null });
      seen.set(KEY(from.i, from.j) * 4 + r, 0);
    }
  }

  let expansions = 0;
  while (open.length && expansions < FACTORY.routeBudget) {
    let best = 0;
    for (let n = 1; n < open.length; n++) if (open[n].cost < open[best].cost) best = n;
    const node = open.splice(best, 1)[0];
    expansions++;
    if (node.i === to.i && node.j === to.j) {
      const cells: Cell[] = [];
      for (let n: Node | null = node; n && n.prev; n = n.prev) cells.unshift({ i: n.i, j: n.j });
      return { cells, exit: node.rot };
    }
    if (node.steps >= limit) continue;
    for (let r = 0; r < 4; r++) {
      const rot = r as Rot;
      // A deck has no corners: off a crossing, the run carries straight on.
      if (node.crossing && rot !== node.rot) continue;
      const d = DIRS[rot];
      const ni = node.i + d.di;
      const nj = node.j + d.dj;
      if (ni < lo.i || ni > hi.i || nj < lo.j || nj > hi.j) continue;
      if (blocked.has(KEY(ni, nj))) continue;
      // A cell a rail already stands on is still open ONE way: straight
      // across it, over the top — the haul lays a BRIDGE there. It costs
      // a little over a clear cell so an open floor is still preferred,
      // and far less than walking round the lane.
      let crossing = false;
      if (!haulPassable(ni, nj)) {
        const standing = unitAtCell(ni, nj);
        if (!standing || !canBridge(standing, rot)) continue;
        if (ni === to.i && nj === to.j) continue; // a run can't END mid-deck
        crossing = true;
      }
      const turn = node.prev === null && enter === -1 ? 0 : rot === node.rot ? 0 : TURN_COST;
      push({
        i: ni,
        j: nj,
        rot,
        cost: node.cost + 1 + turn + (crossing ? 0.4 : 0),
        steps: node.steps + 1,
        prev: node,
        crossing,
      });
    }
  }
  return null;
}

/** The nearest passable cell beside a blocked one, preferring the side
 *  the run is coming from — where a lane ENDS when it has arrived at
 *  something it cannot stand on (the bank, a maker, a chest). */
function approachCell(target: Cell, from: Cell, blocked: Set<number>): Cell | null {
  let best: Cell | null = null;
  let bestD = Infinity;
  for (let r = 0; r < 4; r++) {
    const d = DIRS[r as Rot];
    const c = { i: target.i + d.di, j: target.j + d.dj };
    if (blocked.has(KEY(c.i, c.j)) || !haulPassable(c.i, c.j)) continue;
    const dist = Math.abs(c.i - from.i) + Math.abs(c.j - from.j);
    if (dist < bestD) {
      bestD = dist;
      best = c;
    }
  }
  return best;
}

/**
 * THE ROUTE a haul from `anchor` toward `to` would take.
 *
 * Bends round standing plant; visits every POST between the two ends, in
 * order, nearest first; and when the point you are aiming at is itself
 * occupied, arrives BESIDE it with the last rail pointing in — so
 * dragging a lane onto the bank is how you connect to the bank, and
 * dragging one onto a maker still just stops beside it (canLink decides
 * whether that join means anything, not this).
 */
export function haulRoute(anchor: Cell, to: Cell, limit: number): HaulStep[] {
  // The catchment: the box between the two ends, opened out by
  // UNITS.pull.postReach so a stick can sit OFF the straight line —
  // which is the only place a stick is any use.
  const reach = UNITS.pull.postReach;
  const lo = { i: Math.min(anchor.i, to.i) - reach, j: Math.min(anchor.j, to.j) - reach };
  const hi = { i: Math.max(anchor.i, to.i) + reach, j: Math.max(anchor.j, to.j) + reach };
  const dist = (c: Cell): number => Math.abs(c.i - anchor.i) + Math.abs(c.j - anchor.j);
  const posts: Cell[] = plant.units
    .filter((u) => u.type === 'post' && u.i >= lo.i && u.i <= hi.i && u.j >= lo.j && u.j <= hi.j)
    .map((u) => ({ i: u.i, j: u.j }))
    .sort((a, b) => dist(a) - dist(b));

  const blocked = new Set<number>([KEY(anchor.i, anchor.j)]);
  const cells: Cell[] = [];
  let from: Cell = { i: anchor.i, j: anchor.j };
  let heading: Rot | -1 = -1;
  /** The occupied cell the finished run should point INTO, if any. */
  let aimAt: Cell | null = null;

  for (const [n, way] of [...posts, to].entries()) {
    const last = n === posts.length;
    if (way.i === from.i && way.j === from.j) continue;
    let goal: Cell | null = way;
    if (!haulPassable(way.i, way.j) || blocked.has(KEY(way.i, way.j))) {
      // Arrived at something you cannot stand on. On the LAST waypoint
      // that is the whole point (you dragged the lane onto the bank);
      // on a post it means the stick has already been consumed by this
      // very route, and the leg is simply skipped.
      if (!last) continue;
      goal = approachCell(way, from, blocked);
      aimAt = way;
      if (!goal) break;
    }
    const leg = routeLeg(from, goal, blocked, heading, limit - cells.length);
    if (!leg) {
      // Nowhere to go — stop with what we have rather than teleporting.
      if (last) aimAt = null;
      break;
    }
    for (const c of leg.cells) {
      cells.push(c);
      blocked.add(KEY(c.i, c.j));
    }
    heading = leg.exit;
    from = goal;
    if (cells.length >= limit) break;
  }

  const steps: HaulStep[] = [];
  for (let n = 0; n < cells.length && steps.length < limit; n++) {
    const c = cells[n];
    const next = cells[n + 1] ?? (n === cells.length - 1 ? aimAt : null);
    const prev: Cell = n === 0 ? anchor : cells[n - 1];
    const step: HaulStep = { i: c.i, j: c.j, rot: next ? dirTo(c, next) : dirTo(prev, c) };
    // A rail standing on a route cell means the leg CROSSED it (that is
    // the only way the search steps onto one): the haul decks it.
    if (unitAtCell(c.i, c.j)?.type === 'belt') step.bridge = true;
    steps.push(step);
  }
  return steps;
}

/** The rot that walks from `a` to the adjacent-ish `b`.
 *  DIRS is [ −j, +i, +j, −i ] — read it off the table, don't guess it. */
function dirTo(a: Cell, b: Cell): Rot {
  if (Math.abs(b.i - a.i) >= Math.abs(b.j - a.j)) return b.i > a.i ? 1 : 3;
  return b.j > a.j ? 2 : 0;
}

/** Lay a hauled run. Posts on the route are spent — the stick marked the
 *  corner and the rail takes its place — and a rail lying ACROSS the run
 *  gets a deck bridged over it. Returns how many pieces landed. */
export function layHaul(anchor: Cell, steps: HaulStep[], type: 'belt' | 'wall' = 'belt'): number {
  let laid = 0;
  for (const step of steps) {
    const standing = unitAtCell(step.i, step.j);
    if (standing) {
      if (type === 'belt' && standing.type === 'belt' && canBridge(standing, step.rot)) {
        layBridge(standing, step.rot);
        laid++;
        continue;
      }
      if (standing.type !== 'post') break;
      removeUnit(standing);
    }
    if (!placeUnit(type, step.i, step.j, step.rot)) break;
    laid++;
  }
  if (type === 'wall') return laid;
  // The anchor itself now has somewhere to send: point it down the run.
  const first = steps[0];
  const head = unitAtCell(anchor.i, anchor.j);
  if (laid > 0 && first && head && head.type === 'belt' && head.over === undefined) {
    head.rot = dirTo(anchor, { i: first.i, j: first.j });
    plant.generation++; // the mesh has to hear about a rot set after the fact
  }
  return laid;
}

/** Where a unit may stand: null when the cell refuses it. (Plant used to
 *  be split into "wall plant" that could only bolt to the site's edge —
 *  playtest hated it, and rightly: it turned every dock and combiner
 *  into a hunt for a legal cell. Everything stands anywhere now.) */
export function placementFor(type: UnitType, i: number, j: number, rot: Rot): Rot | null {
  void type;
  return cellInFloor(i, j) ? rot : null;
}

/**
 * Stand a unit on a cell. The catalogue and the lattice both get a vote.
 *
 * AND THE CHUTE FINDS THE LANE. bestRot faces a piece as it lands, which
 * is right for everything laid INTO an existing floor — but the very
 * first machine on a sheet is laid into an empty one, and it keeps
 * whatever way your hand happened to be pointing forever. Sheet 1 stands
 * a maker in an open room; sheet 2 rails past it; and the maker went on
 * stamping gears into thin air with no way to fix it short of deleting
 * it (playtest found exactly this, and blamed the rails).
 *
 * So when a part-taking piece lands beside a MAKER that has nowhere to
 * send, the maker turns its chute onto it. Only makers, only when they
 * are feeding nothing at all, and only toward something that can
 * actually take what they make — the same "the facing is our problem,
 * not yours" law bestRot runs on, applied one move later.
 */
/**
 * Where nothing is built: on a lane, and in THE CLEARING round the core
 * (SIEGE.coreClear cells every way). Every lane ends at the core, so a
 * ring of guns hugging it covered all of them at once and the siege was
 * won by building in one place; the clearing sends you out along the
 * lanes to meet them.
 */
export function noBuild(i: number, j: number): boolean {
  const cells = plant.siege.laneCells;
  if (cells.size > 0 && cells.has((i + 4096) * 8192 + (j + 4096))) return true;
  const core = dockUnit();
  return Boolean(core && Math.max(Math.abs(i - core.i), Math.abs(j - core.j)) <= SIEGE.coreClear);
}

export function placeUnit(type: UnitType, i: number, j: number, rot: Rot): Unit | null {
  if (!unitAvailable(type)) return null;
  if (type === 'dock' && dockUnit()) return null;
  const facing = placementFor(type, i, j, rot);
  if (facing === null) return null;
  // THE BILL. Defences are paid for out of the bank, and checked BEFORE
  // the lattice is asked so a refusal claims nothing.
  if (!canAfford(type)) return null;
  rot = facing;
  // Nothing stands on a lane.
  if (type !== 'dock' && noBuild(i, j)) return null;
  const id = plant.nextUnit;
  if (!occupy(i, j, id)) return null;
  plant.nextUnit++;
  const spent = payFor(type);
  const hp = SIEGE.hp[type] * hpFactor(type);
  const unit: Unit = {
    id,
    type,
    i,
    j,
    rot,
    craftT: -1,
    ports: [-1, -1],
    tap: 0,
    hp,
    maxHp: hp,
    hurtT: 99,
  };
  if (isWeapon(type)) {
    unit.level = 1;
    unit.spent = spent;
    unit.cool = 0;
    unit.firedT = 99;
    unit.yaw = Math.atan2(DIRS[rot].di, DIRS[rot].dj);
  }
  plant.units.push(unit);
  faceStrandedMakers(unit);
  plant.generation++;
  return unit;
}

/* ── THE BILL — what a defence costs, out of the bank ──────────────────── */

/** What a unit costs to stand, in COINS (the core is free). */
export function unitCost(type: UnitType): number {
  if (plant.mode === 'idle' || !isWeapon(type)) return 0;
  return WEAPONS[type as WeaponId].cost;
}

export function canAfford(type: UnitType, times = 1): boolean {
  return plant.siege.coins >= unitCost(type) * times;
}

function payFor(type: UnitType): number {
  const cost = unitCost(type);
  plant.siege.coins -= cost;
  return cost;
}

/** A tower taken off the floor returns a share of what went into it. */
export function refundUnit(unit: Unit): void {
  plant.siege.coins += Math.round((unit.spent ?? 0) * SIEGE.sellBack);
}

/** The arsenal: plant that fights. */
export function isWeapon(type: UnitType): boolean {
  return type === 'turret' || type === 'mortar' || type === 'tesla' || type === 'flamer' || type === 'hammer';
}

/** Turn any adjacent maker that is sending nowhere onto `unit`. */
function faceStrandedMakers(unit: Unit): void {
  for (let r = 0; r < 4; r++) {
    const d = DIRS[r as Rot];
    const neighbour = unitAtCell(unit.i + d.di, unit.j + d.dj);
    if (!neighbour || neighbour.type !== 'maker') continue;
    if (linkAhead(neighbour)) continue; // it already has somewhere to go
    const towards = ((r + 2) % 4) as Rot; // from the neighbour back to us
    if (!canLink(unit, towards)) continue;
    neighbour.rot = towards;
  }
}

/** Unbolt a unit: its seated run retracts, its parts spill loose. */
export function removeUnit(unit: Unit): void {
  const run = runSeatedAt(unit.id);
  if (run) retractRun(run);
  const spill = new Vector3();
  for (const part of plant.parts) {
    if (
      (part.at.kind === 'chute' || part.at.kind === 'port' || part.at.kind === 'chest' || part.at.kind === 'belt') &&
      part.at.unit === unit.id
    ) {
      partPose(part, spill);
      part.at = { kind: 'loose', x: spill.x, y: 0.05, z: spill.z };
      part.p = 0;
    }
  }
  vacate(unit.i, unit.j);
  plant.units.splice(plant.units.indexOf(unit), 1);
  plant.generation++;
}

/**
 * UNPLUG — the tube telescopes home and the stub waits on the spout again.
 *
 * There are three ways to break a seal now (the tug with both hands, the
 * box panel's UNPLUG, the wrecking bar taking the whole box) and they all
 * come through here, so the hum stops and the iris shuts exactly once
 * however it happened. The old Ⓑ path called this directly and left a
 * unit humming at a tube that was no longer there.
 */
export function retractRun(run: (typeof plant.runs)[number]): void {
  const was = run.targetUnit;
  run.phase = 'retract';
  run.phaseT = 0;
  run.held = false;
  run.magnet = false;
  run.strain = 0;
  run.targetUnit = -1;
  run.front = -1;
  // A vat that loses its line stops brewing where it stands: come back,
  // plug it in again, and the level carries on from there.
  if (was >= 0) plant.events.push({ kind: 'unseat', unit: was, side: run.side, key: `${run.side}:${run.spout}` });
}

/** One tick of progress on the live sheet, and the stamp when it fills.
 *  Every target kind funnels through here so "the sheet is done" is
 *  decided in exactly one place. */
function scoreGoal(): void {
  const spec = orderSpec();
  if (!spec) return;
  plant.count++;
  if (plant.count >= spec.goal) plant.events.push({ kind: 'complete', order: plant.orderIndex });
}

/** A part lands in the bank: the sheet counts it, or the vault does. */
export function deliverPart(part: Part): void {
  const spec = orderSpec();
  plant.parts.splice(plant.parts.indexOf(part), 1);
  if (
    spec &&
    spec.target.kind === 'item' &&
    spec.target.item === part.item &&
    plant.count < spec.goal
  ) {
    plant.events.push({ kind: 'deliver', item: part.item });
    scoreGoal();
  } else {
    plant.bank[part.item] = (plant.bank[part.item] ?? 0) + 1;
    plant.events.push({ kind: 'bank', item: part.item });
  }
}

function spawnPart(item: ItemId, unit: Unit): void {
  const slot = chuteParts(unit.id).length;
  plant.parts.push({ id: plant.nextPart++, item, at: { kind: 'chute', unit: unit.id, slot }, p: 0 });
  plant.events.push({ kind: 'craft', unit: unit.id, item });
  // SHEET ONE COUNTS STAMPS, NOT DELIVERIES. It has to: the first sheet
  // in the book is about one maker and one tube, and there is no bank on
  // the floor yet to deliver anything into.
  const spec = orderSpec();
  if (spec && spec.target.kind === 'craft' && spec.target.item === item && plant.count < spec.goal) {
    scoreGoal();
  }
}

/* ── the tick ───────────────────────────────────────────────────────────── */

export function simTick(dt: number): void {
  const spec = orderSpec();

  // THE VAT DRINKS. The fourth manifold pouring into a vat is the only
  // thing in the shop that makes no part at all — it fills a tank, and
  // when the tank is full, THE GOOP. A vat fed anything else just sits
  // there wearing a puddle of the wrong colour.
  for (const run of plant.runs) {
    if (run.phase !== 'flowing') continue;
    const target = unitById(run.targetUnit);
    if (target?.type !== 'vat' || run.line.id !== 'pearl') continue;
    if (plant.goop === 'none') plant.goop = 'brewing';
    if (plant.goop !== 'brewing') continue;
    plant.goopUnit = target.id;
    plant.brewT = Math.min(UNITS.vat.brewS, plant.brewT + dt);
    if (plant.brewT >= UNITS.vat.brewS) {
      plant.goop = 'born';
      plant.events.push({ kind: 'goop', unit: target.id });
      if (spec?.target.kind === 'brew' && plant.count < spec.goal) scoreGoal();
    }
  }

  // MAKERS drink and stamp. QUICK BOXES (a paid fitting) shortens every
  // craft. A maker handed PEARL makes nothing — MAKES has no entry for
  // the fourth manifold, and it is the vat's line, not the shop's.
  const makerS = FACTORY.makerS * craftFactor();
  const combinerS = FACTORY.combinerS * craftFactor();
  for (const unit of plant.units) {
    if (unit.type !== 'maker') continue;
    const run = runSeatedAt(unit.id);
    const makes = run ? MAKES[run.line.id] : undefined;
    const supplied = run?.phase === 'flowing' && makes !== undefined;
    const space = chuteParts(unit.id).length < FACTORY.chuteSlots;
    if (unit.craftT < 0 && supplied && space) unit.craftT = 0;
    else if (unit.craftT >= 0) {
      if (supplied || unit.craftT > 0) unit.craftT += dt;
      if (unit.craftT >= makerS) {
        if (space && makes) {
          spawnPart(makes, unit);
          unit.craftT = supplied ? 0 : -1;
        } else {
          unit.craftT = makerS; // done, waiting on the chute
        }
      }
    }
  }

  // COMBINERS fit two parts into one deeper one.
  for (const unit of plant.units) {
    if (unit.type !== 'combiner') continue;
    const a = unit.ports[0] >= 0 ? plant.parts.find((p) => p.id === unit.ports[0]) : undefined;
    const b = unit.ports[1] >= 0 ? plant.parts.find((p) => p.id === unit.ports[1]) : undefined;
    const out = a && b ? COMBINES[combineKey(a.item, b.item)] : undefined;
    const space = chuteParts(unit.id).length < FACTORY.chuteSlots;
    if (unit.craftT < 0 && out && space) unit.craftT = 0;
    else if (unit.craftT >= 0) {
      unit.craftT += dt;
      if (unit.craftT >= combinerS) {
        if (out && space && a && b) {
          plant.parts.splice(plant.parts.indexOf(a), 1);
          plant.parts.splice(plant.parts.indexOf(b), 1);
          unit.ports[0] = -1;
          unit.ports[1] = -1;
          spawnPart(out, unit);
          unit.craftT = -1;
        } else {
          unit.craftT = combinerS;
        }
      }
    }
  }

  // CHUTES push their front part into whatever stands ahead.
  for (const unit of plant.units) {
    if (unit.type !== 'maker' && unit.type !== 'combiner') continue;
    const queue = chuteParts(unit.id);
    const front = queue[0];
    if (!front) continue;
    const dir = DIRS[unit.rot];
    const ahead = unitAtCell(unit.i + dir.di, unit.j + dir.dj);
    if (ahead && acceptPart(front, ahead, unit.rot)) {
      // Re-pack the queue behind it.
      for (const p of queue.slice(1)) (p.at as { slot: number }).slot -= 1;
    }
  }

  // BELTS carry (BELT PACE quickens them), and hand off at each end. A
  // bridged cell runs two lanes — the rail's own and the deck over it —
  // and each carries one part on its own heading.
  const railSpeed = FACTORY.railSpeed * railFactor();
  for (const part of [...plant.parts]) {
    if (part.at.kind !== 'belt') continue;
    const belt = unitById(part.at.unit);
    if (!belt) continue;
    const onDeck = part.at.over === true && belt.over !== undefined;
    part.p += (dt * railSpeed) / CELL;
    if (part.p < 1) continue;
    part.p = 1;
    const travel = onDeck ? belt.over! : belt.rot;
    const dir = DIRS[travel];
    const ahead = unitAtCell(belt.i + dir.di, belt.j + dir.dj);
    if (onDeck) {
      if (ahead) acceptPart(part, ahead, travel);
      continue;
    }
    // THE TAP. A rail with branches deals round-robin — ahead, then each
    // joined lane in turn — so one branch takes exactly half the payload.
    // A refused output passes its turn rather than damming the lane.
    const outs: Array<{ into: Unit; travel: Rot }> = [];
    if (ahead) outs.push({ into: ahead, travel });
    for (const b of beltBranches(belt)) outs.push({ into: b, travel: b.rot });
    for (let k = 0; k < outs.length; k++) {
      const pick = outs[(belt.tap + k) % outs.length];
      if (acceptPart(part, pick.into, pick.travel)) {
        belt.tap = (belt.tap + k + 1) % outs.length;
        break;
      }
    }
  }

  // OUT-RAILS. The container's door swings both ways: a rail pointed
  // INTO a chest or the bank feeds it, and a rail whose back sits against
  // one, pointing AWAY, PULLS — the chest from the top of its stack, the
  // bank whichever part it holds deepest. One part per free rail, so the
  // lane's own pace is the drain's pace.
  for (const unit of plant.units) {
    if (unit.type !== 'belt' || unit.over !== undefined) continue;
    if (beltPart(unit.id)) continue;
    const b = DIRS[((unit.rot + 2) % 4) as Rot];
    const src = unitAtCell(unit.i + b.di, unit.j + b.dj);
    if (!src) continue;
    if (src.type === 'chest') {
      const stack = chestParts(src.id);
      const top = stack[stack.length - 1];
      if (!top) continue;
      top.at = { kind: 'belt', unit: unit.id };
      top.p = 0;
    } else if (src.type === 'dock') {
      const item = unbank();
      if (!item) continue;
      plant.parts.push({
        id: plant.nextPart++,
        item,
        at: { kind: 'belt', unit: unit.id },
        p: 0,
      });
    }
  }
}

/** Draw one part back OUT of the bank — the deepest-stocked item, so a
 *  drain rail levels the vault instead of stripping one shelf bare. */
function unbank(): ItemId | null {
  let best: ItemId | null = null;
  let deepest = 0;
  for (const [item, count] of Object.entries(plant.bank) as Array<[ItemId, number | undefined]>) {
    if ((count ?? 0) > deepest) {
      deepest = count ?? 0;
      best = item;
    }
  }
  if (!best) return null;
  if (deepest <= 1) delete plant.bank[best];
  else plant.bank[best] = deepest - 1;
  return best;
}

/** Can `into` take this part arriving FROM travel direction `travel`?
 *  Performs the transfer when it can. */
function acceptPart(part: Part, into: Unit, travel: Rot): boolean {
  if (into.type === 'belt') {
    // A crossing routes by axis: traffic running the deck's way rides
    // OVER; traffic running the rail's way rides the rail. Two lanes,
    // one cell, one part each.
    if (into.over !== undefined && travel % 2 === into.over % 2) {
      if (beltPart(into.id, true)) return false;
      part.at = { kind: 'belt', unit: into.id, over: true };
      part.p = 0;
      return true;
    }
    if (beltPart(into.id)) return false;
    part.at = { kind: 'belt', unit: into.id };
    part.p = 0;
    return true;
  }
  if (into.type === 'dock') {
    deliverPart(part);
    return true;
  }
  if (into.type === 'chest') {
    const held = chestParts(into.id);
    if (held.length >= FACTORY.chestCap + chestBonus()) return false;
    part.at = { kind: 'chest', unit: into.id, index: held.length };
    return true;
  }
  if (into.type === 'combiner') {
    // Only the two SIDE faces are ports: the part travels `travel`, so it
    // enters through the face opposite — valid when that face sits left
    // or right of the combiner's OUT.
    const enterFrom = ((travel + 2) % 4) as Rot; // the face it knocks on
    let port: 0 | 1 | null = null;
    if (enterFrom === portDir(into, 0)) port = 0;
    else if (enterFrom === portDir(into, 1)) port = 1;
    if (port === null) return false;
    if (into.ports[port] >= 0) return false;
    into.ports[port] = part.id;
    part.at = { kind: 'port', unit: into.id, port };
    return true;
  }
  return false; // makers drink fluid, not parts
}
