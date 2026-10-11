/**
 * THE LOAD — how much spectacle the frame can afford right now.
 *
 * A late wave on a headset is the worst moment to spend more on sparks:
 * sixty towers, a carpet of crawlers, and every death asking for shards,
 * a splat and a pop. So the effects ask here first. One number, `q`,
 * 0.35..1: every burst multiplies its particle count by it (and grows
 * each particle a little, so a busy frame gets fewer, BIGGER pieces —
 * the same read, a third of the cost).
 *
 *   THE MEASURE   an EMA of the real frame delta, against the display's
 *                 own beat: the XR session's frame rate when it says
 *                 (72 Hz on a Quest, 90 or 120 if raised), else the
 *                 shortest frame seen lately (60 on a desktop monitor) —
 *                 refresh-agnostic either way. Running late means slower
 *                 than ~1.18 beats AND slower than 16 ms. (The guessed
 *                 beat creeps back up only over a minute or so: a headset
 *                 stuck at half rate must not talk itself into calling
 *                 that its rate.)
 *   THE RESPONSE  sheds fast (≈1 s from full to floor) while frames run
 *                 long, recovers slowly (≈8 s) once they are quick again,
 *                 holds in between — no see-sawing on a borderline wave.
 *   THE BLIND     the first frames after a start, and any frame over a
 *                 tenth of a second (a pause, a hitch, a tab away), are
 *                 not evidence and are ignored.
 *
 * Tools can pin it (`__tubes.siege.fxQuality(0.35)`) to see the floor.
 */

const Q_MIN = 0.35;
const SHED_PER_S = 0.65;
const MEND_PER_S = 0.08;
const WARMUP_FRAMES = 45;

let q = 1;
let ema = 1 / 72;
let beat = 1 / 72;
let seen = 0;
let pinned: number | null = null;

/** Feed one real frame delta (seconds). Call once a frame while the
 *  fight is live; `skip` (paused, or the fight off) resets the warm-up;
 *  `hz` is the display's own rate if it is known (an XR session's). */
export function sampleFrame(delta: number, skip = false, hz = 0): void {
  if (skip) {
    seen = 0;
    return;
  }
  if (!(delta > 0) || delta > 0.1) return;
  seen++;
  // The beat: the display's, if known; else snaps down to any shorter
  // frame and creeps back up very slowly, so a display that changes its
  // rate is followed, eventually.
  beat = hz > 0 ? 1 / hz : Math.min(delta, beat + (delta - beat) * 0.0003);
  ema += (delta - ema) * 0.06;
  if (seen < WARMUP_FRAMES) return;
  const late = Math.max(0.016, beat * 1.18);
  const quick = Math.max(0.0145, beat * 1.08);
  if (ema > late) q = Math.max(Q_MIN, q - SHED_PER_S * delta);
  else if (ema < quick) q = Math.min(1, q + MEND_PER_S * delta);
}

/** The quality factor now, 0.35..1. */
export function fxQ(): number {
  return pinned ?? q;
}

/** `n` particles, as many as the moment affords (never fewer than `min`). */
export function fxN(n: number, min = 1): number {
  return Math.max(min, Math.round(n * (pinned ?? q)));
}

/** TOOLS ONLY: pin the factor (null lets it float again); returns the
 *  live state. */
export function pinFxQ(v?: number | null): { q: number; ema: number; beat: number } {
  if (v !== undefined) pinned = v === null ? null : Math.max(Q_MIN, Math.min(1, v));
  return { q: fxQ(), ema: ema * 1000, beat: beat * 1000 };
}
