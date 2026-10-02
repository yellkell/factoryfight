/**
 * THE PLANT FRAME — the shop, built at 0.7 scale.
 *
 * FACTORY FIGHT's plant is smaller than TUBES' on purpose: a base worth
 * defending needs a wall round it, room for guns, and a run-up for
 * whatever comes out of the plaster, and all of that has to fit in a
 * real room. Rather than re-cut every chassis, tube and craft theatre
 * (thousands of hand-tuned numbers, every one still true in its own
 * units), the whole plant lives in ONE scaled group: everything the sim
 * and the builders say is in PLANT metres — TUBES' metres — and the
 * group turns them into room metres on the way to the screen.
 *
 * The rule is a boundary rule. Anything that comes FROM the room — a
 * grip, a ray's floor hit, the tape's sides, a wall a breach opens in —
 * is divided by PLANT_SCALE on the way in. Nothing inside the sim ever
 * sees a room metre, and the headless tools speak plant metres too, so
 * every walk written against TUBES' 0.35 m lattice still reads true.
 */

import { Group, Vector3 } from 'three';

/** Room metres per plant metre. A 0.35 m TUBES cell is 0.245 m here; the
 *  bench top lands at 0.6 m — still a hand's height, a knee lower. */
export const PLANT_SCALE = 0.7;

/** The one parent of everything the plant draws. Added to the scene by
 *  whichever system wakes first (both call ensurePlantRoot). */
export const plantRoot = new Group();
plantRoot.name = 'plant-root';
plantRoot.scale.setScalar(PLANT_SCALE);

export function ensurePlantRoot(scene: { add: (o: Group) => unknown }): Group {
  if (!plantRoot.parent) scene.add(plantRoot);
  return plantRoot;
}

/** A room point → plant metres, in place. */
export function toPlant(v: Vector3): Vector3 {
  return v.multiplyScalar(1 / PLANT_SCALE);
}

/** A plant point → room metres, in place. */
export function toRoom(v: Vector3): Vector3 {
  return v.multiplyScalar(PLANT_SCALE);
}
