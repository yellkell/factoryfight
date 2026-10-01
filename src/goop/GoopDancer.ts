/**
 * THE GOOP — the thing in the vat, and the last thing in TUBES.
 *
 * This is RAVE RAID's headliner, brought across whole and then stripped
 * of everything that made it a boxer. The body is identical: twenty
 * blobs on underdamped springs (goop/sim.ts) fused by a smooth-min into
 * one raymarched isosurface (goop/gelMaterial.ts), wearing the club's
 * own dance stances (goop/dancePoses.ts). What did NOT come across is
 * the fight — no moveset, no telegraphs, no KO, no torn-off lumps, no
 * hit detection. Nothing in a factory throws a jab.
 *
 * What is new here is the BIRTH. In the club the creature was simply
 * present; in TUBES you make it. It forms inside a glass tank on your
 * actual floor, climbs out over the rim, drops onto the boards, stands
 * up out of a puddle, and then dances until you leave. `birth` is that
 * whole arc as one 0..1 number the system above drives.
 *
 * Local space is the creature's own (origin on the floor under it, +Y
 * up, facing +Z), and the group carries scale — the sim always runs
 * man-sized so every proportion in goopConfig stays true; the parent
 * scales it down to something that fits in a workshop.
 */

import {
  BoxGeometry,
  CanvasTexture,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { CREATURE, GEL_LOOK } from './goopConfig.js';
import { createGelMaterial, type GelUniforms } from './gelMaterial.js';
import { A } from './poses.js';
import { GoopSim } from './sim.js';
import type { StylePoseDelta } from './dancePoses.js';

const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _gaze = new Vector3();
const _side = new Vector3();
const _m = new Matrix4();

/** Half the gap between the eyes, in creature-local metres — a real
 *  width, measured against the head blob's 0.155 m radius. The ported
 *  pair splayed by an ANGLE instead, which works head-on and collapses
 *  the moment the body yaws: a fixed angle subtends less and less width
 *  as the exit points converge round the silhouette, and it could put
 *  both beads almost on top of each other. This is that same spacing,
 *  measured in metres so it survives any yaw. */
const EYE_SEP = 0.062;
/** How far up the head they sit: level with its centre, as ported. */
const EYE_RISE = 0;
/** How far the bead rides INSIDE the surface, so the gel closes over it
 *  and tints it — the wet look is the point. */
const EYE_SINK = 0.02;

/** The contact shadow that grounds it on your REAL floor. Without this
 *  a passthrough creature reads as a sticker; with it, it is standing
 *  in the room. */
function shadowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(4, 12, 6, 0.6)');
  grad.addColorStop(0.7, 'rgba(4, 12, 6, 0.3)');
  grad.addColorStop(1, 'rgba(4, 12, 6, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

export class GoopDancer {
  readonly group = new Group();
  readonly sim = new GoopSim();

  private gel: GelUniforms;
  private gelMesh: Mesh;
  private shadow: Mesh;
  private shadowMat: MeshBasicMaterial;
  private eyeL: Group;
  private eyeR: Group;
  private eyeMats: MeshBasicMaterial[] = [];
  /** Each eye's group, for the aim. */
  private eyeParts: Array<{ group: Group }> = [];
  private blinkTimer = 2.4;
  private blink = 0;
  /** A double blink, now and then — the tell that reads as ALIVE rather
   *  than as a timer firing. Counts down a second blink. */
  private blinkAgain = 0;
  /** THE SACCADE: a small live offset on the gaze, re-aimed every so
   *  often. Nothing looks deader than eyes locked dead on you. */
  private saccade = new Vector3();
  private saccadeTarget = new Vector3();
  private saccadeTimer = 0;

  /** 0 = a dome of gel, 1 = up on its feet. Eased toward `formTarget`. */
  private form = 0;
  private formTarget = 0;

  /** How fast the body oozes into a new stance (per second). The club's
   *  slow re-pour is 1.6; a dancer hitting a shape on the beat wants a
   *  snap, so the finale runs this hot. */
  styleEase = 6;

  private styleO = new Float32Array(20 * 3);
  private styleR = new Float32Array(20).fill(1);

  private facePoint = new Vector3(0, 1.5, 1);
  private yaw = 0;
  private time = 0;
  private prevPos = new Vector3();
  private prevVel = new Vector3();
  private playerLocal = new Vector3(0, 1.6, 2);

  constructor() {
    this.group.name = 'the-goop';

    this.gel = createGelMaterial();
    // A unit box the vertex shader inflates to the sim's live AABB.
    this.gelMesh = new Mesh(new BoxGeometry(2, 2, 2), this.gel.material);
    this.gelMesh.frustumCulled = false;
    this.gelMesh.renderOrder = 2; // after the opaque eyes, so blending sees them
    this.group.add(this.gelMesh);

    this.shadowMat = new MeshBasicMaterial({
      map: shadowTexture(),
      transparent: true,
      depthWrite: false,
    });
    this.shadow = new Mesh(new PlaneGeometry(1, 1), this.shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.004;
    this.shadow.renderOrder = 0;
    this.group.add(this.shadow);

    /* THE EYES are the whole personality: two glossy beads that ride
     * wherever the gel surface happens to be, found by walking the field
     * outward from the head blob. They sink into the dome while it is
     * forming and surface as it stands up, for free.
     *
     * These are the beads he was PORTED WITH, restored by request after
     * two attempts at "improving" them — a four-part sclera/iris/pupil
     * eye, and then a bigger warmer one. Both were more legible across
     * a room and neither was him. What the redraws WERE right about is
     * kept, because none of it is visible on the bead itself: the pair
     * is separated by a real width rather than by a splay angle (a
     * fixed angle let both eyes slide onto the same spot the moment the
     * body yawed away), and the gaze wanders instead of locking on.
     */
    const mkEye = (): Group => {
      const g = new Group();
      const ball = new MeshBasicMaterial({ color: 0x101b10 });
      this.eyeMats.push(ball);
      g.add(new Mesh(new SphereGeometry(0.046, 16, 12), ball));
      const glint = new Mesh(
        new SphereGeometry(0.013, 8, 6),
        new MeshBasicMaterial({ color: 0xf4fff2 }),
      );
      glint.position.set(0.015, 0.017, 0.035);
      g.add(glint);
      this.group.add(g);
      this.eyeParts.push({ group: g });
      return g;
    };
    this.eyeL = mkEye();
    this.eyeR = mkEye();
  }

  /** 0 = slump into the dome, 1 = stand up. */
  setForm(f: 0 | 1): void {
    this.formTarget = f;
  }

  get formValue(): number {
    return this.form;
  }

  /** Strike a stance: per-anchor deltas over the standing pose, oozed
   *  into over `styleEase`. Null returns it to neutral. */
  setStance(pose: ReadonlyArray<StylePoseDelta> | null): void {
    this.styleO.fill(0);
    this.styleR.fill(1);
    if (!pose) return;
    for (const [i, dx, dy, dz, rs] of pose) {
      this.styleO[i * 3] = dx;
      this.styleO[i * 3 + 1] = dy;
      this.styleO[i * 3 + 2] = dz;
      this.styleR[i] = rs;
    }
  }

  /** What it should look at (world) — normally your head. */
  faceToward(worldPos: Vector3): void {
    this.facePoint.copy(worldPos);
  }

  /** Its head, in world space — for anything that wants to point at it. */
  headWorld(out: Vector3): Vector3 {
    this.sim.corePos(A.HEAD, out);
    this.group.updateMatrixWorld();
    return this.group.localToWorld(out);
  }

  update(dt: number, playerHeadWorld: Vector3): void {
    this.time += dt;

    // Form easing — the pour from dome to dancer.
    const rate = dt / CREATURE.formTime;
    const gap = this.formTarget - this.form;
    this.form += Math.sign(gap) * Math.min(rate, Math.abs(gap));
    this.sim.form = this.form;

    // Face you, yaw only, springily. A gel creature that snaps to face
    // you reads as a turret; one that leans round reads as alive.
    _v.copy(this.facePoint).sub(this.group.position);
    _v.y = 0;
    if (_v.lengthSq() > 1e-5) {
      const target = Math.atan2(_v.x, _v.z);
      let d = target - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * Math.min(1, dt * (1.4 + this.form * 2.2));
    }
    this.group.rotation.set(0, this.yaw, 0);

    // INERTIA: when the root accelerates (climbing out of the tank, or a
    // hop), the mass lags and then catches up. This is most of what sells
    // "it is full of liquid" while it moves.
    if (dt > 1e-4) {
      _v.copy(this.group.position).sub(this.prevPos).divideScalar(dt);
      _v2.copy(_v).sub(this.prevVel);
      this.prevVel.copy(_v);
      this.prevPos.copy(this.group.position);
      _v2.clampLength(0, 6);
      // The group only ever yaws, so the inverse rotation is a plain
      // 2D turn — cheaper and clearer than round-tripping a quaternion.
      const cos = Math.cos(-this.yaw);
      const sin = Math.sin(-this.yaw);
      const lx = _v2.x * cos - _v2.z * sin;
      const lz = _v2.x * sin + _v2.z * cos;
      this.sim.applyInertia(-lx * 0.5, -_v2.y * 0.5, -lz * 0.5);
    }

    this.group.updateMatrixWorld();
    this.playerLocal.copy(playerHeadWorld);
    this.group.worldToLocal(this.playerLocal);

    // Ooze toward the live stance.
    const sk = Math.min(1, dt * this.styleEase);
    for (let i = 0; i < this.styleO.length; i++) {
      this.sim.styleOffsets[i] += (this.styleO[i] - this.sim.styleOffsets[i]) * sk;
    }
    for (let i = 0; i < this.styleR.length; i++) {
      this.sim.styleRadius[i] += (this.styleR[i] - this.sim.styleRadius[i]) * sk;
    }

    this.sim.update(dt);

    // Feed the raymarcher: the blob soup, its AABB, and the inverse of
    // the mesh's world matrix (the march runs in creature space).
    this.sim.bounds(_v, _v2);
    this.gelMesh.updateMatrixWorld();
    _m.copy(this.gelMesh.matrixWorld).invert();
    this.gel.update(
      this.sim.packed,
      this.sim.packedCount,
      this.sim.packedDents,
      this.sim.packedDentCount,
      _v,
      _v2,
      this.time,
      this.sim.agitation,
      0,
      _m,
    );
    this.gel.material.uniforms.uBlend.value = CREATURE.blend * this.sim.blendScale;

    const spread = Math.max(_v2.x, _v2.z) * 2.4;
    this.shadow.scale.set(spread, spread, 1);
    this.shadow.position.x = _v.x;
    this.shadow.position.z = _v.z;
    this.shadowMat.opacity = 0.55;

    // It is small and it is close: full step budget unless you walk off.
    const dist = this.group.position.distanceTo(playerHeadWorld);
    this.gel.setQuality(dist < 3 ? 1 : 3 / dist);

    this.updateEyes(dt, playerHeadWorld);
  }

  /**
   * THE EYES ride the surface — walked outward from the head blob along
   * the gaze until the field says we have popped out of the gel — and
   * then do three small things that between them are the difference
   * between a creature and a prop:
   *
   *  THE SACCADE. Eyes locked dead on you read as a turret. A small
   *    offset is re-aimed every half-second or two and eased into, so
   *    the gaze drifts, catches you again, glances off. It is the single
   *    cheapest thing on this list and the one that does the most.
   *  THE BLINK, sometimes TWICE. A lone blink on a timer is a timer; a
   *    double now and then is a habit. The lid squashes the whole bead,
   *    which is what a blink does to a ball of jelly with no eyelid.
   *  THE SINK. They ride a couple of centimetres INSIDE the surface, so
   *    the gel draws over them: the beads are wet, not stuck on.
   */
  private updateEyes(dt: number, playerHeadWorld: Vector3): void {
    // Blink, and every so often blink again.
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      if (this.blinkAgain > 0) {
        this.blinkAgain--;
        this.blinkTimer = 0.22;
      } else {
        this.blinkTimer = 2.4 + Math.random() * 3.6;
        if (Math.random() < 0.3) this.blinkAgain = 1;
      }
      this.blink = 1;
    }
    this.blink = Math.max(0, this.blink - dt * 8);
    const lid = 1 - Math.min(1, this.blink * 1.7) * 0.94;

    // Where it is looking: you, plus a wander.
    this.saccadeTimer -= dt;
    if (this.saccadeTimer <= 0) {
      this.saccadeTimer = 0.45 + Math.random() * 1.6;
      // Mostly small; occasionally a proper look away and back.
      const reach = Math.random() < 0.22 ? 0.5 : 0.14;
      this.saccadeTarget.set(
        (Math.random() - 0.5) * reach,
        (Math.random() - 0.5) * reach * 0.6,
        0,
      );
    }
    this.saccade.lerp(this.saccadeTarget, Math.min(1, dt * 9));

    this.sim.corePos(A.HEAD, _v);
    _v3.copy(this.playerLocal).sub(_v);
    _v3.y *= 0.4; // level-ish: it looks at you, it doesn't crane
    if (_v3.lengthSq() < 1e-6) _v3.set(0, 0, 1);
    _v3.normalize();

    // The gaze point in WORLD space, wandered — every eye aims at this,
    // so both track together the way a pair of eyes must.
    _gaze.copy(playerHeadWorld);
    _gaze.x += this.saccade.x;
    _gaze.y += this.saccade.y;

    // THE FACE'S OWN SIDEWAYS, so the two beads can be offset by a real
    // DISTANCE rather than by an angle (see EYE_SEP: the splay could
    // slide both of them onto the same spot as the body turned).
    _side.set(_v3.z, 0, -_v3.x);
    if (_side.lengthSq() < 1e-6) _side.set(1, 0, 0);
    _side.normalize();

    const place = (eye: Group, side: number): void => {
      // Start beside the head's centre and march OUT along the gaze: the
      // separation is now a width in metres and survives any yaw.
      const hx = this.sim.packed[A.HEAD * 4] + _side.x * EYE_SEP * side;
      const hy = this.sim.packed[A.HEAD * 4 + 1] + EYE_RISE;
      const hz = this.sim.packed[A.HEAD * 4 + 2] + _side.z * EYE_SEP * side;
      _v2.copy(_v3);
      let s = 0.02;
      for (let i = 0; i < 10; i++) {
        _v.set(hx + _v2.x * s, hy + _v2.y * s, hz + _v2.z * s);
        if (this.sim.fieldAt(_v) > -0.02) break;
        s += 0.035;
      }
      // Sunk, so the gel closes over the ball's rim while its face stays
      // clear of the wash (EYE_SINK — the last cut buried it).
      eye.position.set(
        _v.x - _v2.x * EYE_SINK,
        _v.y - _v2.y * EYE_SINK,
        _v.z - _v2.z * EYE_SINK,
      );
      eye.scale.set(1, lid, 1);
      eye.lookAt(_gaze);
    };
    place(this.eyeL, 1);
    place(this.eyeR, -1);
  }

  /** Everything this owns, back to the driver. */
  dispose(): void {
    this.group.removeFromParent();
    this.gelMesh.geometry.dispose();
    this.gel.material.dispose();
    this.shadow.geometry.dispose();
    this.shadowMat.map?.dispose();
    this.shadowMat.dispose();
    for (const eye of [this.eyeL, this.eyeR]) {
      eye.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as MeshBasicMaterial).dispose();
        }
      });
      eye.removeFromParent();
    }
  }
}

/** The palette, exported so the vat's glass and the goop can be checked
 *  against each other by eye — they are meant to be the same stuff. */
export const GOOP_GREEN = GEL_LOOK.shallowColor;
