/**
 * CRYSTAL & HEX — the core and the towers, drawn as holographic geometry.
 *
 * Every tower stands on a glowing HEX PAD flat on your floor (no legs, no
 * bench, nothing plugged into it) and is built from FACETED PRISMS: dark
 * glass with its edges traced in its trade's neon. Whatever does the
 * shooting is MOUNTED on the body — a head that floated over its column
 * read as unattached, so every head now sits on a turntable. The core is
 * the biggest crystal in the room: it hovers over its pad, turns slowly
 * inside three orbiting halo rings, and cracks and dims as the tide gets
 * into it (SiegeSystem drives that from the core's health).
 *
 * FIVE SILHOUETTES. A tower is told at a glance by its SHAPE, not its
 * colour: the TURRET is a squat armoured cupola with two long lances
 * out the front; the HAMMER a crystal pylon with a great hex head
 * slung off its arm; the FLAMER a fat banded fuel drum with a flared
 * bell for a nozzle; the TESLA COIL the tallest and slimmest, a spire
 * through a stack of plates with a crackling orb on its point; the
 * MORTAR the widest and lowest, a crown of shards round a fat stubby
 * tube cocked at the sky. Each level ADDS a part (an armour skirt, a
 * third lance, a second plate…), so a levelled tower reads as one.
 *
 * MERGED, NOT ASSEMBLED. three.js walks every object in the scene every
 * frame, and with sixty towers on the floor that walk was the biggest
 * thing on the CPU: a tower used to be thirty-odd meshes and groups. Now
 * every rigid PIECE of a tower — what stands still, the head that turns,
 * the barrel that kicks, the arm that swings — is ONE mesh: its glass,
 * its neon tube, its neon halo and its pilot light are groups of one
 * geometry drawn with a material each. A tower is five to eight objects.
 * The geometry of each piece is made once per kind (and per level) and
 * shared by every tower of that kind; a level-up swaps it (`dress`).
 *
 * Built in plant metres, out along +Z, like every other builder. The
 * contract with SiegeSystem is GunRefs (units.ts) plus CoreRefs here.
 */

import {
  AdditiveBlending,
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  SphereGeometry,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { beamGradientTexture } from '../materials/glow.js';
import { NEON, Trim, haloMat, tubeMat } from './neon.js';
import type { GunRefs } from './units.js';

/* ── materials ──────────────────────────────────────────────────────────── */

const glassMats = new Map<number, MeshStandardMaterial>();
/** Dark faceted glass with a breath of its own colour in it. */
function glass(hex: number): MeshStandardMaterial {
  let m = glassMats.get(hex);
  if (!m) {
    m = new MeshStandardMaterial({
      color: 0x0c0e14,
      emissive: hex,
      emissiveIntensity: 0.16,
      roughness: 0.12,
      metalness: 0.55,
      flatShading: true,
      transparent: true,
      opacity: 0.92,
    });
    glassMats.set(hex, m);
  }
  return m;
}

const additive = (hex: number, opacity: number): MeshBasicMaterial =>
  new MeshBasicMaterial({
    color: hex,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  });

/* ── facets ─────────────────────────────────────────────────────────────── */

/** The edges of a faceted solid, traced in neon tube onto `t`. */
function traceEdges(t: Trim, geo: BufferGeometry, r?: number): Trim {
  const e = new EdgesGeometry(geo, 20);
  const p = e.getAttribute('position');
  for (let k = 0; k < p.count; k += 2) {
    t.line(p.getX(k), p.getY(k), p.getZ(k), p.getX(k + 1), p.getY(k + 1), p.getZ(k + 1), r);
  }
  e.dispose();
  return t;
}

/** A hexagonal prism (r0 at the foot, r1 at the top), centred on y. */
function prismGeo(r0: number, r1: number, h: number, sides = 6): BufferGeometry {
  return new CylinderGeometry(r1, r0, h, sides, 1).toNonIndexed();
}

/** A long bipyramid — the crystal everybody draws: two hex points. */
function shardGeo(r: number, up: number, down: number, sides = 6): BufferGeometry {
  const top = new ConeGeometry(r, up, sides, 1, true);
  top.translate(0, up / 2, 0);
  const bot = new ConeGeometry(r, down, sides, 1, true);
  bot.rotateX(Math.PI);
  bot.translate(0, -down / 2, 0);
  const g = mergeGeometries([top.toNonIndexed(), bot.toNonIndexed()])!;
  g.computeVertexNormals();
  return g;
}

/** A four-sided prism turned square to the axes: a block, a slab. */
function blockGeo(r0: number, r1: number, h: number): BufferGeometry {
  return prismGeo(r0, r1, h, 4).rotateY(Math.PI / 4);
}

const _o = new Object3D();
/** A placement, as a matrix to bake into a part's geometry. */
function at(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): Matrix4 {
  _o.position.set(x, y, z);
  _o.rotation.set(rx, ry, rz);
  _o.scale.set(sx, sy, sz);
  _o.updateMatrix();
  return _o.matrix.clone();
}

/** A part that never moves on its tower: its matrix is made once, not
 *  every frame (three.js still walks it, but skips the compose). */
function still<T extends Object3D>(o: T): T {
  o.updateMatrix();
  o.matrixAutoUpdate = false;
  return o;
}

/** Position + normal, indexed: every part made mergeable with every other. */
function plain(g: BufferGeometry): BufferGeometry {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!g.index) {
    const n = g.getAttribute('position').count;
    const idx = new Array<number>(n);
    for (let k = 0; k < n; k++) idx[k] = k;
    g.setIndex(idx);
  }
  return g;
}

/* ── pieces ─────────────────────────────────────────────────────────────── */

/** The material slots every piece is drawn with, in this order. */
const GLASS = 0;
const TUBE = 1;
const HALO = 2;
const LIT = 3;

/**
 * A PIECE being cut: one rigid part of a tower, everything in it moving
 * together. Add posed solids (traced in neon), bare neon strokes and
 * pilot-lit bits; `bake` merges them into one geometry per level, with a
 * group per material. `from` is the level the next parts arrive at.
 */
class Piece {
  private parts: Array<{ slot: number; geo: BufferGeometry; lv: number }> = [];
  private trims: Array<{ t: Trim; m: Matrix4 | null; lv: number }> = [];
  from = 1;

  /** A faceted solid of glass, posed, its edges traced in neon. */
  solid(geo: BufferGeometry, m: Matrix4, r?: number): this {
    geo.applyMatrix4(m);
    this.parts.push({ slot: GLASS, geo: plain(geo), lv: this.from });
    if (r !== 0) this.trims.push({ t: traceEdges(new Trim(), geo, r), m: null, lv: this.from });
    return this;
  }

  /** Neon strokes (drawn in the piece's frame, or posed by `m`). */
  neon(t: Trim, m: Matrix4 | null = null): this {
    this.trims.push({ t, m, lv: this.from });
    return this;
  }

  /** A bit lit by the tower's pilot light. */
  lit(geo: BufferGeometry, m: Matrix4): this {
    geo.applyMatrix4(m);
    this.parts.push({ slot: LIT, geo: plain(geo), lv: this.from });
    return this;
  }

  /** One merged geometry per level (1–3); a level that adds nothing to
   *  this piece shares the one below. */
  bake(): BufferGeometry[] {
    const out: BufferGeometry[] = [];
    for (let L = 1; L <= 3; L++) {
      const adds = this.parts.some((p) => p.lv === L) || this.trims.some((t) => t.lv === L);
      if (L > 1 && !adds) {
        out.push(out[L - 2]);
        continue;
      }
      const slots: BufferGeometry[][] = [[], [], [], []];
      for (const p of this.parts) if (p.lv <= L) slots[p.slot].push(p.geo);
      for (const { t, m, lv } of this.trims) {
        if (lv > L) continue;
        for (const [slot, fat] of [
          [TUBE, false],
          [HALO, true],
        ] as Array<[number, boolean]>) {
          const g = t.geometry(fat);
          if (!g) continue;
          if (m) g.applyMatrix4(m);
          slots[slot].push(plain(g));
        }
      }
      const blocks: BufferGeometry[] = [];
      const index: number[] = [];
      slots.forEach((list, slot) => {
        if (list.length === 0) return;
        blocks.push(list.length === 1 ? list[0] : mergeGeometries(list)!);
        index.push(slot);
      });
      const g = mergeGeometries(blocks, true)!;
      g.groups.forEach((gr, k) => (gr.materialIndex = index[k]));
      g.computeBoundingSphere();
      out.push(g);
    }
    return out;
  }
}

/** Every kind's pieces, baked once and shared by every tower of it. */
const kits = new Map<string, Record<string, BufferGeometry[]>>();
function kit(kind: string, cut: () => Record<string, Piece>): Record<string, BufferGeometry[]> {
  let k = kits.get(kind);
  if (!k) {
    k = {};
    for (const [name, piece] of Object.entries(cut())) k[name] = piece.bake();
    kits.set(kind, k);
  }
  return k;
}

/**
 * One tower's wardrobe: the meshes it wears, each with its geometry for
 * every level. `dress(level)` swaps them all — free when nothing changed.
 */
class Wardrobe {
  private worn: Array<[Mesh, BufferGeometry[]]> = [];
  private level = 1;
  constructor(private hex: number) {}

  /** A mesh of one piece, drawn in glass, tube, halo (and `lit`). */
  wear(geos: BufferGeometry[], lit?: Material): Mesh {
    const mats: Material[] = [glass(this.hex), tubeMat(this.hex), haloMat(this.hex)];
    if (lit) mats.push(lit);
    const m = new Mesh(geos[0], mats);
    this.worn.push([m, geos]);
    return m;
  }

  dress = (level: number): void => {
    const L = Math.max(1, Math.min(3, Math.round(level)));
    if (L === this.level) return;
    this.level = L;
    for (const [m, geos] of this.worn) m.geometry = geos[L - 1];
  };
}

/**
 * THE HEX PAD: a low hexagonal plinth of glass, its rim and an inner hex
 * traced in light (cut into the standing piece) — and a soft hex of glow
 * on the floor round it, its own mesh, so the photo studio can leave it
 * out of a portrait.
 */
function hexPad(p: Piece, radius = 0.15): void {
  const h = 0.03;
  p.solid(prismGeo(radius + 0.01, radius, h), at(0, h / 2, 0, 0, Math.PI / 6), 0);
  const t = new Trim();
  const hexLine = (y: number, r: number, w?: number): void => {
    for (let k = 0; k < 6; k++) {
      const a0 = (k / 6) * Math.PI * 2;
      const a1 = ((k + 1) / 6) * Math.PI * 2;
      t.line(Math.sin(a0) * r, y, Math.cos(a0) * r, Math.sin(a1) * r, y, Math.cos(a1) * r, w);
    }
  };
  hexLine(h + 0.001, radius, 0.006);
  hexLine(h + 0.002, radius * 0.62, 0.0035);
  hexLine(0.004, radius + 0.012, 0.004);
  p.neon(t, at(0, 0, 0, 0, Math.PI / 6));
}

const poolGeos = new Map<number, BufferGeometry>();
const poolMats = new Map<number, MeshBasicMaterial>();
function padGlow(group: Group, hex: number, radius = 0.15): void {
  let g = poolGeos.get(radius);
  if (!g) {
    g = new CircleGeometry(radius * 1.45, 6);
    g.rotateX(-Math.PI / 2);
    g.rotateY(Math.PI / 6);
    poolGeos.set(radius, g);
  }
  let m = poolMats.get(hex);
  if (!m) {
    m = additive(hex, 0.1);
    poolMats.set(hex, m);
  }
  const pool = new Mesh(g, m);
  pool.name = 'pad-glow';
  pool.position.y = 0.002;
  pool.renderOrder = 8;
  group.add(still(pool));
}

const pilotMat = (hex: number): MeshBasicMaterial =>
  new MeshBasicMaterial({ color: hex, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false });

/** A short-lived flash of light (opacity driven by SiegeSystem). */
const flashMat = (hex: number): MeshBasicMaterial => additive(hex, 0);

let flashCone: BufferGeometry | null = null;
/** A muzzle flash: an open cone, point at the bore, opening out +Z. */
function muzzleFlash(parent: Object3D, hex: number, z: number, y = 0): { flash: MeshBasicMaterial; flashMesh: Mesh } {
  flashCone ??= new CylinderGeometry(0, 1, 1, 10, 1, true).rotateX(-Math.PI / 2);
  const flash = flashMat(hex);
  const flashMesh = new Mesh(flashCone, flash);
  flashMesh.scale.set(0.05, 0.05, 0.1);
  flashMesh.position.set(0, y, z);
  flashMesh.renderOrder = 14;
  parent.add(flashMesh);
  return { flash, flashMesh };
}

/* ── the towers ─────────────────────────────────────────────────────────── */

/**
 * THE TURRET — a squat armoured cupola: a broad hex plinth, a faceted
 * dome turning on it, and out of the dome's mantlet TWIN LANCES that slew
 * to the target and spit slugs. Low, wide-shouldered, long in the nose.
 * Level 2 bolts an armour skirt round the plinth, cheek pods and a
 * cupola on the dome and jackets on the lances; level 3 a third lance, a
 * second collar of plate and a halo. Muzzles at 0.29.
 */
export function buildTurret(group: Group): GunRefs {
  const hex = NEON.turret;
  const k = kit('turret', () => {
    const base = new Piece();
    hexPad(base, 0.15);
    base.solid(prismGeo(0.112, 0.088, 0.2), at(0, 0.13, 0));
    base.neon(new Trim().ring(0.17, 0.094, 0.004));
    base.from = 2;
    // THE SKIRT: six slabs of armour leaning on the plinth's faces.
    for (let s = 0; s < 6; s++) {
      const a = (s / 6) * Math.PI * 2 + Math.PI / 6;
      base.solid(blockGeo(0.05, 0.04, 0.11), at(Math.sin(a) * 0.104, 0.09, Math.cos(a) * 0.104, 0, a, 0, 1, 1, 0.2), 0.0035);
    }
    base.neon(new Trim().ring(0.06, 0.13, 0.004));
    base.from = 3;
    // A second, wider collar of plate up the plinth: more of the turret's
    // own armour, not new kit.
    base.solid(prismGeo(0.128, 0.122, 0.03), at(0, 0.17, 0, 0, Math.PI / 6), 0.004);
    base.neon(new Trim().ring(0.19, 0.13, 0.004));
    const head = new Piece();
    // The turntable, and the dome on it: a faceted cupola, cut flat on top.
    head.solid(prismGeo(0.088, 0.084, 0.024), at(0, 0.012, 0), 0.0045);
    head.solid(prismGeo(0.092, 0.066, 0.07), at(0, 0.059, 0, 0, Math.PI / 6));
    head.solid(prismGeo(0.066, 0.034, 0.032), at(0, 0.11, 0, 0, Math.PI / 6));
    // The mantlet: a flat-faced block on the dome's front the lances run
    // out of.
    head.solid(blockGeo(0.05, 0.042, 0.05), at(0, 0.064, 0.072, Math.PI / 2, 0, 0, 1.3, 1, 0.75), 0.004);
    head.from = 2;
    for (const sx of [-1, 1]) head.solid(prismGeo(0.03, 0.026, 0.09), at(sx * 0.098, 0.06, -0.01, Math.PI / 2, 0, 0, 1, 1, 0.75), 0.004);
    // A raised cupola on the dome, with its sight lit.
    head.solid(prismGeo(0.04, 0.032, 0.03), at(0, 0.141, -0.015, 0, Math.PI / 6), 0.0035);
    head.lit(new CircleGeometry(0.016, 6), at(0, 0.142, 0.018));
    head.from = 3;
    // A halo of light floating round the dome.
    head.neon(new Trim().ring(0.1, 0.125, 0.005));
    const barrel = new Piece();
    // THE LANCES: two long hex barrels, each with a brake at the muzzle.
    for (const sx of [-1, 1]) {
      barrel.solid(prismGeo(0.019, 0.015, 0.2), at(sx * 0.032, 0, 0.17, Math.PI / 2), 0.0035);
      barrel.solid(prismGeo(0.026, 0.026, 0.036), at(sx * 0.032, 0, 0.255, Math.PI / 2), 0.004);
    }
    barrel.lit(new OctahedronGeometry(0.013, 0), at(0, 0.028, 0.1, 0, 0, 0, 1, 0.7, 1.4));
    barrel.from = 2;
    // Cooling jackets: heavier lances.
    for (const sx of [-1, 1]) barrel.solid(prismGeo(0.025, 0.025, 0.07), at(sx * 0.032, 0, 0.12, Math.PI / 2), 0.0035);
    barrel.from = 3;
    barrel.solid(prismGeo(0.012, 0.01, 0.17), at(0, 0.05, 0.15, Math.PI / 2), 0.0035);
    barrel.solid(prismGeo(0.017, 0.017, 0.026), at(0, 0.05, 0.23, Math.PI / 2), 0.0035);
    return { base, head, barrel };
  });
  const w = new Wardrobe(hex);
  padGlow(group, hex, 0.15);
  group.add(still(w.wear(k.base)));
  const head = w.wear(k.head);
  head.position.y = 0.23;
  group.add(head);
  const pilot = pilotMat(hex);
  const barrel = w.wear(k.barrel, pilot);
  barrel.position.y = 0.064;
  head.add(barrel);
  const { flash, flashMesh } = muzzleFlash(barrel, 0xffd0d8, 0.28);
  return { head, barrel, kick: 0.04, flash, flashMesh, pilot, dress: w.dress };
}

/**
 * THE MORTAR — the widest and the lowest: a crown of shards leaning out
 * round a broad pad, a squat pedestal, and on its turntable a FAT STUBBY
 * TUBE cocked at the sky between two trunnion cheeks, ringed in teal at
 * the mouth. It kicks down its bore and lobs a shell over the room.
 * Level 2 racks shells on the pedestal, bands the tube and raises the
 * cheeks; level 3 slings two slim tubes either side of the big one, a
 * heavier breech and a wider pedestal. Mouth at 0.32.
 */
export function buildMortar(group: Group): GunRefs {
  const hex = NEON.mortar;
  const k = kit('mortar', () => {
    const base = new Piece();
    hexPad(base, 0.17);
    for (let s = 0; s < 6; s++) {
      const a = (s / 6) * Math.PI * 2 + Math.PI / 6;
      base.solid(shardGeo(0.026, 0.11, 0.02), at(Math.sin(a) * 0.15, 0.05, Math.cos(a) * 0.15, Math.cos(a) * 0.42, 0, -Math.sin(a) * 0.42), 0.0035);
    }
    base.solid(prismGeo(0.112, 0.1, 0.07), at(0, 0.065, 0));
    base.from = 2;
    // The ready rack: three shells standing at the pedestal's back.
    for (const s of [-1, 0, 1]) {
      const a = Math.PI + s * 0.5;
      base.solid(shardGeo(0.018, 0.06, 0.012, 6), at(Math.sin(a) * 0.118, 0.115, Math.cos(a) * 0.118), 0.003);
    }
    base.neon(new Trim().ring(0.105, 0.115, 0.004));
    base.from = 3;
    // A heavier pedestal: a second, wider tier under the first.
    base.solid(prismGeo(0.135, 0.13, 0.03), at(0, 0.045, 0), 0.004);
    const head = new Piece();
    head.solid(prismGeo(0.1, 0.088, 0.04), at(0, 0.02, 0));
    // The trunnion cheeks the tube is slung between.
    for (const sx of [-1, 1]) head.solid(blockGeo(0.05, 0.036, 0.1), at(sx * 0.084, 0.07, 0, 0, 0, 0, 0.3, 1, 1), 0.0035);
    head.from = 2;
    // Taller trunnion cheeks, the tube slung between bigger shoulders.
    for (const sx of [-1, 1]) head.solid(blockGeo(0.04, 0.03, 0.05), at(sx * 0.084, 0.14, 0, 0, 0, 0, 0.3, 1, 1), 0.0035);
    head.from = 3;
    // A bar of light across the cheeks' tops.
    head.neon(new Trim().line(-0.084, 0.168, 0, 0.084, 0.168, 0, 0.005));
    const barrel = new Piece();
    // THE TUBE: fat and short, a hex bore with a heavy breech.
    barrel.solid(prismGeo(0.072, 0.066, 0.2), at(0, 0, 0.07, Math.PI / 2));
    barrel.solid(prismGeo(0.06, 0.074, 0.05), at(0, 0, -0.055, Math.PI / 2));
    barrel.neon(new Trim().hoop(0, 0, 0.17, 0.07, 0.008).hoop(0, 0, 0.12, 0.069, 0.004).hoop(0, 0, 0.171, 0.045, 0.004));
    barrel.lit(new CircleGeometry(0.05, 6), at(0, 0, 0.172));
    barrel.from = 2;
    barrel.solid(prismGeo(0.078, 0.078, 0.022), at(0, 0, 0.02, Math.PI / 2), 0.004);
    barrel.from = 3;
    for (const sx of [-1, 1]) {
      barrel.solid(prismGeo(0.026, 0.024, 0.18), at(sx * 0.13, 0, 0.05, Math.PI / 2), 0.0035);
      barrel.neon(new Trim().hoop(sx * 0.13, 0, 0.141, 0.027, 0.004));
    }
    barrel.neon(new Trim().line(-0.13, 0, 0, 0.13, 0, 0, 0.006));
    // A heavier breech ring on the big tube.
    barrel.solid(prismGeo(0.086, 0.086, 0.04), at(0, 0, -0.05, Math.PI / 2), 0.004);
    return { base, head, barrel };
  });
  const w = new Wardrobe(hex);
  padGlow(group, hex, 0.17);
  group.add(still(w.wear(k.base)));
  const head = w.wear(k.head);
  head.position.y = 0.1;
  group.add(head);
  const tilt = new Group();
  tilt.position.y = 0.08;
  tilt.rotation.x = -0.96; // cocked up, firing over +Z
  head.add(still(tilt));
  const pilot = pilotMat(hex);
  const barrel = w.wear(k.barrel, pilot);
  tilt.add(barrel);
  const { flash, flashMesh } = muzzleFlash(barrel, 0xe0fff4, 0.2);
  flashMesh.scale.set(0.09, 0.09, 0.2);
  return { head, barrel, kick: 0.06, flash, flashMesh, pilot, dress: w.dress };
}

/**
 * THE TESLA COIL — the tallest and the slimmest: a twisted spire run up
 * through a stack of hex plates, like the coils in the old photographs,
 * and on its point a bright orb held inside two crossed rings that never
 * stop turning. The arcs leave the orb. Doesn't turn. Level 2 adds a
 * third plate, coil windings and a ring; level 3 a fourth plate, more
 * windings, a broad foot plate, a bigger orb and a wider ring.
 * Orb at 0.72.
 */
export function buildTesla(group: Group): GunRefs {
  const hex = NEON.tesla;
  const k = kit('tesla', () => {
    const base = new Piece();
    hexPad(base, 0.12);
    let y = 0.03;
    for (const [r0, r1, h, s] of [
      [0.052, 0.038, 0.26, 0],
      [0.038, 0.026, 0.22, 0.35],
      [0.026, 0.01, 0.21, 0.7],
    ]) {
      base.solid(prismGeo(r0, r1, h), at(0, y + h / 2, 0, 0, s));
      y += h; // stacked flush: no gaps between the segments
    }
    // THE PLATES: thin hex washers stacked up the spire, each smaller.
    const plate = (py: number, r: number): void => {
      base.solid(prismGeo(r, r * 0.9, 0.014), at(0, py, 0, 0, Math.PI / 6), 0.004);
    };
    plate(0.17, 0.1);
    plate(0.33, 0.078);
    base.from = 2;
    plate(0.47, 0.06);
    // COIL WINDINGS: rings of light wound up the spire between the plates.
    const wind = new Trim();
    for (let k = 0; k < 4; k++) wind.ring(0.2 + k * 0.03, 0.05 - k * 0.002, 0.003);
    base.neon(wind);
    base.from = 3;
    plate(0.58, 0.046);
    // More windings, higher up, and a broad flared foot plate.
    const wind3 = new Trim();
    for (let k = 0; k < 4; k++) wind3.ring(0.37 + k * 0.026, 0.036 - k * 0.002, 0.003);
    base.neon(wind3);
    plate(0.06, 0.12);
    const crown = new Piece();
    for (const [rx, rz] of [
      [Math.PI / 2, 0.5],
      [Math.PI / 2, -0.5],
    ]) {
      crown.neon(new Trim().ring(0, 0.085, 0.005), at(0, 0, 0, rx, 0, rz));
    }
    crown.lit(new OctahedronGeometry(0.042, 1), at());
    crown.from = 3;
    // A bigger orb.
    crown.lit(new OctahedronGeometry(0.056, 1), at());
    crown.from = 2;
    crown.neon(new Trim().ring(0, 0.11, 0.004));
    crown.from = 3;
    crown.neon(new Trim().ring(0, 0.15, 0.004), at(0, 0, 0, 0.35, 0, 0));
    return { base, crown };
  });
  const w = new Wardrobe(hex);
  padGlow(group, hex, 0.12);
  group.add(still(w.wear(k.base)));
  const pilot = pilotMat(hex);
  const crown = w.wear(k.crown, pilot);
  crown.position.y = 0.72; // the orb sits on the spire's point (0.72)
  group.add(crown);
  const flash = flashMat(0xf3e6ff);
  const flashMesh = new Mesh(new SphereGeometry(1, 14, 10), flash);
  flashMesh.scale.setScalar(0.12);
  crown.add(flashMesh);
  return { head: null, barrel: null, kick: 0, flash, flashMesh, pilot, spin: [crown], dress: w.dress };
}

let tongue: BufferGeometry | null = null;

/**
 * THE FLAMER — low and fat: a banded hex FUEL DRUM squatting on its pad
 * with its gauge glowing in its side, and on its lid a pump on a
 * turntable feeding a wide FLARED BELL that points at the lane: the fire
 * pours from its mouth. Level 2 straps two canisters to the drum's
 * flanks and stands exhaust stacks up its back; level 3 slings a reserve
 * tank across the back and flares the bell wider. Mouth at 0.27.
 */
export function buildFlamer(group: Group): GunRefs {
  const hex = NEON.flamer;
  const k = kit('flamer', () => {
    const base = new Piece();
    hexPad(base, 0.15);
    // THE DRUM: fat, its shoulder chamfered, two bands round its belly.
    base.solid(prismGeo(0.124, 0.124, 0.126), at(0, 0.093, 0, 0, Math.PI / 6), 0.0045);
    base.solid(prismGeo(0.124, 0.088, 0.03), at(0, 0.171, 0, 0, Math.PI / 6), 0.0045);
    base.neon(new Trim().ring(0.075, 0.13, 0.006).ring(0.125, 0.13, 0.006));
    // The gauge: a lit window down the drum's back.
    base.lit(new CylinderGeometry(0.007, 0.007, 0.07, 6), at(0, 0.106, -0.11));
    base.from = 2;
    for (const sx of [-1, 1]) {
      base.solid(prismGeo(0.04, 0.04, 0.13), at(sx * 0.15, 0.1, -0.03), 0.0035);
      base.solid(prismGeo(0.04, 0.012, 0.03), at(sx * 0.15, 0.18, -0.03), 0.0035);
    }
    // EXHAUST STACKS up the back, glowing at the top.
    for (const sx of [-1, 1]) {
      base.solid(prismGeo(0.018, 0.022, 0.17), at(sx * 0.055, 0.25, -0.1), 0.0035);
      base.lit(new CylinderGeometry(0.013, 0.013, 0.012, 6), at(sx * 0.055, 0.34, -0.1));
    }
    base.from = 3;
    // A big reserve tank strapped across the back, banded like the drum.
    base.solid(prismGeo(0.05, 0.05, 0.2), at(0, 0.11, -0.15, 0, 0, Math.PI / 2), 0.004);
    for (const x of [-0.06, 0.06]) base.neon(new Trim().hoop(0, 0, 0, 0.052, 0.004), at(x, 0.11, -0.15, 0, Math.PI / 2, 0));
    const head = new Piece();
    head.solid(prismGeo(0.06, 0.055, 0.02), at(0, 0.01, 0), 0.004);
    head.solid(blockGeo(0.045, 0.035, 0.055), at(0, 0.045, -0.02, 0, 0, 0, 1, 1, 1.3), 0.004);
    const barrel = new Piece();
    // THE BELL: a short throat flaring wide at the mouth.
    barrel.solid(prismGeo(0.022, 0.028, 0.08), at(0, 0, 0.02, Math.PI / 2), 0.004);
    barrel.solid(prismGeo(0.028, 0.068, 0.1), at(0, 0, 0.11, Math.PI / 2));
    barrel.solid(new OctahedronGeometry(0.042, 0), at(0, 0, -0.035, 0, 0, 0, 1, 1, 1.2));
    barrel.neon(new Trim().hoop(0, 0, 0.16, 0.068, 0.006));
    barrel.lit(new SphereGeometry(1, 10, 8), at(0, 0, 0.17, 0, 0, 0, 0.022, 0.022, 0.03));
    barrel.from = 2;
    barrel.neon(new Trim().hoop(0, 0, 0.13, 0.058, 0.004));
    barrel.from = 3;
    // A wider bell: the mouth flares out further.
    barrel.solid(prismGeo(0.068, 0.09, 0.03), at(0, 0, 0.175, Math.PI / 2), 0.004);
    barrel.neon(new Trim().hoop(0, 0, 0.19, 0.09, 0.005));
    return { base, head, barrel };
  });
  const w = new Wardrobe(hex);
  padGlow(group, hex, 0.15);
  const pilot = pilotMat(0xff9a3a);
  group.add(still(w.wear(k.base, pilot)));
  const head = w.wear(k.head);
  head.position.y = 0.186;
  group.add(head);
  const barrel = w.wear(k.barrel, pilot);
  barrel.position.y = 0.084;
  head.add(barrel);
  // THE TONGUE: a cone with its point at the mouth, opening along +Z.
  // Three layers, hot white at the root and red at its reach.
  if (!tongue) {
    tongue = new ConeGeometry(1, 1, 18, 1, true);
    tongue.rotateX(-Math.PI / 2);
    tongue.translate(0, 0, 0.5);
  }
  const jet: Mesh[] = [];
  for (const [color, opacity] of [
    [0xff3d0a, 0.42],
    [0xffb347, 0.55],
    [0xfff2c0, 0.7],
  ] as Array<[number, number]>) {
    const mat = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
      map: beamGradientTexture(true),
    });
    const m = new Mesh(tongue, mat);
    m.position.z = 0.17;
    m.visible = false;
    m.renderOrder = 14;
    m.userData.opacity = opacity;
    barrel.add(m);
    jet.push(m);
  }
  return { head, barrel, kick: 0.006, flash: null, flashMesh: null, pilot, jet, dress: w.dress };
}

/**
 * THE HAMMER — a crystal pylon on its pad with a long arm hinged at its
 * top, and on the end of the arm a great hex-prism head. It turns to
 * what is coming, heaves the head up, and brings it down on them.
 * SiegeSystem swings `swing` about X (0 = the arm level, + = down).
 * Level 2 bands the head with a collar, sleeves the pylon's foot and
 * hangs a counterweight behind the hinge; level 3 shells the head in a
 * bigger block and bands the pylon in light.
 */
export function buildHammer(group: Group): GunRefs {
  const hex = NEON.hammer;
  const PIV = 0.36;
  const k = kit('hammer', () => {
    const base = new Piece();
    hexPad(base, 0.16);
    // THE PYLON: one tapering crystal, turning with what it watches.
    const head = new Piece();
    head.solid(prismGeo(0.07, 0.05, 0.3), at(0, 0.18, -0.03));
    head.from = 2;
    // A thicker pylon: a sleeve of plate round its foot.
    head.solid(prismGeo(0.085, 0.08, 0.08), at(0, 0.07, -0.03), 0.004);
    head.from = 3;
    // …and a band of light round its middle.
    head.neon(new Trim().ring(0.2, 0.066, 0.005), at(0, 0, -0.03));
    const swing = new Piece();
    // The hinge: a gem through the top of the pylon.
    swing.solid(new OctahedronGeometry(0.045, 0), at(0, 0, 0, 0, 0, 0, 1.6, 0.8, 0.8));
    // THE ARM: long and thin, out to the head.
    swing.solid(prismGeo(0.016, 0.016, 0.48, 4), at(0, 0, 0.24, Math.PI / 2), 0.004);
    // THE HEAD: a fat hex prism across the end of the arm, its striking
    // face down (−Y in the arm's frame), ringed and lit.
    swing.solid(prismGeo(0.07, 0.07, 0.16), at(0, -0.02, 0.5));
    swing.neon(new Trim().ring(-0.1, 0.055, 0.006).ring(-0.1, 0.03, 0.004), at(0, 0, 0.5));
    swing.lit(new CircleGeometry(0.06, 6), at(0, -0.101, 0.5, Math.PI / 2));
    swing.from = 2;
    swing.solid(prismGeo(0.078, 0.078, 0.04), at(0, -0.02, 0.5), 0.004);
    // A counterweight on the arm's short end, behind the hinge.
    swing.solid(prismGeo(0.04, 0.04, 0.07), at(0, 0, -0.07, Math.PI / 2), 0.0035);
    swing.from = 3;
    // A BIGGER HEAD: a heavier shell round the striking block.
    swing.solid(prismGeo(0.092, 0.092, 0.11), at(0, -0.02, 0.5), 0.0045);
    swing.neon(new Trim().ring(-0.08, 0.094, 0.006), at(0, 0, 0.5));
    return { base, head, swing };
  });
  const w = new Wardrobe(hex);
  padGlow(group, hex, 0.16);
  group.add(still(w.wear(k.base)));
  const head = w.wear(k.head);
  group.add(head);
  const pilot = pilotMat(hex);
  const swing = w.wear(k.swing, pilot);
  swing.position.set(0, PIV, -0.03);
  swing.rotation.x = -0.55;
  head.add(swing);
  return { head, barrel: null, kick: 0, flash: null, flashMesh: null, pilot, swing, dress: w.dress };
}

/* ── the core ───────────────────────────────────────────────────────────── */

/** What SiegeSystem drives on the core every frame. */
export interface CoreRefs {
  /** The crystal (hovers, turns). */
  spin: Group;
  /** The three orbiting halo rings. */
  rings: Group[];
  /** The crystal's glass, the light inside it and the rings' light. */
  glass: MeshStandardMaterial;
  heart: MeshBasicMaterial;
  ringMat: MeshBasicMaterial;
  /** The crystal's traced edges. */
  edge: MeshBasicMaterial;
  /** Crack sets, shown one by one as the core's health falls. */
  cracks: Group[];
}

/**
 * THE CORE — a big hovering crystal over a wide hex pad: a long gold
 * bipyramid with a hot heart, turning slowly inside three tilted halo
 * rings. Its cracks are drawn in now and shown as it is hurt.
 */
export function buildCore(group: Group): CoreRefs {
  const hex = NEON.dock;
  // The pad, and a low ring of shards round its edge holding it in
  // place: one standing piece.
  const k = kit('core', () => {
    const base = new Piece();
    hexPad(base, 0.17);
    for (let s = 0; s < 6; s++) {
      const a = (s / 6) * Math.PI * 2;
      base.solid(shardGeo(0.018, 0.08, 0.01), at(Math.sin(a) * 0.15, 0.04, Math.cos(a) * 0.15), 0.003);
    }
    return { base };
  });
  padGlow(group, hex, 0.17);
  group.add(still(new Wardrobe(hex).wear(k.base)));
  const spin = new Group();
  spin.position.y = 0.62;
  group.add(spin);
  const R = 0.13;
  const UP = 0.32;
  const DOWN = 0.22;
  const geo = shardGeo(R, UP, DOWN);
  // Its own glass (not shared): it dims as the core is hurt.
  const glassMat = new MeshStandardMaterial({
    color: 0x16110a,
    emissive: hex,
    emissiveIntensity: 0.32,
    roughness: 0.1,
    metalness: 0.5,
    flatShading: true,
    transparent: true,
    opacity: 0.82,
  });
  const body = new Mesh(geo, glassMat);
  spin.add(body);
  const lines = new Group();
  traceEdges(new Trim(), geo, 0.007).into(lines, hex);
  // Its own edge light (not the shared tube), so the outline dims too.
  const edge = new MeshBasicMaterial({ color: hex, toneMapped: false });
  lines.traverse((o) => {
    if ((o as Mesh).isMesh && o.name === 'neon') (o as Mesh).material = edge;
  });
  spin.add(lines);
  const heart = additive(0xffe6a0, 0.85);
  const heartMesh = new Mesh(new OctahedronGeometry(0.05, 1), heart);
  heartMesh.scale.y = 1.6;
  heartMesh.renderOrder = 10;
  spin.add(heartMesh);

  // CRACKS: zig-zags of hot white-red across the faces, three sets.
  const cracks: Group[] = [];
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  // The surface radius at height y and angle a (a hex bipyramid).
  const surf = (y: number, a: number): number => {
    const t = y >= 0 ? 1 - y / UP : 1 + y / DOWN;
    const seg = Math.PI / 3;
    const local = ((a % seg) + seg) % seg - seg / 2;
    return (R * t * Math.cos(seg / 2)) / Math.cos(local) + 0.004;
  };
  for (let set = 0; set < 3; set++) {
    const g = new Group();
    const t = new Trim();
    for (let c = 0; c < 2 + set; c++) {
      let a = rnd() * Math.PI * 2;
      let y = (rnd() - 0.4) * 0.25;
      for (let k = 0; k < 5; k++) {
        const na = a + (rnd() - 0.5) * 0.7;
        const ny = Math.max(-DOWN * 0.8, Math.min(UP * 0.8, y + (rnd() - 0.5) * 0.12));
        const r0 = surf(y, a);
        const r1 = surf(ny, na);
        t.line(Math.sin(a) * r0, y, Math.cos(a) * r0, Math.sin(na) * r1, ny, Math.cos(na) * r1, 0.0055);
        a = na;
        y = ny;
      }
    }
    t.into(g, 0xff3a1a);
    g.visible = false;
    spin.add(g);
    cracks.push(g);
  }

  // THE HALO RINGS, each on its own tilt, each turning its own way.
  const ringMat = new MeshBasicMaterial({ color: hex, toneMapped: false, transparent: true, opacity: 1 });
  const rings: Group[] = [];
  for (const [r, tx, tz] of [
    [0.2, 0.35, 0.1],
    [0.235, -0.25, 0.45],
    [0.27, 0.1, -0.55],
  ] as Array<[number, number, number]>) {
    const tiltG = new Group();
    tiltG.position.y = 0.62;
    tiltG.rotation.set(tx, 0, tz);
    group.add(tiltG);
    const ring = new Group();
    tiltG.add(ring);
    const t = new Trim().ring(0, r, 0.0045);
    t.into(ring, hex);
    // Swap the shared tube material for the core's own (it dims).
    ring.traverse((o) => {
      if ((o as Mesh).isMesh && o.name === 'neon') (o as Mesh).material = ringMat;
    });
    // A bead riding each ring.
    const bead = new Mesh(new OctahedronGeometry(0.014, 0), heart);
    bead.position.set(r, 0, 0);
    ring.add(bead);
    rings.push(ring);
  }
  return { spin, rings, glass: glassMat, heart, ringMat, edge, cracks };
}
