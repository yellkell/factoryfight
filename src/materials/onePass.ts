/**
 * ONE PASS. three.js draws a material that is transparent AND double-
 * sided twice — back faces, then front — flipping its `side` and setting
 * `needsUpdate` around each draw, which sends the renderer back to pick
 * the shader program every time. Every glow, ring, beam, bolt, crack and
 * panel in this game is exactly that kind of material, and not one of
 * them needs the back-then-front pass (they are additive light, or flat
 * cards): in a late wave the doubling was a fifth of the frame.
 *
 * So every material here draws in a single pass. main.ts imports this
 * before anything else, so it holds before the first material is made.
 */

import { Material } from 'three';

Object.defineProperty(Material.prototype, 'forceSinglePass', {
  configurable: true,
  get: () => true,
  set: () => {},
});
