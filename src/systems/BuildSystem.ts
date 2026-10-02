/**
 * BuildSystem — stamping plant onto the lattice, and taking it off again.
 *
 * The flange's own grammar, aimed at the floor: arm a tool from the Ⓐ
 * card and its ghost rides the right controller's ray onto the grid cell
 * under it. Trigger stamps; an occupied or off-site cell refuses with the
 * one-hand rattle.
 *
 * THREE THINGS PLAYTEST TAUGHT THIS FILE:
 *
 *  1. THE FACING IS OURS, NOT YOURS. A rail turns itself to feed
 *     whatever it touches, a maker turns its chute toward a rail, a
 *     combiner turns so its ports face the lines that would fill them
 *     (sim.bestRot). Your aim only breaks ties. Nobody should ever have
 *     to solve a rotation puzzle to lay a conveyor.
 *  2. THE LINK IS DRAWN BEFORE YOU COMMIT. While the ghost stands, amber
 *     chevrons show exactly what it will feed and what will feed it —
 *     and a rail pointed at something with no use for parts (a maker)
 *     simply shows no chevron. "Only attaches where it has function",
 *     made visible.
 *  3. DELETE IS A TOOL, NOT A SECRET. DELETE sits in the card beside
 *     the boxes and paints its target red — which freed Ⓑ up.
 *  4. AND Ⓑ TURNS THE PIECE. Auto-facing is the default, not a cage:
 *     with a piece in hand Ⓑ ratchets it a quarter turn and that
 *     choice wins until it lands. Empty-handed, Ⓑ UNPLUGS whatever the
 *     ray is on if a line is seated there, and unbolts it otherwise.
 *     One button, and what you are holding says which verb it is.
 *  5. AND AN EMPTY HAND OPENS THE BOX. With no tool armed, the trigger
 *     on standing plant raises THE BOX PANEL — what is inside it, what
 *     is plumbed into it, UNPLUG, TURN, TAKE IT OUT. Playtest went
 *     looking for a chest's contents and for a way to pull a tube off a
 *     maker, and found neither; both live there now.
 *  6. AND Ⓧ PUTS IT DOWN. Arming a tool from the card was a one-way
 *     door: the only ways back out were to raise the card again and
 *     press the same tool a second time, or to build something you did
 *     not want. Ⓧ on the LEFT controller drops whatever is in your
 *     hand — the ghost, the links, and a rail run you are mid-haul on —
 *     and gives you the empty hand back, which is also the hand that
 *     opens boxes. One button, always available, never destructive.
 *     (Ⓨ does the same: it is the other button under that thumb.)
 *
 * This system MUTATES the plant only (factory/sim.ts's doors) — meshes
 * belong to FactorySystem.
 */

import { intents } from '../input/intents.js';
import { createSystem } from '@iwsdk/core';
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import { UNITS, type UnitType } from '../config.js';
import { PLANT_SCALE, ensurePlantRoot, plantRoot } from '../factory/frame.js';
import { buildUnit, setBeltForm, type UnitRefs } from '../factory/units.js';
import * as sfx from '../audio/sfx.js';
import { buzz } from '../game/haptics.js';
import { site } from '../game/state.js';
import { postsUnlocked } from '../game/progress.js';
import {
  cellCenter,
  cellInFloor,
  occupiedCells,
  occupiedCount,
  worldToCell,
  type Cell,
} from '../floor/grid.js';
import {
  beltEntryAt,
  bestRot,
  canBridge,
  canLink,
  emits,
  haulRoute,
  layBridge,
  layHaul,
  canAfford,
  refundUnit,
  placeUnit,
  removeUnit,
  retractRun,
  unitAvailable,
  type HaulStep,
} from '../factory/sim.js';
import { DIRS, plant, runSeatedAt, unitAtCell, type Rot } from '../factory/state.js';
import { PointerRay } from '../ui/pointer.js';

/** What the hands can hold: a kind of plant, or the wrecking bar. */
export type BuildTool = UnitType | 'delete';

/** Headless/dev hooks (wired into __tubes in main.ts). */
export const buildView: {
  /** The cell under the reticle right now (null = no honest aim). */
  aim?: () => (Cell & { free: boolean }) | null;
  /** Arm a tool for the hologram (null disarms). The card drives this. */
  arm?: (tool: BuildTool | null) => void;
  armed?: () => BuildTool | null;
  /** Ⓑ while a piece is in hand: turn it a quarter, overriding the
   *  auto-facing until it lands. Returns the new rotation. */
  turn?: () => Rot | null;
  /** Which way the ghost currently points (null = nothing aimed). */
  facing?: () => Rot | null;
  /** The live Ⓑ override, or null when auto-facing is back in charge. */
  forcedRot?: () => Rot | null;
  placeAt?: (i: number, j: number, type?: UnitType, rot?: Rot) => boolean;
  removeAt?: (i: number, j: number) => boolean;
  count?: () => number;
  cells?: () => Cell[];
  catalogue?: () => { available: UnitType[] };
  /**
   * THE HANDS' OWN PATH, headless. `aimAt` puts the reticle on a world
   * point exactly as the ray would; `trigger` presses. Everything the
   * controller does — auto-facing, the link law, the refusals — runs
   * here too, so a walk can prove the game is BUILDABLE, not merely
   * that the sim is correct. (Every brick wall playtest hit lived in
   * this gap: the old walks called placeAt directly and never touched
   * the UX at all.)
   */
  aimAt?: (x: number, z: number, handRot?: Rot) => {
    cell: Cell;
    placeable: boolean;
    rot: Rot;
    feeds: Cell | null;
    fedBy: Cell[];
    /** True when the press would DECK the rail standing here rather
     *  than stand a piece — a bridge, not a refusal. */
    bridge?: boolean;
  } | null;
  trigger?: () => boolean;
  /**
   * THE HAUL, headless. `trigger` on an armed rail starts one (exactly
   * as the press does); `haulTo` drags it — returning the route it
   * would lay — and `haulRelease` lets go and reports how many rails
   * landed. A walk pulls a run the way a hand does, so "it lays six
   * rails" means the verb works, not that the maths does.
   */
  haulTo?: (x: number, z: number) => HaulStep[];
  haulRelease?: () => number;
  hauling?: () => { anchor: Cell; steps: HaulStep[] } | null;
  /** How many meshes each tool's hologram is made of. The ghost used to
   *  be one anonymous crate for everything; this is how a walk proves it
   *  wears the machine now, and keeps wearing it. */
  ghostParts?: () => Record<string, number>;
  /**
   * Ⓧ'S OWN DOOR — put the armed tool away and drop any haul in
   * progress. The button calls exactly this, so a walk pressing `stow()`
   * is pressing Ⓧ. Returns true if there was anything to put down.
   */
  stow?: () => boolean;
} = {};

const _origin = new Vector3();
const _dir = new Vector3();
const _hit = new Vector3();
const _c = { x: 0, z: 0 };
const _c2 = { x: 0, z: 0 };

/** A flat chevron pair, unit-scaled, pointing along +Z. */
function chevronGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  const v: number[] = [];
  for (const z of [-0.4, 0.15]) {
    v.push(-0.5, 0, z, 0.5, 0, z, 0, 0, z + 0.45);
  }
  g.setAttribute('position', new Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

export class BuildSystem extends createSystem({}) {
  private pointer!: PointerRay;
  private ghost!: Group;
  private ghostMat!: MeshBasicMaterial;
  private arrowMat!: MeshBasicMaterial;
  private focus!: LineSegments;
  private focusMat!: LineBasicMaterial;
  /** Preview chevrons: [0] what we feed, [1..] what feeds us. */
  private links: Mesh[] = [];
  private linkMat!: MeshBasicMaterial;
  /** One ghost body per tool — the real silhouette, in glass. Kept as
   *  full refs so the rail ghost can dress in its curve and deck forms. */
  private bodies!: Map<UnitType, UnitRefs>;
  /** The haul's own ghosts: the run you are dragging out, before it is
   *  real. Pooled to UNITS.pull.maxRun; each wears a rail body. */
  private haulGhosts: UnitRefs[] = [];
  /** The same run, as plate: a WALL haul draws these instead. */
  private wallGhosts: UnitRefs[] = [];
  /** Live haul, while the trigger is down on an armed rail. */
  private haul: { anchor: Cell; steps: HaulStep[]; kind: 'belt' | 'wall' } | null = null;
  private haulHeld = false;
  /** A headless haul is driven by haulTo/haulRelease, not by a trigger,
   *  and there is no controller ray behind it — so the every-frame
   *  hideAim (which fires whenever the ray is missing, i.e. always, in a
   *  browser with no XR device) must not reach in and cancel it. */
  private haulDriven = false;
  private armed: BuildTool | null = null;
  /**
   * THE HAND'S OVERRIDE. Auto-facing is right almost every time, and
   * when it isn't there has to be a way to say so — playtest asked for
   * exactly this, on belts. Ⓑ sets a rotation here and it WINS over
   * bestRot until the piece lands (or the tool changes), so pressing Ⓑ
   * visibly turns the ghost a quarter turn each time instead of being
   * argued back into place by the scorer. null = let the plant decide.
   */
  private forced: Rot | null = null;
  private clock = 0;
  private lastAim: (Cell & { free: boolean }) | null = null;
  /** The live aim, recomputed by both the ray and the headless hook. */
  private view: {
    cell: Cell;
    placeable: boolean;
    rot: Rot;
    feeds: Cell | null;
    fedBy: Cell[];
    bridge?: boolean;
  } | null = null;
  /** The tools' last headless aim (see buildView.aimAt). */
  private headless: { x: number; z: number; handRot: Rot } | null = null;

  init(): void {
    ensurePlantRoot(this.scene);
    this.pointer = new PointerRay(this.scene);

    this.ghostMat = new MeshBasicMaterial({
      color: 0xffa22e,
      transparent: true,
      opacity: 0.16,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.arrowMat = this.ghostMat.clone();
    this.arrowMat.opacity = 0.85;
    this.ghost = new Group();
    const { benchTop } = UNITS.crate;
    // THE GHOST WEARS THE MACHINE. It used to be one anonymous crate for
    // every tool, which meant the catalogue told you what you'd picked
    // and the floor didn't — you found out what you had built by
    // building it. Each type now holds its OWN body, made by the very
    // same builder FactorySystem uses, wearing the ghost's glass: a
    // maker's drum and piston, the combiner's twin lobes, the bank's
    // mouth, the crate's bands, a post's stick. One is shown at a time.
    this.bodies = new Map();
    for (const type of ['dock', 'maker', 'belt', 'combiner', 'chest', 'post', 'vat', 'turret', 'wall', 'flamer', 'piston', 'tesla', 'mortar'] as UnitType[]) {
      const refs = buildUnit(type);
      refs.group.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) m.material = this.ghostMat;
        o.renderOrder = 11;
      });
      refs.group.visible = false;
      this.ghost.add(refs.group);
      this.bodies.set(type, refs);
    }
    // THE OUT ARROW — big, lifted, unmissable. The old one was a 5 cm
    // triangle lying on the bench top; nobody ever saw which way a box
    // was pointing.
    const arrow = new Mesh(chevronGeometry(), this.arrowMat);
    arrow.scale.set(0.17, 1, 0.19);
    arrow.position.set(0, benchTop + 0.13, UNITS.crate.size / 2 + 0.02);
    this.ghost.add(arrow);
    this.ghost.visible = false;
    plantRoot.add(this.ghost);

    this.focusMat = new LineBasicMaterial({
      color: 0xffa22e,
      transparent: true,
      opacity: 0.9,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.focus = new LineSegments(new EdgesGeometry(new BoxGeometry(1, 1, 1)), this.focusMat);
    this.focus.visible = false;
    plantRoot.add(this.focus);

    this.linkMat = new MeshBasicMaterial({
      color: 0xffd79a,
      transparent: true,
      opacity: 0.75,
      blending: AdditiveBlending,
      depthWrite: false,
      side: 2,
    });
    const chev = chevronGeometry();
    for (let i = 0; i < 5; i++) {
      const m = new Mesh(chev, this.linkMat);
      m.scale.set(0.1, 1, 0.13);
      m.visible = false;
      m.renderOrder = 13;
      plantRoot.add(m);
      this.links.push(m);
    }

    // The run you are hauling out, drawn as rails before it is rails —
    // full refs each, so a cornering step ghosts its curve and a
    // crossing step ghosts the deck it will lay.
    for (let i = 0; i < UNITS.pull.maxRun; i++) {
      const refs = buildUnit('belt');
      refs.group.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) m.material = this.ghostMat;
        o.renderOrder = 11;
      });
      refs.group.visible = false;
      plantRoot.add(refs.group);
      this.haulGhosts.push(refs);
      // …and the same run as WALL, for when it is plate you are hauling.
      const wall = buildUnit('wall');
      wall.group.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) m.material = this.ghostMat;
        o.renderOrder = 11;
      });
      wall.group.visible = false;
      plantRoot.add(wall.group);
      this.wallGhosts.push(wall);
    }

    buildView.aim = () => (this.lastAim ? { ...this.lastAim } : null);
    buildView.arm = (tool) => {
      this.armed = tool;
      this.forced = null;
    };
    buildView.turn = () => {
      if (!this.armed || this.armed === 'delete') return null;
      this.forced = (((this.view?.rot ?? this.forced ?? 0) + 1) % 4) as Rot;
      if (this.headless) this.view = this.resolve(worldToCell(this.headless.x, this.headless.z), this.headless.handRot);
      return this.forced;
    };
    buildView.facing = () => this.view?.rot ?? null;
    /** The hand's override, if one is live — null means the plant is
     *  choosing again. A walk reads this to prove Ⓑ is per-piece. */
    buildView.forcedRot = () => this.forced;
    buildView.armed = () => this.armed;
    buildView.ghostParts = () => {
      const out: Record<string, number> = {};
      for (const [type, body] of this.bodies) {
        let n = 0;
        body.group.traverse((o) => {
          if ((o as Mesh).isMesh) n++;
        });
        out[type] = n;
      }
      return out;
    };
    buildView.placeAt = (i, j, type = 'chest', rot = 0) => placeUnit(type, i, j, rot) !== null;
    buildView.removeAt = (i, j) => {
      const unit = unitAtCell(i, j);
      if (!unit) return false;
      removeUnit(unit);
      return true;
    };
    buildView.catalogue = () => ({
      available: (
        ['dock', 'maker', 'belt', 'combiner', 'chest', 'post', 'vat', 'turret', 'wall', 'flamer', 'piston', 'tesla', 'mortar'] as UnitType[]
      ).filter((t) => typeAvailable(t)),
    });
    buildView.count = () => occupiedCount();
    buildView.cells = () => occupiedCells();
    // The headless aim REMEMBERS its arguments rather than parking a
    // view the next frame's real ray would trample: trigger() re-resolves
    // from the same spot, so a tool presses exactly what it aimed at.
    buildView.aimAt = (x, z, handRot = 0) => {
      this.headless = { x, z, handRot };
      const v = this.resolve(worldToCell(x, z), handRot);
      return v ? { ...v } : null;
    };
    buildView.trigger = () => {
      const h = this.headless;
      if (!h) return false;
      const cell = worldToCell(h.x, h.z);
      // With nothing armed the trigger OPENS THE BOX, exactly as the
      // controller's does — so a walk can prove the panel is reachable
      // by pointing and pressing, not only by calling into the menu.
      if (!this.armed) {
        const standing = unitAtCell(cell.i, cell.j);
        if (!standing) return false;
        site.inspect = standing.id;
        site.paused = true;
        return true;
      }
      const v = this.resolve(cell, h.handRot);
      const ok = this.commit(v);
      // A landed rail is a haul waiting to happen — the same as the
      // press. haulTo/haulRelease then drive it, or ignore it, and a
      // released haul of zero cells is just the single rail you placed.
      // (A press that DECKED a crossing is not a fresh anchor — the rail
      // underneath already points wherever its own lane goes.)
      if (ok && (this.armed === 'belt' || this.armed === 'wall') && !v?.bridge) {
        this.haul = { anchor: { ...cell }, steps: [], kind: this.armed };
        this.haulHeld = true;
        this.haulDriven = true;
      }
      return ok;
    };
    buildView.haulTo = (x, z) => {
      const h = this.haul;
      if (!h) return [];
      h.steps = this.routeFor(h, worldToCell(x, z));
      this.showHaul(h.steps, h.anchor, h.kind);
      return h.steps.map((s) => ({ ...s }));
    };
    buildView.haulRelease = () => {
      const h = this.haul;
      if (!h) return 0;
      this.showHaul([]);
      this.haul = null;
      this.haulHeld = false;
      this.haulDriven = false;
      return layHaul(h.anchor, h.steps, h.kind);
    };
    buildView.hauling = () =>
      this.haul ? { anchor: { ...this.haul.anchor }, steps: this.haul.steps.map((s) => ({ ...s })) } : null;
    buildView.stow = () => this.stow();
  }

  /**
   * PUT IT DOWN. The ghost goes, the link chevrons go, a run you were
   * mid-haul on is dropped where it stands (the ANCHOR rail stays — it
   * landed on the press, before the drag ever started, and pretending
   * otherwise would be a different verb), and the hand is empty again.
   *
   * Deliberately never destructive: nothing already on the floor comes
   * off, and the Ⓑ override is cleared so the next piece you pick up
   * starts by facing itself, the way a freshly-armed tool always does.
   */
  private stow(): boolean {
    if (!this.armed && !this.haul) return false;
    if (this.haul) {
      this.showHaul([]);
      this.haul = null;
      this.haulHeld = false;
      this.haulDriven = false;
    }
    this.armed = null;
    this.forced = null;
    this.view = null;
    this.ghost.visible = false;
    for (const m of this.links) m.visible = false;
    sfx.toolStow();
    buzz(this.world, 'left', 0.25, 30);
    return true;
  }

  /** What the tool would do at this cell — the ONE place the rules live,
   *  shared by the ray and the headless hook. */
  private resolve(
    cell: Cell,
    handRot: Rot,
  ): {
    cell: Cell;
    placeable: boolean;
    rot: Rot;
    feeds: Cell | null;
    fedBy: Cell[];
    bridge?: boolean;
  } | null {
    const occupied = unitAtCell(cell.i, cell.j);
    const inFloor = cellInFloor(cell.i, cell.j);
    if (this.armed === 'delete') {
      return { cell, placeable: occupied !== undefined, rot: handRot, feeds: null, fedBy: [] };
    }
    if (!this.armed) return { cell, placeable: false, rot: handRot, feeds: null, fedBy: [] };
    // A RAIL ONTO A CROSSING RAIL LAYS A DECK. The one placement that
    // lands on an occupied cell: aim a rail at a rail running the other
    // way and the piece in your hand becomes the bridge over it. The
    // heading is forced perpendicular — a deck has exactly one axis to
    // offer, so a hand pointing along the lane still gets the crossing.
    if (this.armed === 'belt' && occupied?.type === 'belt') {
      const want = this.forced ?? handRot;
      const across = (want % 2 !== occupied.rot % 2 ? want : (want + 1) % 4) as Rot;
      if (canBridge(occupied, across)) {
        return { cell, placeable: true, rot: across, feeds: null, fedBy: [], bridge: true };
      }
    }
    const rot = this.forced ?? bestRot(this.armed, cell.i, cell.j, handRot);
    const placeable =
      inFloor && occupied === undefined && unitAvailable(this.armed) && canAfford(this.armed);

    // What would this piece feed, and what would feed it?
    let feeds: Cell | null = null;
    const emitter = this.armed === 'maker' || this.armed === 'combiner' || this.armed === 'belt';
    if (emitter) {
      const d = DIRS[rot];
      const ahead = unitAtCell(cell.i + d.di, cell.j + d.dj);
      if (ahead && canLink(ahead, rot)) feeds = { i: ahead.i, j: ahead.j };
    }
    const fedBy: Cell[] = [];
    // A rail pointing AWAY from a lane, a chest or the bank is a JOIN
    // too — it taps the lane, or pulls the container — and the preview
    // owes you that chevron just as much as the feed-in one. (The loop
    // below only sees emitters POINTING at us; these doors swing the
    // other way.)
    if (this.armed === 'belt') {
      const b = DIRS[((rot + 2) % 4) as Rot];
      const behind = unitAtCell(cell.i + b.di, cell.j + b.dj);
      if (
        behind &&
        ((behind.type === 'belt' && behind.over === undefined && behind.rot % 2 !== rot % 2) ||
          behind.type === 'chest' ||
          behind.type === 'dock')
      ) {
        fedBy.push({ i: behind.i, j: behind.j });
      }
    }
    const takesParts =
      this.armed === 'belt' ||
      this.armed === 'dock' ||
      this.armed === 'chest' ||
      this.armed === 'combiner';
    if (takesParts) {
      for (let r = 0; r < 4; r++) {
        const d = DIRS[r as Rot];
        const n = unitAtCell(cell.i + d.di, cell.j + d.dj);
        if (!n || !emits(n)) continue;
        // It feeds us only if it POINTS at us…
        const nd = DIRS[n.rot];
        if (n.i + nd.di !== cell.i || n.j + nd.dj !== cell.j) continue;
        // …and we have a use for what arrives.
        if (this.armed === 'combiner') {
          const enterFrom = ((n.rot + 2) % 4) as Rot;
          const p0 = ((rot + 3) % 4) as Rot;
          const p1 = ((rot + 1) % 4) as Rot;
          if (enterFrom !== p0 && enterFrom !== p1) continue;
        }
        fedBy.push({ i: n.i, j: n.j });
      }
    }
    return { cell, placeable, rot, feeds, fedBy };
  }

  /** Press. Returns true when something actually happened. */
  private commit(v: ReturnType<BuildSystem['resolve']>): boolean {
    if (!v || !this.armed) return false;
    if (this.armed === 'delete') {
      const unit = unitAtCell(v.cell.i, v.cell.j);
      // THE CORE does not come up: it is what the whole floor defends.
      if (!unit || unit.type === 'dock') return false;
      refundUnit(unit);
      removeUnit(unit);
      sfx.boltSpin();
      sfx.droopSettle();
      return true;
    }
    if (!v.placeable) return false;
    // The deck: the rail in your hand goes OVER the one on the floor.
    if (v.bridge) {
      const standing = unitAtCell(v.cell.i, v.cell.j);
      if (!standing || !layBridge(standing, v.rot)) return false;
      sfx.mountThunk();
      sfx.seatClunk();
      this.forced = null;
      return true;
    }
    const ok = placeUnit(this.armed, v.cell.i, v.cell.j, v.rot) !== null;
    if (ok) {
      sfx.mountThunk();
      // The override is per PIECE: the next one goes back to facing
      // itself, which is right far more often than a stale hand angle.
      this.forced = null;
      // There is one core: once it stands, the tool goes back down.
      if (this.armed === 'dock') this.armed = null;
    }
    return ok;
  }

  update(delta: number): void {
    this.clock += delta;

    const active = site.screen === 'factory' && !site.paused;
    if (site.screen !== 'factory') this.armed = null;
    if (!active) {
      this.hideAim();
      return;
    }

    // Ⓧ PUTS THE TOOL DOWN — checked before anything else this frame, so
    // the rest of it runs with an empty hand and the ghost simply is not
    // drawn. It lives on the LEFT controller on purpose: the right hand
    // is holding the piece and doing the aiming, and a bail-out you have
    // to aim with is not a bail-out.
    // (Ⓨ too: the two left-hand buttons sit under one thumb, and a
    // bail-out should not care which of them it landed on.)
    if (intents.stow) {
      this.stow();
    }

    const rayObj = this.world.playerSpaceEntities?.raySpaces?.right?.object3D;
    if (!rayObj) {
      this.hideAim();
      return;
    }
    rayObj.getWorldPosition(_origin);
    rayObj.getWorldDirection(_dir).negate();

    // The ray onto the floor plane.
    let cell: Cell | null = null;
    if (_dir.y < -0.05) {
      const t = -_origin.y / _dir.y;
      if (t > 0.05 && t < 9) {
        _hit.copy(_origin).addScaledVector(_dir, t);
        cell = worldToCell(_hit.x / PLANT_SCALE, _hit.z / PLANT_SCALE);
      }
    }
    const yaw = Math.atan2(_dir.x, _dir.z);
    const handRot = ((((2 - Math.round(yaw / (Math.PI / 2))) % 4) + 4) % 4) as Rot;
    this.view = cell ? this.resolve(cell, handRot) : null;

    const occupied = cell ? unitAtCell(cell.i, cell.j) : undefined;
    this.lastAim = cell
      ? { ...cell, free: cellInFloor(cell.i, cell.j) && occupied === undefined }
      : null;

    const deleting = this.armed === 'delete';
    const showGhost = Boolean(this.view?.placeable) && !deleting;

    if (showGhost && cell && this.view && this.armed && this.armed !== 'delete') {
      cellCenter(cell.i, cell.j, _c);
      this.ghost.position.set(_c.x, 0, _c.z);
      const d = DIRS[this.view.rot];
      this.ghost.rotation.y = Math.atan2(d.di, d.dj);
      for (const [type, body] of this.bodies) body.group.visible = type === this.armed;
      // The rail ghost dresses for the spot: the curve it would land
      // with, or — over a crossing rail — just the deck it would lay.
      const beltRefs = this.bodies.get('belt');
      if (this.armed === 'belt' && beltRefs?.belt) {
        if (this.view.bridge) {
          const f = beltRefs.belt;
          f.straight.visible = false;
          f.curve1.visible = false;
          f.curve3.visible = false;
          f.arch.visible = true;
          f.arch.rotation.y = 0; // the ghost group already faces the deck's way
        } else {
          const entryRel = (beltEntryAt(cell.i, cell.j, this.view.rot) - this.view.rot + 4) % 4;
          setBeltForm(beltRefs, entryRel, -1);
        }
      }
      this.ghost.visible = true;
      const breathe = 0.5 + 0.5 * Math.sin(this.clock * 3.2);
      this.ghostMat.opacity = 0.12 + 0.08 * breathe;
      // A HELD OVERRIDE HAS TO SHOW. The arrow breathes while the plant
      // is choosing and burns steady the moment you take the wheel with
      // Ⓑ — otherwise a turn you made two cells ago quietly rides along
      // and the next piece lands facing somewhere you didn't ask for.
      this.arrowMat.opacity = this.forced === null ? 0.6 + 0.3 * breathe : 1;
    } else {
      this.ghost.visible = false;
    }

    // The focus frame: amber over standing plant, RED under the bar.
    if (cell && occupied !== undefined) {
      const s = UNITS.crate.size + 0.03;
      cellCenter(cell.i, cell.j, _c);
      this.focus.position.set(_c.x, UNITS.crate.benchTop - UNITS.crate.height / 2, _c.z);
      this.focus.scale.set(s, UNITS.crate.height + 0.03, s);
      this.focusMat.color.setHex(deleting ? 0xff4d3d : 0xffa22e);
      this.focus.visible = true;
    } else {
      this.focus.visible = false;
    }

    this.showLinks(cell);

    const aiming = Boolean(this.armed && cell);
    // A RAIL IS AIMED, NOT POINTED AT. With a rail in hand the cursor is
    // an ARROW on the boards instead of a dot: nose along the way the
    // lane will run — the last step of a haul you are dragging out, or
    // the facing the piece would land with — so the direction is read
    // off the floor before the trigger, not after.
    let arrowYaw: number | null = null;
    if (this.armed === 'belt' && cell) {
      const h = this.haul;
      const rot =
        h && h.steps.length > 0 ? h.steps[h.steps.length - 1].rot : (this.view?.rot ?? handRot);
      const d = DIRS[rot];
      arrowYaw = Math.atan2(d.di, d.dj);
    }
    this.pointer.arrow(arrowYaw);
    this.pointer.update(
      delta,
      _origin,
      cell ? _hit : null,
      aiming && Boolean(this.view?.placeable),
    );

    // AN EMPTY HAND OPENS THE BOX. Nothing armed and the ray on standing
    // plant: raise the box panel instead of doing nothing at all, which
    // is what the trigger used to do here.
    const point = intents.right.point;
    if (point.down && !this.armed && cell && occupied) {
      site.inspect = occupied.id;
      site.paused = true;
      this.pointer.click();
      sfx.uiClick();
      buzz(this.world, 'right', 0.3, 25);
    }
    if (point.down && this.armed && cell) {
      const wasBridge = this.view?.bridge === true;
      if (this.commit(this.view)) {
        this.pointer.click();
        buzz(this.world, 'right', deleting ? 0.4 : 0.6, deleting ? 40 : 50);
        // A RAIL THAT LANDS IS A RAIL YOU CAN HAUL. Keep hold of the
        // trigger and the run comes out of it — see updateHaul below.
        // (A deck laid over a crossing anchors nothing: the rail under
        // it already belongs to another lane.)
        if ((this.armed === 'belt' || this.armed === 'wall') && !wasBridge) {
          this.haul = { anchor: { ...cell }, steps: [], kind: this.armed };
          this.haulDriven = false;
        }
      } else {
        sfx.oneHandRattle();
        buzz(this.world, 'right', 0.25, 40);
      }
    }
    this.updateHaul(point.pressed, cell);
    // Ⓑ IS TWO VERBS, AND WHICH ONE IS IN YOUR HAND DECIDES.
    //   holding a piece  → turn it a quarter, and mean it (see `forced`)
    //   empty-handed     → unbolt whatever the ray is on, as always
    // Playtest wanted to aim a conveyor by hand; the wrecking bar moved
    // into the catalogue last round precisely so this button could.
    if (intents.turn) {
      if (this.armed && this.armed !== 'delete') {
        this.forced = (((this.view?.rot ?? this.forced ?? 0) + 1) % 4) as Rot;
        if (cell) this.view = this.resolve(cell, handRot);
        sfx.segmentClick(this.forced); // the tube's own detent, reused
        buzz(this.world, 'right', 0.3, 25);
      } else if (cell && occupied !== undefined) {
        // Ⓑ ON PLANT: a plumbed box UNPLUGS, a bare one comes out. The
        // seated line retracts through sim.retractRun, which is the one
        // door every unplug goes through — so the hum stops and the iris
        // shuts however the seal was broken.
        const unit = unitAtCell(cell.i, cell.j);
        if (unit) {
          const run = runSeatedAt(unit.id);
          if (run) retractRun(run);
          else if (unit.type !== 'dock') {
            refundUnit(unit);
            removeUnit(unit);
          }
          sfx.boltSpin();
          buzz(this.world, 'right', 0.4, 40);
        }
      }
    }
  }

  /**
   * THE HAUL — a rail run comes out of a rail the way a tube comes out
   * of a wall.
   *
   * Stamping a conveyor a cell at a time is bookkeeping, not a verb; the
   * ask was for the pull, and the pull is what this is. The first rail
   * lands on the press. Keep the trigger DOWN and the run ratchets out
   * toward wherever you point — one detent per cell, pitched up the run
   * exactly like the tube's telescoping sections, so a long haul plays a
   * rising scale. Let go and it is rails.
   *
   * The route is sim.haulRoute's business, POSTS and all; this only has
   * to hold the trigger, count the detents and draw the ghosts.
   */
  private updateHaul(held: boolean, cell: Cell | null): void {
    // A haul the HOOKS are driving belongs to them start to finish. This
    // runs every frame off a controller that isn't there in a browser,
    // and its release path would otherwise throw away a run a walk is
    // still dragging out — the frame after it started.
    if (this.haulDriven) return;
    const h = this.haul;
    if (!h) {
      this.haulHeld = false;
      return;
    }
    if (held) {
      this.haulHeld = true;
      const to = cell ?? h.anchor;
      const was = h.steps.length;
      h.steps = this.routeFor(h, to);
      // A detent for every cell that just arrived — the run has WEIGHT,
      // and silence while it grows is the whole feel thrown away.
      if (h.steps.length > was) {
        sfx.segmentClick(h.steps.length);
        buzz(this.world, 'right', 0.22, 18);
      } else if (h.steps.length < was) {
        sfx.segmentClick(Math.max(0, h.steps.length));
      }
      this.showHaul(h.steps, h.anchor, h.kind);
      return;
    }
    // RELEASED. Lay it.
    this.showHaul([]);
    this.haul = null;
    if (!this.haulHeld) return;
    this.haulHeld = false;
    const laid = layHaul(h.anchor, h.steps, h.kind);
    if (laid > 0) {
      sfx.mountThunk();
      sfx.droopSettle();
      buzz(this.world, 'right', 0.55, 60);
    }
  }

  /** The route a haul would lay. A WALL run never bridges (plate does
   *  not deck over a lane — it stops at it) and is as long as the bank
   *  can pay for: the ghost you drag out IS the wall you can afford. */
  private routeFor(h: { anchor: Cell; kind: 'belt' | 'wall' }, to: Cell): HaulStep[] {
    const steps = haulRoute(h.anchor, to, UNITS.pull.maxRun);
    if (h.kind === 'belt') return steps;
    const stop = steps.findIndex((s) => s.bridge);
    const plain = stop >= 0 ? steps.slice(0, stop) : steps;
    let afford = 0;
    while (afford < plain.length && canAfford('wall', afford + 1)) afford++;
    return plain.slice(0, afford);
  }

  /** The run as it stands in your hand: rail ghosts down the route —
   *  each dressed as it will land: curves on the corners, a deck ghost
   *  where the route crosses a standing rail. */
  private showHaul(steps: HaulStep[], anchor?: Cell, kind: 'belt' | 'wall' = 'belt'): void {
    for (const w of this.wallGhosts) w.group.visible = false;
    if (kind === 'wall') {
      for (const r of this.haulGhosts) r.group.visible = false;
      steps.forEach((step, n) => {
        const g = this.wallGhosts[n]?.group;
        if (!g) return;
        cellCenter(step.i, step.j, _c2);
        g.position.set(_c2.x, 0, _c2.z);
        g.visible = true;
      });
      return;
    }
    const rotBetween = (a: Cell, b: Cell): Rot => {
      if (Math.abs(b.i - a.i) >= Math.abs(b.j - a.j)) return b.i > a.i ? 1 : 3;
      return b.j > a.j ? 2 : 0;
    };
    for (let n = 0; n < this.haulGhosts.length; n++) {
      const refs = this.haulGhosts[n];
      const g = refs.group;
      const step = steps[n];
      if (!step) {
        g.visible = false;
        continue;
      }
      cellCenter(step.i, step.j, _c2);
      g.position.set(_c2.x, 0, _c2.z);
      const d = DIRS[step.rot];
      g.rotation.y = Math.atan2(d.di, d.dj);
      if (refs.belt) {
        if (step.bridge) {
          refs.belt.straight.visible = false;
          refs.belt.curve1.visible = false;
          refs.belt.curve3.visible = false;
          refs.belt.arch.visible = true;
          refs.belt.arch.rotation.y = 0; // the group faces the deck's way
        } else {
          const prev = n === 0 ? anchor : steps[n - 1];
          const entry = prev ? rotBetween(prev, step) : step.rot;
          setBeltForm(refs, (entry - step.rot + 4) % 4, -1);
        }
      }
      g.visible = true;
    }
  }

  /** Draw the chevrons for what the ghost would join. */
  private showLinks(cell: Cell | null): void {
    for (const m of this.links) m.visible = false;
    const v = this.view;
    if (!cell || !v || !v.placeable || this.armed === 'delete') return;
    cellCenter(cell.i, cell.j, _c);
    let n = 0;
    const draw = (from: { x: number; z: number }, to: { x: number; z: number }): void => {
      const m = this.links[n++];
      if (!m) return;
      m.position.set((from.x + to.x) / 2, UNITS.railTop + 0.11, (from.z + to.z) / 2);
      m.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
      m.visible = true;
    };
    if (v.feeds) {
      cellCenter(v.feeds.i, v.feeds.j, _c2);
      draw(_c, _c2);
    }
    for (const src of v.fedBy) {
      cellCenter(src.i, src.j, _c2);
      draw(_c2, _c);
    }
  }

  private hideAim(): void {
    this.ghost.visible = false;
    this.focus.visible = false;
    for (const m of this.links) m.visible = false;
    if (!this.haulDriven) {
      this.showHaul([]);
      this.haul = null;
      this.haulHeld = false;
    }
    this.pointer.hide();
    this.lastAim = null;
    this.view = null;
  }
}

/** The catalogue's availability check, for the card's button states. */
export function typeAvailable(type: UnitType): boolean {
  // Posts are not on the book's ladder at all — they arrive when the
  // fitting is paid for, and then they are yours for good.
  if (type === 'post') return postsUnlocked();
  if (plant.mode === 'idle') return type === 'chest';
  if (plant.siege.phase === 'core') return type === 'dock';
  // One bank, and one vat: the shop only ever needs one of each, and a
  // second of either is a way to confuse yourself, not a strategy.
  if (type === 'dock' && plant.units.some((u) => u.type === 'dock')) return false;
  if (type === 'vat' && plant.units.some((u) => u.type === 'vat')) return false;
  return plant.unitsAvailable.includes(type);
}
