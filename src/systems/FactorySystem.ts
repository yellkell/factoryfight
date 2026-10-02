/**
 * FactorySystem — the shift itself: feeds, supply runs, the sim, the
 * parts, the payoff. Everything PIECEWORK on the FACTORY screen.
 *
 * THE PULL LIVES ON. The supply hookup is TubeSystem's verb, forked —
 * same constants, same five rules — with one honest difference: there is
 * no predetermined socket. While the collar is held, EVERY free gland on
 * the floor is a candidate, and the nearest one inside the snap window
 * (roughly square) takes the head. The fork is deliberate scaffolding:
 * TubeSystem stays the ladder's untouched crown jewel, and the two pulls
 * reunify once the factory's is proven (FACTORY.md roadmap).
 *
 * Ownership: BuildSystem MUTATES the plant (stamp/unbolt); the sim
 * ADVANCES it (factory/sim.ts, events out); this system PERFORMS it —
 * meshes, pours, hums, haptics, the dock's counter plate — and carries
 * the hands: the two-hand pull and the one-hand part carry.
 *
 * Budget note: units are plain meshes (a full floor ≈ 15 units × ~8
 * draws); parts are instanced per item type. The order walk asserts the
 * whole worst frame under its own bar — instancing the unit chassis is
 * the known next win if it tightens.
 */

import { intents } from '../input/intents.js';
import { createSystem } from '@iwsdk/core';
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';
import {
  COMBINES,
  FACTORY,
  FLOW,
  ITEMS,
  LINES,
  MAKES,
  ORDERS,
  SEAT,
  TUBE,
  UNITS,
  combineKey,
  type ItemId,
} from '../config.js';
import * as sfx from '../audio/sfx.js';
import { buzz } from '../game/haptics.js';
import { orderComplete } from '../game/flow.js';
import { chestBonus, craftFactor, ownedUpgrades, railFactor, reachBonus } from '../game/progress.js';
import { site } from '../game/state.js';
import { updateConnectionGuide } from '../tube/connection.js';
import { CELL, cellCenter, worldToCell } from '../floor/grid.js';
import { PLANT_SCALE, ensurePlantRoot, plantRoot, toPlant } from '../factory/frame.js';
import { siegeTick, standDown } from '../factory/siege.js';
import { floorLayout, type FloorSide } from '../floor/plan.js';
import {
  DIRS,
  beltPart,
  chestParts,
  chuteParts,
  freshRun,
  openShopFully,
  orderSpec,
  partById,
  plant,
  postOrder,
  runForSide,
  runKey,
  runSeatedAt,
  takesTube,
  unitAtCell,
  type FactoryRun,
  type Part,
} from '../factory/state.js';
import {
  beltBranches,
  beltEntry,
  chuteReach,
  deliverPart,
  glandPose,
  glandReach,
  haulRoute,
  linkAhead,
  partPose,
  retractRun,
  simTick,
} from '../factory/sim.js';
import { tickCraft, type CraftContext, type CraftCue } from '../factory/craft.js';
import {
  MAKER_ACCENT,
  buildFeed,
  buildUnit,
  partKit,
  setBeltForm,
  tickBeltTread,
  type FeedRefs,
  type UnitRefs,
} from '../factory/units.js';
import { buildCollar, buildSegment, posePour, type CollarRefs, type SegmentRefs } from '../tube/build.js';
import {
  CLEAR_BORE,
  DODGE_SAMPLES,
  dodgedPoint,
  dodgedTangent,
  easeLift,
  relaxPairs,
  type DodgeItem,
} from '../tube/clearance.js';
import {
  bendControl,
  dodgeBump,
  endControl,
  maxExtensionFor,
  runLength,
  segmentSpans,
} from '../tube/geometry.js';

/** Headless/dev hooks (wired into __tubes in main.ts). */
export const factoryView: {
  state?: () => {
    mode: string;
    order: number;
    orderId: string | null;
    count: number;
    goal: number;
    elapsedMs: number;
    feeds: Partial<Record<FloorSide, boolean>>;
    runs: Array<{ side: FloorSide; phase: string; ext: number; target: number }>;
    parts: number;
    units: number;
    bank: Partial<Record<ItemId, number>>;
    /** THE FINALE: where the goop is, and how full the vat is (0..1). */
    goop?: string;
    brew?: number;
  };
  /** How close a seated line is to coming off its gland (0..1). */
  strain?: (side: string) => number;
  /** THE CLEARANCE PASS, visible: each offset seated run's control
   *  shift [x, y, z] (m). Empty = nothing needed moving. */
  dodges?: () => Partial<Record<FloorSide, [number, number, number]>>;
  /** A seated run's curve exactly as layTube draws it, lift included —
   *  n samples of the centreline, for clearance AUDITS: a tool can
   *  measure tube-to-tube and tube-to-plant distances instead of
   *  eyeballing screenshots. Null unless seated/flowing. */
  runCurve?: (side: string, n?: number) => Array<[number, number, number]> | null;
  /** The route a haul between two floor points would lay. */
  route?: (
    from: { x: number; z: number },
    to: { x: number; z: number },
  ) => Array<{ i: number; j: number; rot: number }>;
  /** THE PLAN: every unit, its cell, its facing, and the unit it feeds.
   *  Proves a hauled lane is a chain, not a row of rails. */
  plan?: () => Array<{
    id: number;
    type: string;
    i: number;
    j: number;
    rot: number;
    feeds: number | null;
    over: number | null;
    branches: number[];
  }>;
  /** Every gland on the floor: the pose it would present to `side`'s
   *  spout (the collar swivels, so ask from somewhere), and whether a
   *  run already holds it. */
  glands?: (side?: string) => Array<{
    unit: number;
    type: string;
    x: number;
    y: number;
    z: number;
    nx: number;
    ny: number;
    nz: number;
    seated: boolean;
  }>;
  /** The driven two hands, per feed side (the tools' pull). */
  grab?: (side: string) => boolean;
  dragTo?: (x: number, y: number, z: number) => void;
  release?: () => void;
  /** Unbolt a seated run off a unit's gland. */
  unseat?: (unitId: number) => boolean;
  /** Headless hand-carry: take the nearest part / drop what's carried. */
  take?: (x: number, y: number, z: number) => number | null;
  drop?: (x: number, y: number, z: number) => boolean;
  timeScale?: (s: number) => void;
  parts?: () => Array<{ id: number; item: ItemId; kind: string; unit?: number }>;
  /** THE CRAFT THEATRE, per machine: what it is making, how far along
   *  (0..1, −1 idle), how high its ram/clamp stands, and whether a
   *  phantom or the port parts are being posed. The look tool shoots
   *  each item at chosen moments off this. */
  crafts?: () => Array<{
    unit: number;
    type: string;
    item: ItemId | null;
    p: number;
    lift: number;
    phantom: number;
    portOn: boolean;
  }>;
  /** TOOLS ONLY. Open every feed and the whole catalogue without walking
   *  the book — a look-tool wants one of each machine on the floor, and
   *  a finale walk wants to be standing at the last sheet. Neither is a
   *  door the game itself ever opens. */
  openAll?: () => void;
  /** TOOLS ONLY. Post a specific sheet into the live shift. */
  postSheet?: (index: number) => void;
  /** TOOLS ONLY. Put parts in the bank without making them — a walk that
   *  tests the chew should not have to run the economy first. */
  grantBank?: (parts: Partial<Record<ItemId, number>>) => void;
} = {};

/** Every standing unit's meshes, by unit id — shared with SiegeSystem,
 *  which slews the guns and lights the breeches on the very groups this
 *  system builds and poses. */
export const liveUnitRefs = new Map<number, UnitRefs>();

const SHELL_PAD = 0.03;
const UP_Y = new Vector3(0, 1, 0);
const FWD_Z = new Vector3(0, 0, 1);
const DOWN = new Vector3(0, -1, 0);

const _mouth = new Vector3();
const _p1 = new Vector3();
const _p2 = new Vector3();
const _entry = new Vector3();
const _chord = new Vector3();
const _pA = new Vector3();
const _pB = new Vector3();
const _prevDir = new Vector3();
const _tangent = new Vector3();
const _quat = new Quaternion();
const _seat = new Vector3();
const _dir = new Vector3();
const _handL = new Vector3();
const _handR = new Vector3();
const _mid = new Vector3();
const _aimL = new Vector3();
const _aimSum = new Vector3();
const _g = new Vector3();
const _gn = new Vector3();
const _c = { x: 0, z: 0 };
const _m4 = new Matrix4();
const _m4b = new Matrix4();
const _v3 = new Vector3();
const _v3b = new Vector3();
const _tintColor = new Color();
const _jointDir = new Vector3();
const _quat2 = new Quaternion();

/** How far a shop line may rise to clear what stands under it: a full
 *  stack — plant lift, two bores and air — and no further. */
const DODGE_MAX_UP = 1.4;
/** Plant under the first or last quarter of a run is left alone (see
 *  clearance.LEVERAGE_FLOOR): the bump has no purchase there, and the
 *  arc that clears a rail beside a maker is the arc that stabs into it. */
const PLANT_LEVERAGE_FLOOR = 0.25;
/** Own scratch: layTube's _quat is live across its whole pass. */
const _q = new Quaternion();

interface RunHw {
  root: Group;
  segments: SegmentRefs[];
  collar: CollarRefs;
  humOn: boolean;
}

const FEED_NORMALS: Record<FloorSide, Vector3> = {
  far: new Vector3(0, 0, 1),
  near: new Vector3(0, 0, -1),
  left: new Vector3(1, 0, 0),
  right: new Vector3(-1, 0, 0),
};

export class FactorySystem extends createSystem({}) {
  private clock = 0;
  private lastGen = -1;
  private feeds = new Map<FloorSide, FeedRefs>();
  private feedFlash = new Map<FloorSide, number>();
  private runHw = new Map<string, RunHw>();
  private unitRefs = liveUnitRefs;
  /** One InstancedMesh per item COMPONENT (parts are little assemblies —
   *  see factory/units.ts partKit). Indexed in lockstep with partLocals. */
  private partPools = new Map<ItemId, InstancedMesh[]>();
  private partLocals = new Map<ItemId, Matrix4[]>();
  private carried: Partial<Record<'left' | 'right', number>> = {};
  /** A tool's carry (factoryView.take) — the real grip's open hand must
   *  not drop it between the tool's two calls. */
  private carriedDriven: Partial<Record<'left' | 'right', boolean>> = {};
  private driven = { active: false, key: 'far:0', pos: new Vector3() };
  /** The dock halo's delivery flash (decays in the dressing tick). */
  private dockFlash = 0;
  /** THE LINKS, drawn: a chevron on every live join, so a chain reads as
   *  a chain from across the room instead of as a row of boxes. */
  private linkMesh: InstancedMesh | null = null;
  /** When each part first appeared — a new one POPS, so "something came
   *  out of the maker" is impossible to miss. */
  private partSeen = new Map<number, number>();
  /** THE FOURTH GATE, coming off: seconds into PEARL's hatch dropping.
   *  It is a one-shot piece of theatre and it only ever plays once. */
  private hatchT = new Map<FloorSide, number>();
  /** The vat draining as the goop climbs out of it (0 = full, 1 = dry). */
  private vatDrain = 0;
  /** Seconds until the next bubble breaks the brew's surface. */
  private bubbleT = 0;
  /** THE CLEARANCE PASS — a control-point OFFSET per seated run (mostly
   *  up, sometimes sideways), so no seated tube passes through the
   *  plant or another tube. Keyed by side; recomputed when the seated
   *  set or the floor changes (dodgeSig). */
  private dodgeSig = '';
  /** The SOLVED offsets (per seated side) and the DRAWN ones, which ease
   *  toward them — and back to nothing once a line is loose again. */
  private dodgeLift = new Map<string, Vector3>();
  private dodgeShown = new Map<string, Vector3>();
  private dodgeA: Vector3[] = Array.from({ length: DODGE_SAMPLES }, () => new Vector3());
  private dodgeB: Vector3[] = Array.from({ length: DODGE_SAMPLES }, () => new Vector3());
  /** One context record, refilled per machine per frame for the theatre. */
  private craftCtx: CraftContext = {
    dt: 0,
    clock: 0,
    slotZ: 0,
    chuteFull: false,
    spinTarget: 0,
    ports: [null, null],
    portSpin: [0, 0],
    cue: (cue, n) => this.craftCue(cue, n),
  };

  init(): void {
    ensurePlantRoot(this.scene);
    factoryView.state = () => {
      const spec = orderSpec();
      return {
        mode: plant.mode,
        order: plant.orderIndex,
        orderId: spec?.id ?? null,
        count: plant.count,
        goal: spec?.goal ?? 0,
        elapsedMs: plant.elapsedMs,
        feeds: { ...plant.feedsAwake },
        runs: plant.runs.map((r) => ({
          side: r.side,
          key: runKey(r),
          phase: r.phase,
          ext: r.extension,
          target: r.targetUnit,
          head: { x: r.headVisual.x, y: r.headVisual.y, z: r.headVisual.z },
        })),
        parts: plant.parts.length,
        units: plant.units.length,
        bank: { ...plant.bank },
        upgrades: ownedUpgrades(),
        goop: plant.goop,
        brew: plant.brewT / UNITS.vat.brewS,
      };
    };
    /** Every unit as it stands: type, cell, facing, and where it sends.
     *  A walk reads this to prove a hauled lane is a CHAIN and not just
     *  the right number of rails in roughly the right place. */
    factoryView.plan = () =>
      plant.units.map((u) => {
        const next = linkAhead(u);
        return {
          id: u.id,
          type: u.type,
          i: u.i,
          j: u.j,
          rot: u.rot,
          feeds: next ? next.id : null,
          /** The deck's travel where a lane bridges this rail; null else. */
          over: u.over ?? null,
          /** The lanes joined onto this one, dealt every other part. */
          branches: u.type === 'belt' ? beltBranches(u).map((b) => b.id) : [],
        };
      });
    /** THE ROUTE a haul between two floor points would take, without
     *  holding one — the same haulRoute the drag itself uses, so a walk
     *  can compare a direct lane against one bent round a stick. */
    factoryView.route = (from, to) =>
      haulRoute(worldToCell(from.x, from.z), worldToCell(to.x, to.z), UNITS.pull.maxRun).map(
        (st) => ({ ...st }),
      );
    factoryView.glands = (side) => {
      const from = side ? runForSide(side)?.pointA : undefined;
      return plant.units
        .filter((u) => takesTube(u))
        .map((u) => {
          glandPose(u, _g, _gn, from);
          return {
            unit: u.id,
            type: u.type,
            x: _g.x,
            y: _g.y,
            z: _g.z,
            nx: _gn.x,
            ny: _gn.y,
            nz: _gn.z,
            seated: Boolean(runSeatedAt(u.id)),
          };
        });
    };
    factoryView.grab = (side) => {
      const run = runForSide(side);
      // A SEATED collar is grabbable too — that is the whole tug: take
      // it, haul it off the gland, walk it to the next box. A walk needs
      // the same door the hands use.
      if (!run || (run.phase !== 'pull' && run.phase !== 'seated' && run.phase !== 'flowing')) {
        return false;
      }
      this.driven.active = true;
      this.driven.key = runKey(run);
      this.driven.pos.copy(run.headVisual);
      return true;
    };
    factoryView.dragTo = (x, y, z) => {
      this.driven.pos.set(x, y, z);
    };
    factoryView.release = () => {
      this.driven.active = false;
    };
    /** How far a seated collar is from letting go: 0 = seated, 1 = the
     *  seal is about to break. A walk watches this rise as it hauls. */
    factoryView.strain = (side) => {
      const run = runForSide(side);
      return run ? Math.min(1, run.strain / TUBE.unseatHoldS) : 0;
    };
    factoryView.dodges = () => {
      const out: Record<string, [number, number, number]> = {};
      for (const [side, v] of this.dodgeLift) {
        if (v.lengthSq() > 1e-6) out[side] = [v.x, v.y, v.z];
      }
      return out;
    };
    factoryView.runCurve = (side, n = 64) => {
      const run = runForSide(side);
      if (!run || (run.phase !== 'seated' && run.phase !== 'flowing')) return null;
      const lift = this.dodgeShown.get(runKey(run));
      const pts: Array<[number, number, number]> = [];
      _mouth.copy(run.pointA);
      bendControl(_mouth, run.normalA, run.extension, _p1);
      endControl(run.headVisual, run.normalB, run.extension, _p2, 1);
      for (let k = 0; k < n; k++) {
        dodgedPoint(_mouth, _p1, _p2, run.headVisual, lift, k / (n - 1), _g);
        pts.push([_g.x, _g.y, _g.z]);
      }
      return pts;
    };
    factoryView.unseat = (unitId) => {
      const run = runSeatedAt(unitId);
      if (!run) return false;
      // retractRun pushes the 'unseat' event; drainEvents kills the hum
      // and shuts the iris, so there is exactly one code path for it.
      retractRun(run);
      sfx.droopSettle();
      return true;
    };
    factoryView.take = (x, y, z) => this.takeNearest('right', _g.set(x, y, z), true);
    factoryView.drop = (x, y, z) => this.dropCarried('right', _g.set(x, y, z));
    factoryView.timeScale = (s) => {
      plant.timeScale = Math.max(0.1, Math.min(30, s));
    };
    factoryView.openAll = () => {
      standDown();
      openShopFully();
    };
    factoryView.grantBank = (parts) => {
      for (const [item, n] of Object.entries(parts) as Array<[ItemId, number]>) {
        plant.bank[item] = (plant.bank[item] ?? 0) + n;
      }
    };
    factoryView.postSheet = (index) => {
      if (index >= 0 && index < ORDERS.length) postOrder(index);
    };
    factoryView.parts = () =>
      plant.parts.map((p) => ({
        id: p.id,
        item: p.item,
        kind: p.at.kind,
        unit: 'unit' in p.at ? p.at.unit : undefined,
      }));
    factoryView.crafts = () =>
      plant.units
        .filter((u) => u.type === 'maker' || u.type === 'combiner')
        .map((u) => {
          const rig = this.unitRefs.get(u.id)?.craft;
          const dur = (u.type === 'maker' ? FACTORY.makerS : FACTORY.combinerS) * craftFactor();
          return {
            unit: u.id,
            type: u.type,
            item: rig?.item ?? null,
            p: u.craftT < 0 ? -1 : Math.min(1, u.craftT / dur),
            lift: rig ? rig.head.position.y - rig.headBase : 0,
            phantom: rig?.phantomN ?? 0,
            portOn: rig?.portOn ?? false,
          };
        });
  }

  update(delta: number): void {
    this.clock += delta;

    const live = plant.mode !== 'idle';
    if (this.lastGen !== plant.generation) {
      this.lastGen = plant.generation;
      this.syncStructures(live);
    }
    if (!live) return;

    const active = site.screen === 'factory';

    // The feeds stand on the tape's sides — reposed every frame (cheap,
    // and the floor may have moved between shifts).
    this.poseFeeds(delta);

    // Hands: the pull and the carry — only mid-shift, never under the card.
    if (active && !site.paused) this.tickHands(delta);
    else if (this.driven.active && !active) this.driven.active = false;

    // Seated tubes give way — to the plant under them and to each other.
    // Recomputed when the seated set changes AND when the floor does (a
    // lane hauled under a standing line must push that line up), then
    // applied inside layTube.
    let sig = `g${plant.generation}|`;
    for (const r of plant.runs) {
      if (r.phase === 'seated' || r.phase === 'flowing') sig += `${runKey(r)}:${r.targetUnit}|`;
    }
    if (sig !== this.dodgeSig) {
      this.dodgeSig = sig;
      this.recomputeDodges();
    }
    for (const run of plant.runs) {
      const key = runKey(run);
      let shown = this.dodgeShown.get(key);
      if (!shown) {
        shown = new Vector3();
        this.dodgeShown.set(key, shown);
      }
      easeLift(shown, this.dodgeLift.get(key), delta);
    }

    // The runs: pull physics, seat magnet, pours, retraction.
    for (const run of plant.runs) this.tickRun(run, delta);
    this.tickGlandTells();

    // The machine itself. The card pauses the HANDS, never the works.
    const dt = delta * plant.timeScale;
    simTick(dt);
    siegeTick(dt);
    plant.elapsedMs += dt * 1000;
    // Every tread on the floor runs at the sim's own pace.
    tickBeltTread(dt, FACTORY.railSpeed * railFactor());

    this.drainEvents();
    // Dressing first: the craft theatre poses the forming parts that
    // renderParts then draws.
    this.tickUnitDressing(delta, dt);
    this.renderParts();
  }

  /* ── structures: feeds, unit meshes, run hardware ─────────────────────── */

  private syncStructures(live: boolean): void {
    // Feeds exist while a shift does.
    if (live && this.feeds.size === 0) {
      for (const side of ['far', 'left', 'right', 'near'] as FloorSide[]) {
        const lineId = FACTORY.sides[side];
        const refs = buildFeed(lineId ? LINES[lineId] : null);
        plantRoot.add(refs.group);
        this.feeds.set(side, refs);
      }
    }
    if (!live) {
      for (const refs of this.feeds.values()) refs.group.removeFromParent();
      this.feeds.clear();
      this.hatchT.clear();
      this.vatDrain = 0;
      for (const hw of this.runHw.values()) this.dropRunHw(hw);
      this.runHw.clear();
      this.dodgeLift.clear();
      this.dodgeShown.clear();
      this.dodgeSig = '';
      for (const refs of this.unitRefs.values()) this.dropUnitRefs(refs);
      this.unitRefs.clear();
      for (const pools of this.partPools.values()) {
        for (const pool of pools) pool.removeFromParent();
      }
      this.partPools.clear();
      this.partLocals.clear();
      this.partSeen.clear();
      if (this.linkMesh) {
        this.linkMesh.removeFromParent();
        this.linkMesh = null;
      }
      this.carried = {};
      this.driven.active = false;
      sfx.stopAllHums();
      return;
    }

    // Unit meshes follow plant.units.
    const liveIds = new Set(plant.units.map((u) => u.id));
    for (const [id, refs] of this.unitRefs) {
      if (!liveIds.has(id)) {
        this.dropUnitRefs(refs);
        this.unitRefs.delete(id);
      }
    }
    for (const unit of plant.units) {
      let refs = this.unitRefs.get(unit.id);
      if (!refs) {
        refs = buildUnit(unit.type);
        plantRoot.add(refs.group);
        this.unitRefs.set(unit.id, refs);
      }
      // POSE EVERY REBUILD, not only on the frame a unit is born: a
      // hauled run turns its own anchor round to face down the lane it
      // just laid, and a rot set after placement used to reach the plant
      // and never the mesh — a rail feeding a direction it wasn't
      // pointing. Cheap, and it can't drift.
      cellCenter(unit.i, unit.j, _c);
      refs.group.position.set(_c.x, 0, _c.z);
      const d = [
        { di: 0, dj: -1 },
        { di: 1, dj: 0 },
        { di: 0, dj: 1 },
        { di: -1, dj: 0 },
      ][unit.rot];
      refs.group.rotation.y = Math.atan2(d.di, d.dj);
      // The craft theatre composes its phantoms through this matrix the
      // same frame, before the renderer would have refreshed it.
      refs.group.updateMatrix();
      // A rail dresses for its neighbours on every rebuild: a corner
      // wears its curve, a crossed one raises the deck. Same generation
      // tick that re-poses it, so it can't lag the plant either.
      if (unit.type === 'belt' && refs.belt) {
        const entryRel = (beltEntry(unit) - unit.rot + 4) % 4;
        const overRel = unit.over === undefined ? -1 : (unit.over - unit.rot + 4) % 4;
        setBeltForm(refs, entryRel, overRel);
      }
    }

    // A run per spout of every awake feed (each stub waits on its spout).
    for (const [side, refs] of this.feeds) {
      const lineId = FACTORY.sides[side];
      if (!lineId || !plant.feedsAwake[side]) continue;
      for (let spout = 0; spout < refs.spoutX.length; spout++) {
      const key = `${side}:${spout}`;
      if (!runForSide(key)) {
        this.spoutPose(side, refs, _g, _gn, spout);
        plant.runs.push(freshRun(side, LINES[lineId], _g, _gn, spout));
      }
      if (!this.runHw.has(key)) {
        const run = runForSide(key)!;
        const root = new Group();
        const segments: SegmentRefs[] = [];
        for (let s = 0; s < TUBE.segments; s++) {
          const seg = buildSegment(run.line, s);
          segments.push(seg);
          root.add(seg.shell, seg.rib, seg.pour, seg.joint);
        }
        const collar = buildCollar(run.line);
        root.add(collar.group);
        plantRoot.add(root);
        this.runHw.set(key, { root, segments, collar, humOn: false });
      }
      }
    }

    // Part pools once — one instanced mesh per component of each kit.
    if (this.partPools.size === 0) {
      for (const item of Object.keys(ITEMS) as ItemId[]) {
        const kit = partKit(item);
        const pools: InstancedMesh[] = [];
        const locals: Matrix4[] = [];
        for (const part of kit) {
          const pool = new InstancedMesh(part.geometry, part.material, 64);
          pool.count = 0;
          pool.frustumCulled = false;
          plantRoot.add(pool);
          pools.push(pool);
          locals.push(part.local);
        }
        this.partPools.set(item, pools);
        this.partLocals.set(item, locals);
      }
    }

    if (!this.linkMesh) {
      const geo = new BufferGeometry();
      const v: number[] = [];
      for (const z of [-0.4, 0.15]) v.push(-0.5, 0, z, 0.5, 0, z, 0, 0, z + 0.45);
      geo.setAttribute('position', new Float32BufferAttribute(v, 3));
      const mat = new MeshBasicMaterial({
        color: 0xffb85c,
        transparent: true,
        opacity: 0.5,
        blending: AdditiveBlending,
        depthWrite: false,
        side: 2,
      });
      this.linkMesh = new InstancedMesh(geo, mat, 96);
      this.linkMesh.count = 0;
      this.linkMesh.frustumCulled = false;
      this.linkMesh.renderOrder = 12;
      plantRoot.add(this.linkMesh);
    }
    this.relayLinks();
  }

  /** One chevron per live join, midway between the two cells — the
   *  straight-ahead link, and every branch a lane deals into. */
  private relayLinks(): void {
    const mesh = this.linkMesh;
    if (!mesh) return;
    let n = 0;
    const draw = (a: (typeof plant.units)[number], b: (typeof plant.units)[number]): void => {
      if (n >= 96) return;
      cellCenter(a.i, a.j, _c);
      const ax = _c.x;
      const az = _c.z;
      cellCenter(b.i, b.j, _c);
      _q.setFromAxisAngle(UP_Y, Math.atan2(_c.x - ax, _c.z - az));
      _m4.compose(
        _v3.set((ax + _c.x) / 2, UNITS.railTop + 0.1, (az + _c.z) / 2),
        _q,
        _v3b.set(0.09, 1, 0.12),
      );
      mesh.setMatrixAt(n++, _m4);
    };
    for (const unit of plant.units) {
      const ahead = linkAhead(unit);
      if (ahead) draw(unit, ahead);
      if (unit.type === 'belt') for (const b of beltBranches(unit)) draw(unit, b);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }

  private dropRunHw(hw: RunHw): void {
    hw.root.removeFromParent();
    for (const seg of hw.segments) {
      seg.pourMat.dispose();
      seg.jointMat.dispose();
    }
    hw.collar.capMat.dispose();
    hw.collar.glowMat.dispose();
  }

  private dropUnitRefs(refs: UnitRefs): void {
    refs.group.removeFromParent();
    if (refs.gland) {
      refs.gland.glowMat.dispose();
      refs.gland.guideMat.dispose();
    }
    if (refs.lampMat) refs.lampMat.dispose();
    if (refs.craft) {
      refs.craft.glowMat.dispose();
      refs.craft.flashMat.dispose();
      refs.craft.heatMat.dispose();
      refs.craft.sparkMat.dispose();
      refs.craft.sparks.geometry.dispose();
    }
    if (refs.halo) refs.halo.dispose();
    if (refs.fill) refs.fill.mat.dispose();
    if (refs.vatGlow) refs.vatGlow.dispose();
  }

  /* ── feeds ────────────────────────────────────────────────────────────── */

  /** Where a side's pillar stands: the middle of its tape run, SNAPPED
   *  to the nearest lattice centreline. The tape lands wherever the
   *  player dragged it, so a raw midpoint put every spout a random
   *  fraction of a cell off the grid — a tube pulled straight out of it
   *  met a machine slightly askew, forever. Snapped, the spout looks
   *  straight down a row of cells; and because opposite sides share one
   *  midline, facing pillars line up with EACH OTHER down the same lane
   *  by construction. */
  private sideMid(side: FloorSide, out: Vector3): Vector3 {
    const lane = (v: number, lo: number, hi: number): number => {
      const rc = CELL * PLANT_SCALE;
      const c = (Math.round(v / rc - 0.5) + 0.5) * rc;
      return Math.min(hi - 0.3 * PLANT_SCALE, Math.max(lo + 0.3 * PLANT_SCALE, c));
    };
    const cx = lane(
      (floorLayout.left + floorLayout.right) / 2,
      floorLayout.left,
      floorLayout.right,
    );
    const cz = lane((floorLayout.near + floorLayout.far) / 2, floorLayout.far, floorLayout.near);
    if (side === 'far') out.set(cx, 0, floorLayout.far);
    else if (side === 'near') out.set(cx, 0, floorLayout.near);
    else if (side === 'left') out.set(floorLayout.left, 0, cz);
    else out.set(floorLayout.right, 0, cz);
    // The tape is the room's; the pillar is the plant's.
    return toPlant(out);
  }

  private spoutPose(side: FloorSide, refs: FeedRefs, point: Vector3, normal: Vector3, spout = 0): void {
    this.sideMid(side, point);
    normal.copy(FEED_NORMALS[side]);
    // The pillar's local +X, in the plant: the twin stands a cell along.
    const along = refs.spoutX[spout] ?? 0;
    point.x += normal.z * along;
    point.z -= normal.x * along;
    point.addScaledVector(normal, refs.mouthOffset).setY(FACTORY.spoutHeight);
  }

  private poseFeeds(delta: number): void {
    for (const [side, refs] of this.feeds) {
      this.sideMid(side, _g);
      refs.group.position.set(_g.x, 0, _g.z);
      const n = FEED_NORMALS[side];
      refs.group.rotation.y = Math.atan2(n.x, n.z);
      const awake = Boolean(plant.feedsAwake[side]);
      const flash = this.feedFlash.get(side) ?? 0;
      if (flash > 0) this.feedFlash.set(side, flash - delta);

      // THE FOURTH GATE COMES OFF. PEARL is built with a bolted hatch
      // over its spout — a door that has visibly never been opened — and
      // this is the one time it ever moves: the straps let go, the plate
      // tips off its bottom edge, and it falls away down the face of the
      // column. Three deep-fitted servos bought this; it is worth two
      // seconds.
      if (refs.hatch) {
        if (!awake) {
          refs.hatch.visible = true;
        } else {
          const t = (this.hatchT.get(side) ?? 0) + delta;
          this.hatchT.set(side, t);
          const p = Math.min(1, t / 1.6);
          const swing = p * p; // it accelerates, because it is heavy
          refs.hatch.rotation.x = -swing * 1.5;
          refs.hatch.position.y = -swing * 1.1;
          refs.hatch.position.z = swing * 0.16;
          if (p >= 1) {
            refs.hatch.removeFromParent();
            refs.hatch = null;
          }
        }
      }
      const breathe = 0.5 + 0.5 * Math.sin(this.clock * 2.2);
      refs.glowMat.opacity = awake
        ? 0.25 + 0.2 * breathe + Math.max(0, flash) * 0.5
        : FACTORY.sides[side]
          ? 0.06
          : 0.08;
      // A run's pointA rides the spout (the floor may have moved between
      // shifts; runs are born fresh each shift, but stay honest anyway).
      for (let spout = 0; spout < refs.spoutX.length; spout++) {
        const run = runForSide(`${side}:${spout}`);
        if (run && run.phase === 'pull' && !run.held) {
          this.spoutPose(side, refs, _g, _gn, spout);
          run.pointA.copy(_g);
          run.normalA.copy(_gn);
        }
      }
    }
  }

  /* ── hands: the pull's grips and the carry ────────────────────────────── */

  private tickHands(delta: number): void {
    void delta;
    const grips = this.world.playerSpaceEntities?.gripSpaces;
    const objL = grips?.left?.object3D;
    const objR = grips?.right?.object3D;
    if (objL) toPlant(objL.getWorldPosition(_handL));
    if (objR) toPlant(objR.getWorldPosition(_handR));

    // THE CARRY: one squeezing hand near a loose part takes it — unless
    // that hand is close enough to a collar that the pull has first call.
    for (const [hand, obj, pos] of [
      ['left', objL, _handL],
      ['right', objR, _handR],
    ] as const) {
      if (!obj) continue;
      // THE CARRY is a GRAB: a squeeze, or a fist.
      const squeezing = intents[hand].grab.pressed;
      const carriedId = this.carried[hand];
      if (carriedId !== undefined && !squeezing && !this.carriedDriven[hand]) {
        this.dropCarried(hand, pos);
      } else if (
        carriedId === undefined &&
        intents[hand].grab.down &&
        !this.nearAnyCollar(pos)
      ) {
        this.takeNearest(hand, pos, false);
      }
    }
  }

  private nearAnyCollar(pos: Vector3): boolean {
    for (const run of plant.runs) {
      if (run.phase === 'pull' && pos.distanceTo(run.headVisual) < TUBE.grabReach) return true;
    }
    return false;
  }

  private takeNearest(hand: 'left' | 'right', pos: Vector3, headless: boolean): number | null {
    if (this.carried[hand] !== undefined) return null; // one part per fist
    let best: Part | null = null;
    let bestD = FACTORY.partReach;
    for (const part of plant.parts) {
      const at = part.at;
      if (at.kind === 'hand' || at.kind === 'port') continue;
      if (at.kind === 'chest') {
        // Only the top of the stack is in reach of a fist.
        const stack = chestParts(at.unit);
        if (stack[stack.length - 1] !== part) continue;
      }
      partPose(part, _pA);
      const d = _pA.distanceTo(pos);
      if (d < bestD) {
        bestD = d;
        best = part;
      }
    }
    if (!best) return null;
    const at = best.at;
    if (at.kind === 'chute') {
      for (const p of chuteParts(at.unit)) {
        if (p.at.kind === 'chute' && p.at.slot > at.slot) p.at.slot -= 1;
      }
    }
    best.at = { kind: 'hand', hand };
    this.carried[hand] = best.id;
    if (headless) this.carriedDriven[hand] = true;
    else {
      sfx.uiHover();
      buzz(this.world, hand, 0.3, 25);
    }
    return best.id;
  }

  private dropCarried(hand: 'left' | 'right', pos: Vector3): boolean {
    const id = this.carried[hand];
    if (id === undefined) return false;
    const part = plant.parts.find((p) => p.id === id);
    delete this.carried[hand];
    delete this.carriedDriven[hand];
    if (!part) return false;

    // Over the dock: delivered. Over a chest: banked in the crate. Over a
    // combiner's port tray: fitted. Over a free RAIL: back on the lane,
    // right where you let go of it — picking a part up is not a one-way
    // door any more. NEAREST eligible box wins (dropReach overlaps
    // neighbouring cells, and first-found used to let a rail's neighbour
    // shadow the box you were actually over). Anywhere else: floor.
    let best: (typeof plant.units)[number] | null = null;
    let bestD = FACTORY.dropReach;
    for (const unit of plant.units) {
      cellCenter(unit.i, unit.j, _c);
      const d = Math.hypot(pos.x - _c.x, pos.z - _c.z);
      if (d >= bestD) continue;
      const takes =
        unit.type === 'dock' ||
        (unit.type === 'chest' && chestParts(unit.id).length < FACTORY.chestCap + chestBonus()) ||
        (unit.type === 'combiner' && (unit.ports[0] < 0 || unit.ports[1] < 0)) ||
        (unit.type === 'belt' && !beltPart(unit.id));
      if (!takes) continue;
      bestD = d;
      best = unit;
    }
    if (best) {
      const unit = best;
      if (unit.type === 'dock') {
        deliverPart(part);
        buzz(this.world, hand, 0.5, 40);
        return true;
      }
      if (unit.type === 'chest') {
        part.at = { kind: 'chest', unit: unit.id, index: chestParts(unit.id).length };
        sfx.uiClick();
        return true;
      }
      if (unit.type === 'combiner') {
        const portIdx = unit.ports[0] < 0 ? 0 : 1;
        unit.ports[portIdx] = part.id;
        part.at = { kind: 'port', unit: unit.id, port: portIdx };
        sfx.uiClick();
        return true;
      }
      // The rail: the part lands at the spot on the lane your fist was
      // over, and rides on from there.
      cellCenter(unit.i, unit.j, _c);
      const dir = DIRS[unit.rot];
      const along = (pos.x - _c.x) * dir.di + (pos.z - _c.z) * dir.dj;
      part.at = { kind: 'belt', unit: unit.id };
      part.p = Math.min(0.9, Math.max(0.05, 0.5 + along / (CELL * 0.92)));
      sfx.uiClick();
      return true;
    }
    part.at = { kind: 'loose', x: pos.x, y: 0.05, z: pos.z };
    sfx.droopSettle();
    return true;
  }

  /* ── the runs: pull, seat, pour, retract ──────────────────────────────── */

  private tickRun(run: FactoryRun, delta: number): void {
    const hw = this.runHw.get(runKey(run));
    if (!hw) return;

    if (run.spurnT > 0) run.spurnT -= delta;
    if (run.phase === 'pull' && !site.paused) this.tickPull(run, hw, delta);
    else if (run.phase === 'retract') this.tickRetract(run, hw, delta);
    if (run.phase === 'seated' || run.phase === 'flowing') {
      if (!site.paused) this.tickStrain(run, delta);
      this.layTube(run, hw, run.extension, true);
      this.tickPour(run, hw, delta);
    } else {
      // Energy dies with the connection.
      run.energy = Math.max(0, run.energy - delta * 3);
      for (const seg of hw.segments) {
        seg.pour.visible = seg.pour.visible && run.energy > 0.01;
        seg.joint.visible = seg.joint.visible && seg.pour.visible;
        seg.pourMat.uniforms.uEnergy.value = run.energy;
      }
    }
    this.tickCollarTell(run, hw);
  }

  private tickPull(run: FactoryRun, hw: RunHw, delta: number): void {
    _mouth.copy(run.pointA).addScaledVector(run.normalA, 0);
    run.rattleCool = Math.max(0, run.rattleCool - delta);
    run.strainCool = Math.max(0, run.strainCool - delta);
    const maxExt = TUBE.maxLength + reachBonus(); // LONG REACH, if fitted

    const hands = this.readHands(run);
    if (hands.aim) run.aim.copy(hands.aim);
    run.aimOk = hands.aim !== null;

    if (!run.magnet) {
      if (hands.holding && !run.held) {
        run.held = true;
        run.droop = 0;
        run.droopVel = 0;
        sfx.grabLatch();
        buzz(this.world, 'both', 0.35, 30);
      } else if (!hands.holding && run.held) {
        run.held = false;
        sfx.droopSettle();
      } else if (!run.held && hands.rattling && run.rattleCool <= 0) {
        run.rattleCool = TUBE.rattleCooldownS;
        sfx.oneHandRattle();
        buzz(this.world, hands.rattleHand, 0.25, 25);
      }
    }

    if (run.held && !run.magnet) {
      const reach = (run.extension - TUBE.stubLength) / Math.max(0.001, maxExt - TUBE.stubLength);
      const k = TUBE.followStiffness + (TUBE.followStiffnessFar - TUBE.followStiffness) * reach;
      run.head.lerp(hands.mid, 1 - Math.exp(-k * delta));

      _dir.copy(run.head).sub(_mouth);
      let ext = _dir.length();
      if (ext < 1e-4) {
        _dir.copy(run.normalA);
        ext = 1e-4;
      }
      _dir.divideScalar(ext);
      if (ext > maxExt) {
        ext = maxExt;
        run.head.copy(_mouth).addScaledVector(_dir, ext);
        if (run.strainCool <= 0) {
          run.strainCool = 0.9;
          sfx.strainCreak();
          buzz(this.world, 'both', 0.5, 70);
        }
      } else if (ext < TUBE.stubLength) {
        ext = TUBE.stubLength;
        run.head.copy(_mouth).addScaledVector(_dir, ext);
      }

      const detent = Math.floor(ext / TUBE.detentPitch);
      if (detent !== run.lastDetent) {
        run.lastDetent = detent;
        sfx.segmentClick(detent);
        buzz(this.world, 'both', 0.18, 14);
      }
      // Counted against the SPAN law (layTube's), not the pull's stop,
      // so a clank means a section the hands can actually see arrive.
      const sections = segmentSpans(ext, maxExtensionFor(ext)).length;
      if (sections > run.lastSections) {
        sfx.sectionArrive(sections - 1);
        buzz(this.world, 'both', 0.4, 40);
      }
      run.lastSections = sections;
      run.extension = ext;
    }

    // Parked droop.
    const droopTarget =
      run.held || run.magnet ? 0 : Math.min(TUBE.droopMax, run.extension * TUBE.droopPerMetre);
    const spring = 60 / TUBE.droopSettleS;
    run.droopVel += (droopTarget - run.droop) * spring * delta;
    run.droopVel *= Math.exp(-4.2 * delta);
    run.droop += run.droopVel * delta;
    run.headVisual.copy(run.head).addScaledVector(DOWN, run.droop);

    // THE GLAND DOES THE LAST METRE — whichever free gland is nearest,
    // offered up roughly square.
    if (!run.magnet && run.held) {
      let bestUnit = -1;
      let bestD = FACTORY.seatRadius;
      for (const unit of plant.units) {
        // ONLY A MAKER OR THE VAT. The bank used to wear a gland too,
        // back when a sheet counted draughts — and since the magnet takes
        // the NEAREST free one, walking a collar past a bank on the way
        // to a maker had it snatched out of your hands every time.
        if (!takesTube(unit)) continue;
        if (runSeatedAt(unit.id)) continue;
        // A GLAND YOU JUST TORE THE LINE OFF DOESN'T GRAB IT BACK. The
        // head is, by definition, right beside the box you just hauled
        // it from, so without this the magnet undoes the tug before you
        // have taken a step — you'd fight the same box forever.
        if (unit.id === run.spurnUnit && run.spurnT > 0) continue;
        if (plant.runs.some((r) => r !== run && r.magnet && r.targetUnit === unit.id)) continue;
        // The collar SWIVELS to face this run's spout, so the alignment
        // gate is satisfied by construction: the only thing we ask of
        // the player is "bring it near". Nothing is ever refused for
        // approaching a box from the wrong side again.
        glandPose(unit, _g, _gn, run.pointA);
        _seat.copy(_g).addScaledVector(_gn, FACTORY.glandSeat);
        const d = run.headVisual.distanceTo(_seat);
        if (d >= bestD) continue;
        bestD = d;
        bestUnit = unit.id;
        run.pointB.copy(_g);
        run.normalB.copy(_gn);
      }
      if (bestUnit >= 0) {
        run.magnet = true;
        run.targetUnit = bestUnit;
        run.seatP = 0;
        sfx.magnetTake();
        buzz(this.world, 'both', 0.3, 120);
      }
    }
    if (run.magnet) {
      _seat.copy(run.pointB).addScaledVector(run.normalB, FACTORY.glandSeat);
      run.seatP = Math.min(1, run.seatP + delta / (SEAT.magnetS + SEAT.seatS));
      const e = 1 - (1 - run.seatP) ** 3;
      run.head.lerp(_seat, e);
      run.headVisual.copy(run.head);
      run.extension = Math.max(TUBE.stubLength, runLength(_mouth, run.head));
      if (run.seatP >= 1) this.seatRun(run, hw, _seat);
    }

    this.layTube(run, hw, run.extension, run.magnet);
  }

  private seatRun(run: FactoryRun, hw: RunHw, seat: Vector3): void {
    run.phase = 'seated';
    run.phaseT = 0;
    run.front = -1;
    run.head.copy(seat);
    run.extension = runLength(_mouth.copy(run.pointA), seat);
    run.held = false;
    run.magnet = false;
    run.droop = 0;
    if (this.driven.active && this.driven.key === runKey(run)) this.driven.active = false;
    for (const seg of hw.segments) seg.pour.visible = seg.shell.visible;
    const gland = this.unitRefs.get(run.targetUnit)?.gland;
    if (gland) {
      gland.iris.visible = false;
      gland.glowMat.color.setHex(run.line.glow);
      gland.guideMat.color.setHex(run.line.glow);
    }
    sfx.seatClunk();
    sfx.latchDogs();
    if (run.line.id === 'mains') sfx.steamHiss();
    else if (run.line.id === 'coolant') sfx.hydraulicSigh();
    else sfx.arcZap();
    sfx.chargeRise(FLOW.chargeS);
    buzz(this.world, 'both', 0.9, 90);
  }

  private tickPour(run: FactoryRun, hw: RunHw, delta: number): void {
    run.phaseT += delta;
    let target = 0;
    if (run.phase === 'seated') {
      target = Math.min(1, run.phaseT / FLOW.chargeS);
      if (run.phaseT >= FLOW.chargeS && run.front < 0) run.front = 0.001;
      if (run.front >= 0) {
        run.front += run.line.flowSpeed * delta;
        if (run.front >= run.extension) {
          run.front = run.extension + 10;
          run.phase = 'flowing';
          run.phaseT = 0;
          sfx.flowArrive(run.line.id);
          sfx.startHum(`plant-${runKey(run)}`, run.line.id, run.line.pulseHz);
          hw.humOn = true;
          buzz(this.world, 'both', 0.5, 120);
        }
      }
    } else {
      target = 1;
    }
    run.energy += (target - run.energy) * (1 - Math.exp(-delta * 6));
    for (const seg of hw.segments) {
      const u = seg.pourMat.uniforms;
      u.uTime.value = this.clock;
      u.uFront.value = run.front;
      u.uEnergy.value = run.energy;
    }
  }

  private stopRunHum(run: FactoryRun): void {
    const hw = this.runHw.get(runKey(run));
    if (hw?.humOn) {
      sfx.stopHum(`plant-${runKey(run)}`);
      hw.humOn = false;
    }
    const gland = this.unitRefs.get(run.targetUnit)?.gland;
    if (gland) gland.iris.visible = true;
  }

  /**
   * BREAKING THE SEAL — a seated line comes off its gland with a TUG.
   *
   * Sheet 1 runs the amber tube into the bank; sheet 2 wants that same
   * line feeding a maker. There was no way to do that but DELETE the
   * bank, which is a nonsense: a fitter would take the collar in both
   * hands and pull it off. So now you can.
   *
   * The cost is deliberate. Both hands on the collar, hauled
   * TUBE.unseatPull clear of the gland and HELD there for unseatHoldS
   * while the joint creaks and the grips buzz harder the closer it comes
   * to letting go. Brush past a running factory and nothing happens;
   * mean it, and the line is in your hands, still extended, ready to
   * walk to the next box. Let go early and it settles back, sealed.
   */
  private tickStrain(run: FactoryRun, delta: number): void {
    const hands = this.readHands(run);
    if (!hands.holding) {
      if (run.strain > 0) {
        run.strain = 0;
        sfx.seatClunk(); // it settles back on the gland
      }
      return;
    }
    const pull = hands.mid.distanceTo(run.head);
    if (pull < TUBE.unseatPull) {
      run.strain = Math.max(0, run.strain - delta * 2);
      return;
    }
    const was = run.strain;
    run.strain += delta;
    // The joint complains all the way, and harder as it goes.
    if (Math.floor(was * 6) !== Math.floor(run.strain * 6)) {
      sfx.strainCreak();
      buzz(this.world, 'both', 0.2 + 0.6 * (run.strain / TUBE.unseatHoldS), 30);
    }
    if (run.strain < TUBE.unseatHoldS) return;

    // IT LETS GO. Straight into your hands, not back into the wall —
    // the whole point is carrying it somewhere else.
    run.strain = 0;
    run.spurnUnit = run.targetUnit;
    run.spurnT = FACTORY.spurnS;
    this.stopRunHum(run);
    run.phase = 'pull';
    run.phaseT = 0;
    run.held = true;
    run.magnet = false;
    run.targetUnit = -1;
    run.front = -1;
    run.energy = 0;
    sfx.boltSpin();
    sfx.droopSettle();
    buzz(this.world, 'both', 0.9, 110);
  }

  private tickRetract(run: FactoryRun, hw: RunHw, delta: number): void {
    if (hw.humOn) {
      sfx.stopHum(`plant-${runKey(run)}`);
      hw.humOn = false;
    }
    run.phaseT += delta;
    const t = Math.min(1, run.phaseT / FACTORY.retractS);
    const ease = 1 - (1 - t) ** 2;
    const ext = run.extension + (TUBE.stubLength - run.extension) * ease;
    run.head.copy(run.pointA).addScaledVector(run.normalA, ext);
    run.headVisual.copy(run.head);
    this.layTube(run, hw, ext, false);
    if (t >= 1) {
      run.phase = 'pull';
      run.extension = TUBE.stubLength;
      run.front = -1;
      run.phaseT = 0;
      run.lastDetent = Math.floor(TUBE.stubLength / TUBE.detentPitch);
      run.lastSections = 1;
      sfx.seatClunk();
    }
  }

  /** Both grips (or the tool's driven pair) against ONE run's collar —
   *  TubeSystem.readHands, forked with a per-run gate: acquisition only
   *  while no other run is held. */
  private readHands(run: FactoryRun): {
    holding: boolean;
    rattling: boolean;
    rattleHand: 'left' | 'right';
    mid: Vector3;
    aim: Vector3 | null;
  } {
    if (this.driven.active && this.driven.key === runKey(run)) {
      _mid.copy(this.driven.pos);
      return { holding: true, rattling: false, rattleHand: 'right', mid: _mid, aim: null };
    }
    if (this.driven.active) {
      _mid.copy(run.headVisual);
      return { holding: false, rattling: false, rattleHand: 'right', mid: _mid, aim: null };
    }

    const otherHeld = plant.runs.some((r) => r !== run && r.held);
    const grips = this.world.playerSpaceEntities?.gripSpaces;
    const objL = grips?.left?.object3D;
    const objR = grips?.right?.object3D;
    let holding = 0;
    let rattleHand: 'left' | 'right' = 'right';
    if (objL) toPlant(objL.getWorldPosition(_handL));
    if (objR) toPlant(objR.getWorldPosition(_handR));
    for (const [hand, obj, pos] of [
      ['left', objL, _handL],
      ['right', objR, _handR],
    ] as const) {
      if (!obj) continue;
      // A hand that's carrying a part is spoken for.
      if (this.carried[hand] !== undefined) continue;
      // A collar takes a grab OR a point — squeeze or trigger on a
      // controller, a fist or a pinch on a hand.
      const it = intents[hand];
      const pressed = it.grab.pressed || it.point.pressed;
      const isNear = pos.distanceTo(run.headVisual) < TUBE.grabReach;
      if (run.held) {
        const grip = Math.max(it.grab.value, it.point.value);
        if (pressed || grip > TUBE.holdSqueeze) holding++;
      } else if (isNear && pressed && !otherHeld) {
        holding++;
        rattleHand = hand;
      }
    }
    const rattling = !run.held && holding === 1;
    _mid.copy(_handL).add(_handR).multiplyScalar(0.5);

    let aim: Vector3 | null = null;
    const rays = this.world.playerSpaceEntities?.raySpaces;
    const rayL = rays?.left?.object3D;
    const rayR = rays?.right?.object3D;
    if (rayL && rayR) {
      rayL.getWorldDirection(_aimL).negate();
      rayR.getWorldDirection(_aimSum).negate().add(_aimL);
      if (_aimSum.lengthSq() > 0.5) aim = _aimSum.normalize();
    }
    return { holding: holding === 2, rattling, rattleHand, mid: _mid, aim };
  }

  /** A seated run's curve (with its control offset, if any), sampled
   *  into a point pool — the same bezier layTube draws, no meshes
   *  touched. */
  private sampleRun(run: FactoryRun, offset: Vector3 | undefined, out: Vector3[]): void {
    _mouth.copy(run.pointA);
    bendControl(_mouth, run.normalA, run.extension, _p1);
    endControl(run.headVisual, run.normalB, run.extension, _p2, 1);
    for (let k = 0; k < out.length; k++) {
      dodgedPoint(_mouth, _p1, _p2, run.headVisual, offset, k / (out.length - 1), out[k]);
    }
  }

  /** Get-or-create a run's control offset. */
  private dodgeOf(side: string): Vector3 {
    let v = this.dodgeLift.get(side);
    if (!v) {
      v = new Vector3();
      this.dodgeLift.set(side, v);
    }
    return v;
  }

  /** The minimum centreline height for a tube passing over (x, z) — the
   *  top of whatever stands there plus a bore and some air — or 0 over
   *  open floor. The run's own target box is exempt: the line has to
   *  come DOWN to seat in it. */
  private clearanceAt(x: number, z: number, targetUnit: number): number {
    const cell = worldToCell(x, z);
    let floor = 0;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const unit = unitAtCell(cell.i + di, cell.j + dj);
        if (!unit || unit.id === targetUnit) continue;
        cellCenter(unit.i, unit.j, _c);
        // Only cells the bore actually overhangs.
        if (Math.abs(x - _c.x) > CELL / 2 + 0.09 || Math.abs(z - _c.z) > CELL / 2 + 0.09) continue;
        const top =
          unit.type === 'vat'
            ? 1.16 // the tank, its lid, and whatever dances on it
            : unit.type === 'belt'
              ? unit.over !== undefined
                ? 1.08 // a bridge deck, with a part riding it
                : 1.0 // a rail, with a part riding it
              : unit.type === 'post'
                ? 0.73
                : unit.type === 'combiner'
                  ? 1.2 // the press frame's columns, and a clamp at full lift
                  : 0.99; // bench plant: drum crowns, the ram's lift, lids
        if (top > floor) floor = top;
      }
    }
    return floor;
  }

  /**
   * THE CLEARANCE PASS — tubes find paths around, not through.
   *
   * A seated run is a frozen curve, and nothing used to stop it passing
   * straight through the lanes, boxes and other tubes in its way. Two
   * sweeps fix that, both by the same move — the line BOWS, carrying an
   * offset that dodgeBump tapers to nothing at both fittings, so the
   * ends keep their axes and the polyline law keeps every joint sealed
   * through the new bend:
   *
   *   1. OVER THE PLANT: each run lifts until its belly clears whatever
   *      stands under its flight path — rails (and the parts riding
   *      them), boxes, decks, the vat. The run's own target box is
   *      exempt, since the line must come down level into its collar.
   *      (An angled-up gland mount was tried for this instead and
   *      looked wrong; the ARC over the shop is the pipe-run look.)
   *   2. OVER EACH OTHER: where two seated centrelines still come
   *      inside two bores, the LATER one lifts further — a pipe
   *      bridging a pipe, same language as a rail decking a rail.
   *
   * Held runs are never fought (a hand mid-haul gets the curve it
   * steers; the lift lands only once both ends are spoken for), and
   * clashes hard against an endpoint are left alone — a lift can't
   * separate what two neighbouring glands put next to each other, and
   * shouldn't try.
   */
  /** Sweep 1 — over the PLANT, each run on its own: raise the offset's
   *  vertical part until the belly clears whatever stands under the
   *  flight path. Runs after the pair relaxation too, because a lateral
   *  push changes what IS under the flight path. The cap is tall on
   *  purpose: a dramatic arc overhead beats any interpenetration. */
  private liftOverPlant(seated: FactoryRun[]): void {
    for (const run of seated) {
      const v = this.dodgeOf(runKey(run));
      for (let pass = 0; pass < 4; pass++) {
        this.sampleRun(run, v, this.dodgeA);
        let need = 0;
        let at = 0.5;
        // THE SEAT CORRIDOR IS EXEMPT: within reach of either endpoint
        // the line is committed to its boss height — no lift can raise
        // a pinned end, and demanding it just ratcheted the offset to
        // its cap for nothing (a lane hauled right up to a fed maker
        // used to buy every run a max-height arc AND a wrenched
        // departure). Distance to the ends, not sample index — the
        // bump shifts how the samples pace along the curve.
        for (let k = 2; k < this.dodgeA.length - 2; k++) {
          const p = this.dodgeA[k];
          const mouth = run.pointA;
          const head = run.headVisual;
          if (
            Math.hypot(p.x - mouth.x, p.z - mouth.z) < 0.45 ||
            Math.hypot(p.x - head.x, p.z - head.z) < 0.45
          ) {
            continue;
          }
          // And inside the bump's own end windows (plus their shoulders)
          // the lift has no purchase: a rail right beside a fed maker
          // used to ratchet the offset straight to its cap, for an arc
          // that cleared nothing. The window is the fitting's corridor.
          const w = dodgeBump(k / (this.dodgeA.length - 1));
          if (w < PLANT_LEVERAGE_FLOOR) continue;
          const floor = this.clearanceAt(p.x, p.z, run.targetUnit);
          // And a clash the cap can't clear is not paid for at all: a
          // press frame a few sections short of the gland used to buy
          // the tallest tent the cap allows and STILL pass through the
          // frame. Half a clearance is no clearance; the arc it costs
          // is real. Such a clash is the layout's, and stays visible.
          if ((floor - p.y) / w > DODGE_MAX_UP - v.y) continue;
          if (floor - p.y > need) {
            need = floor - p.y;
            at = k / (this.dodgeA.length - 1);
          }
        }
        if (need < 0.01) break;
        // Leverage is now EXACT: an offset v raises the line at t by
        // v·dodgeBump(t), so that is the divisor (floored, so a clash
        // out near a pinned end can't ask for an infinite lift).
        v.y = Math.min(DODGE_MAX_UP, v.y + need / Math.max(PLANT_LEVERAGE_FLOOR, dodgeBump(at)));
      }
    }
  }

  private recomputeDodges(): void {
    this.dodgeLift.clear();
    const seated = plant.runs.filter((r) => r.phase === 'seated' || r.phase === 'flowing');
    this.liftOverPlant(seated);
    // Sweep 2 — over each other: the shared pair relaxation
    // (tube/clearance.ts). Lifting only ever goes UP here — the plant is
    // down there — so sweep 1's clearance is never undone, and the cap
    // allows a full stack (plant lift + two bores + air): tall, and
    // honestly tall, where the alternative was two tubes in one air.
    const items: DodgeItem[] = seated.map((run) => ({
      lift: this.dodgeOf(runKey(run)),
      maxUp: DODGE_MAX_UP,
      maxDown: 0,
      sample: (v, out) => this.sampleRun(run, v, out),
    }));
    relaxPairs(items, this.dodgeA, this.dodgeB, CLEAR_BORE, 0.8);
    // A lateral push may have moved a belly over different plant — the
    // vertical sweep gets the last word (it only ever raises).
    this.liftOverPlant(seated);
  }

  /** TubeSystem.layTube, forked verbatim onto the FactoryRun record. */
  private layTube(run: FactoryRun, hw: RunHw, ext: number, entering: boolean): void {
    _mouth.copy(run.pointA);
    // THE TELESCOPE IS SIZED TO THE JOB, as the wall game's always was:
    // the sections spread over THIS run's length, so the tube tapers
    // root-fat at the spout to head-thin at the collar and arrives at
    // the bore every fitting is built around. Sized to the 7 m ceiling
    // instead (the fork's own drift), a short factory run unfurled one
    // or two sections and delivered a pipe FATTER than the gland it was
    // landing in — the port vanished behind it and nothing could sit
    // flush. The pull's own stop stays the long one (below).
    const maxExt = maxExtensionFor(ext);
    bendControl(_mouth, run.normalA, ext, _p1);
    if (entering) {
      _entry.copy(run.normalB);
    } else {
      _chord.copy(run.headVisual).sub(_mouth).normalize();
      if (run.held && run.aimOk) {
        _entry
          .copy(_chord)
          .multiplyScalar(1 - TUBE.steerBlend)
          .addScaledVector(run.aim, TUBE.steerBlend);
        if (_entry.lengthSq() < 0.01) _entry.copy(_chord);
        _entry.normalize().negate();
      } else {
        _entry.copy(_chord).negate();
      }
    }
    endControl(run.headVisual, _entry, ext, _p2, run.held && run.aimOk && !entering ? TUBE.steerReach : 1);

    // The clearance pass lands here — as a BUMP ON THE CURVE, never a
    // shove on the controls. The controls are the end tangents: moving
    // them tipped the tube off the spout's boss line and, worse, off the
    // gland's axis at the far end, so a dodged run stabbed past its own
    // socket into the box (measured at 52 degrees). dodgeBump is zero,
    // with zero slope, at both ends: the ends keep their axes exactly
    // and the whole offset is spent over the shop floor in between.
    // Whatever the phase: a seated run wears its solved offset, and a
    // run tugged loose or retracting keeps wearing the DRAWN one while
    // it eases back to nothing — the arc relaxes into the hands instead
    // of collapsing the instant the seal breaks.
    const shown = this.dodgeShown.get(runKey(run));
    const lift = shown && shown.lengthSq() > 1e-8 ? shown : undefined;

    const spans = segmentSpans(ext, maxExt);
    const extSafe = Math.max(0.001, ext);
    for (let i = 0; i < hw.segments.length; i++) {
      const seg = hw.segments[i];
      const span = spans[i];
      const on = Boolean(span);
      seg.shell.visible = on;
      seg.rib.visible = on;
      if (!span) {
        seg.pour.visible = false;
        seg.joint.visible = false;
        continue;
      }
      dodgedPoint(_mouth, _p1, _p2, run.headVisual, lift, span.s0 / extSafe, _pA);
      dodgedPoint(_mouth, _p1, _p2, run.headVisual, lift, Math.min(1, span.s1 / extSafe), _pB);
      _tangent.copy(_pB).sub(_pA);
      let chord = _tangent.length();
      if (chord < 1e-5) {
        dodgedTangent(_mouth, _p1, _p2, run.headVisual, lift, span.s0 / extSafe, _tangent);
        chord = span.s1 - span.s0;
      } else {
        _tangent.divideScalar(chord);
      }
      _quat.setFromUnitVectors(UP_Y, _tangent);
      seg.shell.position.copy(_pA).add(_pB).multiplyScalar(0.5);
      seg.shell.quaternion.copy(_quat);
      seg.shell.scale.set(span.radius, chord + SHELL_PAD, span.radius);
      if (span.index === 0) _prevDir.copy(run.normalA);
      const kink = _prevDir.distanceTo(_tangent);
      _prevDir.copy(_tangent);
      dodgedTangent(_mouth, _p1, _p2, run.headVisual, lift, Math.min(1, span.s1 / extSafe), _jointDir);
      seg.rib.position.copy(_pB);
      seg.rib.quaternion.copy(_quat2.setFromUnitVectors(FWD_Z, _jointDir));
      seg.rib.scale.z = span.radius * 1.1;
      if (span.index > 0) {
        hw.segments[span.index - 1].rib.scale.z =
          spans[span.index - 1].radius * 1.1 * (1 + Math.min(1.4, kink * 2.5));
      }
      // THE POUR: one column, elbowed with balls at every joint, running
      // on into the gland's throat at the seat (build.posePour).
      const into = entering && i === spans.length - 1 ? TUBE.pourSeatReach : 0;
      posePour(
        seg,
        span,
        _pA,
        _pB,
        _tangent,
        _quat,
        chord,
        into,
        _quat2.setFromUnitVectors(UP_Y, _jointDir),
        i < spans.length - 1,
      );
    }

    dodgedTangent(_mouth, _p1, _p2, run.headVisual, lift, 1, _tangent);
    hw.collar.group.position.copy(run.headVisual);
    hw.collar.group.quaternion.copy(_quat.setFromUnitVectors(FWD_Z, _tangent));
  }

  private tickCollarTell(run: FactoryRun, hw: RunHw): void {
    const breathe = 0.5 + 0.5 * Math.sin(this.clock * 2.6);
    if (run.phase === 'pull') {
      if (run.magnet) {
        hw.collar.capMat.opacity = 0.95;
        hw.collar.glowMat.opacity = 0.5;
      } else if (run.held) {
        hw.collar.capMat.opacity = 0.7;
        hw.collar.glowMat.opacity = 0.28;
      } else {
        hw.collar.capMat.opacity = 0.4 + 0.35 * breathe;
        hw.collar.glowMat.opacity = 0.12 + 0.16 * breathe;
      }
    } else {
      hw.collar.capMat.opacity = 0.25;
      hw.collar.glowMat.opacity = 0.1;
    }
  }

  private tickGlandTells(): void {
    // Free glands breathe their guides while any collar is loose or held
    // — and SWIVEL: a seated gland holds its run's line, a free one
    // turns to face whichever tube is nearest your hands. The box you
    // are walking a tube toward opens its door as you come.
    for (const unit of plant.units) {
      const gland = this.unitRefs.get(unit.id)?.gland;
      if (!gland) continue;
      const seated = runSeatedAt(unit.id);
      let candidate: FactoryRun | undefined;
      let proximity = 0;
      let toward: Vector3 | undefined;
      if (seated) {
        toward = seated.pointA;
      } else {
        let bestD = Infinity;
        for (const run of plant.runs) {
          if (run.phase !== 'pull') continue;
          if (run.spurnUnit === unit.id && run.spurnT > 0) continue;
          if (run.magnet && run.targetUnit !== unit.id) continue;
          // Reserve a captured gland for its incoming collar.
          if (plant.runs.some((other) => other !== run && other.magnet && other.targetUnit === unit.id)) continue;
          glandPose(unit, _g, _gn, run.pointA);
          _seat.copy(_g).addScaledVector(_gn, FACTORY.glandSeat);
          const d = run.headVisual.distanceTo(_seat);
          if (d < bestD) {
            bestD = d;
            candidate = run;
            toward = run.pointA;
          }
        }
        if (candidate?.held || candidate?.magnet) proximity = 1 - bestD / (FACTORY.seatRadius * 3);
      }
      const source = seated ?? candidate;
      gland.guideMat.color.setHex(source?.line.glow ?? 0xfff0dc);
      gland.glowMat.color.copy(gland.guideMat.color);
      const arrival = seated ? Math.max(0, 1 - seated.phaseT / 0.55) : 0;
      gland.glowMat.opacity = seated
        ? Math.min(1, 0.2 + seated.energy * 0.35 + arrival * 0.4)
        : 0.15 + Math.max(0, proximity) * 0.2;
      updateConnectionGuide(gland, this.clock, proximity, candidate?.magnet ?? false,
        candidate?.seatP ?? 0, seated?.phase ?? 'pull', seated?.phaseT ?? 0);
      this.poseGland(unit, gland.group, toward);
    }
  }

  /** Swing a gland's collar round its unit to face `toward` (world), or
   *  home to the back face. The mesh is a child of the unit's rotated
   *  group, so the world direction is folded back through that yaw. */
  private poseGland(unit: (typeof plant.units)[number], group: Group, toward?: Vector3): void {
    glandPose(unit, _g, _gn, toward);
    const d = DIRS[unit.rot];
    const yaw = Math.atan2(d.di, d.dj);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const lx = _gn.x * cos - _gn.z * sin;
    const lz = _gn.x * sin + _gn.z * cos;
    // The mesh stands exactly where the seat maths thinks it does — one
    // reach for both, so the collar can't press against thin air.
    const reach = glandReach(unit.type) + 0.001;
    group.position.set(lx * reach, UNITS.glandHeight, lz * reach);
    group.rotation.order = 'YXZ';
    group.rotation.set(0, Math.atan2(lx, lz), 0);
  }

  /* ── events, parts, dressing, the plate ───────────────────────────────── */

  private drainEvents(): void {
    for (const ev of plant.events.splice(0)) {
      if (ev.kind === 'craft') {
        sfx.segmentClick(3);
      } else if (ev.kind === 'deliver') {
        sfx.sectionArrive(1);
        this.dockFlash = 1;
      } else if (ev.kind === 'wreck') {
        sfx.clangWreck();
      } else if (ev.kind === 'bank') {
        sfx.uiHover();
        this.dockFlash = 0.6;
      } else if (ev.kind === 'feed-wake') {
        sfx.wallKnock();
        sfx.socketWake();
        if (ev.side) this.feedFlash.set(ev.side, 1);
      } else if (ev.kind === 'post') {
        sfx.stampDone();
      } else if (ev.kind === 'unseat') {
        // ONE DOOR FOR EVERY UNPLUG. The tug, the box panel's UNPLUG, Ⓑ
        // on a plumbed box and the wrecking bar all end in sim's
        // retractRun, which pushes this — so the hum stops and the iris
        // shuts exactly once, however the seal was broken. (Ⓑ used to
        // call retractRun straight and leave a maker humming at a tube
        // that had gone home.)
        if (ev.key) {
          const hw = this.runHw.get(ev.key);
          if (hw?.humOn) {
            sfx.stopHum(`plant-${ev.key}`);
            hw.humOn = false;
          }
        }
        const gland = ev.unit !== undefined ? this.unitRefs.get(ev.unit)?.gland : null;
        if (gland) gland.iris.visible = true;
        // A vat that loses its line keeps its level and waits.
        sfx.boltSpin();
      } else if (ev.kind === 'goop') {
        // THE VAT IS FULL. GoopSystem watches plant.goop and does the
        // rest; this is the noise and the shove in the wrists.
        sfx.goopRise();
        buzz(this.world, 'both', 1, 220);
      } else if (ev.kind === 'complete') {
        sfx.stampDone();
        sfx.ceremonyChord();
        orderComplete();
      }
    }
  }

  private renderParts(): void {
    const counts = new Map<ItemId, number>();
    const grips = this.world.playerSpaceEntities?.gripSpaces;
    for (const part of plant.parts) {
      const pools = this.partPools.get(part.item);
      const locals = this.partLocals.get(part.item);
      if (!pools || !locals) continue;
      const idx = counts.get(part.item) ?? 0;
      if (idx >= 64) continue;
      counts.set(part.item, idx + 1);
      let born = this.partSeen.get(part.id);
      if (born === undefined) {
        born = this.clock;
        this.partSeen.set(part.id, born);
      }
      const age = this.clock - born;
      // A part is BORN with a punch — a clack as it lands on the chute.
      // (It was a 2.4× pop, the one moment that said "the maker made
      // something"; the craft theatre now shows the whole making, and
      // the ghost hands off to the part in place, so the pop is a nudge.)
      const punch = age < 0.3 ? 1 + 0.4 * (1 - age / 0.3) ** 3 : 1;
      const inHand = part.at.kind === 'hand';
      // A COMBINER'S PORT PARTS, mid-craft, are walked in and fitted by
      // the theatre: the pose comes from the rig, in the unit's frame.
      const portRefs = part.at.kind === 'port' ? this.unitRefs.get(part.at.unit) : undefined;
      if (portRefs?.craft?.portOn && part.at.kind === 'port') {
        _m4.multiplyMatrices(portRefs.group.matrix, portRefs.craft.portPose[part.at.port]);
      } else {
        if (inHand) {
          const obj = grips?.[(part.at as { hand: 'left' | 'right' }).hand]?.object3D;
          if (obj) toPlant(obj.getWorldPosition(_pA));
          else partPose(part, _pA);
        } else {
          partPose(part, _pA);
        }
        // A slow idle turn, offset per part — parts at rest read as
        // alive; a part in the fist holds still.
        const spin = inHand ? 0 : this.clock * 0.7 + part.id * 1.3;
        _q.setFromAxisAngle(UP_Y, spin);
        _m4.compose(_pA, _q, _v3.set(punch, punch, punch));
      }
      for (let c = 0; c < pools.length; c++) {
        _m4b.multiplyMatrices(_m4, locals[c]);
        pools[c].setMatrixAt(idx, _m4b);
      }
    }
    // THE PHANTOMS: a maker's part-in-the-making, drawn through the same
    // pools as the parts — the rig has already folded each component's
    // kit matrix in, so only the unit's own frame is left to apply.
    for (const refs of this.unitRefs.values()) {
      const rig = refs.craft;
      if (!rig || rig.phantomN === 0 || !rig.item) continue;
      const pools = this.partPools.get(rig.item);
      if (!pools) continue;
      const idx = counts.get(rig.item) ?? 0;
      if (idx >= 64) continue;
      counts.set(rig.item, idx + 1);
      for (let c = 0; c < pools.length && c < rig.phantomN; c++) {
        _m4b.multiplyMatrices(refs.group.matrix, rig.phantom[c]);
        pools[c].setMatrixAt(idx, _m4b);
      }
    }
    if (this.partSeen.size > 256) {
      const live = new Set(plant.parts.map((p) => p.id));
      for (const id of [...this.partSeen.keys()]) if (!live.has(id)) this.partSeen.delete(id);
    }
    for (const [item, pools] of this.partPools) {
      const n = counts.get(item) ?? 0;
      for (const pool of pools) {
        pool.count = n;
        pool.instanceMatrix.needsUpdate = true;
      }
    }
  }

  /** A craft cue → the shop's noise for it. Silenced under the tools'
   *  fast-forward, where a four-second craft plays in a fraction of one
   *  and every cue would land in the same frame. */
  private craftCue = (cue: CraftCue, n: number): void => {
    if (plant.timeScale > 2 || site.screen !== 'factory') return;
    if (cue === 'strike') sfx.forgeStrike(n);
    else if (cue === 'press') sfx.hydraulicSigh();
    else if (cue === 'charge') sfx.chargeRise(0.5);
    else if (cue === 'etch') sfx.segmentClick(8 + n);
    else if (cue === 'pin' || cue === 'spark') sfx.arcZap();
    else if (cue === 'thread' || cue === 'spin') sfx.servoRun(cue === 'spin');
    else if (cue === 'seat') sfx.latchDogs();
    else if (cue === 'torque') sfx.segmentClick(4 + n * 3);
    else if (cue === 'lit') sfx.flowArrive('volt');
  };

  /** The working tells: craft lamps pulse, THE CRAFT THEATRE plays each
   *  item's own making on its machine (factory/craft.ts), and the dock's
   *  halo breathes — flashing when a delivery lands. (The COUNT lives on
   *  the Ⓐ card, not in the room — the halo only says "it went in".)
   *  `dt` is sim time (scaled); `delta` is wall time for the tells that
   *  should not speed up with the tools' fast-forward. */
  private tickUnitDressing(delta: number, dt: number): void {
    this.dockFlash = Math.max(0, this.dockFlash - delta * 2.2);
    const breathe = 0.5 + 0.5 * Math.sin(this.clock * 2.2);
    // THE BREW. The level in the vat is the only progress bar in TUBES
    // that is a real object in your room, and it is worth the fuss: it
    // comes up while the green line pours, bubbles as it goes, and
    // DRAINS as the thing inside it stands up and climbs out.
    const brewing = plant.goop === 'brewing';
    if (plant.goop === 'born' || plant.goop === 'dancing' || plant.goop === 'done') {
      this.vatDrain = Math.min(1, this.vatDrain + delta / 1.8);
    } else if (plant.goop === 'none') {
      this.vatDrain = 0;
    }
    if (brewing) {
      this.bubbleT -= delta;
      if (this.bubbleT <= 0) {
        const fill = Math.min(1, plant.brewT / UNITS.vat.brewS);
        this.bubbleT = 1.5 - fill * 1.0;
        sfx.vatBubble(fill);
      }
    } else {
      this.bubbleT = 0;
    }
    const brewP =
      Math.min(1, plant.brewT / UNITS.vat.brewS) * (1 - this.vatDrain);

    for (const unit of plant.units) {
      const refs = this.unitRefs.get(unit.id);
      if (!refs) continue;
      const crafting = unit.craftT >= 0;
      // THE MAKER WEARS ITS LINE. Bands sit furnace-orange while the box
      // is cold and ease over to the seated line's colour — with a low
      // ember of the same in the emissive once it is actually fed — so
      // "which maker is the violet one" is answered from across the room
      // by the box itself, not by tracing a tube.
      if (refs.tint && unit.type === 'maker') {
        const seated = runSeatedAt(unit.id);
        if (seated) _tintColor.setHex(seated.line.glow).multiplyScalar(0.75);
        else _tintColor.setHex(MAKER_ACCENT);
        refs.tint.color.lerp(_tintColor, Math.min(1, delta * 5));
        // NEON: the bands always glow — dim in their own orange while the
        // box is cold, full in the line's colour once it is fed.
        const lit = seated && seated.phase === 'flowing' ? 1.1 : 0.55;
        _tintColor.setHex(seated ? seated.line.glow : MAKER_ACCENT).multiplyScalar(lit);
        refs.tint.emissive.lerp(_tintColor, Math.min(1, delta * 5));
      }
      if (refs.lampMat) {
        refs.lampMat.opacity = crafting
          ? 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(this.clock * 6))
          : 0.12;
      }
      if (refs.craft) {
        // What is being made, and how far along: the sim's own craft
        // clock over the craft's own length (QUICK BOXES shortens both).
        const rig = refs.craft;
        let item: ItemId | null = null;
        let p = -1;
        const ctx = this.craftCtx;
        ctx.ports[0] = null;
        ctx.ports[1] = null;
        if (unit.type === 'maker') {
          const seated = runSeatedAt(unit.id);
          item = (seated ? MAKES[seated.line.id] : undefined) ?? rig.item;
          if (crafting && item) p = Math.min(1, unit.craftT / (FACTORY.makerS * craftFactor()));
        } else {
          const a = unit.ports[0] >= 0 ? partById(unit.ports[0]) : undefined;
          const b = unit.ports[1] >= 0 ? partById(unit.ports[1]) : undefined;
          ctx.ports[0] = a?.item ?? null;
          ctx.ports[1] = b?.item ?? null;
          ctx.portSpin[0] = this.clock * 0.7 + (a?.id ?? 0) * 1.3;
          ctx.portSpin[1] = this.clock * 0.7 + (b?.id ?? 0) * 1.3;
          if (a && b) item = COMBINES[combineKey(a.item, b.item)] ?? null;
          if (crafting && item) p = Math.min(1, unit.craftT / (FACTORY.combinerS * craftFactor()));
        }
        const queue = chuteParts(unit.id).length;
        ctx.dt = dt;
        ctx.clock = this.clock;
        ctx.slotZ = chuteReach(Math.min(FACTORY.chuteSlots - 1, queue));
        ctx.chuteFull = queue >= FACTORY.chuteSlots;
        ctx.spinTarget = this.clock * 0.7 + plant.nextPart * 1.3;
        tickCraft(rig, item, p, ctx);
      }
      if (refs.halo) {
        refs.halo.opacity = 0.16 + 0.14 * breathe + 0.55 * this.dockFlash;
      }
      if (refs.fill) {
        // The level, in the tank's own local space. It surges a little as
        // it fills — a tank that comes up perfectly smoothly reads as a
        // loading bar, and this is meant to read as a liquid.
        const h = Math.max(0.0005, refs.fill.top * brewP);
        refs.fill.mesh.visible = brewP > 0.002;
        refs.fill.mesh.scale.y = h;
        refs.fill.mesh.position.y = refs.fill.floor + h / 2;
        refs.fill.time.value = this.clock;
        refs.fill.height.value = h;
        refs.fill.activity.value += ((brewing ? 1 : 0) - refs.fill.activity.value) * (1 - Math.exp(-delta * 3));
        refs.fill.mat.emissiveIntensity = 0.6 + 0.5 * breathe;
      }
      if (refs.vatGlow) {
        refs.vatGlow.opacity = 0.1 + 0.12 * breathe + 0.35 * brewP;
      }
    }
  }
}
