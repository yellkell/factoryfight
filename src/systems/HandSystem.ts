/**
 * HandSystem — bare hands are the controller, and the LEFT HAND IS THE MENU.
 *
 * Runs FIRST every frame and fills in input/intents.ts from whatever the
 * headset is giving it: a controller's trigger, squeeze and face buttons,
 * or a tracked hand's pinch and fist. Nothing downstream ever asks which.
 *
 * On hands, there is no card to open to build. Turn your left hand open
 * toward you and ONE panel comes up off it, floating over the palm and
 * turned to your eyes — one plane, so nothing on it can hide anything
 * else on it (the watch used to sit on the wrist, and the palm's tiles
 * floated in front of it):
 *
 *   THE TOWERS — every tower you can build right now, each tile wearing
 *     its drawing and its price in coins, dimmed when the purse can't pay.
 *     Poke one with your right index finger and it is in your hand (aim,
 *     pinch to place); poke it again to put it down. On a fresh floor it
 *     holds exactly one tile — the CORE — because nothing else can stand
 *     until the core does.
 *
 *   THE HEADER — across the top: the wave, the clock to the horn (or how
 *     many are left), the coins, and the studs a hand has no buttons for —
 *       HORN   call the wave now (build phase only)
 *       PAUSE  the pause plate (BACK while it, or the core, is open)
 *       TURN   a quarter turn for the piece in hand   ┐ only while
 *       DOWN   put the tool away                      ┘ holding one
 *       DONE   while you are marking out the floor
 *
 * It only takes pokes while you are looking at it, and goes away while
 * the left hand is closed.
 *
 * And a TOWER is touched to be upgraded: reach out and poke one (either
 * hand), and its panel opens — UPGRADE, SELL.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import {
  AdditiveBlending,
  CanvasTexture,
  CircleGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SRGBColorSpace,
  Vector3,
  type Object3D,
} from 'three';
import type { UnitType } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { site } from '../game/state.js';
import { cellCenter } from '../floor/grid.js';
import { PLANT_SCALE } from '../factory/frame.js';
import { plant } from '../factory/state.js';
import { siegeLeft, soundHorn, waveSpec } from '../factory/siege.js';
import { canAfford, isWeapon, unitCost } from '../factory/sim.js';
import { font } from '../ui/fonts.js';
import { GLYPH_DEAD, GLYPH_LIVE, unitGlyph, type GlyphId } from '../ui/icons.js';
import { UI } from '../ui/panel.js';
import {
  J,
  curledFingers,
  intents,
  isFist,
  pinchGap,
  step,
  type HandSide,
} from '../input/intents.js';
import { buildView, typeAvailable, type BuildTool } from './BuildSystem.js';

/** Headless hooks (wired into __tubes.hands in main.ts). */
export const handsView: {
  state?: () => {
    handMode: boolean;
    left: { mode: string; point: boolean; grab: boolean };
    right: { mode: string; point: boolean; grab: boolean };
  };
  /** Fire a verb edge next frame, as if the stud (or button) was pressed. */
  press?: (verb: 'menu' | 'turn' | 'stow' | 'done') => void;
  /** Hold a gesture on a side regardless of what the hand is doing. */
  force?: (hand: HandSide, what: 'point' | 'grab', on: boolean | null) => void;
  /** The left hand's menu as it stands: shown, and every pokeable thing
   *  on it (watch studs AND toolbelt tiles), with where (world). */
  cuff?: () => {
    shown: boolean;
    facing: number;
    studs: Array<{ id: string; x: number; y: number; z: number; nx: number; ny: number; nz: number }>;
  };
  /** A hand's index tip, world (room) metres — what pokes things. */
  tip?: (hand: HandSide) => [number, number, number] | null;
  /** Fingers curled per hand (0–4) — the fist detector's raw reading. */
  curl?: () => { left: number; right: number };
} = {};

/* ── the numbers (room metres) ──────────────────────────────────────────── */

const CUFF = {
  w: 0.092,
  h: 0.058,
  /** Back from the wrist joint toward the elbow, and up off the skin. */
  back: 0.05,
  lift: 0.024,
  stud: 0.0115,
  pitch: 0.029,
  /** How square to your eyes the open hand must be. */
  showDot: 0.45,
  hideDot: 0.3,
  /** Poke: within this of a face, and this far across it. */
  pokeDepth: 0.012,
  rearm: 0.024,
  /** The pinch, from joints, when no gamepad reports it. */
  pinchOn: 0.018,
  pinchOff: 0.03,
};

const BELT = {
  /** A tile's side, and the grid pitch. Big enough to hit with a finger
   *  you can't feel anything through. */
  tile: 0.04,
  pitch: 0.047,
  perRow: 3,
  /** How high over the palm the belt floats. */
  lift: 0.075,
};

/** A tower's (or the core's) touchable body (room metres): a column. */
const TOWER_TOUCH = { r: 0.1, y0: 0.12, y1: 1.0 };

/** The header strip sits this far above the first row of tiles. */
const HEADER_UP = BELT.tile * 0.6 + 0.01 + CUFF.h / 2;

// The core (alone, until it stands), then the towers in the order the
// ladder hands them out.
const TOOL_ORDER: BuildTool[] = ['dock', 'turret', 'piston', 'flamer', 'tesla', 'mortar'];
const TOOL_NAME: Record<string, string> = {
  dock: 'CORE',
  maker: 'MAKER',
  belt: 'RAIL',
  turret: 'TURRET',
  flamer: 'FLAMER',
  piston: 'PISTON',
  tesla: 'TESLA',
  mortar: 'MORTAR',
  wall: 'WALL',
  combiner: 'COMBINER',
  chest: 'CHEST',
  post: 'POST',
  delete: 'REMOVE',
};

type Action = 'menu' | 'turn' | 'stow' | 'done' | 'horn';

/** One pokeable thing: a watch stud or a toolbelt tile. */
interface Poke {
  id: string;
  group: Group;
  face: MeshBasicMaterial;
  ring: MeshBasicMaterial | null;
  ctx: CanvasRenderingContext2D;
  tex: CanvasTexture;
  /** Across-the-face hit radius. */
  radius: number;
  key: string;
  flash: number;
  armed: boolean;
}

const _m = new Matrix4();
const _w = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _f = new Vector3();
const _n = new Vector3();
const _x = new Vector3();
const _up = new Vector3();
const _cam = new Vector3();
const _tip = new Vector3();
const _p = new Vector3();
const _c = new Vector3();
const _pc = new Vector3();
const _pn = new Vector3();
const _q = new Quaternion();
const _cc = { x: 0, z: 0 };

export class HandSystem extends createSystem({}) {
  private cuff!: Group;
  private cuffMat!: MeshBasicMaterial;
  private face!: { ctx: CanvasRenderingContext2D; tex: CanvasTexture; key: string };
  /** The watch's three stud slots; what each one DOES is decided per frame. */
  private studs: Poke[] = [];
  private studAction: Array<Action | null> = [null, null, null];
  private studSig = '';
  private beltSig = '';
  private belt!: Group;
  private tiles = new Map<string, Poke>();
  private shown = 0;
  private facing = 0;
  private fist: Record<HandSide, boolean> = { left: false, right: false };
  private pinch: Record<HandSide, boolean> = { left: false, right: false };
  private curl: Record<HandSide, number> = { left: 0, right: 0 };
  private queued = new Set<'menu' | 'turn' | 'stow' | 'done'>();
  private forced: Record<HandSide, { point: boolean | null; grab: boolean | null }> = {
    left: { point: null, grab: null },
    right: { point: null, grab: null },
  };
  private pokeCool = 0;
  private towerArmed: Record<HandSide, boolean> = { left: true, right: true };

  init(): void {
    this.cuff = new Group();
    this.cuff.name = 'hand-header';
    this.cuff.visible = false;
    this.cuff.matrixAutoUpdate = false;
    this.scene.add(this.cuff);
    this.belt = new Group();
    this.belt.name = 'palm-toolbelt';
    this.belt.visible = false;
    this.belt.matrixAutoUpdate = false;
    this.scene.add(this.belt);

    // The watch plate: dark glass with an amber hairline, the board's language.
    const plate = document.createElement('canvas');
    plate.width = 368;
    plate.height = 232;
    const pctx = plate.getContext('2d')!;
    const ptex = new CanvasTexture(plate);
    ptex.colorSpace = SRGBColorSpace;
    this.cuffMat = new MeshBasicMaterial({ map: ptex, transparent: true, depthWrite: false, side: DoubleSide });
    const plateMesh = new Mesh(new PlaneGeometry(CUFF.w, CUFF.h), this.cuffMat);
    plateMesh.renderOrder = 20;
    this.cuff.add(plateMesh);
    this.face = { ctx: pctx, tex: ptex, key: '' };

    const studGeo = new CircleGeometry(CUFF.stud, 28);
    const ringGeo = new RingGeometry(CUFF.stud * 1.02, CUFF.stud * 1.22, 32);
    for (let k = 0; k < 3; k++) {
      const poke = makePoke(`stud${k}`, studGeo, ringGeo, 128, 128, CUFF.stud * 1.4);
      poke.group.position.set((k - 1) * CUFF.pitch, -CUFF.h * 0.2, 0.002);
      this.cuff.add(poke.group);
      this.studs.push(poke);
    }

    handsView.state = () => ({
      handMode: intents.handMode,
      left: { mode: intents.left.mode, point: intents.left.point.pressed, grab: intents.left.grab.pressed },
      right: { mode: intents.right.mode, point: intents.right.point.pressed, grab: intents.right.grab.pressed },
    });
    handsView.press = (verb) => this.queued.add(verb);
    handsView.force = (hand, what, on) => {
      this.forced[hand][what] = on;
    };
    handsView.cuff = () => {
      const out: Array<{ id: string; x: number; y: number; z: number; nx: number; ny: number; nz: number }> = [];
      const add = (id: string, p: Poke): void => {
        p.group.getWorldPosition(_p);
        _n.set(0, 0, 1).transformDirection(p.group.matrixWorld);
        out.push({ id, x: _p.x, y: _p.y, z: _p.z, nx: _n.x, ny: _n.y, nz: _n.z });
      };
      this.studs.forEach((s, k) => {
        const act = this.studAction[k];
        if (s.group.visible && act) add(act, s);
      });
      for (const [tool, t] of this.tiles) if (t.group.visible) add(`tool:${tool}`, t);
      return { shown: this.cuff.visible && this.shown > 0.5, facing: this.facing, studs: out };
    };
    handsView.curl = () => ({ ...this.curl });
    handsView.tip = (hand) => {
      const o = this.world.playerSpaceEntities?.indexTipSpaces?.[hand]?.object3D as Object3D | undefined;
      return o ? o.getWorldPosition(new Vector3()).toArray() : null;
    };
  }

  update(delta: number): void {
    intents.menu = false;
    intents.turn = false;
    intents.stow = false;
    intents.done = false;
    this.pokeCool = Math.max(0, this.pokeCool - delta);

    const xr = this.input.xr;
    for (const side of ['left', 'right'] as const) {
      const it = intents[side];
      const isHand = xr.isPrimary('hand', side);
      const isPad = xr.isPrimary('controller', side);
      it.mode = isHand ? 'hand' : isPad ? 'controller' : 'none';
      const gp = xr.gamepads[side];
      let point = false;
      let pointV = 0;
      let grab = false;
      let grabV = 0;
      if (isHand) {
        const joints = xr.visualAdapters.hand[side].jointTransforms;
        // Pinch: Quest reports it as the hand's select button; fall back
        // to the joints if a runtime doesn't.
        const gpPinch = gp?.getButtonValue(InputComponent.Trigger) ?? 0;
        if (joints && joints.length >= 25 * 16) {
          const gap = pinchGap(joints);
          this.pinch[side] = this.pinch[side] ? gap < CUFF.pinchOff : gap < CUFF.pinchOn;
          this.fist[side] = isFist(joints, this.fist[side]);
          this.curl[side] = curledFingers(joints);
        }
        point = gpPinch > 0.5 || this.pinch[side];
        pointV = Math.max(gpPinch, point ? 1 : 0);
        grab = this.fist[side];
        grabV = this.curl[side] / 4;
        // A fist is not a pinch: a closed hand's index meets its thumb on
        // the way, and that must not fire a build press.
        if (grab) point = false;
      } else if (gp) {
        point = gp.getButtonPressed(InputComponent.Trigger);
        pointV = gp.getButtonValue(InputComponent.Trigger);
        grab = gp.getButtonPressed(InputComponent.Squeeze);
        grabV = gp.getButtonValue(InputComponent.Squeeze);
        if (side === 'right') {
          if (gp.getButtonDown(InputComponent.A_Button)) {
            intents.menu = true;
            intents.done = true;
          }
          if (gp.getButtonDown(InputComponent.B_Button)) intents.turn = true;
        } else {
          if (gp.getButtonDown(InputComponent.X_Button)) {
            intents.stow = true;
            intents.done = true;
          }
          if (gp.getButtonDown(InputComponent.Y_Button)) intents.stow = true;
        }
      }
      const f = this.forced[side];
      if (f.point !== null) point = f.point;
      if (f.grab !== null) grab = f.grab;
      step(it.point, point, f.point !== null ? (point ? 1 : 0) : pointV);
      step(it.grab, grab, f.grab !== null ? (grab ? 1 : 0) : grabV);
    }
    intents.handMode = intents.left.mode === 'hand' || intents.right.mode === 'hand';

    for (const verb of this.queued) intents[verb] = true;
    this.queued.clear();

    this.tickLeftHand(delta);
    this.tickTowerTouch();
  }

  /* ── THE LEFT HAND: watch + toolbelt ──────────────────────────────────── */

  private tickLeftHand(delta: number): void {
    const xr = this.input.xr;
    const joints = xr.visualAdapters.hand.left.jointTransforms;
    const grip = this.world.playerSpaceEntities?.gripSpaces?.left?.object3D as Object3D | undefined;
    // An open hand only: a fist on a collar, or a pinch, is busy.
    const open = !intents.left.grab.pressed && !intents.left.point.pressed;
    if (!xr.isPrimary('hand', 'left') || !joints || !grip) {
      this.cuff.visible = false;
      this.belt.visible = false;
      this.shown = 0;
      return;
    }
    grip.updateWorldMatrix(true, false);
    const at = (j: number, out: Vector3): Vector3 =>
      out.set(joints[j * 16 + 12], joints[j * 16 + 13], joints[j * 16 + 14]).applyMatrix4(grip.matrixWorld);
    at(J.wrist, _w);
    at(J.indexMeta, _a).sub(_w);
    at(J.pinkyMeta, _b).sub(_w);
    at(J.middleMeta, _f);
    _pc.copy(_f).add(_w).multiplyScalar(0.5); // the palm's middle
    _f.sub(_w).normalize();
    // The INSIDE of the left hand: the palm's normal. (Index-then-pinky
    // across the back of a left hand points out of the knuckles, so the
    // palm is the other way.)
    _n.crossVectors(_a, _b).normalize().negate();
    _pn.copy(_n);
    this.camera.getWorldPosition(_cam);
    _up.set(0, 1, 0).applyQuaternion(this.camera.getWorldQuaternion(_q));

    // THE PANEL floats over the palm and turns to face you, upright as
    // you read it (its up is the HEAD's up, projected onto the face). The
    // header rides along the top of it, in the same plane.
    _c.copy(_pc).addScaledVector(_pn, BELT.lift);
    _x.copy(_cam).sub(_c).normalize();
    faceBasis(_x, _up, _m, _c);
    this.belt.matrix.copy(_m);
    this.belt.matrixWorldNeedsUpdate = true;
    _c.set(0, HEADER_UP, 0).applyMatrix4(_m);
    this.cuff.matrix.copy(_m).setPosition(_c);
    this.cuff.matrixWorldNeedsUpdate = true;

    _p.copy(_cam).sub(_pc).normalize();
    this.facing = _pn.dot(_p);
    const showing = this.shown > 0.5;
    const look = open && (showing ? this.facing > CUFF.hideDot : this.facing > CUFF.showDot);
    this.shown = Math.max(0, Math.min(1, this.shown + (look ? delta : -delta) * 8));
    const vis = this.shown > 0.01;
    this.cuff.visible = vis;
    this.cuffMat.opacity = this.shown;

    // The tiles: only while there is a floor to build on.
    const factory = site.screen === 'factory' && !site.paused && plant.siege.phase !== 'fallen';
    this.belt.visible = vis && factory;

    this.layoutStuds(delta);
    this.layoutBelt(delta);
    this.paintFace();

    // THE POKE: the right index tip, pressed into a face.
    if (this.shown < 0.9) return;
    const tipObj = this.world.playerSpaceEntities?.indexTipSpaces?.right?.object3D as Object3D | undefined;
    if (!tipObj || !xr.isPrimary('hand', 'right')) return;
    tipObj.getWorldPosition(_tip);
    this.cuff.updateMatrixWorld(true);
    this.belt.updateMatrixWorld(true);
    this.studs.forEach((s, k) => {
      const act = this.studAction[k];
      if (act && this.touch(s)) this.fire(act);
    });
    if (this.belt.visible) {
      for (const [tool, t] of this.tiles) {
        if (t.group.visible && this.touch(t)) this.pickTool(tool as BuildTool);
      }
    }
  }

  /** One face, one fingertip: true on the frame it is pressed. */
  private touch(p: Poke): boolean {
    p.group.getWorldPosition(_p);
    _n.set(0, 0, 1).transformDirection(p.group.matrixWorld);
    _p.sub(_tip).negate(); // tip relative to the face
    const depth = _p.dot(_n);
    const across = _p.addScaledVector(_n, -depth).length();
    const touching = across < p.radius && depth < CUFF.pokeDepth && depth > -0.02;
    if (touching && p.armed && this.pokeCool <= 0) {
      p.armed = false;
      p.flash = 1;
      this.pokeCool = 0.35;
      return true;
    }
    if (!touching && (across > p.radius + 0.01 || depth > CUFF.rearm)) p.armed = true;
    return false;
  }

  /** What the three watch studs do right now. */
  private layoutStuds(delta: number): void {
    const floor = site.screen === 'floor';
    const factory = site.screen === 'factory';
    const armed = (buildView.armed?.() ?? null) !== null && factory;
    const open = site.paused || site.inspect >= 0;
    let acts: Action[] = [];
    if (floor) acts = ['done'];
    else if (factory && open) acts = ['menu'];
    else if (factory && armed) acts = ['turn', 'stow', 'menu'];
    else if (factory && plant.siege.phase === 'build') acts = ['horn', 'menu'];
    else if (factory || site.screen === 'shift') acts = ['menu'];
    const label: Record<Action, string> = {
      menu: open ? 'BACK' : 'PAUSE',
      turn: 'TURN',
      stow: 'DOWN',
      done: 'DONE',
      horn: 'HORN',
    };
    // A NEW LAYOUT IS A NEW SET OF BUTTONS. Pressing PAUSE re-lays the
    // watch (one stud, BACK, centred) right under the finger that is
    // still pressing — and without this it pressed BACK the same instant
    // and the pause never happened. Every stud waits for the finger to
    // come away first.
    const sig = acts.join(',');
    if (sig !== this.studSig) {
      this.studSig = sig;
      for (const s of this.studs) s.armed = false;
    }
    this.studs.forEach((s, k) => {
      const act = acts[k] ?? null;
      this.studAction[k] = act;
      s.group.visible = act !== null;
      // Centre whatever row there is.
      s.group.position.x = (k - (acts.length - 1) / 2) * CUFF.pitch;
      const key = act ? `${act}|${label[act]}` : '';
      if (key !== s.key) {
        s.key = key;
        paintStud(s, act ? label[act] : '', act === 'stow' || act === 'horn');
      }
      s.flash = Math.max(0, s.flash - delta * 4);
      s.face.opacity = this.shown;
      if (s.ring) s.ring.opacity = this.shown * (0.45 + 0.55 * s.flash);
      s.group.position.z = 0.002 - s.flash * 0.003;
    });
  }

  /** The toolbelt's tiles: what you can stand, and what it costs. */
  private layoutBelt(delta: number): void {
    if (!this.belt.visible) return;
    const armed = buildView.armed?.() ?? null;
    const tools = TOOL_ORDER.filter((t) => typeAvailable(t as UnitType));
    // Same law as the studs: tiles that move under a finger wait for it.
    const sig = tools.join(',');
    if (sig !== this.beltSig) {
      this.beltSig = sig;
      for (const [, t] of this.tiles) t.armed = false;
    }
    for (const [, t] of this.tiles) t.group.visible = false;
    tools.forEach((tool, k) => {
      let t = this.tiles.get(tool);
      if (!t) {
        const geo = new PlaneGeometry(BELT.tile, BELT.tile * 1.1);
        t = makePoke(tool, geo, null, 160, 176, BELT.tile * 0.55);
        this.belt.add(t.group);
        this.tiles.set(tool, t);
      }
      const row = Math.floor(k / BELT.perRow);
      const inRow = Math.min(BELT.perRow, tools.length - row * BELT.perRow);
      const col = k % BELT.perRow;
      // The first row stays where a lone row sits; more rows grow out
      // toward the fingers — never back over the watch on the wrist.
      t.group.position.set((col - (inRow - 1) / 2) * BELT.pitch, -row * BELT.pitch * 1.12, 0);
      t.group.visible = true;
      const afford = canAfford(tool as UnitType);
      const cost = costLabel(tool as UnitType);
      // The CORE tile breathes until it is placed: it is the only move.
      const urgent = tool === 'dock';
      const key = `${armed === tool}|${afford}|${cost}|${urgent}`;
      if (key !== t.key) {
        t.key = key;
        paintTile(t, tool, armed === tool, afford, cost);
      }
      t.flash = Math.max(0, t.flash - delta * 4);
      const pulse = urgent ? 0.85 + 0.15 * Math.sin(performance.now() / 180) : 1;
      t.face.opacity = this.shown * pulse;
      t.group.position.z = -t.flash * 0.004;
    });
  }

  private pickTool(tool: BuildTool): void {
    sfx.uiClick();
    const armed = buildView.armed?.() ?? null;
    if (armed === tool) {
      intents.stow = true; // the same tile again puts it down
      return;
    }
    if (!canAfford(tool as UnitType)) {
      sfx.oneHandRattle();
      return;
    }
    buildView.arm?.(tool);
  }

  private fire(act: Action): void {
    sfx.uiClick();
    if (act === 'menu') intents.menu = true;
    else if (act === 'turn') intents.turn = true;
    else if (act === 'stow') intents.stow = true;
    else if (act === 'done') intents.done = true;
    else if (act === 'horn') soundHorn();
  }

  /* ── A TOWER, touched ─────────────────────────────────────────────── */

  /** Reach out and touch a tower (or the core): its panel opens. */
  private tickTowerTouch(): void {
    const can =
      intents.handMode &&
      site.screen === 'factory' &&
      !site.paused &&
      site.inspect < 0 &&
      (buildView.armed?.() ?? null) === null;
    for (const hand of ['left', 'right'] as const) {
      const tipObj = this.world.playerSpaceEntities?.indexTipSpaces?.[hand]?.object3D as Object3D | undefined;
      if (!can || intents[hand].mode !== 'hand' || !tipObj) {
        this.towerArmed[hand] = true;
        continue;
      }
      tipObj.getWorldPosition(_tip);
      let hit: number = -1;
      let near = Infinity;
      for (const u of plant.units) {
        if (u.type !== 'dock' && !isWeapon(u.type)) continue;
        cellCenter(u.i, u.j, _cc);
        const r = Math.hypot(_tip.x - _cc.x * PLANT_SCALE, _tip.z - _cc.z * PLANT_SCALE);
        if (r < near) {
          near = r;
          if (r < TOWER_TOUCH.r && _tip.y > TOWER_TOUCH.y0 && _tip.y < TOWER_TOUCH.y1) hit = u.id;
        }
      }
      if (hit >= 0 && this.towerArmed[hand]) {
        this.towerArmed[hand] = false;
        site.inspect = hit;
        sfx.uiClick();
      } else if (hit < 0 && near > TOWER_TOUCH.r + 0.05) {
        this.towerArmed[hand] = true;
      }
    }
  }

  /** The watch face: the wave, and the clock to the horn (or what's left). */
  private paintFace(): void {
    const sg = plant.siege;
    let top = '';
    let big = '';
    let tone: string = UI.accent;
    if (site.screen === 'factory' && sg.phase !== 'off') {
      top = `WAVE ${sg.wave + 1} · ${waveSpec(sg.wave).name}`;
      if (sg.phase === 'core') {
        top = 'FIRST, THE CORE';
        big = 'PLACE CORE';
      } else if (sg.phase === 'build') {
        const s = Math.ceil(sg.buildT);
        big = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        top = `W${sg.wave + 1} · ${sg.coins} COINS`;
      } else if (sg.phase === 'wave') {
        big = `${siegeLeft()} LEFT`;
        top = `W${sg.wave + 1} · ${sg.coins} COINS`;
        tone = UI.danger;
      } else {
        big = 'FALLEN';
        tone = UI.danger;
      }
    } else if (site.screen === 'floor') {
      top = 'MARKING THE FLOOR';
      big = 'PINCH A TAPE';
    } else {
      top = 'FACTORY FIGHT';
    }
    const key = `${top}|${big}`;
    if (key === this.face.key) return;
    this.face.key = key;
    const g = this.face.ctx;
    const W = g.canvas.width;
    const H = g.canvas.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(11,10,7,0.86)';
    g.beginPath();
    g.roundRect(3, 3, W - 6, H - 6, 26);
    g.fill();
    g.strokeStyle = 'rgba(255,162,46,0.6)';
    g.lineWidth = 3;
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = font(600, 22);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.fillText(top, W / 2, 30, W - 30);
    g.font = font(700, 44);
    g.fillStyle = tone;
    g.fillText(big, W / 2, 72, W - 30);
    this.face.tex.needsUpdate = true;
  }
}

/* ── helpers ────────────────────────────────────────────────────────────── */

/** A face at `at` looking along `normal`, its up the head's up projected
 *  onto it — upright as read, however the wrist is turned. */
function faceBasis(normal: Vector3, headUp: Vector3, out: Matrix4, at: Vector3): void {
  const fy = _a.copy(headUp).addScaledVector(normal, -headUp.dot(normal));
  if (fy.lengthSq() < 1e-6) fy.set(0, 1, 0).addScaledVector(normal, -normal.y);
  fy.normalize();
  const fx = _b.crossVectors(fy, normal).normalize();
  out.makeBasis(fx, fy, normal).setPosition(at);
}

function makePoke(
  id: string,
  geo: CircleGeometry | PlaneGeometry,
  ringGeo: RingGeometry | null,
  pw: number,
  ph: number,
  radius: number,
): Poke {
  const group = new Group();
  const c = document.createElement('canvas');
  c.width = pw;
  c.height = ph;
  const ctx = c.getContext('2d')!;
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  const face = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: DoubleSide });
  const mesh = new Mesh(geo, face);
  mesh.renderOrder = 21;
  group.add(mesh);
  let ring: MeshBasicMaterial | null = null;
  if (ringGeo) {
    ring = new MeshBasicMaterial({
      color: 0xffa22e,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    const ringMesh = new Mesh(ringGeo, ring);
    ringMesh.renderOrder = 21;
    group.add(ringMesh);
  }
  return { id, group, face, ring, ctx, tex, radius, key: '', flash: 0, armed: true };
}

function costLabel(type: UnitType): string {
  const n = unitCost(type);
  return n > 0 ? `${n} COINS` : '';
}

function paintStud(s: Poke, label: string, hot: boolean): void {
  const g = s.ctx;
  g.clearRect(0, 0, 128, 128);
  if (label) {
    g.fillStyle = hot ? '#3a1612' : '#2a1f10';
    g.beginPath();
    g.arc(64, 64, 62, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = hot ? '#ff6a52' : '#ffa22e';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = font(700, label.length > 4 ? 26 : 32);
    g.fillText(label, 64, 66);
  }
  s.tex.needsUpdate = true;
}

/** A toolbelt tile: the machine's shop drawing, its name, its price. */
function paintTile(t: Poke, tool: string, armed: boolean, afford: boolean, cost: string): void {
  const g = t.ctx;
  const W = 160;
  const H = 176;
  g.clearRect(0, 0, W, H);
  g.fillStyle = armed ? 'rgba(255,162,46,0.28)' : 'rgba(11,10,7,0.86)';
  g.beginPath();
  g.roundRect(3, 3, W - 6, H - 6, 22);
  g.fill();
  g.strokeStyle = armed ? '#ffa22e' : tool === 'delete' ? 'rgba(255,90,70,0.6)' : 'rgba(255,162,46,0.45)';
  g.lineWidth = armed ? 6 : 3;
  g.stroke();
  unitGlyph(g, tool as GlyphId, 25, 8, 110, afford ? GLYPH_LIVE : GLYPH_DEAD);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font(700, 24);
  g.fillStyle = !afford ? 'rgba(250,244,235,0.35)' : tool === 'delete' ? '#ff6a52' : '#fdf6ec';
  g.fillText(TOOL_NAME[tool] ?? tool.toUpperCase(), W / 2, 128, W - 16);
  if (cost) {
    g.font = font(600, 17);
    g.fillStyle = afford ? '#ffa22e' : 'rgba(255,90,70,0.8)';
    g.fillText(cost, W / 2, 154, W - 16);
  }
  t.tex.needsUpdate = true;
}
