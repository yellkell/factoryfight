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
 * Built in plant metres, out along +Z, like every other builder. The
 * contract with SiegeSystem is GunRefs (units.ts) plus CoreRefs here.
 */

import {
  AdditiveBlending,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  ShaderMaterial,
  SphereGeometry,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { beamGradientTexture } from '../materials/glow.js';
import { NEON, Trim } from './neon.js';
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

/** A faceted solid of glass, its edges in neon — added to `parent`. */
function crystal(parent: Object3D, geo: BufferGeometry, hex: number, r?: number): Mesh {
  const m = new Mesh(geo, glass(hex));
  parent.add(m);
  const g = new Group();
  traceEdges(new Trim(), geo, r).into(g, hex);
  m.add(g);
  return m;
}

/**
 * THE HEX PAD: a low hexagonal plinth of glass, its rim and an inner hex
 * traced in light, and a soft hex of glow on the floor round it.
 */
function hexPad(group: Group, hex: number, radius = 0.15): void {
  const h = 0.03;
  const geo = prismGeo(radius + 0.01, radius, h);
  geo.translate(0, h / 2, 0);
  const pad = new Mesh(geo, glass(hex));
  pad.rotation.y = Math.PI / 6;
  group.add(pad);
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
  const lines = new Group();
  lines.rotation.y = Math.PI / 6;
  t.into(lines, hex);
  group.add(lines);
  const pool = new Mesh(new CircleGeometry(radius * 1.45, 6), additive(hex, 0.1));
  pool.name = 'pad-glow';
  pool.rotation.x = -Math.PI / 2;
  pool.rotation.z = Math.PI / 6;
  pool.position.y = 0.002;
  pool.renderOrder = 8;
  group.add(pool);
}

const pilotMat = (hex: number): MeshBasicMaterial =>
  new MeshBasicMaterial({ color: hex, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false });

/** A short-lived flash of light (opacity driven by SiegeSystem). */
const flashMat = (hex: number): MeshBasicMaterial => additive(hex, 0);

/* ── the towers ─────────────────────────────────────────────────────────── */

/**
 * THE TURRET — a cut obelisk on its pad with a turntable on its top, and
 * in the turntable's yoke a long lance of crystal that slews to its
 * target and spits slugs from its point. Muzzle at 0.48.
 */
export function buildTurret(group: Group): GunRefs {
  const hex = NEON.turret;
  hexPad(group, hex);
  const ob = crystal(group, prismGeo(0.075, 0.05, 0.36), hex);
  ob.position.y = 0.21;
  const head = new Group();
  head.position.y = 0.39;
  group.add(head);
  // The turntable: a squat hex collar riding the obelisk's top.
  const table = crystal(head, prismGeo(0.062, 0.056, 0.03), hex, 0.004);
  table.position.y = 0.015;
  // The yoke: two cheek plates standing off the turntable, holding the
  // lance between them.
  for (const sx of [-1, 1]) {
    const cheek = crystal(head, prismGeo(0.012, 0.01, 0.09, 4), hex, 0.0035);
    cheek.scale.set(1, 1, 3.2);
    cheek.position.set(sx * 0.05, 0.075, 0);
  }
  const barrel = new Group();
  barrel.position.y = 0.09;
  head.add(barrel);
  // The lance lies along +Z: a bipyramid on its side, its long point out.
  const lanceGeo = shardGeo(0.042, 0.22, 0.09);
  lanceGeo.rotateX(Math.PI / 2);
  crystal(barrel, lanceGeo, hex);
  const pilot = pilotMat(hex);
  const eye = new Mesh(new SphereGeometry(0.016, 10, 8), pilot);
  barrel.add(eye);
  const flash = flashMat(0xffd0d8);
  const flashMesh = new Mesh(new CylinderGeometry(0, 1, 1, 10, 1, true), flash);
  flashMesh.rotation.x = -Math.PI / 2;
  flashMesh.scale.set(0.05, 0.1, 0.05);
  flashMesh.position.z = 0.29;
  flashMesh.renderOrder = 14;
  barrel.add(flashMesh);
  return { head, barrel, kick: 0.04, flash, flashMesh, pilot };
}

/**
 * THE MORTAR — a ring of six standing shards round the pad, and inside
 * them a fat hexagonal tube of glass cocked up at 55°, ringed in teal at
 * the mouth. It kicks down its bore and lobs a shell over the room.
 * Muzzle at 0.55.
 */
export function buildMortar(group: Group): GunRefs {
  const hex = NEON.mortar;
  hexPad(group, hex, 0.16);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const s = crystal(group, shardGeo(0.025, 0.12, 0.02), hex, 0.0035);
    s.position.set(Math.sin(a) * 0.135, 0.05, Math.cos(a) * 0.135);
    s.rotation.set(Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25);
  }
  // The pedestal the gun turns on.
  const ped = crystal(group, prismGeo(0.1, 0.085, 0.14), hex);
  ped.position.y = 0.1;
  const head = new Group();
  head.position.y = 0.2;
  group.add(head);
  const base = crystal(head, prismGeo(0.1, 0.08, 0.06), hex);
  base.position.y = 0.0;
  const tilt = new Group();
  tilt.position.y = 0.07;
  tilt.rotation.x = -0.96; // cocked up, firing over +Z
  head.add(tilt);
  const barrel = new Group();
  tilt.add(barrel);
  const tubeGeo = new CylinderGeometry(0.062, 0.07, 0.3, 6, 1, true).toNonIndexed();
  tubeGeo.rotateX(Math.PI / 2);
  tubeGeo.translate(0, 0, 0.08);
  const tube = new Mesh(tubeGeo, glass(hex));
  (tube.material as MeshStandardMaterial).side = DoubleSide;
  barrel.add(tube);
  const t = new Trim();
  traceEdges(t, tubeGeo);
  const mouth = new Group();
  t.into(mouth, hex);
  barrel.add(mouth);
  const ringT = new Trim().hoop(0, 0, 0.23, 0.07, 0.007).hoop(0, 0, 0.16, 0.068, 0.004);
  const rings = new Group();
  ringT.into(rings, hex);
  barrel.add(rings);
  const flash = flashMat(0xe0fff4);
  const flashMesh = new Mesh(new CylinderGeometry(0, 1, 1, 10, 1, true), flash);
  flashMesh.rotation.x = -Math.PI / 2;
  flashMesh.scale.set(0.09, 0.2, 0.09);
  flashMesh.position.z = 0.33;
  barrel.add(flashMesh);
  const pilot = pilotMat(hex);
  const core = new Mesh(new SphereGeometry(0.03, 10, 8), pilot);
  core.position.z = -0.02;
  barrel.add(core);
  return { head, barrel, kick: 0.06, flash, flashMesh, pilot };
}

/**
 * THE TESLA COIL — a tall twisted spire of three stacked prisms, its
 * point run up into a bright orb held inside two crossed rings. The arcs
 * leave the orb. Doesn't turn. Muzzle at 0.72.
 */
export function buildTesla(group: Group): GunRefs {
  const hex = NEON.tesla;
  hexPad(group, hex);
  let y = 0.03;
  const parts: Array<[number, number, number]> = [
    [0.07, 0.05, 0.26],
    [0.05, 0.035, 0.22],
    [0.035, 0.015, 0.18],
  ];
  parts.forEach(([r0, r1, h], k) => {
    const p = crystal(group, prismGeo(r0, r1, h), hex);
    p.position.y = y + h / 2;
    p.rotation.y = k * 0.35;
    y += h; // stacked flush: no gaps between the segments
  });
  const crown = new Group();
  crown.position.y = 0.72; // the orb sits on the spire's point (0.69)
  group.add(crown);
  for (const [rx, rz] of [
    [Math.PI / 2, 0.5],
    [Math.PI / 2, -0.5],
  ]) {
    const ring = new Group();
    ring.rotation.set(rx, 0, rz);
    new Trim().ring(0, 0.085, 0.005).into(ring, hex);
    crown.add(ring);
  }
  const pilot = pilotMat(hex);
  const orb = new Mesh(new OctahedronGeometry(0.04, 1), pilot);
  crown.add(orb);
  const flash = flashMat(0xf3e6ff);
  const flashMesh = new Mesh(new SphereGeometry(1, 14, 10), flash);
  flashMesh.scale.setScalar(0.12);
  crown.add(flashMesh);
  return { head: null, barrel: null, kick: 0, flash, flashMesh, pilot, spin: [crown] };
}

/**
 * THE FLAMER — three crystals leaning out of the pad like a brazier round
 * a central stem, and on the stem's turntable a cut cone of glass
 * pointing at the lane: the fire pours from its tip. Muzzle at 0.44.
 */
export function buildFlamer(group: Group): GunRefs {
  const hex = NEON.flamer;
  hexPad(group, hex);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI;
    const s = crystal(group, shardGeo(0.04, 0.3, 0.03), hex);
    s.position.set(Math.sin(a) * 0.06, 0.04, Math.cos(a) * 0.06);
    s.rotation.set(Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3);
  }
  const stem = crystal(group, prismGeo(0.035, 0.028, 0.34), hex, 0.004);
  stem.position.y = 0.2;
  const head = new Group();
  head.position.y = 0.44;
  group.add(head);
  const table = crystal(head, prismGeo(0.045, 0.04, 0.03), hex, 0.004);
  table.position.y = -0.055;
  const barrel = new Group();
  head.add(barrel);
  const nozzleGeo = new ConeGeometry(0.06, 0.2, 6, 1).toNonIndexed();
  nozzleGeo.rotateX(Math.PI / 2);
  nozzleGeo.translate(0, 0, 0.08);
  crystal(barrel, nozzleGeo, hex);
  const pilot = pilotMat(0xff9a3a);
  const flame = new Mesh(new SphereGeometry(1, 10, 8), pilot);
  flame.scale.set(0.014, 0.014, 0.024);
  flame.position.z = 0.19;
  barrel.add(flame);
  const back = crystal(barrel, new OctahedronGeometry(0.05, 0), hex);
  back.position.z = -0.04;
  // THE TONGUE: a cone with its point at the tip, opening along +Z. Three
  // layers, hot white at the root and red at its reach.
  const cone = new ConeGeometry(1, 1, 18, 1, true);
  cone.rotateX(-Math.PI / 2);
  cone.translate(0, 0, 0.5);
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
    const m = new Mesh(cone, mat);
    m.position.z = 0.18;
    m.visible = false;
    m.renderOrder = 14;
    m.userData.opacity = opacity;
    barrel.add(m);
    jet.push(m);
  }
  return { head, barrel, kick: 0.006, flash: null, flashMesh: null, pilot, jet };
}

/**
 * THE HAMMER — a crystal pylon on its pad with a long arm hinged at its
 * top, and on the end of the arm a great hex-prism head. It turns to
 * what is coming, heaves the head up, and brings it down on them.
 * SiegeSystem swings `swing` about X (0 = the arm level, + = down).
 */
export function buildHammer(group: Group): GunRefs {
  const hex = NEON.hammer;
  hexPad(group, hex, 0.16);
  const head = new Group();
  head.position.y = 0.03;
  group.add(head);
  const pylon = crystal(head, prismGeo(0.07, 0.05, 0.3), hex);
  pylon.position.set(0, 0.15, -0.03);
  const swing = new Group();
  swing.position.set(0, 0.33, -0.03);
  head.add(swing);
  // The hinge: a gem through the top of the pylon.
  const hinge = crystal(swing, new OctahedronGeometry(0.045, 0), hex);
  hinge.scale.set(1.6, 0.8, 0.8);
  const armGeo = prismGeo(0.016, 0.016, 0.48, 4);
  armGeo.rotateX(Math.PI / 2);
  armGeo.translate(0, 0, 0.24);
  crystal(swing, armGeo, hex, 0.004);
  // The head: a fat hex prism across the end of the arm, its striking
  // face down (−Y in the arm's frame).
  const mallet = crystal(swing, prismGeo(0.07, 0.07, 0.16), hex);
  mallet.position.set(0, -0.02, 0.5);
  const face = new Group();
  face.position.set(0, -0.1, 0.5);
  new Trim().ring(0, 0.055, 0.006).ring(0, 0.03, 0.004).into(face, hex);
  swing.add(face);
  const pilot = pilotMat(hex);
  const glow = new Mesh(new CircleGeometry(0.06, 6), pilot);
  glow.rotation.x = Math.PI / 2;
  glow.position.set(0, -0.101, 0.5);
  swing.add(glow);
  swing.rotation.x = -0.55;
  return { head, barrel: null, kick: 0, flash: null, flashMesh: null, pilot, swing };
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
  hexPad(group, hex, 0.17);
  // A low ring of shards round the pad edge holds it in place.
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const s = crystal(group, shardGeo(0.018, 0.08, 0.01), hex, 0.003);
    s.position.set(Math.sin(a) * 0.15, 0.04, Math.cos(a) * 0.15);
  }
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

/* ── the gates ──────────────────────────────────────────────────────────── */

const VOID_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const VOID_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uOpen;   // 0 shut .. 1 pouring
uniform float uR;
varying vec2 vP;
void main() {
  vec2 p = vP / uR;
  float r = length(p);
  float a = atan(p.y, p.x);
  // Three arms winding in toward the middle, turning faster as it opens.
  float arms = sin(a * 3.0 + r * 11.0 - uTime * (1.5 + 4.0 * uOpen));
  arms = smoothstep(0.35, 1.0, arms) * (1.0 - r * 0.6);
  // A hot eye in the centre and a rim of light at the frame.
  float eye = pow(max(0.0, 1.0 - r * 1.6), 3.0);
  float rim = smoothstep(0.7, 1.0, r);
  float glow = (arms * 0.75 + eye * 0.9 + rim * 0.35) * (0.25 + 0.75 * uOpen);
  vec3 col = mix(vec3(0.02, 0.0, 0.03), uColor, clamp(glow, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/** What SiegeSystem drives on a gate every frame. */
export interface GateRefs {
  group: Group;
  /** The swirling void inside the frame (uTime, uOpen, uColor). */
  voidMat: ShaderMaterial;
  voidMesh: Mesh;
  /** The gate's own glass, neon and halo — it dims when sealed. */
  glass: MeshStandardMaterial;
  tube: MeshBasicMaterial;
  halo: MeshBasicMaterial;
  /** The glow it throws on the floor in front of it. */
  pool: MeshBasicMaterial;
  /** Two hex rings inside the frame, turned against each other. */
  rings: Group[];
}

/**
 * THE GATE — where the tide comes through your wall. A hexagonal portal
 * standing flush against the plaster, its flat foot on the floor: a
 * frame of dark crystal beams traced in the tide's magenta, two hex
 * rings turning against each other inside it, and in the middle a void
 * that swirls — slow while it gathers, hard and bright while they pour
 * out. A crystal pylon stands at each side, and a half-hex of light
 * spills across the floor in front. Built facing +Z (into the room),
 * with the wall at z = 0.
 */
export function buildGate(hex: number): GateRefs {
  const group = new Group();
  const R = 0.27;
  const cy = R * Math.sin(Math.PI / 3) + 0.012;
  const glassMat = new MeshStandardMaterial({
    color: 0x0c0a12,
    emissive: hex,
    emissiveIntensity: 0.2,
    roughness: 0.15,
    metalness: 0.5,
    flatShading: true,
    transparent: true,
    opacity: 0.92,
  });
  const tube = new MeshBasicMaterial({ color: hex, toneMapped: false });
  const halo = new MeshBasicMaterial({
    color: hex,
    transparent: true,
    opacity: 0.22,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const own = (g: Object3D): void =>
    g.traverse((o) => {
      if (!(o as Mesh).isMesh) return;
      if (o.name === 'neon') (o as Mesh).material = tube;
      else if (o.name === 'neon-halo') (o as Mesh).material = halo;
    });

  const frame = new Group();
  frame.position.set(0, cy, 0.03);
  group.add(frame);
  const W = 0.045;
  const D = 0.06;
  const beam = new CylinderGeometry(1, 1, 1, 4).toNonIndexed();
  beam.rotateY(Math.PI / 4);
  for (let k = 0; k < 6; k++) {
    const a0 = (k / 6) * Math.PI * 2;
    const a1 = ((k + 1) / 6) * Math.PI * 2;
    const x0 = Math.cos(a0) * R;
    const y0 = Math.sin(a0) * R;
    const x1 = Math.cos(a1) * R;
    const y1 = Math.sin(a1) * R;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const g = new Group();
    g.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
    g.rotation.z = Math.atan2(y1 - y0, x1 - x0) - Math.PI / 2;
    const m = new Mesh(beam, glassMat);
    m.scale.set(W / Math.SQRT2, len + W * 0.6, D / Math.SQRT2);
    g.add(m);
    new Trim().box(0, 0, 0, W, len + W * 0.6, D, 0.005).into(g, hex);
    frame.add(g);
  }
  // A gem at each corner of the frame.
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const gem = new Mesh(new OctahedronGeometry(0.03, 0), glassMat);
    gem.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
    frame.add(gem);
    const t = new Group();
    t.position.copy(gem.position);
    traceEdges(new Trim(), new OctahedronGeometry(0.03, 0), 0.003).into(t, hex);
    frame.add(t);
  }

  // The rings: hex outlines inside the frame, each on its own turn.
  const rings: Group[] = [];
  for (const [rr, z, w] of [
    [R * 0.8, 0.02, 0.0045],
    [R * 0.6, 0.035, 0.0035],
  ] as Array<[number, number, number]>) {
    const ring = new Group();
    ring.position.set(0, cy, z);
    const t = new Trim();
    for (let k = 0; k < 6; k++) {
      const a0 = (k / 6) * Math.PI * 2;
      const a1 = ((k + 1) / 6) * Math.PI * 2;
      t.line(Math.cos(a0) * rr, Math.sin(a0) * rr, 0, Math.cos(a1) * rr, Math.sin(a1) * rr, 0, w);
    }
    t.into(ring, hex);
    group.add(ring);
    rings.push(ring);
  }

  // The void.
  const voidMat = new ShaderMaterial({
    vertexShader: VOID_VERT,
    fragmentShader: VOID_FRAG,
    uniforms: {
      uColor: { value: new Color(hex) },
      uTime: { value: 0 },
      uOpen: { value: 0 },
      uR: { value: R * 0.95 },
    },
  });
  const voidMesh = new Mesh(new CircleGeometry(R * 0.95, 6), voidMat);
  voidMesh.position.set(0, cy, 0.012);
  group.add(voidMesh);

  // The pylons, one either side, sunk into the floor and leaning out.
  for (const sx of [-1, 1]) {
    const geo = shardGeo(0.036, 0.26, 0.03);
    const p = new Mesh(geo, glassMat);
    p.position.set(sx * (R + 0.08), 0.02, 0.06);
    p.rotation.z = -sx * 0.14;
    group.add(p);
    const t = new Group();
    t.position.copy(p.position);
    t.rotation.copy(p.rotation);
    traceEdges(new Trim(), geo, 0.0035).into(t, hex);
    group.add(t);
  }

  // The threshold: a half-hex of light on the floor in front.
  const pool = new MeshBasicMaterial({
    color: hex,
    transparent: true,
    opacity: 0.15,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  });
  const poolMesh = new Mesh(new CircleGeometry(R * 1.5, 6, 0, Math.PI), pool);
  poolMesh.rotation.x = -Math.PI / 2;
  poolMesh.rotation.z = Math.PI;
  poolMesh.position.set(0, 0.004, 0.02);
  poolMesh.renderOrder = 8;
  group.add(poolMesh);

  own(group);
  return { group, voidMat, voidMesh, glass: glassMat, tube, halo, pool, rings };
}
