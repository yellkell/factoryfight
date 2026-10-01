/**
 * The wall model — what the room scan becomes once the game can use it.
 *
 * WallSystem harvests WebXR planes (or builds the fallback room) into this
 * registry: each wall is a centre, a normal pointing INTO the room, a
 * right/up tangent basis, and half-extents. Everything downstream — the
 * placement reticle, the socket picker, the mount poses — reads walls
 * through here and never touches a raw XRPlane again.
 *
 * The maths lives in pure functions on purpose: the socket picker is the
 * one piece of the game that decides layout, so it has to be replayable
 * (seeded rng in, same answer out) and reasoned about away from a headset.
 *
 * "Wall" is the registry's word for any mountable room surface — the
 * scan's floor and ceiling live here too, carrying a `kind`, because an
 * exit port that wakes OVER your head plays by exactly the same rules as
 * one across the room. Only the hand-placed half of a run (the flange)
 * is wall-kind-only; that filter lives with the reticle, not here.
 */

import { Matrix4, Quaternion, Vector3 } from 'three';
import { PORTS, RUN_RANGE, WALLS } from '../config.js';
import { mulberry32 } from '../game/rng.js';
import type { StageRect } from './stage.js';

export type SurfaceKind = 'wall' | 'floor' | 'ceiling';

export interface Wall {
  id: number;
  kind: SurfaceKind;
  /** World centre of the face. */
  center: Vector3;
  /** Unit normal, INTO the room (the side hardware mounts on). */
  normal: Vector3;
  /** Unit tangents: `right` runs the wall's width, `up` climbs it
   *  (always tilted toward world up). */
  right: Vector3;
  up: Vector3;
  halfW: number;
  halfH: number;
  /** Scanned geometry, or the fallback room's stand-in. */
  real: boolean;
}

/** A spot on a wall, with everything a piece of hardware needs to mount. */
export interface WallSpot {
  wall: Wall;
  point: Vector3;
  normal: Vector3;
}

const _v = new Vector3();
const _w = new Vector3();

/** A wall big enough to bolt hardware to. */
export function usable(w: Wall): boolean {
  return (
    4 * w.halfW * w.halfH >= WALLS.minArea &&
    w.halfW > WALLS.edgeInset + 0.05 &&
    w.halfH > 0.2
  );
}

/** The wall-local (u, v) band hardware may occupy: u along `right`, v along
 *  `up`, both in metres from centre — edge-inset on all sides, and (on
 *  walls) v further clamped so the point's world HEIGHT stays in the
 *  reach band. Floors and ceilings have no height to clamp: anywhere on
 *  the face clear of the edges is fair. */
export function mountBand(w: Wall): { u: number; vLo: number; vHi: number } | null {
  const u = w.halfW - WALLS.edgeInset;
  let vLo = -w.halfH + WALLS.edgeInset;
  let vHi = w.halfH - WALLS.edgeInset;
  if (w.kind !== 'wall') {
    if (u <= 0.05 || vHi - vLo < 0.1) return null;
    return { u, vLo, vHi };
  }
  // World height along `up` (up.y is ~1 for real walls, exactly 1 for
  // fallback ones): clamp v so centreY + v·up.y lands inside the band.
  const upY = Math.max(0.35, w.up.y);
  vLo = Math.max(vLo, (WALLS.minHeight - w.center.y) / upY);
  vHi = Math.min(vHi, (WALLS.maxHeight - w.center.y) / upY);
  if (u <= 0.05 || vHi - vLo < 0.1) return null;
  return { u, vLo, vHi };
}

/** Wall-local (u, v) → world point on the face. */
export function pointOn(w: Wall, u: number, v: number, out = new Vector3()): Vector3 {
  return out.copy(w.center).addScaledVector(w.right, u).addScaledVector(w.up, v);
}

/** Clamp a world point (assumed near the face) into the mount band. */
export function clampToBand(w: Wall, point: Vector3, out = new Vector3()): Vector3 | null {
  const band = mountBand(w);
  if (!band) return null;
  _v.copy(point).sub(w.center);
  const u = Math.max(-band.u, Math.min(band.u, _v.dot(w.right)));
  const v = Math.max(band.vLo, Math.min(band.vHi, _v.dot(w.up)));
  return pointOn(w, u, v, out);
}

/** The orientation a piece of wall hardware wears: local +Z is the
 *  room-facing normal, +Y climbs the face — so "forward" is out of the
 *  wall and every flange stands upright on it. */
export function mountQuaternion(w: Wall, out = new Quaternion()): Quaternion {
  return out.setFromRotationMatrix(_basis.makeBasis(w.right, w.up, w.normal));
}

const _basis = new Matrix4();

/**
 * THE ANSWER FROM THE WALLS — where the socket wakes for a fresh mount.
 *
 * Sampled, filtered, scored — in two lanes. A seeded roll (PORTS.
 * flatChance) sometimes sends the answer OVERHEAD OR UNDERFOOT: the
 * floor and ceiling get their own lane because the seat's alignment
 * cone caps flat runs short by geometry, and on a distance-flavoured
 * score short spots never outbid a wall — a lane, not a bias, is how
 * "sometimes the ceiling answers" actually happens. Every candidate,
 * whatever its surface, is kept only if it sits inside the FITTER'S OWN
 * REACH, if the straight run from the mount lands inside RUN_RANGE, and
 * if it arrives inside the seat's alignment cone — every pick the room
 * makes is a pick the magnet can take AND the hands can get to, by
 * construction. Scoring within a lane: long-haul jobs want the farthest
 * honest spot, ordinary jobs a middle-distance one, every job prefers a
 * spot the flange roughly faces, and a seeded jitter keeps reruns fresh
 * while a tool's fixed seed replays exactly. A floor port never wakes
 * under the player.
 *
 * Returns null only when no other surface offers a legal spot — the
 * caller falls back to sharing the mount wall (a same-wall run is legal
 * when the room gives us nothing better).
 */
export function pickSocket(
  allWalls: Wall[],
  mountWall: number,
  mountPoint: Vector3,
  mountNormal: Vector3,
  seed: number,
  longHaul: boolean,
  fitter?: { x: number; z: number; reachY: number },
): WallSpot | null {
  const rng = mulberry32(seed);
  const spots: Array<{ spot: WallSpot; score: number }> = [];
  const flatSpots: Array<{ spot: WallSpot; score: number }> = [];
  // Roll the overhead lane FIRST so the draw count stays seed-stable.
  const tryFlat = rng() < PORTS.flatChance;

  const consider = (w: Wall, samples: number, into = spots): void => {
    const band = mountBand(w);
    if (!band) return;
    for (let i = 0; i < samples; i++) {
      const u = (rng() * 2 - 1) * band.u;
      const v = band.vLo + rng() * (band.vHi - band.vLo);
      const p = pointOn(w, u, v, new Vector3());
      // THE REACH LAW: nothing wakes above the hands. A wall's band is
      // already clamped to working height; a CEILING had no clamp at
      // all, so a socket could iris awake at 2.7 m — knocked for,
      // lit, aimed at, and impossible to carry a collar to. A port the
      // fitter cannot reach is a job that cannot be finished, so it is
      // not a port (PORTS.overheadReach).
      if (fitter && p.y > fitter.reachY) continue;
      // Not under the fitter's own feet.
      if (
        w.kind === 'floor' &&
        fitter &&
        (p.x - fitter.x) ** 2 + (p.z - fitter.z) ** 2 < PORTS.floorAvoidRadius ** 2
      ) {
        continue;
      }
      const dist = _w.copy(p).sub(mountPoint).length();
      if (dist < RUN_RANGE.min || dist > RUN_RANGE.max) continue;
      _w.normalize();
      // In front of the mount's face (never behind its own wall)…
      const facing = _w.dot(mountNormal);
      if (facing < 0.05) continue;
      // …and arriving inside the seat's alignment cone, with margin —
      // the same dot the magnet gates on (SEAT.alignDot = 0.35), tested
      // here against the ACTUAL chord. Anything shallower could be
      // touched but never latched: a spot high on the ceiling far across
      // the room, a socket hugging the mount wall's own corner. The old
      // 0.05 "must see each other" check let those through.
      if (_v.copy(mountPoint).sub(p).normalize().dot(w.normal) < 0.42) continue;
      const span = RUN_RANGE.max - RUN_RANGE.min;
      const reach = (dist - RUN_RANGE.min) / span;
      const score =
        (longHaul ? reach : 1 - Math.abs(reach - 0.45) * 1.6) + facing * 0.35 + rng() * 0.18;
      into.push({ spot: { wall: w, point: p, normal: w.normal.clone() }, score });
    }
  };

  for (const w of allWalls) {
    if (w.id === mountWall || !usable(w)) continue;
    if (w.kind === 'wall') consider(w, 14);
    else consider(w, PORTS.horizontalSamples, flatSpots);
  }
  // The rolled lane wins when it can; the walls answer whenever it
  // can't (and carry every roll that didn't ask for the ceiling).
  const lane = tryFlat && flatSpots.length ? flatSpots : spots.length ? spots : flatSpots;
  if (lane.length === 0) {
    // The room gave us nothing across the way — offer the mount's own
    // wall (far end of it) rather than refusing the job.
    const own = allWalls.find((w) => w.id === mountWall);
    if (own) consider(own, 20);
    if (spots.length === 0) return null;
    spots.sort((a, b) => b.score - a.score);
    return spots[0].spot;
  }
  lane.sort((a, b) => b.score - a.score);
  return lane[0].spot;
}

/**
 * A BOX ROOM — four walls, a floor and a ceiling round a rectangle of
 * floor. `fwd` and `side` are the box's plan axes (unit, horizontal):
 * `halfW` runs along `side`, `halfD` along `fwd`; the walls stand from
 * `floorY` to `ceilY`. Synthetic surfaces are honest registry citizens:
 * everything downstream works identically, it just can't see the
 * plaster. Both stand-in rooms are built here.
 */
function boxRoom(
  centerX: number,
  centerZ: number,
  fwd: Vector3,
  side: Vector3,
  halfW: number,
  halfD: number,
  floorY: number,
  ceilY: number,
  firstId: number,
): Wall[] {
  const up = new Vector3(0, 1, 0);
  const midY = (floorY + ceilY) / 2;
  const halfH = (ceilY - floorY) / 2;
  const make = (offset: Vector3, normal: Vector3, hw: number, id: number): Wall => {
    const center = new Vector3(centerX, midY, centerZ).add(offset);
    const right = new Vector3().crossVectors(up, normal).normalize();
    return {
      id,
      kind: 'wall',
      center,
      normal: normal.clone().normalize(),
      right,
      up: up.clone(),
      halfW: hw,
      halfH,
      real: false,
    };
  };
  // Floor and ceiling: flat surfaces with room-axis tangents (`up` runs
  // the room's depth — a name that only means "the second tangent" off a
  // wall, same as it does for the scan's horizontal planes).
  const flat = (y: number, normal: Vector3, id: number, kind: SurfaceKind): Wall => ({
    id,
    kind,
    center: new Vector3(centerX, y, centerZ),
    normal: normal.clone(),
    // Derived, not assigned: right = up × normal keeps the basis
    // right-handed for BOTH flats (the ceiling's flipped normal flips
    // its right with it, and mountQuaternion stays a pure rotation).
    right: new Vector3().crossVectors(fwd, normal).normalize(),
    up: fwd.clone(),
    halfW,
    halfH: halfD,
    real: false,
  });
  return [
    make(fwd.clone().multiplyScalar(halfD), fwd.clone().negate(), halfW, firstId),
    make(fwd.clone().multiplyScalar(-halfD), fwd.clone(), halfW, firstId + 1),
    make(side.clone().multiplyScalar(halfW), side.clone().negate(), halfD, firstId + 2),
    make(side.clone().multiplyScalar(-halfW), side.clone(), halfD, firstId + 3),
    flat(floorY, new Vector3(0, 1, 0), firstId + 4, 'floor'),
    flat(ceilY, new Vector3(0, -1, 0), firstId + 5, 'ceiling'),
  ];
}

/**
 * The fallback room — four synthetic walls plus a floor and a ceiling
 * around the player, aligned to their facing, when no scan answers
 * (desktop emulator, a headset without room setup).
 */
export function buildFallbackRoom(
  centerX: number,
  centerZ: number,
  yaw: number,
  nextId: number,
): Wall[] {
  const { w, d, h } = WALLS.fallback;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const fwd = new Vector3(-sin, 0, -cos); // yaw 0 faces −Z
  const side = new Vector3(cos, 0, -sin);
  return boxRoom(centerX, centerZ, fwd, side, w / 2, d / 2, 0, h, nextId);
}

/**
 * THE STAGE ROOM — the headset's room-scale box as a room: four faces
 * standing on the box's edges (world-axis aligned, as the box is), the
 * floor and the ceiling trimmed to it, at the heights the scan lends
 * (room/stage.ts for where the box comes from; WallSystem for when it
 * takes the registry).
 */
export function buildStageRoom(rect: StageRect, floorY: number, ceilY: number, firstId: number): Wall[] {
  return boxRoom(
    (rect.minX + rect.maxX) / 2,
    (rect.minZ + rect.maxZ) / 2,
    new Vector3(0, 0, -1),
    new Vector3(1, 0, 0),
    (rect.maxX - rect.minX) / 2,
    (rect.maxZ - rect.minZ) / 2,
    floorY,
    ceilY,
    firstId,
  );
}
