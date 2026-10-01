/**
 * THE CRAWLERS — what lives in the walls, drawn in hostile neon.
 *
 * The machines are traced in the trades' warm colours (gold, orange,
 * ice, yellow, green, red, amber, white). Everything that comes out of
 * the plaster is traced in MAGENTA — a colour no machine wears — on a
 * body of black, with white-hot eyes and a haze of its own light, so in
 * a dim room through passthrough the enemy is the thing you see first,
 * and never mistake for your own plant.
 *
 * Four silhouettes, each readable from across the room:
 *
 *   SKITTER  a spider: a flat diamond carapace slung low between six
 *            long jointed legs, knees above its back.
 *   SAPPER   a squat four-legged carrier hauling a blazing orange charge
 *            in a cage of magenta ribs. The charge beats faster as it
 *            closes on what it means to blow up.
 *   GRUB     a centipede: five segments, a neon hoop round each, slithering
 *            side to side on rows of little legs, mandibles snapping.
 *   BRUTE    a hunched gorilla-crab twice the height of anything else:
 *            plated back on a neon spine, two huge arms that swing as it
 *            walks and SLAM when it bites, one white slit of an eye.
 *
 * LEGS WALK. Every leg is two bones solved onto a foot that is planted on
 * the floor and stepped in a gait off the sim's own stride counter, so a
 * slowed crawler visibly wades and a chewing one stands its ground.
 *
 * Everything is instanced, one pool per body part per kind, posed in
 * BODY units (1 = the enemy's radius, +Z forward, floor at y = 0).
 */

import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Material,
} from 'three';
import type { EnemyId } from '../config.js';
import type { Enemy } from '../factory/state.js';

/** The hostile palette. */
export const HOSTILE = {
  neon: 0xff2bd6, // magenta — the colour of everything that isn't yours
  eye: 0xffe6fb, // white-hot, a breath of pink
  charge: 0xff8a1a, // the sapper's bomb
  body: 0x0b0a10,
};

export interface Comp {
  mesh: InstancedMesh;
  per: number;
  /** Takes the hit flash (to white) and the frost tint (to ice). */
  flashable: boolean;
  base: Color;
  pose: (e: Enemy, k: number, t: number, out: Matrix4) => void;
}

export const CAP: Record<EnemyId, number> = { skitter: 140, grub: 48, sapper: 48, brute: 10 };

/** How high over the floor a kind's health bar rides, in body units. */
export const BAR_HEIGHT: Record<EnemyId, number> = { skitter: 2.3, sapper: 2.9, grub: 2.0, brute: 4.4 };

/* ── geometry & materials (shared) ──────────────────────────────────────── */

let _cyl: CylinderGeometry | null = null;
/** A unit cylinder along +Y, centred — every bone and neon stroke. */
const cylGeo = (): CylinderGeometry => (_cyl ??= new CylinderGeometry(1, 1, 1, 7, 1));
let _sph: SphereGeometry | null = null;
const sphGeo = (): SphereGeometry => (_sph ??= new SphereGeometry(1, 14, 10));
let _oct: OctahedronGeometry | null = null;
const octGeo = (): OctahedronGeometry => (_oct ??= new OctahedronGeometry(1, 0));
let _tor: TorusGeometry | null = null;
const torGeo = (): TorusGeometry => (_tor ??= new TorusGeometry(1, 0.11, 6, 24));

/** Black glass. White so the per-instance colour carries the body tone
 *  (and the hit flash can push it to white). */
const bodyMat = (): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: 0xffffff, roughness: 0.28, metalness: 0.65 });
/** Neon: unlit, bright, coloured per instance. */
const neonMat = (): MeshBasicMaterial => new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
/** The haze round a stroke or a body. */
const hazeMat = (opacity: number): MeshBasicMaterial =>
  new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });

/* ── posing helpers ─────────────────────────────────────────────────────── */

const UP = new Vector3(0, 1, 0);
const _q = new Quaternion();
const _qa = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _d = new Vector3();
const _k = new Vector3();
const _n = new Vector3();
const _kn = new Vector3();
const IDQ = new Quaternion();

function trs(out: Matrix4, x: number, y: number, z: number, q: Quaternion, sx: number, sy: number, sz: number): Matrix4 {
  return out.compose(_p.set(x, y, z), q, _s.set(sx, sy, sz));
}

/** A bone (or a neon stroke) from a to b, radius r. */
function bone(out: Matrix4, a: Vector3, b: Vector3, r: number): Matrix4 {
  _d.subVectors(b, a);
  const len = Math.max(1e-4, _d.length());
  _q.setFromUnitVectors(UP, _d.multiplyScalar(1 / len));
  _p.addVectors(a, b).multiplyScalar(0.5);
  return out.compose(_p, _q, _s.set(r, len, r));
}

/** Two-bone leg: the knee for hip → foot, bones l1 and l2, bending
 *  toward `bend` (it is pushed off the hip–foot line that way). */
function knee(hip: Vector3, foot: Vector3, l1: number, l2: number, bend: Vector3, out: Vector3): Vector3 {
  _d.subVectors(foot, hip);
  const d = Math.min(_d.length(), l1 + l2 - 1e-3);
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  _d.normalize();
  _n.copy(bend).addScaledVector(_d, -bend.dot(_d)).normalize();
  return out.copy(hip).addScaledVector(_d, along).addScaledVector(_n, h);
}

/** Where a foot is this frame: its rest spot stepped forward and back
 *  by the gait, lifted through its swing. `phase` offsets legs. */
function step(
  e: Enemy,
  rest: Vector3,
  rate: number,
  phase: number,
  stride: number,
  lift: number,
  out: Vector3,
): Vector3 {
  const biting = e.phase === 'bite';
  const p = e.stride * rate + phase;
  const swing = biting ? 0 : Math.sin(p);
  const up = biting ? 0 : Math.max(0, Math.cos(p));
  return out.set(rest.x, rest.y + up * lift, rest.z + swing * stride);
}

/* ── the kits ───────────────────────────────────────────────────────────── */

export function makeKit(kind: EnemyId, parent: Group): Comp[] {
  const cap = CAP[kind];
  const comps: Comp[] = [];
  const add = (
    geo: BufferGeometry,
    mat: Material,
    per: number,
    base: number,
    pose: Comp['pose'],
    flashable = true,
  ): void => {
    const mesh = new InstancedMesh(geo, mat, cap * per);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    for (let k = 0; k < cap * per; k++) mesh.setColorAt(k, new Color(base));
    if ((mat as MeshBasicMaterial).blending === AdditiveBlending) mesh.renderOrder = 12;
    parent.add(mesh);
    comps.push({ mesh, per, flashable, base: new Color(base), pose });
  };
  /** A neon pool and its haze, posed by the same function at two radii. */
  const neon = (per: number, hex: number, pose: (e: Enemy, k: number, t: number, out: Matrix4, rk: number) => void): void => {
    add(cylGeo(), neonMat(), per, hex, (e, k, t, out) => pose(e, k, t, out, 1));
    add(cylGeo(), hazeMat(0.22), per, hex, (e, k, t, out) => pose(e, k, t, out, 3), false);
  };

  if (kind === 'skitter') skitter(add, neon);
  else if (kind === 'sapper') sapper(add, neon);
  else if (kind === 'grub') grub(add, neon);
  else brute(add, neon);
  return comps;
}

type Add = (
  geo: BufferGeometry,
  mat: Material,
  per: number,
  base: number,
  pose: Comp['pose'],
  flashable?: boolean,
) => void;
type Neon = (per: number, hex: number, pose: (e: Enemy, k: number, t: number, out: Matrix4, rk: number) => void) => void;

/* SKITTER — the spider. */
function skitter(add: Add, neon: Neon): void {
  const bodyY = (e: Enemy, t: number): number =>
    0.95 + (e.phase === 'bite' ? Math.sin(t * 18) * 0.08 : Math.abs(Math.sin(e.stride * 22)) * 0.07);
  // The carapace: a flat black diamond.
  add(octGeo(), bodyMat(), 1, HOSTILE.body, (e, _k, t, out) => trs(out, 0, bodyY(e, t), 0, IDQ, 0.85, 0.34, 1.25));
  // Its trace: the four rim edges and the ridge down its back.
  const rim: Array<[number, number, number]> = [
    [0.85, 0, 0],
    [0, 0, 1.25],
    [-0.85, 0, 0],
    [0, 0, -1.25],
  ];
  neon(6, HOSTILE.neon, (e, k, t, out, rk) => {
    const y = bodyY(e, t);
    if (k < 4) {
      const [ax, , az] = rim[k];
      const [bx, , bz] = rim[(k + 1) % 4];
      _a.set(ax, y, az);
      _b.set(bx, y, bz);
    } else {
      _a.set(0, y + 0.34, 0);
      _b.set(0, y, k === 4 ? 1.25 : -1.25);
    }
    return bone(out, _a, _b, 0.045 * rk);
  });
  // Six legs, two bones each, knees high over the back. Tripod gait:
  // front-left, middle-right, back-left step together.
  const rests = [0.75, 0, -0.75];
  neon(12, HOSTILE.neon, (e, k, t, out, rk) => {
    const leg = k >> 1;
    const side = leg % 2 === 0 ? -1 : 1;
    const row = leg >> 1;
    const y = bodyY(e, t);
    const hip = _a.set(side * 0.5, y, rests[row] * 0.8);
    const rest = _b.set(side * 1.85, 0, rests[row] * 1.45);
    const foot = step(e, rest, 22, ((row + (side > 0 ? 1 : 0)) % 2) * Math.PI, 0.38, 0.4, _k);
    // Biting: the front pair rear up and STAB.
    if (e.phase === 'bite' && row === 0) {
      foot.set(side * 0.55, 0.35 + Math.max(0, Math.sin(t * 16 + side)) * 0.9, 1.9);
    }
    const kn = knee(hip, foot, 1.25, 1.55, _n.set(side, 2.2, 0), _kn);
    return k % 2 === 0 ? bone(out, hip, kn, 0.065 * rk) : bone(out, kn, foot, 0.055 * rk);
  });
  // The eyes: two big, two small, white-hot.
  add(sphGeo(), neonMat(), 4, HOSTILE.eye, (e, k, t, out) => {
    const y = bodyY(e, t) + 0.12;
    const big = k < 2;
    const sx = k % 2 === 0 ? -1 : 1;
    const r = big ? 0.15 : 0.09;
    return trs(out, sx * (big ? 0.22 : 0.42), y + (big ? 0 : 0.03), big ? 1.12 : 0.92, IDQ, r, r, r);
  });
  // Its haze.
  add(sphGeo(), hazeMat(0.07), 1, HOSTILE.neon, (e, _k, t, out) => trs(out, 0, bodyY(e, t), 0, IDQ, 1.9, 0.9, 2.1), false);
}

/* SAPPER — the bomb-carrier. */
function sapper(add: Add, neon: Neon): void {
  const bodyY = (e: Enemy, t: number): number =>
    0.75 + (e.phase === 'bite' ? 0 : Math.abs(Math.sin(e.stride * 18 + t * 0)) * 0.06);
  const beat = (e: Enemy, t: number): number => {
    const rate = e.phase === 'bite' ? 34 : 7;
    return 0.5 + 0.5 * Math.sin(t * rate + e.id);
  };
  add(sphGeo(), bodyMat(), 1, HOSTILE.body, (e, _k, t, out) => trs(out, 0, bodyY(e, t), 0.1, IDQ, 0.95, 0.5, 1.05));
  // THE CHARGE, riding high and blazing.
  add(sphGeo(), neonMat(), 1, HOSTILE.charge, (e, _k, t, out) => {
    const r = 0.52 + beat(e, t) * 0.1;
    return trs(out, 0, bodyY(e, t) + 0.78, -0.15, IDQ, r, r, r);
  });
  add(
    sphGeo(),
    hazeMat(0.22),
    1,
    HOSTILE.charge,
    (e, _k, t, out) => {
      const r = 1.0 + beat(e, t) * 0.55;
      return trs(out, 0, bodyY(e, t) + 0.78, -0.15, IDQ, r, r, r);
    },
    false,
  );
  // Its cage: three magenta ribs round the charge.
  add(torGeo(), neonMat(), 3, HOSTILE.neon, (e, k, t, out) => {
    _q.setFromAxisAngle(UP, (k * Math.PI) / 3 + t * 0.6);
    return trs(out, 0, bodyY(e, t) + 0.78, -0.15, _q, 0.7, 0.7, 0.7);
  });
  // Four stubby legs.
  neon(8, HOSTILE.neon, (e, k, t, out, rk) => {
    const leg = k >> 1;
    const side = leg % 2 === 0 ? -1 : 1;
    const front = leg < 2 ? 1 : -1;
    const y = bodyY(e, t);
    const hip = _a.set(side * 0.6, y, front * 0.45);
    const rest = _b.set(side * 1.3, 0, front * 0.85);
    const foot = step(e, rest, 18, (leg === 0 || leg === 3 ? 0 : 1) * Math.PI, 0.3, 0.3, _k);
    const kn = knee(hip, foot, 0.8, 0.95, _n.set(side, 2, 0), _kn);
    return k % 2 === 0 ? bone(out, hip, kn, 0.075 * rk) : bone(out, kn, foot, 0.065 * rk);
  });
  add(sphGeo(), neonMat(), 2, HOSTILE.eye, (e, k, t, out) =>
    trs(out, k === 0 ? -0.28 : 0.28, bodyY(e, t) + 0.1, 1.0, IDQ, 0.13, 0.13, 0.13),
  );
}

/* GRUB — the centipede. */
const SEGS = 5;
function grub(add: Add, neon: Neon): void {
  /** Segment i's centre: down the body, swaying side to side. */
  const seg = (e: Enemy, i: number, t: number, out: Vector3): Vector3 => {
    const sway = e.phase === 'bite' ? Math.sin(t * 6 - i) * 0.08 : Math.sin(e.stride * 9 - i * 0.95) * 0.32;
    return out.set(sway * (i / (SEGS - 1) + 0.25), 0.62 - i * 0.03, 1.15 - i * 0.62);
  };
  const segR = (i: number): number => 0.62 - i * 0.07;
  add(sphGeo(), bodyMat(), SEGS, HOSTILE.body, (e, k, t, out) => {
    seg(e, k, t, _a);
    const r = segR(k);
    const pulse = 1 + 0.08 * Math.sin(e.stride * 14 - k * 1.4);
    return trs(out, _a.x, _a.y, _a.z, IDQ, r * pulse, r * 0.85, r * 0.9);
  });
  // A hoop round each segment, standing up, facing the way it crawls.
  add(torGeo(), neonMat(), SEGS, HOSTILE.neon, (e, k, t, out) => {
    seg(e, k, t, _a);
    seg(e, Math.min(SEGS - 1, k + 1), t, _b);
    const r = segR(k) * 1.04;
    _q.setFromUnitVectors(_n.set(0, 0, 1), _d.subVectors(_a, _b).normalize());
    return trs(out, _a.x, _a.y, _a.z, _q, r, r * 0.88, r);
  });
  add(
    torGeo(),
    hazeMat(0.2),
    SEGS,
    HOSTILE.neon,
    (e, k, t, out) => {
      seg(e, k, t, _a);
      const r = segR(k) * 1.12;
      return trs(out, _a.x, _a.y, _a.z, IDQ, r, r * 0.9, r * 2.4);
    },
    false,
  );
  // Little legs: a pair under every segment, rippling.
  neon(SEGS * 2, HOSTILE.neon, (e, k, t, out, rk) => {
    const i = k >> 1;
    const side = k % 2 === 0 ? -1 : 1;
    seg(e, i, t, _a);
    const ripple = e.phase === 'bite' ? 0 : Math.sin(e.stride * 26 - i * 1.3 + (side > 0 ? Math.PI : 0)) * 0.22;
    _a.x += side * segR(i) * 0.7;
    _a.y -= 0.2;
    _b.set(_a.x + side * 0.45, 0.02, _a.z + ripple);
    return bone(out, _a, _b, 0.05 * rk);
  });
  // Mandibles, working.
  neon(2, HOSTILE.neon, (e, k, t, out, rk) => {
    seg(e, 0, t, _a);
    const side = k === 0 ? -1 : 1;
    const open = e.phase === 'bite' ? 0.25 + 0.3 * Math.sin(t * 14) : 0.18;
    _a.set(_a.x + side * 0.25, 0.45, _a.z + 0.4);
    _b.set(_a.x + side * open, 0.35, _a.z + 0.55);
    return bone(out, _a, _b, 0.07 * rk);
  });
  add(sphGeo(), neonMat(), 2, HOSTILE.eye, (e, k, t, out) => {
    seg(e, 0, t, _a);
    return trs(out, _a.x + (k === 0 ? -0.22 : 0.22), 0.88, _a.z + 0.38, IDQ, 0.1, 0.1, 0.1);
  });
}

/* BRUTE — the hulk. */
function brute(add: Add, neon: Neon): void {
  const heave = (e: Enemy, t: number): number =>
    e.phase === 'bite' ? Math.sin(t * 5) * 0.12 : Math.abs(Math.sin(e.stride * 7)) * 0.1;
  const torsoY = (e: Enemy, t: number): number => 1.55 + heave(e, t);
  // The torso: a hunched black mass, pitched forward.
  _qa.setFromAxisAngle(new Vector3(1, 0, 0), 0.32);
  const hunch = _qa.clone();
  add(sphGeo(), bodyMat(), 1, HOSTILE.body, (e, _k, t, out) => trs(out, 0, torsoY(e, t), 0, hunch, 1.15, 0.95, 1.05));
  // Three back plates, stepping down the spine.
  add(octGeo(), bodyMat(), 3, 0x15121a, (e, k, t, out) =>
    trs(out, 0, torsoY(e, t) + 0.78 - k * 0.22, -0.15 - k * 0.42, hunch, 0.7 - k * 0.12, 0.28, 0.5),
  );
  // The spine in neon, plate crest to plate crest, and the shoulder line.
  neon(4, HOSTILE.neon, (e, k, t, out, rk) => {
    const y = torsoY(e, t);
    if (k < 2) {
      _a.set(0, y + 1.06 - k * 0.22, -0.15 - k * 0.42);
      _b.set(0, y + 0.84 - k * 0.22, -0.57 - k * 0.42);
    } else {
      const side = k === 2 ? -1 : 1;
      _a.set(0, y + 0.6, 0.45);
      _b.set(side * 1.15, y + 0.45, 0.35);
    }
    return bone(out, _a, _b, 0.06 * rk);
  });
  // THE ARMS: shoulder → elbow → fist, swinging as it walks; slamming
  // when it chews.
  const fist = (e: Enemy, side: number, t: number, out: Vector3): Vector3 => {
    if (e.phase === 'bite') {
      const slam = Math.max(0, Math.sin(t * 5 + (side > 0 ? Math.PI : 0)));
      return out.set(side * 0.75, 0.25 + slam * 1.6, 1.55 - slam * 0.3);
    }
    const swing = Math.sin(e.stride * 7 + (side > 0 ? Math.PI : 0));
    return out.set(side * 1.45, 0.2 + Math.max(0, -swing) * 0.2, 0.85 + swing * 0.55);
  };
  /** Shoulder, elbow, fist for one arm, into _a, _kn, _b. */
  const arm = (e: Enemy, side: number, t: number): void => {
    _a.set(side * 1.15, torsoY(e, t) + 0.4, 0.35);
    fist(e, side, t, _b);
    knee(_a, _b, 1.15, 1.2, _n.set(side * 1.5, 0.2, -1), _kn);
  };
  add(cylGeo(), bodyMat(), 4, HOSTILE.body, (e, k, t, out) => {
    arm(e, k < 2 ? -1 : 1, t);
    return k % 2 === 0 ? bone(out, _a, _kn, 0.3) : bone(out, _kn, _b, 0.26);
  });
  // …each arm traced down its outside edge in neon.
  neon(4, HOSTILE.neon, (e, k, t, out, rk) => {
    const side = k < 2 ? -1 : 1;
    arm(e, side, t);
    _a.x += side * 0.22;
    _kn.x += side * 0.25;
    _b.x += side * 0.2;
    _a.y += 0.12;
    _kn.y += 0.12;
    _b.y += 0.15;
    return k % 2 === 0 ? bone(out, _a, _kn, 0.06 * rk) : bone(out, _kn, _b, 0.06 * rk);
  });
  // Neon knuckles and elbows.
  add(torGeo(), neonMat(), 2, HOSTILE.neon, (e, k, t, out) => {
    const side = k === 0 ? -1 : 1;
    fist(e, side, t, _b);
    return trs(out, _b.x, _b.y + 0.12, _b.z, IDQ, 0.38, 0.38, 0.38);
  });
  add(sphGeo(), bodyMat(), 2, HOSTILE.body, (e, k, t, out) => {
    fist(e, k === 0 ? -1 : 1, t, _b);
    return trs(out, _b.x, _b.y + 0.12, _b.z, IDQ, 0.36, 0.32, 0.36);
  });
  // Four short, thick hind legs, each with a neon shin.
  const hind = (e: Enemy, leg: number, t: number): void => {
    const side = leg % 2 === 0 ? -1 : 1;
    const back = leg < 2 ? -0.25 : -0.85;
    _a.set(side * 0.65, torsoY(e, t) - 0.55, back);
    const rest = _p.set(side * 1.0, 0, back - 0.1);
    step(e, rest, 7, (leg === 0 || leg === 3 ? 0 : 1) * Math.PI, 0.35, 0.25, _b);
    knee(_a, _b, 0.65, 0.75, _n.set(0, 0.6, 1), _kn);
  };
  add(cylGeo(), bodyMat(), 8, HOSTILE.body, (e, k, t, out) => {
    hind(e, k >> 1, t);
    return k % 2 === 0 ? bone(out, _a, _kn, 0.24) : bone(out, _kn, _b, 0.2);
  });
  neon(4, HOSTILE.neon, (e, k, t, out, rk) => {
    hind(e, k, t);
    _kn.z += 0.22;
    _b.z += 0.2;
    return bone(out, _kn, _b, 0.055 * rk);
  });
  // THE EYE: one wide white slit.
  add(cylGeo(), neonMat(), 1, HOSTILE.eye, (e, _k, t, out) => {
    _q.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
    return trs(out, 0, torsoY(e, t) + 0.3, 1.16, _q, 0.09, 0.95, 0.09);
  });
  add(
    sphGeo(),
    hazeMat(0.35),
    1,
    HOSTILE.eye,
    (e, _k, t, out) => trs(out, 0, torsoY(e, t) + 0.3, 1.14, IDQ, 0.75, 0.22, 0.12),
    false,
  );
  add(sphGeo(), hazeMat(0.045), 1, HOSTILE.neon, (e, _k, t, out) =>
    trs(out, 0, torsoY(e, t), 0.1, IDQ, 1.7, 1.4, 1.6),
  false);
}
