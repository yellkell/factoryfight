/**
 * THE INTENTS — what the hands MEAN this frame, whatever they are.
 *
 * FACTORY FIGHT is played with bare hands first and controllers second,
 * so no system reads a button any more. HandSystem (which runs before
 * everything else each frame) fills this in from whichever input the
 * headset is giving it, and every verb in the game asks here instead:
 *
 *   point  — the TRIGGER on a controller; a PINCH on a hand. Aims the
 *            build ray, presses the card, holds a haul.
 *   grab   — the SQUEEZE on a controller; a FIST on a hand. Takes the
 *            collar of a tube (both hands), lifts a part off a rail.
 *   menu   — Ⓐ; or the MENU stud on your left wrist cuff.
 *   turn   — Ⓑ; or the cuff's TURN stud, while a tool is in hand.
 *   stow   — Ⓧ / Ⓨ; or the cuff's PUT DOWN stud.
 *   done   — Ⓐ / Ⓧ while marking the floor; or the cuff's DONE stud.
 *
 * One edge per verb per frame, cleared by HandSystem at the top of the
 * next one — so a press is seen exactly once by whoever asks.
 */

export type HandSide = 'left' | 'right';

export interface Btn {
  pressed: boolean;
  /** Went down THIS frame. */
  down: boolean;
  /** Came up THIS frame. */
  up: boolean;
  /** 0..1 — the trigger's travel, or how far the pinch / fist has closed. */
  value: number;
}

export interface HandIntent {
  /** What is driving this side right now. */
  mode: 'controller' | 'hand' | 'none';
  point: Btn;
  grab: Btn;
}

const btn = (): Btn => ({ pressed: false, down: false, up: false, value: 0 });

export const intents: {
  left: HandIntent;
  right: HandIntent;
  /** One-frame edges for the verbs that used to live on face buttons. */
  menu: boolean;
  turn: boolean;
  stow: boolean;
  done: boolean;
  /** True when either side is a tracked hand — the cards and coach
   *  lines speak in pinches and fists instead of buttons. */
  handMode: boolean;
} = {
  left: { mode: 'none', point: btn(), grab: btn() },
  right: { mode: 'none', point: btn(), grab: btn() },
  menu: false,
  turn: false,
  stow: false,
  done: false,
  handMode: false,
};

/** Advance one button's state from this frame's raw reading. */
export function step(b: Btn, pressed: boolean, value: number): void {
  b.down = pressed && !b.pressed;
  b.up = !pressed && b.pressed;
  b.pressed = pressed;
  b.value = value;
}

/* ── THE FIST ───────────────────────────────────────────────────────────────
 * Hands have no squeeze, so a grab is read off the joints: a finger is
 * CURLED when its tip has come back toward the wrist — tip-to-wrist under
 * this fraction of knuckle-to-wrist (an open finger reads ~1.8, a closed
 * one ~1.0). Three of the four long fingers curled is a fist; it stays a
 * fist until fewer than two are, so a grip that relaxes a little mid-haul
 * does not drop seven metres of pipe (the TUBE.holdSqueeze law, for hands).
 *
 * Index/thumb alone is a PINCH, not a fist: the other three stay open, so
 * the two gestures never fight over the same hand.
 */
export const FIST = {
  curled: 1.32,
  grabFingers: 3,
  holdFingers: 2,
};

/** WebXR joint order (XRHand): wrist 0; thumb 1–4; index 5–9; middle
 *  10–14; ring 15–19; pinky 20–24. Each finger: metacarpal, proximal,
 *  intermediate, distal, tip. */
export const J = {
  wrist: 0,
  thumbTip: 4,
  indexMeta: 5,
  indexProx: 6,
  indexTip: 9,
  middleMeta: 10,
  middleProx: 11,
  middleTip: 14,
  ringProx: 16,
  ringTip: 19,
  pinkyMeta: 20,
  pinkyProx: 21,
  pinkyTip: 24,
} as const;

function dist(m: ArrayLike<number>, a: number, b: number): number {
  const ax = m[a * 16 + 12];
  const ay = m[a * 16 + 13];
  const az = m[a * 16 + 14];
  const bx = m[b * 16 + 12];
  const by = m[b * 16 + 13];
  const bz = m[b * 16 + 14];
  return Math.hypot(ax - bx, ay - by, az - bz);
}

/** How many of the four long fingers are curled, from 25 joint matrices
 *  (column-major, translation in elements 12–14) in any one frame. */
export function curledFingers(m: ArrayLike<number>): number {
  let n = 0;
  for (const [prox, tip] of [
    [J.indexProx, J.indexTip],
    [J.middleProx, J.middleTip],
    [J.ringProx, J.ringTip],
    [J.pinkyProx, J.pinkyTip],
  ] as const) {
    const knuckle = dist(m, prox, J.wrist);
    if (knuckle < 1e-4) continue;
    if (dist(m, tip, J.wrist) / knuckle < FIST.curled) n++;
  }
  return n;
}

/** Is the INDEX finger curled? A point — index out, the rest closed —
 *  curls three fingers too, and must never read as a grab. */
export function indexCurled(m: ArrayLike<number>): boolean {
  const knuckle = dist(m, J.indexProx, J.wrist);
  return knuckle > 1e-4 && dist(m, J.indexTip, J.wrist) / knuckle < FIST.curled;
}

/** Fist, with hysteresis: `was` is last frame's answer. Taking hold needs
 *  three fingers AND the index (so a point never grabs); keeping hold
 *  needs only two of any. */
export function isFist(m: ArrayLike<number>, was: boolean): boolean {
  const n = curledFingers(m);
  return was ? n >= FIST.holdFingers : n >= FIST.grabFingers && indexCurled(m);
}

/** Index-to-thumb tip distance (m) — the pinch, when no gamepad says so. */
export function pinchGap(m: ArrayLike<number>): number {
  return dist(m, J.indexTip, J.thumbTip);
}
