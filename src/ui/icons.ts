/**
 * THE GLYPHS — every machine and every part, as a PHOTOGRAPH.
 *
 * TUBES drew these as line-art shop drawings. FACTORY FIGHT's machines
 * are neon, and a drawing of a neon machine is a lie about it — so the
 * drawings are gone, and every glyph is now the studio's photograph of
 * the real thing (ui/pictures.ts), built by the same builder the floor
 * uses. The function names stayed, so every menu that asked for a glyph
 * now gets a picture without knowing it.
 *
 * A refused tool (GLYPH_DEAD) is the same photograph, drained of colour
 * and dimmed: you still recognise the machine you can't afford yet.
 */

import type { ItemId, UnitType } from '../config.js';
import { picture, type PictureId } from './pictures.js';

/** How a glyph is shown: live, or refused. (The fields are what the
 *  line-art kit inked with; they survive as the live/dead flag.) */
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

/** Where the subject actually sits in each photograph (its lit pixels),
 *  measured once: a photograph carries air round the subject, and the
 *  core floats over its pad with a gap in between, so "the square" is a
 *  poor guide to where the machine is. */
const bounds = new Map<PictureId, { x: number; y: number; w: number; h: number }>();
function boundsOf(id: PictureId, pic: HTMLCanvasElement): { x: number; y: number; w: number; h: number } {
  let b = bounds.get(id);
  if (b) return b;
  const W = pic.width;
  const H = pic.height;
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  try {
    const d = pic.getContext('2d')!.getImageData(0, 0, W, H).data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (d[(y * W + x) * 4 + 3] < 24) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  } catch {
    /* a tainted canvas: fall back to the whole frame */
  }
  b = x1 < 0 ? { x: 0, y: 0, w: W, h: H } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  bounds.set(id, b);
  return b;
}

function draw(
  g: CanvasRenderingContext2D,
  id: PictureId,
  x: number,
  y: number,
  size: number,
  ink: GlyphInk,
): void {
  const pic = picture(id);
  if (!pic) return;
  g.save();
  if (ink === GLYPH_DEAD) {
    g.globalAlpha = 0.38;
    g.filter = 'grayscale(1)';
  }
  // FIT THE SUBJECT, not the photograph: the machine's own lit pixels are
  // scaled to fill the square and centred in it, so a picture never spills
  // past its slot onto the words under it (the core's pad used to sit
  // right on top of its name).
  const b = boundsOf(id, pic);
  const k = size / Math.max(b.w, b.h);
  const dw = b.w * k;
  const dh = b.h * k;
  g.drawImage(pic, b.x, b.y, b.w, b.h, x + (size - dw) / 2, y + (size - dh) / 2, dw, dh);
  g.restore();
}

/** A machine's photograph, in a `size` square with its top-left at
 *  (x, y). Pass GLYPH_DEAD for anything the catalogue is refusing. */
export function unitGlyph(
  g: CanvasRenderingContext2D,
  id: GlyphId,
  x: number,
  y: number,
  size: number,
  ink: GlyphInk = GLYPH_LIVE,
): void {
  draw(g, id, x, y, size, ink);
}

/** A part's photograph, to the same grid. */
export function itemGlyph(
  g: CanvasRenderingContext2D,
  item: ItemId,
  x: number,
  y: number,
  size: number,
  ink: GlyphInk = GLYPH_LIVE,
): void {
  draw(g, item, x, y, size, ink);
}
