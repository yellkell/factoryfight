/**
 * SiegeSystem — the fight, drawn and voiced.
 *
 * The sim (factory/siege.ts) decides everything; this system owns only
 * what it looks and sounds like, the TUBES split exactly:
 *
 *   THE CRAWLERS   instanced, one pool per body part per kind — a floor
 *                  of forty skitters is a dozen draw calls. Legs walk on
 *                  the sim's own stride counter, so a slowed one visibly
 *                  wades, and a bitten-into wall is chewed by something
 *                  whose head is going.
 *   THE BREACHES   a crack of light at the foot of a REAL wall, chosen
 *                  during the build phase so the room tells you where to
 *                  wall before the horn goes — and when it goes, the
 *                  plaster opens and they climb out.
 *   THE GUNS       slewing heads, recoiling barrels, muzzle flash, the
 *                  breech pips, the barrel band in the chambered round's
 *                  colour.
 *   THE SHOTS      tracers, lobbed shells, frost bursts, arcs, beams.
 *   THE CORE       a health ring on the floor round it, and the one
 *                  plate the siege floats: wave, clock, core, bank.
 *
 * Everything lives in the plant frame (factory/frame.ts), in plant metres.
 */

import { createSystem } from '@iwsdk/core';
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type Material,
} from 'three';
import { AMMO, ENEMIES, LINES, SIEGE, type EnemyId, type ItemId } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { buzz } from '../game/haptics.js';
import { site } from '../game/state.js';
import { siegeFallen } from '../game/flow.js';
import { cellCenter } from '../floor/grid.js';
import { ensurePlantRoot, toPlant } from '../factory/frame.js';
import {
  bindRoom,
  breachHex,
  coreHealth,
  debugSpawn,
  soundHorn,
  waveSpec,
} from '../factory/siege.js';
import { dockUnit } from '../factory/sim.js';
import { plant, type Enemy, type SiegeFx } from '../factory/state.js';
import { glintTexture, sizedPointsMaterial } from '../materials/glow.js';
import { font } from '../ui/fonts.js';
import { liveUnitRefs } from './FactorySystem.js';
import { walls } from './WallSystem.js';

/** Headless hooks (wired into __tubes.siege in main.ts). */
export const siegeView: {
  state?: () => {
    phase: string;
    wave: number;
    name: string;
    buildT: number;
    waveT: number;
    queued: number;
    enemies: number;
    kills: number;
    core: number;
    won: boolean;
    breaches: Array<{ x: number; z: number }>;
    bank: Partial<Record<ItemId, number>>;
  };
  horn?: () => void;
  spawn?: (kind: EnemyId, breach?: number) => void;
  enemies?: () => Array<{ id: number; kind: string; x: number; z: number; hp: number; phase: string }>;
  turrets?: () => Array<{ id: number; ammo: number; loaded: string | null; rounds: number; yaw: number }>;
} = {};

/** What each round glows. Base parts wear their line; deep parts wear
 *  the mix they are made of. */
export const AMMO_COLOR: Record<ItemId, number> = {
  gear: LINES.mains.glow,
  cell: LINES.coolant.glow,
  chip: LINES.volt.glow,
  pump: 0xffd27a,
  lamp: 0xe4f6ff,
  servo: 0xffffff,
};

/* ── THE CRAWLERS: one kit per kind ─────────────────────────────────────── */

interface Comp {
  mesh: InstancedMesh;
  /** Instances per enemy (legs are six of one component). */
  per: number;
  /** Takes the hit flash / frost tint. */
  flashable: boolean;
  base: Color;
  /** Local pose of instance k of this component on enemy e at time t,
   *  in BODY units (1 = the enemy's radius). */
  pose: (e: Enemy, k: number, t: number, out: Matrix4) => void;
}

const CAP: Record<EnemyId, number> = { skitter: 140, grub: 48, sapper: 48, brute: 10 };

const _m = new Matrix4();
const _m2 = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _s = new Vector3();
const _col = new Color();
const _cam = new Vector3();
const _c = { x: 0, z: 0 };
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const _qa = new Quaternion();
const _lp = new Vector3();
const _ls = new Vector3();
const _qb = new Quaternion();

let _sphere: SphereGeometry | null = null;
const sphereGeo = (): SphereGeometry => (_sphere ??= new SphereGeometry(1, 14, 10));
let _box: BoxGeometry | null = null;
const boxGeo = (): BoxGeometry => (_box ??= new BoxGeometry(1, 1, 1));

function metal(color: number, rough = 0.45, metalness = 0.75): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness: rough, metalness });
}
function glow(color: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
}

/** Compose T·R·S into `out`. */
function trs(
  out: Matrix4,
  x: number,
  y: number,
  z: number,
  q: Quaternion,
  sx: number,
  sy: number,
  sz: number,
): Matrix4 {
  return out.compose(_v.set(x, y, z), q, _s.set(sx, sy, sz));
}
const IDQ = new Quaternion();

/** A leg: hip at (side·hx, hy, hz), angled out and down by `splay`,
 *  swinging fore and aft by `swing`, `len` long, `th` thick. */
function leg(
  out: Matrix4,
  side: number,
  hx: number,
  hy: number,
  hz: number,
  splay: number,
  swing: number,
  len: number,
  th: number,
): Matrix4 {
  _qa.setFromAxisAngle(Y, swing * side);
  _qb.setFromAxisAngle(Z, -side * splay);
  _q.multiplyQuaternions(_qa, _qb);
  // The box is long along X; offset its centre half a length out.
  _v.set(side * len * 0.5, 0, 0).applyQuaternion(_q);
  return out.compose(_lp.set(side * hx + _v.x, hy + _v.y, hz + _v.z), _q, _ls.set(len, th, th));
}

function makeKit(kind: EnemyId, parent: Group): Comp[] {
  const cap = CAP[kind];
  const comps: Comp[] = [];
  const add = (
    geo: BufferGeometry,
    mat: Material,
    per: number,
    flashable: boolean,
    base: number,
    pose: Comp['pose'],
  ): void => {
    const mesh = new InstancedMesh(geo, mat, cap * per);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    if (flashable) {
      for (let k = 0; k < cap * per; k++) mesh.setColorAt(k, _col.set(base));
    }
    parent.add(mesh);
    comps.push({ mesh, per, flashable, base: new Color(base), pose });
  };
  const gait = (e: Enemy, k: number, rate: number): number =>
    Math.sin(e.stride * rate + (k % 2 === 0 ? 0 : Math.PI) + Math.floor(k / 2) * 2.1);

  if (kind === 'skitter' || kind === 'sapper') {
    const shell = kind === 'skitter' ? 0x7a4026 : 0x4b5640;
    const eye = kind === 'skitter' ? 0xff5a1e : 0xffe14a;
    const legs = kind === 'skitter' ? 6 : 4;
    // The body: a squat tick on a lifted hip line, bobbing with its gait.
    add(sphereGeo(), metal(0xffffff, 0.42, 0.7), 1, true, shell, (e, _k, t, out) => {
      const bob = Math.abs(Math.sin(e.stride * 22)) * 0.08 + (e.phase === 'bite' ? Math.sin(t * 18) * 0.06 : 0);
      return trs(out, 0, 0.95 + bob, 0, IDQ, 0.9, 0.55, 1.15);
    });
    // The back plate — dark iron, hex, the scrap it is made of.
    add(new CylinderGeometry(1, 1, 1, 6), metal(0x262120, 0.5, 0.85), 1, false, 0x262120, (_e, _k, _t, out) =>
      trs(out, 0, 1.32, -0.05, IDQ, 0.68, 0.16, 0.8),
    );
    // Legs.
    add(boxGeo(), metal(0x1d1a18, 0.5, 0.8), legs, false, 0x1d1a18, (e, k, _t, out) => {
      const side = k % 2 === 0 ? -1 : 1;
      const row = Math.floor(k / 2);
      const rows = legs / 2;
      const hz = rows === 3 ? (row - 1) * 0.55 : (row - 0.5) * 0.8;
      const swing = 0.15 * (rows === 3 ? row - 1 : row - 0.5) + gait(e, k, 24) * 0.42;
      return leg(out, side, 0.55, 0.95, hz, 0.75, swing, 1.25, 0.13);
    });
    // Eyes.
    add(sphereGeo(), glow(eye), 2, false, eye, (_e, k, _t, out) =>
      trs(out, k === 0 ? -0.3 : 0.3, 1.05, 1.0, IDQ, 0.17, 0.17, 0.17),
    );
    if (kind === 'sapper') {
      // THE CHARGE on its back — and it beats faster the closer it is.
      add(sphereGeo(), glow(0xff2a12), 1, false, 0xff2a12, (e, _k, t, out) => {
        const rate = e.phase === 'bite' ? 30 : 8;
        const p = 0.5 + 0.5 * Math.sin(t * rate + e.id);
        const r = 0.5 + p * 0.12;
        return trs(out, 0, 1.6, -0.25, IDQ, r, r, r);
      });
      add(new CylinderGeometry(1, 1, 1, 8), metal(0x8b8f7a, 0.4, 0.8), 1, false, 0x8b8f7a, (_e, _k, _t, out) =>
        trs(out, 0, 1.28, -0.25, IDQ, 0.42, 0.12, 0.42),
      );
    }
  } else if (kind === 'grub') {
    const hide = 0x8b7a52;
    // Three segments, peristaltic: each one swells in turn.
    add(sphereGeo(), metal(0xffffff, 0.7, 0.25), 3, true, hide, (e, k, _t, out) => {
      const z = [0.55, -0.45, -1.35][k];
      const r = [1, 0.88, 0.72][k];
      const sw = 1 + 0.12 * Math.sin(e.stride * 14 - k * 1.6);
      return trs(out, 0, r * 0.78, z, IDQ, r * sw * 0.95, r * 0.75, r / sw);
    });
    // The glowing seams between them — it is full of the works' light.
    add(new TorusGeometry(1, 0.16, 8, 20), glow(0xc8ff3a), 2, false, 0xc8ff3a, (e, k, _t, out) => {
      const z = [0.05, -0.92][k];
      const r = [0.86, 0.74][k];
      const sw = 1 + 0.1 * Math.sin(e.stride * 14 - k * 1.6 - 0.8);
      return trs(out, 0, r * 0.7, z, IDQ, r * sw, r * 0.72 * sw, 1);
    });
    add(sphereGeo(), glow(0xffe14a), 2, false, 0xffe14a, (_e, k, _t, out) =>
      trs(out, k === 0 ? -0.35 : 0.35, 0.95, 1.38, IDQ, 0.13, 0.13, 0.13),
    );
    // Mandibles that work while it chews.
    add(boxGeo(), metal(0x221d18, 0.5, 0.7), 2, false, 0x221d18, (e, k, t, out) => {
      const side = k === 0 ? -1 : 1;
      const open = e.phase === 'bite' ? 0.35 + 0.35 * Math.sin(t * 14) : 0.2;
      _q.setFromAxisAngle(Y, side * open);
      return trs(out, side * 0.28, 0.45, 1.45, _q, 0.12, 0.12, 0.55);
    });
  } else {
    // THE BRUTE: a plated hulk on four thick legs, one red slit of an eye.
    add(sphereGeo(), metal(0xffffff, 0.5, 0.8), 1, true, 0x5a2a20, (e, _k, t, out) => {
      const bob = Math.abs(Math.sin(e.stride * 9)) * 0.06 + (e.phase === 'bite' ? Math.sin(t * 6) * 0.08 : 0);
      return trs(out, 0, 1.15 + bob, 0, IDQ, 1.05, 0.78, 1.2);
    });
    add(boxGeo(), metal(0x2b2827, 0.45, 0.9), 3, false, 0x2b2827, (e, k, t, out) => {
      const bob = Math.abs(Math.sin(e.stride * 9)) * 0.06 + (e.phase === 'bite' ? Math.sin(t * 6) * 0.08 : 0);
      if (k === 0) return trs(out, 0, 1.75 + bob, -0.1, IDQ, 1.5, 0.22, 1.45);
      const side = k === 1 ? -1 : 1;
      _q.setFromAxisAngle(Z, side * -0.35);
      return trs(out, side * 0.95, 1.45 + bob, 0.15, _q, 0.55, 0.5, 0.8);
    });
    add(boxGeo(), metal(0x1a1716, 0.5, 0.8), 4, false, 0x1a1716, (e, k, _t, out) => {
      const side = k % 2 === 0 ? -1 : 1;
      const hz = Math.floor(k / 2) === 0 ? 0.55 : -0.55;
      return leg(out, side, 0.7, 1.0, hz, 0.95, gait(e, k, 9) * 0.35, 1.2, 0.32);
    });
    add(boxGeo(), glow(0xff3020), 1, false, 0xff3020, (e, _k, t, out) => {
      const bob = Math.abs(Math.sin(e.stride * 9)) * 0.06 + (e.phase === 'bite' ? Math.sin(t * 6) * 0.08 : 0);
      return trs(out, 0, 1.25 + bob, 1.18, IDQ, 0.75, 0.1, 0.08);
    });
  }
  return comps;
}

/* ── THE BREACH ─────────────────────────────────────────────────────────── */

let _crackTex: CanvasTexture | null = null;
/** A crack in plaster: a jagged trunk from the floor up, branching, drawn
 *  white so the material colour lights it. */
function crackTexture(): CanvasTexture {
  if (_crackTex) return _crackTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#ffffff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.shadowColor = '#ffffff';
  g.shadowBlur = 10;
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const branch = (x: number, y: number, ang: number, len: number, w: number, depth: number): void => {
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, y);
    let px = x;
    let py = y;
    const steps = 6;
    for (let k = 0; k < steps; k++) {
      ang += (rnd() - 0.5) * 0.9;
      px += Math.sin(ang) * (len / steps);
      py -= Math.cos(ang) * (len / steps);
      g.lineTo(px, py);
      if (depth > 0 && rnd() < 0.35) branch(px, py, ang + (rnd() < 0.5 ? -1 : 1) * 0.9, len * 0.45, w * 0.6, depth - 1);
    }
    g.stroke();
  };
  branch(128, 256, 0, 200, 7, 2);
  branch(110, 256, -0.7, 120, 4, 1);
  branch(146, 256, 0.7, 120, 4, 1);
  _crackTex = new CanvasTexture(c);
  _crackTex.colorSpace = SRGBColorSpace;
  return _crackTex;
}

interface BreachHw {
  group: Group;
  crack: MeshBasicMaterial;
  hole: Mesh;
  pool: MeshBasicMaterial;
}

/* ── particles ──────────────────────────────────────────────────────────── */

const MAX_P = 900;

class Sparks {
  readonly points: Points;
  private pos = new Float32Array(MAX_P * 3);
  private col = new Float32Array(MAX_P * 3);
  private size = new Float32Array(MAX_P);
  private vel = new Float32Array(MAX_P * 3);
  private life = new Float32Array(MAX_P);
  private maxLife = new Float32Array(MAX_P);
  private base = new Float32Array(MAX_P * 3);
  private grav = new Float32Array(MAX_P);
  private next = 0;

  constructor() {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage));
    geo.setAttribute('color', new BufferAttribute(this.col, 3).setUsage(DynamicDrawUsage));
    geo.setAttribute('aSize', new BufferAttribute(this.size, 1).setUsage(DynamicDrawUsage));
    const mat = sizedPointsMaterial({
      size: 0.05,
      map: glintTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      sizeAttenuation: true,
    });
    this.points = new Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 15;
  }

  burst(
    x: number,
    y: number,
    z: number,
    n: number,
    color: number,
    speed: number,
    life = 0.5,
    gravity = 3,
    size = 1,
  ): void {
    _col.set(color);
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX_P;
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.9 + 0.1;
      const sp = speed * (0.4 + Math.random() * 0.6);
      this.vel[i * 3] = Math.cos(a) * sp * (1 - up * 0.5);
      this.vel[i * 3 + 1] = up * sp;
      this.vel[i * 3 + 2] = Math.sin(a) * sp * (1 - up * 0.5);
      this.base[i * 3] = _col.r;
      this.base[i * 3 + 1] = _col.g;
      this.base[i * 3 + 2] = _col.b;
      this.life[i] = this.maxLife[i] = life * (0.6 + Math.random() * 0.6);
      this.grav[i] = gravity;
      this.size[i] = size * (0.6 + Math.random() * 0.8);
    }
  }

  tick(dt: number): void {
    for (let i = 0; i < MAX_P; i++) {
      if (this.life[i] <= 0) {
        this.size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const f = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] = Math.max(0.01, this.pos[i * 3 + 1] + this.vel[i * 3 + 1] * dt);
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.col[i * 3] = this.base[i * 3] * f;
      this.col[i * 3 + 1] = this.base[i * 3 + 1] * f;
      this.col[i * 3 + 2] = this.base[i * 3 + 2] * f;
    }
    const g = this.points.geometry;
    (g.attributes.position as BufferAttribute).needsUpdate = true;
    (g.attributes.color as BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as BufferAttribute).needsUpdate = true;
  }
}

/** A pooled one-shot mesh that fades out (rings, flashes, beams). */
interface Flare {
  mesh: Mesh;
  mat: MeshBasicMaterial;
  t: number;
  life: number;
  grow: number;
  start: number;
  peak: number;
}

interface ArcHw {
  lines: LineSegments;
  mat: LineBasicMaterial;
  t: number;
}

/* ── the system ─────────────────────────────────────────────────────────── */

export class SiegeSystem extends createSystem({}) {
  private root!: Group;
  private kits = new Map<EnemyId, Comp[]>();
  private shotsMesh!: InstancedMesh;
  private bars!: InstancedMesh;
  private barBacks!: InstancedMesh;
  private sparks!: Sparks;
  private rings: Flare[] = [];
  private flashes: Flare[] = [];
  private beams: Flare[] = [];
  private arcs: ArcHw[] = [];
  private breachHw: BreachHw[] = [];
  private breachKey = '';
  private breachFlare = 0;
  private clock = 0;
  /** Per-turret: seconds of recoil/flash left. */
  private recoil = new Map<number, number>();
  /** THE CORE's ring and plate. */
  private coreRing!: Mesh;
  private coreRingMat!: MeshBasicMaterial;
  private coreRingFrac = -1;
  private coreHit = 0;
  private plate!: Mesh;
  private plateCtx!: CanvasRenderingContext2D;
  private plateTex!: CanvasTexture;
  private plateKey = '';
  private lastPhase = '';
  /** Seconds since the core went — the fall plays before the card. */
  private fallenT = 0;

  init(): void {
    this.root = new Group();
    this.root.name = 'siege';
    ensurePlantRoot(this.scene).add(this.root);
    bindRoom(walls);

    for (const kind of Object.keys(CAP) as EnemyId[]) this.kits.set(kind, makeKit(kind, this.root));

    this.shotsMesh = new InstancedMesh(
      sphereGeo(),
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false }),
      240,
    );
    this.shotsMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    for (let k = 0; k < 240; k++) this.shotsMesh.setColorAt(k, _col.set(0xffffff));
    this.shotsMesh.count = 0;
    this.shotsMesh.frustumCulled = false;
    this.shotsMesh.renderOrder = 14;
    this.root.add(this.shotsMesh);

    const barGeo = new PlaneGeometry(1, 1);
    this.barBacks = new InstancedMesh(
      barGeo,
      new MeshBasicMaterial({ color: 0x0b0a07, transparent: true, opacity: 0.75, depthWrite: false, side: DoubleSide }),
      260,
    );
    this.bars = new InstancedMesh(
      barGeo,
      new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide, depthWrite: false, transparent: true }),
      260,
    );
    for (const m of [this.barBacks, this.bars]) {
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      m.renderOrder = 16;
      this.root.add(m);
    }
    for (let k = 0; k < 260; k++) this.bars.setColorAt(k, _col.set(0xffffff));

    this.sparks = new Sparks();
    this.root.add(this.sparks.points);

    const ringGeo = new RingGeometry(0.86, 1, 40);
    for (let k = 0; k < 24; k++) {
      const mat = glow(0xffffff);
      mat.side = DoubleSide;
      const mesh = new Mesh(ringGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 15;
      this.root.add(mesh);
      this.rings.push({ mesh, mat, t: 0, life: 0, grow: 0, start: 0, peak: 1 });
    }
    for (let k = 0; k < 16; k++) {
      const mat = glow(0xffffff);
      const mesh = new Mesh(sphereGeo(), mat);
      mesh.visible = false;
      mesh.renderOrder = 15;
      this.root.add(mesh);
      this.flashes.push({ mesh, mat, t: 0, life: 0, grow: 0, start: 0, peak: 1 });
    }
    const beamGeo = new CylinderGeometry(1, 1, 1, 10, 1, true);
    beamGeo.rotateX(Math.PI / 2);
    for (let k = 0; k < 10; k++) {
      const mat = glow(0xffffff);
      mat.side = DoubleSide;
      const mesh = new Mesh(beamGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 15;
      this.root.add(mesh);
      this.beams.push({ mesh, mat, t: 0, life: 0, grow: 0, start: 0, peak: 1 });
    }
    for (let k = 0; k < 10; k++) {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(64 * 3), 3).setUsage(DynamicDrawUsage));
      const mat = new LineBasicMaterial({
        color: LINES.volt.foam,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const lines = new LineSegments(geo, mat);
      lines.visible = false;
      lines.frustumCulled = false;
      lines.renderOrder = 15;
      this.root.add(lines);
      this.arcs.push({ lines, mat, t: 1 });
    }

    // THE CORE's ring: an arc of light on the floor, as long as its health.
    this.coreRingMat = glow(0x6cff9a);
    this.coreRingMat.side = DoubleSide;
    this.coreRing = new Mesh(new RingGeometry(0.21, 0.25, 48), this.coreRingMat);
    this.coreRing.rotation.x = -Math.PI / 2;
    this.coreRing.visible = false;
    this.root.add(this.coreRing);

    // THE PLATE — the one sign the siege floats.
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 240;
    this.plateCtx = canvas.getContext('2d')!;
    this.plateTex = new CanvasTexture(canvas);
    this.plateTex.colorSpace = SRGBColorSpace;
    this.plate = new Mesh(
      new PlaneGeometry(0.64, 0.24),
      new MeshBasicMaterial({ map: this.plateTex, transparent: true, depthWrite: false, side: DoubleSide }),
    );
    this.plate.visible = false;
    this.plate.renderOrder = 17;
    this.root.add(this.plate);

    siegeView.state = () => {
      const sg = plant.siege;
      return {
        phase: sg.phase,
        wave: sg.wave,
        name: waveSpec(sg.wave).name,
        buildT: sg.buildT,
        waveT: sg.waveT,
        queued: sg.queue.length,
        enemies: sg.enemies.length,
        kills: sg.kills,
        core: coreHealth(),
        won: sg.won,
        breaches: sg.breaches.map((b) => ({ x: b.x, z: b.z })),
        bank: { ...plant.bank },
      };
    };
    siegeView.horn = () => soundHorn();
    siegeView.spawn = (kind, breach = 0) => debugSpawn(kind, breach);
    siegeView.enemies = () =>
      plant.siege.enemies.map((e) => ({ id: e.id, kind: e.kind, x: e.x, z: e.z, hp: e.hp, phase: e.phase }));
    siegeView.turrets = () =>
      plant.units
        .filter((u) => u.type === 'turret')
        .map((u) => ({
          id: u.id,
          ammo: u.ammo?.length ?? 0,
          loaded: u.loaded ?? null,
          rounds: u.rounds ?? 0,
          yaw: u.yaw ?? 0,
        }));
  }

  update(delta: number): void {
    this.clock += delta;
    const sg = plant.siege;
    const live = site.screen === 'factory' && sg.phase !== 'off';
    this.root.visible = live;
    if (!live) {
      if (this.breachHw.length) this.syncBreaches(true);
      return;
    }
    const dt = delta * plant.timeScale;

    this.camera.getWorldPosition(_cam);
    toPlant(_cam);

    if (sg.phase !== this.lastPhase) {
      this.lastPhase = sg.phase;
      this.plateKey = '';
      this.fallenT = 0;
    }
    if (sg.phase === 'fallen' && !site.finale) {
      this.fallenT += delta;
      if (this.fallenT > 2.6) siegeFallen();
    }

    this.drainFx();
    this.syncBreaches(false);
    this.tickBreaches(delta);
    this.drawEnemies();
    this.drawShots();
    this.drawBars();
    this.tickGuns(delta);
    this.tickFlares(dt);
    this.sparks.tick(dt);
    this.tickCore(delta);
  }

  /* ── fx ─────────────────────────────────────────────────────────────── */

  private drainFx(): void {
    const list = plant.siege.fx.splice(0);
    for (const f of list) this.perform(f);
  }

  private perform(f: SiegeFx): void {
    const color = f.ammo ? AMMO_COLOR[f.ammo] : 0xffa22e;
    switch (f.kind) {
      case 'fire': {
        if (f.unit !== undefined) this.recoil.set(f.unit, 1);
        this.sparks.burst(f.x, f.y, f.z, 4, color, 0.8, 0.18, 0, 0.7);
        if (f.ammo) sfx.gunFire(AMMO[f.ammo].kind);
        break;
      }
      case 'hit':
        this.sparks.burst(f.x, f.y, f.z, 7, color, 1.2, 0.3, 4, 0.8);
        break;
      case 'kill': {
        const big = f.enemy === 'brute' || f.enemy === 'grub';
        this.sparks.burst(f.x, f.y + 0.05, f.z, big ? 40 : 16, 0xff7a3a, big ? 1.8 : 1.3, 0.7, 5, big ? 1.6 : 1);
        this.sparks.burst(f.x, f.y + 0.05, f.z, big ? 14 : 6, 0x8a8a8a, 1.1, 0.9, 6, 1.4);
        this.flash(f.x, f.y + 0.06, f.z, 0xffa860, big ? 0.22 : 0.1, 0.18);
        sfx.scrapCrunch(big);
        break;
      }
      case 'blast': {
        const r = f.radius ?? 0.3;
        const big = f.ammo === 'servo';
        this.ring(f.x, f.z, f.ammo ? color : 0xff5a1e, r, 0.45);
        this.flash(f.x, f.y + 0.05, f.z, f.ammo ? color : 0xffb060, r * 0.7, 0.28);
        this.sparks.burst(f.x, f.y + 0.05, f.z, big ? 80 : 30, f.ammo ? color : 0xff7a2a, big ? 2.6 : 1.7, 0.6, 4, 1.3);
        sfx.shellBurst(big || (f.radius ?? 0) > 0.6);
        if (!f.ammo && f.unit === undefined) buzz(this.world, 'both', 0.35, 60);
        break;
      }
      case 'frost':
        this.ring(f.x, f.z, LINES.coolant.glow, f.radius ?? 0.4, 0.6);
        this.flash(f.x, 0.08, f.z, LINES.coolant.foam, (f.radius ?? 0.4) * 0.6, 0.3);
        this.sparks.burst(f.x, 0.1, f.z, 22, LINES.coolant.foam, 1.0, 0.7, 1.5, 1.1);
        sfx.frostCrack();
        break;
      case 'arc':
        if (f.path) this.arc(f.path);
        for (let k = 3; k + 2 < (f.path?.length ?? 0); k += 3) {
          const p = f.path!;
          this.sparks.burst(p[k], p[k + 1], p[k + 2], 6, LINES.volt.glow, 1.2, 0.3, 3, 0.9);
        }
        break;
      case 'beam':
        if (f.path) this.beam(f.path, color);
        break;
      case 'bite':
        this.sparks.burst(f.x, 0.3, f.z, 3, 0xffc070, 0.7, 0.25, 4, 0.6);
        sfx.plantGnaw();
        break;
      case 'core-hit':
        this.coreHit = 1;
        this.sparks.burst(f.x, 0.5, f.z, 5, 0xff4030, 0.8, 0.3, 4, 0.8);
        sfx.coreAlarm();
        buzz(this.world, 'both', 0.25, 40);
        break;
      case 'breach':
        this.breachFlare = 1;
        break;
      case 'horn':
        this.breachFlare = 1.5;
        sfx.siegeHorn();
        sfx.wallKnock();
        buzz(this.world, 'both', 0.5, 120);
        this.plateKey = '';
        break;
      case 'clear':
        sfx.allClear();
        this.plateKey = '';
        break;
      case 'victory':
        sfx.ceremonyChord();
        this.plateKey = '';
        break;
      case 'fallen':
        sfx.coreFall();
        this.ring(f.x, f.z, 0xff3020, 1.4, 1.4);
        this.flash(f.x, 0.6, f.z, 0xff6a30, 0.6, 0.8);
        this.sparks.burst(f.x, 0.7, f.z, 160, 0xff8a3a, 3, 1.4, 4, 1.8);
        buzz(this.world, 'both', 1, 400);
        this.plateKey = '';
        break;
    }
  }

  private take(pool: Flare[]): Flare {
    let best = pool[0];
    for (const f of pool) {
      if (!f.mesh.visible) return f;
      if (f.t / f.life > best.t / best.life) best = f;
    }
    return best;
  }

  private ring(x: number, z: number, color: number, r: number, life: number): void {
    const f = this.take(this.rings);
    f.mesh.position.set(x, 0.02, z);
    f.mat.color.set(color);
    f.t = 0;
    f.life = life;
    f.start = r * 0.2;
    f.grow = r;
    f.peak = 0.9;
    f.mesh.visible = true;
  }

  private flash(x: number, y: number, z: number, color: number, r: number, life: number): void {
    const f = this.take(this.flashes);
    f.mesh.position.set(x, y, z);
    f.mat.color.set(color);
    f.t = 0;
    f.life = life;
    f.start = r * 0.4;
    f.grow = r;
    f.peak = 0.85;
    f.mesh.visible = true;
  }

  private beam(path: number[], color: number): void {
    const f = this.take(this.beams);
    const [x0, y0, z0, x1, y1, z1] = path;
    _v.set(x1 - x0, y1 - y0, z1 - z0);
    const len = _v.length();
    f.mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    f.mesh.quaternion.setFromUnitVectors(Z, _v.normalize());
    f.mesh.scale.set(0.03, 0.03, len);
    f.mat.color.set(color);
    f.t = 0;
    f.life = 0.22;
    f.start = 0.035;
    f.grow = 0;
    f.peak = 1;
    f.mesh.visible = true;
    this.sparks.burst(x1, y1, z1, 10, color, 1.4, 0.3, 2, 1);
  }

  private arc(path: number[]): void {
    const hw = this.arcs.find((a) => !a.lines.visible) ?? this.arcs[0];
    const pos = hw.lines.geometry.attributes.position as BufferAttribute;
    const arr = pos.array as Float32Array;
    let n = 0;
    // Each hop is a jagged run of four kinks, drawn as segments.
    for (let k = 0; k + 5 < path.length && n < 60; k += 3) {
      const ax = path[k];
      const ay = path[k + 1];
      const az = path[k + 2];
      const bx = path[k + 3];
      const by = path[k + 4];
      const bz = path[k + 5];
      let px = ax;
      let py = ay;
      let pz = az;
      for (let s = 1; s <= 5 && n < 62; s++) {
        const t = s / 5;
        const j = s === 5 ? 0 : 0.05;
        const qx = ax + (bx - ax) * t + (Math.random() - 0.5) * j;
        const qy = ay + (by - ay) * t + (Math.random() - 0.5) * j;
        const qz = az + (bz - az) * t + (Math.random() - 0.5) * j;
        arr.set([px, py, pz, qx, qy, qz], n * 3);
        n += 2;
        px = qx;
        py = qy;
        pz = qz;
      }
    }
    hw.lines.geometry.setDrawRange(0, n);
    pos.needsUpdate = true;
    hw.t = 0;
    hw.lines.visible = true;
  }

  private tickFlares(dt: number): void {
    for (const pool of [this.rings, this.flashes, this.beams]) {
      for (const f of pool) {
        if (!f.mesh.visible) continue;
        f.t += dt;
        const p = f.t / f.life;
        if (p >= 1) {
          f.mesh.visible = false;
          continue;
        }
        f.mat.opacity = f.peak * (1 - p) ** 1.5;
        if (pool !== this.beams) {
          const r = f.start + (f.grow - f.start) * (1 - (1 - p) ** 3);
          f.mesh.scale.setScalar(Math.max(0.001, r));
        } else {
          const w = f.start * (1 - p * 0.6);
          f.mesh.scale.x = w;
          f.mesh.scale.y = w;
        }
      }
    }
    for (const a of this.arcs) {
      if (!a.lines.visible) continue;
      a.t += dt;
      a.mat.opacity = Math.max(0, 1 - a.t / 0.16);
      if (a.t > 0.16) a.lines.visible = false;
    }
  }

  /* ── the crawlers ───────────────────────────────────────────────────── */

  private drawEnemies(): void {
    const counts = new Map<EnemyId, number>();
    for (const e of plant.siege.enemies) {
      const kit = this.kits.get(e.kind);
      if (!kit) continue;
      const idx = counts.get(e.kind) ?? 0;
      if (idx >= CAP[e.kind]) continue;
      counts.set(e.kind, idx + 1);
      const r = ENEMIES[e.kind].radius;
      // Climbing out of the plaster: it rises as it emerges.
      const sink = e.phase === 'emerge' ? Math.max(0, 1 - e.phaseT * 1.6) * r * 0.8 : 0;
      _q.setFromAxisAngle(Y, e.heading);
      const base = trs(_m2, e.x, -sink, e.z, _q, r, r, r);
      // Hit flash to white; frost tints toward ice.
      const flash = e.flash > 0 ? e.flash / 0.12 : 0;
      const frost = e.slowT > 0 ? 0.55 : 0;
      for (const comp of kit) {
        for (let k = 0; k < comp.per; k++) {
          comp.pose(e, k, this.clock, _m);
          _m.premultiply(base);
          comp.mesh.setMatrixAt(idx * comp.per + k, _m);
          if (comp.flashable) {
            _col.copy(comp.base);
            if (frost) _col.lerp(_tmpIce, frost);
            if (flash) _col.lerp(_tmpWhite, flash);
            comp.mesh.setColorAt(idx * comp.per + k, _col);
          }
        }
      }
    }
    for (const [kind, kit] of this.kits) {
      const n = counts.get(kind) ?? 0;
      for (const comp of kit) {
        comp.mesh.count = n * comp.per;
        // An empty pool is not drawn at all — a zero-count instanced mesh
        // still costs a draw call, and there are thirty of these.
        comp.mesh.visible = n > 0;
        comp.mesh.instanceMatrix.needsUpdate = true;
        if (comp.flashable && comp.mesh.instanceColor) comp.mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  private drawShots(): void {
    let n = 0;
    for (const s of plant.siege.shots) {
      if (n >= 240) break;
      const p = Math.min(1, s.t / s.dur);
      const spec = AMMO[s.ammo];
      const x = s.x0 + (s.x1 - s.x0) * p;
      const z = s.z0 + (s.z1 - s.z0) * p;
      const dist = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
      // Shells LOB; slugs fly flat and stretched.
      const lob = spec.kind === 'slug' ? 0 : dist * (spec.kind === 'frost' ? 0.18 : 0.32);
      const y = s.y0 + (s.y1 - s.y0) * p + Math.sin(p * Math.PI) * lob;
      _v.set(s.x1 - s.x0, s.y1 - s.y0 + Math.cos(p * Math.PI) * lob * Math.PI, s.z1 - s.z0).normalize();
      _q.setFromUnitVectors(Z, _v);
      const r = spec.kind === 'slug' ? 0.014 : spec.kind === 'bigone' ? 0.06 : 0.032;
      const len = spec.kind === 'slug' ? 5 : 1.3;
      trs(_m, x, y, z, _q, r, r, r * len);
      this.shotsMesh.setMatrixAt(n, _m);
      this.shotsMesh.setColorAt(n, _col.set(AMMO_COLOR[s.ammo]));
      n++;
      // Shells leave a short trail.
      if (spec.kind !== 'slug' && Math.random() < 0.5) {
        this.sparks.burst(x, y, z, 1, AMMO_COLOR[s.ammo], 0.05, 0.25, 0, 0.6);
      }
    }
    this.shotsMesh.count = n;
    this.shotsMesh.visible = n > 0;
    this.shotsMesh.instanceMatrix.needsUpdate = true;
    if (this.shotsMesh.instanceColor) this.shotsMesh.instanceColor.needsUpdate = true;
  }

  /** Health bars over anything hurt — crawlers and plant alike. They
   *  only show when they have something to say. */
  private drawBars(): void {
    let n = 0;
    const put = (x: number, y: number, z: number, frac: number, w: number, color: number): void => {
      if (n >= 260) return;
      const yaw = Math.atan2(_cam.x - x, _cam.z - z);
      _q.setFromAxisAngle(Y, yaw);
      trs(_m, x, y, z, _q, w + 0.012, 0.028, 1);
      this.barBacks.setMatrixAt(n, _m);
      // The fill hangs off the bar's left end (in its own facing).
      const off = (w * (1 - frac)) / 2;
      const ox = -Math.cos(yaw) * off;
      const oz = Math.sin(yaw) * off;
      trs(_m, x + ox, y, z + oz, _q, Math.max(0.001, w * frac), 0.016, 1);
      this.bars.setMatrixAt(n, _m);
      this.bars.setColorAt(n, _col.set(color));
      n++;
    };
    for (const e of plant.siege.enemies) {
      if (e.hp >= e.maxHp) continue;
      const r = ENEMIES[e.kind].radius;
      put(e.x, r * 2.3 + 0.06, e.z, Math.max(0, e.hp / e.maxHp), Math.max(0.12, r * 1.6), 0xff5a3a);
    }
    for (const u of plant.units) {
      if (u.hp >= u.maxHp - 0.01 || u.type === 'dock') continue;
      cellCenter(u.i, u.j, _c);
      const f = Math.max(0, u.hp / u.maxHp);
      put(_c.x, u.type === 'wall' ? 0.74 : 1.12, _c.z, f, 0.26, f > 0.5 ? 0x6cff9a : f > 0.25 ? 0xffc23a : 0xff4030);
    }
    for (const m of [this.barBacks, this.bars]) {
      m.count = n;
      m.visible = n > 0;
      m.instanceMatrix.needsUpdate = true;
    }
    if (this.bars.instanceColor) this.bars.instanceColor.needsUpdate = true;
  }

  /* ── the guns ───────────────────────────────────────────────────────── */

  private tickGuns(delta: number): void {
    for (const u of plant.units) {
      if (u.type !== 'turret') continue;
      const refs = liveUnitRefs.get(u.id);
      const gun = refs?.gun;
      if (!refs || !gun) continue;
      // The head slews in WORLD yaw; the unit's group is already turned.
      gun.head.rotation.y = (u.yaw ?? 0) - refs.group.rotation.y;
      let r = this.recoil.get(u.id) ?? 0;
      if (r > 0) {
        r = Math.max(0, r - delta * 7);
        this.recoil.set(u.id, r);
      }
      gun.barrel.position.z = 0.08 - r * r * 0.05;
      gun.flash.opacity = r > 0.55 ? (r - 0.55) / 0.45 : 0;
      gun.flashMesh.scale.set(0.05 + r * 0.03, 0.08 + r * 0.1, 0.05 + r * 0.03);
      const chambered = u.loaded ?? u.ammo?.[0] ?? null;
      gun.band.color.set(chambered ? AMMO_COLOR[chambered] : 0x222222);
      gun.flash.color.set(chambered ? AMMO_COLOR[chambered] : 0xffd38a).lerp(_tmpWhite, 0.4);
      const loaded = u.ammo?.length ?? 0;
      gun.pips.forEach((m, k) => {
        const item = u.ammo?.[k];
        m.color.set(item ? AMMO_COLOR[item] : 0x1a1a1a);
        m.opacity = k < loaded ? 0.95 : 0.4;
      });
    }
  }

  /* ── the breaches ───────────────────────────────────────────────────── */

  private syncBreaches(clear: boolean): void {
    const list = clear ? [] : plant.siege.breaches;
    const key = list.map((b) => `${b.x.toFixed(2)},${b.z.toFixed(2)}`).join('|');
    if (key === this.breachKey) return;
    this.breachKey = key;
    for (const hw of this.breachHw) hw.group.removeFromParent();
    this.breachHw = [];
    for (const b of list) {
      const group = new Group();
      group.position.set(b.x + b.nx * 0.012, 0, b.z + b.nz * 0.012);
      group.rotation.y = Math.atan2(b.nx, b.nz);
      // The hole: dark, an arch at the foot of the plaster.
      const hole = new Mesh(new CircleGeometry(1, 24, 0, Math.PI), new MeshBasicMaterial({ color: 0x050403 }));
      hole.scale.set(0.24, 0.3, 1);
      hole.position.z = 0.002;
      group.add(hole);
      const crack = new MeshBasicMaterial({
        map: crackTexture(),
        color: breachHex(),
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const crackMesh = new Mesh(new PlaneGeometry(0.9, 0.9), crack);
      crackMesh.position.set(0, 0.45, 0.006);
      crackMesh.renderOrder = 13;
      group.add(crackMesh);
      // The glow it throws on the floor in front of it.
      const pool = glow(breachHex());
      pool.side = DoubleSide;
      const poolMesh = new Mesh(new CircleGeometry(1, 28), pool);
      poolMesh.rotation.x = -Math.PI / 2;
      poolMesh.scale.set(0.42, 0.3, 1);
      poolMesh.position.set(0, 0.004, 0.18);
      group.add(poolMesh);
      // Rubble: broken plaster on the boards.
      const rubbleMat = new MeshStandardMaterial({ color: 0xd8d2c6, roughness: 0.9, metalness: 0 });
      for (let k = 0; k < 7; k++) {
        const chunk = new Mesh(boxGeo(), rubbleMat);
        const s = 0.025 + Math.random() * 0.035;
        chunk.scale.set(s, s * 0.6, s * 1.2);
        chunk.position.set((Math.random() - 0.5) * 0.5, s * 0.3, 0.05 + Math.random() * 0.22);
        chunk.rotation.set(Math.random(), Math.random() * 3, Math.random());
        group.add(chunk);
      }
      this.root.add(group);
      this.breachHw.push({ group, crack, hole, pool });
    }
  }

  private tickBreaches(delta: number): void {
    const sg = plant.siege;
    this.breachFlare = Math.max(0, this.breachFlare - delta * 0.8);
    const fighting = sg.phase === 'wave';
    const hex = breachHex();
    for (const hw of this.breachHw) {
      // Build phase: the crack breathes — a warning, not yet a door.
      // Wave: it is OPEN, the hole yawns, the light is steady and hot.
      const breathe = 0.5 + 0.5 * Math.sin(this.clock * (fighting ? 9 : 2.4));
      hw.crack.color.set(hex);
      hw.pool.color.set(hex);
      hw.crack.opacity = Math.min(1, (fighting ? 0.75 : 0.35) + breathe * 0.25 + this.breachFlare * 0.5);
      hw.pool.opacity = (fighting ? 0.35 : 0.12) + breathe * 0.1 + this.breachFlare * 0.2;
      const open = fighting ? 1 : 0.25;
      const s = hw.hole.scale;
      s.x += (0.24 * open + 0.02 - s.x) * Math.min(1, delta * 4);
      s.y += (0.3 * open + 0.02 - s.y) * Math.min(1, delta * 4);
    }
  }

  /* ── the core ───────────────────────────────────────────────────────── */

  private tickCore(delta: number): void {
    const core = dockUnit();
    if (!core) {
      this.coreRing.visible = false;
      this.plate.visible = false;
      return;
    }
    cellCenter(core.i, core.j, _c);
    const frac = coreHealth();
    if (Math.abs(frac - this.coreRingFrac) > 0.004) {
      this.coreRingFrac = frac;
      this.coreRing.geometry.dispose();
      this.coreRing.geometry = new RingGeometry(0.2, 0.245, 48, 1, Math.PI / 2, Math.max(0.001, frac * Math.PI * 2));
      this.plateKey = '';
    }
    this.coreHit = Math.max(0, this.coreHit - delta * 3);
    this.coreRing.position.set(_c.x, 0.015, _c.z);
    this.coreRing.visible = true;
    _col.set(frac > 0.5 ? 0x6cff9a : frac > 0.25 ? 0xffc23a : 0xff4030);
    if (this.coreHit > 0) _col.lerp(_tmpWhite, this.coreHit * 0.6);
    this.coreRingMat.color.copy(_col);
    this.coreRingMat.opacity = 0.55 + 0.3 * Math.sin(this.clock * (frac < 0.25 ? 10 : 2)) ** 2;

    // The plate rides over the core, turned to face you.
    this.plate.position.set(_c.x, 1.32, _c.z);
    this.plate.rotation.y = Math.atan2(_cam.x - _c.x, _cam.z - _c.z);
    this.plate.visible = !site.paused;
    this.paintPlate();
  }

  private paintPlate(): void {
    const sg = plant.siege;
    const spec = waveSpec(sg.wave);
    const secs = sg.phase === 'build' ? Math.ceil(sg.buildT) : Math.floor(sg.waveT);
    const left = sg.queue.length + sg.enemies.length;
    const bank = plant.bank;
    const key = `${sg.phase}|${sg.wave}|${secs}|${left}|${Math.round(coreHealth() * 100)}|${JSON.stringify(bank)}`;
    if (key === this.plateKey) return;
    this.plateKey = key;
    const g = this.plateCtx;
    const W = 640;
    const H = 240;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(11,10,7,0.78)';
    g.beginPath();
    g.roundRect(4, 4, W - 8, H - 8, 18);
    g.fill();
    g.strokeStyle = sg.phase === 'wave' ? 'rgba(255,74,38,0.7)' : 'rgba(255,162,46,0.55)';
    g.lineWidth = 3;
    g.stroke();
    g.textBaseline = 'alphabetic';
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.font = font(600, 24);
    g.fillText(`WAVE ${sg.wave + 1}${sg.wave >= 10 ? '' : ' / 10'}`, 28, 46);
    g.fillStyle = '#fdf6ec';
    g.font = font(700, 40);
    g.fillText(spec.name, 28, 92);
    // The clock, right-aligned.
    g.textAlign = 'right';
    if (sg.phase === 'build') {
      g.fillStyle = '#ffa22e';
      g.font = font(700, 54);
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      g.fillText(`${m}:${String(s).padStart(2, '0')}`, W - 28, 92);
      g.font = font(600, 22);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fillText('UNTIL THE HORN', W - 28, 46);
    } else if (sg.phase === 'wave') {
      g.fillStyle = '#ff5a3a';
      g.font = font(700, 54);
      g.fillText(`${left}`, W - 28, 92);
      g.font = font(600, 22);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fillText('INCOMING', W - 28, 46);
    } else if (sg.phase === 'fallen') {
      g.fillStyle = '#ff4030';
      g.font = font(700, 44);
      g.fillText('FALLEN', W - 28, 92);
    }
    g.textAlign = 'left';
    // THE CORE.
    const frac = coreHealth();
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(28, 118, W - 56, 22);
    g.fillStyle = frac > 0.5 ? '#6cff9a' : frac > 0.25 ? '#ffc23a' : '#ff4030';
    g.fillRect(28, 118, (W - 56) * frac, 22);
    g.fillStyle = '#0b0a07';
    g.font = font(700, 18);
    g.fillText('CORE', 36, 136);
    // THE BANK — what you have to build with.
    let x = 28;
    g.font = font(700, 30);
    const items: ItemId[] = ['gear', 'cell', 'chip', 'pump', 'lamp', 'servo'];
    for (const item of items) {
      const n = bank[item] ?? 0;
      if (n <= 0 && item !== 'gear') continue;
      g.fillStyle = `#${AMMO_COLOR[item].toString(16).padStart(6, '0')}`;
      g.beginPath();
      g.arc(x + 10, 186, 9, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fdf6ec';
      const label = `${item.toUpperCase()} ${n}`;
      g.fillText(label, x + 26, 197);
      x += 40 + g.measureText(label).width;
    }
    this.plateTex.needsUpdate = true;
  }
}

const _tmpWhite = new Color(0xffffff);
const _tmpIce = new Color(0xa8eeff);
void SIEGE;
