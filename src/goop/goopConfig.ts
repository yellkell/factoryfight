/**
 * THE GOOP's own constants — the gel body, vendored whole out of RAVE
 * RAID (src/goopliath/) along with its sim, its raymarched surface and
 * its dance stances.
 *
 * TUBES asked for one thing from that game and this is it: at the end of
 * the book the fourth manifold opens, the vat fills, and the thing that
 * climbs out of it is the same organism that headlined the club — the
 * same 20-blob soup, the same smooth-min surface, the same overdamped
 * wobble. What did NOT come across is everything about a fight: the
 * punch moveset, the KO, the lumps, the scoring. Nothing in a factory
 * throws a jab.
 *
 * Everything here is in the creature's NATIVE metre scale: the sim
 * always runs man-sized (1.78 m tall) and the rig is scaled by its
 * parent group, so these numbers keep the original's exact proportions
 * whatever size the vat's occupant turns out to be.
 */

/** The creature's body plan. */
export const CREATURE = {
  /** Head height when fully formed up into its fighting shape. */
  height: 1.78,
  /** Glob-mode dome: roughly this radius, this tall. */
  globRadius: 0.62,
  globHeight: 0.95,
  /** Smooth-min blend width — how gloopily the blobs fuse (bigger = soupier). */
  blend: 0.19,
  /** Max simultaneous knocked-out lumps in flight/resting on the floor.
   *  ZERO for the boss: torn-off globs flying at the player (and crawling
   *  home after) cost blobs in the march loop and frames on Quest — the
   *  body's own dents/jiggle carry the hit feedback. */
  maxLumps: 0,
  /** Max simultaneous impact dents (negative blobs carved by fireballs). */
  maxDents: 4,
  /** Seconds for glob -> boxer form-up (and back down). */
  formTime: 1.35,
};

/** Impact reception. TUBES never punches the goop — but the sim reads
 *  these for its own ripples and dents, so they come along. */
export const PUNCH = {
  /** Impact speed (m/s) below this only nudges the surface, no "hit". */
  hitSpeed: 1.3,
  /** Impact speed that knocks a lump clean out of the body. */
  lumpSpeed: 2.5,
  /** Impulse scale from impact velocity into nearby blobs — how hard a hit
   *  physically shoves the gel. Cranked up so a hit visibly ripples the body. */
  impulse: 1.5,
  /** Radius around the contact point that feels the hit — wide so the shove
   *  travels out across the surface as a ripple, not just a local poke. */
  splashRadius: 0.72,
  /** Seconds a dent crater lingers before the gel flows back in — long enough
   *  to read the impact wobble out. */
  dentLife: 0.62,
  /** Per-hand cooldown between scoring hits (unused by the boss, kept for the sim). */
  cooldown: 0.2,
  /** Damage per scoring hit (unused by the boss — Goopliath counts hits). */
  damage: 3.2,
  lumpBonus: 2.5,
  headBonus: 1.25,
  headRadius: 0.3,
};

/** Gel look. Colours are linear-ish hex fed straight into the shader. */
export const GEL_LOOK = {
  /** Shallow (thin-edge) tint — backlit lime. */
  shallowColor: 0x8cff70,
  /** Deep-body tint — dark bottle-green. */
  deepColor: 0x14602f,
  /** Inner nucleus glow — the denser "organ" slime in the middle. */
  nucleusColor: 0x36e05a,
  /** Eye flash colour during an attack telegraph. */
  telegraphColor: 0xffb03a,
  /** Raymarch step cap (the single biggest perf knob on Quest). */
  maxSteps: 22,
  /** Surface wobble amplitude at rest / when agitated. The agitated figure is
   *  turned up so a fresh hit sets the whole surface roiling. */
  wobble: 0.010,
  wobbleAgitated: 0.044,
};
