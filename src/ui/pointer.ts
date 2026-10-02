/**
 * Controller pointer kit — the laser and its cursor dot, shared by the
 * board, the job card, and the flange placement reticle's confirm ray.
 * Carried over from RAVE RAID, wearing the shop's amber.
 *
 * The Meta interaction grammar: the beam only draws when it's actually ON
 * an interactable (a searchlight sweeping your own living room is worse
 * than noise), the dot rides the hit point, and feedback is eased, never
 * snapped — the dot swells ~1.3× over a hovered button (~100 ms out,
 * ~180 ms back), and a click lands a short bright pop that decays over
 * ~150 ms. All of it is mesh/material state: nothing here touches a canvas.
 *
 * THE CURSOR HAS TWO FACES. The dot is for things you PRESS — buttons,
 * a flange on a wall. Laying a rail is aiming a DIRECTION as much as a
 * spot, and a dot on the floor said nothing about which way the lane
 * would run: the arrow does. BuildSystem asks for it (`arrow(yaw)`)
 * whenever a rail is armed, lying flat on the boards at the hit point,
 * nose along the rail's travel, wearing the same swell and click pop.
 */

import {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
  type Object3D,
  type Scene,
} from 'three';

const HOVER_IN_S = 0.1;
const HOVER_OUT_S = 0.18;
const CLICK_S = 0.15;
const DOT_R = 0.011;
/** The floor arrow: nose along local +Z, lying in XZ, unit-ish (m). */
const ARROW_LEN = 0.11;
const ARROW_W = 0.07;
/** How far off the boards it lies — clear of the floor's own z-fight. */
const ARROW_LIFT = 0.012;

/** A flat arrow in the XZ plane: a broad head and a short stem, nose at
 *  +Z, tail at −Z, centred on its own middle so it sits ON the hit. */
function arrowGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  const L = ARROW_LEN;
  const W = ARROW_W;
  const nose = L * 0.5;
  const neck = -L * 0.05;
  const tail = -L * 0.5;
  const stem = W * 0.2;
  const v = [
    // the head
    -W / 2, 0, neck, W / 2, 0, neck, 0, 0, nose,
    // the stem, two triangles
    -stem, 0, tail, stem, 0, tail, stem, 0, neck,
    -stem, 0, tail, stem, 0, neck, -stem, 0, neck,
  ];
  g.setAttribute('position', new Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

export class PointerRay {
  private line: Line;
  private lineMat: LineBasicMaterial;
  private dot: Mesh;
  private dotMat: MeshBasicMaterial;
  private arrowMesh: Mesh;
  private hoverAmt = 0;
  private clickAmt = 0;
  /** The arrow's heading (world yaw, radians), or null for the dot. */
  private arrowYaw: number | null = null;

  constructor(scene: Object3D | Scene) {
    this.lineMat = new LineBasicMaterial({
      color: 0xffa22e,
      transparent: true,
      opacity: 0.25,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const geo = new BufferGeometry().setFromPoints([new Vector3(), new Vector3(0, 0, -1)]);
    this.line = new Line(geo, this.lineMat);
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.dotMat = new MeshBasicMaterial({ color: 0xfff0dc, transparent: true, opacity: 0.95 });
    this.dot = new Mesh(new SphereGeometry(DOT_R, 12, 10), this.dotMat);
    this.dot.renderOrder = 31; // over the panel it rests on
    this.dot.visible = false;
    // The arrow wears the dot's colour and follows its opacity and click
    // pop. Double-sided, because a floor cursor gets looked at from
    // every side of the shop.
    this.arrowMesh = new Mesh(
      arrowGeometry(),
      new MeshBasicMaterial({
        color: 0xfff0dc,
        transparent: true,
        opacity: 0.95,
        side: DoubleSide,
        depthWrite: false,
      }),
    );
    this.arrowMesh.renderOrder = 31;
    this.arrowMesh.visible = false;
    scene.add(this.line);
    scene.add(this.dot);
    scene.add(this.arrowMesh);
  }

  /** Wear the ARROW at the hit point, nose along `yaw` (world, about Y;
   *  0 = +Z), instead of the dot — or null to go back to the dot. Set
   *  before update() each frame; it is not remembered across a hide. */
  arrow(yaw: number | null): void {
    this.arrowYaw = yaw;
  }

  /** Feed one frame: where the ray starts, where it hit (null = no target
   *  under it), and whether the hit is over a live button. */
  update(delta: number, origin: Vector3, end: Vector3 | null, hovering: boolean): void {
    const on = end !== null;
    const asArrow = on && this.arrowYaw !== null;
    this.line.visible = on;
    this.dot.visible = on && !asArrow;
    this.arrowMesh.visible = asArrow;
    if (!on) {
      // Reset the feedback, not just hide it — a stale click pop or hover
      // swell must not reappear when the ray finds a target again.
      this.hoverAmt = 0;
      this.clickAmt = 0;
      return;
    }

    const pos = this.line.geometry.getAttribute('position');
    pos.setXYZ(0, origin.x, origin.y, origin.z);
    pos.setXYZ(1, end.x, end.y, end.z);
    pos.needsUpdate = true;
    this.dot.position.copy(end);
    if (asArrow) {
      this.arrowMesh.position.set(end.x, end.y + ARROW_LIFT, end.z);
      this.arrowMesh.rotation.set(0, this.arrowYaw ?? 0, 0);
    }

    const want = hovering ? 1 : 0;
    const rate = want > this.hoverAmt ? delta / HOVER_IN_S : delta / HOVER_OUT_S;
    this.hoverAmt =
      this.hoverAmt < want ? Math.min(want, this.hoverAmt + rate) : Math.max(want, this.hoverAmt - rate);
    this.clickAmt = Math.max(0, this.clickAmt - delta / CLICK_S);

    const swell = 1 + 0.32 * this.hoverAmt + 0.5 * this.clickAmt;
    this.dot.scale.setScalar(swell);
    this.arrowMesh.scale.setScalar(swell);
    this.lineMat.opacity = 0.22 + 0.26 * this.hoverAmt;
    this.dotMat.opacity = 0.8 + 0.2 * this.hoverAmt;
    (this.arrowMesh.material as MeshBasicMaterial).opacity = this.dotMat.opacity;
  }

  /** The trigger landed — pop the dot. */
  click(): void {
    this.clickAmt = 1;
  }

  hide(): void {
    this.line.visible = false;
    this.dot.visible = false;
    this.arrowMesh.visible = false;
    this.arrowYaw = null;
    this.hoverAmt = 0;
  }

  dispose(): void {
    this.line.removeFromParent();
    this.dot.removeFromParent();
    this.arrowMesh.removeFromParent();
    this.line.geometry.dispose();
    this.lineMat.dispose();
    (this.dot.geometry as SphereGeometry).dispose();
    this.dotMat.dispose();
    this.arrowMesh.geometry.dispose();
    (this.arrowMesh.material as MeshBasicMaterial).dispose();
  }
}
