/**
 * Telescoping tube maths — pure functions, no scene graph.
 *
 * A run's tube is modelled as a gentle CUBIC bezier from the flange MOUTH
 * to the HEAD, wherever the hands or the seat have put it. The start
 * control reaches out along the mount wall's normal — pipe does not exit
 * plaster sideways — and the end control reaches back along whatever the
 * head answers to: the straight run while it's carried, the SOCKET'S
 * normal once the magnet has it, so a seating tube sweeps in and meets
 * the far wall square, the way pipework does and rope doesn't.
 *
 * Along that path ride N nested segments, root fattest, filling
 * ROOT-FIRST: pull, and the fat section comes out of the wall until it
 * hits its stop, then the next, thinner one emerges from inside it, and
 * so on toward the head — the classic telescope, which is why each new
 * section's arrival is a moment the hands get told about (TubeSystem
 * turns span crossings into clanks).
 *
 * The bend is cosmetic flex, not rope physics: eight rigid segments
 * approximate the curve more than well enough at the reach involved, and
 * the polyline of slightly-angled collars IS the look — heavy plant that
 * gives a few degrees at each joint.
 */

import { Vector3 } from 'three';
import { TUBE } from '../config.js';

export interface TubeSegment {
  /** Arc-length span along the run (m from the mouth). */
  s0: number;
  s1: number;
  /** Nesting index, 0 = root (fattest). */
  index: number;
  radius: number;
}

/** Per-segment radius: a straight taper root → head. */
export function segmentRadius(index: number, segments = TUBE.segments): number {
  const t = segments <= 1 ? 0 : index / (segments - 1);
  return TUBE.rootRadius + (TUBE.headRadius - TUBE.rootRadius) * t;
}

/** Each nested section's own maximum travel. */
export function segmentMax(maxLength: number, segments = TUBE.segments): number {
  return maxLength / segments;
}

/**
 * ROOT-FIRST fill: at extension `ext`, section i shows
 * clamp(ext − i·segMax, 0, segMax) of itself. Sections that haven't
 * emerged yet are absent from the result (nested inside, invisible).
 */
export function segmentSpans(
  ext: number,
  maxLength: number,
  segments = TUBE.segments,
): TubeSegment[] {
  const segMax = segmentMax(maxLength, segments);
  const spans: TubeSegment[] = [];
  for (let i = 0; i < segments; i++) {
    const len = Math.max(0, Math.min(segMax, ext - i * segMax));
    if (len < 0.012) break; // nothing after the first hidden one either
    spans.push({ s0: i * segMax, s1: i * segMax + len, index: i, radius: segmentRadius(i, segments) });
  }
  return spans;
}

/** How many sections are out at this extension — TubeSystem clanks when
 *  the count rises and the detent ratchet ticks between arrivals. */
export function sectionsOut(ext: number, maxLength: number, segments = TUBE.segments): number {
  return segmentSpans(ext, maxLength, segments).length;
}

/** The control reach at either end: further the longer the tube, clamped
 *  so a short stub stays straight and a long haul doesn't balloon. */
export function controlReach(ext: number): number {
  return Math.min(TUBE.bendReachMax, Math.max(TUBE.stubLength * 0.75, ext * TUBE.bendReach));
}

/** The start control: out of the mount wall along its normal. */
export function bendControl(
  mouth: Vector3,
  normal: Vector3,
  ext: number,
  out = new Vector3(),
): Vector3 {
  return out.copy(mouth).addScaledVector(normal, controlReach(ext));
}

/** The end control: back from the head along `entryDir` — the direction
 *  the head is ARRIVING from (the socket's normal once the magnet has
 *  it; the hands' steer while carried; the straight run when parked,
 *  which degenerates the cubic toward a quadratic and keeps one code
 *  path for all three). `reachScale` lets the steer reach further, so
 *  the bow the wrists ask for is a bow the eye can see. */
export function endControl(
  head: Vector3,
  entryDir: Vector3,
  ext: number,
  out = new Vector3(),
  reachScale = 1,
): Vector3 {
  return out.copy(head).addScaledVector(entryDir, controlReach(ext) * 0.8 * reachScale);
}

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();

/** Cubic bezier point (t in 0..1). */
export function pathPoint(
  p0: Vector3,
  p1: Vector3,
  p2: Vector3,
  p3: Vector3,
  t: number,
  out = new Vector3(),
): Vector3 {
  const u = 1 - t;
  _a.copy(p0).multiplyScalar(u * u * u);
  _b.copy(p1).multiplyScalar(3 * u * u * t);
  _c.copy(p2).multiplyScalar(3 * u * t * t);
  out.copy(p3).multiplyScalar(t * t * t).add(_a).add(_b).add(_c);
  return out;
}

/** Cubic bezier VELOCITY at t — the raw derivative, unnormalised, so a
 *  caller can add its own displacement's slope before taking a heading. */
export function pathVelocity(
  p0: Vector3,
  p1: Vector3,
  p2: Vector3,
  p3: Vector3,
  t: number,
  out = new Vector3(),
): Vector3 {
  const u = 1 - t;
  _a.copy(p1).sub(p0).multiplyScalar(3 * u * u);
  _b.copy(p2).sub(p1).multiplyScalar(6 * u * t);
  _c.copy(p3).sub(p2).multiplyScalar(3 * t * t);
  return out.copy(_a).add(_b).add(_c);
}

/** Cubic bezier tangent (normalised out). */
export function pathTangent(
  p0: Vector3,
  p1: Vector3,
  p2: Vector3,
  p3: Vector3,
  t: number,
  out = new Vector3(),
): Vector3 {
  pathVelocity(p0, p1, p2, p3, t, out);
  // Degenerate (head on a control point): fall back to the chord.
  if (out.lengthSq() < 1e-8) out.copy(p3).sub(p0);
  return out.normalize();
}

/**
 * THE DODGE BUMP — how a seated run gets out of the way without letting
 * go of either END'S AXIS.
 *
 * The clearance pass used to shove the bezier's two control points, the
 * only lever a cubic offers — but those controls ARE the end tangents,
 * so every lift tipped the tube off the spout's boss line at the mouth
 * and off the gland's axis at the seat. Measured at 52 degrees into a
 * maker's collar: a pipe stabbing PAST its own socket into the drum,
 * which is what the headset kept photographing.
 *
 * So the offset moves the CURVE, not the controls: a displacement that
 * is zero, and has zero SLOPE, at t=0 and t=1, spending the whole lift
 * in between. Both fittings keep their axes exactly — flush at the
 * boss, flush at the gland — and the run bows over the shop between
 * them, which is what pipework does anyway.
 *
 * AND IT IS WINDOWED. Zero slope at the very end was not enough: the
 * hump still rose through the last section, so a tall lift put the
 * section IN the socket 20–40° off the socket's axis — the polyline law
 * kept every joint sealed and the pipe still read as having jumped out
 * of its seat. The bump is now dead flat for TUBE.dodgeEnd of the run
 * at each end (one section of eight): whatever the lift, the section
 * that sits in a fitting lies along that fitting's axis.
 */
export function dodgeBump(t: number): number {
  const e = TUBE.dodgeEnd;
  const u = (t - e) / (1 - 2 * e);
  if (u <= 0 || u >= 1) return 0;
  const w = 4 * u * (1 - u);
  return w * w;
}

/** d/dt of dodgeBump. Zero at both ends (and across both end windows)
 *  by construction, so a displaced run's end tangents are exactly its
 *  bezier's own. */
export function dodgeBumpSlope(t: number): number {
  const e = TUBE.dodgeEnd;
  const u = (t - e) / (1 - 2 * e);
  if (u <= 0 || u >= 1) return 0;
  return (32 * u * (1 - u) * (1 - 2 * u)) / (1 - 2 * e);
}

/**
 * A seated run's straight-line length — what the flow front races along,
 * and the extension the tube settles at once latched. (The bezier's true
 * arc is a hair longer than the chord; at our bend levels the difference
 * is invisible and the CHORD is the honest gameplay number: how far the
 * two walls actually are apart.)
 */
export function runLength(mouth: Vector3, seat: Vector3): number {
  return _a.copy(seat).sub(mouth).length();
}

/** The tube's ceiling for a given run: enough to cross plus slack. */
export function maxExtensionFor(runDistance: number): number {
  return Math.min(TUBE.maxLength, runDistance + TUBE.slack);
}
