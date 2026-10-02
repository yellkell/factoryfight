/**
 * THE LANES, DRAWN — a neon road on your floor from each crack to the
 * core.
 *
 * One ribbon per lane, laid along its polyline, in the tide's magenta: two
 * bright edge lines, a faint fill, and chevrons that flow toward the core
 * so a lane reads as a ROAD WITH A DIRECTION before anything walks it. A
 * lane that is still sealed (opens in a later wave) is drawn too — faint
 * and dashed, no chevrons — so you can see where it will come and never
 * build where it will run.
 */

import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  ShaderMaterial,
  type Group,
} from 'three';
import type { Lane } from '../factory/lanes.js';

const VERT = /* glsl */ `
attribute vec2 aUv;   // metres along the lane, across (-1..1)
varying vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uOpen;   // 1 open, 0 sealed
uniform float uLen;
varying vec2 vUv;
void main() {
  float s = vUv.x;
  float v = abs(vUv.y);
  // Two edge lines.
  float edge = smoothstep(0.82, 0.9, v) * (1.0 - smoothstep(0.94, 1.0, v));
  // Chevrons, pointing AT the core and travelling toward it: the tip
  // (v = 0) leads, the arms sweep back, and each one is a hard bright
  // front with a soft tail behind it. (c FALLS as s rises, so c ≈ 0 is
  // the front edge of every band.)
  float c = fract(uTime * 0.9 - s * 3.2 - v * 0.75);
  float chev = smoothstep(0.0, 0.02, c) * (1.0 - smoothstep(0.02, 0.2, c));
  chev *= 1.0 - v * 0.7;
  // Sealed: the edges dash, the middle is dark.
  float dash = step(0.45, fract(s * 4.0));
  float open = uOpen;
  float a = mix(edge * dash * 0.2, edge * 0.55 + chev * 0.38 + 0.03, open);
  // Fade in out of the wall, and brighten into the core.
  a *= smoothstep(0.0, 0.25, s) * (0.8 + 0.4 * smoothstep(uLen - 0.6, uLen, s));
  // Alpha IS the glow: additive blending adds colour × alpha, and in
  // passthrough a dark pixel written opaque would black out the real
  // floor under it.
  gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

interface Strip {
  mesh: Mesh;
  mat: ShaderMaterial;
}

export class LaneStrips {
  private strips: Strip[] = [];
  private key = '';

  constructor(private readonly parent: Group) {}

  /** Rebuild when the lanes change; light the first `open`. */
  sync(lanes: Lane[], open: number, clock: number, halfWidth: number, hex: number): void {
    const key = lanes.map((l) => `${l.len.toFixed(3)}:${l.pts[0].toFixed(2)}`).join('|');
    if (key !== this.key) {
      this.key = key;
      for (const s of this.strips) {
        s.mesh.removeFromParent();
        s.mesh.geometry.dispose();
        s.mat.dispose();
      }
      this.strips = lanes.map((l) => this.build(l, halfWidth, hex));
    }
    this.strips.forEach((s, k) => {
      s.mat.uniforms.uTime.value = clock;
      const want = k < open ? 1 : 0;
      const u = s.mat.uniforms.uOpen;
      u.value += (want - u.value) * 0.08;
    });
  }

  /**
   * One continuous ribbon down the lane's (rounded) walk: a left and a
   * right edge point per walk point, offset along the mitred normal, and
   * a quad between each pair — so nothing overlaps (an overlap is a hot
   * square under additive light) and `s` runs unbroken round a bend. On
   * the inside of a bend tighter than the half-width, the edge is pinned
   * to the bend's centre instead of folding back over itself.
   */
  private build(l: Lane, hw: number, hex: number): Strip {
    const pos: number[] = [];
    const uv: number[] = [];
    const y = 0.004;
    const n = l.pts.length / 2;
    const P = (k: number): [number, number] => [l.pts[k * 2], l.pts[k * 2 + 1]];
    const left: Array<[number, number]> = [];
    const right: Array<[number, number]> = [];
    for (let k = 0; k < n; k++) {
      const [x, z] = P(k);
      const [px, pz] = P(Math.max(0, k - 1));
      const [qx, qz] = P(Math.min(n - 1, k + 1));
      // Directions in and out (the ends use their one segment).
      let ix = x - px;
      let iz = z - pz;
      let ox = qx - x;
      let oz = qz - z;
      const li = Math.hypot(ix, iz);
      const lo = Math.hypot(ox, oz);
      if (li < 1e-6) {
        ix = ox;
        iz = oz;
      }
      if (lo < 1e-6) {
        ox = ix;
        oz = iz;
      }
      const a = Math.hypot(ix, iz) || 1;
      const b = Math.hypot(ox, oz) || 1;
      ix /= a;
      iz /= a;
      ox /= b;
      oz /= b;
      let tx = ix + ox;
      let tz = iz + oz;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      // Left normal of the mean direction, and the mitre that keeps the
      // ribbon its full width through the turn.
      const nx = -tz;
      const nz = tx;
      const cosHalf = Math.max(0.3, ix * tx + iz * tz);
      const mitre = hw / cosHalf;
      // How tight the bend is here: the radius the two segments imply.
      const turn = Math.acos(Math.max(-1, Math.min(1, ix * ox + iz * oz)));
      const rho = turn > 1e-4 && li > 1e-6 && lo > 1e-6 ? Math.min(li, lo) / (2 * Math.sin(turn / 2)) : Infinity;
      // The lane turns left when the cross product is positive: then the
      // LEFT edge is the inside one.
      const leftInside = ix * oz - iz * ox > 0;
      const offL = leftInside ? Math.min(mitre, rho) : mitre;
      const offR = leftInside ? mitre : Math.min(mitre, rho);
      left.push([x + nx * offL, z + nz * offL]);
      right.push([x - nx * offR, z - nz * offR]);
    }
    for (let k = 0; k < n - 1; k++) {
      const s0 = l.cum[k];
      const s1 = l.cum[k + 1];
      const quad: Array<[number, number, number, number]> = [
        [left[k][0], left[k][1], s0, 1],
        [right[k][0], right[k][1], s0, -1],
        [left[k + 1][0], left[k + 1][1], s1, 1],
        [right[k + 1][0], right[k + 1][1], s1, -1],
      ];
      for (const q of [0, 1, 2, 2, 1, 3]) {
        pos.push(quad[q][0], y, quad[q][1]);
        uv.push(quad[q][2], quad[q][3]);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('aUv', new Float32BufferAttribute(uv, 2));
    const mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uColor: { value: new Color(hex) },
        uTime: { value: 0 },
        uOpen: { value: 0 },
        uLen: { value: l.len },
      },
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.name = 'lane';
    this.parent.add(mesh);
    return { mesh, mat };
  }

  clear(): void {
    this.sync([], 0, 0, 0, 0);
  }
}
