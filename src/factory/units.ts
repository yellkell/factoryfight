/**
 * The plant's hardware — bench units, feed pillars, and the parts
 * themselves. Same economy as tube/build.ts: a handful of shared unit
 * geometries scaled into place, silhouette and surface carrying the
 * identity, hairlines and one amber accent carrying the chrome.
 *
 * THE SHAPES ARE THE ORIGINAL ONES. A pass went through here re-cutting
 * every chassis from flat stock — square boxes, folded hoppers, bolt
 * rows, gussets, flat shading — on the note that the floor read as a
 * steam museum rather than a factory. In a headset it read worse: the
 * hard facets and the bolt detail ate the silhouettes at four metres,
 * and the drums, bands and torus mouths turned out to be doing more work
 * than they looked like they were. Reverted, and staying reverted. The
 * VAT is the one machine that never had an earlier design to go back to,
 * so it is built in this idiom rather than the other one — a banded tank,
 * which is what a vat is anyway.
 *
 * Everything here BUILDS; FactorySystem poses and animates, and
 * factory/craft.ts plays each item's own making on the die set and the
 * press frame built here. The gland
 * (a unit's tube intake) deliberately mirrors the socket's anatomy —
 * ring, open throat, iris, guide — because to the pull it IS a socket,
 * just one that stands on legs. Only a MAKER and the VAT wear one: the
 * bank stopped taking tubes when the book stopped counting draughts, and
 * a bank that caught the tube you were walking past it was the single
 * most-cursed magnet in the game.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  Quaternion,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type Object3D,
} from 'three';
import { FACTORY, FLOOR, LINES, UNITS, type ItemId, type LineSpec, type UnitType } from '../config.js';
import { CHUTE_SLIDE, glandReach } from './sim.js';
import type { CraftRig } from './craft.js';
import { glintTexture, sizedPointsMaterial } from '../materials/glow.js';
import { createVatLiquid } from '../materials/vat.js';

/* ── shared geometry / materials ────────────────────────────────────────── */

let _box: BoxGeometry | null = null;
const boxGeo = (): BoxGeometry => (_box ??= new BoxGeometry(1, 1, 1));
let _boxEdges: EdgesGeometry | null = null;
const boxEdges = (): EdgesGeometry => (_boxEdges ??= new EdgesGeometry(boxGeo()));
let _cyl: CylinderGeometry | null = null;
const cylGeo = (): CylinderGeometry => (_cyl ??= new CylinderGeometry(1, 1, 1, 12));
let _openCyl: CylinderGeometry | null = null;
const openCylGeo = (): CylinderGeometry => (_openCyl ??= new CylinderGeometry(1, 1, 1, 18, 1, true));
let _torus: TorusGeometry | null = null;
const torusGeo = (): TorusGeometry => (_torus ??= new TorusGeometry(1, 0.13, 10, 24));
let _ring: RingGeometry | null = null;
const ringGeo = (): RingGeometry => (_ring ??= new RingGeometry(0.72, 1, 28));
let _disc: CircleGeometry | null = null;
const discGeo = (): CircleGeometry => (_disc ??= new CircleGeometry(1, 24));

/* ── THE LIVERIES ─────────────────────────────────────────────────────────
 * One accent per trade, so a box says what it IS from across the room
 * the way a pillar says what it carries. The chassis stays the same dark
 * iron everywhere — the identity rides on the DETAILS: the MAKER wears
 * furnace orange on its drum bands (and re-tints to its line the moment
 * one is seated — see FactorySystem, which owns that lerp), the COMBINER
 * wears fitter's brass on the clamp and the spine where its two halves
 * meet, the CHEST wears storeman's olive on its straps and painted lid,
 * and the BANK wears minted gold round its mouth. Rails and posts stay
 * plain: infrastructure has no trade.
 */
export const MAKER_ACCENT = 0xe07a24;
const brassMat = new MeshStandardMaterial({ color: 0xb08d57, roughness: 0.35, metalness: 0.85 });
const oliveMat = new MeshStandardMaterial({ color: 0x6f7c49, roughness: 0.55, metalness: 0.45 });
const goldMat = new MeshStandardMaterial({ color: 0xd8b04a, roughness: 0.3, metalness: 0.9 });

const ironMat = new MeshStandardMaterial({ color: 0x3a332c, roughness: 0.5, metalness: 0.8 });
const ironOpenMat = new MeshStandardMaterial({
  color: 0x35302a,
  roughness: 0.5,
  metalness: 0.8,
  side: DoubleSide,
});
const railMat = new MeshStandardMaterial({ color: 0x2b2622, roughness: 0.55, metalness: 0.75 });
const railOpenMat = new MeshStandardMaterial({
  color: 0x2b2622,
  roughness: 0.55,
  metalness: 0.75,
  side: DoubleSide,
});
const edgeMat = new LineBasicMaterial({ color: 0xffa22e, transparent: true, opacity: 0.35 });
const chevronMat = new MeshBasicMaterial({
  color: 0xffa22e,
  transparent: true,
  opacity: 0.35,
  blending: AdditiveBlending,
  depthWrite: false,
  side: DoubleSide,
});
const irisMat = new MeshBasicMaterial({ color: 0x07070a });

/** A bench box on a leg — every unit's chassis. Returns the box mesh so
 *  callers can hang details off its faces. */
function bench(group: Group, height = UNITS.crate.height, size = UNITS.crate.size): Mesh {
  const { benchTop, legRadius } = UNITS.crate;
  const box = new Mesh(boxGeo(), ironMat);
  box.scale.set(size, height, size);
  box.position.y = benchTop - height / 2;
  group.add(box);
  const frame = new LineSegments(boxEdges(), edgeMat);
  frame.scale.copy(box.scale);
  frame.position.copy(box.position);
  group.add(frame);
  const leg = new Mesh(cylGeo(), ironMat);
  const legH = benchTop - height;
  leg.scale.set(legRadius, legH, legRadius);
  leg.position.y = legH / 2;
  group.add(leg);
  const foot = new Mesh(cylGeo(), ironMat);
  foot.scale.set(legRadius * 3.4, 0.016, legRadius * 3.4);
  foot.position.y = 0.008;
  group.add(foot);
  return box;
}

/* ── THE SIEGE'S PLANT: the gun and the wall ─────────────────────────────
 * Same idiom as everything else on the floor — dark iron, drums and
 * torus bands, one trade accent — so a turret reads as SHOP plant that
 * happens to point at things, not a game-asset gun bolted onto a
 * factory. The gunner's trade colour is SIGNAL RED, on the slewing ring
 * and the muzzle brake; the wall wears hazard stripes along its crown,
 * because the whole of the siege's livery is caution tape that grew up.
 */
const signalMat = new MeshStandardMaterial({ color: 0xc8361f, roughness: 0.4, metalness: 0.7 });
const gunMat = new MeshStandardMaterial({ color: 0x2c2a2b, roughness: 0.38, metalness: 0.9 });
const plateMat = new MeshStandardMaterial({ color: 0x45403a, roughness: 0.62, metalness: 0.7 });

let _hazardTex: CanvasTexture | null = null;
function hazardTexture(): CanvasTexture {
  if (_hazardTex) return _hazardTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#171216';
  g.fillRect(0, 0, 128, 32);
  g.fillStyle = '#ffa22e';
  for (let x = -32; x < 160; x += 32) {
    g.beginPath();
    g.moveTo(x, 32);
    g.lineTo(x + 16, 32);
    g.lineTo(x + 32, 0);
    g.lineTo(x + 16, 0);
    g.closePath();
    g.fill();
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  _hazardTex = tex;
  return tex;
}

/**
 * THE TURRET. A pedestal on the bench leg, a SLEWING RING in signal red,
 * and on it the head: an armoured mantlet with one heavy barrel out the
 * front (muzzle brake, recoil sleeve) and the BREECH HOPPER on its back —
 * the funnel a rail drops parts into, with a pip lamp for each part
 * loaded. A glow band round the barrel's root wears the colour of the
 * round in the chamber, so you can read what a gun is firing from across
 * the room. The muzzle sits at SIEGE.turret.muzzleY (1.02), which is
 * where the sim says shots leave from.
 */
function buildTurret(group: Group): NonNullable<UnitRefs['gun']> {
  unitLeg(group, 0.6, 0.05);
  const pedestal = new Mesh(sided(8), gunMat);
  pedestal.scale.set(0.13, 0.12, 0.13);
  pedestal.position.y = 0.66;
  group.add(pedestal);
  const ring = new Mesh(torusGeo(), signalMat);
  ring.rotation.x = Math.PI / 2;
  ring.scale.setScalar(0.135);
  ring.position.y = 0.73;
  group.add(ring);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const bolt = new Mesh(sided(6), hubMat);
    bolt.scale.set(UNITS.boltR, 0.014, UNITS.boltR);
    bolt.position.set(Math.sin(a) * 0.112, 0.725, Math.cos(a) * 0.112);
    group.add(bolt);
  }

  const head = new Group();
  head.position.y = 0.74;
  group.add(head);
  // The mantlet: a drum on its side, faced with a plate.
  const body = new Mesh(new CylinderGeometry(1, 1, 1, 16), gunMat);
  body.rotation.z = Math.PI / 2;
  body.scale.set(0.11, 0.2, 0.11);
  body.position.set(0, 0.17, -0.01);
  head.add(body);
  const face = new Mesh(boxGeo(), plateMat);
  face.scale.set(0.2, 0.17, 0.03);
  face.position.set(0, 0.17, 0.09);
  head.add(face);
  const frame = new LineSegments(boxEdges(), edgeMat);
  frame.scale.copy(face.scale);
  frame.position.copy(face.position);
  head.add(frame);
  for (const sx of [-1, 1]) {
    const cheek = new Mesh(new CylinderGeometry(1, 1, 1, 16), plateMat);
    cheek.rotation.z = Math.PI / 2;
    cheek.scale.set(0.085, 0.02, 0.085);
    cheek.position.set(sx * 0.11, 0.17, -0.01);
    head.add(cheek);
  }

  // The barrel rides its own group so it can RECOIL along +Z.
  const barrel = new Group();
  barrel.position.set(0, 0.28, 0.08); // muzzleY 1.02 = 0.74 + 0.28
  head.add(barrel);
  const tube = new Mesh(new CylinderGeometry(1, 1, 1, 14), gunMat);
  tube.rotation.x = Math.PI / 2;
  tube.scale.set(0.026, 0.26, 0.026);
  tube.position.z = 0.1;
  barrel.add(tube);
  const sleeve = new Mesh(new CylinderGeometry(1, 1, 1, 14), plateMat);
  sleeve.rotation.x = Math.PI / 2;
  sleeve.scale.set(0.036, 0.08, 0.036);
  sleeve.position.z = 0.0;
  barrel.add(sleeve);
  const brake = new Mesh(new CylinderGeometry(1, 1, 1, 8), signalMat);
  brake.rotation.x = Math.PI / 2;
  brake.scale.set(0.038, 0.05, 0.038);
  brake.position.z = 0.235;
  barrel.add(brake);
  const band = new MeshBasicMaterial({
    color: 0x333333,
    transparent: true,
    opacity: 0.9,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const bandRing = new Mesh(torusGeo(), band);
  bandRing.scale.setScalar(0.034);
  bandRing.position.z = 0.05;
  barrel.add(bandRing);
  const flash = new MeshBasicMaterial({
    color: 0xffd38a,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  const flashMesh = new Mesh(new CylinderGeometry(0.0, 1, 1, 10, 1, true), flash);
  flashMesh.rotation.x = -Math.PI / 2;
  flashMesh.scale.set(0.05, 0.12, 0.05);
  flashMesh.position.z = 0.32;
  flashMesh.renderOrder = 14;
  barrel.add(flashMesh);

  // The breech hopper on the back — where a rail's parts drop in.
  const hopper = new Mesh(new CylinderGeometry(1, 0.6, 1, 4, 1, true), ironOpenMat);
  hopper.rotation.y = Math.PI / 4;
  hopper.scale.set(0.08, 0.08, 0.08);
  hopper.position.set(0, 0.29, -0.11);
  head.add(hopper);
  const pips: MeshBasicMaterial[] = [];
  for (let k = 0; k < 4; k++) {
    const m = new MeshBasicMaterial({
      color: 0x222222,
      transparent: true,
      opacity: 0.95,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const pip = new Mesh(discGeo(), m);
    pip.scale.setScalar(0.011);
    pip.position.set(-0.045 + k * 0.03, 0.12, -0.111);
    pip.rotation.y = Math.PI;
    head.add(pip);
    pips.push(m);
  }
  return { head, barrel, flash, flashMesh, band, pips };
}

/**
 * THE WALL. A full cell of armour plate on a sill — two slabs, bolted,
 * with a hazard-striped crown — so a run of them reads as ONE wall, not
 * a row of crates. Lower than the bench (you look over it at what is
 * coming), taller than anything that crawls.
 */
function buildWall(group: Group): void {
  const cell = FLOOR.cell;
  const h = 0.62;
  const sill = new Mesh(boxGeo(), ironMat);
  sill.scale.set(cell, 0.05, cell);
  sill.position.y = 0.025;
  group.add(sill);
  for (const [y, hh, inset] of [
    [0.05, 0.3, 0.015],
    [0.35, 0.24, 0.035],
  ] as const) {
    const slab = new Mesh(boxGeo(), plateMat);
    slab.scale.set(cell - inset, hh, cell - inset);
    slab.position.y = y + hh / 2;
    group.add(slab);
    const frame = new LineSegments(boxEdges(), edgeMat);
    frame.scale.copy(slab.scale);
    frame.position.copy(slab.position);
    group.add(frame);
    // Rivets along each face's top edge.
    for (let f = 0; f < 4; f++) {
      const ang = (f * Math.PI) / 2;
      for (const u of [-0.11, 0, 0.11]) {
        const bolt = new Mesh(sided(6), hubMat);
        bolt.scale.set(UNITS.boltR * 0.8, 0.008, UNITS.boltR * 0.8);
        bolt.rotation.x = Math.PI / 2;
        const r = (cell - inset) / 2 + 0.002;
        bolt.position.set(
          Math.sin(ang) * r + Math.cos(ang) * u,
          y + hh - 0.03,
          Math.cos(ang) * r - Math.sin(ang) * u,
        );
        bolt.rotation.y = ang;
        group.add(bolt);
      }
    }
  }
  const crownMat = new MeshBasicMaterial({ map: hazardTexture() });
  const crown = new Mesh(boxGeo(), crownMat);
  crown.scale.set(cell - 0.03, 0.03, cell - 0.03);
  crown.position.y = h;
  group.add(crown);
}

/* ── the gland: the socket's anatomy on a bench ─────────────────────────── */

export interface GlandRefs {
  group: Group;
  guide: Mesh;
  guideRadius: number;
  guideMat: MeshBasicMaterial;
  glowMat: MeshBasicMaterial;
  iris: Mesh;
}

/** Neutral until a line arrives — FactorySystem tints glow + guide from
 *  the seated run. Local +Z faces outward (the pull approaches along it).
 *
 *  NO DAYLIGHT IN THE JOINT. Two gaps used to live here: the gland's
 *  origin floated a finger's width off the maker's drum (levitating
 *  plumbing), and the collar seated 20 mm BEHIND the rim, clipping
 *  through the throat wall. So the gland now stands on a BOSS — a stub
 *  barrel sunk into the body it serves (sim.glandReach buries it a few
 *  millimetres, so it presses in at every swivel angle) — the mouth is
 *  drawn tighter round the bore it actually takes, and the collar seats
 *  against the rim from the OUTSIDE (FACTORY.glandSeat), pressed on
 *  like a union nut. */
export function buildGland(): GlandRefs {
  const group = new Group();
  // The bore this port takes. Sized to the pipe the FACTORY delivers,
  // not to the wall game's slender head: a shop run spreads five or six
  // of its sections over a metre and a half and arrives around 0.07, so
  // a mouth cut for 0.058 was smaller than the pipe landing in it — the
  // tube covered the port instead of entering it, and no amount of
  // aiming could make that sit flush.
  const r = 0.064;

  // The mounting boss and its clamp band — the part that touches the box.
  const boss = new Mesh(cylGeo(), ironMat);
  boss.rotation.x = Math.PI / 2;
  boss.scale.set(0.075, 0.055, 0.075);
  boss.position.z = -0.022;
  group.add(boss);
  const band = new Mesh(torusGeo(), hubMat);
  band.scale.setScalar(0.079);
  band.position.z = 0.008;
  group.add(band);

  const rim = new Mesh(torusGeo(), ironMat);
  rim.scale.setScalar(r * 1.3);
  rim.position.z = 0.1;
  group.add(rim);

  const throat = new Mesh(openCylGeo(), ironOpenMat);
  throat.rotation.x = Math.PI / 2;
  throat.scale.set(r * 1.3, 0.1, r * 1.3);
  throat.position.z = 0.05;
  group.add(throat);

  const iris = new Mesh(discGeo(), irisMat);
  iris.scale.setScalar(r * 1.15);
  iris.position.z = 0.03;
  group.add(iris);

  const glowMat = new MeshBasicMaterial({
    color: 0xfff0dc,
    transparent: true,
    opacity: 0.18,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  const halo = new Mesh(ringGeo(), glowMat);
  halo.scale.setScalar(r * 2.1);
  halo.position.z = 0.035;
  halo.renderOrder = 12;
  group.add(halo);

  const guideMat = glowMat.clone();
  guideMat.opacity = 0.1;
  const guide = new Mesh(ringGeo(), guideMat);
  guide.scale.setScalar(r * 3.1);
  guide.position.z = 0.14;
  guide.renderOrder = 12;
  group.add(guide);

  return { group, guideMat, glowMat, iris, guide, guideRadius: r * 3.1 };
}

/* ── the belt tread (shared, scrolling) ─────────────────────────────────── */

let _treadTex: CanvasTexture | null = null;
let _treadMat: MeshBasicMaterial | null = null;
const TREAD_SLAT = 0.06; // metres of belt per texture repeat

function treadMaterial(): MeshBasicMaterial {
  if (_treadMat) return _treadMat;
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#17120e';
  g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#2a231b';
  g.fillRect(0, 0, 32, 7); // the slat
  g.fillStyle = '#0d0a08';
  g.fillRect(0, 7, 32, 2); // its shadow line
  _treadTex = new CanvasTexture(canvas);
  _treadTex.wrapT = RepeatWrapping;
  _treadTex.colorSpace = SRGBColorSpace;
  _treadMat = new MeshBasicMaterial({ map: _treadTex, toneMapped: false });
  return _treadMat;
}

/** EVERY belt shares one tread texture, so one offset scroll moves the
 *  whole floor's slats — each piece's rotation carries its direction.
 *  FactorySystem feeds this the sim's own (scaled) speed. */
export function tickBeltTread(delta: number, speed: number): void {
  if (!_treadTex) return;
  _treadTex.offset.y = (_treadTex.offset.y + (delta * speed) / TREAD_SLAT) % 1;
}

/* ── curved + bridged rail geometry ─────────────────────────────────────
 * A corner rail is a real quarter-curve now, and a crossed rail carries
 * a DECK arched over its own lane. Both are built from parametric strips
 * so the shared scrolling tread rides them exactly like the straights:
 * uv.v runs 1 at the entry face to 0 at the exit face, the same
 * orientation the flat tread plane has after its −90° fold.
 */

/** A flat ring-sector strip in the XZ plane about the origin, swept from
 *  φ=−90° through 90° of arc (sweep decides which way), radii r0..r1. */
function arcStrip(r0: number, r1: number, segs: number, vFlip: boolean): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k <= segs; k++) {
    const t = k / segs;
    const phi = -Math.PI / 2 + t * (Math.PI / 2);
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    pos.push(r0 * c, 0, r0 * s, r1 * c, 0, r1 * s);
    const v = vFlip ? t : 1 - t;
    uv.push(0, v, 1, v);
    if (k < segs) {
      const a = k * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A strip along +Z with the bridge's own rise profile — the same
 *  sin(p·π) the sim walks a part over, so deck and part never disagree.
 *  `skirt` hangs it vertical (a girder web) instead of lying it flat. */
function archStrip(width: number, drop: number, segs: number): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k <= segs; k++) {
    const t = k / segs;
    const z = (t - 0.5) * FLOOR.cell * 0.92;
    const y = Math.sin(t * Math.PI) * UNITS.bridgeRise;
    if (drop > 0) {
      pos.push(0, y, z, 0, y - drop, z);
    } else {
      pos.push(-width / 2, y, z, width / 2, y, z);
    }
    const v = 1 - t;
    uv.push(0, v, 1, v);
    if (k < segs) {
      const a = k * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ── units ──────────────────────────────────────────────────────────────── */

export interface UnitRefs {
  group: Group;
  gland: GlandRefs | null;
  /** Maker/combiner: the craft lamp FactorySystem pulses. */
  lampMat: MeshBasicMaterial | null;
  /** THE CRAFT THEATRE — the maker's ram over its anvil, the combiner's
   *  clamp on its press frame, and the flash, glow and sparks each craft
   *  plays with. factory/craft.ts drives it, one choreography per item;
   *  this file only builds it. Null on everything that doesn't craft. */
  craft: CraftRig | null;
  /** The dock's delivery halo — breathes, and flashes when one lands. */
  halo: MeshBasicMaterial | null;
  /** The vat's brew: the level mesh that rises inside the glass, its
   *  material, and the two datums FactorySystem drives it between. */
  fill: ({ mesh: Mesh; top: number; floor: number } & ReturnType<typeof createVatLiquid>) | null;
  /** The vat's under-glow — live from the moment it stands, so an empty
   *  one still reads as WAITING. */
  vatGlow: MeshBasicMaterial | null;
  /** A rail's wardrobe: the straight piece, the two quarter-curves (by
   *  which side the part comes in from), and the bridge deck. One form
   *  shows at a time (+ the deck over the straight on a crossing) —
   *  setBeltForm picks. Null on everything that isn't a rail. */
  belt: { straight: Group; curve1: Group; curve3: Group; arch: Group } | null;
  /** The maker's livery bands — per-unit, so FactorySystem can tint THIS
   *  box to the line feeding it without painting every maker at once. */
  tint: MeshStandardMaterial | null;
  /** THE TURRET's moving parts: the head that slews (yaw about +Y), the
   *  barrel that recoils along its local +Z, the muzzle flash, the band
   *  that wears the colour of whatever is chambered, and the magazine's
   *  pip lamps (one per loaded part). Null on everything else. */
  gun: {
    head: Group;
    barrel: Group;
    flash: MeshBasicMaterial;
    flashMesh: Mesh;
    band: MeshBasicMaterial;
    pips: MeshBasicMaterial[];
  } | null;
}

/**
 * THE CHUTE SLIDE — the piece that actually joins a machine to a rail.
 *
 * A chute was a flat tray at bench height, hung 0.1 m out over the next
 * cell, six centimetres above the rail standing there and touching
 * nothing: a part left the tray by falling through it. The slide leaves
 * the machine's face at bench height and comes down to rail height just
 * over the cell edge (sim.CHUTE_SLIDE — the sim walks parts down the
 * same slope), where its foot rests on the rail's skid tops with a
 * bolted cross-bar under it: a spout the lane runs out of. Built along
 * local +Z; `yaw` turns it onto a combiner's side port, where the same
 * slide is the hopper a lane runs UP into.
 */
function chuteSlide(group: Group, yaw = 0): void {
  const { from, to, topY, footY } = CHUTE_SLIDE;
  const len = Math.hypot(to - from, topY - footY);
  const slide = new Group();
  slide.rotation.y = yaw;
  const bed = new Group();
  bed.position.set(0, (topY + footY) / 2 - 0.006, (from + to) / 2);
  bed.rotation.x = Math.atan2(topY - footY, to - from);
  const tray = new Mesh(boxGeo(), railMat);
  tray.scale.set(0.16, 0.012, len);
  bed.add(tray);
  // Lips up the sides — a chute, not a shelf: the part is IN something
  // all the way down.
  for (const side of [-1, 1]) {
    const lip = new Mesh(boxGeo(), railMat);
    lip.scale.set(0.012, 0.03, len);
    lip.position.set(side * 0.074, 0.009, 0);
    bed.add(lip);
  }
  slide.add(bed);
  // The foot's cross-bar, sat across the rail's skids — with a hex head
  // at each end, because a chute that touches a rail is BOLTED to it.
  const bar = new Mesh(boxGeo(), railMat);
  bar.scale.set(0.17, 0.014, 0.02);
  bar.position.set(0, footY - 0.013, to - 0.004);
  slide.add(bar);
  for (const side of [-1, 1]) {
    const bolt = new Mesh(sided(6), hubMat);
    bolt.scale.set(UNITS.boltR, 0.008, UNITS.boltR);
    bolt.position.set(side * 0.074, footY - 0.002, to - 0.004);
    slide.add(bolt);
  }
  group.add(slide);
}

/** How many sparks a forge throws — the pool every rig carries. */
export const SPARKS = 24;

/**
 * THE CRAFT RIG's effects: a glow disc lying on the stage (molten iron,
 * pooled coolant, a lit filament), a flash ring that expands off a
 * strike, and a pool of sparks (glint sprites, so they read as sparks
 * and not confetti). All of it dark at rest and `visible = false`, so
 * the build ghost — which glasses every mesh it is handed — never shows
 * them. factory/craft.ts owns every number in here after this.
 */
function craftRig(
  group: Group,
  kind: 'maker' | 'combiner',
  head: Object3D,
  stageY: number,
): CraftRig {
  const glowMat = new MeshBasicMaterial({
    color: 0xffa22e,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  const glow = new Mesh(discGeo(), glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.scale.setScalar(kind === 'maker' ? 0.088 : 0.1);
  glow.position.y = stageY + 0.002;
  glow.renderOrder = 12;
  glow.visible = false;
  group.add(glow);

  const flashMat = glowMat.clone();
  const flash = new Mesh(ringGeo(), flashMat);
  flash.rotation.x = -Math.PI / 2;
  flash.position.y = stageY + 0.005;
  flash.renderOrder = 12;
  flash.visible = false;
  group.add(flash);

  // THE HEAT: an additive shell hugging the work — a slug reads as
  // MOLTEN from the side (the disc under it is hidden by it), a canister
  // as sweating coolant, a stack as lit — sized and coloured per frame.
  const heatMat = glowMat.clone();
  const heat = new Mesh(openCylGeo(), heatMat);
  heat.renderOrder = 12;
  heat.visible = false;
  group.add(heat);

  const sparkPos = new Float32Array(SPARKS * 3);
  const sparkVel = new Float32Array(SPARKS * 3);
  const sizes = new Float32Array(SPARKS);
  for (let n = 0; n < SPARKS; n++) sizes[n] = 0.5 + Math.random() * 0.9;
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(sparkPos, 3));
  geo.setAttribute('aSize', new Float32BufferAttribute(sizes, 1));
  const sparkMat = sizedPointsMaterial({
    map: glintTexture(),
    color: 0xffa22e,
    size: 0.035,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const sparks = new Points(geo, sparkMat);
  sparks.frustumCulled = false;
  sparks.renderOrder = 13;
  sparks.visible = false;
  group.add(sparks);

  return {
    kind,
    head,
    headBase: head.position.y,
    stageY,
    glow,
    glowMat,
    flash,
    flashMat,
    flashSize: 0.1,
    heat,
    heatMat,
    sparks,
    sparkMat,
    sparkPos,
    sparkVel,
    item: null,
    lastP: -1,
    flashT: Infinity,
    sparkT: Infinity,
    phantom: Array.from({ length: 6 }, () => new Matrix4()),
    phantomN: 0,
    portPose: [new Matrix4(), new Matrix4()],
    portOn: false,
  };
}

function craftLamp(group: Group, y: number): MeshBasicMaterial {
  const lampMat = new MeshBasicMaterial({
    color: 0xffa22e,
    transparent: true,
    opacity: 0.2,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const lamp = new Mesh(cylGeo(), lampMat);
  lamp.scale.set(0.02, 0.01, 0.02);
  lamp.position.set(0, y, 0);
  group.add(lamp);
  return lampMat;
}

function unitLeg(group: Group, top: number, radius = UNITS.crate.legRadius): void {
  const leg = new Mesh(cylGeo(), ironMat);
  leg.scale.set(radius, top, radius);
  leg.position.y = top / 2;
  group.add(leg);
  // The foot flange — same language as the pillars: a box STANDS on the
  // boards; a bare leg read as stabbed into them.
  const foot = new Mesh(cylGeo(), ironMat);
  foot.scale.set(radius * 3.4, 0.016, radius * 3.4);
  foot.position.y = 0.008;
  group.add(foot);
}

/** One quarter-curve rail form. `rel` is the entry travel relative to
 *  the out face — 3: the part comes in through the local −X face, 1:
 *  through +X — matching (beltEntry − rot) mod 4 on the standing piece.
 *  The arc's centre is the cell corner the entry and out faces share. */
function buildCurveForm(rel: 1 | 3): Group {
  const half = FLOOR.cell / 2;
  const form = new Group();
  const wrap = new Group();
  // Corner between the entry face and the out face; the inner group's
  // quarter-turn flips the whole arc for the mirrored chirality.
  wrap.position.set(rel === 3 ? -half : half, UNITS.railTop, half);
  wrap.rotation.y = rel === 3 ? 0 : Math.PI / 2;
  for (const R of [half - 0.068, half + 0.068]) {
    const rail = new Mesh(new TorusGeometry(R, 0.013, 6, 12, Math.PI / 2), railMat);
    rail.rotation.x = -Math.PI / 2;
    wrap.add(rail);
  }
  const tread = new Mesh(arcStrip(half - 0.057, half + 0.057, 10, rel === 1), treadMaterial());
  tread.position.y = 0.002;
  wrap.add(tread);
  const chev = new Mesh(discGeo(), chevronMat);
  chev.rotation.x = -Math.PI / 2;
  chev.scale.setScalar(0.028);
  chev.position.set(Math.SQRT1_2 * half, 0.006, -Math.SQRT1_2 * half);
  wrap.add(chev);
  form.add(wrap);
  return form;
}

/** The bridge deck — a raised lane arched along local +Z (FactorySystem
 *  yaws it onto the crossing's travel): two rail ribbons with hanging
 *  girder webs, the tread between them, a chevron on the crown. */
function buildArchForm(): Group {
  const arch = new Group();
  arch.position.y = UNITS.railTop + 0.012;
  for (const side of [-1, 1]) {
    const rail = new Mesh(archStrip(0.024, 0, 12), railMat);
    rail.position.x = side * 0.068;
    arch.add(rail);
    const web = new Mesh(archStrip(0, 0.026, 12), railOpenMat);
    web.position.x = side * 0.068;
    arch.add(web);
  }
  const tread = new Mesh(archStrip(0.114, 0, 12), treadMaterial());
  tread.position.y = -0.004;
  arch.add(tread);
  const chev = new Mesh(discGeo(), chevronMat);
  chev.rotation.x = -Math.PI / 2;
  chev.scale.setScalar(0.028);
  chev.position.y = UNITS.bridgeRise + 0.006;
  arch.add(chev);
  return arch;
}

/**
 * Dress a rail for where it stands: `entryRel` = (entry travel − rot)
 * mod 4 picks straight or one of the curves; `overRel` = (deck travel −
 * rot) mod 4, or −1 for no crossing, raises the arch and yaws it onto
 * the deck's heading. The haul's ghosts wear the same wardrobe, so what
 * you drag is what lands.
 */
export function setBeltForm(
  refs: UnitRefs,
  entryRel: number,
  overRel: number,
  underVisible = true,
): void {
  const b = refs.belt;
  if (!b) return;
  b.straight.visible = underVisible && entryRel !== 1 && entryRel !== 3;
  b.curve1.visible = underVisible && entryRel === 1;
  b.curve3.visible = underVisible && entryRel === 3;
  b.arch.visible = overRel === 1 || overRel === 3;
  if (b.arch.visible) b.arch.rotation.y = overRel === 3 ? Math.PI / 2 : -Math.PI / 2;
}

/**
 * All builders face OUT along local +Z; FactorySystem rotates per rot.
 * EVERY ROLE ITS OWN SILHOUETTE — readable from across the room, the way
 * the lines are: the MAKER is a drum with a working die set on its crown
 * (something is being formed there, in the open), the COMBINER is
 * twin-lobed under one clamp on a press frame (two things meet), the
 * CHEST is a banded crate (things keep), and the DOCK is the round
 * pedestal with the amber mouth (things LEAVE here).
 */
export function buildUnit(type: UnitType): UnitRefs {
  const group = new Group();
  const { benchTop, size } = UNITS.crate;
  let gland: GlandRefs | null = null;
  let lampMat: MeshBasicMaterial | null = null;
  let craft: CraftRig | null = null;
  let halo: MeshBasicMaterial | null = null;
  let fill: UnitRefs['fill'] = null;
  let vatGlow: MeshBasicMaterial | null = null;
  let belt: UnitRefs['belt'] = null;
  let tint: MeshStandardMaterial | null = null;
  let gun: UnitRefs['gun'] = null;

  if (type === 'turret') {
    gun = buildTurret(group);
  } else if (type === 'wall') {
    buildWall(group);
  } else if (type === 'dock') {
    // THE DOCK: a round pedestal with a flared amber mouth — the one
    // place parts LEAVE the floor. The halo breathes; a delivery flashes
    // it (the count itself lives on the Ⓐ card, not in the room). Its
    // livery is MINTED GOLD, on the mouth and a waistband: the one box
    // on the floor that is a vault, dressed like one.
    unitLeg(group, 0.45, 0.045);
    const drum = new Mesh(new CylinderGeometry(1, 1, 1, 12), ironMat);
    drum.scale.set(0.15, 0.4, 0.15);
    drum.position.y = 0.65;
    group.add(drum);
    const waist = new Mesh(torusGeo(), goldMat);
    waist.rotation.x = Math.PI / 2;
    waist.scale.setScalar(0.152);
    waist.position.y = 0.56;
    group.add(waist);
    const mouth = new Mesh(torusGeo(), goldMat);
    mouth.rotation.x = Math.PI / 2;
    mouth.scale.setScalar(0.115);
    mouth.position.y = benchTop + 0.012;
    group.add(mouth);
    const throatDisc = new Mesh(discGeo(), irisMat);
    throatDisc.rotation.x = -Math.PI / 2;
    throatDisc.scale.setScalar(0.095);
    throatDisc.position.y = benchTop + 0.004;
    group.add(throatDisc);
    halo = new MeshBasicMaterial({
      color: 0xffa22e,
      transparent: true,
      opacity: 0.25,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    const ring = new Mesh(ringGeo(), halo);
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(0.14);
    ring.position.y = benchTop + 0.02;
    ring.renderOrder = 12;
    group.add(ring);
  } else if (type === 'maker') {
    // THE MAKER: a solidifier drum — feedstock in the back, a die set
    // working on top, stamped parts out the front. Its bands wear the
    // furnace livery cold, and FactorySystem re-paints them to whichever
    // LINE is seated: a maker on violet looks violet from across the
    // room, which is the identity that actually matters — what it makes.
    unitLeg(group, 0.55);
    const drum = new Mesh(new CylinderGeometry(1, 1, 1, 20), ironMat);
    drum.scale.set(0.135, 0.3, 0.135);
    drum.position.y = 0.7;
    group.add(drum);
    tint = new MeshStandardMaterial({
      color: MAKER_ACCENT,
      roughness: 0.4,
      metalness: 0.8,
      emissive: 0x000000,
    });
    for (const y of [0.57, 0.83]) {
      const band = new Mesh(torusGeo(), tint);
      band.rotation.x = Math.PI / 2;
      band.scale.setScalar(0.138);
      band.position.y = y;
      group.add(band);
    }
    // The drum stands on a skirt where it meets the leg, and the ram
    // works through a stuffing box — nothing enters or leaves a pressure
    // vessel through a bare hole. The stuffing box is also THE ANVIL:
    // its top face is the stage every part forms on.
    const skirt = new Mesh(new CylinderGeometry(1, 1, 1, 20), ironMat);
    skirt.scale.set(0.142, 0.018, 0.142);
    skirt.position.y = 0.552;
    group.add(skirt);
    const stageY = benchTop + 0.02;
    const anvil = new Mesh(cylGeo(), hubMat);
    anvil.scale.set(0.072, 0.02, 0.072);
    anvil.position.y = benchTop + 0.01;
    group.add(anvil);
    // THE DIE SET. The old piston bobbed in place on a sine wave
    // whatever was being made. This is a punch plate riding two guide
    // pins: it rests ON the anvil, and craft.ts lifts it clear to strike
    // a gear, draw a cell or scribe a chip. The pins stand OUTSIDE the
    // work (a part forms between them, on the anvil's centre — a single
    // central rod stabbed straight through the canister it was pressing)
    // and run down into the drum, long enough to stay buried at full
    // lift. The craft lamp rides the plate.
    const ram = new Group();
    ram.position.y = stageY + 0.0175;
    const head = new Mesh(cylGeo(), hubMat);
    head.scale.set(0.062, 0.035, 0.062);
    ram.add(head);
    for (const sx of [-1, 1]) {
      const pin = new Mesh(cylGeo(), hubMat);
      pin.scale.set(0.007, 0.2, 0.007);
      pin.position.set(sx * 0.06, -0.1, 0);
      ram.add(pin);
    }
    lampMat = craftLamp(ram, 0.024);
    group.add(ram);
    craft = craftRig(group, 'maker', ram, stageY);
    chuteSlide(group);
    gland = buildGland();
  } else if (type === 'combiner') {
    // THE COMBINER: twin lobes under one clamp — two parts walk in the
    // sides and one deeper part leaves the front.
    unitLeg(group, 0.61);
    for (const side of [-1, 1]) {
      const lobe = new Mesh(boxGeo(), ironMat);
      lobe.scale.set(0.128, 0.24, 0.24);
      lobe.position.set(side * 0.0775, benchTop - 0.12, 0);
      group.add(lobe);
      const frame = new LineSegments(boxEdges(), edgeMat);
      frame.scale.copy(lobe.scale);
      frame.position.copy(lobe.position);
      group.add(frame);
      // The port: the chute slide turned onto this side, foot outward,
      // so the rail that feeds it runs up into the hopper.
      chuteSlide(group, (side * Math.PI) / 2);
    }
    // The FITTER'S BRASS: the clamp that presses two into one, and the
    // spine where the halves meet — the joint IS this box's trade.
    //
    // THE PRESS FRAME. The clamp used to be a bar lying on the lobes
    // that dipped two centimetres on a sine wave. It rides two brass
    // columns now, tall enough to lift clear of a servo stacked on a
    // pump (the tallest thing this box ever fits), so the two parts can
    // walk in under it, meet in the middle, and get PRESSED — craft.ts
    // owns the stroke. Hex caps on the columns: a frame is bolted kit.
    const clamp = new Mesh(boxGeo(), brassMat);
    clamp.scale.set(0.3, 0.04, 0.11);
    clamp.position.y = benchTop + 0.024;
    group.add(clamp);
    for (const sx of [-1, 1]) {
      const column = new Mesh(cylGeo(), brassMat);
      column.scale.set(0.014, 0.28, 0.014);
      column.position.set(sx * 0.128, benchTop + 0.14, 0);
      group.add(column);
      const cap = new Mesh(sided(6), hubMat);
      cap.scale.set(0.022, 0.014, 0.022);
      cap.position.set(sx * 0.128, benchTop + 0.287, 0);
      group.add(cap);
    }
    craft = craftRig(group, 'combiner', clamp, benchTop + 0.003);
    const spine = new Mesh(boxGeo(), brassMat);
    spine.scale.set(0.024, 0.25, 0.25);
    spine.position.y = benchTop - 0.125;
    group.add(spine);
    // Two hex heads down the spine's face: the union is BOLTED, which is
    // the whole promise of a box that fits things together.
    for (const dy of [-0.06, -0.19]) {
      const bolt = new Mesh(sided(6), hubMat);
      bolt.rotation.x = Math.PI / 2;
      bolt.scale.set(UNITS.boltR, 0.01, UNITS.boltR);
      bolt.position.set(0, benchTop + dy, 0.13);
      group.add(bolt);
    }
    chuteSlide(group);
    lampMat = craftLamp(group, benchTop + 0.05);
  } else if (type === 'belt') {
    // THE RAIL: floating — two slim side rails and a slatted TREAD that
    // visibly runs (one shared scrolling texture, rotation = direction).
    // It owns a WARDROBE now: the straight piece, two quarter-curves for
    // when it stands on a corner, and the bridge deck for when another
    // lane crosses it. setBeltForm dresses it for its neighbours.
    const straight = new Group();
    for (const side of [-1, 1]) {
      const rail = new Mesh(boxGeo(), railMat);
      rail.scale.set(0.024, 0.02, 0.35);
      rail.position.set(side * 0.068, UNITS.railTop, 0);
      straight.add(rail);
    }
    const tread = new Mesh(new PlaneGeometry(0.114, 0.34), treadMaterial());
    tread.rotation.x = -Math.PI / 2;
    tread.position.y = UNITS.railTop + 0.002;
    straight.add(tread);
    const chev = new Mesh(discGeo(), chevronMat);
    chev.rotation.x = -Math.PI / 2;
    chev.scale.setScalar(0.028);
    chev.position.set(0, UNITS.railTop + 0.006, 0.13);
    straight.add(chev);
    group.add(straight);
    const curve1 = buildCurveForm(1);
    const curve3 = buildCurveForm(3);
    const arch = buildArchForm();
    curve1.visible = false;
    curve3.visible = false;
    arch.visible = false;
    group.add(curve1, curve3, arch);
    belt = { straight, curve1, curve3, arch };
  } else if (type === 'post') {
    // THE POST: a stick, and honestly a stick. Slim enough to read as
    // scaffolding rather than plant — a survey peg you knock in to say
    // "the lane goes through here", with a bright cap so you can find it
    // across a floor and a foot so it doesn't look like it's floating.
    const { postRadius, postHeight } = UNITS.pull;
    const foot = new Mesh(cylGeo(), hubMat);
    foot.scale.set(0.05, 0.012, 0.05);
    foot.position.y = 0.006;
    group.add(foot);
    const shaft = new Mesh(cylGeo(), railMat);
    shaft.scale.set(postRadius, postHeight, postRadius);
    shaft.position.y = postHeight / 2;
    group.add(shaft);
    // Three collars up the stick: a surveyor's stripes, and they give the
    // eye something to judge distance by across the floor.
    for (const t of [0.35, 0.6, 0.85]) {
      const collar = new Mesh(torusGeo(), hubMat);
      collar.rotation.x = Math.PI / 2;
      collar.scale.setScalar(postRadius * 2.2);
      collar.position.y = postHeight * t;
      group.add(collar);
    }
    const cap = new Mesh(discGeo(), chevronMat);
    cap.rotation.x = -Math.PI / 2;
    cap.scale.setScalar(0.03);
    cap.position.y = postHeight + 0.004;
    group.add(cap);
  } else if (type === 'vat') {
    // THE VAT: the last machine in the book, and the only glass in it.
    // A wide banded tank on a heavy pedestal, with a level inside that
    // COMES UP as the fourth manifold pours and drains as the thing in
    // it climbs out. Wider and taller than anything else on the floor,
    // because what comes out of it has to have been IN there — and the
    // one piece of plant whose silhouette is deliberately soft, since it
    // is the only thing in the shop that isn't machinery.
    const { size: vs, height: vh, tankFloor } = UNITS.vat;
    unitLeg(group, tankFloor - 0.02, 0.05);
    const pan = new Mesh(new CylinderGeometry(1, 1, 1, 16), ironMat);
    pan.scale.set(vs / 2, 0.05, vs / 2);
    pan.position.y = tankFloor - 0.02;
    group.add(pan);

    // The glass — the one transparent surface in the catalogue.
    const glass = new Mesh(
      new CylinderGeometry(1, 1, 1, 16, 1, true),
      new MeshStandardMaterial({
        color: 0x11301f,
        roughness: 0.06,
        metalness: 0.1,
        transparent: true,
        // Enough body to read as a VESSEL against a dark room. The first
        // pass sat at 0.34 and, with nothing behind it to refract, the
        // tank vanished and left three hoops apparently floating.
        opacity: 0.46,
        side: DoubleSide,
      }),
    );
    glass.scale.set(vs / 2 - 0.01, vh, vs / 2 - 0.01);
    glass.position.y = tankFloor + vh / 2;
    glass.renderOrder = 6;
    group.add(glass);

    // Three hoops of flat bar round it, and the lid they carry.
    for (const t of [0.06, 0.5, 0.94]) {
      const hoop = new Mesh(torusGeo(), hubMat);
      hoop.rotation.x = Math.PI / 2;
      hoop.scale.setScalar(vs / 2 + 0.004);
      hoop.position.y = tankFloor + vh * t;
      group.add(hoop);
    }
    // Four stanchions up the outside, pan to lid — the cage that makes
    // the glass read as held rather than balanced.
    for (let n = 0; n < 4; n++) {
      const a = (n / 4) * Math.PI * 2 + Math.PI / 4;
      const post = new Mesh(cylGeo(), hubMat);
      post.scale.set(0.012, vh + 0.05, 0.012);
      post.position.set(
        Math.cos(a) * (vs / 2 + 0.004),
        tankFloor + vh / 2,
        Math.sin(a) * (vs / 2 + 0.004),
      );
      group.add(post);
    }
    const lid = new Mesh(new CylinderGeometry(1, 1, 1, 16), ironMat);
    lid.scale.set(vs / 2 + 0.012, 0.03, vs / 2 + 0.012);
    lid.position.y = tankFloor + vh + 0.02;
    group.add(lid);
    const lidBand = new Mesh(torusGeo(), hubMat);
    lidBand.rotation.x = Math.PI / 2;
    lidBand.scale.setScalar(vs / 2 + 0.016);
    lidBand.position.y = tankFloor + vh + 0.02;
    group.add(lidBand);
    // (The lid's old static inlet stub is gone: the side GLAND is the
    // inlet — its sunk boss is the intake you can see inside the tank —
    // and the lid stays bare for the thing that dances on it.)

    // THE LEVEL — a green cylinder scaled up from the tank floor as it
    // brews. FactorySystem owns the maths; this is the mesh and its
    // datums.
    const liquid = createVatLiquid();
    const level = new Mesh(new CylinderGeometry(1, 1, 1, 32), liquid.mat);
    level.scale.set(vs / 2 - 0.02, 0.001, vs / 2 - 0.02);
    level.position.y = tankFloor;
    level.visible = false;
    level.renderOrder = 5;
    group.add(level);
    fill = { mesh: level, ...liquid, top: vh - 0.04, floor: tankFloor };

    vatGlow = new MeshBasicMaterial({
      color: 0x4dff9b,
      transparent: true,
      opacity: 0.14,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    const under = new Mesh(discGeo(), vatGlow);
    under.rotation.x = -Math.PI / 2;
    under.scale.setScalar(vs / 2 - 0.015);
    under.position.y = tankFloor + 0.004;
    under.renderOrder = 12;
    group.add(under);
    gland = buildGland();
  } else {
    // THE CHEST: the banded crate — things keep here. STOREMAN'S OLIVE
    // on the straps and a painted lid: the one box on the floor that is
    // furniture, dressed like issued kit.
    bench(group);
    for (const y of [0.62, 0.72]) {
      const band = new Mesh(boxGeo(), oliveMat);
      band.scale.set(size + 0.006, 0.012, size + 0.006);
      band.position.y = y;
      group.add(band);
    }
    const lid = new Mesh(boxGeo(), oliveMat);
    lid.scale.set(size - 0.03, 0.006, size - 0.03);
    lid.position.y = benchTop + 0.004;
    group.add(lid);
    // Four hex heads pin the lid's corners — issued kit is BOLTED kit.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const bolt = new Mesh(sided(6), hubMat);
        bolt.scale.set(UNITS.boltR, 0.012, UNITS.boltR);
        bolt.position.set(sx * (size / 2 - 0.038), benchTop + 0.007, sz * (size / 2 - 0.038));
        group.add(bolt);
      }
    }
    const rim = new Mesh(torusGeo(), ironMat);
    rim.rotation.x = Math.PI / 2;
    rim.scale.setScalar(0.11);
    rim.position.y = benchTop + 0.01;
    group.add(rim);
  }

  if (gland) {
    // On the BACK face (local −Z), facing backward — where the tube
    // arrives from, sunk to the body's own surface with the same reach
    // the live swivel uses, so the ghost seals like the real thing.
    gland.group.position.set(0, UNITS.glandHeight, -(glandReach(type) + 0.001));
    gland.group.rotation.y = Math.PI;
    group.add(gland.group);
  }
  return { group, gland, lampMat, craft, halo, fill, vatGlow, belt, tint, gun };
}

/* ── the feeds ──────────────────────────────────────────────────────────── */

export interface FeedRefs {
  group: Group;
  /** The pillar's halo — dormant dim, awake breathing. */
  glowMat: MeshBasicMaterial;
  /** PEARL's bolted plate: the thing that comes OFF, exactly once, when
   *  the fourth gate is paid for. Null on every other pillar. */
  hatch: Group | null;
  /** Where the spout's tube leaves (local +Z, off the pillar face). */
  mouthOffset: number;
  awakeVisual: boolean;
}

/**
 * A manifold pillar wearing its line's plate language. Local +Z faces
 * INTO the floor; the spout sits at FACTORY.spoutHeight.
 *
 * SLENDER, AND ALIGNED. The old pillar was a 22 cm drum wearing a
 * 32 cm dinner plate — a gatepost. It is a STANDPIPE now: the column
 * thinned by nearly half and drawn a touch taller, standing on a bolted
 * foot flange, with all of the working weight moved into the spout
 * BOSS — which is the one part that cannot shrink, because the tube's
 * 88 mm root section has to come out of something that visibly swallows
 * it. A slim riser carrying one heavy boss is the fitter's silhouette.
 * Two hub collars ring the column at the tape band (0.72) and the bench
 * datum (0.85) — the same two heights the site's own rig is built to —
 * so the pillar reads as part of the room's grid, not furniture beside
 * it. (Where it STANDS is aligned too: FactorySystem snaps each pillar
 * to the nearest lattice centreline, so the spout looks straight down a
 * row of cells.)
 *
 * PEARL — the fourth manifold, on the near side — is built SHUT: a blank
 * plate with two crossed straps bolted over where the spout should be, a
 * door that has visibly never been opened. FactorySystem takes it off
 * (once, ever) when the fourth gate is paid for.
 */
export function buildFeed(line: LineSpec | null): FeedRefs {
  const group = new Group();
  const sides = line
    ? line.id === 'mains'
      ? 8
      : line.id === 'coolant'
        ? 24
        : line.id === 'pearl'
          ? 12
          : 6
    : 16;
  const shell = new MeshStandardMaterial({
    color: line ? line.shell : 0x4a463e,
    roughness: line ? line.roughness : 0.4,
    metalness: line ? line.metalness : 0.7,
  });

  // THE RISER.
  const pillar = new Mesh(new CylinderGeometry(1, 1, 1, sides), shell);
  pillar.scale.set(0.062, 1.42, 0.062);
  pillar.position.y = 0.71;
  group.add(pillar);

  // The foot flange: planted on the line, not stuck into it.
  const foot = new Mesh(new CylinderGeometry(1, 1, 1, sides), shell);
  foot.scale.set(0.095, 0.022, 0.095);
  foot.position.y = 0.011;
  group.add(foot);

  // The datum collars — tape band and bench top, the site's own heights.
  for (const y of [FLOOR.tapeHeight, FLOOR.postHeight]) {
    const collar = new Mesh(torusGeo(), hubMat);
    collar.rotation.x = Math.PI / 2;
    collar.scale.setScalar(0.068);
    collar.position.y = y;
    group.add(collar);
  }

  const cap = new Mesh(new CylinderGeometry(1, 1, 1, sides), shell);
  cap.scale.set(0.075, 0.035, 0.075);
  cap.position.y = 1.437;
  group.add(cap);

  // THE BOSS — neck, plate, gland collar and halo on one tight axis.
  const neck = new Mesh(new CylinderGeometry(1, 1, 1, sides), shell);
  neck.rotation.x = Math.PI / 2;
  neck.scale.set(0.048, 0.09, 0.048);
  neck.position.set(0, FACTORY.spoutHeight, 0.045);
  group.add(neck);

  const plate = new Mesh(new CylinderGeometry(1, 1, 1, sides), shell);
  plate.rotation.x = Math.PI / 2;
  plate.scale.set(0.118, 0.032, 0.118);
  plate.position.set(0, FACTORY.spoutHeight, 0.09);
  group.add(plate);

  // A ring of hex heads on the plate face — the fabrication tell, at the
  // one height the player actually looks at.
  for (let b = 0; b < 6; b++) {
    const a = (b / 6) * Math.PI * 2 + Math.PI / 6;
    const bolt = new Mesh(new CylinderGeometry(1, 1, 1, 6), hubMat);
    bolt.rotation.x = Math.PI / 2;
    bolt.scale.set(UNITS.boltR, 0.01, UNITS.boltR);
    bolt.position.set(
      Math.cos(a) * 0.09,
      FACTORY.spoutHeight + Math.sin(a) * 0.09,
      0.108,
    );
    group.add(bolt);
  }

  const gland = new Mesh(torusGeo(), shell);
  gland.scale.setScalar(0.102);
  gland.position.set(0, FACTORY.spoutHeight, 0.122);
  group.add(gland);

  const glowMat = new MeshBasicMaterial({
    color: line ? line.glow : 0xe8e2d6,
    transparent: true,
    opacity: line ? 0.25 : 0.08,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  const halo = new Mesh(ringGeo(), glowMat);
  halo.scale.setScalar(0.128);
  halo.position.set(0, FACTORY.spoutHeight, 0.112);
  halo.renderOrder = 12;
  group.add(halo);

  let hatch: Group | null = null;
  if (line?.id === 'pearl') {
    // BOLTED SHUT. A blank plate, two crossed straps and a ring of bolt
    // heads — and the only moving part on any pillar in the game.
    hatch = new Group();
    const shut = new Mesh(cylGeo(), hubMat);
    shut.rotation.x = Math.PI / 2;
    shut.scale.set(0.096, 0.016, 0.096);
    shut.position.set(0, FACTORY.spoutHeight, 0.13);
    hatch.add(shut);
    for (const rot of [0.7, -0.7]) {
      const strap = new Mesh(boxGeo(), shell);
      strap.scale.set(0.24, 0.026, 0.011);
      strap.position.set(0, FACTORY.spoutHeight, 0.14);
      strap.rotation.z = rot;
      hatch.add(strap);
    }
    for (let b = 0; b < 6; b++) {
      const a = (b / 6) * Math.PI * 2;
      const bolt = new Mesh(new CylinderGeometry(1, 1, 1, 6), hubMat);
      bolt.rotation.x = Math.PI / 2;
      bolt.scale.set(UNITS.boltR, 0.01, UNITS.boltR);
      bolt.position.set(
        Math.cos(a) * 0.074,
        FACTORY.spoutHeight + Math.sin(a) * 0.074,
        0.145,
      );
      hatch.add(bolt);
    }
    group.add(hatch);
  } else if (!line) {
    // No line at all: a shut iris where a spout would be.
    const shut = new Mesh(discGeo(), irisMat);
    shut.scale.setScalar(0.065);
    shut.position.set(0, FACTORY.spoutHeight, 0.108);
    group.add(shut);
  }

  return { group, glowMat, hatch, mouthOffset: 0.135, awakeVisual: false };
}

/* ── the parts ──────────────────────────────────────────────────────────
 * Every item is a little ASSEMBLY, not a token: a handful of components
 * over shared unit geometries, each wearing its lineage's plate language
 * — and per law 3, a tier-2 part visibly CONTAINS its ingredients (the
 * pump is an eight-sided iron body with a smooth alloy throat; you can
 * read the gear and the cell in it from across the bench). Rendered
 * instanced per component: a floor full of parts is a dozen draw calls.
 */

export interface PartComponent {
  geometry: CylinderGeometry;
  material: MeshStandardMaterial | MeshBasicMaterial;
  local: Matrix4;
}

const _sideGeos = new Map<number, CylinderGeometry>();
function sided(sides: number): CylinderGeometry {
  let geo = _sideGeos.get(sides);
  if (!geo) {
    geo = new CylinderGeometry(1, 1, 1, sides);
    _sideGeos.set(sides, geo);
  }
  return geo;
}

const _bodyMats = new Map<string, MeshStandardMaterial>();
function bodyMat(lineId: 'mains' | 'coolant' | 'volt'): MeshStandardMaterial {
  let m = _bodyMats.get(lineId);
  if (!m) {
    const line = LINES[lineId];
    m = new MeshStandardMaterial({
      color: line.shell,
      roughness: line.roughness,
      metalness: line.metalness,
    });
    _bodyMats.set(lineId, m);
  }
  return m;
}

const _glowMats = new Map<string, MeshBasicMaterial>();
function glowFor(lineId: 'mains' | 'coolant' | 'volt'): MeshBasicMaterial {
  let m = _glowMats.get(lineId);
  if (!m) {
    m = new MeshBasicMaterial({
      color: LINES[lineId].glow,
      transparent: true,
      opacity: 0.85,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    _glowMats.set(lineId, m);
  }
  return m;
}

const hubMat = new MeshStandardMaterial({ color: 0x231e19, roughness: 0.45, metalness: 0.85 });

const _q = new Quaternion();
const _s = new Vector3();
const _p = new Vector3();

function comp(
  geometry: CylinderGeometry,
  material: MeshStandardMaterial | MeshBasicMaterial,
  sx: number,
  sy: number,
  sz: number,
  y = 0,
  ry = 0,
): PartComponent {
  _q.setFromAxisAngle(new Vector3(0, 1, 0), ry);
  return {
    geometry,
    material,
    local: new Matrix4().compose(_p.set(0, y, 0), _q.clone(), _s.set(sx, sy, sz)),
  };
}

const _kits = new Map<ItemId, PartComponent[]>();

/** The item's component kit — local matrices over shared geometry. */
export function partKit(item: ItemId): PartComponent[] {
  let kit = _kits.get(item);
  if (kit) return kit;
  const iron = bodyMat('mains');
  const alloy = bodyMat('coolant');
  const glass = bodyMat('volt');
  const amber = glowFor('mains');
  const cyan = glowFor('coolant');
  const violet = glowFor('volt');
  const c8 = sided(8);
  const c6 = sided(6);
  const c20 = sided(20);

  if (item === 'gear') {
    // Two eight-sided plates a half-tooth apart: a sixteen-point toothed
    // disc, dark hub, lit amber axle.
    kit = [
      comp(c8, iron, 0.052, 0.026, 0.052),
      comp(c8, iron, 0.052, 0.013, 0.052, 0, Math.PI / 8),
      comp(c20, hubMat, 0.017, 0.03, 0.017),
      comp(c20, amber, 0.008, 0.034, 0.008),
    ];
  } else if (item === 'cell') {
    // A machined canister: alloy body, dark cap rings, a lit charge band
    // round its waist.
    kit = [
      comp(c20, alloy, 0.038, 0.072, 0.038),
      comp(c20, hubMat, 0.041, 0.008, 0.041, 0.033),
      comp(c20, hubMat, 0.041, 0.008, 0.041, -0.033),
      comp(c20, cyan, 0.0392, 0.016, 0.0392),
    ];
  } else if (item === 'chip') {
    // A hex wafer of dark glass, violet traces lit inside, one pin.
    kit = [
      comp(c6, glass, 0.05, 0.012, 0.05),
      comp(c6, violet, 0.036, 0.015, 0.036),
      comp(c20, hubMat, 0.007, 0.024, 0.007),
    ];
  } else if (item === 'pump') {
    // GEAR + CELL, readable: eight-sided iron body, smooth alloy throat,
    // the joint lit cyan, the base lit amber.
    kit = [
      comp(c8, iron, 0.048, 0.06, 0.048),
      comp(c20, alloy, 0.022, 0.032, 0.022, 0.043),
      comp(c20, cyan, 0.0252, 0.009, 0.0252, 0.029),
      comp(c8, amber, 0.049, 0.008, 0.049, -0.029),
    ];
  } else if (item === 'lamp') {
    // CELL + CHIP: the canister wearing a hex-glass crown, lit violet on
    // top and cyan at the waist.
    kit = [
      comp(c20, alloy, 0.036, 0.055, 0.036, -0.008),
      comp(c6, glass, 0.042, 0.018, 0.042, 0.03),
      comp(c6, violet, 0.03, 0.015, 0.03, 0.047),
      comp(c20, cyan, 0.037, 0.012, 0.037, -0.02),
    ];
  } else {
    // servo — PUMP + LAMP, the deepest fitting in the book and dressed
    // like it: the pump's eight-sided iron body and amber base under an
    // alloy throat, crowned with the lamp's hex glass and violet, cyan
    // at the joint. Every line on the floor, readable in one part.
    kit = [
      comp(c8, iron, 0.05, 0.048, 0.05, -0.014),
      comp(c8, amber, 0.051, 0.008, 0.051, -0.04),
      comp(c20, alloy, 0.028, 0.03, 0.028, 0.024),
      comp(c20, cyan, 0.0305, 0.009, 0.0305, 0.004),
      comp(c6, glass, 0.04, 0.017, 0.04, 0.052),
      comp(c6, violet, 0.027, 0.012, 0.027, 0.068),
    ];
  }
  _kits.set(item, kit);
  return kit;
}
