/**
 * THE TOWER CARD — one tower, as the menus show it: its photograph
 * standing on a hex pad in its own neon, its name, and its price.
 *
 * The board's arsenal, the siege card's BUILD page and the tiles on your
 * palm are all this one drawing at different sizes, so a tower looks the
 * same wherever you meet it — and the same as the thing on your floor.
 */

import { GLYPH_DEAD, GLYPH_LIVE, unitGlyph, type GlyphId } from './icons.js';
import { font } from './fonts.js';
import { SKIN, caps, chamfer, hexPad, neonOf, price, rgba } from './skin.js';

export interface TowerCardOpts {
  tool: GlyphId;
  name: string;
  /** A short line under the name, in the tower's neon. */
  role?: string;
  /** Coins to build; omit for none (the core is free). */
  cost?: number;
  /** In place of a price — what to do with it ("PLACE IT"). */
  note?: string;
  /** Where the price sits: over the picture's corner, or under the name. */
  costAt?: 'corner' | 'foot';
  /** Can it be had right now? A refused card is the same card, drained. */
  live?: boolean;
  /** Is it in your hand? */
  armed?: boolean;
  /** 0..1 eased hover, and a 0..1 press flash. */
  hover?: number;
  flash?: number;
  /** Text scale against the card's width (1 = the default). */
  scale?: number;
  /** 'stack' (picture over words, the default) or 'row' (picture left,
   *  words right) — for a card wider than it is tall. */
  layout?: 'stack' | 'row';
}

export function towerCard(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  o: TowerCardOpts,
): void {
  const hue = neonOf(o.tool === 'unplug' ? 'delete' : (o.tool as Parameters<typeof neonOf>[0]));
  const live = o.live !== false;
  const hov = o.hover ?? 0;
  const flash = o.flash ?? 0;
  const armed = Boolean(o.armed);
  const cut = Math.max(8, Math.min(16, w * 0.09));
  const k = (o.scale ?? 1) * Math.max(0.6, Math.min(1.2, w / 190));

  g.save();
  g.textBaseline = 'middle';

  // The plate: tinted glass in the tower's neon, drained when refused.
  chamfer(g, x, y, w, h, cut);
  const plate = g.createLinearGradient(0, y, 0, y + h);
  if (!live) {
    plate.addColorStop(0, 'rgba(150,175,255,0.05)');
    plate.addColorStop(1, 'rgba(150,175,255,0.015)');
  } else {
    plate.addColorStop(0, rgba(hue, armed ? 0.3 : 0.1 + 0.08 * hov));
    plate.addColorStop(1, rgba(hue, armed ? 0.08 : 0.02));
  }
  g.fillStyle = plate;
  g.fill();
  if (flash > 0) {
    g.fillStyle = rgba(hue, 0.3 * flash);
    g.fill();
  }
  const lit = armed ? 1 : hov;
  if (live && lit > 0.02) {
    g.shadowColor = hue;
    g.shadowBlur = 16 * lit;
  }
  g.strokeStyle = !live ? 'rgba(160,185,255,0.12)' : rgba(hue, 0.4 + 0.55 * lit);
  g.lineWidth = armed ? 3.5 : 2;
  g.stroke();
  g.shadowBlur = 0;

  if (o.layout === 'row') {
    rowBody(g, x, y, w, h, o, hue, live, armed);
    g.restore();
    return;
  }

  // The picture, on its pad — in its own band, clear of the words: the
  // band ends well above the name, so nothing it shows (the core's pad,
  // a tall coil) can reach down into the lettering.
  const nameY = y + h - (o.role || o.costAt === 'foot' || o.note ? 52 : 30) * k;
  const top = y + (armed ? 30 : 10) * k;
  const picH = nameY - top - 20 * k;
  const pcx = x + w / 2;
  const pcy = top + picH / 2;
  const pad = Math.min(w * 0.34, picH * 0.5);
  hexPad(g, pcx, pcy, pad, hue, live);
  const size = Math.min(w * 0.6, picH * 0.92);
  unitGlyph(g, o.tool, pcx - size / 2, pcy - size / 2, size, live ? GLYPH_LIVE : GLYPH_DEAD);

  // The name.
  g.textAlign = 'center';
  g.font = font(700, Math.round(24 * k));
  g.letterSpacing = `${Math.max(1, Math.round(2 * k))}px`;
  g.fillStyle = live ? SKIN.text : SKIN.disabled;
  g.fillText(o.name, pcx, nameY, w - 16);
  g.letterSpacing = '0px';

  // Under it: the role, or the price, or what to do.
  const footY = nameY + 27 * k;
  if (o.note) {
    caps(g, o.note, pcx, footY, { px: Math.round(16 * k), color: SKIN.gold, align: 'center', track: 2, max: w - 16 });
  } else if (o.costAt === 'foot' && o.cost !== undefined) {
    price(g, o.cost, pcx, footY, {
      px: Math.round(21 * k),
      align: 'center',
      color: live ? SKIN.goldHi : SKIN.magentaSoft,
      coinColor: live ? SKIN.gold : 'rgba(205,215,245,0.4)',
    });
  } else if (o.role) {
    caps(g, o.role, pcx, footY, { px: Math.round(14 * k), color: live ? hue : SKIN.disabled, align: 'center', track: 2, max: w - 16 });
  }
  if (o.costAt !== 'foot' && o.cost !== undefined) {
    price(g, o.cost, x + w - 12 * k, y + 20 * k, {
      px: Math.round(18 * k),
      align: 'right',
      color: live ? SKIN.goldHi : SKIN.magentaSoft,
      coinColor: live ? SKIN.gold : 'rgba(205,215,245,0.4)',
    });
  }

  // IN HAND: a tab in the tower's neon across the top of the card.
  if (armed) {
    g.font = font(700, Math.round(14 * k));
    g.letterSpacing = '2px';
    const tw = g.measureText('IN HAND').width + 22 * k;
    const th = 20 * k;
    const tx = pcx - tw / 2;
    const ty = y + 5 * k;
    chamfer(g, tx, ty, tw, th, 5);
    g.fillStyle = hue;
    g.fill();
    g.fillStyle = 'rgba(8,10,16,0.9)';
    g.textAlign = 'center';
    g.fillText('IN HAND', pcx + 1, ty + th / 2 + 1);
    g.letterSpacing = '0px';
  }
  g.restore();
}

/** The ROW layout: the picture on its pad down the left, the name and
 *  the price (or role) stacked to its right. */
function rowBody(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  o: TowerCardOpts,
  hue: string,
  live: boolean,
  armed: boolean,
): void {
  const k = o.scale ?? 1;
  const box = Math.min(h - 20, w * 0.42);
  const pcx = x + 10 + box / 2;
  const pcy = y + h / 2;
  hexPad(g, pcx, pcy, box * 0.5, hue, live);
  const size = box * 0.92;
  unitGlyph(g, o.tool, pcx - size / 2, pcy - size / 2, size, live ? GLYPH_LIVE : GLYPH_DEAD);
  const tx = x + box + 22;
  const tw = w - (tx - x) - 10;
  g.textAlign = 'left';
  g.font = font(700, Math.round(22 * k));
  g.letterSpacing = `${Math.max(1, Math.round(2 * k))}px`;
  g.fillStyle = live ? SKIN.text : SKIN.disabled;
  g.fillText(o.name, tx, pcy - 14 * k, tw);
  g.letterSpacing = '0px';
  const footY = pcy + 18 * k;
  if (armed) {
    caps(g, 'IN HAND', tx, footY, { px: Math.round(16 * k), color: hue, track: 2, max: tw });
  } else if (o.note) {
    caps(g, o.note, tx, footY, { px: Math.round(15 * k), color: SKIN.gold, track: 2, max: tw });
  } else if (o.cost !== undefined) {
    price(g, o.cost, tx, footY, {
      px: Math.round(22 * k),
      color: live ? SKIN.goldHi : SKIN.magentaSoft,
      coinColor: live ? SKIN.gold : 'rgba(205,215,245,0.4)',
    });
  } else if (o.role) {
    caps(g, o.role, tx, footY, { px: Math.round(14 * k), color: live ? hue : SKIN.disabled, track: 2, max: tw });
  }
}
