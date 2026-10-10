/**
 * THE CRACK — where a pack splits your floor open and climbs out of it.
 *
 * A jagged slash in the floor: a black GASH (opaque and depth-writing, so
 * a crawler still below the floor is hidden inside it), its lips burning
 * the tide's magenta, hairline fractures running off it, and a glow
 * pooled round the lot. It is built once, flat, along +X; `set` opens
 * and lights it every frame by moving the lips (a few dozen vertices).
 *
 *   gathering  a hairline, pulsing — the warning
 *   pouring    it gapes, and they climb out
 *   spent      it closes to a dim scar
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';
import { mulberry32 } from '../game/rng.js';
import { glowTexture } from '../materials/glow.js';

/** Samples along the crack, and its widest half-width fully open (m). */
const N = 16;
const MAX_W = 0.075;
/** Where its lip glow reaches past the gash (m). */
const LIP = 0.014;

export class FloorCrack {
  readonly group = new Group();
  private readonly along = new Float32Array(N);
  private readonly mid = new Float32Array(N);
  private readonly wide = new Float32Array(N);
  private readonly gashPos: BufferAttribute;
  private readonly lipPos: BufferAttribute;
  private readonly lipMat: MeshBasicMaterial;
  private readonly hairMat: LineBasicMaterial;
  private readonly poolMat: MeshBasicMaterial;

  constructor(hex: number, half: number, seed: number) {
    const rng = mulberry32(seed);
    // The line it runs: jagged off the straight, widest in the middle,
    // pinched to nothing at the ends, and ragged between.
    for (let k = 0; k < N; k++) {
      const t = k / (N - 1);
      this.along[k] = (t * 2 - 1) * half;
      const end = Math.sin(Math.PI * t);
      this.mid[k] = (rng() - 0.5) * 0.05 * end;
      this.wide[k] = MAX_W * Math.pow(end, 0.7) * (0.55 + 0.45 * rng());
    }

    // THE GASH and THE LIPS: each a strip of quads down the crack.
    const strip = (): { geo: BufferGeometry; pos: BufferAttribute } => {
      const pos = new BufferAttribute(new Float32Array(N * 2 * 3), 3);
      const idx: number[] = [];
      for (let k = 0; k + 1 < N; k++) {
        const a = k * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', pos);
      geo.setIndex(idx);
      return { geo, pos };
    };
    const gash = strip();
    this.gashPos = gash.pos;
    const gashMesh = new Mesh(gash.geo, new MeshBasicMaterial({ color: 0x040206, side: DoubleSide }));
    gashMesh.frustumCulled = false;
    gashMesh.renderOrder = 7;
    this.group.add(gashMesh);
    const lip = strip();
    this.lipPos = lip.pos;
    this.lipMat = new MeshBasicMaterial({
      color: hex,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    });
    const lipMesh = new Mesh(lip.geo, this.lipMat);
    lipMesh.frustumCulled = false;
    lipMesh.renderOrder = 8;
    this.group.add(lipMesh);

    // THE FRACTURES: hairlines branching off the gash, two or three
    // kinks each, running out across the floor.
    const hair: number[] = [];
    const branches = 5 + Math.floor(rng() * 4);
    for (let b = 0; b < branches; b++) {
      const k = 2 + Math.floor(rng() * (N - 4));
      let x = this.along[k];
      let z = this.mid[k];
      const side = rng() < 0.5 ? -1 : 1;
      let a = side * (Math.PI / 2) + (rng() - 0.5) * 1.6;
      const len = 0.06 + rng() * 0.16;
      const kinks = 2 + Math.floor(rng() * 2);
      for (let s = 0; s < kinks; s++) {
        const step = len / kinks;
        a += (rng() - 0.5) * 0.9;
        const nx = x + Math.cos(a) * step;
        const nz = z + Math.sin(a) * step;
        hair.push(x, 0.005, z, nx, 0.005, nz);
        x = nx;
        z = nz;
      }
    }
    const hairGeo = new BufferGeometry();
    hairGeo.setAttribute('position', new BufferAttribute(new Float32Array(hair), 3));
    this.hairMat = new LineBasicMaterial({
      color: hex,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const hairLines = new LineSegments(hairGeo, this.hairMat);
    hairLines.renderOrder = 8;
    this.group.add(hairLines);

    // THE GLOW, pooled round it on the floor.
    this.poolMat = new MeshBasicMaterial({
      color: hex,
      map: glowTexture(),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    });
    const pool = new Mesh(new PlaneGeometry(half * 2.8, 0.5), this.poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.002;
    pool.renderOrder = 6;
    this.group.add(pool);

    this.set(0, 0);
  }

  /** How far open (0 a hairline, 1 gaping) and how bright (0..1). */
  set(open: number, lit: number): void {
    const G = this.gashPos.array as Float32Array;
    const L = this.lipPos.array as Float32Array;
    for (let k = 0; k < N; k++) {
      const w = this.wide[k] * Math.max(0.04, open);
      const x = this.along[k];
      const z = this.mid[k];
      const o = k * 6;
      G[o] = x;
      G[o + 1] = 0.004;
      G[o + 2] = z - w;
      G[o + 3] = x;
      G[o + 4] = 0.004;
      G[o + 5] = z + w;
      // The lips reach a little past the gash (which hides their middle).
      const lw = w + LIP * (0.4 + 0.6 * lit) * (this.wide[k] / MAX_W + 0.3);
      L[o] = x;
      L[o + 1] = 0.003;
      L[o + 2] = z - lw;
      L[o + 3] = x;
      L[o + 4] = 0.003;
      L[o + 5] = z + lw;
    }
    this.gashPos.needsUpdate = true;
    this.lipPos.needsUpdate = true;
    this.lipMat.opacity = 0.25 + 0.75 * lit;
    this.hairMat.opacity = 0.15 + 0.6 * lit;
    this.poolMat.opacity = 0.05 + 0.3 * lit * (0.4 + 0.6 * open);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose();
      (m.material as MeshBasicMaterial | undefined)?.dispose?.();
    });
  }
}
