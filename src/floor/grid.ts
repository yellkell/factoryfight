/**
 * THE GRID — the build lattice under the tape.
 *
 * Cells are a WORLD-ANCHORED lattice (multiples of FLOOR.cell off the
 * world origin), not an offset from the rectangle: dragging a side never
 * re-deals the cells under standing plant, so a crate keeps its cell for
 * life. The floor rectangle only decides which lattice cells are
 * IN BOUNDS right now.
 *
 * Occupancy lives here (cell → unit id), and every change re-reports the
 * plant's bounding rect to the floor plan — that's how "a side refuses
 * to cross a crate" stays true without the plan ever knowing what a
 * crate is.
 */

import { FLOOR } from '../config.js';
import { floorLayout, setPlantBounds } from './plan.js';
import { PLANT_SCALE } from '../factory/frame.js';

/** A cell's width in PLANT metres (factory/frame.ts) — the lattice is the
 *  plant's, so it shrinks with it. The tape is the room's, which is why
 *  every comparison against floorLayout below goes through ROOM_CELL. */
export const CELL = FLOOR.cell;
const ROOM_CELL = CELL * PLANT_SCALE;

export interface Cell {
  i: number;
  j: number;
}

/** A PLANT-metre plan point → the lattice cell under it. (A room point
 *  goes through toPlant first — see factory/frame.ts.) */
export function worldToCell(x: number, z: number): Cell {
  return { i: Math.floor(x / CELL), j: Math.floor(z / CELL) };
}

/** A cell's centre on the plan. */
export function cellCenter(i: number, j: number, out: { x: number; z: number }): void {
  out.x = (i + 0.5) * CELL;
  out.z = (j + 0.5) * CELL;
}

/** Is the WHOLE cell inside the tape? (A crate half over the line is a
 *  crate outside the site — the hologram only offers honest cells.) */
export function cellInFloor(i: number, j: number): boolean {
  const eps = 1e-3;
  return (
    i * ROOM_CELL >= floorLayout.left - eps &&
    (i + 1) * ROOM_CELL <= floorLayout.right + eps &&
    j * ROOM_CELL >= floorLayout.far - eps &&
    (j + 1) * ROOM_CELL <= floorLayout.near + eps
  );
}

/**
 * THE WALL LAW — which floor edge a cell backs onto, as the direction
 * pointing INTO the room from it (null when the cell stands in open
 * floor). Some plant is wall plant: the dock and the combiner bolt to
 * the site's edge and face inward, so their working faces always point
 * at the room and never at the plaster. Everything else — makers,
 * chests, rails — stands wherever it likes.
 */
export function edgeInward(i: number, j: number): 0 | 1 | 2 | 3 | null {
  if (!cellInFloor(i, j)) return null;
  // An edge cell is one with no cell beyond it — the OUTERMOST RING.
  // Defined by the lattice, not by metres: the floor rectangle rarely
  // lands on cell boundaries, so a distance threshold would call the
  // last legal column "open floor" whenever the leftover slack ran wide.
  const out: Array<{ rot: 0 | 1 | 2 | 3; slack: number }> = [];
  if (!cellInFloor(i, j - 1)) out.push({ rot: 2, slack: j * ROOM_CELL - floorLayout.far });
  if (!cellInFloor(i, j + 1)) out.push({ rot: 0, slack: floorLayout.near - (j + 1) * ROOM_CELL });
  if (!cellInFloor(i - 1, j)) out.push({ rot: 1, slack: i * ROOM_CELL - floorLayout.left });
  if (!cellInFloor(i + 1, j)) out.push({ rot: 3, slack: floorLayout.right - (i + 1) * ROOM_CELL });
  if (out.length === 0) return null;
  // A corner backs two tapes; it takes the one it stands tightest against.
  out.sort((a, b) => a.slack - b.slack);
  return out[0].rot;
}

/* ── occupancy ────────────────────────────────────────────────────────────── */

const occ = new Map<string, number>();
const key = (i: number, j: number): string => `${i},${j}`;

export function unitAt(i: number, j: number): number | undefined {
  return occ.get(key(i, j));
}

/** Claim a cell for a unit. False if it's taken. */
export function occupy(i: number, j: number, unitId: number): boolean {
  const k = key(i, j);
  if (occ.has(k)) return false;
  occ.set(k, unitId);
  reportBounds();
  return true;
}

/** Free a cell. False if it wasn't occupied. */
export function vacate(i: number, j: number): boolean {
  const gone = occ.delete(key(i, j));
  if (gone) reportBounds();
  return gone;
}

export function occupiedCells(): Cell[] {
  const cells: Cell[] = [];
  for (const k of occ.keys()) {
    const [i, j] = k.split(',').map(Number);
    cells.push({ i, j });
  }
  return cells;
}

export function occupiedCount(): number {
  return occ.size;
}

/** Tools and DOWN-TOOLS resets. */
export function clearGrid(): void {
  occ.clear();
  reportBounds();
}

/** The plant's bounding rect (cell EDGES, not centres) → the plan's
 *  side clamp. Null when the floor is empty. */
function reportBounds(): void {
  if (occ.size === 0) {
    setPlantBounds(null);
    return;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const k of occ.keys()) {
    const [i, j] = k.split(',').map(Number);
    minX = Math.min(minX, i * ROOM_CELL);
    maxX = Math.max(maxX, (i + 1) * ROOM_CELL);
    minZ = Math.min(minZ, j * ROOM_CELL);
    maxZ = Math.max(maxZ, (j + 1) * ROOM_CELL);
  }
  setPlantBounds({ minX, maxX, minZ, maxZ });
}
