/**
 * THE FLOOR PLAN — where the hazard tape stands in YOUR room.
 *
 * A straight port of SLUGFEST's ring layout (goopboxing2
 * `arena/ringLayout.ts`), wearing site clothing: the boxing ropes became
 * barricade tape, but the law is identical. The rectangle is four
 * independent sides you drag out to your real walls, one side at a time,
 * saved per headset. Clamps keep the floor a floor (FLOOR.minWidth /
 * minDepth), inside a sane reach (FLOOR.maxSide) — and, new here, OUTSIDE
 * standing plant: a side refuses to cross a placed crate, so re-planning
 * the boundary can never orphan a machine.
 *
 * Frame: world x/z (the player spawns at the origin facing −Z). Sides:
 *   left  = the −X tape's x   (negative-ish)
 *   right = the +X tape's x   (positive-ish)
 *   near  = the tape BEHIND ME at spawn (+Z)
 *   far   = the tape ACROSS THE ROOM (−Z)
 *
 * The default rectangle is the headset's own room-scale box when it has
 * one (room/stage.ts — the boundary you already drew), else the wall
 * registry (the scan's walls, inset) so the tape STARTS at your walls
 * and you drag it inward; with neither yet, a starter floor stands
 * around the player. A saved layout beats all three — unless a box is
 * known and the save lies outside it (a floor from another room, or
 * from before the boundary was drawn): the box you walk is the floor.
 */

import { FLOOR } from '../config.js';
import type { StageRect } from '../room/stage.js';
import type { Wall } from '../room/walls.js';

export type FloorSide = 'left' | 'right' | 'near' | 'far';
export const FLOOR_SIDES: readonly FloorSide[] = ['left', 'right', 'near', 'far'];

export interface FloorLayout {
  left: number;
  right: number;
  near: number;
  far: number;
}

const STORE_KEY = 'ffight-floor-v1';

/** The live layout singleton — read by the tape rig and the grid,
 *  written by the adjuster. */
export const floorLayout: FloorLayout = { left: -1.8, right: 1.8, near: 1.4, far: -1.4 };

/** Adjust-mode state — bumped `dirty` re-lays the tape. */
export const floorAdjust = {
  /** The layout has been dealt (from storage, the walls, or the
   *  fallback) — nothing draws or clamps before this. */
  initialized: false,
  /** Where the standing layout came from: a headset save, the stage
   *  box, or the room (walls / the starter floor). A box arriving late
   *  re-deals a 'room' floor, and a 'save' that lies outside the box —
   *  never a 'stage' floor, never one you set yourself inside the box. */
  source: 'none' as 'none' | 'save' | 'stage' | 'room',
  /** The side currently held (one at a time — that's the law). */
  grabbed: null as FloorSide | null,
  /** Which hand holds it. */
  grabHand: null as 'left' | 'right' | null,
  /** The held side is currently magnetised to a wall (for the detent). */
  snapped: false,
  dirty: 1,
};

/** Standing plant's bounding rect (world x/z) — the grid keeps this
 *  current; the clamp keeps the sides outside it. */
let plantBounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;

export function setPlantBounds(b: typeof plantBounds): void {
  plantBounds = b;
  if (floorAdjust.initialized) {
    clampLayout(floorLayout);
    floorAdjust.dirty++;
  }
}

function clampLayout(l: FloorLayout): void {
  const M = FLOOR.maxSide;
  l.left = Math.max(-M, Math.min(M, l.left));
  l.right = Math.max(-M, Math.min(M, l.right));
  l.near = Math.max(-M, Math.min(M, l.near));
  l.far = Math.max(-M, Math.min(M, l.far));
  // Standing plant is load-bearing: sides stop at its edge, outward only.
  if (plantBounds) {
    const p = FLOOR.plantPad;
    l.left = Math.min(l.left, plantBounds.minX - p);
    l.right = Math.max(l.right, plantBounds.maxX + p);
    l.far = Math.min(l.far, plantBounds.minZ - p);
    l.near = Math.max(l.near, plantBounds.maxZ + p);
  }
  // The floor stays a floor: sides can't close inside the minima. (This
  // only pushes sides OUTWARD, so it can never undo the plant clamp —
  // plant lives between the sides by construction.)
  if (l.right - l.left < FLOOR.minWidth) {
    const mid = (l.right + l.left) / 2;
    l.left = mid - FLOOR.minWidth / 2;
    l.right = mid + FLOOR.minWidth / 2;
  }
  if (l.near - l.far < FLOOR.minDepth) {
    const mid = (l.near + l.far) / 2;
    l.far = mid - FLOOR.minDepth / 2;
    l.near = mid + FLOOR.minDepth / 2;
  }
}

/** Move ONE side to a coordinate (the grab drags this every frame). */
export function setSide(side: FloorSide, value: number): void {
  if (!Number.isFinite(value)) return;
  floorLayout[side] = value;
  clampLayout(floorLayout);
  floorAdjust.dirty++;
}

/**
 * The default rectangle, in order of who knows the room best:
 *  1. THE STAGE — the headset's room-scale box, taken as drawn: that
 *     boundary IS the floor you set aside to walk, so the tape stands
 *     right on it rather than out at the plaster.
 *  2. The registry's walls, inset — every wall's two plan-view endpoints
 *     vote on a bounding box.
 *  3. No usable walls yet, and a starter floor stands around the player.
 * (An off-axis boundary or scan gets a box AROUND its room rather than
 * inside it; the drag and the snap are how it comes home — v0 documented
 * honestly in FACTORY.md.)
 */
export function defaultLayout(
  allWalls: readonly Wall[],
  px: number,
  pz: number,
  stageRect: StageRect | null = null,
): FloorLayout {
  if (stageRect) {
    return { left: stageRect.minX, right: stageRect.maxX, far: stageRect.minZ, near: stageRect.maxZ };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const w of allWalls) {
    if (w.kind !== 'wall') continue;
    for (const s of [-1, 1]) {
      const x = w.center.x + w.right.x * w.halfW * s;
      const z = w.center.z + w.right.z * w.halfW * s;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  }
  const wide = maxX - minX;
  const deep = maxZ - minZ;
  if (Number.isFinite(wide) && wide > FLOOR.minWidth + 0.2 && deep > FLOOR.minDepth + 0.2) {
    return {
      left: minX + FLOOR.inset,
      right: maxX - FLOOR.inset,
      far: minZ + FLOOR.inset,
      near: maxZ - FLOOR.inset,
    };
  }
  return {
    left: px - FLOOR.fallback.w / 2,
    right: px + FLOOR.fallback.w / 2,
    far: pz - FLOOR.fallback.d / 2,
    near: pz + FLOOR.fallback.d / 2,
  };
}

/** Deal the layout once: a saved floor wins, else the room decides. */
export function initLayout(
  allWalls: readonly Wall[],
  px: number,
  pz: number,
  stageRect: StageRect | null = null,
): void {
  if (floorAdjust.initialized) return;
  const loaded = loadLayout();
  if (loaded && (!stageRect || layoutWithin(floorLayout, stageRect))) {
    floorAdjust.source = 'save';
  } else {
    // No save — or a save that stands outside the box you walk: the
    // room deals, the box first.
    Object.assign(floorLayout, defaultLayout(allWalls, px, pz, stageRect));
    floorAdjust.source = stageRect ? 'stage' : 'room';
  }
  clampLayout(floorLayout);
  floorAdjust.initialized = true;
  floorAdjust.dirty++;
}

/** Does a layout stand inside a box — every side on it or inward, with
 *  a little tolerance for the clamp's own nudges? */
export function layoutWithin(l: FloorLayout, r: StageRect, tol = 0.1): boolean {
  return l.left >= r.minX - tol && l.right <= r.maxX + tol && l.far >= r.minZ - tol && l.near <= r.maxZ + tol;
}

export function resetLayout(
  allWalls: readonly Wall[],
  px: number,
  pz: number,
  stageRect: StageRect | null = null,
): void {
  Object.assign(floorLayout, defaultLayout(allWalls, px, pz, stageRect));
  floorAdjust.source = stageRect ? 'stage' : 'room';
  clampLayout(floorLayout);
  floorAdjust.dirty++;
  saveLayout();
}

export function saveLayout(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(floorLayout));
  } catch {
    /* storage may be unavailable — the session keeps the live value */
  }
}

/** @returns true when a stored layout was loaded. */
export function loadLayout(): boolean {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return false;
    const v = JSON.parse(raw) as Partial<FloorLayout>;
    if (
      typeof v.left === 'number' && Number.isFinite(v.left) &&
      typeof v.right === 'number' && Number.isFinite(v.right) &&
      typeof v.near === 'number' && Number.isFinite(v.near) &&
      typeof v.far === 'number' && Number.isFinite(v.far)
    ) {
      Object.assign(floorLayout, { left: v.left, right: v.right, near: v.near, far: v.far });
      clampLayout(floorLayout);
      floorAdjust.dirty++;
      return true;
    }
  } catch {
    /* a corrupt save is just the default floor */
  }
  return false;
}

/** Floor centre of the CURRENT layout. */
export function layoutCenter(): { x: number; z: number } {
  return { x: (floorLayout.left + floorLayout.right) / 2, z: (floorLayout.near + floorLayout.far) / 2 };
}

/** Is a plan point inside the tape (shrunk by `margin`)? */
export function insideFloor(x: number, z: number, margin = 0): boolean {
  return (
    x >= floorLayout.left + margin &&
    x <= floorLayout.right - margin &&
    z >= floorLayout.far + margin &&
    z <= floorLayout.near - margin
  );
}

/** The coordinate of a side (its position along its own normal axis). */
export function sideValue(side: FloorSide): number {
  return floorLayout[side];
}

/** Where a side's grab handle floats (the tape's midpoint, tape height). */
export function sideHandle(side: FloorSide, out: { x: number; y: number; z: number }): void {
  const cx = (floorLayout.left + floorLayout.right) / 2;
  const cz = (floorLayout.near + floorLayout.far) / 2;
  if (side === 'left') {
    out.x = floorLayout.left;
    out.z = cz;
  } else if (side === 'right') {
    out.x = floorLayout.right;
    out.z = cz;
  } else if (side === 'near') {
    out.x = cx;
    out.z = floorLayout.near;
  } else {
    out.x = cx;
    out.z = floorLayout.far;
  }
  out.y = FLOOR.tapeHeight;
}

const _h = { x: 0, y: 0, z: 0 };

/** The side whose tape line is nearest the hand (within reach), SLUGFEST
 *  metric: off-axis distance dominates, gated to the side's extent, with
 *  a height term so you reach toward the tape, not the carpet. */
export function nearestSide(hand: { x: number; y: number; z: number }): FloorSide | null {
  let best: FloorSide | null = null;
  let bestD = FLOOR.grabReach;
  for (const side of FLOOR_SIDES) {
    let d: number;
    if (side === 'left' || side === 'right') {
      const withinZ = hand.z > floorLayout.far - 0.3 && hand.z < floorLayout.near + 0.3;
      d = Math.abs(hand.x - floorLayout[side]) + (withinZ ? 0 : 10);
    } else {
      const withinX = hand.x > floorLayout.left - 0.3 && hand.x < floorLayout.right + 0.3;
      d = Math.abs(hand.z - floorLayout[side]) + (withinX ? 0 : 10);
    }
    sideHandle(side, _h);
    d += Math.max(0, Math.abs(hand.y - _h.y) - 0.5) * 0.5;
    if (d < bestD) {
      bestD = d;
      best = side;
    }
  }
  return best;
}
