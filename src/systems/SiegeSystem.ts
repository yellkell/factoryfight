/**
 * SiegeSystem — the fight, drawn and voiced.
 *
 * The sim (factory/siege.ts) decides everything; this system owns only
 * what it looks and sounds like, the TUBES split exactly:
 *
 *   THE SWARM      every crawler in three draw calls (systems/swarm.ts):
 *                  thousands of neon mites whose legs walk on the sim's
 *                  own stride counter, on the GPU. When they die they
 *                  come apart — shards that bounce, splats that glow on
 *                  the floor, and a pop for every handful.
 *   THE CRACKS     a pack's rift: a crack splitting the floor open,
 *                  glowing as a warning when the wave starts, then
 *                  gaping as they climb up out of it.
 *   THE GUNS       slewing heads, recoiling barrels, muzzle flash, the
 *                  breech pips, the barrel band in the chambered round's
 *                  colour.
 *   THE SHOTS      tracers, lobbed shells (a halo, a trail, and a ring on
 *                  the floor where each will fall), forked bolts, beams.
 *   THE GLOWS      every shock ring, flash and rod of light, in three
 *                  instanced draw calls (systems/glows.ts) — and every
 *                  burst of anything asks THE LOAD (game/load.ts) how
 *                  much the frame can spare.
 *   THE KILLS      a pop for every death; for a shot that takes a crowd,
 *                  a pop sized by the count (multiKill); for a hulk, the
 *                  works.
 *   THE CORE       a health ring on the floor round it, and its gauge:
 *                  one slim segmented bar floating over the crystal.
 *
 * Everything lives in the plant frame (factory/frame.ts), in plant metres.
 */

import { createSystem } from '@iwsdk/core';
import {
  AdditiveBlending,
  Box3,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  type Texture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { ENEMIES, HORDE_KINDS, LINES, WEAPONS, type EnemyId, type ItemId, type WeaponId } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { buzz } from '../game/haptics.js';
import { intents } from '../input/intents.js';
import { site } from '../game/state.js';
import { siegeFallen } from '../game/flow.js';
import { cellCenter } from '../floor/grid.js';
import { PLANT_SCALE, ensurePlantRoot, toPlant } from '../factory/frame.js';
import { NEON } from '../factory/neon.js';
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
  debugRifts,
  debugCoins,
  debugJump,
  debugFlood,
  debugPlace,
  debugSpawn,
  debugSmite,
  siegeLeft,
  simMs,
  startWave,
  WEAPON_ORDER,
  standCore,
  waveSpec,
} from '../factory/siege.js';
import { dockUnit, isWeapon } from '../factory/sim.js';
import { plant, type SiegeFx, type Unit } from '../factory/state.js';
import { glintTexture, sizedPointsMaterial } from '../materials/glow.js';
import { fxN, fxQ, pinFxQ, sampleFrame } from '../game/load.js';
import { liveUnitRefs } from './FactorySystem.js';
import { FloorCrack } from './crack.js';
import { Gauge } from './gauge.js';
import { Bolts, Glows } from './glows.js';
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
    /** This wave's rifts (where its packs pour from) and their state. */
    breaches: Array<{ x: number; z: number; state: string }>;
    coins: number;
  };
  /** Start the next wave now (the build clock's early end). */
  start?: () => void;
  /** TOOLS ONLY: stand the core in the middle of the floor. */
  core?: () => void;
  /** TOOLS ONLY: crawlers climbing out now — up out of rift n, or
   *  (−1, the default) anywhere along any wall. */
  spawn?: (kind: EnemyId, rift?: number, count?: number) => void;
  /** THE THROW, headless: a fist closing at a plant point, carrying,
   *  and opening with a velocity (plant m, m/s). */
  grab?: (hand: 0 | 1, x: number, y: number, z: number) => boolean;
  hold?: (hand: 0 | 1, x: number, y: number, z: number) => boolean;
  throw?: (hand: 0 | 1, vx: number, vy: number, vz: number) => boolean;
  /** Every live crawler, for a walk to look at. */
  crawlers?: () => Array<{ uid: number; kind: number; x: number; y: number; z: number; phase: number; hp: number }>;
  /** TOOLS ONLY: a whole tide at once, already out of the walls. */
  flood?: (kind: EnemyId, count: number) => void;
  /** TOOLS ONLY: split n rifts open in the floor right now. */
  rifts?: (n: number) => void;
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
  turrets?: () => Array<{
    id: number;
    type: string;
    fired: number;
    yaw: number;
    fuelled: boolean;
    level: number;
    hp: number;
    maxHp: number;
  }>;
  /** TOOLS ONLY: coins into the purse. */
  coins?: (n: number) => void;
  /** Which towers are wearing a health gauge right now, and how faded in. */
  towerGauges?: () => Array<{ unit: number; fade: number }>;
  /** TOOLS ONLY: pin THE LOAD's effect budget (0.35..1; null lets it
   *  float) — and read it back, with the frame EMA it is reading. */
  fxQuality?: (v?: number | null) => { q: number; ema: number; beat: number };
  /** TOOLS ONLY: everything within r of plant (x, z) dies at once, by
   *  weapon w's hand (its multi-kill fx and all). Returns how many. */
  smite?: (x: number, z: number, r: number, w: WeaponId) => number;
  /** TOOLS ONLY: an fx as if the sim had sent it (a core hit, a clear). */
  fx?: (f: SiegeFx) => void;
  /** TOOLS ONLY: the shutter. The next time an fx of `kind` plays (for
   *  'death', a death comes apart; 'now', at once), let it run `after`
   *  seconds of effect time and then stop the clock (timeScale 0) — a
   *  mid-effect still, not a lucky one. `snapped` says when it has. */
  snap?: (kind: SiegeFx['kind'] | 'death' | 'now', after: number) => void;
  snapped?: () => boolean;
  /** TOOLS ONLY: glows lit last frame — rings, balls, rods. */
  glows?: () => { rings: number; balls: number; rods: number };
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

/**
 * A Points pool of sparks (or, with the soft texture, of fire). Every
 * burst asks THE LOAD (game/load.ts) first: when frames run long it
 * throws fewer, bigger particles. A particle can GROW as it ages (a
 * billow rolling out of a nozzle) and can burn HOT — its colour cooling
 * white → yellow → orange → red as it goes, instead of just dimming.
 */
class Sparks {
  readonly points: Points;
  private pos = new Float32Array(MAX_P * 3);
  private col = new Float32Array(MAX_P * 3);
  private size = new Float32Array(MAX_P);
  private size0 = new Float32Array(MAX_P);
  private grow = new Float32Array(MAX_P);
  private hot = new Uint8Array(MAX_P);
  private vel = new Float32Array(MAX_P * 3);
  private life = new Float32Array(MAX_P);
  private maxLife = new Float32Array(MAX_P);
  private base = new Float32Array(MAX_P * 3);
  private grav = new Float32Array(MAX_P);
  private next = 0;
  /** Particles alive last tick: none, and the upload is skipped. */
  private alive = 0;

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

  /** The next slot, made ready: where, what colour, how long, how big. */
  private slot(x: number, y: number, z: number, hex: number, life: number, size: number, grow: number, hot: boolean): number {
    const i = this.next;
    this.next = (this.next + 1) % MAX_P;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    _col.set(hex);
    this.base[i * 3] = _col.r;
    this.base[i * 3 + 1] = _col.g;
    this.base[i * 3 + 2] = _col.b;
    this.life[i] = this.maxLife[i] = life;
    this.size0[i] = this.size[i] = size;
    this.grow[i] = grow;
    this.hot[i] = hot ? 1 : 0;
    return i;
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
    // Busy: fewer, bigger.
    const q = fxQ();
    n = fxN(n);
    size *= 1 + (1 - q) * 0.7;
    for (let k = 0; k < n; k++) {
      const i = this.slot(x, y, z, color, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), 0, false);
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.9 + 0.1;
      const sp = speed * (0.4 + Math.random() * 0.6);
      this.vel[i * 3] = Math.cos(a) * sp * (1 - up * 0.5);
      this.vel[i * 3 + 1] = up * sp;
      this.vel[i * 3 + 2] = Math.sin(a) * sp * (1 - up * 0.5);
      this.grav[i] = gravity;
    }
  }

  /** One still glint — a POP of light where something burst (a death,
   *  a muzzle, a hit). Never thinned: it is the cheapest read there is. */
  pop(x: number, y: number, z: number, color: number, size: number, life: number): void {
    const i = this.slot(x, y, z, color, life, size, -0.6, false);
    this.vel[i * 3] = 0;
    this.vel[i * 3 + 1] = 0;
    this.vel[i * 3 + 2] = 0;
    this.grav[i] = 0;
  }

  /** A directed jet (the flame): along (dx, dz) with `spread`, drifting
   *  UP as it goes (negative gravity), each particle a colour from `cols`.
   *  `grow` swells each one as it ages; `hot` cools it through the
   *  flame's colours instead of just dimming it. */
  jet(
    x: number,
    y: number,
    z: number,
    dx: number,
    dz: number,
    n: number,
    speed: number,
    spread: number,
    cols: readonly number[],
    life: number,
    size: number,
    grow = 0,
    hot = false,
    lift = -1.2,
  ): void {
    const q = fxQ();
    n = fxN(n);
    size *= 1 + (1 - q) * 0.6;
    const yaw = Math.atan2(dx, dz);
    for (let k = 0; k < n; k++) {
      const i = this.slot(
        x,
        y,
        z,
        cols[Math.floor(Math.random() * cols.length)],
        life * (0.7 + Math.random() * 0.5),
        size * (0.7 + Math.random() * 0.9),
        grow,
        hot,
      );
      const a = yaw + (Math.random() - 0.5) * 2 * spread;
      const sp = speed * (0.6 + Math.random() * 0.5);
      this.vel[i * 3] = Math.sin(a) * sp;
      this.vel[i * 3 + 1] = (Math.random() - 0.3) * sp * 0.25;
      this.vel[i * 3 + 2] = Math.cos(a) * sp;
      this.grav[i] = lift;
    }
  }

  tick(dt: number): void {
    let alive = 0;
    for (let i = 0; i < MAX_P; i++) {
      if (this.life[i] <= 0) {
        this.size[i] = 0;
        continue;
      }
      alive++;
      this.life[i] -= dt;
      const f = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] = Math.max(0.01, this.pos[i * 3 + 1] + this.vel[i * 3 + 1] * dt);
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.hot[i]) {
        // Cooling: blue goes first, then green — white, yellow, orange, red.
        this.col[i * 3] = this.base[i * 3] * Math.sqrt(f);
        this.col[i * 3 + 1] = this.base[i * 3 + 1] * f * f;
        this.col[i * 3 + 2] = this.base[i * 3 + 2] * f * f * f * f;
      } else {
        this.col[i * 3] = this.base[i * 3] * f;
        this.col[i * 3 + 1] = this.base[i * 3 + 1] * f;
        this.col[i * 3 + 2] = this.base[i * 3 + 2] * f;
      }
      if (this.grow[i] !== 0) this.size[i] = Math.max(0, this.size0[i] * (1 + this.grow[i] * (1 - f)));
    }
    if (alive === 0 && this.alive === 0) return;
    this.alive = alive;
    const g = this.points.geometry;
    (g.attributes.position as BufferAttribute).needsUpdate = true;
    (g.attributes.color as BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as BufferAttribute).needsUpdate = true;
  }
}

/** Jet and trail palettes (made once: a literal per call is garbage
 *  per call). */
const FLAME_COLS = [0xfff6d0, 0xffe08a, 0xffb347, 0xff8a2a, 0xff5a1a] as const;
const BURN_COLS = [0xffb347, 0xff7a1a, 0xff4d1a] as const;
const BLAST_COLS = [0xffe0a0, 0xffb347, 0xff7a1a] as const;
const DUST_COLS = [0x8a7a66, 0x6e6252, 0xa89880] as const;
const CASING = [0xd8b04a] as const;
const MUZZLE = [0xfff0c0, 0xffb347] as const;
/** What fire and a blast leave on the floor, and a hammer's dent. */
const SCORCH = 0x1c0e06;
const DENT = 0x2a2622;
const EMBER = [0xffa040, 0xff7a1a] as const;
/** Each crawler kind's radius, by horde kind index. */
const RADII = HORDE_KINDS.map((k) => ENEMIES[k].radius);

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
  /** Rings, flashes and rods of light: three instanced layers. */
  private glows!: Glows;
  /** The tesla's forked, flickering discharges (drawn into the rods). */
  private bolts!: Bolts;
  /** The strongest buzz asked for this frame — one pulse a frame, however
   *  many big moments land in it. */
  private rumbleS = 0;
  private rumbleMs = 0;
  /** A multi-kill already roared this frame: the deaths' own crunch
   *  stays quiet. */
  private roared = false;
  /** Seconds until the core may flare again (a gnawing crowd hits it
   *  every frame). */
  private coreFxT = 0;
  /** TOOLS ONLY: the shutter (siegeView.snap): t −1 armed, ≥ 0 running,
   *  −2 taken. */
  private shutter: { kind: string; after: number; t: number } | null = null;
  private cracks: Array<{ crack: FloorCrack; open: number }> = [];
  private breachKey = '';
  private breachFlare = 0;
  private clock = 0;
  /** Per-turret: seconds of recoil/flash left. */
  private recoil = new Map<number, number>();
  /** THE CORE's ring and gauge. */
  private coreRing!: Mesh;
  private coreRingMat!: MeshBasicMaterial;
  private coreRingFrac = -1;
  private coreHit = 0;
  private coreSpin = 0;
  /** Each hand's recent path (plant m, with the clock), for the throw. */
  private fistTrail: Array<Array<[number, number, number, number]>> = [[], []];
  /** Whether each fist took what it holds (a walk's headless grab is
   *  left to the walk). */
  private fistOwns = [false, false];
  private gauge!: Gauge;
  /** THE TOWERS' gauges: a few, worn by whichever towers you are pointing
   *  at, reaching for, or have open — each fading in and out. */
  private towerGauges: Array<{ g: Gauge; unit: number; fade: number; hp: number; hit: number }> = [];
  /** Each tower's height to its top (plant m), measured once a level. */
  private towerTops = new Map<number, { level: number; top: number }>();
  private lastPhase = '';
  private fireClock = 0;
  /** Seconds since the core went — the fall plays before the card. */
  private fallenT = 0;

  init(): void {
    this.root = new Group();
    this.root.name = 'siege';
    ensurePlantRoot(this.scene).add(this.root);
    bindRoom(walls);

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
    this.sparks.points.name = 'sparks';
    this.root.add(this.sparks.points);
    // FIRE is soft: round blobs that bloom into each other, not glints.
    this.flames = new Sparks(softTexture());
    this.flames.points.name = 'flames';
    this.root.add(this.flames.points);

    this.glows = new Glows(this.root);
    this.bolts = new Bolts(this.glows.rods, 0xf4ecff, LINES.volt.glow);

    // THE CORE's ring: an arc of light on the floor, as long as its health.
    this.coreRingMat = glow(0x6cff9a);
    this.coreRingMat.side = DoubleSide;
    this.coreRing = new Mesh(new RingGeometry(0.21, 0.25, 48), this.coreRingMat);
    this.coreRing.rotation.x = -Math.PI / 2;
    this.coreRing.visible = false;
    this.root.add(this.coreRing);

    // THE GAUGE — the core's health, and nothing else, over the crystal.
    this.gauge = new Gauge(GAUGE.w);
    this.root.add(this.gauge.mesh);
    for (let k = 0; k < 4; k++) {
      const g = new Gauge(TOWER_GAUGE.w);
      this.root.add(g.mesh);
      this.towerGauges.push({ g, unit: -1, fade: 0, hp: 0, hit: 0 });
    }

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
        breaches: sg.breaches.map((b) => ({ x: b.x, z: b.z, state: b.state })),
        coins: sg.coins,
      };
    };
    siegeView.start = () => startWave();
    siegeView.core = () => standCore();
    siegeView.spawn = (kind, rift = -1, count = 1) => debugSpawn(kind, rift, count);
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
    siegeView.rifts = (n) => debugRifts(n);
    siegeView.jump = (n) => debugJump(n);
    siegeView.coins = (n) => debugCoins(n);
    siegeView.fxQuality = (v) => pinFxQ(v);
    siegeView.snap = (kind, after) => {
      this.shutter = { kind, after, t: kind === 'now' ? 0 : -1 };
    };
    siegeView.snapped = () => this.shutter?.t === -2;
    siegeView.smite = (x, z, r, w) => debugSmite(x, z, r, w);
    siegeView.fx = (f) => void plant.siege.fx.push(f);
    siegeView.glows = () => ({ rings: this.glows.rings.lit, balls: this.glows.balls.lit, rods: this.glows.rods.lit });
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
          phase: ['emerge', 'walk', 'held', 'fly', 'return', 'bite'][h.phase[i]],
        });
      }
      return out;
    };
    siegeView.towerGauges = () =>
      this.towerGauges.filter((t) => t.g.mesh.visible).map((t) => ({ unit: t.unit, fade: t.fade }));
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
          hp: u.hp,
          maxHp: u.maxHp,
        }));
  }

  update(delta: number): void {
    this.clock += delta;
    const sg = plant.siege;
    const live = site.screen === 'factory' && sg.phase !== 'off';
    this.root.visible = live;
    // THE LOAD hears every real frame of a live, unpaused fight, against
    // the headset's own rate when the session tells it.
    sampleFrame(delta, !live || site.paused, (this.world.session as { frameRate?: number } | undefined)?.frameRate ?? 0);
    if (!live) {
      if (this.cracks.length) this.syncBreaches(true);
      return;
    }
    let dt = delta * plant.timeScale;

    this.camera.getWorldPosition(_cam);
    toPlant(_cam);

    if (sg.phase !== this.lastPhase) {
      this.lastPhase = sg.phase;
      this.fallenT = 0;
    }
    if (sg.phase === 'fallen' && !site.finale) {
      this.fallenT += delta;
      if (this.fallenT > 2.6) siegeFallen();
    }
    this.coreFxT -= dt;

    this.tickFists(delta);
    this.drainFx();
    this.syncBreaches(false);
    this.tickBreaches(delta);
    const t0 = performance.now();
    this.drawEnemies();
    this.drainDeaths();
    // TOOLS ONLY: a running shutter cuts its last slice to land exactly
    // on its mark, then stops the clock.
    const sh = this.shutter;
    if (sh && sh.t >= 0) {
      dt = Math.min(dt, sh.after - sh.t);
      sh.t += dt;
      if (sh.t >= sh.after - 1e-6) {
        plant.timeScale = 0;
        sh.t = -2;
      }
    }
    this.shards.tick(dt);
    this.splats.tick(dt);
    this.drawMs = this.drawMs * 0.9 + (performance.now() - t0) * 0.1;
    // The glows: what was spawned ages and is written out, then this
    // frame's immediate ones (a shell's halo and reticle, the bolts) go
    // in after it.
    this.glows.begin(dt);
    this.drawShots(dt);
    this.bolts.draw(dt, fxQ() > 0.6);
    this.glows.end();
    this.drawFire(dt);
    this.drawBars();
    this.tickGuns(delta);
    this.tickLevels();
    this.sparks.tick(dt);
    this.flames.tick(dt);
    this.tickCore(delta);
    this.tickTowerGauges(delta);
    if (this.rumbleS > 0) {
      buzz(this.world, 'both', this.rumbleS, this.rumbleMs);
      this.rumbleS = 0;
      this.rumbleMs = 0;
    }
  }

  /* ── fx ─────────────────────────────────────────────────────────────── */

  private drainFx(): void {
    const list = plant.siege.fx;
    for (let k = 0; k < list.length; k++) this.perform(list[k]);
    list.length = 0;
  }

  /** Ask for a buzz in both hands; the frame sends the strongest. */
  private rumble(strength: number, ms: number): void {
    if (strength > this.rumbleS) this.rumbleS = strength;
    if (ms > this.rumbleMs) this.rumbleMs = ms;
  }

  private perform(f: SiegeFx): void {
    if (this.shutter?.t === -1 && this.shutter.kind === f.kind) this.shutter.t = 0;
    const color = f.weapon ? WEAPONS[f.weapon].color : 0xffa22e;
    const g = this.glows;
    // The embellishments — a second ring, a lingering pool of light, the
    // dust — are the first thing a long frame gives up (THE LOAD).
    const rich = fxQ() > 0.6;
    switch (f.kind) {
      case 'fire': {
        if (f.unit !== undefined) this.recoil.set(f.unit, 1);
        const yaw = f.yaw ?? 0;
        const sx = Math.sin(yaw);
        const cz = Math.cos(yaw);
        if (f.weapon === 'turret') {
          // THE GUN: a pop of light at the muzzle, a spit of sparks down
          // the bore, and a brass casing kicked out the side, falling.
          this.sparks.pop(f.x + sx * 0.03, f.y, f.z + cz * 0.03, 0xfff0c0, 3.4, 0.06);
          this.sparks.jet(f.x, f.y, f.z, sx, cz, 3, 1.8, 0.22, MUZZLE, 0.09, 0.7, 0, false, 0);
          this.sparks.jet(f.x, f.y - 0.05, f.z, cz, -sx, 1, 0.9, 0.4, CASING, 0.7, 0.9, 0, false, 4);
          sfx.gunFire('slug');
        } else if (f.weapon === 'mortar') {
          // THE MORTAR coughs: a pop, a bloom of fire out of the tube,
          // and a ring kicked off the floor round it.
          this.sparks.pop(f.x, f.y + 0.1, f.z, 0xfff0c0, 5, 0.1);
          this.sparks.burst(f.x, f.y + 0.1, f.z, 12, 0xfff0c0, 1.4, 0.35, -0.5, 1.2);
          this.flames.jet(f.x, f.y + 0.08, f.z, sx, cz, 5, 0.3, Math.PI, BLAST_COLS, 0.5, 1.6, 1.6, true, -0.8);
          if (rich) g.ring(f.x, f.z, color, 0.35, 0.4);
          sfx.gunFire('hammer');
          this.rumble(0.2, 40);
        } else if (f.weapon === 'tesla') {
          this.sparks.pop(f.x, f.y, f.z, 0xf4ecff, 4, 0.09);
          sfx.gunFire('arc');
        }
        break;
      }
      case 'flame': {
        // THE CONE: a hot tongue — a white-hot rod in a wide orange
        // sheath — and billows rolling off it, born small and pale at the
        // lip, swelling and cooling to red as they go. Embers drift up off
        // its far end; now and then the floor it licks is scorched.
        const yaw = f.yaw ?? 0;
        const reach = f.reach ?? 1;
        const sx = Math.sin(yaw);
        const cz = Math.cos(yaw);
        g.rod(f.x, f.y, f.z, f.x + sx * reach * 0.5, f.y + 0.02, f.z + cz * reach * 0.5, 0xffd890, 0.16, 0.02);
        g.rod(f.x, f.y, f.z, f.x + sx * reach * 0.8, f.y + 0.03, f.z + cz * reach * 0.8, 0xff6a1a, 0.18, 0.06, 0.5);
        this.flames.jet(f.x, f.y, f.z, sx, cz, 8, reach * 2.4, 0.26, FLAME_COLS, 0.45, 1.5, 1.8, true, -0.6);
        if (Math.random() < 0.5) {
          const d = reach * 0.6;
          this.sparks.jet(f.x + sx * d, f.y, f.z + cz * d, sx, cz, 1, 0.5, 0.9, EMBER, 1.1, 0.6, 0, false, -0.9);
        }
        if (Math.random() < 0.08) {
          const d = reach * (0.45 + Math.random() * 0.45);
          this.splats.add(f.x + sx * d, f.z + cz * d, 0.08 + Math.random() * 0.06, SCORCH, true);
        }
        if (f.unit !== undefined) this.recoil.set(f.unit, 1);
        sfx.flameRoar();
        break;
      }
      case 'punch': {
        // THE HAMMER lands: a hard white flash pooled on the floor, a fast
        // white shock ring and a slower one in its colour, a ring of dust
        // rolling out behind them, grit and crystal thrown up, a dent
        // left in the floor — and its weight in both hands.
        const r = f.radius ?? 0.22;
        g.flash(f.x, 0.03, f.z, 0xffffff, r * 0.9, 0.16, 1, 0.3);
        g.ring(f.x, f.z, 0xffffff, r * 1.3, 0.22);
        g.ring(f.x, f.z, color, r * 2.2, 0.5, 0.8);
        if (rich) g.ring(f.x, f.z, 0xa89880, r * 2.9, 0.85, 0.4, 0.06);
        this.sparks.burst(f.x, 0.04, f.z, 18, color, 2.0, 0.45, 5, 1.1);
        this.sparks.burst(f.x, 0.04, f.z, 8, 0xffffff, 1.4, 0.3, 3, 0.8);
        this.flames.jet(f.x, 0.03, f.z, 0, 0, 8, 0.8, Math.PI, DUST_COLS, 0.75, 2.2, 1.8, false, -0.25);
        this.shards.burst(f.x, 0.03, f.z, fxN(5, 2), 0x9a9080, 0.02, 0.9, 1.6);
        this.splats.add(f.x, f.z, r * 1.1, DENT, true);
        this.multiKill(f.x, f.z, f.kills ?? 0, color);
        sfx.hammerSlam();
        this.rumble(0.3, 55);
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
        g.ring(f.x, f.z, breachHex(), r * 1.6, 0.3);
        this.sparks.burst(f.x, 0.03, f.z, 14, 0xffffff, 1.3, 0.3, 3, 0.8);
        sfx.scrapCrunch(r > 0.15);
        break;
      }
      case 'shell': {
        // A MORTAR SHELL lands: a white flash, a fast shock ring and a
        // fire ring behind it, a fireball rolling up and cooling, debris,
        // a pool of glow left burning on the floor, and a scorch.
        const r = f.radius ?? 0.5;
        g.flash(f.x, 0.1, f.z, 0xffd890, r * 0.45, 0.16, 0.75);
        if (rich) g.flash(f.x, 0.02, f.z, 0xff7a1a, r * 0.9, 0.9, 0.5, 0.2);
        g.ring(f.x, f.z, 0xfff0d0, r * 1.7, 0.32);
        if (rich) g.ring(f.x, f.z, 0xff9a3a, r * 1.2, 0.6, 0.85, 0.04);
        this.sparks.pop(f.x, 0.12, f.z, 0xfff0d0, 8, 0.1);
        this.sparks.burst(f.x, 0.1, f.z, 40, 0xffa040, 2.4, 0.7, 4, 1.4);
        this.flames.jet(f.x, 0.05, f.z, 0, 0, 12, 0.6, Math.PI, BLAST_COLS, 0.8, 2.4, 2, true, -1.6);
        this.shards.burst(f.x, 0.05, f.z, fxN(6, 3), 0x3a2a20, 0.024, 1.4, 2.2);
        this.splats.add(f.x, f.z, r * 0.9, SCORCH, true);
        this.multiKill(f.x, f.z, f.kills ?? 0, color);
        sfx.mortarBoom();
        this.rumble(0.35, 70);
        break;
      }
      case 'hit':
        // A round lands on one: a pop where it struck and a spit of
        // sparks in the round's colour.
        this.sparks.pop(f.x, f.y, f.z, 0xffffff, 2.6, 0.06);
        this.sparks.burst(f.x, f.y, f.z, 5, color, 1.2, 0.25, 4, 0.8);
        break;
      case 'blast': {
        // A sapper's charge, or plant chewed to scrap.
        const r = f.radius ?? 0.3;
        g.ring(f.x, f.z, 0xff5a1e, r, 0.45);
        g.flash(f.x, f.y + 0.05, f.z, 0xffb060, r * 0.7, 0.28);
        this.sparks.burst(f.x, f.y + 0.05, f.z, 30, 0xff7a2a, 1.7, 0.6, 4, 1.3);
        sfx.shellBurst(r > 0.4);
        if (f.unit === undefined) this.rumble(0.35, 60);
        break;
      }
      case 'arc':
        if (f.path) {
          // THE COIL: a forked bolt down the chain (it re-strikes and
          // flickers — glows.ts), and a pop of light on every one it bit.
          const p = f.path;
          this.bolts.strike(p);
          let cx = 0;
          let cz = 0;
          let m = 0;
          for (let k = 3; k + 2 < p.length; k += 3) {
            this.sparks.pop(p[k], p[k + 1], p[k + 2], 0xe6d4ff, m === 0 ? 4.5 : 3.2, 0.12);
            this.sparks.burst(p[k], p[k + 1], p[k + 2], 3, LINES.volt.glow, 1.2, 0.25, 3, 0.9);
            cx += p[k];
            cz += p[k + 2];
            m++;
          }
          if (m) {
            g.flash(p[3], p[4], p[5], 0xe6d4ff, 0.06, 0.12);
            this.multiKill(cx / m, cz / m, f.kills ?? 0, color);
          }
        }
        break;
      case 'bite':
        this.sparks.burst(f.x, 0.3, f.z, 3, 0xffc070, 0.7, 0.25, 4, 0.6);
        sfx.plantGnaw();
        break;
      case 'core-hit':
        // THE CORE is bitten: crystal and gauge flash (tickCore), a red
        // ring snaps out round it, splinters of it fly — at most every
        // few frames, however many are chewing.
        this.coreHit = 1;
        if (this.coreFxT <= 0) {
          this.coreFxT = 0.15;
          g.ring(f.x, f.z, 0xff4030, 0.75, 0.4, 0.95, 0, 0.5);
          g.ring(f.x, f.z, 0xffffff, 0.4, 0.2, 0.7, 0, 0.4);
          g.flash(f.x, 0.5, f.z, 0xff8a70, 0.24, 0.18, 1);
          this.shards.burst(f.x, 0.5, f.z, fxN(5, 2), NEON.dock, 0.02, 0.8, 1.2);
          this.sparks.burst(f.x, 0.5, f.z, 10, 0xff4030, 1.0, 0.35, 4, 0.9);
          this.rumble(Math.min(0.6, 0.25 + (f.radius ?? 1) * 0.02), 50);
        }
        sfx.coreAlarm();
        break;
      case 'upgrade': {
        // A level bought: a ring rises off the floor round it, sparks fly.
        const hex = f.weapon ? WEAPONS[f.weapon].color : 0xffffff;
        g.ring(f.x, f.z, hex, 0.42, 0.55);
        g.ring(f.x, f.z, 0xffffff, 0.26, 0.4);
        this.sparks.burst(f.x, 0.5, f.z, 40, hex, 1.6, 0.6, 2, 1.3);
        sfx.stampDone();
        sfx.ceremonyChord();
        break;
      }
      case 'breach':
        // A RIFT splits the floor: grit and sparks out of it, and the
        // pack is coming up.
        this.breachFlare = 1;
        g.ring(f.x, f.z, breachHex(), (f.radius ?? 0.4) * 1.8, 0.5);
        this.sparks.burst(f.x, 0.15, f.z, 40, breachHex(), 1.6, 0.6, 3, 1.2);
        this.sparks.burst(f.x, 0.1, f.z, 16, 0xd8d0c0, 1.2, 0.4, 5, 1);
        sfx.wallKnock();
        this.rumble(0.3, 60);
        break;
      case 'wave-start':
        this.breachFlare = 1.5;
        sfx.waveStart();
        sfx.wallKnock();
        this.rumble(0.5, 120);
        break;
      case 'clear':
      case 'victory': {
        // THE WAVE IS DOWN: a sweep of light out from the core across the
        // whole floor, a white one chasing it, and a fountain off the
        // crystal. (The last wave: the same, in gold, wider.)
        const won = f.kind === 'victory';
        const hex = won ? 0xffd36a : 0x6cff9a;
        g.ring(f.x, f.z, hex, won ? 6 : 4.5, won ? 2 : 1.6, 1, 0, 0.14);
        g.ring(f.x, f.z, 0xffffff, won ? 4.5 : 3.2, 1.3, 0.7, 0.15, 0.08);
        g.flash(f.x, 0.5, f.z, hex, 0.35, 0.6, 0.7);
        this.sparks.burst(f.x, 0.6, f.z, won ? 90 : 50, hex, 2.2, 1.0, 3, 1.4);
        if (won) sfx.ceremonyChord();
        else sfx.allClear();
        this.rumble(0.3, 90);
        break;
      }
      case 'fallen':
        sfx.coreFall();
        g.ring(f.x, f.z, 0xff3020, 2.4, 1.6, 0.95, 0, 0.3);
        g.ring(f.x, f.z, 0xff3020, 1.4, 1.4);
        g.ring(f.x, f.z, 0xffffff, 0.8, 0.5);
        g.flash(f.x, 0.6, f.z, 0xff6a30, 0.6, 0.8);
        g.flash(f.x, 0.02, f.z, 0xff3020, 0.9, 2.4, 0.5, 0.2);
        this.shards.burst(f.x, 0.6, f.z, 40, NEON.dock, 0.03, 1.4, 2);
        this.sparks.burst(f.x, 0.7, f.z, 160, 0xff8a3a, 3, 1.4, 4, 1.8);
        this.rumble(1, 400);
        break;
    }
  }

  /**
   * A MULTI-KILL: one shot took a crowd, and the pop is sized by the
   * count — a white shock ring and a coloured one out to a radius that
   * grows with √n, a flash, a crown of glints, a deeper crunch and a
   * buzz you feel. Three is a pop; thirty is an event.
   */
  private multiKill(x: number, z: number, n: number, hex: number): void {
    if (n < 3) return;
    const g = this.glows;
    const s = Math.sqrt(n);
    g.ring(x, z, 0xffffff, 0.16 + s * 0.09, 0.28 + s * 0.03, 1);
    g.ring(x, z, hex, 0.22 + s * 0.13, 0.45 + s * 0.04, 0.7, 0.05);
    g.flash(x, 0.08, z, hex, 0.04 + s * 0.025, 0.12, 0.55);
    this.sparks.pop(x, 0.12, z, hex, 4 + s * 1.5, 0.14);
    this.sparks.burst(x, 0.1, z, Math.min(60, 8 + n * 2), hex, 1.2 + s * 0.25, 0.45, 3, 1.1);
    sfx.multiKill(n);
    this.roared = true;
    this.rumble(Math.min(0.7, 0.15 + s * 0.08), 30 + Math.min(70, n * 3));
  }

  /* ── the crawlers ───────────────────────────────────────────────────── */

  private drawEnemies(): void {
    this.swarm.update(plant.siege.horde, this.clock);
  }

  /**
   * THE AFTERMATH. Every death the sim logged since last frame comes
   * apart here: a pop of white where it was, shards out of it, a splat
   * where it stood, sparks for the big ones — and ONE sound for the lot,
   * sized by how many went (unless a multi-kill already roared for it).
   */
  private drainDeaths(): void {
    const h = plant.siege.horde;
    const n = h.deathN;
    h.deathN = 0;
    const roared = this.roared;
    this.roared = false;
    if (n === 0) return;
    if (this.shutter?.t === -1 && this.shutter.kind === 'death') this.shutter.t = 0;
    // In a flood the per-death budget shrinks — and again when frames
    // run long (THE LOAD) — so a mortar into a carpet of three hundred is
    // still one frame: fewer pieces, each a little bigger, and a splat
    // and a pop for only every second or third.
    const thin = (n > 60 ? 0.35 : n > 20 ? 0.6 : 1) * fxQ();
    const grain = 1 + (1 - thin) * 0.6;
    const every = thin > 0.5 ? 1 : thin > 0.25 ? 2 : 3;
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
        this.shards.burst(x, r * 0.7, z, Math.max(2, Math.round(5 * thin)), hue, r * 0.32 * grain, 0.9, 1.4);
        if (k % every === 0) {
          this.splats.add(x, z, r * 3.2 * (every > 1 ? 1.25 : 1), neon);
          // THE POP: a glint where it was, gone in a blink — white for
          // one, its own neon in a crowd (thirty whites are a white-out).
          this.sparks.pop(x, r * 0.8, z, n > 4 ? neon : 0xffffff, 2.2 * grain, 0.07);
        }
      } else if (kind === 'beetle') {
        big++;
        this.shards.burst(x, r * 0.7, z, Math.max(4, Math.round(12 * thin)), hue, r * 0.3 * grain, 1.1, 1.7);
        this.splats.add(x, z, r * 3.4, neon);
        this.sparks.pop(x, r, z, 0xffffff, 3.6, 0.1);
        this.sparks.burst(x, r, z, 10, neon, 1.2, 0.4, 4, 1);
        if (n <= 20 && thin > 0.6) this.glows.ring(x, z, neon, r * 3, 0.3, 0.7);
      } else {
        big += 4;
        this.hulkDown(x, z, r, neon, hue);
      }
    }
    sfx.swarmPop(mites + big);
    if (!roared && (n >= 10 || big >= 4)) sfx.swarmCrunch(n);
  }

  /** A HULK goes down — the biggest death on the floor gets the biggest
   *  send-off: a white flash, a fast white ring and a slow one in its
   *  neon, a pool of its glow left burning, a fountain of shards and dark
   *  shell, sparks, a scorch, a deep crash and a long buzz. */
  private hulkDown(x: number, z: number, r: number, neon: number, hue: number): void {
    const g = this.glows;
    g.flash(x, r, z, 0xffe0c0, r * 1.6, 0.28);
    g.flash(x, 0.02, z, neon, r * 3, 1.4, 0.5, 0.2);
    g.ring(x, z, 0xffffff, r * 3, 0.3);
    g.ring(x, z, neon, r * 5, 0.75, 0.9, 0.06);
    this.sparks.pop(x, r, z, 0xffffff, 8, 0.15);
    this.shards.burst(x, r * 0.8, z, fxN(48, 16), hue, r * 0.22, 1.6, 2.4);
    this.shards.burst(x, r * 0.8, z, fxN(16, 6), 0x2a2430, r * 0.3, 1.2, 2);
    this.splats.add(x, z, r * 3.6, neon);
    this.splats.add(x, z, r * 2, SCORCH, true);
    this.sparks.burst(x, r, z, 50, neon, 2.2, 0.7, 4, 1.5);
    sfx.hulkDown();
    this.rumble(0.7, 140);
  }

  private drawShots(dt: number): void {
    let n = 0;
    const splash = WEAPONS.mortar.splash ?? 0.5;
    const q = fxQ();
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
      const r = shell ? 0.05 : 0.016;
      const len = shell ? 1.4 : 12;
      trs(_m, x, y, z, _q, r, r, r * len);
      this.shotsMesh.setMatrixAt(n, _m);
      this.shotsMesh.setColorAt(n, _col.set(WEAPONS[s.weapon].color));
      n++;
      if (shell) {
        // A shell burns as it flies — a halo round it, a trail of fire
        // cooling to red behind it, a spark now and then — and where it
        // will fall is marked: a ring on the floor, closing and
        // brightening as it comes down.
        if (q > 0.6) this.glows.balls.now(x, y, z, 0.09, 0, 1, 0, 1, _col.r * 0.35, _col.g * 0.35, _col.b * 0.35);
        // (So many a second, not a frame: a 90 Hz headset must not
        // trail more fire than a 60 Hz one.)
        if (Math.random() < 20 * dt * q) this.flames.jet(x, y, z, 0, 0, 1, 0.05, Math.PI, BLAST_COLS, 0.5, 1.0, 1.8, true, -0.2);
        if (Math.random() < 12 * dt * q) this.sparks.burst(x, y, z, 1, 0xffd080, 0.2, 0.35, 1, 0.8);
        const lit = 0.12 + 0.5 * p * p;
        this.glows.rings.now(s.x1, 0.012, s.z1, splash * (1.6 - 0.6 * p), 0, 1, 0, 0.3, _col.r * lit, _col.g * lit, _col.b * lit);
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
    // Everything on fire smokes and flickers as it comes — up to a
    // budget a tick (smaller when frames run long), so a burning carpet
    // costs the same as a burning row.
    const h = plant.siege.horde;
    let burning = 0;
    for (let i = 0; i < h.n; i++) if (h.burnT[i] > 0 && !h.dead[i]) burning++;
    const every = Math.max(1, Math.ceil(burning / fxN(40, 12)));
    let seen = 0;
    for (let i = 0; i < h.n; i++) {
      if (h.burnT[i] <= 0 || h.dead[i]) continue;
      if (seen++ % every !== 0) continue;
      const r = RADII[h.kind[i]];
      this.flames.jet(h.x[i] + (Math.random() - 0.5) * r, r * 1.2, h.z[i] + (Math.random() - 0.5) * r, 0, 0, 1, 0.15, Math.PI, BURN_COLS, 0.4, 1.2 + r * 5, 0.8, true);
    }
    const q = fxQ();
    for (const f of plant.siege.fires) {
      const fade = Math.min(1, (f.life - f.t) / 0.8);
      const n = Math.round(4 * fade * q);
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * f.r;
        this.flames.jet(f.x + Math.sin(a) * d, 0.02, f.z + Math.cos(a) * d, 0, 0, 1, 0.1, Math.PI, BURN_COLS, 0.55, 2.4, 0.6, true);
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
      // …wears what each level adds…
      refs?.gun?.dress?.(level);
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

  /* ── the rifts ──────────────────────────────────────────────────────── */

  /** A crack in the floor for every rift this wave has: they come when
   *  the wave starts and go when it is done. */
  private syncBreaches(clear: boolean): void {
    const list = clear ? [] : plant.siege.breaches;
    const key = list.map((b) => `${b.x.toFixed(2)},${b.z.toFixed(2)}`).join('|');
    if (key === this.breachKey) return;
    this.breachKey = key;
    for (const c of this.cracks) c.crack.dispose();
    this.cracks = [];
    list.forEach((b, k) => {
      const crack = new FloorCrack(breachHex(), b.half, Math.floor(b.x * 977 + b.z * 131) + k);
      crack.group.position.set(b.x, 0, b.z);
      // Its run along local +X lies along the rift's.
      crack.group.rotation.y = Math.atan2(-b.tz, b.tx);
      this.root.add(crack.group);
      this.cracks.push({ crack, open: 0 });
    });
  }

  private tickBreaches(delta: number): void {
    const sg = plant.siege;
    this.breachFlare = Math.max(0, this.breachFlare - delta * 0.8);
    this.cracks.forEach((c, k) => {
      const state = sg.breaches[k]?.state ?? 'spent';
      // GATHERING: a hairline that pulses — a warning.
      // POURING: it gapes, hot and flickering as each one climbs out.
      // SPENT: it closes to a dim scar.
      const pouring = state === 'pouring';
      const breathe = 0.5 + 0.5 * Math.sin(this.clock * (pouring ? 11 : 3.2));
      const want = state === 'spent' ? 0.12 : pouring ? 1 : 0.06 + 0.05 * breathe;
      c.open += (want - c.open) * Math.min(1, delta * (pouring ? 5 : 2));
      const lit =
        state === 'spent'
          ? 0.12
          : Math.min(1, (pouring ? 0.75 : 0.45) + breathe * 0.25 + this.breachFlare * 0.3);
      c.crack.set(c.open, lit);
    });
  }

  /* ── the core ───────────────────────────────────────────────────────── */

  private tickCore(delta: number): void {
    const core = dockUnit();
    if (!core) {
      this.coreRing.visible = false;
      this.gauge.mesh.visible = false;
      return;
    }
    cellCenter(core.i, core.j, _c);
    const frac = coreHealth();
    if (Math.abs(frac - this.coreRingFrac) > 0.004) {
      this.coreRingFrac = frac;
      this.coreRing.geometry.dispose();
      this.coreRing.geometry = new RingGeometry(0.2, 0.245, 48, 1, Math.PI / 2, Math.max(0.001, frac * Math.PI * 2));
    }
    this.coreHit = Math.max(0, this.coreHit - delta * 3);
    this.coreRing.position.set(_c.x, 0.015, _c.z);
    this.coreRing.visible = true;
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

    // The gauge rides over the crystal, turned to face you.
    this.gauge.place(_c.x, GAUGE.y, _c.z, _cam.x, _cam.z);
    this.gauge.mesh.visible = !site.paused;
    this.gauge.mat.opacity = frac < 0.25 ? 0.6 + 0.4 * Math.sin(this.clock * 9) ** 2 : 1;
    this.gauge.paint(frac, this.coreHit);
  }

  /**
   * A TOWER'S HEALTH, ON ASK. Every tower has a gauge like the core's,
   * but it is only worn while you are pointing at the tower (the ray, or
   * the mouse in the emulator), your fingertip is reaching for it, or its
   * panel is open — a floor of sixty bars would be a second carpet.
   * Each fades in and out, sits just over the tower's top, and flashes
   * when the tower is bitten.
   */
  private tickTowerGauges(delta: number): void {
    // Who is asked about, this frame (at most one each way).
    _asked.length = 0;
    for (const id of [site.inspect, site.hover.ray, site.hover.hand]) {
      if (id < 0 || _asked.includes(id)) continue;
      const u = plant.units.find((x) => x.id === id);
      if (u && isWeapon(u.type)) _asked.push(id);
    }
    // A gauge already on an asked tower keeps it; free ones take the rest.
    for (const id of _asked) {
      if (this.towerGauges.some((t) => t.unit === id)) continue;
      const free = this.towerGauges.find((t) => !_asked.includes(t.unit) && t.fade < 0.05);
      if (!free) continue;
      const u = plant.units.find((x) => x.id === id)!;
      free.unit = id;
      free.hp = u.hp;
      free.hit = 0;
    }
    for (const t of this.towerGauges) {
      const u = t.unit >= 0 ? plant.units.find((x) => x.id === t.unit) : undefined;
      const want = u && _asked.includes(t.unit) ? 1 : 0;
      t.fade += (want - t.fade) * Math.min(1, delta * (want ? 14 : 6));
      if (!u || t.fade < 0.02) {
        t.g.mesh.visible = false;
        if (!u || !want) t.unit = -1;
        continue;
      }
      // A bite since last frame flashes it.
      if (u.hp < t.hp - 0.01) t.hit = 1;
      t.hp = u.hp;
      t.hit = Math.max(0, t.hit - delta * 3);
      cellCenter(u.i, u.j, _c);
      t.g.place(_c.x, this.towerTop(u) + TOWER_GAUGE.over, _c.z, _cam.x, _cam.z);
      t.g.mat.opacity = t.fade;
      t.g.mesh.visible = true;
      t.g.paint(Math.max(0, u.hp / u.maxHp), t.hit);
    }
  }

  /** How tall tower `u` stands (plant m), measured off its model once per
   *  level (a level makes it bigger). */
  private towerTop(u: Unit): number {
    const level = levelOf(u);
    const known = this.towerTops.get(u.id);
    if (known && known.level === level) return known.top;
    let top = 0.6;
    const refs = liveUnitRefs.get(u.id);
    if (refs) {
      _box.setFromObject(refs.group);
      if (!_box.isEmpty()) top = _box.max.y / PLANT_SCALE;
    }
    this.towerTops.set(u.id, { level, top });
    return top;
  }
}

/** The towers' gauges: narrower than the core's, and how far over a
 *  tower's top they ride (plant m). */
const TOWER_GAUGE = { w: 0.3, over: 0.09 };
const _asked: number[] = [];
const _box = new Box3();

/** The core's gauge: its width (plant m) and height over the floor. */
const GAUGE = { w: 0.4, y: 1.0 };

const _tmpWhite = new Color(0xffffff);
