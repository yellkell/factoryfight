/**
 * Canvas panel kit — the menu surface language, raycast by the controller
 * lasers. One canvas per panel, and a hit-test maps a ray intersection's
 * UV back to the button under it. Carried over whole from RAVE RAID —
 * the board earned its discipline there — and re-accented for the shop:
 * the one accent is furnace amber now, and the glass floats over YOUR
 * room instead of a void, which it was built dark enough to survive.
 *
 * THE LOOK is the floor's: crystal & hex (ui/skin.ts draws it). Each panel
 * is a pane of the towers' black glass with its corners cut like facets,
 * a faint hex lattice in it, and its edge traced in neon — core gold by
 * default, or the neon of whatever the panel is about (a tower's panel
 * wears the tower's colour; the fall wears the tide's magenta). Buttons
 * are cut plates of the same glass; the ONE primary CTA a screen is
 * allowed is solid gold and the only thing that glows hard. Weight and
 * tracking do the hierarchy work (see ui/fonts.ts).
 *
 * THE MOTION (why this class owns a tick): state changes ease instead of
 * snapping — hover in ~100 ms, out ~180 ms, a press flash decaying over
 * ~150 ms, open/close as a 4% scale + fade at the MESH level. Canvas
 * repaints (a full texture upload) happen only while one of those brief
 * transitions is actually running; at rest the texture is static and the
 * only living thing is the under-halo's opacity leaning into the plant's
 * idle chug — material-level, upload-free.
 */

import {
  AdditiveBlending,
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
  SRGBColorSpace,
} from 'three';
import { font, onFontsReady } from './fonts.js';
import { SKIN, chamfer, pane, rgba, titleBar } from './skin.js';

export interface PanelButton {
  id: string;
  label: string;
  sub?: string;
  disabled?: boolean;
  /** Canvas-space rect. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Smaller type for dense rows. */
  small?: boolean;
  /** Hit-testable but NOT drawn — the body paints its own visual (job
   *  rows, custom widgets); label/sub are ignored. */
  ghost?: boolean;
  /** THE primary CTA — the one solid accent fill its screen is allowed. */
  primary?: boolean;
  /** Persistent selected state: accent edge-tick + accent hairline. */
  selected?: boolean;
  /** Semantic tint for the LABEL text only (danger/info/warn/positive) —
   *  the plate itself stays neutral. */
  tone?: string;
  /** A live value chip: not clickable, but styled as data, not as a dead
   *  button (a `disabled` grey reads as "broken"). */
  display?: boolean;
  /** Explicit label px when the two standard sizes don't fit. */
  px?: number;
  /**
   * A PICTURE ON THE BUTTON. Draw whatever you like into a square of
   * `size` at (x, y); the kit reserves the top of the plate for it and
   * drops the label underneath. `dead` is true when the button is
   * disabled, so a glyph can grey itself out with the rest of the plate.
   *
   * A callback rather than an id, so the kit never has to know what a
   * MAKER is — ui/icons.ts draws those, and this only makes room.
   */
  glyph?: (
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    dead: boolean,
  ) => void;
}

export const UI = {
  /* Surfaces */
  panel: SKIN.glassBot,
  well: SKIN.well,
  plate: 'rgba(150,175,255,0.06)',
  plateHover: 'rgba(150,175,255,0.12)',
  /* Hairlines */
  line: SKIN.line,
  lineHover: SKIN.lineHi,
  lineFaint: SKIN.lineFaint,
  /* Text. The whites are WHITE — a headset panel is a small emissive
   *  rectangle hanging in a real room, not a page in an office: every
   *  tier here is a step brighter than its web equivalent, or the
   *  secondary type reads as disabled and the disabled type as absent. */
  text: SKIN.text,
  textHi: SKIN.text,
  dim: SKIN.dim,
  faint: SKIN.faint,
  disabled: SKIN.disabled,
  /* The accent — CORE GOLD: identity, selection, primacy. */
  accent: SKIN.gold,
  accentDim: rgba(SKIN.gold, 0.55),
  accentFaint: rgba(SKIN.gold, 0.12),
  onAccent: SKIN.onGold,
  /* Semantic roles. Danger is the TIDE's magenta: the thing that wants
   *  the core is the colour of everything that costs you. */
  positive: SKIN.positive,
  info: SKIN.info,
  warn: SKIN.warn,
  danger: SKIN.magenta,
};

/* ── motion (research-tuned: M3/Carbon durations, VR-safe amplitudes) ── */
const HOVER_IN_S = 0.1;
const HOVER_OUT_S = 0.18;
const FLASH_S = 0.15;
const OPEN_S = 0.26;
const CLOSE_S = 0.16;
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const easeOutQuint = (t: number): number => 1 - (1 - t) ** 5;
const easeInQuad = (t: number): number => t * t;
const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));

/** One shared soft-halo texture: a blurred rounded block, tinted per panel
 *  by material colour, opacity animated per frame (never re-uploaded). */
let haloTex: CanvasTexture | null = null;
function halo(): CanvasTexture {
  if (haloTex) return haloTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.shadowColor = 'rgba(255,255,255,1)';
  g.shadowBlur = 46;
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.beginPath();
  g.roundRect(58, 58, 140, 140, 26);
  g.fill();
  haloTex = new CanvasTexture(c);
  haloTex.colorSpace = SRGBColorSpace;
  return haloTex;
}

const _poke = new Vector3();
const _pokeScale = new Vector3();

export class Panel {
  readonly group = new Group();
  readonly mesh: Mesh;
  private mat: MeshBasicMaterial;
  private glowMat: MeshBasicMaterial;
  private canvas = document.createElement('canvas');
  private tex: CanvasTexture;
  private buttons: PanelButton[] = [];
  private pxW: number;
  private pxH: number;
  /** The neon this pane is traced in (see setAccent). */
  private accent: string = SKIN.gold;

  /* Stored paint args, so transitions can repaint without the caller. */
  private title = '';
  private body: ((g: CanvasRenderingContext2D) => void) | null = null;
  private hover: string | null = null;

  /* Transition state. */
  private hoverAmt = new Map<string, number>();
  private flashId: string | null = null;
  private flashAmt = 0;
  private shown = true;
  private showP = 1;
  private animating = false;

  constructor(widthM: number, heightM: number, pxW = 1024, pxH = 1024) {
    this.pxW = pxW;
    this.pxH = pxH;
    this.canvas.width = pxW;
    this.canvas.height = pxH;
    this.tex = new CanvasTexture(this.canvas);
    // Painted colours must survive to the eye: without the sRGB tag the
    // renderer re-encodes linear reads and every dark washes out.
    this.tex.colorSpace = SRGBColorSpace;
    this.mat = new MeshBasicMaterial({
      map: this.tex,
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
    });
    this.mesh = new Mesh(new PlaneGeometry(widthM, heightM), this.mat);
    // Menus win the draw fight against the additive FX behind them.
    this.mesh.renderOrder = 30;
    this.group.add(this.mesh);

    // The under-halo: the panel's presence in a real room, and the one
    // element allowed to lean into the chug (opacity only — no upload).
    this.glowMat = new MeshBasicMaterial({
      map: halo(),
      transparent: true,
      opacity: 0.12,
      side: DoubleSide,
      depthWrite: false,
      blending: AdditiveBlending,
      color: 0xffcf3a,
    });
    const glow = new Mesh(new PlaneGeometry(widthM * 1.42, heightM * 1.56), this.glowMat);
    glow.renderOrder = 29;
    glow.position.z = -0.005;
    this.group.add(glow);

    // First paint may land before the woff2s do — repaint on arrival.
    onFontsReady(() => {
      if (this.body || this.buttons.length) this.draw();
    });
  }

  /**
   * The neon this pane is traced in: its edge, its lit facets, the light
   * pooled under its top edge, and the halo behind it in the room. A
   * tower's panel wears the tower's colour, so the panel and the thing
   * you touched are plainly one object.
   */
  setAccent(hex: string): void {
    if (hex === this.accent) return;
    this.accent = hex;
    this.glowMat.color.set(hex);
    if (this.body || this.buttons.length) this.draw();
  }

  ctx(): CanvasRenderingContext2D {
    return this.canvas.getContext('2d')!;
  }

  /**
   * Draw this panel as ONE PIECE, over everything.
   *
   * Panels normally respect the room's depth: something solid in front
   * of one occludes it, which is right for a card you walk around. The
   * finale card meets a creature whose body is transparent (no depth
   * written) but whose EYES are solid, so it came out half in front of
   * the goop and half behind — the sign and the thing it congratulates
   * you for, arguing. A credits plate is a sign held up to your face,
   * not furniture: it wins, whole, or it steps aside (MenuSystem's
   * plantClear does the stepping).
   */
  alwaysOnTop(): void {
    for (const child of this.group.children) {
      if (!(child instanceof Mesh)) continue;
      const mat = child.material as MeshBasicMaterial;
      mat.depthTest = false;
      mat.needsUpdate = true;
      child.renderOrder += 20;
    }
  }

  /** The ids currently painted on this panel — headless probes read it to
   *  ask what a card is offering without matching pixels. */
  buttonIds(): string[] {
    return this.buttons.map((b) => b.id);
  }

  /** Where every control actually sits, in panel pixels. A walk can then
   *  assert the thing a headset sees — nothing overlapping, nothing off
   *  the edge — which is the class of bug that reads as "the text was
   *  obscured by stuff" and is otherwise invisible to a state check. */
  buttonRects(): Array<{ id: string; x: number; y: number; w: number; h: number }> {
    return this.buttons.map((b) => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h }));
  }

  /** What each control reads, in order — some state only shows up in a
   *  label (an armed confirm, a count, a price). */
  buttonLabels(): string[] {
    return this.buttons.map((b) => b.label);
  }

  /** The panel's pixel canvas size — the frame those rects live in. */
  layout(): { w: number; h: number } {
    return { w: this.pxW, h: this.pxH };
  }

  /** Repaint: frame + title, then the caller's body, then the button set.
   *  Also the hover hand-off: eased highlights start/retarget here. */
  paint(
    title: string,
    body: (g: CanvasRenderingContext2D) => void,
    buttons: PanelButton[],
    hover: string | null,
  ): void {
    this.title = title;
    this.body = body;
    this.buttons = buttons;
    this.hover = hover;
    this.animating = true; // hover targets may have moved — let tick settle it
    this.draw();
  }

  /** Press feedback: a bright flash on `id`, decaying over ~150 ms. */
  press(id: string): void {
    this.flashId = id;
    this.flashAmt = 1;
    this.animating = true;
  }

  /** Open/close with the mesh-level fade+scale (canvas untouched).
   *  `snap` skips the transition (first-frame setup). */
  setShown(on: boolean, snap = false): void {
    if (this.shown === on && !snap) return;
    this.shown = on;
    if (snap) this.showP = on ? 1 : 0;
    this.applyShow();
  }

  get isShown(): boolean {
    return this.shown;
  }

  /** Eased hover amount (0..1) for a button — bodies that paint their own
   *  widgets (job rows, gauges) read this so THEIR highlights ease on the
   *  same clock as the kit's. */
  hoverOf(id: string): number {
    return this.hoverAmt.get(id) ?? 0;
  }

  /** Advance transitions. `pulse` is the plant's idle envelope (0..1) for
   *  the under-halo; call every frame — a no-op unless something moves. */
  tick(delta: number, pulse = 0): void {
    // Open/close.
    const dir = this.shown ? 1 : -1;
    const dur = this.shown ? OPEN_S : CLOSE_S;
    const p0 = this.showP;
    this.showP = clamp01(this.showP + (dir * delta) / dur);
    if (this.showP !== p0) this.applyShow();

    // The halo breathes with the machine whenever the panel is up.
    const op = easeOutCubic(clamp01(this.showP / 0.7));
    this.glowMat.opacity = (0.15 + 0.07 * pulse) * op;

    if (!this.animating) return;

    // Hover eases + press flash decay → transient canvas repaints.
    let live = false;
    for (const b of this.buttons) {
      const want = this.hover === b.id && !b.disabled && !b.display ? 1 : 0;
      const at = this.hoverAmt.get(b.id) ?? 0;
      if (at === want) continue;
      const rate = want > at ? delta / HOVER_IN_S : delta / HOVER_OUT_S;
      const next = at < want ? Math.min(want, at + rate) : Math.max(want, at - rate);
      this.hoverAmt.set(b.id, next);
      if (next !== want) live = true;
    }
    if (this.flashAmt > 0) {
      this.flashAmt = Math.max(0, this.flashAmt - delta / FLASH_S);
      if (this.flashAmt > 0) live = true;
      else this.flashId = null;
    }
    // Drop hover state for buttons that left the set.
    for (const id of this.hoverAmt.keys()) {
      if (!this.buttons.some((b) => b.id === id)) this.hoverAmt.delete(id);
    }
    this.draw();
    this.animating = live;
  }

  private applyShow(): void {
    const p = this.showP;
    this.group.visible = p > 0.001;
    const s = 0.96 + 0.04 * easeOutQuint(p);
    this.group.scale.setScalar(s);
    this.mat.opacity = this.shown ? easeOutCubic(clamp01(p / 0.7)) : easeInQuad(p);
  }

  /* ── the painter ──────────────────────────────────────────────────────── */

  private draw(): void {
    const g = this.ctx();
    const W = this.pxW;
    const H = this.pxH;
    g.clearRect(0, 0, W, H);

    // The pane: cut glass, lattice, neon edge (ui/skin.ts).
    pane(g, 9, 9, W - 18, H - 18, { accent: this.accent, glow: 10 });

    if (this.title) titleBar(g, this.title, W / 2, 74, { px: 44, accent: this.accent });

    this.body?.(g);

    for (const b of this.buttons) {
      if (b.ghost) continue;
      this.drawButton(g, b);
    }

    this.tex.needsUpdate = true;
  }

  private drawButton(g: CanvasRenderingContext2D, b: PanelButton): void {
    const hov = this.hoverAmt.get(b.id) ?? 0;
    const flash = this.flashId === b.id ? easeOutCubic(this.flashAmt) : 0;
    // The plate's facets scale with it: a thin tab gets a small cut.
    const cut = Math.max(7, Math.min(16, Math.min(b.w, b.h) * 0.2));

    // OWN the text state (bodies leave alignments behind).
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    const labelPx = b.px ?? (b.primary ? 40 : b.small ? 27 : 36);
    // A GLYPH TAKES THE TOP OF THE PLATE. The label then sits under it
    // rather than through the middle of it — which is the whole reason
    // an icon on a button is legible instead of merely present.
    const glyphSize = b.glyph ? Math.min(b.h * 0.5, b.w * 0.52) : 0;
    const labelY = b.glyph
      ? b.y + glyphSize + (b.h - glyphSize) / 2 - (b.sub ? 12 : 0)
      : b.y + b.h / 2 - (b.sub ? 15 : 0);
    const subY = b.glyph ? labelY + 22 : b.y + b.h / 2 + 24;
    const drawGlyph = (dead: boolean): void => {
      if (!b.glyph) return;
      b.glyph(g, b.x + (b.w - glyphSize) / 2, b.y + (b.h - glyphSize) * 0.14, glyphSize, dead);
    };
    const tone = b.tone ?? null;

    if (b.display) {
      // A value chip: a recessed well, live text, no edge to press.
      chamfer(g, b.x, b.y, b.w, b.h, cut);
      g.fillStyle = SKIN.well;
      g.fill();
      g.strokeStyle = SKIN.lineFaint;
      g.lineWidth = 1.5;
      g.stroke();
      drawGlyph(false);
      g.fillStyle = tone ?? UI.text;
      g.font = font(600, labelPx);
      g.letterSpacing = '1.5px';
      g.fillText(b.label, b.x + b.w / 2, labelY, b.w - 28);
      g.letterSpacing = '0px';
      if (b.sub) {
        g.font = font(500, 21);
        g.fillStyle = UI.dim;
        g.fillText(b.sub, b.x + b.w / 2, subY, b.w - 28);
      }
      return;
    }

    if (b.primary && !b.disabled) {
      // THE CTA — the screen's one solid fill, and its one hard glow: a
      // bar of core gold, cut at the corners like everything else.
      chamfer(g, b.x, b.y, b.w, b.h, cut);
      const grad = g.createLinearGradient(0, b.y, 0, b.y + b.h);
      grad.addColorStop(0, SKIN.goldHi);
      grad.addColorStop(0.5, SKIN.gold);
      grad.addColorStop(1, SKIN.goldDeep);
      g.shadowColor = rgba(SKIN.gold, 0.8);
      g.shadowBlur = 20 + 12 * hov + 14 * flash;
      g.fillStyle = grad;
      g.fill();
      g.shadowBlur = 0;
      // A facet of light across the top third gives the bar its cut.
      g.save();
      g.clip();
      g.fillStyle = 'rgba(255,255,255,0.2)';
      g.beginPath();
      g.moveTo(b.x, b.y);
      g.lineTo(b.x + b.w, b.y);
      g.lineTo(b.x + b.w, b.y + b.h * 0.22);
      g.lineTo(b.x, b.y + b.h * 0.42);
      g.closePath();
      g.fill();
      if (hov > 0 || flash > 0) {
        g.fillStyle = `rgba(255,255,255,${(0.14 * hov + 0.2 * flash).toFixed(3)})`;
        g.fillRect(b.x, b.y, b.w, b.h);
      }
      g.restore();
      // Chevrons either side of the word: this is the way on.
      g.font = font(700, labelPx);
      g.letterSpacing = '2px';
      const tw = Math.min(b.w - 120, g.measureText(b.label).width);
      if (b.w - tw > 150) {
        g.fillStyle = 'rgba(29,20,3,0.55)';
        const cy = labelY;
        const s = labelPx * 0.22;
        for (const dir of [-1, 1]) {
          const cx = b.x + b.w / 2 + dir * (tw / 2 + 30);
          for (let k = 0; k < 2; k++) {
            const ox = cx + dir * k * s * 1.4;
            g.beginPath();
            g.moveTo(ox - dir * s * 0.6, cy - s);
            g.lineTo(ox + dir * s * 0.4, cy);
            g.lineTo(ox - dir * s * 0.6, cy + s);
            g.lineWidth = 3;
            g.strokeStyle = 'rgba(29,20,3,0.55)';
            g.stroke();
          }
        }
      }
      drawGlyph(false);
      g.fillStyle = UI.onAccent;
      g.fillText(b.label, b.x + b.w / 2, labelY, b.w - 32);
      g.letterSpacing = '0px';
      if (b.sub) {
        g.font = font(600, 22);
        g.fillStyle = 'rgba(29,20,3,0.78)';
        g.fillText(b.sub, b.x + b.w / 2, subY, b.w - 32);
      }
      return;
    }

    // A cut plate of glass: neutral, selected, toned, or refused. Its
    // edge takes the tone (a magenta QUIT is magenta-edged) and lights in
    // the pane's neon as a finger or a ray comes onto it.
    const edgeHue = b.selected ? this.accent : (tone ?? this.accent);
    chamfer(g, b.x, b.y, b.w, b.h, cut);
    const plate = g.createLinearGradient(0, b.y, 0, b.y + b.h);
    if (b.disabled) {
      plate.addColorStop(0, 'rgba(150,175,255,0.035)');
      plate.addColorStop(1, 'rgba(150,175,255,0.015)');
    } else if (b.selected) {
      plate.addColorStop(0, rgba(this.accent, 0.2));
      plate.addColorStop(1, rgba(this.accent, 0.07));
    } else {
      plate.addColorStop(0, `rgba(150,175,255,${(0.085 + 0.06 * hov).toFixed(3)})`);
      plate.addColorStop(1, `rgba(150,175,255,${(0.03 + 0.04 * hov).toFixed(3)})`);
    }
    g.fillStyle = plate;
    g.fill();
    if (flash > 0) {
      g.fillStyle = rgba(edgeHue, 0.25 * flash);
      g.fill();
    }
    if (b.disabled) {
      g.strokeStyle = 'rgba(160,185,255,0.07)';
      g.lineWidth = 1.5;
      g.stroke();
    } else {
      const lit = b.selected ? 1 : hov;
      if (lit > 0.02) {
        g.shadowColor = edgeHue;
        g.shadowBlur = 12 * lit;
      }
      g.strokeStyle =
        lit > 0.02
          ? rgba(edgeHue, 0.35 + 0.6 * lit)
          : tone
            ? rgba(tone, 0.4)
            : SKIN.line;
      g.lineWidth = b.selected ? 2.5 : 2;
      g.stroke();
      g.shadowBlur = 0;
      // The lit facet: the top-left cut traced bright on the live one.
      if (lit > 0.02) {
        g.globalAlpha = lit;
        g.strokeStyle = edgeHue;
        g.lineWidth = 3.5;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(b.x, b.y + cut + Math.min(18, b.h * 0.25));
        g.lineTo(b.x, b.y + cut);
        g.lineTo(b.x + cut, b.y);
        g.lineTo(b.x + cut + Math.min(28, b.w * 0.2), b.y);
        g.stroke();
        g.lineCap = 'butt';
        g.globalAlpha = 1;
      }
    }

    drawGlyph(Boolean(b.disabled));
    g.fillStyle = b.disabled ? UI.disabled : (tone ?? UI.text);
    g.font = font(600, labelPx);
    g.letterSpacing = '1.5px';
    g.fillText(b.label, b.x + b.w / 2, labelY, b.w - 28);
    g.letterSpacing = '0px';
    if (b.sub) {
      g.font = font(500, 21);
      g.fillStyle = b.disabled ? 'rgba(205,215,245,0.22)' : UI.dim;
      g.fillText(b.sub, b.x + b.w / 2, subY, b.w - 28);
    }
  }

  /** What this panel is currently offering, by id — the pressable ones only
   *  (a value chip is not a button, and neither is something greyed out).
   *  Headless checks ask this instead of hunting for shapes in pixels. */
  liveButtons(): string[] {
    return this.buttons.filter((b) => !b.disabled && !b.display).map((b) => b.id);
  }

  /**
   * THE POKE. Where a fingertip (world point) sits against this panel's
   * face: its UV if it is over the plate, and how far IN FRONT of the
   * face it is (room metres; negative = pushed through). Null when the
   * tip is off the plate's edges. MenuSystem turns a crossing of the
   * face into a press — the whole touch verb.
   */
  pokeAt(world: Vector3): { u: number; v: number; depth: number } | null {
    if (!this.shown || this.showP < 0.9) return null;
    const p = this.mesh.worldToLocal(_poke.copy(world));
    const geo = this.mesh.geometry as PlaneGeometry;
    const w = geo.parameters.width;
    const h = geo.parameters.height;
    if (Math.abs(p.x) > w / 2 || Math.abs(p.y) > h / 2) return null;
    // Depth in ROOM metres, whatever the panel was scaled to.
    const s = this.mesh.getWorldScale(_pokeScale).z;
    return { u: p.x / w + 0.5, v: p.y / h + 0.5, depth: p.z * s };
  }

  /** UV (from a raycast hit) → button id, or null. */
  buttonAt(u: number, v: number): string | null {
    const x = u * this.pxW;
    const y = (1 - v) * this.pxH;
    for (const b of this.buttons) {
      if (b.disabled || b.display) continue;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.id;
    }
    return null;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.map?.dispose();
    this.mat.dispose();
    this.glowMat.dispose();
  }
}
