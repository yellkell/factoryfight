/**
 * THE CONTROLLER — the callouts that name a controller's buttons, and
 * a shop-drawing stand-in for the controller itself.
 *
 * Every verb in the game lives on six controls (trigger, grip, Ⓐ, Ⓑ,
 * Ⓧ, Ⓨ) and not one of them was written down anywhere a player could
 * find before they needed it: the board said "Ⓐ MENU", the card said
 * "ⓑ: rotate" once a tool was in hand, and the rest was folklore. The
 * CONTROLS pages draw the thing in your hand so the words can point at
 * it — and the thing they draw is the REAL one: ui/controllerModel.ts
 * renders the SDK's own Touch Plus models and reports where each
 * button landed, and drawController below uses that whenever it is in.
 *
 * The line-art here is what stands in until the models arrive, or for
 * good when the CDN never answers (the shop plays offline). Same
 * discipline as ui/icons.ts: a unit square, scaled by the caller, one
 * accent on the controls the game listens to. The right controller is
 * the master; the left is its mirror with the letters swapped.
 */

import { font } from './fonts.js';
import { GLYPH_LIVE, type GlyphInk } from './icons.js';
import { UI } from './panel.js';
import { controllerImage } from './controllerModel.js';

export type Hand = 'left' | 'right';

/** The controls a callout can point at. `upper`/`lower` are the two face
 *  buttons — Ⓑ over Ⓐ on the right, Ⓨ over Ⓧ on the left. */
export type Control = 'trigger' | 'grip' | 'stick' | 'upper' | 'lower' | 'menu';

/** Where each control sits on the RIGHT controller, in the unit square.
 *  The left hand mirrors u → 1 − u. */
const AT: Record<Control, [number, number]> = {
  trigger: [0.8, 0.11],
  grip: [0.32, 0.63],
  stick: [0.34, 0.27],
  upper: [0.67, 0.19],
  lower: [0.6, 0.35],
  menu: [0.5, 0.47],
};

/** What the face buttons are called, per hand. */
export function faceLetter(hand: Hand, control: 'upper' | 'lower'): string {
  if (hand === 'right') return control === 'upper' ? 'B' : 'A';
  return control === 'upper' ? 'Y' : 'X';
}

/** The circled glyph for a face button — the same characters the rest of
 *  the UI already prints (Ⓐ on the FACTORY tab, Ⓧ on the build page). */
export function faceGlyph(hand: Hand, control: 'upper' | 'lower'): string {
  const letter = faceLetter(hand, control);
  return String.fromCodePoint(0x24b6 + (letter.charCodeAt(0) - 65));
}

/** Canvas position of a control's centre, for a controller drawn at
 *  (x, y) with `size`. Callouts start here. */
export function controlAnchor(
  hand: Hand,
  control: Control,
  x: number,
  y: number,
  size: number,
): { x: number; y: number } {
  const [u, v] = AT[control];
  return { x: x + (hand === 'left' ? 1 - u : u) * size, y: y + v * size };
}

/**
 * Draw one controller. `lit` is the set of controls that DO something
 * here — those get the accent; the rest draw in the plate's own ink.
 * `occlude` is the colour that hides the handle behind the face plate:
 * the panel glass by default, so the drawing sits IN the card rather
 * than on it.
 */
export function controllerGlyph(
  g: CanvasRenderingContext2D,
  hand: Hand,
  x: number,
  y: number,
  size: number,
  lit: ReadonlySet<Control> = new Set(),
  ink: GlyphInk = GLYPH_LIVE,
  occlude = '#14100a',
): void {
  const m = hand === 'left' ? -1 : 1;
  const X = (u: number): number => x + (hand === 'left' ? 1 - u : u) * size;
  const Y = (v: number): number => y + v * size;
  const S = (u: number): number => u * size;

  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.lineWidth = Math.max(1.2, size * 0.014);
  g.strokeStyle = ink.ink;

  const body = 'rgba(255,255,255,0.05)';
  const liveFill = 'rgba(255,162,46,0.16)';
  const strokeFor = (c: Control): string => (lit.has(c) ? ink.accent : ink.ink);
  const fillFor = (c: Control): string => (lit.has(c) ? liveFill : body);

  // THE TRIGGER — the tongue your index finger lives on, peeking out
  // from under the plate at the outer top. Behind everything.
  g.beginPath();
  g.moveTo(X(0.7), Y(0.16));
  g.quadraticCurveTo(X(0.74), Y(0.02), X(0.86), Y(0.06));
  g.quadraticCurveTo(X(0.9), Y(0.16), X(0.82), Y(0.25));
  g.closePath();
  g.fillStyle = occlude;
  g.fill();
  g.fillStyle = fillFor('trigger');
  g.fill();
  g.strokeStyle = strokeFor('trigger');
  g.stroke();

  // THE HANDLE — tapering down and slightly inward, the way a grip does.
  g.beginPath();
  g.moveTo(X(0.35), Y(0.4));
  g.lineTo(X(0.3), Y(0.92));
  g.quadraticCurveTo(X(0.3), Y(0.99), X(0.38), Y(0.99));
  g.lineTo(X(0.62), Y(0.99));
  g.quadraticCurveTo(X(0.7), Y(0.99), X(0.7), Y(0.92));
  g.lineTo(X(0.65), Y(0.4));
  g.closePath();
  g.fillStyle = occlude;
  g.fill();
  g.fillStyle = body;
  g.fill();
  g.strokeStyle = ink.ink;
  g.stroke();

  // THE GRIP BUTTON — a raised plate on the handle's inner face, where
  // the middle finger closes.
  g.beginPath();
  g.roundRect(X(0.27) - (m < 0 ? S(0.075) : 0), Y(0.52), S(0.075), S(0.22), S(0.03));
  g.fillStyle = occlude;
  g.fill();
  g.fillStyle = fillFor('grip');
  g.fill();
  g.strokeStyle = strokeFor('grip');
  g.stroke();

  // THE FACE PLATE — an oval over the top of the handle, with one
  // hairline inside it for the thumb rest.
  g.beginPath();
  g.ellipse(X(0.47), Y(0.29), S(0.37), S(0.23), 0, 0, Math.PI * 2);
  g.fillStyle = occlude;
  g.fill();
  g.fillStyle = body;
  g.fill();
  g.strokeStyle = ink.ink;
  g.stroke();
  g.beginPath();
  g.ellipse(X(0.47), Y(0.29), S(0.32), S(0.185), 0, 0, Math.PI * 2);
  g.strokeStyle = ink.dim;
  g.lineWidth = Math.max(1, size * 0.008);
  g.stroke();
  g.lineWidth = Math.max(1.2, size * 0.014);

  // THE STICK — a ring and a cap.
  const [su, sv] = AT.stick;
  g.beginPath();
  g.arc(X(su), Y(sv), S(0.09), 0, Math.PI * 2);
  g.strokeStyle = ink.dim;
  g.stroke();
  g.beginPath();
  g.arc(X(su), Y(sv), S(0.055), 0, Math.PI * 2);
  g.fillStyle = fillFor('stick');
  g.fill();
  g.strokeStyle = strokeFor('stick');
  g.stroke();

  // THE FACE BUTTONS — two, lettered.
  for (const c of ['upper', 'lower'] as const) {
    const [u, v] = AT[c];
    g.beginPath();
    g.arc(X(u), Y(v), S(0.052), 0, Math.PI * 2);
    g.fillStyle = fillFor(c);
    g.fill();
    g.strokeStyle = strokeFor(c);
    g.stroke();
    g.font = font(700, Math.max(9, S(0.06)));
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = lit.has(c) ? ink.accent : ink.dim;
    g.fillText(faceLetter(hand, c), X(u), Y(v) + S(0.004));
  }

  // THE MENU PIP — the system button at the plate's foot. Never ours.
  const [mu, mv] = AT.menu;
  g.beginPath();
  g.arc(X(mu), Y(mv), S(0.022), 0, Math.PI * 2);
  g.strokeStyle = ink.dim;
  g.lineWidth = Math.max(1, size * 0.008);
  g.stroke();

  g.restore();
}

/**
 * A CALLOUT: a dot on the control, a leader out to the margin, and the
 * words. `side` is which way the words go; `lx` is where the text edge
 * sits and `ly` its baseline row. `sub` is an optional second line.
 */
export function callout(
  g: CanvasRenderingContext2D,
  from: { x: number; y: number },
  lx: number,
  ly: number,
  side: 'left' | 'right',
  label: string,
  sub?: string,
  live = true,
): void {
  const dir = side === 'right' ? 1 : -1;
  g.save();
  // The leader: a diagonal to the margin, then a short flat run into
  // the text — the classic exploded-drawing elbow.
  g.strokeStyle = live ? 'rgba(255,255,255,0.38)' : 'rgba(255,255,255,0.18)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(from.x, from.y);
  g.lineTo(lx - dir * 22, ly);
  g.lineTo(lx - dir * 6, ly);
  g.stroke();
  g.fillStyle = live ? UI.accent : UI.disabled;
  g.beginPath();
  g.arc(from.x, from.y, 4, 0, Math.PI * 2);
  g.fill();

  g.textAlign = side === 'right' ? 'left' : 'right';
  g.textBaseline = 'middle';
  g.font = font(600, 22);
  g.letterSpacing = '1.5px';
  g.fillStyle = live ? UI.text : UI.disabled;
  g.fillText(label, lx, ly);
  g.letterSpacing = '0px';
  if (sub) {
    g.font = font(500, 18);
    g.fillStyle = live ? UI.dim : UI.faint;
    g.fillText(sub, lx, ly + 23);
  }
  g.restore();
}

/**
 * DRAW A CONTROLLER — the real one when its picture is in (see
 * ui/controllerModel.ts), the line-art above until then — and hand back
 * where every control landed, so callouts point at the thing itself.
 * Lit controls get an amber ring on the photo, the same job the accent
 * stroke does on the drawing.
 */
export function drawController(
  g: CanvasRenderingContext2D,
  hand: Hand,
  x: number,
  y: number,
  size: number,
  lit: ReadonlySet<Control> = new Set(),
): Record<Control, { x: number; y: number }> {
  const anchors = {} as Record<Control, { x: number; y: number }>;
  const img = controllerImage(hand);
  if (!img) {
    controllerGlyph(g, hand, x, y, size, lit);
    for (const c of Object.keys(AT) as Control[]) anchors[c] = controlAnchor(hand, c, x, y, size);
    return anchors;
  }
  g.drawImage(img.canvas, x, y, size, size);
  for (const c of Object.keys(AT) as Control[]) {
    const a = img.anchors[c];
    anchors[c] = a ? { x: x + a.x * size, y: y + a.y * size } : controlAnchor(hand, c, x, y, size);
  }
  g.save();
  for (const c of lit) {
    const a = anchors[c];
    g.beginPath();
    g.arc(a.x, a.y, size * 0.062, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,162,46,0.22)';
    g.fill();
    g.lineWidth = Math.max(1.5, size * 0.012);
    g.strokeStyle = UI.accent;
    g.stroke();
  }
  g.restore();
  return anchors;
}
