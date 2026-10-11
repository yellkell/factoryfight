/**
 * THE GAUGE — health, and nothing else: ten segments in a dark pill,
 * as many lit as there are tenths left (the last one part-lit), green →
 * amber → red. A hit flashes the lit ones white. It is a card that turns
 * to face you, and it repaints only when what it shows changes.
 *
 * The core wears one always; a tower wears one only while you are
 * pointing at it, reaching for it, or have its panel open (SiegeSystem).
 */

import { CanvasTexture, Color, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';

const PX: [number, number] = [512, 64];
const SEGMENTS = 10;
const _col = new Color();
const WHITE = new Color(0xffffff);

export class Gauge {
  readonly mesh: Mesh;
  readonly mat: MeshBasicMaterial;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: CanvasTexture;
  private key = '';

  /** `w`: its width (plant m). */
  constructor(w: number) {
    const canvas = document.createElement('canvas');
    canvas.width = PX[0];
    canvas.height = PX[1];
    this.ctx = canvas.getContext('2d')!;
    this.tex = new CanvasTexture(canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.mat = new MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, side: DoubleSide });
    this.mesh = new Mesh(new PlaneGeometry(w, (w * PX[1]) / PX[0]), this.mat);
    this.mesh.visible = false;
    this.mesh.renderOrder = 17;
  }

  /** Stand it at (x, y, z) on the plan, turned to face (cx, cz). */
  place(x: number, y: number, z: number, cx: number, cz: number): void {
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.y = Math.atan2(cx - x, cz - z);
  }

  /** Show `frac` of health (0..1), `hit` 0..1 of a hit's white flash. */
  paint(frac: number, hit: number): void {
    const key = `${Math.round(frac * 200)}|${Math.round(hit * 8)}`;
    if (key === this.key) return;
    this.key = key;
    const g = this.ctx;
    const [W, H] = PX;
    g.clearRect(0, 0, W, H);
    // The pill it sits in: dark enough to read against a bright room.
    g.fillStyle = 'rgba(8,7,5,0.62)';
    g.beginPath();
    g.roundRect(2, 2, W - 4, H - 4, (H - 4) / 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.14)';
    g.lineWidth = 2;
    g.stroke();
    _col.set(frac > 0.5 ? 0x6cff9a : frac > 0.25 ? 0xffc23a : 0xff4030);
    if (hit > 0) _col.lerp(WHITE, hit * 0.7);
    const lit = `#${_col.getHexString()}`;
    const pad = 12;
    const gap = 6;
    const sh = H - pad * 2;
    const sw = (W - pad * 2 - gap * (SEGMENTS - 1)) / SEGMENTS;
    for (let k = 0; k < SEGMENTS; k++) {
      const x = pad + k * (sw + gap);
      const fill = Math.max(0, Math.min(1, frac * SEGMENTS - k));
      g.fillStyle = 'rgba(255,255,255,0.1)';
      g.beginPath();
      g.roundRect(x, pad, sw, sh, 4);
      g.fill();
      if (fill <= 0) continue;
      g.fillStyle = lit;
      g.beginPath();
      g.roundRect(x, pad, Math.max(4, sw * fill), sh, 4);
      g.fill();
    }
    this.tex.needsUpdate = true;
  }
}
