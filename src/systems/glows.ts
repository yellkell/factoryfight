/**
 * THE GLOWS — every flash of light the fight throws, in three draw calls.
 *
 * The fight used to keep a pool of separate meshes for its one-shot
 * light — 24 rings, 16 flash balls, 90 rods (beams, and every kink of a
 * tesla bolt) — each one its own scene object and, while lit, its own
 * draw call: a coil discharging into a crowd lit sixty of them. Now each
 * shape is ONE instanced layer with a fixed cap:
 *
 *   RINGS   shock rings on the floor — an annulus whose LEADING EDGE is
 *           the bright one, fading back toward the centre, so a ring
 *           reads as a wave travelling out, not a hoop lying there.
 *   BALLS   flashes — a sphere shaded hot in the middle and soft at the
 *           limb (no flat disc, no hard edge); squash it and it is a
 *           pool of light lying on the floor (a blast's lingering glow).
 *   RODS    beams and bolts — a thin open cylinder, shaded the same way,
 *           so a rod is a white-hot wire inside a coloured sheath.
 *
 * Each layer holds two kinds of instance: SPAWNED ones that live, grow
 * and fade on their own (`spawn`), and IMMEDIATE ones written fresh each
 * frame by whoever draws them (`now` — the tesla's flickering bolts, a
 * shell's landing reticle). Fade is colour, not opacity: they are added
 * light, so dimming the colour IS fading. No objects per effect, no
 * allocation per frame; the GPU builds each rod's frame from its axis.
 *
 * All of it lives in the plant frame, in plant metres.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  type Group,
  DynamicDrawUsage,
} from 'three';

const _col = new Color();

/* ── the shaders ────────────────────────────────────────────────────────── */

// iP: centre (x, y, z), radius (ring/ball) or width (rod).
// iD: axis (x, y, z) and length (rod); ball: .w is its height squash;
// ring: .w is its band (1 the full 0.5..1 annulus, 0.1 a thin hoop).
// iC: colour, already faded.
const HEAD = /* glsl */ `
attribute vec4 iP;
attribute vec4 iD;
attribute vec3 iC;
varying vec3 vCol;
varying float vGlow;
`;

const RING_VERT = /* glsl */ `${HEAD}
attribute float aGlow;
void main() {
  float l = length(position.xz);
  float lb = 1.0 - (1.0 - l) * iD.w;
  vec2 xz = position.xz / l * lb * iP.w;
  vec3 p = iP.xyz + vec3(xz.x, position.y, xz.y);
  vCol = iC;
  vGlow = aGlow;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

/** Shared by balls and rods: the limb-darkened "hot core" look. */
const RIM = /* glsl */ `
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 vn = normalize(mat3(modelViewMatrix) * n);
  vGlow = abs(dot(vn, normalize(-mv.xyz)));
  vCol = iC;
  gl_Position = projectionMatrix * mv;
`;

const BALL_VERT = /* glsl */ `${HEAD}
void main() {
  vec3 s = vec3(iP.w, iP.w * iD.w, iP.w);
  vec3 p = iP.xyz + position * s;
  vec3 n = normalize(normal / s);
  ${RIM}
  // Squashed flat it is a pool of light on the floor: seen from above
  // every normal faces you, so the limb can't shade it — fall off from
  // the middle out instead.
  if (iD.w < 0.6) {
    float rr = 1.0 - length(position.xz);
    vGlow = rr * rr;
  }
}
`;

const ROD_VERT = /* glsl */ `${HEAD}
void main() {
  vec3 az = normalize(iD.xyz);
  vec3 up = abs(az.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 ax = normalize(cross(up, az));
  vec3 ay = cross(az, ax);
  vec3 p = iP.xyz + ax * (position.x * iP.w) + ay * (position.y * iP.w) + az * (position.z * iD.w);
  vec3 n = ax * normal.x + ay * normal.y;
  ${RIM}
}
`;

const FRAG = /* glsl */ `
varying vec3 vCol;
varying float vGlow;
uniform float uPow;
void main() {
  float g = pow(clamp(vGlow, 0.0, 1.0), uPow);
  // The hottest part burns white, in proportion to how lit it still is.
  float lit = max(vCol.r, max(vCol.g, vCol.b));
  vec3 c = vCol * g + vec3(pow(g, 5.0) * 0.35 * lit);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;

/* ── the shapes ─────────────────────────────────────────────────────────── */

/** A flat annulus, radius 0.5..1 on XZ, glowing brightest just inside
 *  its outer edge. */
function ringGeometry(): BufferGeometry {
  const SEG = 40;
  const radii = [0.5, 0.74, 0.9, 0.965, 1];
  const glow = [0, 0.18, 0.62, 1, 0.25];
  const pos: number[] = [];
  const g: number[] = [];
  const idx: number[] = [];
  for (let s = 0; s <= SEG; s++) {
    const a = (s / SEG) * Math.PI * 2;
    for (let k = 0; k < radii.length; k++) {
      pos.push(Math.cos(a) * radii[k], 0, Math.sin(a) * radii[k]);
      g.push(glow[k]);
    }
  }
  const R = radii.length;
  for (let s = 0; s < SEG; s++) {
    for (let k = 0; k < R - 1; k++) {
      const a = s * R + k;
      const b = (s + 1) * R + k;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('aGlow', new BufferAttribute(new Float32Array(g), 1));
  geo.setIndex(idx);
  return geo;
}

/* ── a layer ────────────────────────────────────────────────────────────── */

export class GlowLayer {
  readonly mesh: Mesh;
  private readonly geo: InstancedBufferGeometry;
  private readonly iP: InstancedBufferAttribute;
  private readonly iD: InstancedBufferAttribute;
  private readonly iC: InstancedBufferAttribute;
  // The spawned pool: where, how big from → to, which way, what colour,
  // and its clock (t < 0 is a delay still running).
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly z: Float32Array;
  private readonly r0: Float32Array;
  private readonly r1: Float32Array;
  private readonly d: Float32Array;
  private readonly c: Float32Array;
  private readonly t: Float32Array;
  private readonly life: Float32Array;
  private readonly peak: Float32Array;
  private next = 0;
  /** Instances written this frame (spawned first, then immediate). */
  private n = 0;
  private readonly total: number;
  private readonly attrs: InstancedBufferAttribute[];

  /** `cap` spawned instances, plus `nowCap` immediate ones a frame. */
  constructor(parent: Group, base: BufferGeometry, vert: string, pow: number, private readonly cap: number, nowCap: number, name: string) {
    this.total = cap + nowCap;
    this.geo = new InstancedBufferGeometry();
    this.geo.setIndex(base.getIndex());
    this.geo.setAttribute('position', base.getAttribute('position'));
    if (base.getAttribute('normal')) this.geo.setAttribute('normal', base.getAttribute('normal'));
    if (base.getAttribute('aGlow')) this.geo.setAttribute('aGlow', base.getAttribute('aGlow'));
    this.iP = new InstancedBufferAttribute(new Float32Array(this.total * 4), 4).setUsage(DynamicDrawUsage);
    this.iD = new InstancedBufferAttribute(new Float32Array(this.total * 4), 4).setUsage(DynamicDrawUsage);
    this.iC = new InstancedBufferAttribute(new Float32Array(this.total * 3), 3).setUsage(DynamicDrawUsage);
    this.geo.setAttribute('iP', this.iP);
    this.geo.setAttribute('iD', this.iD);
    this.geo.setAttribute('iC', this.iC);
    this.attrs = [this.iP, this.iD, this.iC];
    this.geo.instanceCount = 0;
    this.mesh = new Mesh(
      this.geo,
      new ShaderMaterial({
        vertexShader: vert,
        fragmentShader: FRAG,
        uniforms: { uPow: { value: pow } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 15;
    this.mesh.name = name;
    this.mesh.visible = false;
    parent.add(this.mesh);
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.z = new Float32Array(cap);
    this.r0 = new Float32Array(cap);
    this.r1 = new Float32Array(cap);
    this.d = new Float32Array(cap * 4);
    this.c = new Float32Array(cap * 3);
    this.t = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.peak = new Float32Array(cap);
  }

  /**
   * One that lives on its own: at (x, y, z), growing from r0 to r1 (eased
   * out) as it fades from `peak` to nothing over `life` seconds, after
   * `delay`. (dx, dy, dz, len) is a rod's axis and length, or (0, 1, 0,
   * squash) for a ball.
   */
  spawn(
    x: number,
    y: number,
    z: number,
    r0: number,
    r1: number,
    hex: number,
    life: number,
    peak = 1,
    delay = 0,
    dx = 0,
    dy = 1,
    dz = 0,
    len = 1,
  ): void {
    // The next dark slot, else the oldest (the ring of slots is in age
    // order, so `next` is it).
    let i = this.next;
    for (let k = 0; k < this.cap; k++) {
      const j = (this.next + k) % this.cap;
      if (this.t[j] >= this.life[j]) {
        i = j;
        break;
      }
    }
    this.next = (i + 1) % this.cap;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.r0[i] = r0;
    this.r1[i] = r1;
    this.d[i * 4] = dx;
    this.d[i * 4 + 1] = dy;
    this.d[i * 4 + 2] = dz;
    this.d[i * 4 + 3] = len;
    _col.set(hex);
    this.c[i * 3] = _col.r;
    this.c[i * 3 + 1] = _col.g;
    this.c[i * 3 + 2] = _col.b;
    this.t[i] = -delay;
    this.life[i] = life;
    this.peak[i] = peak;
  }

  /** Age the spawned ones and write the lit ones out. Call first. */
  begin(dt: number): void {
    const P = this.iP.array as Float32Array;
    const D = this.iD.array as Float32Array;
    const C = this.iC.array as Float32Array;
    let n = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.t[i] >= this.life[i]) continue;
      this.t[i] += dt;
      const p = this.t[i] / this.life[i];
      if (p < 0 || p >= 1) continue;
      const e = 1 - (1 - p) * (1 - p) * (1 - p);
      const f = this.peak[i] * (1 - p) ** 1.5;
      P[n * 4] = this.x[i];
      P[n * 4 + 1] = this.y[i];
      P[n * 4 + 2] = this.z[i];
      P[n * 4 + 3] = Math.max(0.0005, this.r0[i] + (this.r1[i] - this.r0[i]) * e);
      D[n * 4] = this.d[i * 4];
      D[n * 4 + 1] = this.d[i * 4 + 1];
      D[n * 4 + 2] = this.d[i * 4 + 2];
      D[n * 4 + 3] = this.d[i * 4 + 3];
      C[n * 3] = this.c[i * 3] * f;
      C[n * 3 + 1] = this.c[i * 3 + 1] * f;
      C[n * 3 + 2] = this.c[i * 3 + 2] * f;
      n++;
    }
    this.n = n;
  }

  /** One for this frame only (after `begin`, before `end`). Colour is
   *  linear r, g, b, already at the brightness wanted. */
  now(x: number, y: number, z: number, r: number, dx: number, dy: number, dz: number, len: number, cr: number, cg: number, cb: number): void {
    if (this.n >= this.total) return;
    const P = this.iP.array as Float32Array;
    const D = this.iD.array as Float32Array;
    const C = this.iC.array as Float32Array;
    const n = this.n++;
    P[n * 4] = x;
    P[n * 4 + 1] = y;
    P[n * 4 + 2] = z;
    P[n * 4 + 3] = r;
    D[n * 4] = dx;
    D[n * 4 + 1] = dy;
    D[n * 4 + 2] = dz;
    D[n * 4 + 3] = len;
    C[n * 3] = cr;
    C[n * 3 + 1] = cg;
    C[n * 3 + 2] = cb;
  }

  /** Hand this frame's instances to the GPU. */
  end(): void {
    const n = this.n;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n === 0) return;
    for (const at of this.attrs) {
      at.clearUpdateRanges();
      at.addUpdateRange(0, n * at.itemSize);
      at.needsUpdate = true;
    }
  }

  /** Instances lit last frame (tools). */
  get lit(): number {
    return this.n;
  }
}

/** The three layers, made once. */
export class Glows {
  readonly rings: GlowLayer;
  readonly balls: GlowLayer;
  readonly rods: GlowLayer;

  constructor(parent: Group) {
    this.rings = new GlowLayer(parent, ringGeometry(), RING_VERT, 1, 64, 24, 'glow-rings');
    this.balls = new GlowLayer(parent, new SphereGeometry(1, 12, 8), BALL_VERT, 1.4, 48, 8, 'glow-balls');
    const rod = new CylinderGeometry(1, 1, 1, 6, 1, true);
    rod.rotateX(Math.PI / 2);
    this.rods = new GlowLayer(parent, rod, ROD_VERT, 2.2, 96, 1024, 'glow-rods');
  }

  /** A shock ring on the floor: out from r·0.2 to r. `band` is how much
   *  of its radius glows behind the leading edge (1: the outer half; the
   *  default, a quarter — rings stacked on one blast stay rings, not a
   *  disc; 0.1: a hoop). */
  ring(x: number, z: number, hex: number, r: number, life: number, peak = 0.95, delay = 0, band = 0.5): void {
    this.rings.spawn(x, 0.02, z, r * 0.2, r, hex, life, peak, delay, 0, 1, 0, band);
  }

  /** A flash: a ball of light from r·0.4 to r. `squash` < 1 lays it on
   *  the floor as a pool. */
  flash(x: number, y: number, z: number, hex: number, r: number, life: number, peak = 0.9, squash = 1, delay = 0): void {
    this.balls.spawn(x, y, z, r * 0.4, r, hex, life, peak, delay, 0, 1, 0, squash);
  }

  /** A rod of light from (x0, y0, z0) to (x1, y1, z1), thinning as it fades. */
  rod(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: number, life = 0.22, width = 0.035, peak = 1): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    this.rods.spawn((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, width, width * 0.4, hex, life, peak, 0, dx, dy, dz, len);
  }

  begin(dt: number): void {
    this.rings.begin(dt);
    this.balls.begin(dt);
    this.rods.begin(dt);
  }

  end(): void {
    this.rings.end();
    this.balls.end();
    this.rods.end();
  }
}

/* ── THE BOLTS ──────────────────────────────────────────────────────────
 * A tesla discharge: the chain's hops, each a jagged run of kinks, with
 * forks spitting off the kinks. A bolt lives a fifth of a second and
 * re-strikes three or four times in it — every 50 ms its kinks and forks
 * are rolled afresh (seeded, so a re-strike holds still between rolls)
 * and its brightness stutters bright-dim-bright: lightning, not a wire.
 * Drawn as immediate rods (a white core in a violet sheath) — no pool of
 * its own, no objects.
 */

const BOLT_CAP = 16;
const BOLT_PTS = 12;
const BOLT_LIFE = 0.2;
const STRIKE = 0.05;
/** Brightness of each re-strike. */
const STUTTER = [1, 0.4, 0.9, 0.3, 0.6];

/** A cheap, stable hash of three numbers to 0..1. */
function hash(a: number, b: number, c: number): number {
  const s = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

export class Bolts {
  private readonly pts = new Float32Array(BOLT_CAP * BOLT_PTS * 3);
  private readonly np = new Uint8Array(BOLT_CAP);
  private readonly age = new Float32Array(BOLT_CAP).fill(BOLT_LIFE);
  private readonly seed = new Float32Array(BOLT_CAP);
  private next = 0;
  private sheathed = true;
  private readonly core = new Color();
  private readonly sheath = new Color();

  constructor(
    private readonly rods: GlowLayer,
    coreHex: number,
    sheathHex: number,
  ) {
    this.core.set(coreHex);
    this.sheath.set(sheathHex);
  }

  /** A discharge along `path` ([x, y, z] per hop). */
  strike(path: readonly number[]): void {
    const b = this.next;
    this.next = (this.next + 1) % BOLT_CAP;
    const n = Math.min(BOLT_PTS, Math.floor(path.length / 3));
    for (let k = 0; k < n * 3; k++) this.pts[b * BOLT_PTS * 3 + k] = path[k];
    this.np[b] = n;
    this.age[b] = 0;
    this.seed[b] = Math.random() * 100;
  }

  /** Write every live bolt into the rods for this frame. `full` false
   *  (a busy frame) drops the sheath: one rod a kink, not two. */
  draw(dt: number, full = true): void {
    this.sheathed = full;
    for (let b = 0; b < BOLT_CAP; b++) {
      if (this.age[b] >= BOLT_LIFE) continue;
      this.age[b] += dt;
      if (this.age[b] >= BOLT_LIFE) continue;
      const step = Math.floor(this.age[b] / STRIKE);
      const lit = STUTTER[step % STUTTER.length] * (1 - (this.age[b] / BOLT_LIFE) * 0.5);
      const sd = this.seed[b] + step * 7.31;
      const o = b * BOLT_PTS * 3;
      for (let h = 0; h + 1 < this.np[b]; h++) {
        const ax = this.pts[o + h * 3];
        const ay = this.pts[o + h * 3 + 1];
        const az = this.pts[o + h * 3 + 2];
        const bx = this.pts[o + h * 3 + 3];
        const by = this.pts[o + h * 3 + 4];
        const bz = this.pts[o + h * 3 + 5];
        const span = Math.hypot(bx - ax, bz - az);
        const j = 0.05 + span * 0.18;
        // A long hop kinks more often.
        const kinks = 3 + Math.min(3, Math.floor(span / 0.18));
        let px = ax;
        let py = ay;
        let pz = az;
        for (let s = 1; s <= kinks; s++) {
          const t = s / kinks;
          const end = s === kinks;
          const qx = ax + (bx - ax) * t + (end ? 0 : (hash(sd, h, s) - 0.5) * j);
          const qy = ay + (by - ay) * t + (end ? 0 : (hash(sd, h, s + 9) - 0.5) * j * 0.7) + (end ? 0 : Math.sin(t * Math.PI) * span * 0.12);
          const qz = az + (bz - az) * t + (end ? 0 : (hash(sd, h, s + 17) - 0.5) * j);
          this.seg(px, py, pz, qx, qy, qz, lit, 1, this.sheathed);
          // A fork off this kink: two short, thinner hops out to nowhere.
          if (!end && hash(sd, h, s + 31) < 0.32) {
            let fx = qx;
            let fy = qy;
            let fz = qz;
            const fa = hash(sd, h, s + 43) * Math.PI * 2;
            const fl = 0.035 + span * 0.12 * hash(sd, h, s + 47);
            for (let f = 1; f <= 2; f++) {
              const gx = fx + Math.sin(fa + (f - 1) * 0.9) * fl;
              const gy = fy + (hash(sd, h, s + 53 + f) - 0.6) * fl;
              const gz = fz + Math.cos(fa + (f - 1) * 0.9) * fl;
              this.seg(fx, fy, fz, gx, gy, gz, lit * (f === 1 ? 0.7 : 0.4), 0.55, false);
              fx = gx;
              fy = gy;
              fz = gz;
            }
          }
          px = qx;
          py = qy;
          pz = qz;
        }
      }
    }
  }

  /** One kink: a white-hot core inside a wider violet sheath (a fork, or
   *  a busy frame: the core alone, a little fatter). */
  private seg(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, lit: number, w: number, sheath: boolean): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const mz = (z0 + z1) / 2;
    const c = this.core;
    const s = this.sheath;
    this.rods.now(mx, my, mz, (sheath ? 0.008 : 0.012) * w, dx, dy, dz, len, c.r * lit, c.g * lit, c.b * lit);
    if (sheath) this.rods.now(mx, my, mz, 0.03 * w, dx, dy, dz, len * 1.04, s.r * lit * 0.75, s.g * lit * 0.75, s.b * lit * 0.75);
  }
}
