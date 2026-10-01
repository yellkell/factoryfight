/**
 * THE CLEARANCE PASS, shared — how seated runs get out of each other's
 * way, in the room and on the shop floor alike.
 *
 * A seated run is a frozen curve, and nothing used to stop two of them
 * passing straight through each other: the factory grew a clearance
 * pass (FactorySystem.recomputeDodges) and the wall game never did, so
 * HOT AND COLD and FULL PRESSURE ran their lines through one another.
 * The pair half of that pass lives here now and both systems drive it.
 *
 * The move is always the same: a run BOWS, carrying an offset that
 * geometry.dodgeBump tapers to nothing (value AND slope, and flat
 * across the whole end window) at both fittings, so the ends keep
 * their axes and the polyline law keeps every joint sealed through the
 * new bend. Everything that draws, solves or audits a run comes through
 * dodgedPoint / dodgedTangent, so the three can never disagree about
 * where the tube is.
 *
 * And the lift is EASED, never snapped: a system keeps the SOLVED
 * offset apart from the DRAWN one and walks the drawn one toward it at
 * TUBE.dodgeEase — so a new line seating, a box landing under a run, or
 * a collar being tugged loose bows the tube over half a second instead
 * of popping it, which read as the pipe jumping out of its seat.
 */

import { Vector3 } from 'three';
import { TUBE } from '../config.js';
import { dodgeBump, dodgeBumpSlope, pathPoint, pathVelocity } from './geometry.js';

/** A SEATED RUN'S LINE, dodge and all: the bezier point at t plus the
 *  clearance bump. */
export function dodgedPoint(
  p0: Vector3,
  p1: Vector3,
  p2: Vector3,
  p3: Vector3,
  lift: Vector3 | undefined,
  t: number,
  out: Vector3,
): Vector3 {
  pathPoint(p0, p1, p2, p3, t, out);
  if (lift) out.addScaledVector(lift, dodgeBump(t));
  return out;
}

/** …and its heading: the bezier's velocity plus the bump's own slope.
 *  Across both end windows the bump contributes nothing, so the tube
 *  leaves its boss and lands in its socket dead on axis however hard it
 *  dodges. */
export function dodgedTangent(
  p0: Vector3,
  p1: Vector3,
  p2: Vector3,
  p3: Vector3,
  lift: Vector3 | undefined,
  t: number,
  out: Vector3,
): Vector3 {
  pathVelocity(p0, p1, p2, p3, t, out);
  if (lift) out.addScaledVector(lift, dodgeBumpSlope(t));
  if (out.lengthSq() < 1e-8) out.copy(p3).sub(p0);
  return out.normalize();
}

const _d1 = new Vector3();
const _d2 = new Vector3();
const _r12 = new Vector3();
/** Where the last segSegDist found its two closest points. */
export const closestA = new Vector3();
export const closestB = new Vector3();

/** Closest distance between segments [a1,a2] and [b1,b2] — the exact
 *  clamped closest-point-of-approach, because the clearance pass got
 *  burnt measuring POINT samples: a perpendicular crossing's true
 *  closest approach falls between samples, and a pair that "cleared"
 *  on paper still clipped on screen. Leaves the two closest points in
 *  closestA / closestB. */
export function segSegDist(a1: Vector3, a2: Vector3, b1: Vector3, b2: Vector3): number {
  _d1.copy(a2).sub(a1);
  _d2.copy(b2).sub(b1);
  _r12.copy(a1).sub(b1);
  const a = _d1.dot(_d1);
  const e = _d2.dot(_d2);
  const f = _d2.dot(_r12);
  let s = 0;
  let t = 0;
  if (a <= 1e-9 && e <= 1e-9) {
    closestA.copy(a1);
    closestB.copy(b1);
    return _r12.length();
  }
  if (a <= 1e-9) {
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = _d1.dot(_r12);
    if (e <= 1e-9) {
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = _d1.dot(_d2);
      const denom = a * e - b * b;
      s = denom > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  closestA.copy(a1).addScaledVector(_d1, s);
  closestB.copy(b1).addScaledVector(_d2, t);
  return closestA.distanceTo(closestB);
}

/** Two bores and some air: how close two seated centrelines may come
 *  on the shop floor, where headroom is spent on plant too. */
export const CLEAR_BORE = TUBE.rootRadius * 2 + 0.05;
/** In the room there is nothing else to clear, so the lines take real
 *  daylight: two bores and a hand's width, or a crossing that clears on
 *  paper still reads as two pipes touching. */
export const CLEAR_ROOM = TUBE.rootRadius * 2 + 0.16;

/** How many centreline samples the pass works from — fine enough that
 *  the exact segment distances between them catch every crossing. */
export const DODGE_SAMPLES = 26;

/** Below this much leverage (dodgeBump at the clash — under 0.2 means
 *  the first or last quarter of the run) a sample is inside a fitting's
 *  own corridor: the bump can barely move it, and asking it to buys a
 *  cap-height arc for nothing. A clash there is the OTHER run's to
 *  clear if it has the leverage, and otherwise the fittings' business
 *  (two neighbouring sockets put their pipes side by side; no lift can
 *  separate them and none should try). */
export const LEVERAGE_FLOOR = 0.2;

/** One run as the pair pass sees it. */
export interface DodgeItem {
  /** Fill `out` with the run's centreline under `lift`, mouth → head. */
  sample(lift: Vector3 | undefined, out: Vector3[]): void;
  /** The offset being solved — mutated in place, only ever grown. */
  lift: Vector3;
  /** Caps on the offset's vertical part: how far it may rise, and how
   *  far it may DIP (0 where the floor below is plant, as in the shop;
   *  the room's open floor lets a lower line duck under instead). */
  maxUp: number;
  maxDown: number;
}

const _push = new Vector3();
const _pushKeep = new Vector3();

/**
 * THE PAIR SWEEP — a global RELAXATION, not a pecking order. Each round
 * finds the worst remaining pair clash (exact SEGMENT distances) and
 * moves whichever run clears it CHEAPEST: the higher of a stacked pair
 * (raising the lower one only closes the gap), or on a level crossing
 * whoever has better bump leverage at the clash. Then everything is
 * re-checked, because one move can cure or cause another pair's clash.
 * A run with no leverage at the clash, or already at its cap in the
 * direction the push wants, hands the job to the other; if neither can
 * move, the clash is left to the fittings.
 *
 * The push runs straight down the line between the two closest points,
 * FROM the other run TOWARD the picked one — never downward unless the
 * run is allowed to dip, and straight up when the pair is coincident.
 * Lifting only ever grows the offset, so a caller's own plant sweep is
 * never undone; the vertical caps are the caller's, and the lateral
 * part stays a modest sidestep of `maxSide`.
 */
export function relaxPairs(
  items: DodgeItem[],
  bufA: Vector3[],
  bufB: Vector3[],
  clear = CLEAR_BORE,
  maxSide = 0.8,
  rounds = 8,
): void {
  for (let round = 0; round < rounds; round++) {
    let need = 0;
    let who: DodgeItem | null = null;
    let leverage = 1;
    for (let j = 1; j < items.length; j++) {
      items[j].sample(items[j].lift, bufB);
      for (let i = 0; i < j; i++) {
        items[i].sample(items[i].lift, bufA);
        const nA = bufA.length;
        const nB = bufB.length;
        for (let a = 1; a < nA - 2; a++) {
          const tA = (a + 0.5) / (nA - 1);
          const wA = dodgeBump(tA);
          for (let b = 1; b < nB - 2; b++) {
            const d = segSegDist(bufA[a], bufA[a + 1], bufB[b], bufB[b + 1]);
            if (clear - d <= need) continue;
            const tB = (b + 0.5) / (nB - 1);
            const wB = dodgeBump(tB);
            if (wA < LEVERAGE_FLOOR && wB < LEVERAGE_FLOOR) continue;
            const A = items[i];
            const B = items[j];
            const yA = (bufA[a].y + bufA[a + 1].y) / 2;
            const yB = (bufB[b].y + bufB[b + 1].y) / 2;
            let pickA: boolean;
            if (yA - yB > 0.03) pickA = true;
            else if (yB - yA > 0.03) pickA = false;
            else pickA = wA >= wB;
            // The push each candidate would take, and whether it can.
            const can = (mine: DodgeItem, w: number, cMine: Vector3, cOther: Vector3): boolean => {
              if (w < LEVERAGE_FLOOR) return false;
              _push.copy(cMine).sub(cOther);
              if (mine.maxDown <= 0 && _push.y < 0) _push.y = 0;
              if (_push.lengthSq() < 1e-6) _push.set(0, 1, 0);
              _push.normalize();
              if (_push.y > 0 && mine.lift.y >= mine.maxUp - 1e-4) return false;
              if (_push.y < 0 && mine.lift.y <= -mine.maxDown + 1e-4) return false;
              return true;
            };
            let chosen: DodgeItem | null = null;
            let w = 1;
            if (pickA && can(A, wA, closestA, closestB)) {
              chosen = A;
              w = wA;
            } else if (!pickA && can(B, wB, closestB, closestA)) {
              chosen = B;
              w = wB;
            } else if (pickA && can(B, wB, closestB, closestA)) {
              chosen = B;
              w = wB;
            } else if (!pickA && can(A, wA, closestA, closestB)) {
              chosen = A;
              w = wA;
            }
            if (!chosen) continue;
            need = clear - d;
            who = chosen;
            leverage = w;
            // `can` left the winning push direction in _push.
            _pushKeep.copy(_push);
          }
        }
      }
    }
    if (!who || need < 0.005) break;
    const v = who.lift;
    // Leverage is EXACT: an offset v moves the line at t by v·dodgeBump(t),
    // so that is the divisor (floored, so a clash out near a window edge
    // can't ask for an infinite lift).
    v.addScaledVector(_pushKeep, need / Math.max(LEVERAGE_FLOOR, leverage));
    v.y = Math.min(who.maxUp, Math.max(-who.maxDown, v.y));
    const hor = Math.hypot(v.x, v.z);
    if (hor > maxSide) {
      v.x *= maxSide / hor;
      v.z *= maxSide / hor;
    }
  }
}

/** Walk a drawn offset toward its solved one. Returns true while it is
 *  still moving, so a caller can stop paying for a settled run. */
export function easeLift(shown: Vector3, target: Vector3 | undefined, delta: number): boolean {
  const k = 1 - Math.exp(-delta * TUBE.dodgeEase);
  if (target) shown.lerp(target, k);
  else shown.multiplyScalar(1 - k);
  if (target ? shown.distanceToSquared(target) < 1e-8 : shown.lengthSq() < 1e-8) {
    if (target) shown.copy(target);
    else shown.set(0, 0, 0);
    return false;
  }
  return true;
}
