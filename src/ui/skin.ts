/**
 * THE SKIN — crystal & hex, on glass.
 *
 * Every tower on the floor is dark glass with its edges traced in neon,
 * standing on a glowing hex pad. The menus are made of the same stuff:
 * a pane of the same black glass, its corners CUT like a crystal's facets
 * (never rounded), its edge traced in neon, a faint hex lattice in the
 * glass the way the pads are drawn on the floor. One palette, taken off
 * the room:
 *
 *   CORE GOLD    the thing you defend: the accent, the CTA, the coins
 *   TIDE MAGENTA the thing that wants it: danger, enemies, the fall
 *   each TOWER   its own neon wherever it is named (NEON in factory/neon)
 *
 * This file only draws primitives — shapes, edges, gauges, coins, pips —
 * so the board, the cards, the tower panel and the palm all paint with
 * the same hand. Layout lives with each panel; the look lives here.
 */

import { NEON } from '../factory/neon.js';
import type { UnitType } from '../config.js';
import { font } from './fonts.js';

/** The palette. Text tiers are bright on purpose: a headset panel is a
 *  small emissive rectangle in a real room, not a page in an office. */
export const SKIN = {
  /* Glass */
  glassTop: 'rgba(17,21,34,0.95)',
  glassBot: 'rgba(6,8,14,0.95)',
  well: 'rgba(0,0,0,0.34)',
  wellEdge: 'rgba(150,175,255,0.10)',
  lattice: 'rgba(150,180,255,0.045)',
  /* Structure — cool steel hairlines, the glass's own edges. */
  line: 'rgba(160,185,255,0.18)',
  lineHi: 'rgba(190,210,255,0.42)',
  lineFaint: 'rgba(160,185,255,0.09)',
  /* Text */
  text: '#ffffff',
  dim: 'rgba(222,230,255,0.76)',
  faint: 'rgba(205,215,245,0.54)',
  disabled: 'rgba(205,215,245,0.32)',
  /* The two sides */
  gold: '#ffcf3a',
  goldHi: '#ffe58a',
  goldDeep: '#f5a90f',
  onGold: '#1d1403',
  magenta: '#ff2bd6',
  magentaSoft: '#ff6fe2',
  /* Semantic */
  positive: '#3dffb0',
  warn: '#ffb454',
  info: '#9fe6ff',
};

/** `#rrggbb` + alpha → `rgba()`. */
export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}

/** A machine's neon, as CSS. */
export function neonOf(type: UnitType | 'delete'): string {
  return `#${(NEON[type] ?? 0xffffff).toString(16).padStart(6, '0')}`;
}

/* ── shapes ─────────────────────────────────────────────────────────────── */

/** A rectangle with its four corners cut at 45° — the crystal's facet. */
export function chamfer(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: number): void {
  const k = Math.max(0, Math.min(c, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + k, y);
  g.lineTo(x + w - k, y);
  g.lineTo(x + w, y + k);
  g.lineTo(x + w, y + h - k);
  g.lineTo(x + w - k, y + h);
  g.lineTo(x + k, y + h);
  g.lineTo(x, y + h - k);
  g.lineTo(x, y + k);
  g.closePath();
}

/** A hexagon about (cx, cy), radius r to its points. `flat` puts a flat
 *  edge on top (the floor pads' orientation seen from above). */
export function hexPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, flat = true): void {
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + (flat ? 0 : Math.PI / 6);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

/* ── the glass ──────────────────────────────────────────────────────────── */

/** One cached tile of hex lattice, laid as a pattern. */
const latticeCache = new Map<string, HTMLCanvasElement>();
function latticeTile(r: number, color: string): HTMLCanvasElement {
  const key = `${r}|${color}`;
  let c = latticeCache.get(key);
  if (c) return c;
  // A flat-topped hex grid repeats every 3r across and √3·r down.
  const w = Math.round(3 * r);
  const h = Math.round(Math.sqrt(3) * r);
  c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.strokeStyle = color;
  g.lineWidth = 1.25;
  const cells: Array<[number, number]> = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
    [w / 2, h / 2],
  ];
  for (const [x, y] of cells) {
    hexPath(g, x, y, r);
    g.stroke();
  }
  latticeCache.set(key, c);
  return c;
}

/** Lay the hex lattice over whatever path is current (call inside a
 *  save/clip). Fades out toward the bottom so the lattice reads as light
 *  in the glass, not wallpaper. */
export function lattice(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r = 26,
  color = SKIN.lattice,
): void {
  const pat = g.createPattern(latticeTile(r, color), 'repeat');
  if (!pat) return;
  g.save();
  g.fillStyle = pat;
  g.fillRect(x, y, w, h);
  // Fade: paint the glass back over the lower part, softly.
  const fade = g.createLinearGradient(0, y, 0, y + h);
  fade.addColorStop(0, 'rgba(6,8,14,0)');
  fade.addColorStop(0.55, 'rgba(6,8,14,0.35)');
  fade.addColorStop(1, 'rgba(6,8,14,0.75)');
  g.fillStyle = fade;
  g.fillRect(x, y, w, h);
  g.restore();
}

/**
 * A PANE: the whole surface of a panel. Chamfered glass with a lattice
 * in it, a soft light pooled under the top edge, a steel hairline inset,
 * and the neon edge traced round it — brightest at the two cut corners
 * that carry the facets, the way light catches a cut edge.
 */
export function pane(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { cut?: number; accent?: string; lattice?: boolean; glow?: number } = {},
): void {
  const cut = opts.cut ?? Math.max(14, Math.min(34, Math.min(w, h) * 0.05));
  const accent = opts.accent ?? SKIN.gold;
  g.save();
  chamfer(g, x, y, w, h, cut);
  const body = g.createLinearGradient(0, y, 0, y + h);
  body.addColorStop(0, SKIN.glassTop);
  body.addColorStop(1, SKIN.glassBot);
  g.fillStyle = body;
  g.fill();
  g.save();
  g.clip();
  if (opts.lattice !== false) lattice(g, x, y, w, h, Math.max(14, Math.round(Math.min(w, h) / 18)));
  // The light pooled under the top edge, in the accent.
  const pool = g.createRadialGradient(x + w / 2, y, 0, x + w / 2, y, Math.max(w, h) * 0.6);
  pool.addColorStop(0, rgba(accent, 0.1));
  pool.addColorStop(1, rgba(accent, 0));
  g.fillStyle = pool;
  g.fillRect(x, y, w, h);
  g.restore();

  // Steel hairline, inset.
  const ins = Math.max(5, cut * 0.32);
  chamfer(g, x + ins, y + ins, w - ins * 2, h - ins * 2, cut - ins * 0.6);
  g.strokeStyle = SKIN.lineFaint;
  g.lineWidth = 1.5;
  g.stroke();

  // The neon edge.
  chamfer(g, x, y, w, h, cut);
  g.shadowColor = accent;
  g.shadowBlur = opts.glow ?? 16;
  g.strokeStyle = rgba(accent, 0.62);
  g.lineWidth = 2.5;
  g.stroke();
  g.shadowBlur = 0;

  // The two lit facets: top-left and bottom-right cut corners, full neon.
  g.strokeStyle = accent;
  g.lineWidth = 4;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x, y + cut + 26);
  g.lineTo(x, y + cut);
  g.lineTo(x + cut, y);
  g.lineTo(x + cut + 26, y);
  g.moveTo(x + w, y + h - cut - 26);
  g.lineTo(x + w, y + h - cut);
  g.lineTo(x + w - cut, y + h);
  g.lineTo(x + w - cut - 26, y + h);
  g.stroke();
  g.lineCap = 'butt';
  g.restore();
}

/** A WELL: a recessed bay inside a pane, for a group of readouts or a
 *  block of reading. Darker than the glass, with a hairline edge. */
export function well(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  cut = 12,
  edge: string = SKIN.wellEdge,
): void {
  chamfer(g, x, y, w, h, cut);
  g.fillStyle = SKIN.well;
  g.fill();
  g.strokeStyle = edge;
  g.lineWidth = 1.5;
  g.stroke();
}

/* ── type ───────────────────────────────────────────────────────────────── */

/** A small-caps tracked label — what names a readout or a section. */
export function caps(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  opts: { px?: number; color?: string; align?: CanvasTextAlign; track?: number; weight?: 500 | 600 | 700; max?: number } = {},
): number {
  g.font = font(opts.weight ?? 600, opts.px ?? 18);
  g.letterSpacing = `${opts.track ?? 3}px`;
  g.fillStyle = opts.color ?? SKIN.faint;
  g.textAlign = opts.align ?? 'left';
  const w = g.measureText(text).width;
  if (opts.max) g.fillText(text, x, y, opts.max);
  else g.fillText(text, x, y);
  g.letterSpacing = '0px';
  return w;
}

/**
 * A SECTION HEAD: a tracked label with a hairline running off it to
 * `x1`, ending in a small hex — how a pane is divided without boxes.
 */
export function rule(
  g: CanvasRenderingContext2D,
  text: string,
  x0: number,
  x1: number,
  y: number,
  color: string = SKIN.faint,
  px = 18,
): void {
  g.textBaseline = 'middle';
  const w = text ? caps(g, text, x0, y, { px, color }) + 14 : 0;
  g.strokeStyle = SKIN.line;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(x0 + w, y);
  g.lineTo(x1 - 12, y);
  g.stroke();
  hexPath(g, x1 - 5, y, 5);
  g.fillStyle = SKIN.lineHi;
  g.fill();
}

/** A centred TITLE with tapering neon either side and a hex at each end
 *  — the panel's name plate. */
export function titleBar(
  g: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  opts: { px?: number; color?: string; accent?: string; span?: number } = {},
): void {
  const px = opts.px ?? 44;
  const accent = opts.accent ?? SKIN.gold;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font(700, px);
  g.letterSpacing = `${Math.round(px * 0.09)}px`;
  const w = g.measureText(text).width;
  g.fillStyle = opts.color ?? SKIN.text;
  g.shadowColor = rgba(accent, 0.55);
  g.shadowBlur = 14;
  g.fillText(text, cx, y);
  g.shadowBlur = 0;
  g.letterSpacing = '0px';
  // The flanking lines take what room the plate leaves them.
  const room = Math.min(cx, g.canvas.width - cx) - w / 2 - 60;
  const span = Math.min(opts.span ?? 110, room);
  if (span < 16) return;
  for (const dir of [-1, 1]) {
    const a = cx + dir * (w / 2 + 20);
    const b = a + dir * span;
    const grad = g.createLinearGradient(a, 0, b, 0);
    grad.addColorStop(0, rgba(accent, 0.9));
    grad.addColorStop(1, rgba(accent, 0));
    g.strokeStyle = grad;
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(a, y);
    g.lineTo(b, y);
    g.stroke();
    hexPath(g, a + dir * -2, y, 5);
    g.fillStyle = accent;
    g.fill();
  }
}

/* ── tokens ─────────────────────────────────────────────────────────────── */

/** A COIN: a gold hex with a hex hole, the purse's mark. */
export function coin(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string = SKIN.gold): void {
  g.save();
  g.shadowColor = rgba(color, 0.7);
  g.shadowBlur = r * 0.9;
  hexPath(g, cx, cy, r, false);
  g.fillStyle = color;
  g.fill();
  g.shadowBlur = 0;
  hexPath(g, cx, cy, r * 0.46, false);
  g.fillStyle = 'rgba(20,14,2,0.78)';
  g.fill();
  g.restore();
}

/** A PRICE: a coin and a figure, laid from `x` (align left) or ending at
 *  `x` (align right) or centred on it. Returns the width drawn. */
export function price(
  g: CanvasRenderingContext2D,
  n: number | string,
  x: number,
  y: number,
  opts: { px?: number; color?: string; align?: CanvasTextAlign; coinColor?: string; weight?: 500 | 600 | 700 } = {},
): number {
  const px = opts.px ?? 24;
  const text = typeof n === 'number' ? n.toLocaleString('en-US') : n;
  g.font = font(opts.weight ?? 700, px);
  g.textBaseline = 'middle';
  const tw = g.measureText(text).width;
  const r = px * 0.36;
  const gap = px * 0.28;
  const total = r * 2 + gap + tw;
  const left = opts.align === 'right' ? x - total : opts.align === 'center' ? x - total / 2 : x;
  coin(g, left + r, y, r, opts.coinColor ?? SKIN.gold);
  g.textAlign = 'left';
  g.fillStyle = opts.color ?? SKIN.goldHi;
  g.fillText(text, left + r * 2 + gap, y + px * 0.04);
  return total;
}

/**
 * THE CORE'S GAUGE: ten slanted segments, the same ten the slim gauge
 * over the core in the room is cut into. Lit in gold while it's healthy,
 * warn as it thins, magenta when the tide is nearly in.
 */
export function coreGauge(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number): void {
  const n = 10;
  const gap = Math.max(2, w * 0.012);
  const slant = h * 0.45;
  const sw = (w - gap * (n - 1) - slant) / n;
  const lit = Math.ceil(Math.max(0, Math.min(1, frac)) * n - 1e-6);
  const color = frac > 0.5 ? SKIN.positive : frac > 0.25 ? SKIN.warn : SKIN.magenta;
  for (let k = 0; k < n; k++) {
    const sx = x + k * (sw + gap);
    g.beginPath();
    g.moveTo(sx + slant, y);
    g.lineTo(sx + slant + sw, y);
    g.lineTo(sx + sw, y + h);
    g.lineTo(sx, y + h);
    g.closePath();
    if (k < lit) {
      g.shadowColor = color;
      g.shadowBlur = h * 0.8;
      g.fillStyle = color;
      g.fill();
      g.shadowBlur = 0;
    } else {
      g.fillStyle = 'rgba(160,185,255,0.12)';
      g.fill();
    }
  }
}

/** LEVEL PIPS: one hex per level, lit in the tower's neon up to `level`. */
export function pips(
  g: CanvasRenderingContext2D,
  x: number,
  cy: number,
  count: number,
  level: number,
  color: string,
  r = 11,
  pitch = r * 2.5,
): void {
  for (let k = 0; k < count; k++) {
    const cx = x + r + k * pitch;
    hexPath(g, cx, cy, r, false);
    if (k < level) {
      g.shadowColor = color;
      g.shadowBlur = r;
      g.fillStyle = color;
      g.fill();
      g.shadowBlur = 0;
    } else {
      g.strokeStyle = 'rgba(190,210,255,0.3)';
      g.lineWidth = 2;
      g.stroke();
    }
  }
}

/** A HEX PAD: the glowing floor pad a picture stands on — a tinted hex
 *  with a neon rim and light pooled in it. */
export function hexPad(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string, live = true): void {
  g.save();
  hexPath(g, cx, cy, r);
  const pool = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  pool.addColorStop(0, rgba(color, live ? 0.26 : 0.06));
  pool.addColorStop(1, rgba(color, live ? 0.04 : 0.01));
  g.fillStyle = pool;
  g.fill();
  if (live) {
    g.shadowColor = color;
    g.shadowBlur = r * 0.25;
  }
  g.strokeStyle = rgba(color, live ? 0.75 : 0.18);
  g.lineWidth = Math.max(1.5, r * 0.04);
  g.stroke();
  g.shadowBlur = 0;
  hexPath(g, cx, cy, r * 0.78);
  g.strokeStyle = rgba(color, live ? 0.22 : 0.07);
  g.lineWidth = 1.25;
  g.stroke();
  g.restore();
}

/** A STATUS DOT: a small lit hex. */
export function dot(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  g.save();
  g.shadowColor = color;
  g.shadowBlur = r * 1.6;
  hexPath(g, cx, cy, r, false);
  g.fillStyle = color;
  g.fill();
  g.restore();
}
