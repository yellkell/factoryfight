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
  float edge = smoothstep(0.74, 0.86, v) * (1.0 - smoothstep(0.93, 1.0, v));
  // Chevrons flowing toward the core.
  float c = fract(s * 5.0 - uTime * 1.1 - v * 0.55);
  float chev = smoothstep(0.0, 0.07, c) * (1.0 - smoothstep(0.16, 0.24, c)) * (1.0 - v * 0.6);
  // Sealed: the edges dash, the middle is dark.
  float dash = step(0.45, fract(s * 4.0));
  float open = uOpen;
  float a = mix(edge * dash * 0.22, edge * 0.85 + chev * 0.5 + 0.07, open);
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

  private build(l: Lane, hw: number, hex: number): Strip {
    const pos: number[] = [];
    const uv: number[] = [];
    const y = 0.004;
    const n = l.pts.length / 2;
    for (let k = 0; k < n - 1; k++) {
      const ax = l.pts[k * 2];
      const az = l.pts[k * 2 + 1];
      const bx = l.pts[k * 2 + 2];
      const bz = l.pts[k * 2 + 3];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const dx = (bx - ax) / len;
      const dz = (bz - az) / len;
      // Each segment runs a half-width past its ends, so corners close.
      const ex = k === 0 ? 0 : hw;
      const fx = k === n - 2 ? 0 : hw;
      const x0 = ax - dx * ex;
      const z0 = az - dz * ex;
      const x1 = bx + dx * fx;
      const z1 = bz + dz * fx;
      const s0 = l.cum[k] - ex;
      const s1 = l.cum[k + 1] + fx;
      const px = -dz * hw;
      const pz = dx * hw;
      const quad = [
        [x0 + px, z0 + pz, s0, 1],
        [x0 - px, z0 - pz, s0, -1],
        [x1 + px, z1 + pz, s1, 1],
        [x1 - px, z1 - pz, s1, -1],
      ];
      for (const q of [0, 1, 2, 2, 1, 3]) {
        pos.push(quad[q][0], y + k * 0.0004, quad[q][1]);
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
