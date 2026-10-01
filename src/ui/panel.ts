/**
 * Canvas panel kit — the menu surface language, raycast by the controller
 * lasers. One canvas per panel, and a hit-test maps a ray intersection's
 * UV back to the button under it. Carried over whole from RAVE RAID —
 * the board earned its discipline there — and re-accented for the shop:
 * the one accent is furnace amber now, and the glass floats over YOUR
 * room instead of a void, which it was built dark enough to survive.
 *
 * THE LOOK (the live-service discipline): quiet near-black glass, white-alpha
 * hairlines, and ONE accent that only marks what matters — the primary CTA,
 * the selected state, the active tab. Semantic colour lives in text and
 * status dots, never in button chrome. Glow is a budget, not a default:
 * the CTA and the under-halo carry it, everything else is matte. Weight and
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
  SRGBColorSpace,
} from 'three';
import { font, onFontsReady } from './fonts.js';

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
  panel: 'rgba(14,11,7,0.92)',
  well: 'rgba(0,0,0,0.32)',
  plate: 'rgba(255,255,255,0.045)',
  plateHover: 'rgba(255,255,255,0.09)',
  /* Hairlines */
  line: 'rgba(255,255,255,0.14)',
  lineHover: 'rgba(255,255,255,0.34)',
  lineFaint: 'rgba(255,255,255,0.10)',
  /* Text. The whites are WHITE — a headset panel is a small emissive
   *  rectangle hanging in a real room, not a page in an office: every
   *  tier here is a step brighter than its web equivalent, or the
   *  secondary type reads as disabled and the disabled type as absent. */
  text: '#ffffff',
  textHi: '#ffffff',
  dim: 'rgba(250,244,235,0.74)',
  faint: 'rgba(250,244,235,0.52)',
  disabled: 'rgba(250,244,235,0.36)',
  /* The accent — identity, selection, primacy. Nothing else. */
  accent: '#ffa22e',
  accentDim: 'rgba(255,162,46,0.55)',
  accentFaint: 'rgba(255,162,46,0.10)',
  onAccent: '#221103',
  /* Semantic roles (text + dots, never chrome) */
  positive: '#2be28a',
  info: '#6fc8ff',
  warn: '#ffb454',
  danger: '#ff5266',
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
      color: 0xffa22e,
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

    // Base glass.
    g.beginPath();
    g.roundRect(6, 6, W - 12, H - 12, 30);
    g.fillStyle = UI.panel;
    g.fill();

    // Top sheen — one soft gradient of depth, in place of a border glow.
    g.save();
    g.clip();
    const sheen = g.createLinearGradient(0, 6, 0, 186);
    sheen.addColorStop(0, 'rgba(255,255,255,0.05)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sheen;
    g.fillRect(6, 6, W - 12, 180);
    g.restore();

    // Hairline frame.
    g.lineWidth = 2;
    g.strokeStyle = UI.line;
    g.stroke();

    // Corner brackets — the identity mark: a plant stencil, not a border.
    g.strokeStyle = UI.accentDim;
    g.lineWidth = 2.5;
    const arm = 24;
    g.beginPath();
    g.moveTo(18 + arm, 18);
    g.lineTo(18, 18);
    g.lineTo(18, 18 + arm);
    g.moveTo(W - 18 - arm, H - 18);
    g.lineTo(W - 18, H - 18);
    g.lineTo(W - 18, H - 18 - arm);
    g.stroke();

    if (this.title) {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = font(700, 46);
      g.letterSpacing = '3px';
      g.fillStyle = UI.textHi;
      g.fillText(this.title, W / 2, 78);
      g.letterSpacing = '0px';
    }

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
    const r = 18;

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
      : b.y + b.h / 2 - (b.sub ? 16 : 0);
    const subY = b.glyph ? labelY + 22 : b.y + b.h / 2 + 26;
    const drawGlyph = (dead: boolean): void => {
      if (!b.glyph) return;
      b.glyph(g, b.x + (b.w - glyphSize) / 2, b.y + (b.h - glyphSize) * 0.14, glyphSize, dead);
    };

    if (b.display) {
      // A value chip: quiet plate, live text, no chrome.
      g.fillStyle = 'rgba(255,255,255,0.03)';
      g.beginPath();
      g.roundRect(b.x, b.y, b.w, b.h, r);
      g.fill();
      drawGlyph(false);
      g.fillStyle = b.tone ?? UI.text;
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
      // THE CTA — the screen's one solid fill, and its one glow.
      const grad = g.createLinearGradient(0, b.y, 0, b.y + b.h);
      grad.addColorStop(0, '#ffb14a');
      grad.addColorStop(1, '#ef8c10');
      g.shadowColor = UI.accentDim;
      g.shadowBlur = 18 + 10 * hov + 12 * flash;
      g.fillStyle = grad;
      g.beginPath();
      g.roundRect(b.x, b.y, b.w, b.h, r);
      g.fill();
      g.shadowBlur = 0;
      // A glassy top light gives the fill its dimension.
      const sheen = g.createLinearGradient(0, b.y, 0, b.y + b.h * 0.5);
      sheen.addColorStop(0, 'rgba(255,255,255,0.22)');
      sheen.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sheen;
      g.fill();
      if (hov > 0 || flash > 0) {
        g.fillStyle = `rgba(255,255,255,${(0.14 * hov + 0.18 * flash).toFixed(3)})`;
        g.fill();
      }
      drawGlyph(false);
      g.fillStyle = UI.onAccent;
      g.font = font(700, labelPx);
      g.letterSpacing = '2px';
      g.fillText(b.label, b.x + b.w / 2, labelY, b.w - 32);
      g.letterSpacing = '0px';
      if (b.sub) {
        g.font = font(600, 22);
        g.fillStyle = 'rgba(34,17,3,0.8)';
        g.fillText(b.sub, b.x + b.w / 2, subY, b.w - 32);
      }
      return;
    }

    // Neutral plate (the default), selected, or disabled.
    const plateA = b.disabled ? 0.02 : 0.045 + 0.045 * hov;
    g.fillStyle = b.selected ? UI.accentFaint : `rgba(255,255,255,${plateA.toFixed(3)})`;
    g.beginPath();
    g.roundRect(b.x, b.y, b.w, b.h, r);
    g.fill();
    if (flash > 0) {
      g.fillStyle = `rgba(255,162,46,${(0.2 * flash).toFixed(3)})`;
      g.fill();
    }
    g.lineWidth = 2;
    g.strokeStyle = b.disabled
      ? 'rgba(255,255,255,0.05)'
      : b.selected
        ? 'rgba(255,162,46,0.9)'
        : `rgba(255,255,255,${(0.1 + 0.2 * hov).toFixed(3)})`;
    g.stroke();

    // The edge tick: the accent's whole job on a resting screen.
    const tick = b.selected ? 1 : hov;
    if (tick > 0.02 && !b.disabled) {
      g.globalAlpha = tick;
      g.fillStyle = UI.accent;
      g.beginPath();
      g.roundRect(b.x + 7, b.y + 12, 5, b.h - 24, 2.5);
      g.fill();
      g.globalAlpha = 1;
    }

    drawGlyph(Boolean(b.disabled));
    g.fillStyle = b.disabled ? UI.disabled : (b.tone ?? UI.text);
    g.font = font(600, labelPx);
    g.letterSpacing = '1.5px';
    g.fillText(b.label, b.x + b.w / 2, labelY, b.w - 28);
    g.letterSpacing = '0px';
    if (b.sub) {
      g.font = font(500, 21);
      g.fillStyle = b.disabled ? 'rgba(250,244,235,0.2)' : UI.dim;
      g.fillText(b.sub, b.x + b.w / 2, subY, b.w - 28);
    }
  }

  /** What this panel is currently offering, by id — the pressable ones only
   *  (a value chip is not a button, and neither is something greyed out).
   *  Headless checks ask this instead of hunting for shapes in pixels. */
  liveButtons(): string[] {
    return this.buttons.filter((b) => !b.disabled && !b.display).map((b) => b.id);
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
