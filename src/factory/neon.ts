/**
 * NEON — FACTORY FIGHT's plant, drawn in light.
 *
 * TUBES' machines were cast iron and brass: right for a museum of the
 * works, wrong for a fight in a dim room through passthrough, where a
 * dark iron drum against a dark sofa is a hole in the picture. So every
 * machine is now a near-black glass body with its silhouette TRACED in
 * neon tube — its edges, its rings — in one colour per trade, and stands
 * on a ring of the same light on the floor. You read a machine from
 * across the room by its colour and its outline, the way you read a sign
 * at night.
 *
 * The trims are real geometry (thin tubes), not 1-px lines, so they hold
 * their thickness in a headset; each machine's trim is merged into ONE
 * mesh plus ONE halo, so a floor of plant stays cheap to draw.
 */

import {
  AdditiveBlending,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { UnitType } from '../config.js';

/** One colour per trade. */
export const NEON: Record<UnitType | 'delete', number> = {
  dock: 0xffcf3a, // the CORE: gold — the thing they want
  maker: 0xff7a1a, // furnace orange (re-tints to its line once fed)
  belt: 0x9fe6ff, // rails: ice — infrastructure, not a trade
  combiner: 0xfff04a, // fitter's yellow
  chest: 0x5dff8a, // storeman's green
  turret: 0xff2d55, // signal red
  wall: 0xffa22e, // hazard amber
  post: 0xffffff,
  vat: 0x4dff9b,
  // THE ARSENAL, each its own heat: the flamer burns orange-red, the
  // coil wears its feed's violet, the mortar is artillery teal, and the
  // piston is cold hydraulic steel.
  flamer: 0xff4d1a,
  tesla: 0xc79bff,
  mortar: 0x2fffc0,
  piston: 0xd8e4ff,
  delete: 0xff4a3a,
};

/** The body every machine is cast in: black glass with a sheen. */
export const BODY = { color: 0x101217, roughness: 0.3, metalness: 0.7 };

/** Tube radius for a trim (plant metres) and how much fatter its halo is. */
const R = 0.0055;
const HALO = 2.8;

const tubeMats = new Map<number, MeshBasicMaterial>();
const haloMats = new Map<number, MeshBasicMaterial>();
export function tubeMat(hex: number): MeshBasicMaterial {
  let m = tubeMats.get(hex);
  if (!m) {
    m = new MeshBasicMaterial({ color: hex, toneMapped: false });
    tubeMats.set(hex, m);
  }
  return m;
}
function haloMat(hex: number): MeshBasicMaterial {
  let m = haloMats.get(hex);
  if (!m) {
    m = new MeshBasicMaterial({
      color: hex,
      transparent: true,
      opacity: 0.22,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    haloMats.set(hex, m);
  }
  return m;
}

const _a = new Vector3();
const _d = new Vector3();
const _q = new Quaternion();
const UP = new Vector3(0, 1, 0);

/**
 * A neon trim being drawn: add strokes, then `into(group)` merges them
 * into one tube mesh and one halo. Every stroke is kept as a recipe so the
 * halo can be re-made fatter from the same path.
 */
export class Trim {
  private strokes: Array<(r: number) => BufferGeometry> = [];

  /** A straight tube from a to b. */
  line(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r = R): this {
    const a = new Vector3(ax, ay, az);
    const b = new Vector3(bx, by, bz);
    this.strokes.push((k) => {
      _d.subVectors(b, a);
      const len = _d.length();
      const g = new CylinderGeometry(r * k, r * k, len, 6, 1, true);
      _q.setFromUnitVectors(UP, _d.normalize());
      g.applyQuaternion(_q);
      _a.addVectors(a, b).multiplyScalar(0.5);
      g.translate(_a.x, _a.y, _a.z);
      return g;
    });
    return this;
  }

  /** A flat ring (in the XZ plane) at height y. `arc` < 2π draws part of it. */
  ring(y: number, radius: number, r = R, cx = 0, cz = 0, arc = Math.PI * 2, start = 0): this {
    this.strokes.push((k) => {
      const g = new TorusGeometry(radius, r * k, 6, Math.max(12, Math.round(40 * (arc / (Math.PI * 2)))), arc);
      g.rotateX(Math.PI / 2);
      g.rotateY(-start);
      g.translate(cx, y, cz);
      return g;
    });
    return this;
  }

  /** An arc in the XY plane about the origin, from +X round `arc`. */
  arc(radius: number, arc: number, r = R): this {
    this.strokes.push((k) => new TorusGeometry(radius, r * k, 6, 16, arc));
    return this;
  }

  /** A ring standing upright, facing along +Z, centred at (x, y, z). */
  hoop(x: number, y: number, z: number, radius: number, r = R): this {
    this.strokes.push((k) => {
      const g = new TorusGeometry(radius, r * k, 6, 32);
      g.translate(x, y, z);
      return g;
    });
    return this;
  }

  /** The twelve edges of a box (centre, full size). */
  box(cx: number, cy: number, cz: number, w: number, h: number, d: number, r = R): this {
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const y0 = cy - h / 2;
    const y1 = cy + h / 2;
    const z0 = cz - d / 2;
    const z1 = cz + d / 2;
    for (const y of [y0, y1]) {
      this.line(x0, y, z0, x1, y, z0, r).line(x0, y, z1, x1, y, z1, r);
      this.line(x0, y, z0, x0, y, z1, r).line(x1, y, z0, x1, y, z1, r);
    }
    for (const x of [x0, x1]) for (const z of [z0, z1]) this.line(x, y0, z, x, y1, z, r);
    return this;
  }

  /** Vertical strokes round a drum: `n` of them, from y0 to y1. */
  staves(n: number, radius: number, y0: number, y1: number, r = R, phase = 0): this {
    for (let k = 0; k < n; k++) {
      const a = phase + (k / n) * Math.PI * 2;
      this.line(Math.sin(a) * radius, y0, Math.cos(a) * radius, Math.sin(a) * radius, y1, Math.cos(a) * radius, r);
    }
    return this;
  }

  /** Merge it all into `group`: one tube mesh, one halo. */
  into(group: Group, hex: number): Group {
    if (this.strokes.length === 0) return group;
    const tube = mergeGeometries(this.strokes.map((s) => s(1)));
    const halo = mergeGeometries(this.strokes.map((s) => s(HALO)));
    if (tube) {
      const m = new Mesh(tube, tubeMat(hex));
      m.name = 'neon';
      group.add(m);
    }
    if (halo) {
      const h = new Mesh(halo, haloMat(hex));
      h.name = 'neon-halo';
      h.renderOrder = 9;
      group.add(h);
    }
    return group;
  }
}

/** The ring of light every machine stands on. */
export function floorRing(group: Group, hex: number, radius = 0.165): void {
  const ring = new Mesh(
    new RingGeometry(radius - 0.012, radius, 40),
    new MeshBasicMaterial({
      color: hex,
      transparent: true,
      opacity: 0.75,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.004;
  ring.renderOrder = 8;
  group.add(ring);
  const pool = new Mesh(
    new RingGeometry(0.0, radius - 0.012, 40),
    new MeshBasicMaterial({
      color: hex,
      transparent: true,
      opacity: 0.08,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.003;
  pool.renderOrder = 8;
  group.add(pool);
}
