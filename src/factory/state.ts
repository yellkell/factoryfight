/**
 * The plant — the factory's shared mutable state, one plain singleton
 * (the `site` pattern, for the shop floor). Every factory system reads
 * and writes this; the SIM (factory/sim.ts) is the only thing that
 * advances it, and the sim never touches a mesh or a speaker — it
 * pushes EVENTS and FactorySystem plays them.
 *
 * A shift's plant lives exactly as long as the shift: STARTING an order
 * from the board deals a fresh floor, completing a sheet posts the next
 * one into the SAME plant (the factory persists and grows — law 9), and
 * DOWN TOOLS clears it.
 */

import { Horde } from './horde.js';
import type { Lane } from './lanes.js';
import { Vector3 } from 'three';
import {
  FACTORY,
  ORDERS,
  TUBE,
  type EnemyId,
  type ItemId,
  type LineId,
  type WeaponId,
  type LineSpec,
  type OrderSpec,
  type UnitType,
} from '../config.js';
import type { FloorSide } from '../floor/plan.js';

/** Out-direction index: 0 = −Z, 1 = +X, 2 = +Z, 3 = −X (plan view). */
export type Rot = 0 | 1 | 2 | 3;
export const DIRS: ReadonlyArray<{ di: number; dj: number }> = [
  { di: 0, dj: -1 },
  { di: 1, dj: 0 },
  { di: 0, dj: 1 },
  { di: -1, dj: 0 },
];

export interface Unit {
  id: number;
  type: UnitType;
  i: number;
  j: number;
  /** The unit's OUT face (chute / belt travel). The gland lives on the
   *  opposite face; a combiner's ports on the two sides. */
  rot: Rot;
  /** Maker/combiner: seconds into the current craft (−1 = not crafting). */
  craftT: number;
  /** Combiner in-ports: a part id or −1, port 0 = left of OUT, 1 = right. */
  ports: [number, number];
  /** THE BRIDGE. A rail crossed by another lane carries a second, raised
   *  lane straight over its own: `over` is that deck's travel direction,
   *  always perpendicular to `rot`. Undefined on everything that isn't a
   *  crossing. */
  over?: Rot;
  /** THE TAP's cursor. A rail with branch rails hanging off it deals its
   *  payload round-robin — ahead, then each branch — and this remembers
   *  whose turn is next. Meaningless (and 0) on everything else. */
  tap: number;
  /** THE SIEGE: what it takes to wreck this piece, and what it can take
   *  at full health. Everything on the floor can be chewed. */
  hp: number;
  maxHp: number;
  /** Seconds since the last bite landed on it (repair waits on this). */
  hurtT: number;
  /** WEAPONS: the cycle cooldown, where the head points (plan yaw,
   *  radians), and how long ago it last fired (drives recoil, the flame,
   *  the piston's stroke — the look of firing, kept with the gun). */
  cool?: number;
  yaw?: number;
  firedT?: number;
  /** The crawler it is tracking (horde uid; 0 = none), where it was last
   *  seen (an index hint), and seconds until it looks again. */
  tgt?: number;
  tgtAt?: number;
  look?: number;
  /** TOWER LEVEL (1–3), and every coin put into it (sells for a share). */
  level?: number;
  spent?: number;
}

/** One supply run off a feed's spout. Field names deliberately mirror
 *  RunState + RunHardware where the pull maths reads them — the factory
 *  pull is TubeSystem's verb, forked (see factory/pull.ts). */
export interface FactoryRun {
  side: FloorSide;
  /** Which of the pillar's spouts it leaves from (0 = the main boss,
   *  1 = the twin a cell along). Every feed pours from TWO now: one line
   *  for a maker and one for a flamer or a coil, without choosing. */
  spout: number;
  line: LineSpec;
  phase: 'pull' | 'seated' | 'flowing' | 'retract';
  /** The spout (A) and, once the magnet takes, the gland (B). */
  pointA: Vector3;
  normalA: Vector3;
  pointB: Vector3;
  normalB: Vector3;
  /** The unit whose gland holds (or is taking) the head; −1 = none. */
  targetUnit: number;
  extension: number;
  head: Vector3;
  front: number;
  phaseT: number;
  /** The pull's live state (was RunHardware's). */
  held: boolean;
  magnet: boolean;
  aim: Vector3;
  aimOk: boolean;
  droop: number;
  droopVel: number;
  lastDetent: number;
  lastSections: number;
  rattleCool: number;
  strainCool: number;
  /** Seconds this seated collar has been hauled past TUBE.unseatPull.
   *  Reaching unseatHoldS breaks the seal and puts the line in your
   *  hands; letting go early settles it back. */
  strain: number;
  /** The unit this line was just hauled OFF, and how long its gland
   *  stays spurned — long enough to carry the head clear without the
   *  magnet snapping it straight back on. */
  spurnUnit: number;
  spurnT: number;
  seatP: number;
  headVisual: Vector3;
  energy: number;
}

export type PartAt =
  | { kind: 'chute'; unit: number; slot: number }
  /** `over` = riding a bridge's raised deck rather than the rail itself. */
  | { kind: 'belt'; unit: number; over?: boolean }
  | { kind: 'port'; unit: number; port: 0 | 1 }
  | { kind: 'chest'; unit: number; index: number }
  | { kind: 'hand'; hand: 'left' | 'right' }
  | { kind: 'loose'; x: number; y: number; z: number };

export interface Part {
  id: number;
  item: ItemId;
  at: PartAt;
  /** Belt progress along the piece (0..1). */
  p: number;
}

/** One-shot happenings the sim reports and FactorySystem performs. */
export interface PlantEvent {
  kind:
    | 'craft'
    | 'deliver'
    | 'bank'
    | 'complete'
    | 'post'
    | 'feed-wake'
    /** A seated line came off a gland — by the tug, by the wrecking bar,
     *  or by the box panel's UNPLUG. One event, so the hum stops and the
     *  iris shuts exactly once however the line was freed. */
    | 'unseat'
    /** The vat is full: THE GOOP is born. */
    | 'goop'
    /** Something chewed this piece of plant to nothing. */
    | 'wreck';
  unit?: number;
  item?: ItemId;
  side?: FloorSide;
  /** The run's key ('far:1') where a feed has more than one spout. */
  key?: string;
  order?: number;
}

export type PlantMode =
  | 'idle' // no shift — the board is up
  | 'shop'; // THE SHOP is open: goals advance in place, and keep going
              // after the last one is filled (there is no separate free
              // play — playtest wanted one continuous session, not a
              // mode switch and a trip back to the menu)

export interface Plant {
  /** What kind of shift this is. */
  mode: PlantMode;
  /** Index into ORDERS of the live goal; −1 = every goal filled. */
  orderIndex: number;
  /** The book is done — the shop stays open with nothing left to ask. */
  goalsDone: boolean;
  /** Progress toward the live sheet: parts stamped, parts banked, or the
   *  one brew, depending on the sheet's target kind. */
  count: number;
  units: Unit[];
  nextUnit: number;
  runs: FactoryRun[];
  parts: Part[];
  nextPart: number;
  /** Which feeds are awake. The book wakes three of them; the fourth
   *  (PEARL, on the near side) waits for its gate to be paid for. */
  feedsAwake: Partial<Record<FloorSide, boolean>>;
  /** Build catalogue switched on by the sheets so far. */
  unitsAvailable: UnitType[];
  /** Banked surplus — every delivered non-target part. */
  bank: Partial<Record<ItemId, number>>;
  elapsedMs: number;
  /** Sim pace multiplier — the tools' fast-forward; play is 1. */
  timeScale: number;
  /** THE BREW — seconds of PEARL that have poured into the vat. The vat
   *  is the only machine in the shop that does not make a PART, so its
   *  progress lives here rather than in a chute. */
  brewT: number;
  /** Where the finale stands. 'none' until a vat is drinking green;
   *  'brewing' while the level comes up; 'born' the instant it is full
   *  (GoopSystem takes it from there); 'dancing' once it is on its feet;
   *  'done' when the card has been raised. */
  goop: 'none' | 'brewing' | 'born' | 'dancing' | 'done';
  /** The vat the goop came out of (−1 = none yet). */
  goopUnit: number;
  /** Bumped on any structural change; systems rebuild what they own. */
  generation: number;
  events: PlantEvent[];
  /** THE SIEGE — waves, enemies, shots, breaches (factory/siege.ts). */
  siege: Siege;
}

/* ── THE SIEGE ──────────────────────────────────────────────────────────── */

/** A stream of crawlers pouring out of one breach: `left` still to come,
 *  one every `gap` seconds, the next at `next` seconds into the wave. */
export interface Stream {
  enemy: EnemyId;
  left: number;
  gap: number;
  next: number;
  breach: number;
}

/** A patch of burning floor where a flame landed. */
export interface Fire {
  x: number;
  z: number;
  r: number;
  t: number;
  life: number;
}

export interface Breach {
  /** Where it opens: the foot of a real wall, in plant metres, and the
   *  wall's into-the-room normal. */
  x: number;
  z: number;
  nx: number;
  nz: number;
  /** Width of the wall it is in (plant m) — the crack is drawn to fit. */
  wall: number;
}

export interface Shot {
  id: number;
  weapon: WeaponId;
  /** Muzzle and (live) aim point, plant metres. */
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  /** The crawler it is chasing (horde uid; −1 = a spot on the floor),
   *  and where in the horde it was when fired (an index hint). */
  target: number;
  at?: number;
  /** What it does when it lands (the tower's level is in it). */
  damage?: number;
  t: number;
  dur: number;
}

/** One-shot happenings for SiegeSystem to draw and voice. */
export interface SiegeFx {
  kind:
    | 'fire'
    | 'hit'
    | 'kill'
    | 'blast'
    | 'arc'
    | 'beam'
    | 'frost'
    | 'bite'
    | 'core-hit'
    | 'breach'
    | 'horn'
    | 'clear'
    | 'victory'
    | 'fallen'
    | 'flame'
    | 'punch'
    | 'shell'
    | 'upgrade';
  x: number;
  y: number;
  z: number;
  weapon?: WeaponId;
  /** FLAME: the cone's direction (plan yaw) and reach. PUNCH: the ram's yaw. */
  yaw?: number;
  reach?: number;
  enemy?: EnemyId;
  unit?: number;
  /** ARC: every hop, as [x, y, z] triples. BEAM: start and end. */
  path?: number[];
  radius?: number;
}

/** core: the floor is waiting for its CORE — nothing else can stand and
 *  no clock runs until it does (the breaches are chosen relative to it). */
export type SiegePhase = 'off' | 'core' | 'build' | 'wave' | 'fallen';

export interface Siege {
  phase: SiegePhase;
  /** The wave being built for / fought (index; past WAVES = endless). */
  wave: number;
  /** Build phase: seconds left before the horn. */
  buildT: number;
  /** Wave phase: seconds since the horn. */
  waveT: number;
  /** The wave's streams, still pouring. */
  streams: Stream[];
  /** Every crawler on the floor (factory/horde.ts). */
  horde: Horde;
  shots: Shot[];
  nextShot: number;
  /** Burning floor. */
  fires: Fire[];
  /** Every breach the siege will ever open — one per lane, laid when the
   *  core lands. Only the first `open` of them pour this wave. */
  breaches: Breach[];
  /** The roads from each breach to the core (factory/lanes.ts). */
  lanes: Lane[];
  /** How many lanes are open this wave (the rest are sealed, but drawn). */
  open: number;
  /** Every lane cell — nothing can be built on a lane. */
  laneCells: Set<number>;
  kills: number;
  /** THE PURSE: coins, earned by kills and cleared waves, spent on towers. */
  coins: number;
  /** The ladder has been cleared at least once (endless from here). */
  won: boolean;
  fx: SiegeFx[];
}

export const plant: Plant = {
  mode: 'idle',
  orderIndex: -1,
  goalsDone: false,
  count: 0,
  units: [],
  nextUnit: 1,
  runs: [],
  parts: [],
  nextPart: 1,
  feedsAwake: {},
  unitsAvailable: [],
  bank: {},
  elapsedMs: 0,
  timeScale: 1,
  brewT: 0,
  goop: 'none',
  goopUnit: -1,
  generation: 0,
  events: [],
  siege: freshSiege(),
};

export function freshSiege(): Siege {
  return {
    phase: 'off',
    wave: 0,
    buildT: 0,
    waveT: 0,
    streams: [],
    horde: new Horde(),
    shots: [],
    nextShot: 1,
    fires: [],
    breaches: [],
    lanes: [],
    open: 0,
    laneCells: new Set(),
    kills: 0,
    coins: 0,
    won: false,
    fx: [],
  };
}

export function orderSpec(): OrderSpec | null {
  return plant.orderIndex >= 0 && plant.orderIndex < ORDERS.length
    ? ORDERS[plant.orderIndex]
    : null;
}

export function unitById(id: number): Unit | undefined {
  return plant.units.find((u) => u.id === id);
}

export function unitAtCell(i: number, j: number): Unit | undefined {
  return plant.units.find((u) => u.i === i && u.j === j);
}

export function partById(id: number): Part | undefined {
  return plant.parts.find((p) => p.id === id);
}

/** A run's name: its side and spout, 'far:0'. */
export function runKey(r: { side: FloorSide; spout: number }): string {
  return `${r.side}:${r.spout}`;
}

/** The run off a side's spout. Takes 'far' (the main spout) or 'far:1'. */
export function runForSide(ref: string): FactoryRun | undefined {
  const [side, n] = ref.split(':');
  const spout = Number(n ?? 0) || 0;
  return plant.runs.find((r) => r.side === side && r.spout === spout);
}

export function runSeatedAt(unitId: number): FactoryRun | undefined {
  return plant.runs.find(
    (r) => r.targetUnit === unitId && (r.phase === 'seated' || r.phase === 'flowing'),
  );
}

export function chuteParts(unitId: number): Part[] {
  return plant.parts
    .filter((p) => p.at.kind === 'chute' && p.at.unit === unitId)
    .sort((a, b) => (a.at as { slot: number }).slot - (b.at as { slot: number }).slot);
}

/** The part riding a rail's given lane — `over` asks about the bridge
 *  deck; the default asks about the rail itself. Each lane holds one. */
export function beltPart(unitId: number, over = false): Part | undefined {
  return plant.parts.find(
    (p) => p.at.kind === 'belt' && p.at.unit === unitId && (p.at.over === true) === over,
  );
}

export function chestParts(unitId: number): Part[] {
  return plant.parts.filter((p) => p.at.kind === 'chest' && p.at.unit === unitId);
}

export function bankTotal(): number {
  return Object.values(plant.bank).reduce((s, n) => s + (n ?? 0), 0);
}

/** Does this kind of plant take a supply tube? Only two do — the MAKER,
 *  which drinks a colour and stamps its part, and the VAT, which drinks
 *  the fourth manifold and makes something else entirely. The BANK used
 *  to, back when a sheet counted draughts, and every player who walked a
 *  collar past one had it snatched out of their hands. */
export function takesTube(unit: Unit): boolean {
  // …and the two fuel-burning weapons: a flamethrower drinks amber, a
  // tesla coil violet, straight off a feed.
  return unit.type === 'maker' || unit.type === 'vat' || unit.type === 'flamer' || unit.type === 'tesla';
}

/** Everything the given box is holding right now, for the box panel:
 *  a chest's stack, a chute's queue, a combiner's two ports. */
export function unitContents(unitId: number): Part[] {
  return plant.parts.filter(
    (p) =>
      (p.at.kind === 'chest' || p.at.kind === 'chute' || p.at.kind === 'port') &&
      p.at.unit === unitId,
  );
}

/** A fresh spout run: the capped stub, straight out of the pillar. */
export function freshRun(
  side: FloorSide,
  line: LineSpec,
  spout: Vector3,
  normal: Vector3,
  index = 0,
): FactoryRun {
  const head = spout.clone().addScaledVector(normal, TUBE.stubLength);
  return {
    side,
    spout: index,
    line,
    phase: 'pull',
    pointA: spout.clone(),
    normalA: normal.clone(),
    pointB: new Vector3(),
    normalB: new Vector3(0, 0, 1),
    targetUnit: -1,
    extension: TUBE.stubLength,
    head,
    front: -1,
    phaseT: 0,
    held: false,
    magnet: false,
    aim: new Vector3(),
    aimOk: false,
    droop: 0,
    droopVel: 0,
    lastDetent: Math.floor(TUBE.stubLength / TUBE.detentPitch),
    lastSections: 1,
    rattleCool: 0,
    strainCool: 0,
    strain: 0,
    spurnUnit: -1,
    spurnT: 0,
    seatP: 0,
    headVisual: head.clone(),
    energy: 0,
  };
}

/** Clear the whole shift (DOWN TOOLS / the book closing). */
export function clearPlant(): void {
  plant.mode = 'idle';
  plant.orderIndex = -1;
  plant.goalsDone = false;
  plant.count = 0;
  plant.units = [];
  plant.runs = [];
  plant.parts = [];
  plant.feedsAwake = {};
  plant.unitsAvailable = [];
  plant.elapsedMs = 0;
  plant.timeScale = 1;
  plant.brewT = 0;
  plant.goop = 'none';
  plant.goopUnit = -1;
  plant.events.length = 0;
  plant.siege = freshSiege();
  plant.generation++;
}

/**
 * Post a sheet into the live shift: wake its feeds, open its catalogue.
 *
 * THE WAKES ARE CUMULATIVE, and that is load-bearing. Each sheet only
 * lists what it ADDS, which is correct while a shift walks the book in
 * order — but a returning player's shift opens straight onto the sheet
 * they had reached, on a bare floor, and applying that one sheet's wakes
 * alone handed them sheet four's demands with none of sheets one to
 * three's feeds or catalogue. The bank was not buildable. Posting sheet
 * N now switches on everything sheets 0..N would ever have granted, so
 * posting a sheet is self-sufficient however you arrived at it.
 *
 * `elapsedMs` is NOT reset — the shift is one continuous session and the
 * card's clock is the shift's clock, not the sheet's.
 */
export function postOrder(index: number): void {
  plant.mode = 'shop';
  plant.orderIndex = index;
  plant.goalsDone = false;
  plant.count = 0;
  for (let n = 0; n <= index && n < ORDERS.length; n++) {
    const spec = ORDERS[n];
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
  plant.events.push({ kind: 'post', order: index });
  plant.generation++;
}

/**
 * THE BOOK IS DONE — but the shop doesn't close. Every feed opens, the
 * catalogue opens with it, and you keep building with nobody asking for
 * ten of anything. (This is what used to be a separate FREE PLAY mode
 * you had to back out to the board to choose. One session, always.)
 */
export function openShopFully(): void {
  plant.mode = 'shop';
  plant.orderIndex = -1;
  plant.goalsDone = true;
  plant.count = 0;
  for (const [side, line] of Object.entries(FACTORY.sides) as Array<[FloorSide, LineId]>) {
    if (line && !plant.feedsAwake[side]) {
      plant.feedsAwake[side] = true;
      plant.events.push({ kind: 'feed-wake', side });
    }
  }
  plant.unitsAvailable = ['dock', 'maker', 'belt', 'combiner', 'chest', 'vat', 'turret', 'wall', 'flamer', 'piston', 'tesla', 'mortar'];
  plant.generation++;
}
