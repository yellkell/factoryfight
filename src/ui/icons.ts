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
  // Photographs carry air round the subject; draw them a third larger
  // about the same centre so the machine fills the slot a drawing did.
  const big = size * 1.3;
  g.drawImage(pic, x - (big - size) / 2, y - (big - size) / 2, big, big);
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
