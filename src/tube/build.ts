/**
 * The hardware — flanges, sockets, telescoping segments, the collar. One
 * factory per piece, all of it built from a handful of SHARED unit
 * geometries scaled into place, so a full shift of plant is matrix
 * updates, not geometry churn.
 *
 * THE VIBES LIVE IN SILHOUETTE AND SURFACE, NOT IN EXTRA DRAWS. Each line
 * carries its identity three ways at zero cost: the radial segment count
 * of its plates (MAINS is eight-sided cast iron, COOLANT a smooth
 * machined disc, VOLT a six-sided conduit fitting), its PBR surface
 * (rough dark iron / brushed alloy / dark glass), and its light (the glow
 * rings, the pour, the collar's tell). Nobody counts bolts in passthrough;
 * everybody reads a hex plate as industrial from across the room.
 *
 * Draw budget per run: flange 3 + socket 4 + collar 3 + 8 segments × 2
 * shells (+ the pour volume only once the line charges) ≈ 26–34. Three
 * runs and the board sit comfortably inside a Quest AR frame.
 */

import {
  AdditiveBlending,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  type Quaternion,
  type ShaderMaterial,
  type Vector3,
} from 'three';
import { FLOW, TUBE, type LineSpec } from '../config.js';
import { createFlowMaterial, createJointMaterial } from '../materials/flow.js';
import { segmentRadius, type TubeSegment } from './geometry.js';

/* ── shared unit geometries (scaled per use, never rebuilt) ─────────────── */

let _shellGeo: CylinderGeometry | null = null;
/** Unit shell: r=1, h=1, open-ended — every barrel and throat wears it. */
function shellGeo(): CylinderGeometry {
  return (_shellGeo ??= new CylinderGeometry(1, 1, 1, 18, 1, true));
}

let _pourGeo: CylinderGeometry | null = null;
/** Unit pour volume: capped, so the cut face has geometry to show. Same
 *  radial count as the shell — a chunkier prism inside a rounder casing
 *  read as ANGULAR liquid whenever the light caught a facet. */
function pourGeo(): CylinderGeometry {
  return (_pourGeo ??= new CylinderGeometry(1, 1, 1, 18, 1));
}

let _jointGeo: SphereGeometry | null = null;
/** Unit joint ball (r=1): the pour's ELBOW. Every section's volume ends
 *  in one of these at its outer joint, so a bend is a ball-and-socket
 *  of lit liquid rather than two flat-cut cylinders meeting at an
 *  angle. Same radial count as the pour, for the same reason. */
function jointGeo(): SphereGeometry {
  return (_jointGeo ??= new SphereGeometry(1, 18, 12));
}

const _plateGeos = new Map<number, CylinderGeometry>();
/** Unit plate: r=1, h=1, `sides` radial segments — the vibe's silhouette. */
function plateGeo(sides: number): CylinderGeometry {
  let geo = _plateGeos.get(sides);
  if (!geo) {
    geo = new CylinderGeometry(1, 1, 1, sides);
    _plateGeos.set(sides, geo);
  }
  return geo;
}

let _ringGeo: TorusGeometry | null = null;
/** Unit torus ring (r=1, tube 0.14) — collars, glands, grips. */
function ringGeo(): TorusGeometry {
  return (_ringGeo ??= new TorusGeometry(1, 0.14, 10, 24));
}

let _ribGeo: TorusGeometry | null = null;
/** The JOINT ring — deliberately slimmer than the collar stock (0.09 vs
 *  0.14): a joint band as fat as the grab ring chopped the pour into
 *  eight lit cells, and the whole point of the pour is that it reads as
 *  ONE column. Narrow bands, continuous light. */
function ribGeo(): TorusGeometry {
  return (_ribGeo ??= new TorusGeometry(1, 0.09, 10, 24));
}

let _glowRingGeo: RingGeometry | null = null;
/** Unit flat ring for additive glow halos on hardware faces. */
function glowRingGeo(): RingGeometry {
  return (_glowRingGeo ??= new RingGeometry(0.72, 1, 28));
}

let _discGeo: CircleGeometry | null = null;
function discGeo(): CircleGeometry {
  return (_discGeo ??= new CircleGeometry(1, 24));
}

/* ── shared per-line materials ──────────────────────────────────────────── */

interface LineMats {
  plate: MeshStandardMaterial;
  /** The same metal, rendered BOTH SIDES — for open geometry (a bore you
   *  can see into). A FrontSide open cylinder draws only the wall facing
   *  you: the far wall's inner surface points away and is culled, so the
   *  socket's mouth read as HALF a rim, and the half you got followed you
   *  round the room. A pipe's bore has an inside; this is it. */
  plateOpen: MeshStandardMaterial;
  shell: MeshStandardMaterial;
  glow: MeshBasicMaterial; // template — cloned where opacity animates alone
}

const _mats = new Map<string, LineMats>();

function matsFor(line: LineSpec): LineMats {
  let m = _mats.get(line.id);
  if (m) return m;
  m = {
    plate: new MeshStandardMaterial({
      color: line.shell,
      roughness: line.roughness,
      metalness: line.metalness,
    }),
    plateOpen: new MeshStandardMaterial({
      color: line.shell,
      roughness: line.roughness,
      metalness: line.metalness,
      side: DoubleSide,
    }),
    // The frosted barrel the pour glows through. Depth-writing OFF so the
    // opaque pour renders first and the shell blends over it — the same
    // sort order the glowstick liquid taught us. The frost is a step
    // THINNER than instinct says: over passthrough the shell fights a
    // lit room for the pour's light, and the pour must win.
    shell: new MeshStandardMaterial({
      color: line.shell,
      roughness: Math.min(0.9, line.roughness + 0.15),
      metalness: line.metalness * 0.5,
      transparent: true,
      opacity: line.id === 'mains' ? 0.48 : line.id === 'coolant' ? 0.36 : 0.32,
      depthWrite: false,
    }),
    glow: new MeshBasicMaterial({
      color: line.glow,
      transparent: true,
      opacity: 0.5,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    }),
  };
  _mats.set(line.id, m);
  return m;
}

/** The vibe's silhouette: plate sides per line. */
function sidesFor(line: LineSpec): number {
  return line.id === 'mains' ? 8 : line.id === 'coolant' ? 24 : 6;
}

/* ── the pieces ─────────────────────────────────────────────────────────── */

export interface FlangeRefs {
  group: Group;
  /** The idle halo — FlowSystem breathes it. */
  glowMat: MeshBasicMaterial;
  /** Where the tube leaves the wall (local +Z out of the plate). */
  mouthOffset: number;
}

/** The mount: base plate + gland ring + face halo. Local +Z faces the
 *  room; the group sits ON the wall (z=0 at the plaster). */
export function buildFlange(line: LineSpec): FlangeRefs {
  const m = matsFor(line);
  const group = new Group();
  const sides = sidesFor(line);
  const r = TUBE.rootRadius;

  const plate = new Mesh(plateGeo(sides), m.plate);
  plate.rotation.x = Math.PI / 2;
  plate.scale.set(r * 1.85, 0.045, r * 1.85);
  plate.position.z = 0.0225;
  group.add(plate);

  const gland = new Mesh(ringGeo(), m.plate);
  gland.scale.setScalar(r * 1.22);
  gland.position.z = 0.075;
  group.add(gland);

  const glowMat = m.glow.clone();
  glowMat.opacity = 0.32;
  const halo = new Mesh(glowRingGeo(), glowMat);
  halo.scale.setScalar(r * 1.7);
  halo.position.z = 0.052;
  halo.renderOrder = 12;
  group.add(halo);

  return { group, glowMat, mouthOffset: 0.075 };
}

export interface SocketRefs {
  group: Group;
  guide: Mesh;
  guideRadius: number;
  glowMat: MeshBasicMaterial;
  /** The dark iris disc — scales to zero as the tube arrives home. */
  iris: Mesh;
  /** The guide ring the magnet brightens (world-facing, additive). */
  guideMat: MeshBasicMaterial;
  /** Where the head seats (local +Z, metres off the wall). */
  seatOffset: number;
}

/** The answer on the far wall: plate + open throat + iris + guide ring. */
export function buildSocket(line: LineSpec): SocketRefs {
  const m = matsFor(line);
  const group = new Group();
  const sides = sidesFor(line);
  const r = TUBE.headRadius;

  const plate = new Mesh(plateGeo(sides), m.plate);
  plate.rotation.x = Math.PI / 2;
  plate.scale.set(r * 2.5, 0.04, r * 2.5);
  plate.position.z = 0.02;
  group.add(plate);

  // The throat: a short open barrel the head slides into. TWO-SIDED —
  // it is a bore, and you must be able to see the inside of its far wall
  // (see plateOpen). Cheap: one short cylinder per socket.
  const throat = new Mesh(shellGeo(), m.plateOpen);
  throat.rotation.x = Math.PI / 2;
  throat.scale.set(r * 1.45, 0.12, r * 1.45);
  throat.position.z = 0.08;
  group.add(throat);

  // THE RIM: a machined lip round the mouth. A torus is closed geometry,
  // so it is whole from every angle by construction — the socket's
  // outline can never depend on where you're standing again. It also
  // gives the mouth the weight a bare barrel edge never had.
  const rim = new Mesh(ringGeo(), m.plate);
  rim.scale.setScalar(r * 1.45);
  rim.position.z = 0.14;
  group.add(rim);

  // The iris: a dark disc a hair inside the throat — the "closed" read.
  const irisMat = new MeshBasicMaterial({ color: 0x07070a });
  const iris = new Mesh(discGeo(), irisMat);
  iris.scale.setScalar(r * 1.3);
  iris.position.z = 0.045;
  group.add(iris);

  const glowMat = m.glow.clone();
  glowMat.opacity = 0.4;
  const halo = new Mesh(glowRingGeo(), glowMat);
  halo.scale.setScalar(r * 2.3);
  halo.position.z = 0.045;
  halo.renderOrder = 12;
  group.add(halo);

  // The guide: a wider ghost ring floating off the wall at the magnet's
  // reach — the "offer it up HERE" mark. FlowSystem breathes it while the
  // run is being worked and snaps it bright when the magnet takes.
  const guideMat = m.glow.clone();
  guideMat.opacity = 0.12;
  const guide = new Mesh(glowRingGeo(), guideMat);
  guide.scale.setScalar(r * 3.1);
  guide.position.z = 0.16;
  guide.renderOrder = 12;
  group.add(guide);

  return { group, glowMat, iris, guide, guideRadius: r * 3.1, guideMat, seatOffset: 0.1 };
}

export interface SegmentRefs {
  /** Frosted barrel (unit cylinder scaled: x/z radius, y length). */
  shell: Mesh;
  /** The joint collar at this section's outer end. */
  rib: Mesh;
  /** The pour volume inside (hidden until the line charges). */
  pour: Mesh;
  pourMat: ShaderMaterial;
  /** The pour's ELBOW at this section's outer joint — a ball the size of
   *  this section's bore, sat on the shared joint point, that the next
   *  (thinner) section's volume starts inside. Shares the pour's live
   *  uniforms; owns its own arc-length range. */
  joint: Mesh;
  jointMat: ShaderMaterial;
}

/** THE POUR'S BORE, as a fraction of the shell's: a hair off the glass,
 *  so the frost reads as a film over liquid rather than a pipe with a
 *  light in. */
export const POUR_BORE = 0.87;
/** The joint ball stands a whisker proud of its section's bore, so the
 *  section's flat end sits strictly inside it (no z-fight on the rim)
 *  while the ball still clears the thinner shell it half-lives in. */
export const JOINT_BORE = POUR_BORE * 1.03;

/** One telescoping section: barrel + end collar + pour volume. All three
 *  are posed by TubeSystem every frame; nothing here owns a transform. */
export function buildSegment(line: LineSpec, index: number): SegmentRefs {
  const m = matsFor(line);
  const r = segmentRadius(index);

  const shell = new Mesh(shellGeo(), m.shell);
  shell.renderOrder = 8; // after the pour writes depth
  shell.scale.set(r, 1, r);

  const rib = new Mesh(ribGeo(), m.plate);
  rib.scale.setScalar(r * 1.1);

  const pourMat = createFlowMaterial(
    line.glow,
    line.deep,
    line.foam,
    line.pulseHz,
    line.chop,
    FLOW.frontBand,
    line.flowSpeed,
  );
  const pour = new Mesh(pourGeo(), pourMat);
  pour.renderOrder = 4;
  pour.scale.set(r * POUR_BORE, 1, r * POUR_BORE);
  pour.visible = false;

  const jointMat = createJointMaterial(pourMat);
  const joint = new Mesh(jointGeo(), jointMat);
  joint.renderOrder = 4;
  joint.scale.setScalar(r * JOINT_BORE);
  joint.visible = false;

  return { shell, rib, pour, pourMat, joint, jointMat };
}

/**
 * Pose one section's POUR between its two joint points, and the ball
 * that seals its outer joint.
 *
 * THE POUR IS ONE COLUMN — AND IT STAYS IN ITS OWN GLASS. Each section's
 * volume is COAXIAL with its shell (same chord, same quaternion) and
 * ends exactly on the shared joint point, where a BALL of its own bore
 * sits: the next, thinner section's volume starts inside that ball, so
 * at any bend the elbow is a sphere of lit liquid and no flat cut of
 * either cylinder can ever face the room. (The volume used to TUCK
 * backward through the joint into the fatter section instead, with the
 * tuck clamped by the local kink — and at exactly the kinks the
 * clearance arcs make, the clamp ran the tuck to nothing and both
 * cylinders' flat ends showed through the frost as hard-edged wedges of
 * liquid at every turn.) The rib ring hides the ball's equator seam.
 *
 * AT THE SOCKET IT KEEPS GOING: `into` runs the last section's volume on
 * past the head into the socket's throat, so the column ends inside the
 * wall instead of stopping dead at the collar plane.
 *
 * `jointTangent` is the curve's heading AT the joint (the rib's), so the
 * ball's arc-length axis lies along the flow and the front sweeps
 * through it instead of popping it. `sealed` = false on the last
 * section (the collar caps the head; nothing follows).
 */
export function posePour(
  seg: SegmentRefs,
  span: TubeSegment,
  pA: Vector3,
  pB: Vector3,
  tangent: Vector3,
  quat: Quaternion,
  chord: number,
  into: number,
  jointTangentQuat: Quaternion,
  sealed: boolean,
): void {
  const bore = span.radius * POUR_BORE;
  seg.pour.position.copy(pA).add(pB).multiplyScalar(0.5).addScaledVector(tangent, into / 2);
  seg.pour.quaternion.copy(quat);
  seg.pour.scale.set(bore, chord + into, bore);
  seg.pourMat.uniforms.uS0.value = span.s0;
  seg.pourMat.uniforms.uS1.value = span.s1 + into;

  seg.joint.visible = sealed && seg.pour.visible;
  if (!sealed) return;
  const ball = span.radius * JOINT_BORE;
  seg.joint.position.copy(pB);
  seg.joint.quaternion.copy(jointTangentQuat);
  seg.joint.scale.setScalar(ball);
  // The unit sphere runs y ∈ [−1, 1]; the shader reads vAlong = y + 0.5,
  // so a half-bore either side of the joint's own arc length puts the
  // front through the ball at the pace it crosses the pipe.
  seg.jointMat.uniforms.uS0.value = span.s1 - ball / 2;
  seg.jointMat.uniforms.uS1.value = span.s1 + ball / 2;
}

export interface CollarRefs {
  group: Group;
  /** The end cap's centre light — the line's tell, and the magnet's. */
  capMat: MeshBasicMaterial;
  glowMat: MeshBasicMaterial;
}

/** The head collar — the two-hands handle. A fat ring, two grip bars
 *  (port and starboard, where hands naturally land), and the cap. */
export function buildCollar(line: LineSpec): CollarRefs {
  const m = matsFor(line);
  const group = new Group();
  const r = TUBE.headRadius;

  const ring = new Mesh(ringGeo(), m.plate);
  ring.scale.setScalar(r * 1.55);
  group.add(ring);

  // Grip bars: stubby cylinders along local X, one each side.
  for (const side of [-1, 1]) {
    const bar = new Mesh(plateGeo(10), m.plate);
    bar.rotation.z = Math.PI / 2;
    bar.scale.set(0.021, 0.16, 0.021);
    bar.position.x = side * (r * 1.55 + 0.08);
    group.add(bar);
  }

  // The cap: the tube's face, dark, with the line's light at its heart.
  const capMat = m.glow.clone();
  capMat.opacity = 0.55;
  const cap = new Mesh(discGeo(), capMat);
  cap.scale.setScalar(r * 0.9);
  cap.position.z = 0.012;
  cap.renderOrder = 12;
  group.add(cap);

  const glowMat = m.glow.clone();
  glowMat.opacity = 0.2;
  const halo = new Mesh(glowRingGeo(), glowMat);
  halo.scale.setScalar(r * 2.1);
  halo.renderOrder = 12;
  group.add(halo);

  return { group, capMat, glowMat };
}

export interface HologramRefs {
  group: Group;
  mat: MeshBasicMaterial;
  ringMat: MeshBasicMaterial;
}

/** The placement ghost: the flange's outline riding the reticle — additive,
 *  bodiless, unmistakably not-yet-real. */
export function buildHologram(line: LineSpec): HologramRefs {
  const group = new Group();
  const sides = sidesFor(line);
  const r = TUBE.rootRadius;
  const mat = new MeshBasicMaterial({
    color: line.glow,
    transparent: true,
    opacity: 0.2,
    blending: AdditiveBlending,
    depthWrite: false,
    wireframe: true,
  });
  const plate = new Mesh(plateGeo(sides), mat);
  plate.rotation.x = Math.PI / 2;
  plate.scale.set(r * 1.85, 0.045, r * 1.85);
  plate.position.z = 0.0225;
  group.add(plate);

  const ringMat = new MeshBasicMaterial({
    color: line.glow,
    transparent: true,
    opacity: 0.35,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  const reticle = new Mesh(glowRingGeo(), ringMat);
  reticle.scale.setScalar(r * 2.6);
  reticle.position.z = 0.006;
  reticle.renderOrder = 12;
  group.add(reticle);

  return { group, mat, ringMat };
}
