/**
 * THE SWARM, DRAWN — every crawler on the floor in ONE draw call.
 *
 * A mite is ~100 triangles: a faceted abdomen, a head, two hot eyes and
 * six neon legs. It is one geometry, instanced: each crawler is two vec4s
 * (where it stands and which way it faces; its stride, hit flash, burn
 * and how far out of the wall it is) and a kind. Everything else happens
 * on the GPU — the legs swing in a tripod gait off the stride, the body
 * bobs, the rim burns neon, a hit flashes it white and fire flickers it
 * orange. The CPU's whole job per frame is copying the horde's columns
 * into two buffers.
 *
 * BEETLES and HULKS are the same body, larger and in their own colour.
 *
 * THE AFTERMATH is here too, because a swarm is only satisfying if it
 * comes apart: SHARDS (instanced tetrahedra with real gravity, bounce
 * and spin, a few per death and dozens per hulk) and SPLATS (glowing
 * floor stains that flash and fade to a dim residue where the tide was
 * broken). Both are ring pools on the same plan: CPU physics, GPU pose.
 */

import {
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type Group,
} from 'three';
import { ENEMIES, HORDE_KINDS } from '../config.js';
import { HORDE_CAP, PHASE_EMERGE, PHASE_FLY, PHASE_HELD, type Horde } from '../factory/horde.js';

/** The hostile body: near-black, so the neon carries the shape. */
const BODY = 0x0b0a10;

/* ── the mite ───────────────────────────────────────────────────────────── */

/**
 * Local frame: unit RADIUS (the crawler's spec radius scales it), +Z
 * forward, standing on y = 0. Attributes: glow (0 shell → 1 neon → 2 hot
 * white), leg (x: tripod group 0/1, y: 1 on a leg), hip (the leg's root,
 * which the swing turns about).
 */
function miteGeometry(): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const glow: number[] = [];
  const leg: number[] = [];
  const hip: number[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  const tri = (
    p: [number, number, number],
    q: [number, number, number],
    r: [number, number, number],
    g: number,
    lg = 0,
    on = 0,
    h: [number, number, number] = [0, 0, 0],
  ): void => {
    a.set(...p);
    b.set(...q);
    c.set(...r);
    n.copy(b).sub(a).cross(c.clone().sub(a)).normalize();
    for (const v of [a, b, c]) {
      pos.push(v.x, v.y, v.z);
      nor.push(n.x, n.y, n.z);
      glow.push(g);
      leg.push(lg, on);
      hip.push(...h);
    }
  };
  /** A bipyramid round (cx, cy, cz): `k` sides, radii rx/rz, apexes up/down. */
  const gem = (
    cx: number,
    cy: number,
    cz: number,
    rx: number,
    rz: number,
    up: number,
    down: number,
    k: number,
    gTop: number,
    gBot: number,
  ): void => {
    const ring: Array<[number, number, number]> = [];
    for (let s = 0; s < k; s++) {
      const t = (s / k) * Math.PI * 2;
      ring.push([cx + Math.sin(t) * rx, cy, cz + Math.cos(t) * rz]);
    }
    for (let s = 0; s < k; s++) {
      const p = ring[s];
      const q = ring[(s + 1) % k];
      tri([cx, cy + up, cz], q, p, gTop);
      tri([cx, cy - down, cz], p, q, gBot);
    }
  };
  // The abdomen: a faceted, flattened gem behind the legs, with a neon
  // keel down its back (the upper facets glow a little).
  gem(0, 0.62, -0.35, 0.7, 0.95, 0.42, 0.3, 6, 0.08, 0);
  // The head, forward and lower.
  gem(0, 0.55, 0.72, 0.42, 0.42, 0.24, 0.2, 5, 0.2, 0);
  // Two eyes: white-hot slivers on the head's front.
  for (const sx of [-1, 1]) {
    const ex = sx * 0.17;
    tri([ex - 0.08, 0.66, 1.08], [ex + 0.08, 0.66, 1.08], [ex, 0.76, 1.02], 2.2);
    tri([ex - 0.08, 0.66, 1.08], [ex, 0.57, 1.04], [ex + 0.08, 0.66, 1.08], 2.2);
  }
  // Six legs: hip on the body's side, knee high and out, foot on the
  // floor further out. Tripod groups: L1 R2 L3 | R1 L2 R3.
  const prism = (
    p: [number, number, number],
    q: [number, number, number],
    w: number,
    g: number,
    lg: number,
    h: [number, number, number],
  ): void => {
    // A thin triangular prism from p to q.
    const d = new Vector3(q[0] - p[0], q[1] - p[1], q[2] - p[2]).normalize();
    const u = new Vector3(0, 1, 0).cross(d);
    if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
    u.normalize().multiplyScalar(w);
    const v = d.clone().cross(u).normalize().multiplyScalar(w);
    const ring = (o: [number, number, number]): Array<[number, number, number]> => [0, 1, 2].map((s) => {
      const t = (s / 3) * Math.PI * 2;
      return [o[0] + u.x * Math.cos(t) + v.x * Math.sin(t), o[1] + u.y * Math.cos(t) + v.y * Math.sin(t), o[2] + u.z * Math.cos(t) + v.z * Math.sin(t)];
    });
    const r0 = ring(p);
    const r1 = ring(q);
    for (let s = 0; s < 3; s++) {
      const s2 = (s + 1) % 3;
      tri(r0[s], r1[s], r1[s2], g, lg, 1, h);
      tri(r0[s], r1[s2], r0[s2], g, lg, 1, h);
    }
  };
  const zs = [0.42, 0.02, -0.38];
  for (let k = 0; k < 3; k++) {
    for (const sx of [-1, 1]) {
      const group = (k % 2 === 0) === (sx < 0) ? 0 : 1;
      const z = zs[k];
      const splay = (k - 1) * 0.35;
      const h: [number, number, number] = [sx * 0.42, 0.6, z];
      const knee: [number, number, number] = [sx * 1.05, 1.0, z + splay * 0.6];
      const foot: [number, number, number] = [sx * 1.55, 0.0, z + splay * 1.2];
      prism(h, knee, 0.07, 1, group, h);
      prism(knee, foot, 0.055, 1.25, group, h);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('aGlow', new Float32BufferAttribute(glow, 1));
  g.setAttribute('aLeg', new Float32BufferAttribute(leg, 2));
  g.setAttribute('aHip', new Float32BufferAttribute(hip, 3));
  return g;
}

const SWARM_VERT = /* glsl */ `
attribute float aGlow;
attribute vec2 aLeg;
attribute vec3 aHip;
attribute vec4 iPose;   // x, z, heading, radius
attribute vec4 iAnim;   // stride, flash, burn, rise
attribute float iKind;
attribute vec2 iAir;    // height off the floor, flailing (0..1)
uniform float uTime;
varying float vGlow;
varying vec3 vN;
varying vec3 vV;
varying float vFlash;
varying float vBurn;
varying float vKind;

void main() {
  vec3 p = position;
  vec3 n = normal;
  float stride = iAnim.x;
  // Legs cycle with distance walked (so a stopped crawler stands still),
  // plus a nervous twitch so a biting crowd isn't frozen.
  float ph = stride * 9.0 / max(iPose.w * 8.0, 0.4) + aLeg.x * 3.14159;
  // In your fist or in the air, the legs thrash.
  ph = mix(ph, uTime * 26.0 + aLeg.x * 3.14159 + iPose.x * 7.0, iAir.y);
  if (aLeg.y > 0.5) {
    vec2 rel = p.xz - aHip.xz;
    float reach = clamp(length(rel) / 1.4, 0.0, 1.0);
    float sw = sin(ph) * 0.42;
    float cs = cos(sw);
    float sn = sin(sw);
    p.xz = aHip.xz + vec2(rel.x * cs - rel.y * sn, rel.x * sn + rel.y * cs);
    p.y += max(0.0, cos(ph)) * 0.32 * reach;
  } else {
    p.y += abs(sin(ph)) * 0.07;
  }
  // Climbing out of the wall: it grows to full size as it comes.
  float rise = iAnim.w;
  float s = iPose.w * mix(0.45, 1.0, rise);
  float h = iPose.z;
  float ch = cos(h);
  float sh = sin(h);
  vec3 w = vec3(p.x * ch + p.z * sh, p.y, -p.x * sh + p.z * ch) * s;
  vec3 wn = vec3(n.x * ch + n.z * sh, n.y, -n.x * sh + n.z * ch);
  w.x += iPose.x;
  w.y += iAir.x;
  w.z += iPose.y;
  vec4 mv = modelViewMatrix * vec4(w, 1.0);
  vN = normalize(normalMatrix * wn);
  vV = -mv.xyz;
  vGlow = aGlow;
  vFlash = iAnim.y;
  vBurn = iAnim.z;
  vKind = iKind;
  gl_Position = projectionMatrix * mv;
}
`;

const SWARM_FRAG = /* glsl */ `
uniform vec3 uKind[3];
uniform vec3 uBody;
uniform float uTime;
varying float vGlow;
varying vec3 vN;
varying vec3 vV;
varying float vFlash;
varying float vBurn;
varying float vKind;

void main() {
  vec3 neon = vKind < 0.5 ? uKind[0] : (vKind < 1.5 ? uKind[1] : uKind[2]);
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float rim = pow(1.0 - facing, 3.0);
  vec3 col = mix(uBody, neon, clamp(vGlow, 0.0, 1.0));
  col += neon * rim * 0.75;
  col += vec3(1.0) * max(vGlow - 1.0, 0.0) * 0.8;
  // On fire: it flickers toward flame.
  float flick = 0.6 + 0.4 * sin(uTime * 37.0 + vV.x * 40.0);
  col = mix(col, vec3(1.0, 0.5, 0.12), vBurn * 0.55 * flick);
  col = mix(col, vec3(1.0), vFlash);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export class SwarmMesh {
  readonly mesh: Mesh;
  private readonly geo: InstancedBufferGeometry;
  private readonly pose: InstancedBufferAttribute;
  private readonly anim: InstancedBufferAttribute;
  private readonly kind: InstancedBufferAttribute;
  private readonly air: InstancedBufferAttribute;
  private readonly mat: ShaderMaterial;

  constructor(parent: Group) {
    const base = miteGeometry();
    this.geo = new InstancedBufferGeometry();
    for (const name of ['position', 'normal', 'aGlow', 'aLeg', 'aHip']) {
      this.geo.setAttribute(name, base.getAttribute(name));
    }
    this.pose = new InstancedBufferAttribute(new Float32Array(HORDE_CAP * 4), 4).setUsage(DynamicDrawUsage);
    this.anim = new InstancedBufferAttribute(new Float32Array(HORDE_CAP * 4), 4).setUsage(DynamicDrawUsage);
    this.kind = new InstancedBufferAttribute(new Float32Array(HORDE_CAP), 1).setUsage(DynamicDrawUsage);
    this.geo.setAttribute('iPose', this.pose);
    this.geo.setAttribute('iAnim', this.anim);
    this.geo.setAttribute('iKind', this.kind);
    this.air = new InstancedBufferAttribute(new Float32Array(HORDE_CAP * 2), 2).setUsage(DynamicDrawUsage);
    this.geo.setAttribute('iAir', this.air);
    this.geo.instanceCount = 0;
    this.mat = new ShaderMaterial({
      vertexShader: SWARM_VERT,
      fragmentShader: SWARM_FRAG,
      side: DoubleSide,
      uniforms: {
        uKind: { value: HORDE_KINDS.map((k) => new Color(ENEMIES[k].neon)) },
        uBody: { value: new Color(BODY) },
        uTime: { value: 0 },
      },
    });
    this.mesh = new Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'swarm';
    parent.add(this.mesh);
  }

  /** Copy the horde into the instance buffers. */
  update(h: Horde, clock: number): void {
    const P = this.pose.array as Float32Array;
    const A = this.anim.array as Float32Array;
    const K = this.kind.array as Float32Array;
    const R = this.air.array as Float32Array;
    const radii = HORDE_KINDS.map((k) => ENEMIES[k].radius);
    let n = 0;
    for (let i = 0; i < h.n; i++) {
      if (h.dead[i]) continue;
      const o = n * 4;
      P[o] = h.x[i];
      P[o + 1] = h.z[i];
      P[o + 2] = h.heading[i];
      P[o + 3] = radii[h.kind[i]];
      A[o] = h.stride[i];
      A[o + 1] = h.flash[i] > 0 ? Math.min(1, h.flash[i] / 0.12) : 0;
      A[o + 2] = h.burnT[i] > 0 ? 1 : 0;
      A[o + 3] = h.phase[i] === PHASE_EMERGE ? Math.min(1, h.phaseT[i] * 1.6) : 1;
      K[n] = h.kind[i];
      const ph = h.phase[i];
      R[n * 2] = h.y[i];
      R[n * 2 + 1] = ph === PHASE_HELD || ph === PHASE_FLY ? 1 : 0;
      n++;
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.pose.clearUpdateRanges();
      this.anim.clearUpdateRanges();
      this.kind.clearUpdateRanges();
      this.pose.addUpdateRange(0, n * 4);
      this.anim.addUpdateRange(0, n * 4);
      this.kind.addUpdateRange(0, n);
      this.air.clearUpdateRanges();
      this.air.addUpdateRange(0, n * 2);
      this.air.needsUpdate = true;
      this.pose.needsUpdate = true;
      this.anim.needsUpdate = true;
      this.kind.needsUpdate = true;
    }
    this.mat.uniforms.uTime.value = clock;
  }
}

/* ── the shards ─────────────────────────────────────────────────────────── */

const SHARD_CAP = 3000;

const SHARD_VERT = /* glsl */ `
attribute vec4 iPos;   // x, y, z, size
attribute vec4 iRot;   // axis, angle
attribute vec3 iCol;
varying vec3 vCol;
varying vec3 vN;
varying vec3 vV;
vec3 rot(vec3 v, vec3 k, float a) {
  float c = cos(a);
  float s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}
void main() {
  vec3 k = normalize(iRot.xyz + vec3(1e-4));
  vec3 p = rot(position, k, iRot.w) * iPos.w + iPos.xyz;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * rot(normal, k, iRot.w));
  vV = -mv.xyz;
  vCol = iCol;
  gl_Position = projectionMatrix * mv;
}
`;

const SHARD_FRAG = /* glsl */ `
varying vec3 vCol;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = abs(dot(normalize(vN), normalize(vV)));
  vec3 col = vCol * (0.35 + 0.65 * f) + vCol * pow(1.0 - f, 2.0) * 0.8;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/** A tetrahedron, flat-shaded, unit size. */
function shardGeometry(): BufferGeometry {
  const v = [
    [0, 1, 0],
    [0.94, -0.33, 0],
    [-0.47, -0.33, 0.82],
    [-0.47, -0.33, -0.82],
  ];
  const faces = [
    [0, 1, 2],
    [0, 2, 3],
    [0, 3, 1],
    [1, 3, 2],
  ];
  const pos: number[] = [];
  const nor: number[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (const f of faces) {
    a.fromArray(v[f[0]]);
    b.fromArray(v[f[1]]);
    c.fromArray(v[f[2]]);
    const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    for (const p of [a, b, c]) {
      pos.push(p.x, p.y, p.z);
      nor.push(n.x, n.y, n.z);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  return g;
}

export class Shards {
  readonly mesh: Mesh;
  private readonly geo: InstancedBufferGeometry;
  private readonly iPos: InstancedBufferAttribute;
  private readonly iRot: InstancedBufferAttribute;
  private readonly iCol: InstancedBufferAttribute;
  private readonly p = new Float32Array(SHARD_CAP * 3);
  private readonly v = new Float32Array(SHARD_CAP * 3);
  private readonly axis = new Float32Array(SHARD_CAP * 3);
  private readonly ang = new Float32Array(SHARD_CAP);
  private readonly spin = new Float32Array(SHARD_CAP);
  private readonly life = new Float32Array(SHARD_CAP);
  private readonly maxLife = new Float32Array(SHARD_CAP);
  private readonly size = new Float32Array(SHARD_CAP);
  private readonly col = new Float32Array(SHARD_CAP * 3);
  private next = 0;
  private readonly tmp = new Color();
  /** Shards in the air or on the floor right now. */
  live = 0;

  constructor(parent: Group) {
    const base = shardGeometry();
    this.geo = new InstancedBufferGeometry();
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.geo.setAttribute('normal', base.getAttribute('normal'));
    this.iPos = new InstancedBufferAttribute(new Float32Array(SHARD_CAP * 4), 4).setUsage(DynamicDrawUsage);
    this.iRot = new InstancedBufferAttribute(new Float32Array(SHARD_CAP * 4), 4).setUsage(DynamicDrawUsage);
    this.iCol = new InstancedBufferAttribute(new Float32Array(SHARD_CAP * 3), 3).setUsage(DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.iPos);
    this.geo.setAttribute('iRot', this.iRot);
    this.geo.setAttribute('iCol', this.iCol);
    this.geo.instanceCount = 0;
    this.mesh = new Mesh(this.geo, new ShaderMaterial({ vertexShader: SHARD_VERT, fragmentShader: SHARD_FRAG, side: DoubleSide }));
    this.mesh.frustumCulled = false;
    this.mesh.name = 'shards';
    parent.add(this.mesh);
  }

  /** Burst `n` shards out of (x, y, z): `speed` outward, `up` upward. */
  burst(x: number, y: number, z: number, n: number, hex: number, size: number, speed: number, up: number): void {
    this.tmp.set(hex);
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % SHARD_CAP;
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.p[i * 3] = x;
      this.p[i * 3 + 1] = y;
      this.p[i * 3 + 2] = z;
      this.v[i * 3] = Math.sin(a) * sp;
      this.v[i * 3 + 1] = up * (0.5 + Math.random());
      this.v[i * 3 + 2] = Math.cos(a) * sp;
      this.axis[i * 3] = Math.random() - 0.5;
      this.axis[i * 3 + 1] = Math.random() - 0.5;
      this.axis[i * 3 + 2] = Math.random() - 0.5;
      this.ang[i] = Math.random() * 6;
      this.spin[i] = (Math.random() - 0.5) * 30;
      this.life[i] = this.maxLife[i] = 0.9 + Math.random() * 0.9;
      this.size[i] = size * (0.5 + Math.random() * 0.8);
      // Most shards are its neon; some are its dark shell.
      const dark = Math.random() < 0.3;
      const f = dark ? 0.12 : 1;
      this.col[i * 3] = this.tmp.r * f;
      this.col[i * 3 + 1] = this.tmp.g * f;
      this.col[i * 3 + 2] = this.tmp.b * f;
    }
  }

  tick(dt: number): void {
    const P = this.iPos.array as Float32Array;
    const R = this.iRot.array as Float32Array;
    const C = this.iCol.array as Float32Array;
    let n = 0;
    for (let i = 0; i < SHARD_CAP; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      const o = i * 3;
      this.v[o + 1] -= 6 * dt;
      this.p[o] += this.v[o] * dt;
      this.p[o + 1] += this.v[o + 1] * dt;
      this.p[o + 2] += this.v[o + 2] * dt;
      // The floor: bounce, lose most of it, skid, and settle.
      const s = this.size[i];
      if (this.p[o + 1] < s * 0.4) {
        this.p[o + 1] = s * 0.4;
        if (this.v[o + 1] < 0) this.v[o + 1] *= -0.35;
        this.v[o] *= 0.7;
        this.v[o + 2] *= 0.7;
        this.spin[i] *= 0.6;
      }
      this.ang[i] += this.spin[i] * dt;
      // Shrinks away over its last third.
      const fade = Math.min(1, this.life[i] / (this.maxLife[i] * 0.35));
      const q = n * 4;
      P[q] = this.p[o];
      P[q + 1] = this.p[o + 1];
      P[q + 2] = this.p[o + 2];
      P[q + 3] = s * fade;
      R[q] = this.axis[o];
      R[q + 1] = this.axis[o + 1];
      R[q + 2] = this.axis[o + 2];
      R[q + 3] = this.ang[i];
      C[n * 3] = this.col[o];
      C[n * 3 + 1] = this.col[o + 1];
      C[n * 3 + 2] = this.col[o + 2];
      n++;
    }
    this.live = n;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      for (const at of [this.iPos, this.iRot, this.iCol]) {
        at.clearUpdateRanges();
        at.addUpdateRange(0, n * at.itemSize);
        at.needsUpdate = true;
      }
    }
  }
}

/* ── the splats ─────────────────────────────────────────────────────────── */

const SPLAT_CAP = 900;
const SPLAT_LIFE = 9;

const SPLAT_VERT = /* glsl */ `
attribute vec4 iSplat;  // x, z, radius, age (0..1)
attribute vec3 iCol;
varying vec2 vUv;
varying float vAge;
varying vec3 vCol;
varying float vSeed;
void main() {
  vec3 p = vec3(position.x * iSplat.z, 0.006, position.y * iSplat.z);
  p.x += iSplat.x;
  p.z += iSplat.y;
  vUv = position.xy;
  vAge = iSplat.w;
  vCol = iCol;
  vSeed = fract(sin(iSplat.x * 12.9898 + iSplat.y * 78.233) * 43758.5453);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const SPLAT_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vAge;
varying vec3 vCol;
varying float vSeed;
void main() {
  // A ragged blot: a disc with a few lobes, by angle.
  float a = atan(vUv.y, vUv.x);
  float r = length(vUv) * 2.0;
  float edge = 0.78 + 0.16 * sin(a * 5.0 + vSeed * 20.0) + 0.08 * sin(a * 11.0 + vSeed * 7.0);
  if (r > edge) discard;
  float core = 1.0 - smoothstep(0.0, edge, r);
  // A flash as it lands, then a long stain that fades out. Alpha-blended,
  // not added: a lane where three hundred died is stained, not blinding.
  float flash = exp(-vAge * 30.0);
  float fade = 1.0 - smoothstep(0.55, 1.0, vAge);
  float alpha = mix(0.3, 0.7, core) * fade;
  vec3 col = vCol * mix(0.55, 0.85, core) + vec3(1.0) * flash * 0.6;
  gl_FragColor = vec4(col, clamp(alpha + flash * 0.5, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

export class Splats {
  readonly mesh: Mesh;
  private readonly geo: InstancedBufferGeometry;
  private readonly iSplat: InstancedBufferAttribute;
  private readonly iCol: InstancedBufferAttribute;
  private readonly x = new Float32Array(SPLAT_CAP);
  private readonly z = new Float32Array(SPLAT_CAP);
  private readonly r = new Float32Array(SPLAT_CAP);
  private readonly t = new Float32Array(SPLAT_CAP).fill(SPLAT_LIFE);
  private readonly col = new Float32Array(SPLAT_CAP * 3);
  private next = 0;
  private readonly tmp = new Color();

  constructor(parent: Group) {
    const plane = new PlaneGeometry(1, 1);
    this.geo = new InstancedBufferGeometry();
    this.geo.setIndex(plane.getIndex());
    this.geo.setAttribute('position', plane.getAttribute('position'));
    this.iSplat = new InstancedBufferAttribute(new Float32Array(SPLAT_CAP * 4), 4).setUsage(DynamicDrawUsage);
    this.iCol = new InstancedBufferAttribute(new Float32Array(SPLAT_CAP * 3), 3).setUsage(DynamicDrawUsage);
    this.geo.setAttribute('iSplat', this.iSplat);
    this.geo.setAttribute('iCol', this.iCol);
    this.geo.instanceCount = 0;
    this.mesh = new Mesh(
      this.geo,
      new ShaderMaterial({
        vertexShader: SPLAT_VERT,
        fragmentShader: SPLAT_FRAG,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.name = 'splats';
    // Tools reach the pool through its mesh.
    this.mesh.userData.splats = this;
    parent.add(this.mesh);
  }

  add(x: number, z: number, radius: number, hex: number): void {
    const i = this.next;
    this.next = (this.next + 1) % SPLAT_CAP;
    this.x[i] = x;
    this.z[i] = z;
    this.r[i] = radius * (0.8 + Math.random() * 0.5);
    this.t[i] = 0;
    this.tmp.set(hex);
    this.col[i * 3] = this.tmp.r;
    this.col[i * 3 + 1] = this.tmp.g;
    this.col[i * 3 + 2] = this.tmp.b;
  }

  clear(): void {
    this.t.fill(SPLAT_LIFE);
  }

  tick(dt: number): void {
    const S = this.iSplat.array as Float32Array;
    const C = this.iCol.array as Float32Array;
    let n = 0;
    for (let i = 0; i < SPLAT_CAP; i++) {
      if (this.t[i] >= SPLAT_LIFE) continue;
      this.t[i] += dt;
      if (this.t[i] >= SPLAT_LIFE) continue;
      const o = n * 4;
      S[o] = this.x[i];
      S[o + 1] = this.z[i];
      S[o + 2] = this.r[i];
      S[o + 3] = this.t[i] / SPLAT_LIFE;
      C[n * 3] = this.col[i * 3];
      C[n * 3 + 1] = this.col[i * 3 + 1];
      C[n * 3 + 2] = this.col[i * 3 + 2];
      n++;
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      for (const at of [this.iSplat, this.iCol]) {
        at.clearUpdateRanges();
        at.addUpdateRange(0, n * at.itemSize);
        at.needsUpdate = true;
      }
    }
  }
}
