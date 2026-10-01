/**
 * THE GLYPHS — every machine and every part, drawn as line-art.
 *
 * Playtest: "when we select and build it should show a PICTURE and the
 * word, not just the word." Dead right, and it is the single cheapest
 * readability win in the whole build: a catalogue of seven words all in
 * the same weight is a list you have to READ, every time, forever. A
 * catalogue of seven silhouettes is a thing you learn once.
 *
 * These are deliberately not screenshots or renders. They are shop
 * drawings: a front elevation of each machine in two weights of stroke
 * — dark plate outlines, one amber accent on the part that does the
 * work — matching the real geometry closely enough that the ghost you
 * summon is visibly the thing you picked off the card.
 *
 * Everything draws inside a UNIT SQUARE and is scaled by the caller, so
 * one glyph serves a 30 px catalogue chip and a 90 px header alike. The
 * canvas state (transform, stroke, fill, alpha) is saved and restored
 * round every call: menu painters are long and nobody should have to
 * know what an icon left behind.
 */

import type { ItemId, UnitType } from '../config.js';

/** What a glyph is drawn in. `ink` carries the plate, `accent` the one
 *  working part, `dim` the shadowed faces. */
export interface GlyphInk {
  ink: string;
  accent: string;
  dim: string;
}

export const GLYPH_LIVE: GlyphInk = {
  ink: 'rgba(255,255,255,0.92)',
  accent: '#ffa22e',
  dim: 'rgba(255,255,255,0.34)',
};
export const GLYPH_DEAD: GlyphInk = {
  ink: 'rgba(250,244,235,0.3)',
  accent: 'rgba(250,244,235,0.22)',
  dim: 'rgba(250,244,235,0.14)',
};

/** Everything a tool can be pointed at, for the catalogue. */
export type GlyphId = UnitType | 'delete' | 'unplug';

/* ── the little pen ─────────────────────────────────────────────────────── */

interface Pen {
  g: CanvasRenderingContext2D;
  ink: GlyphInk;
  /** Unit-square → canvas. */
  X: (u: number) => number;
  Y: (v: number) => number;
  S: (u: number) => number;
}

function box(p: Pen, x: number, y: number, w: number, h: number, fill?: string): void {
  p.g.beginPath();
  p.g.rect(p.X(x), p.Y(y), p.S(w), p.S(h));
  if (fill) {
    p.g.fillStyle = fill;
    p.g.fill();
  }
  p.g.stroke();
}

function poly(p: Pen, pts: Array<[number, number]>, fill?: string, close = true): void {
  p.g.beginPath();
  pts.forEach(([x, y], i) => (i ? p.g.lineTo(p.X(x), p.Y(y)) : p.g.moveTo(p.X(x), p.Y(y))));
  if (close) p.g.closePath();
  if (fill) {
    p.g.fillStyle = fill;
    p.g.fill();
  }
  p.g.stroke();
}

function line(p: Pen, x1: number, y1: number, x2: number, y2: number): void {
  p.g.beginPath();
  p.g.moveTo(p.X(x1), p.Y(y1));
  p.g.lineTo(p.X(x2), p.Y(y2));
  p.g.stroke();
}

/** A row of bolt heads — the detail that makes a 30 px glyph read as
 *  fabricated rather than as a rectangle. */
function studs(p: Pen, x1: number, x2: number, y: number, n: number): void {
  p.g.fillStyle = p.ink.dim;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    p.g.beginPath();
    p.g.arc(p.X(x1 + (x2 - x1) * t), p.Y(y), Math.max(0.7, p.S(0.018)), 0, Math.PI * 2);
    p.g.fill();
  }
}

/* ── the machines ───────────────────────────────────────────────────────── */

function drawGlyph(p: Pen, id: GlyphId): void {
  const { g, ink } = p;
  g.strokeStyle = ink.ink;
  g.lineJoin = 'miter';

  if (id === 'dock') {
    // THE BANK: a folded throat over an armoured strongbox.
    poly(p, [[0.06, 0.3], [0.94, 0.3], [0.74, 0.5], [0.26, 0.5]]);
    box(p, 0.2, 0.5, 0.6, 0.42);
    box(p, 0.2, 0.5, 0.09, 0.42, ink.dim);
    box(p, 0.71, 0.5, 0.09, 0.42, ink.dim);
    studs(p, 0.35, 0.65, 0.57, 4);
    studs(p, 0.35, 0.65, 0.85, 4);
    g.strokeStyle = ink.accent;
    g.lineWidth = Math.max(1.4, p.S(0.05));
    line(p, 0.34, 0.72, 0.66, 0.72);
    g.lineWidth = Math.max(1, p.S(0.032));
    g.strokeStyle = ink.ink;
    return;
  }

  if (id === 'maker') {
    // THE MAKER: two columns, a crown, a ram over an anvil.
    box(p, 0.14, 0.08, 0.72, 0.13); // crown
    box(p, 0.14, 0.21, 0.11, 0.5); // column
    box(p, 0.75, 0.21, 0.11, 0.5); // column
    box(p, 0.36, 0.21, 0.28, 0.3, ink.dim); // the ram
    box(p, 0.12, 0.71, 0.76, 0.11); // the bed
    box(p, 0.3, 0.62, 0.4, 0.09); // the anvil
    studs(p, 0.24, 0.76, 0.145, 4);
    g.strokeStyle = ink.accent;
    g.lineWidth = Math.max(1.4, p.S(0.05));
    line(p, 0.44, 0.55, 0.56, 0.55); // the stroke gap: where work happens
    g.lineWidth = Math.max(1, p.S(0.032));
    g.strokeStyle = ink.ink;
    box(p, 0.2, 0.82, 0.08, 0.12, ink.dim);
    box(p, 0.72, 0.82, 0.08, 0.12, ink.dim);
    return;
  }

  if (id === 'combiner') {
    // THE COMBINER: two hoppers in, one body, one thing out.
    poly(p, [[0.02, 0.24], [0.36, 0.24], [0.3, 0.42], [0.08, 0.42]]);
    poly(p, [[0.64, 0.24], [0.98, 0.24], [0.92, 0.42], [0.7, 0.42]]);
    box(p, 0.16, 0.42, 0.68, 0.1); // the beam
    box(p, 0.34, 0.52, 0.32, 0.28, ink.dim); // the body
    studs(p, 0.26, 0.74, 0.47, 5);
    box(p, 0.24, 0.8, 0.09, 0.14, ink.dim);
    box(p, 0.67, 0.8, 0.09, 0.14, ink.dim);
    g.strokeStyle = ink.accent;
    poly(p, [[0.42, 0.84], [0.58, 0.84], [0.5, 0.97]], ink.accent);
    g.strokeStyle = ink.ink;
    return;
  }

  if (id === 'belt') {
    // THE RAIL: two I-section frames, slats between, travelling.
    box(p, 0.04, 0.36, 0.92, 0.06);
    box(p, 0.04, 0.6, 0.92, 0.06);
    g.strokeStyle = ink.dim;
    for (let i = 0; i < 5; i++) {
      const x = 0.11 + i * 0.19;
      line(p, x, 0.42, x, 0.6);
    }
    g.strokeStyle = ink.ink;
    box(p, 0.12, 0.66, 0.07, 0.2, ink.dim);
    box(p, 0.81, 0.66, 0.07, 0.2, ink.dim);
    g.strokeStyle = ink.accent;
    poly(p, [[0.4, 0.16], [0.62, 0.16], [0.62, 0.06], [0.82, 0.24], [0.62, 0.42], [0.62, 0.32], [0.4, 0.32]], ink.accent);
    g.strokeStyle = ink.ink;
    return;
  }

  if (id === 'chest') {
    // THE CHEST: a pallet crate, ribbed, open at the top.
    box(p, 0.1, 0.24, 0.8, 0.58);
    g.strokeStyle = ink.dim;
    for (const x of [0.3, 0.5, 0.7]) line(p, x, 0.3, x, 0.76);
    g.strokeStyle = ink.ink;
    box(p, 0.1, 0.24, 0.1, 0.58, ink.dim);
    box(p, 0.8, 0.24, 0.1, 0.58, ink.dim);
    line(p, 0.1, 0.32, 0.9, 0.32);
    box(p, 0.06, 0.82, 0.88, 0.09, ink.dim); // the pallet
    g.strokeStyle = ink.accent;
    g.lineWidth = Math.max(1.4, p.S(0.05));
    line(p, 0.26, 0.66, 0.74, 0.66);
    g.lineWidth = Math.max(1, p.S(0.032));
    g.strokeStyle = ink.ink;
    return;
  }

  if (id === 'post') {
    // THE POST: a peg with a flag on it.
    box(p, 0.44, 0.2, 0.12, 0.68);
    line(p, 0.36, 0.44, 0.64, 0.44);
    line(p, 0.36, 0.62, 0.64, 0.62);
    box(p, 0.28, 0.88, 0.44, 0.08, ink.dim);
    g.strokeStyle = ink.accent;
    poly(p, [[0.56, 0.06], [0.92, 0.17], [0.56, 0.28]], ink.accent);
    g.strokeStyle = ink.ink;
    return;
  }

  if (id === 'vat') {
    // THE VAT: a banded tank with something in the bottom of it. Drawn
    // round-shouldered rather than caged, to match the machine — a vat
    // is the one thing on the floor that is honestly a vessel.
    box(p, 0.14, 0.1, 0.72, 0.09); // the lid
    poly(p, [
      [0.2, 0.19],
      [0.8, 0.19],
      [0.82, 0.3],
      [0.82, 0.78],
      [0.76, 0.86],
      [0.24, 0.86],
      [0.18, 0.78],
      [0.18, 0.3],
    ]);
    // THE LEVEL — the one place in the kit the accent is not amber,
    // because the whole point of the vat is that it is green.
    p.g.save();
    p.g.clip();
    p.g.fillStyle = '#4dff9b';
    p.g.globalAlpha = 0.8;
    p.g.fillRect(p.X(0.16), p.Y(0.56), p.S(0.7), p.S(0.34));
    p.g.restore();
    g.strokeStyle = '#4dff9b';
    line(p, 0.2, 0.56, 0.8, 0.56);
    g.strokeStyle = ink.ink;
    // The hoops.
    for (const y of [0.3, 0.72]) line(p, 0.18, y, 0.82, y);
    box(p, 0.1, 0.86, 0.8, 0.08, ink.dim); // the pan
    return;
  }

  if (id === 'turret') {
    // THE TURRET: pedestal, slewing ring, a mantlet, one barrel out the
    // front — the muzzle brake is the accent, because that end matters.
    box(p, 0.3, 0.86, 0.4, 0.08, ink.dim); // the foot
    box(p, 0.44, 0.6, 0.12, 0.26); // the leg
    box(p, 0.3, 0.52, 0.4, 0.08); // the ring
    poly(p, [
      [0.22, 0.52],
      [0.26, 0.28],
      [0.58, 0.24],
      [0.66, 0.34],
      [0.66, 0.52],
    ]);
    box(p, 0.66, 0.3, 0.24, 0.07); // the barrel
    g.strokeStyle = ink.accent;
    box(p, 0.86, 0.27, 0.08, 0.13, ink.accent); // the brake
    g.strokeStyle = ink.dim;
    poly(p, [[0.16, 0.2], [0.3, 0.2], [0.26, 0.3], [0.2, 0.3]]); // hopper
    g.strokeStyle = ink.ink;
    return;
  }

  if (id === 'wall') {
    // THE WALL: two courses of plate, bolted, a hazard crown on top.
    box(p, 0.06, 0.52, 0.88, 0.34);
    box(p, 0.1, 0.24, 0.8, 0.28);
    box(p, 0.02, 0.86, 0.96, 0.08, ink.dim);
    g.strokeStyle = ink.dim;
    for (const x of [0.36, 0.64]) line(p, x, 0.52, x, 0.86);
    line(p, 0.5, 0.24, 0.5, 0.52);
    g.strokeStyle = ink.accent;
    for (let k = 0; k < 5; k++) {
      const x = 0.12 + k * 0.16;
      poly(p, [[x, 0.24], [x + 0.08, 0.24], [x + 0.13, 0.15], [x + 0.05, 0.15]], ink.accent);
    }
    g.strokeStyle = ink.ink;
    return;
  }

  if (id === 'unplug') {
    // UNPLUG: a collar pulled clear of its flange.
    box(p, 0.06, 0.34, 0.16, 0.32, ink.dim);
    line(p, 0.22, 0.44, 0.42, 0.44);
    line(p, 0.22, 0.56, 0.42, 0.56);
    box(p, 0.6, 0.3, 0.14, 0.4);
    box(p, 0.74, 0.4, 0.2, 0.2, ink.dim);
    g.strokeStyle = ink.accent;
    g.lineWidth = Math.max(1.4, p.S(0.05));
    line(p, 0.44, 0.34, 0.56, 0.22);
    line(p, 0.44, 0.66, 0.56, 0.78);
    g.lineWidth = Math.max(1, p.S(0.032));
    g.strokeStyle = ink.ink;
    return;
  }

  // DELETE: the wrecking bar, over a box coming apart.
  box(p, 0.12, 0.42, 0.5, 0.46, ink.dim);
  g.strokeStyle = ink.accent;
  g.lineWidth = Math.max(1.6, p.S(0.07));
  line(p, 0.32, 0.78, 0.86, 0.16);
  poly(p, [[0.86, 0.16], [0.72, 0.14], [0.84, 0.3]], ink.accent);
  g.lineWidth = Math.max(1, p.S(0.032));
  g.strokeStyle = ink.ink;
  line(p, 0.16, 0.34, 0.26, 0.24);
  line(p, 0.34, 0.3, 0.4, 0.18);
}

/* ── the parts ──────────────────────────────────────────────────────────── */

function drawItem(p: Pen, item: ItemId): void {
  const { g, ink } = p;
  const AMBER = '#ffa22e';
  const CYAN = '#46e0ff';
  const VIOLET = '#b46bff';
  g.strokeStyle = ink.ink;

  /** An n-gon centred in the square. */
  const gon = (n: number, r: number, cx = 0.5, cy = 0.5, fill?: string, turn = 0): void => {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < n; i++) {
      const a = turn + (i / n) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    poly(p, pts, fill);
  };

  if (item === 'gear') {
    gon(8, 0.42);
    gon(8, 0.34, 0.5, 0.5, undefined, Math.PI / 8);
    gon(4, 0.14, 0.5, 0.5, ink.dim);
    g.strokeStyle = AMBER;
    gon(6, 0.07, 0.5, 0.5, AMBER);
    g.strokeStyle = ink.ink;
    return;
  }
  if (item === 'cell') {
    poly(p, [[0.28, 0.14], [0.72, 0.14], [0.8, 0.26], [0.8, 0.74], [0.72, 0.86], [0.28, 0.86], [0.2, 0.74], [0.2, 0.26]]);
    box(p, 0.2, 0.14, 0.6, 0.09, ink.dim);
    box(p, 0.2, 0.77, 0.6, 0.09, ink.dim);
    g.strokeStyle = CYAN;
    box(p, 0.2, 0.44, 0.6, 0.12, CYAN);
    g.strokeStyle = ink.ink;
    return;
  }
  if (item === 'chip') {
    box(p, 0.16, 0.22, 0.68, 0.56);
    g.strokeStyle = VIOLET;
    box(p, 0.3, 0.34, 0.4, 0.32, VIOLET);
    g.strokeStyle = ink.dim;
    for (const y of [0.34, 0.5, 0.66]) {
      line(p, 0.04, y, 0.16, y);
      line(p, 0.84, y, 0.96, y);
    }
    g.strokeStyle = ink.ink;
    return;
  }
  if (item === 'pump') {
    gon(8, 0.34, 0.5, 0.62);
    box(p, 0.38, 0.12, 0.24, 0.24); // the throat
    g.strokeStyle = CYAN;
    box(p, 0.36, 0.32, 0.28, 0.07, CYAN);
    g.strokeStyle = AMBER;
    box(p, 0.22, 0.86, 0.56, 0.08, AMBER);
    g.strokeStyle = ink.ink;
    return;
  }
  if (item === 'lamp') {
    box(p, 0.28, 0.44, 0.44, 0.44);
    box(p, 0.2, 0.22, 0.6, 0.22); // the crown
    g.strokeStyle = VIOLET;
    box(p, 0.3, 0.1, 0.4, 0.12, VIOLET);
    g.strokeStyle = CYAN;
    box(p, 0.28, 0.72, 0.44, 0.08, CYAN);
    g.strokeStyle = ink.ink;
    return;
  }
  // servo — PUMP + LAMP: the pump's eight-sided body and amber base
  // under a throat, the lamp's crown lit violet on top, cyan at the
  // joint. Three colours because it carries all three lines.
  gon(8, 0.3, 0.5, 0.66);
  g.strokeStyle = AMBER;
  box(p, 0.26, 0.88, 0.48, 0.07, AMBER);
  g.strokeStyle = ink.ink;
  box(p, 0.4, 0.3, 0.2, 0.18); // the throat
  g.strokeStyle = CYAN;
  box(p, 0.38, 0.42, 0.24, 0.07, CYAN);
  g.strokeStyle = ink.ink;
  box(p, 0.28, 0.16, 0.44, 0.14); // the crown
  g.strokeStyle = VIOLET;
  box(p, 0.34, 0.06, 0.32, 0.1, VIOLET);
  g.strokeStyle = ink.ink;
}

/* ── the public pens ────────────────────────────────────────────────────── */

function pen(g: CanvasRenderingContext2D, x: number, y: number, size: number, ink: GlyphInk): Pen {
  return {
    g,
    ink,
    X: (u) => x + u * size,
    Y: (v) => y + v * size,
    S: (u) => u * size,
  };
}

/** A machine's shop drawing, in a `size` square with its top-left at
 *  (x, y). Pass GLYPH_DEAD for anything the catalogue is refusing. */
export function unitGlyph(
  g: CanvasRenderingContext2D,
  id: GlyphId,
  x: number,
  y: number,
  size: number,
  ink: GlyphInk = GLYPH_LIVE,
): void {
  g.save();
  g.lineWidth = Math.max(1, size * 0.032);
  g.lineCap = 'butt';
  drawGlyph(pen(g, x, y, size, ink), id);
  g.restore();
}

/** A part, drawn the same way and to the same scale — so a chest's
 *  contents and a catalogue chip sit on one grid. */
export function itemGlyph(
  g: CanvasRenderingContext2D,
  item: ItemId,
  x: number,
  y: number,
  size: number,
  ink: GlyphInk = GLYPH_LIVE,
): void {
  g.save();
  g.lineWidth = Math.max(1, size * 0.036);
  g.lineCap = 'butt';
  drawItem(pen(g, x, y, size, ink), item);
  g.restore();
}

/** THE GOOP's own mark — the one glyph in the kit that isn't machined:
 *  a blob with two eyes. Used on the last sheet and on the finale card,
 *  where every other icon in the game would be a lie. */
export function goopGlyph(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  alive = true,
): void {
  g.save();
  const X = (u: number): number => x + u * size;
  const Y = (v: number): number => y + v * size;
  g.beginPath();
  g.moveTo(X(0.08), Y(0.88));
  g.bezierCurveTo(X(0.02), Y(0.48), X(0.2), Y(0.1), X(0.5), Y(0.1));
  g.bezierCurveTo(X(0.8), Y(0.1), X(0.98), Y(0.46), X(0.92), Y(0.88));
  g.bezierCurveTo(X(0.72), Y(0.96), X(0.28), Y(0.96), X(0.08), Y(0.88));
  g.closePath();
  const grad = g.createLinearGradient(X(0), Y(0), X(0), Y(1));
  grad.addColorStop(0, alive ? 'rgba(140,255,112,0.92)' : 'rgba(140,255,112,0.28)');
  grad.addColorStop(1, alive ? 'rgba(20,96,47,0.92)' : 'rgba(20,96,47,0.28)');
  g.fillStyle = grad;
  g.fill();
  g.strokeStyle = alive ? 'rgba(54,224,90,0.9)' : 'rgba(54,224,90,0.3)';
  g.lineWidth = Math.max(1, size * 0.03);
  g.stroke();
  for (const ex of [0.36, 0.64]) {
    g.beginPath();
    g.arc(X(ex), Y(0.42), size * 0.075, 0, Math.PI * 2);
    g.fillStyle = alive ? '#0a1a0e' : 'rgba(10,26,14,0.4)';
    g.fill();
    g.beginPath();
    g.arc(X(ex + 0.02), Y(0.39), size * 0.026, 0, Math.PI * 2);
    g.fillStyle = alive ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)';
    g.fill();
  }
  g.restore();
}
