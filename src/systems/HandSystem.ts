/**
 * HandSystem — bare hands are the controller.
 *
 * Runs FIRST every frame and fills in input/intents.ts from whatever the
 * headset is giving it: a controller's trigger, squeeze and face buttons,
 * or a tracked hand's pinch and fist. Nothing downstream ever asks which.
 *
 * THE CUFF. A hand has no Ⓐ, Ⓑ or Ⓧ, and the siege needs all three — the
 * card, turning a piece, putting a tool down. So the left wrist wears a
 * cuff: a strip of plate on the inside of the wrist that comes up when
 * you turn it to look at it, the way you check a watch. It IS a watch —
 * the wave and the clock to the horn ride along its top — and under that
 * sit the studs you poke with your right index finger:
 *
 *     MENU  — always (DONE while you are marking out the floor)
 *     TURN  — while a tool is in hand (Ⓑ's quarter turn)
 *     DOWN  — while a tool is in hand (Ⓧ: put it away)
 *
 * It only takes presses while you are looking at it: a cuff you could
 * fire by brushing past a rail is a cuff that ends sieges.
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
  Quaternion,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  SRGBColorSpace,
  Vector3,
  type Object3D,
} from 'three';
import * as sfx from '../audio/sfx.js';
import { site } from '../game/state.js';
import { plant } from '../factory/state.js';
import { waveSpec } from '../factory/siege.js';
import { font } from '../ui/fonts.js';
import { UI } from '../ui/panel.js';
import { J, curledFingers, intents, isFist, pinchGap, step, type HandSide } from '../input/intents.js';
import { buildView } from './BuildSystem.js';

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
  /** The cuff as it stands: shown, which studs, where (world). */
  cuff?: () => {
    shown: boolean;
    facing: number;
    studs: Array<{ id: string; x: number; y: number; z: number; nx: number; ny: number; nz: number }>;
  };
  /** A hand's index tip, world (room) metres — what pokes the cuff. */
  tip?: (hand: HandSide) => [number, number, number] | null;
  /** Fingers curled per hand (0–4) — the fist detector's raw reading. */
  curl?: () => { left: number; right: number };
} = {};

/* ── the cuff's numbers (room metres) ───────────────────────────────────── */

const CUFF = {
  w: 0.092,
  h: 0.058,
  /** Back from the wrist joint toward the elbow, and up off the skin. */
  back: 0.05,
  lift: 0.024,
  stud: 0.0115,
  pitch: 0.029,
  /** How square to your eyes the inside of the wrist must be. */
  showDot: 0.45,
  hideDot: 0.3,
  /** Poke: within this of a stud's face, and this far across it. */
  pokeDepth: 0.012,
  pokeRadius: 0.016,
  rearm: 0.024,
  /** The pinch, from joints, when no gamepad reports it. */
  pinchOn: 0.018,
  pinchOff: 0.03,
};

type StudId = 'menu' | 'turn' | 'stow';

interface Stud {
  id: StudId;
  group: Group;
  face: MeshBasicMaterial;
  ring: MeshBasicMaterial;
  ctx: CanvasRenderingContext2D;
  tex: CanvasTexture;
  label: string;
  /** 0..1 press flash. */
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
const _cam = new Vector3();
const _tip = new Vector3();
const _p = new Vector3();
const _c = new Vector3();
const _q = new Quaternion();

export class HandSystem extends createSystem({}) {
  private cuff!: Group;
  private cuffMat!: MeshBasicMaterial;
  private face!: { ctx: CanvasRenderingContext2D; tex: CanvasTexture; key: string };
  private studs: Stud[] = [];
  private cuffShown = 0;
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

  init(): void {
    this.cuff = new Group();
    this.cuff.name = 'wrist-cuff';
    this.cuff.visible = false;
    this.scene.add(this.cuff);

    // The plate: dark glass with an amber hairline, the board's language.
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
    (['menu', 'turn', 'stow'] as StudId[]).forEach((id, k) => {
      const group = new Group();
      group.position.set((k - 1) * CUFF.pitch, -CUFF.h * 0.2, 0.002);
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 128;
      const ctx = c.getContext('2d')!;
      const tex = new CanvasTexture(c);
      tex.colorSpace = SRGBColorSpace;
      const face = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
      const mesh = new Mesh(studGeo, face);
      mesh.renderOrder = 21;
      group.add(mesh);
      const ring = new MeshBasicMaterial({
        color: 0xffa22e,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      });
      const ringMesh = new Mesh(ringGeo, ring);
      ringMesh.renderOrder = 21;
      group.add(ringMesh);
      this.cuff.add(group);
      this.studs.push({ id, group, face, ring, ctx, tex, label: '', flash: 0, armed: true });
    });

    handsView.state = () => ({
      handMode: intents.handMode,
      left: { mode: intents.left.mode, point: intents.left.point.pressed, grab: intents.left.grab.pressed },
      right: { mode: intents.right.mode, point: intents.right.point.pressed, grab: intents.right.grab.pressed },
    });
    handsView.press = (verb) => this.queued.add(verb);
    handsView.force = (hand, what, on) => {
      this.forced[hand][what] = on;
    };
    handsView.cuff = () => ({
      shown: this.cuff.visible && this.cuffShown > 0.5,
      facing: this.facing,
      studs: this.studs
        .filter((s) => s.group.visible)
        .map((s) => {
          s.group.getWorldPosition(_p);
          _n.set(0, 0, 1).transformDirection(s.group.matrixWorld);
          return { id: s.id, x: _p.x, y: _p.y, z: _p.z, nx: _n.x, ny: _n.y, nz: _n.z };
        }),
    });
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

    this.tickCuff(delta);
  }

  /* ── THE CUFF ─────────────────────────────────────────────────────────── */

  private tickCuff(delta: number): void {
    const xr = this.input.xr;
    const want = xr.isPrimary('hand', 'left');
    const joints = xr.visualAdapters.hand.left.jointTransforms;
    const grip = this.world.playerSpaceEntities?.gripSpaces?.left?.object3D as Object3D | undefined;
    if (!want || !joints || !grip) {
      this.cuff.visible = false;
      this.cuffShown = 0;
      return;
    }
    grip.updateWorldMatrix(true, false);
    const at = (j: number, out: Vector3): Vector3 =>
      out.set(joints[j * 16 + 12], joints[j * 16 + 13], joints[j * 16 + 14]).applyMatrix4(grip.matrixWorld);
    at(J.wrist, _w);
    at(J.indexMeta, _a).sub(_w);
    at(J.pinkyMeta, _b).sub(_w);
    at(J.middleMeta, _f).sub(_w).normalize();
    // The INSIDE of the left wrist: the palm's normal. (Index-then-pinky
    // across the back of a left hand points out of the knuckles, so the
    // palm is the other way.)
    _n.crossVectors(_a, _b).normalize().negate();
    // Where it sits: back along the forearm, up off the skin.
    _c.copy(_w).addScaledVector(_f, -CUFF.back).addScaledVector(_n, CUFF.lift);
    // UPRIGHT AS YOU READ IT. The face's "up" is the HEAD's up projected
    // onto the cuff — not the fingers' direction, which put the watch
    // upside down the moment a wrist was turned the other way.
    _x.set(0, 1, 0).applyQuaternion(this.camera.getWorldQuaternion(_q));
    _f.copy(_x).addScaledVector(_n, -_x.dot(_n));
    if (_f.lengthSq() < 1e-6) _f.set(0, 1, 0).addScaledVector(_n, -_n.y);
    _f.normalize();
    _x.crossVectors(_f, _n).normalize();
    _m.makeBasis(_x, _f, _n).setPosition(_c);
    this.cuff.matrixAutoUpdate = false;
    this.cuff.matrix.copy(_m);
    this.cuff.matrixWorldNeedsUpdate = true;

    // Up only while you are looking at it.
    this.camera.getWorldPosition(_cam);
    _p.copy(_cam).sub(_c).normalize();
    this.facing = _n.dot(_p);
    const showing = this.cuffShown > 0.5;
    const look = showing ? this.facing > CUFF.hideDot : this.facing > CUFF.showDot;
    this.cuffShown = Math.max(0, Math.min(1, this.cuffShown + (look ? delta : -delta) * 8));
    this.cuff.visible = this.cuffShown > 0.01;
    this.cuffMat.opacity = this.cuffShown;

    // What the studs say right now.
    const floor = site.screen === 'floor';
    const armed = (buildView.armed?.() ?? null) !== null && site.screen === 'factory';
    const live = site.screen === 'factory' || site.screen === 'shift' || floor;
    const labels: Record<StudId, string> = {
      menu: floor ? 'DONE' : site.paused ? 'BACK' : 'MENU',
      turn: armed ? 'TURN' : '',
      stow: armed ? 'DOWN' : '',
    };
    for (const s of this.studs) {
      const label = live ? labels[s.id] : '';
      s.group.visible = label !== '';
      if (label !== s.label) {
        s.label = label;
        paintStud(s);
      }
      s.flash = Math.max(0, s.flash - delta * 4);
      s.face.opacity = this.cuffShown;
      s.ring.opacity = this.cuffShown * (0.45 + 0.55 * s.flash);
      s.group.position.z = 0.002 - s.flash * 0.003;
    }
    this.paintFace();

    // THE POKE: the right index tip, pressed into a stud's face.
    if (this.cuffShown < 0.9) return;
    const tipObj = this.world.playerSpaceEntities?.indexTipSpaces?.right?.object3D as Object3D | undefined;
    if (!tipObj || !xr.isPrimary('hand', 'right')) return;
    tipObj.getWorldPosition(_tip);
    this.cuff.updateMatrixWorld(true);
    for (const s of this.studs) {
      if (!s.group.visible) continue;
      s.group.getWorldPosition(_p);
      _p.sub(_tip).negate(); // tip relative to the stud
      const depth = _p.dot(_n);
      const across = _p.addScaledVector(_n, -depth).length();
      const touching = across < CUFF.pokeRadius && depth < CUFF.pokeDepth && depth > -0.02;
      if (touching && s.armed && this.pokeCool <= 0) {
        s.armed = false;
        s.flash = 1;
        this.pokeCool = 0.35;
        this.fire(s.id, floor);
      } else if (!touching && (across > CUFF.rearm || depth > CUFF.rearm)) {
        s.armed = true;
      }
    }
  }

  private fire(id: StudId, floor: boolean): void {
    sfx.uiClick();
    if (id === 'menu') {
      intents.menu = !floor;
      intents.done = floor;
    } else if (id === 'turn') {
      intents.turn = true;
    } else {
      intents.stow = true;
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
      if (sg.phase === 'build') {
        const s = Math.ceil(sg.buildT);
        big = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      } else if (sg.phase === 'wave') {
        big = `${sg.queue.length + sg.enemies.length} LEFT`;
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

function paintStud(s: Stud): void {
  const g = s.ctx;
  g.clearRect(0, 0, 128, 128);
  if (!s.label) {
    s.tex.needsUpdate = true;
    return;
  }
  g.fillStyle = s.id === 'stow' ? '#3a1612' : '#2a1f10';
  g.beginPath();
  g.arc(64, 64, 62, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = s.id === 'stow' ? '#ff6a52' : '#ffa22e';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font(700, s.label.length > 4 ? 26 : 32);
  g.fillText(s.label, 64, 66);
  s.tex.needsUpdate = true;
}
