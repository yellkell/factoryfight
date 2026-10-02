/**
 * SiegeSystem — the fight, drawn and voiced.
 *
 * The sim (factory/siege.ts) decides everything; this system owns only
 * what it looks and sounds like, the TUBES split exactly:
 *
 *   THE SWARM      every crawler in one draw call (systems/swarm.ts):
 *                  thousands of neon mites whose legs walk on the sim's
 *                  own stride counter, on the GPU. When they die they
 *                  come apart — shards that bounce, splats that glow on
 *                  the floor, and a pop for every handful.
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
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  type Texture,
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
  PlaneGeometry,
  Points,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { ENEMIES, HORDE_KINDS, LINES, SIEGE, WEAPONS, type EnemyId, type ItemId, type WeaponId } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { buzz } from '../game/haptics.js';
import { intents } from '../input/intents.js';
import { site } from '../game/state.js';
import { siegeFallen } from '../game/flow.js';
import { CELL, cellCenter } from '../floor/grid.js';
import { ensurePlantRoot, toPlant } from '../factory/frame.js';
import { NEON } from '../factory/neon.js';
import { buildGate, type GateRefs } from '../factory/crystal.js';
import {
  bindRoom,
  grabEnemy,
  holdEnemy,
  holding,
  throwEnemy,
  breachHex,
  coreHealth,
  debugFreeze,
  debugWakeAll,
  levelOf,
  rangeOf,
  debugClear,
  debugTough,
  debugBreaches,
  debugCoins,
  debugJump,
  debugFlood,
  debugPlace,
  debugSpawn,
  siegeLeft,
  simMs,
  soundHorn,
  WEAPON_ORDER,
  standCore,
  waveSpec,
} from '../factory/siege.js';
import { dockUnit, isWeapon } from '../factory/sim.js';
import { LaneStrips } from './laneStrips.js';
import { plant, type SiegeFx } from '../factory/state.js';
import { glintTexture, sizedPointsMaterial } from '../materials/glow.js';
import { font } from '../ui/fonts.js';
import { liveUnitRefs } from './FactorySystem.js';
import { Shards, Splats, SwarmMesh } from './swarm.js';
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
    /** How many lanes are open, and every lane: its length and cells. */
    open: number;
    lanes: Array<{ len: number; cells: Array<{ i: number; j: number }>; pts: number[] }>;
    coins: number;
  };
  horn?: () => void;
  /** TOOLS ONLY: stand the core in the middle of the floor. */
  core?: () => void;
  spawn?: (kind: EnemyId, breach?: number, count?: number) => void;
  /** THE THROW, headless: a fist closing at a plant point, carrying,
   *  and opening with a velocity (plant m, m/s). */
  grab?: (hand: 0 | 1, x: number, y: number, z: number) => boolean;
  hold?: (hand: 0 | 1, x: number, y: number, z: number) => boolean;
  throw?: (hand: 0 | 1, vx: number, vy: number, vz: number) => boolean;
  /** Every live crawler, for a walk to look at. */
  crawlers?: () => Array<{ uid: number; kind: number; x: number; y: number; z: number; phase: number; hp: number }>;
  /** TOOLS ONLY: a whole tide at once, already out of the walls. */
  flood?: (kind: EnemyId, count: number) => void;
  /** TOOLS ONLY: crack n breaches right now. */
  breaches?: (n: number) => void;
  /** TOOLS ONLY: jump the ladder to wave n's build phase. */
  jump?: (n: number) => void;
  /** TOOLS ONLY: how long the last frames took (ms) — sim and draw. */
  perf?: () => { sim: number; draw: number; alive: number; shards: number };
  /** TOOLS ONLY: stand a crawler at plant (x, z), and freeze the fight. */
  place?: (kind: EnemyId, x: number, z: number, heading?: number) => void;
  freeze?: (on: boolean) => void;
  /** Every feed awake and every weapon on offer (tools). */
  wakeAll?: () => void;
  /** Every crawler, round and fire off the floor; the clock held (tools). */
  clear?: () => void;
  /** Every crawler on the floor ×m as hard to kill (tools). */
  tough?: (m: number) => void;
  enemies?: () => Array<{ id: number; kind: string; x: number; z: number; hp: number; phase: string }>;
  /** Every weapon: what it is, seconds since it last fired, its aim, and
   *  whether it is plumbed (the fuel-burners). */
  turrets?: () => Array<{ id: number; type: string; fired: number; yaw: number; fuelled: boolean; level: number }>;
  /** TOOLS ONLY: coins into the purse. */
  coins?: (n: number) => void;
} = {};

/** What each round glows. Base parts wear their line; deep parts wear
 *  the mix they are made of. */
export const ITEM_COLOR: Record<ItemId, number> = {
  gear: LINES.mains.glow,
  cell: LINES.coolant.glow,
  chip: LINES.volt.glow,
  pump: 0xffd27a,
  lamp: 0xe4f6ff,
  servo: 0xffffff,
};

/* ── THE CRAWLERS: one kit per kind ─────────────────────────────────────── */

const _m = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _s = new Vector3();
const _col = new Color();
const _cam = new Vector3();
const _c = { x: 0, z: 0 };
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const _hand = new Vector3();

let _sphere: SphereGeometry | null = null;
const sphereGeo = (): SphereGeometry => (_sphere ??= new SphereGeometry(1, 14, 10));

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

/* ── THE BREACH ─────────────────────────────────────────────────────────── */

/** A gate's moving parts (factory/crystal.ts builds it). */
type BreachHw = GateRefs;

/* ── particles ──────────────────────────────────────────────────────────── */

const MAX_P = 900;

let _softTex: Texture | null = null;
/** A soft round blob — fire and smoke, where a glint would read as a star. */
function softTexture(): Texture {
  if (_softTex) return _softTex;
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, size, size);
  _softTex = new CanvasTexture(c);
  return _softTex;
}

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

  constructor(map: Texture = glintTexture()) {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage));
    geo.setAttribute('color', new BufferAttribute(this.col, 3).setUsage(DynamicDrawUsage));
    geo.setAttribute('aSize', new BufferAttribute(this.size, 1).setUsage(DynamicDrawUsage));
    const mat = sizedPointsMaterial({
      size: 0.05,
      map,
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

  /** A directed jet (the flame): along (dx, dz) with `spread`, drifting
   *  UP as it goes (negative gravity), each particle a colour from `cols`. */
  jet(
    x: number,
    y: number,
    z: number,
    dx: number,
    dz: number,
    n: number,
    speed: number,
    spread: number,
    cols: number[],
    life: number,
    size: number,
  ): void {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX_P;
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      const a = Math.atan2(dx, dz) + (Math.random() - 0.5) * 2 * spread;
      const sp = speed * (0.6 + Math.random() * 0.5);
      this.vel[i * 3] = Math.sin(a) * sp;
      this.vel[i * 3 + 1] = (Math.random() - 0.3) * sp * 0.25;
      this.vel[i * 3 + 2] = Math.cos(a) * sp;
      _col.set(cols[Math.floor(Math.random() * cols.length)]);
      this.base[i * 3] = _col.r;
      this.base[i * 3 + 1] = _col.g;
      this.base[i * 3 + 2] = _col.b;
      this.life[i] = this.maxLife[i] = life * (0.7 + Math.random() * 0.5);
      this.grav[i] = -1.2;
      this.size[i] = size * (0.7 + Math.random() * 0.9);
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

/**
 * THE HAMMER's arm angle (about X; 0 level, + down) `f` seconds after
 * it began a swing: heave up, slam down (it lands at the sim's
 * HAMMER_SWING), a little rebound, then lift back to rest.
 */
const H_REST = -0.55;
const H_UP = -1.3;
const H_HIT = 0.56;
function hammerAngle(f: number, t: number): number {
  if (f < 0.13) {
    const k = f / 0.13;
    return H_REST + (H_UP - H_REST) * (1 - (1 - k) * (1 - k));
  }
  if (f < 0.22) {
    const k = (f - 0.13) / 0.09;
    return H_UP + (H_HIT - H_UP) * k * k;
  }
  if (f < 0.42) return H_HIT - 0.07 * Math.sin(((f - 0.22) / 0.2) * Math.PI);
  if (f < 0.95) {
    const k = (f - 0.42) / 0.53;
    return H_HIT + (H_REST - H_HIT) * k * k * (3 - 2 * k);
  }
  return H_REST + 0.03 * Math.sin(t * 1.4);
}

export class SiegeSystem extends createSystem({}) {
  private root!: Group;
  private swarm!: SwarmMesh;
  private laneStrips!: LaneStrips;
  /** Level rings round upgraded towers, and the reach of the one whose
   *  panel is open. */
  private levelRings!: InstancedMesh;
  private reach!: Mesh;
  private reachMat!: MeshBasicMaterial;
  private shards!: Shards;
  private splats!: Splats;
  /** Smoothed milliseconds spent drawing the swarm (tools read it). */
  private drawMs = 0;
  private shotsMesh!: InstancedMesh;
  private bars!: InstancedMesh;
  private barBacks!: InstancedMesh;
  private sparks!: Sparks;
  private flames!: Sparks;
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
  private clearing!: Mesh;
  private clearingMat!: MeshBasicMaterial;
  private coreHit = 0;
  private coreSpin = 0;
  /** Each hand's recent path (plant m, with the clock), for the throw. */
  private fistTrail: Array<Array<[number, number, number, number]>> = [[], []];
  /** Whether each fist took what it holds (a walk's headless grab is
   *  left to the walk). */
  private fistOwns = [false, false];
  private plate!: Mesh;
  private plateCtx!: CanvasRenderingContext2D;
  private plateTex!: CanvasTexture;
  private plateKey = '';
  private platePainted = -1;
  private lastPhase = '';
  private fireClock = 0;
  /** Seconds since the core went — the fall plays before the card. */
  private fallenT = 0;

  init(): void {
    this.root = new Group();
    this.root.name = 'siege';
    ensurePlantRoot(this.scene).add(this.root);
    bindRoom(walls);

    this.laneStrips = new LaneStrips(this.root);
    {
      const ringGeo = new RingGeometry(0.9, 1, 48);
      ringGeo.rotateX(-Math.PI / 2);
      this.levelRings = new InstancedMesh(
        ringGeo,
        new MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false }),
        96,
      );
      this.levelRings.instanceMatrix.setUsage(DynamicDrawUsage);
      for (let k = 0; k < 96; k++) this.levelRings.setColorAt(k, _col.set(0xffffff));
      this.levelRings.count = 0;
      this.levelRings.frustumCulled = false;
      this.levelRings.renderOrder = 4;
      this.root.add(this.levelRings);
      const reachGeo = new RingGeometry(0.985, 1, 96);
      reachGeo.rotateX(-Math.PI / 2);
      this.reachMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.5 });
      this.reach = new Mesh(reachGeo, this.reachMat);
      this.reach.visible = false;
      this.reach.renderOrder = 4;
      this.root.add(this.reach);
    }
    this.swarm = new SwarmMesh(this.root);
    this.shards = new Shards(this.root);
    this.splats = new Splats(this.root);

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
    // FIRE is soft: round blobs that bloom into each other, not glints.
    this.flames = new Sparks(softTexture());
    this.root.add(this.flames.points);

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
    // Beams double as the coil's BOLTS: every kink of an arc is one, so
    // the pool is deep.
    for (let k = 0; k < 90; k++) {
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

    // THE CLEARING round the core, where nothing may be built: a faint
    // square on the floor (a four-sided ring turned to sit square).
    const half = (SIEGE.coreClear + 0.5) * CELL;
    this.clearingMat = glow(0xffcf3a);
    this.clearingMat.side = DoubleSide;
    this.clearing = new Mesh(new RingGeometry(half * Math.SQRT2 - 0.012 * Math.SQRT2, half * Math.SQRT2, 4, 1, Math.PI / 4), this.clearingMat);
    this.clearing.rotation.x = -Math.PI / 2;
    this.clearing.visible = false;
    this.root.add(this.clearing);

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
        queued: siegeLeft() - sg.horde.n,
        enemies: sg.horde.n,
        kills: sg.kills,
        core: coreHealth(),
        won: sg.won,
        breaches: sg.breaches.map((b) => ({ x: b.x, z: b.z })),
        open: sg.open,
        lanes: sg.lanes.map((l) => ({ len: l.len, cells: l.cells.map((c) => ({ ...c })), pts: [...l.pts] })),
        coins: sg.coins,
      };
    };
    siegeView.horn = () => soundHorn();
    siegeView.core = () => standCore();
    siegeView.spawn = (kind, breach = 0, count = 1) => debugSpawn(kind, breach, count);
    siegeView.grab = (hand, x, y, z) => grabEnemy(hand, x, y, z);
    siegeView.hold = (hand, x, y, z) => holdEnemy(hand, x, y, z);
    siegeView.throw = (hand, vx, vy, vz) => throwEnemy(hand, vx, vy, vz);
    siegeView.crawlers = () => {
      const h = plant.siege.horde;
      const out = [];
      for (let i = 0; i < h.n; i++) {
        if (h.dead[i]) continue;
        out.push({ uid: h.uid[i], kind: h.kind[i], x: h.x[i], y: h.y[i], z: h.z[i], phase: h.phase[i], hp: h.hp[i] });
      }
      return out;
    };
    siegeView.flood = (kind, count) => debugFlood(kind, count);
    siegeView.breaches = (n) => debugBreaches(n);
    siegeView.jump = (n) => debugJump(n);
    siegeView.coins = (n) => debugCoins(n);
    siegeView.perf = () => ({ sim: simMs(), draw: this.drawMs, alive: plant.siege.horde.n, shards: this.shards.live });
    siegeView.place = (kind, x, z, heading = 0) => debugPlace(kind, x, z, heading);
    siegeView.freeze = (on) => debugFreeze(on);
    siegeView.wakeAll = () => debugWakeAll();
    siegeView.clear = () => debugClear();
    siegeView.tough = (m) => debugTough(m);
    siegeView.enemies = () => {
      const h = plant.siege.horde;
      const out = [];
      for (let i = 0; i < h.n; i++) {
        if (h.dead[i]) continue;
        out.push({
          id: h.uid[i],
          kind: HORDE_KINDS[h.kind[i]],
          x: h.x[i],
          z: h.z[i],
          hp: h.hp[i],
          phase: ['emerge', 'walk', 'bite'][h.phase[i]],
        });
      }
      return out;
    };
    siegeView.turrets = () =>
      plant.units
        .filter((u) => isWeapon(u.type))
        .map((u) => ({
          id: u.id,
          type: u.type,
          fired: u.firedT ?? 99,
          yaw: u.yaw ?? 0,
          fuelled: true,
          level: u.level ?? 1,
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

    this.tickFists(delta);
    this.drainFx();
    this.laneStrips.sync(sg.lanes, sg.open, this.clock, SIEGE.laneWidth * 0.65, breachHex());
    this.syncBreaches(false);
    this.tickBreaches(delta);
    const t0 = performance.now();
    this.drawEnemies();
    this.drainDeaths();
    this.shards.tick(dt);
    this.splats.tick(dt);
    this.drawMs = this.drawMs * 0.9 + (performance.now() - t0) * 0.1;
    this.drawShots();
    this.drawFire(dt);
    this.drawBars();
    this.tickGuns(delta);
    this.tickLevels();
    this.tickFlares(dt);
    this.sparks.tick(dt);
    this.flames.tick(dt);
    this.tickCore(delta);
  }

  /* ── fx ─────────────────────────────────────────────────────────────── */

  private drainFx(): void {
    const list = plant.siege.fx.splice(0);
    for (const f of list) this.perform(f);
  }

  private perform(f: SiegeFx): void {
    const color = f.weapon ? WEAPONS[f.weapon].color : 0xffa22e;
    switch (f.kind) {
      case 'fire': {
        if (f.unit !== undefined) this.recoil.set(f.unit, 1);
        if (f.weapon === 'turret') {
          this.sparks.burst(f.x, f.y, f.z, 5, color, 0.9, 0.16, 0, 0.7);
          // A brass casing kicked out the side, pinging off the floor.
          const side = (f.yaw ?? 0) + Math.PI / 2;
          this.sparks.jet(f.x, f.y - 0.05, f.z, Math.sin(side), Math.cos(side), 1, 0.9, 0.4, [0xd8b04a], 0.7, 0.9);
          sfx.gunFire('slug');
        } else if (f.weapon === 'mortar') {
          this.sparks.burst(f.x, f.y + 0.1, f.z, 18, 0xfff0c0, 1.4, 0.35, -0.5, 1.2);
          this.ring(f.x, f.z, color, 0.35, 0.4);
          sfx.gunFire('hammer');
          buzz(this.world, 'both', 0.2, 40);
        } else if (f.weapon === 'tesla') {
          sfx.gunFire('arc');
        }
        break;
      }
      case 'flame': {
        // THE CONE: a jet of fire along the nozzle, white-yellow at the
        // lip and red by the end of its reach.
        const yaw = f.yaw ?? 0;
        const reach = f.reach ?? 1;
        // A hot core to the jet, so it reads as one tongue, not confetti.
        const lip = reach * 0.55;
        this.beam([f.x, f.y, f.z, f.x + Math.sin(yaw) * lip, f.y + 0.02, f.z + Math.cos(yaw) * lip], 0xffa040);
        this.flames.jet(f.x, f.y, f.z, Math.sin(yaw), Math.cos(yaw), 10, reach * 2.4, 0.3, [0xfff2b0, 0xffb347, 0xff7a1a, 0xff4d1a, 0xe02a10], 0.45, 3.2);
        if (f.unit !== undefined) this.recoil.set(f.unit, 1);
        sfx.flameRoar();
        break;
      }
      case 'punch': {
        // THE HAMMER lands: a hard white flash, two shock rings out
        // across the floor, crystal grit thrown up all round.
        const r = f.radius ?? 0.22;
        this.ring(f.x, f.z, 0xffffff, r * 1.1, 0.25);
        this.ring(f.x, f.z, color, r * 1.9, 0.5);
        this.flash(f.x, 0.05, f.z, 0xffffff, r * 0.7, 0.14);
        this.sparks.burst(f.x, 0.04, f.z, 26, color, 2.0, 0.45, 5, 1.1);
        this.sparks.burst(f.x, 0.04, f.z, 10, 0xffffff, 1.4, 0.3, 3, 0.8);
        sfx.hammerSlam();
        buzz(this.world, 'both', 0.25, 50);
        break;
      }
      case 'grab':
        // A fist closes on one: a pinch of its neon squeezed out.
        this.sparks.burst(f.x, f.y, f.z, 6, breachHex(), 0.6, 0.2, 0, 0.5);
        sfx.grabLatch();
        break;
      case 'slam': {
        // A thrown one hits the floor.
        const r = f.radius ?? 0.12;
        this.ring(f.x, f.z, breachHex(), r * 1.6, 0.3);
        this.sparks.burst(f.x, 0.03, f.z, 14, 0xffffff, 1.3, 0.3, 3, 0.8);
        sfx.scrapCrunch(r > 0.15);
        break;
      }
      case 'shell': {
        // A MORTAR SHELL lands: fireball, ground shockwave, debris.
        const r = f.radius ?? 0.6;
        this.ring(f.x, f.z, 0xffd36a, r * 1.4, 0.6);
        this.ring(f.x, f.z, 0xff7a1a, r * 0.8, 0.45);
        this.flash(f.x, 0.12, f.z, 0xffc070, r * 0.75, 0.35);
        this.sparks.burst(f.x, 0.1, f.z, 60, 0xffa040, 2.4, 0.7, 4, 1.4);
        this.sparks.burst(f.x, 0.1, f.z, 20, 0x6b5a4a, 1.6, 1.1, 6, 1.6);
        this.flames.jet(f.x, 0.05, f.z, 0, 0, 16, 0.5, Math.PI, [0xff7a1a, 0xffb347, 0xfff2b0], 0.9, 4);
        sfx.mortarBoom();
        buzz(this.world, 'both', 0.35, 70);
        break;
      }
      case 'hit':
        this.sparks.burst(f.x, f.y, f.z, 7, color, 1.2, 0.3, 4, 0.8);
        break;
      case 'blast': {
        // A sapper's charge, or plant chewed to scrap.
        const r = f.radius ?? 0.3;
        this.ring(f.x, f.z, 0xff5a1e, r, 0.45);
        this.flash(f.x, f.y + 0.05, f.z, 0xffb060, r * 0.7, 0.28);
        this.sparks.burst(f.x, f.y + 0.05, f.z, 30, 0xff7a2a, 1.7, 0.6, 4, 1.3);
        sfx.shellBurst(r > 0.4);
        if (f.unit === undefined) buzz(this.world, 'both', 0.35, 60);
        break;
      }
      case 'arc':
        if (f.path) {
          this.arc(f.path);
          // Arcs are doubled: a second, jaggier bolt along the same hops.
          this.arc(f.path);
        }
        for (let k = 3; k + 2 < (f.path?.length ?? 0); k += 3) {
          const p = f.path!;
          this.sparks.burst(p[k], p[k + 1], p[k + 2], 8, LINES.volt.glow, 1.4, 0.3, 3, 1);
        }
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
      case 'upgrade': {
        // A level bought: a ring rises off the floor round it, sparks fly.
        const hex = f.weapon ? WEAPONS[f.weapon].color : 0xffffff;
        this.ring(f.x, f.z, hex, 0.42, 0.55);
        this.ring(f.x, f.z, 0xffffff, 0.26, 0.4);
        this.sparks.burst(f.x, 0.5, f.z, 40, hex, 1.6, 0.6, 2, 1.3);
        sfx.stampDone();
        sfx.ceremonyChord();
        break;
      }
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

  private beam(path: number[], color: number, life = 0.22, width = 0.035): void {
    const f = this.take(this.beams);
    const [x0, y0, z0, x1, y1, z1] = path;
    _v.set(x1 - x0, y1 - y0, z1 - z0);
    const len = _v.length();
    f.mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    f.mesh.quaternion.setFromUnitVectors(Z, _v.normalize());
    f.mesh.scale.set(width, width, len);
    f.mat.color.set(color);
    f.t = 0;
    f.life = life;
    f.start = width;
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
        const j = s === 5 ? 0 : 0.09;
        const qx = ax + (bx - ax) * t + (Math.random() - 0.5) * j;
        const qy = ay + (by - ay) * t + (Math.random() - 0.5) * j;
        const qz = az + (bz - az) * t + (Math.random() - 0.5) * j;
        arr.set([px, py, pz, qx, qy, qz], n * 3);
        n += 2;
        // A line is a hair in a headset: each kink is a lit rod too.
        this.beam([px, py, pz, qx, qy, qz], 0xe6d4ff, 0.24, 0.011);
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
    this.swarm.update(plant.siege.horde, this.clock);
  }

  /**
   * THE AFTERMATH. Every death the sim logged since last frame comes
   * apart here: shards out of it, a splat where it stood, sparks for the
   * big ones — and ONE sound for the lot, sized by how many went.
   */
  private drainDeaths(): void {
    const h = plant.siege.horde;
    const n = h.deathN;
    h.deathN = 0;
    if (n === 0) return;
    // In a flood the per-death budget shrinks, so a mortar into a carpet
    // of three hundred is still one frame.
    const thin = n > 60 ? 0.35 : n > 20 ? 0.6 : 1;
    let mites = 0;
    let big = 0;
    for (let k = 0; k < n; k++) {
      const o = k * 4;
      const x = h.deaths[o];
      const z = h.deaths[o + 1];
      const kind = HORDE_KINDS[h.deaths[o + 2]];
      const cause = WEAPON_ORDER[h.deaths[o + 3]] as WeaponId | undefined;
      const spec = ENEMIES[kind];
      const r = spec.radius;
      const neon = spec.neon;
      // Fire leaves them charred: shards come out ember-orange.
      const hue = cause === 'flamer' ? (Math.random() < 0.5 ? 0xff7a1a : neon) : cause === 'tesla' ? (Math.random() < 0.4 ? 0xe6d4ff : neon) : neon;
      if (kind === 'mite') {
        mites++;
        this.shards.burst(x, r * 0.7, z, Math.max(2, Math.round(5 * thin)), hue, r * 0.32, 0.9, 1.4);
        this.splats.add(x, z, r * 3.2, neon);
      } else if (kind === 'beetle') {
        big++;
        this.shards.burst(x, r * 0.7, z, Math.max(4, Math.round(12 * thin)), hue, r * 0.3, 1.1, 1.7);
        this.splats.add(x, z, r * 3.4, neon);
        this.sparks.burst(x, r, z, 10, neon, 1.2, 0.4, 4, 1);
      } else {
        big += 4;
        this.shards.burst(x, r * 0.8, z, 48, hue, r * 0.22, 1.6, 2.4);
        this.shards.burst(x, r * 0.8, z, 16, 0x2a2430, r * 0.3, 1.2, 2);
        this.splats.add(x, z, r * 3.6, neon);
        this.ring(x, z, neon, r * 4, 0.6);
        this.flash(x, r, z, 0xffd0a0, r * 1.4, 0.3);
        this.sparks.burst(x, r, z, 60, neon, 2.2, 0.7, 4, 1.5);
        sfx.scrapCrunch(true);
        buzz(this.world, 'both', 0.4, 90);
      }
    }
    sfx.swarmPop(mites + big);
    if (n >= 10 || big >= 4) sfx.swarmCrunch(n);
  }

  private drawShots(): void {
    let n = 0;
    for (const s of plant.siege.shots) {
      if (n >= 240) break;
      const p = Math.min(1, s.t / s.dur);
      const shell = s.weapon === 'mortar';
      const x = s.x0 + (s.x1 - s.x0) * p;
      const z = s.z0 + (s.z1 - s.z0) * p;
      const dist = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
      // Slugs fly flat and stretched; a mortar shell goes HIGH and drops.
      const lob = shell ? dist * 0.7 + 0.7 : 0;
      const y = s.y0 + (s.y1 - s.y0) * p + Math.sin(p * Math.PI) * lob;
      _v.set(s.x1 - s.x0, s.y1 - s.y0 + Math.cos(p * Math.PI) * lob * Math.PI, s.z1 - s.z0).normalize();
      _q.setFromUnitVectors(Z, _v);
      const r = shell ? 0.04 : 0.016;
      const len = shell ? 1.6 : 12;
      trs(_m, x, y, z, _q, r, r, r * len);
      this.shotsMesh.setMatrixAt(n, _m);
      this.shotsMesh.setColorAt(n, _col.set(WEAPONS[s.weapon].color));
      n++;
      // A shell trails fire and smoke all the way up and down.
      if (shell) {
        this.sparks.burst(x, y, z, 2, Math.random() < 0.5 ? 0xffb347 : 0x5a4a3a, 0.08, 0.5, -0.3, 1.1);
      }
    }
    this.shotsMesh.count = n;
    this.shotsMesh.visible = n > 0;
    this.shotsMesh.instanceMatrix.needsUpdate = true;
    if (this.shotsMesh.instanceColor) this.shotsMesh.instanceColor.needsUpdate = true;
  }

  /** BURNING: crawlers on fire smoke and flicker as they come, and the
   *  floor where a flame landed burns for a few seconds. */
  private drawFire(dt: number): void {
    this.fireClock += dt;
    if (this.fireClock < 0.05) return;
    this.fireClock = 0;
    const cols = [0xffb347, 0xff7a1a, 0xff4d1a];
    // Everything on fire smokes and flickers as it comes — up to a
    // budget a tick, so a burning carpet costs the same as a burning row.
    const h = plant.siege.horde;
    const radii = HORDE_KINDS.map((k) => ENEMIES[k].radius);
    let burning = 0;
    for (let i = 0; i < h.n; i++) if (h.burnT[i] > 0 && !h.dead[i]) burning++;
    const every = Math.max(1, Math.ceil(burning / 40));
    let seen = 0;
    for (let i = 0; i < h.n; i++) {
      if (h.burnT[i] <= 0 || h.dead[i]) continue;
      if (seen++ % every !== 0) continue;
      const r = radii[h.kind[i]];
      this.flames.jet(h.x[i] + (Math.random() - 0.5) * r, r * 1.2, h.z[i] + (Math.random() - 0.5) * r, 0, 0, 1, 0.15, Math.PI, cols, 0.4, 1.4 + r * 6);
    }
    for (const f of plant.siege.fires) {
      const fade = Math.min(1, (f.life - f.t) / 0.8);
      const n = Math.round(4 * fade);
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * f.r;
        this.flames.jet(f.x + Math.sin(a) * d, 0.02, f.z + Math.cos(a) * d, 0, 0, 1, 0.1, Math.PI, cols, 0.55, 3);
      }
    }
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
    // Only the big ones carry a bar: a mite is one hit, and a bar over
    // each of three thousand would be a second carpet.
    const h = plant.siege.horde;
    for (let i = 0; i < h.n; i++) {
      if (h.kind[i] === 0 || h.dead[i] || h.hp[i] >= h.maxHp[i]) continue;
      const r = ENEMIES[HORDE_KINDS[h.kind[i]]].radius;
      put(h.x[i], r * 2.2 + 0.06, h.z[i], Math.max(0, h.hp[i] / h.maxHp[i]), Math.max(0.12, r * 1.6), 0xff5a3a);
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

  /* ── tower levels ───────────────────────────────────────────────────── */

  private tickLevels(): void {
    let n = 0;
    for (const u of plant.units) {
      if (!isWeapon(u.type)) continue;
      const level = levelOf(u);
      const refs = liveUnitRefs.get(u.id);
      // A levelled tower stands a little bigger…
      if (refs) refs.group.scale.setScalar(1 + (level - 1) * 0.09);
      if (level < 2) continue;
      // …and wears a neon ring on the floor per level above the first.
      cellCenter(u.i, u.j, _c);
      const hex = WEAPONS[u.type as WeaponId].color;
      for (let k = 0; k < level - 1 && n < 96; k++) {
        const r = 0.2 + k * 0.035;
        trs(_m, _c.x, 0.008 + k * 0.001, _c.z, _q.identity(), r, 1, r);
        this.levelRings.setMatrixAt(n, _m);
        this.levelRings.setColorAt(n, _col.set(hex));
        n++;
      }
    }
    this.levelRings.count = n;
    this.levelRings.visible = n > 0;
    this.levelRings.instanceMatrix.needsUpdate = true;
    if (this.levelRings.instanceColor) this.levelRings.instanceColor.needsUpdate = true;
    // THE REACH of the tower whose panel is open: a circle on the floor.
    const u = site.inspect >= 0 ? plant.units.find((x) => x.id === site.inspect) : undefined;
    if (u && isWeapon(u.type)) {
      cellCenter(u.i, u.j, _c);
      const r = rangeOf(u);
      this.reach.position.set(_c.x, 0.01, _c.z);
      this.reach.scale.set(r, 1, r);
      this.reachMat.color.set(NEON[u.type]);
      this.reachMat.opacity = 0.45 + 0.15 * Math.sin(this.clock * 4);
      this.reach.visible = true;
    } else {
      this.reach.visible = false;
    }
  }

  /* ── the guns ───────────────────────────────────────────────────────── */

  private tickGuns(delta: number): void {
    for (const u of plant.units) {
      const refs = liveUnitRefs.get(u.id);
      const gun = refs?.gun;
      if (!refs || !gun) continue;
      // The head slews in WORLD yaw; the unit's group is already turned.
      if (gun.head) gun.head.rotation.y = (u.yaw ?? 0) - refs.group.rotation.y;
      let r = this.recoil.get(u.id) ?? 0;
      if (r > 0) {
        r = Math.max(0, r - delta * 7);
        this.recoil.set(u.id, r);
      }
      if (gun.barrel) {
        // A gun KICKS back down its bore and eases home.
        const base = gun.barrel.userData.rest ?? (gun.barrel.userData.rest = gun.barrel.position.z);
        gun.barrel.position.z = base - r * r * gun.kick;
      }
      if (gun.swing) gun.swing.rotation.x = hammerAngle(u.firedT ?? 99, this.clock + u.id);
      if (gun.bob) {
        for (const o of gun.bob) {
          const y0 = o.userData.restY ?? (o.userData.restY = o.position.y);
          o.position.y = y0 + 0.012 * Math.sin(this.clock * 1.7 + u.id * 1.3);
        }
      }
      if (gun.spin) for (const o of gun.spin) o.rotation.y = this.clock * 0.9 + u.id;
      if (gun.flash && gun.flashMesh) {
        gun.flash.opacity = r > 0.5 ? (r - 0.5) / 0.5 : 0;
        if (u.type === 'tesla') gun.flashMesh.scale.setScalar(0.08 + r * 0.12);
        else gun.flashMesh.scale.set(0.05 + r * 0.04, 0.1 + r * 0.14, 0.05 + r * 0.04);
      }
      if (gun.jet) {
        // The tongue pours while the flamer is firing (it fires ten times
        // a second, so this is continuous), licking in and out.
        const on = (u.firedT ?? 99) < 0.16;
        const reach = WEAPONS.flamer.range * 0.92;
        const spread = Math.tan(WEAPONS.flamer.cone ?? 0.5) * 0.55;
        gun.jet.forEach((m, k) => {
          m.visible = on;
          if (!on) return;
          const lick = 0.82 + 0.18 * Math.sin(this.clock * (37 + k * 11) + k) + Math.random() * 0.08;
          const len = reach * lick * (1 - k * 0.24);
          const rad = len * spread * (1 - k * 0.22);
          m.scale.set(rad * (0.9 + Math.random() * 0.2), rad * (0.9 + Math.random() * 0.2), len);
          const mat = m.material as MeshBasicMaterial;
          mat.opacity = (m.userData.opacity as number) * (0.8 + Math.random() * 0.3);
        });
      }
      if (gun.pilot) {
        // The pilot is lit while the weapon can fire: plumbed (for the
        // fuel-burners) and on a live siege. The coil's crown crackles.
        const live = u.type === 'flamer' || u.type === 'tesla' ? true : true;
        const flicker =
          u.type === 'tesla' ? 0.6 + 0.4 * Math.random() : u.type === 'flamer' ? 0.75 + 0.25 * Math.sin(this.clock * 31) : 1;
        gun.pilot.opacity = live ? flicker : 0.08;
      }
    }
  }

  /* ── the fists ──────────────────────────────────────────────────────
   * Close a fist (or squeeze the grip) on a mite or a beetle and it is
   * yours; open it and the thing flies with your hand's speed — taken
   * over the last few frames, so a flick of the wrist counts.
   */
  private tickFists(delta: number): void {
    const grips = this.world.playerSpaceEntities?.gripSpaces;
    (['left', 'right'] as const).forEach((side, k) => {
      const hand = k as 0 | 1;
      const obj = grips?.[side]?.object3D;
      const trail = this.fistTrail[k];
      if (!obj || site.paused) {
        trail.length = 0;
        // A hand the headset lost lets go of what it held: it drops.
        if (this.fistOwns[k] && holding(hand)) throwEnemy(hand, 0, 0, 0);
        this.fistOwns[k] = false;
        return;
      }
      toPlant(obj.getWorldPosition(_hand));
      trail.push([this.clock, _hand.x, _hand.y, _hand.z]);
      while (trail.length > 2 && this.clock - trail[0][0] > 0.1) trail.shift();
      const grab = intents[side].grab;
      if (grab.down && grabEnemy(hand, _hand.x, _hand.y, _hand.z)) {
        this.fistOwns[k] = true;
        buzz(this.world, side, 0.45, 35);
      } else if (this.fistOwns[k] && !holding(hand)) {
        this.fistOwns[k] = false; // it died in your hand
      } else if (this.fistOwns[k]) {
        if (grab.pressed) {
          holdEnemy(hand, _hand.x, _hand.y, _hand.z);
        } else {
          // Opened: throw with the hand's velocity over the trail.
          const a = trail[0];
          const span = Math.max(1 / 90, this.clock - a[0]);
          const boost = 1.25;
          throwEnemy(
            hand,
            ((_hand.x - a[1]) / span) * boost,
            ((_hand.y - a[2]) / span) * boost,
            ((_hand.z - a[3]) / span) * boost,
          );
          this.fistOwns[k] = false;
          buzz(this.world, side, 0.25, 20);
        }
      }
    });
    void delta;
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
      const gate = buildGate(breachHex());
      gate.group.position.set(b.x + b.nx * 0.004, 0, b.z + b.nz * 0.004);
      gate.group.rotation.y = Math.atan2(b.nx, b.nz);
      this.root.add(gate.group);
      this.breachHw.push(gate);
    }
  }

  private tickBreaches(delta: number): void {
    const sg = plant.siege;
    this.breachFlare = Math.max(0, this.breachFlare - delta * 0.8);
    const fighting = sg.phase === 'wave';
    const hex = breachHex();
    this.breachHw.forEach((g, k) => {
      const u = g.voidMat.uniforms;
      u.uTime.value = this.clock;
      // SEALED (a later wave's): a dim frame, no void, nothing turning.
      if (k >= sg.open) {
        g.voidMesh.visible = false;
        g.tube.color.setHex(hex).multiplyScalar(0.25);
        g.halo.opacity = 0.05;
        g.glass.emissiveIntensity = 0.05;
        g.pool.opacity = 0.02;
        return;
      }
      // Build phase: the void gathers, slow, breathing — a warning.
      // Wave: it pours — fast, hot, flaring as each one comes through.
      const breathe = 0.5 + 0.5 * Math.sin(this.clock * (fighting ? 9 : 2.4));
      const want = fighting ? 1 : 0.35;
      u.uOpen.value += (Math.min(1.4, want + this.breachFlare * 0.4) - u.uOpen.value) * Math.min(1, delta * 3);
      g.voidMesh.visible = true;
      const lit = Math.min(1, (fighting ? 0.8 : 0.5) + breathe * 0.2 + this.breachFlare * 0.4);
      g.tube.color.setHex(hex).multiplyScalar(lit);
      g.halo.opacity = 0.12 + 0.2 * lit;
      g.glass.emissiveIntensity = 0.12 + 0.25 * lit;
      g.pool.opacity = (fighting ? 0.3 : 0.1) + breathe * 0.08 + this.breachFlare * 0.2;
      const spin = (fighting ? 1.6 : 0.4) * delta;
      g.rings[0].rotation.z += spin;
      g.rings[1].rotation.z -= spin * 1.4;
    });
  }

  /* ── the core ───────────────────────────────────────────────────────── */

  private tickCore(delta: number): void {
    const core = dockUnit();
    if (!core) {
      this.clearing.visible = false;
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
    this.clearing.position.set(_c.x, 0.006, _c.z);
    this.clearing.visible = true;
    this.clearingMat.opacity = plant.siege.phase === 'build' ? 0.3 + 0.1 * Math.sin(this.clock * 2) : 0.1;
    const crys = liveUnitRefs.get(core.id)?.core;
    if (crys) {
      // THE CRYSTAL: it turns slower, sinks lower and burns dimmer the
      // more the tide has got into it; its cracks open in three stages.
      this.coreSpin += delta * (0.25 + 0.45 * frac);
      crys.spin.rotation.y = this.coreSpin;
      crys.spin.position.y = 0.5 + 0.12 * frac + 0.018 * Math.sin(this.clock * 1.3);
      crys.rings.forEach((g, k) => {
        g.rotation.y = this.coreSpin * (1.4 + k * 0.6) * (k % 2 ? -1 : 1);
        g.parent!.position.y = crys.spin.position.y;
      });
      const flicker = frac < 0.25 ? 0.55 + 0.45 * Math.random() : 1;
      crys.glass.emissiveIntensity = (0.06 + 0.3 * frac) * flicker + this.coreHit * 0.5;
      crys.heart.opacity = (0.2 + 0.7 * frac) * flicker + this.coreHit * 0.4;
      crys.ringMat.opacity = 0.3 + 0.7 * frac;
      crys.edge.color.setHex(NEON.dock).multiplyScalar((0.3 + 0.7 * frac) * flicker);
      crys.cracks.forEach((g, k) => (g.visible = frac < [0.75, 0.5, 0.25][k]));
    }
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
    const left = siegeLeft();
    const key = `${sg.phase}|${sg.wave}|${secs}|${left}|${sg.kills}|${Math.round(coreHealth() * 100)}|${sg.coins}`;
    if (key === this.plateKey) return;
    // In a tide the counts change every frame: repaint (and re-upload)
    // the plate at most four times a second.
    if (this.clock - this.platePainted < 0.25 && this.plateKey !== '') return;
    this.platePainted = this.clock;
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
    // THE PURSE — what you have to build with.
    g.fillStyle = '#ffd36a';
    g.beginPath();
    g.arc(38, 186, 11, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0b0a07';
    g.font = font(700, 14);
    g.textAlign = 'center';
    g.fillText('C', 38, 191);
    g.textAlign = 'left';
    g.fillStyle = '#fdf6ec';
    g.font = font(700, 30);
    g.fillText(`${sg.coins.toLocaleString('en-US')}`, 58, 197);
    // THE BODY COUNT, bottom right — the number a tide is measured in.
    if (sg.kills > 0) {
      g.textAlign = 'right';
      g.fillStyle = '#ff2bd6';
      g.font = font(700, 30);
      g.fillText(`${sg.kills.toLocaleString('en-US')}`, W - 28, 197);
      g.font = font(600, 16);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fillText('KILLED', W - 28, 218);
      g.textAlign = 'left';
    }
    this.plateTex.needsUpdate = true;
  }
}

const _tmpWhite = new Color(0xffffff);
