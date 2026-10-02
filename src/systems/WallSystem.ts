/**
 * WallSystem — the room scan becomes the wall registry.
 *
 * IWSDK's SceneUnderstandingSystem turns WebXR's detected planes into
 * entities; this system reads those entities every frame and folds the
 * mountable ones into the registry everything else plays against:
 * centre, into-the-room normal, right/up tangents, half-extents (see
 * room/walls.ts for the model and the maths). Vertical planes become
 * walls; horizontal ones become the FLOOR and the CEILING — exit ports
 * live there too — while tables, desks and the rest of the furniture
 * shelf are deliberately left out (a tube into a coffee table is a
 * gag, not a run; the machine lives in the room's BONES).
 *
 * Where no scan answers — desktop emulator, a headset without room setup,
 * a player who declined — the FALLBACK ROOM stands in after a short
 * grace: four synthetic walls around wherever the player is standing,
 * honest registry citizens in every way except `real`. Real planes
 * arriving later evict the stand-ins, but only between shifts: hardware
 * mid-job stays on the walls it was bolted to.
 *
 * And where the headset has its boundary drawn, THE STAGE ROOM takes the
 * registry outright (room/stage.ts reads the box): four faces standing
 * on the room-scale box's edges, the floor and the ceiling trimmed to
 * it, at the heights the scan lends. The plaster beyond the box is not
 * the room — every flange, port and tape run stays inside the floor you
 * set aside to walk. Same law as the stand-in: only re-dealt between
 * shifts.
 *
 * The registry also owns its own debug skin: hairline frames on every
 * wall, on for synthetic walls whenever they're being aimed at (you
 * cannot aim at a wall you cannot see) and switchable for real ones from
 * the board's SYSTEM tab.
 */

import { XRPlane, createSystem } from '@iwsdk/core';
import {
  BufferGeometry,
  Line,
  LineBasicMaterial,
  LineLoop,
  Vector3,
} from 'three';
import { WALLS } from '../config.js';
import { site } from '../game/state.js';
import { pollStage, stage } from '../room/stage.js';
import {
  buildFallbackRoom,
  buildStageRoom,
  pointOn,
  usable,
  type SurfaceKind,
  type Wall,
} from '../room/walls.js';

/** The live registry — everything downstream reads walls through here. */
export const walls: Wall[] = [];

/** The stage room's six ids — fixed, so a refresh lands in place and
 *  hardware bolted to a face keeps it. */
const STAGE_ID = 2000;
const isStageId = (id: number): boolean => id >= STAGE_ID && id < STAGE_ID + 6;

/** Headless/dev view (wired into __tubes in main.ts). */
export const wallsView: {
  count?: () => number;
  realCount?: () => number;
  /** Force the fallback room NOW (tools shouldn't wait out the grace). */
  forceFallback?: () => void;
} = {};

const _toPlayer = new Vector3();
const _axisX = new Vector3();
const _axisZ = new Vector3();
const _up = new Vector3();
const _right = new Vector3();
const _center = new Vector3();

interface PlaneShape {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export class WallSystem extends createSystem({
  planes: { required: [XRPlane] },
}) {
  private nextId = 1;
  private idByPlane = new Map<object, number>();
  private graceLeft = WALLS.fallbackGraceS;
  private fallbackBuilt = false;
  /** The stage room stands (the registry IS the room-scale box). */
  private stageBuilt = false;
  private stageSig = '';
  /** What the scan says the floor and ceiling heights are — lent to the
   *  stage room whether or not the planes themselves are in the registry. */
  private scanFloorY: number | null = null;
  private scanCeilY: number | null = null;
  /** Registry revision — the hint skin rebuilds when it moves. */
  private revision = 0;
  private paintedRevision = -1;
  private hintLines: Array<{ frame: LineLoop; tick: Line }> = [];
  private hintMat = new LineBasicMaterial({
    color: 0xffa22e,
    transparent: true,
    opacity: WALLS.hintOpacity,
  });

  init(): void {
    wallsView.count = () => walls.length;
    wallsView.realCount = () => walls.filter((w) => w.real).length;
    wallsView.forceFallback = () => {
      this.graceLeft = 0;
    };
  }

  update(delta: number): void {
    // The headset's room-scale box, asked for once per session (cheap after).
    pollStage(this.world.session ?? null, this.xrFrame, this.xrManager?.getReferenceSpace() ?? null);

    this.harvestPlanes();
    this.syncStage();

    // The grace only counts down while a session is actually running —
    // the scan can't answer a page that hasn't entered the headset yet.
    if (this.world.session && !this.hasRealWalls() && !this.fallbackBuilt && !this.stageBuilt) {
      this.graceLeft -= delta;
      if (this.graceLeft <= 0) this.buildFallback();
    }

    site.wallsReady = walls.some((w) => usable(w));
    site.fallbackRoom = this.fallbackBuilt && !this.hasRealWalls();
    site.stageRoom = this.stageBuilt;

    this.paintHints();
  }

  private hasRealWalls(): boolean {
    return walls.some((w) => w.real);
  }

  /* ── the scan ─────────────────────────────────────────────────────────── */

  private harvestPlanes(): void {
    const seen = new Set<number>();
    let realArrived = false;
    let floorY = Infinity;
    let ceilY = -Infinity;

    for (const entity of this.queries.planes.entities) {
      const plane = entity.getValue(XRPlane, '_plane') as
        | (XRPlaneNative & { polygon: ArrayLike<{ x: number; z: number }> })
        | undefined;
      const obj = entity.object3D;
      if (!plane || !obj) continue;
      const kind = classifyPlane(plane, obj.position.y);
      if (!kind) continue;
      if (kind === 'floor') floorY = Math.min(floorY, obj.position.y);
      else if (kind === 'ceiling') ceilY = Math.max(ceilY, obj.position.y);
      // While the stage room stands the scan only lends its heights:
      // the plaster beyond the box is not the room.
      if (this.stageBuilt) continue;

      const shape = polygonShape(plane.polygon);
      if (!shape) continue;

      let id = this.idByPlane.get(plane);
      if (id === undefined) {
        id = this.nextId++;
        this.idByPlane.set(plane, id);
        realArrived = true;
      }
      seen.add(id);
      this.writeWall(id, kind, obj.position, obj.quaternion, shape);
    }

    if (Number.isFinite(floorY)) this.scanFloorY = floorY;
    if (Number.isFinite(ceilY)) this.scanCeilY = ceilY;

    // Planes the scan withdrew (or the session ended) leave the registry.
    const before = walls.length;
    for (let i = walls.length - 1; i >= 0; i--) {
      if (walls[i].real && !seen.has(walls[i].id)) walls.splice(i, 1);
    }
    if (walls.length !== before) this.revision++;

    // Real walls evict the stand-ins — but never under a live shift:
    // mid-job hardware keeps the walls it was bolted to until the board.
    if (realArrived && this.fallbackBuilt && site.screen === 'board') {
      for (let i = walls.length - 1; i >= 0; i--) {
        if (!walls[i].real) walls.splice(i, 1);
      }
      this.fallbackBuilt = false;
      this.revision++;
    }
  }

  /** Fold one plane pose into the registry (insert or refresh in place). */
  private writeWall(
    id: number,
    kind: SurfaceKind,
    position: Vector3,
    quaternion: { x: number; y: number; z: number; w: number },
    shape: PlaneShape,
  ): void {
    // Plane space: +Y is the normal, the polygon lies in X/Z.
    const normal = new Vector3(0, 1, 0).applyQuaternion(quaternion as never);
    _axisX.set(1, 0, 0).applyQuaternion(quaternion as never);
    _axisZ.set(0, 0, 1).applyQuaternion(quaternion as never);

    // The polygon's centre may sit off the pose origin — carry the offset.
    const offX = (shape.minX + shape.maxX) / 2;
    const offZ = (shape.minZ + shape.maxZ) / 2;
    _center
      .copy(position)
      .addScaledVector(_axisX, offX)
      .addScaledVector(_axisZ, offZ);

    // Face INTO the room: at the player, who is inside it by definition.
    this.camera.getWorldPosition(_toPlayer).sub(_center);
    if (normal.dot(_toPlayer) < 0) normal.negate();

    // Whichever in-plane axis climbs is `up`; the other runs the width.
    const xClimb = Math.abs(_axisX.y);
    const zClimb = Math.abs(_axisZ.y);
    let halfW: number;
    let halfH: number;
    if (zClimb >= xClimb) {
      _up.copy(_axisZ);
      halfH = (shape.maxZ - shape.minZ) / 2;
      halfW = (shape.maxX - shape.minX) / 2;
    } else {
      _up.copy(_axisX);
      halfH = (shape.maxX - shape.minX) / 2;
      halfW = (shape.maxZ - shape.minZ) / 2;
    }
    if (_up.y < 0) _up.negate();
    _right.crossVectors(_up, normal).normalize();

    const existing = walls.find((w) => w.id === id);
    const wall: Wall = existing ?? {
      id,
      kind,
      center: new Vector3(),
      normal: new Vector3(),
      right: new Vector3(),
      up: new Vector3(),
      halfW: 0,
      halfH: 0,
      real: true,
    };
    // Refresh quietly; only a NEW or resized wall repaints the hint skin.
    const moved =
      !existing ||
      Math.abs(existing.halfW - halfW) > 0.03 ||
      Math.abs(existing.halfH - halfH) > 0.03 ||
      existing.center.distanceToSquared(_center) > 0.001;
    wall.kind = kind;
    wall.center.copy(_center);
    wall.normal.copy(normal);
    wall.right.copy(_right);
    wall.up.copy(_up);
    wall.halfW = halfW;
    wall.halfH = halfH;
    if (!existing) walls.push(wall);
    if (moved) this.revision++;
  }

  /* ── the stage room ───────────────────────────────────────────────────── */

  /** The room-scale box takes the registry: the scan's plaster and the
   *  stand-in both leave, six faces stand on the box. Refreshed in place
   *  (fixed ids) when the box or the scan's heights move — and, like
   *  every re-deal of the room, only between shifts. */
  private syncStage(): void {
    if (site.screen !== 'board') return;
    const rect = stage.rect;
    if (!rect) {
      if (!this.stageBuilt) return;
      // The box is gone (a tool lifted it): the scan, or the grace,
      // takes the room back next frame.
      for (let i = walls.length - 1; i >= 0; i--) {
        if (isStageId(walls[i].id)) walls.splice(i, 1);
      }
      this.stageBuilt = false;
      this.stageSig = '';
      this.revision++;
      return;
    }
    const floorY = this.scanFloorY ?? 0;
    const ceilY = this.scanCeilY ?? floorY + WALLS.fallback.h;
    const sig = [rect.minX, rect.maxX, rect.minZ, rect.maxZ, floorY, ceilY].map((n) => n.toFixed(3)).join(',');
    if (this.stageBuilt && sig === this.stageSig) return;

    for (let i = walls.length - 1; i >= 0; i--) {
      if (!isStageId(walls[i].id)) walls.splice(i, 1);
    }
    for (const fresh of buildStageRoom(rect, floorY, ceilY, STAGE_ID)) {
      const ex = walls.find((w) => w.id === fresh.id);
      if (!ex) {
        walls.push(fresh);
        continue;
      }
      ex.kind = fresh.kind;
      ex.center.copy(fresh.center);
      ex.normal.copy(fresh.normal);
      ex.right.copy(fresh.right);
      ex.up.copy(fresh.up);
      ex.halfW = fresh.halfW;
      ex.halfH = fresh.halfH;
    }
    this.fallbackBuilt = false;
    this.stageBuilt = true;
    this.stageSig = sig;
    this.revision++;
  }

  /* ── the stand-in room ────────────────────────────────────────────────── */

  private buildFallback(): void {
    this.fallbackBuilt = true;
    const head = this.camera.getWorldPosition(_toPlayer);
    const yaw = this.player.rotation.y;
    for (const w of buildFallbackRoom(head.x, head.z, yaw, 1000)) walls.push(w);
    this.revision++;
  }

  /* ── the hint skin ────────────────────────────────────────────────────── */

  private paintHints(): void {
    // Synthetic walls show themselves whenever a flange wants placing —
    // you cannot aim at plaster that isn't there (nor at a boundary the
    // headset stopped drawing). Everything else waits for the SYSTEM
    // toggle.
    const placing = site.runs.some((r) => r.phase === 'place');
    const wantSynthetic = (site.fallbackRoom || site.stageRoom) && site.screen !== 'board' && placing;

    if (this.paintedRevision !== this.revision) {
      this.paintedRevision = this.revision;
      for (const h of this.hintLines) {
        h.frame.removeFromParent();
        h.frame.geometry.dispose();
        h.tick.removeFromParent();
        h.tick.geometry.dispose();
      }
      this.hintLines = [];
      for (const w of walls) {
        const frameGeo = new BufferGeometry().setFromPoints([
          pointOn(w, -w.halfW + 0.02, -w.halfH + 0.02),
          pointOn(w, w.halfW - 0.02, -w.halfH + 0.02),
          pointOn(w, w.halfW - 0.02, w.halfH - 0.02),
          pointOn(w, -w.halfW + 0.02, w.halfH - 0.02),
        ]);
        const frame = new LineLoop(frameGeo, this.hintMat);
        const tickGeo = new BufferGeometry().setFromPoints([
          w.center.clone(),
          w.center.clone().addScaledVector(w.normal, 0.14),
        ]);
        const tick = new Line(tickGeo, this.hintMat);
        this.scene.add(frame, tick);
        this.hintLines.push({ frame, tick });
      }
    }

    for (let i = 0; i < this.hintLines.length; i++) {
      const wall = walls[i];
      const show = site.showWalls || (wantSynthetic && wall && !wall.real);
      this.hintLines[i].frame.visible = show;
      this.hintLines[i].tick.visible = show;
    }
  }
}

/** The native XRPlane surface we read (typed loosely — the WebXR lib
 *  typings don't ship `orientation`/`polygon`/`semanticLabel`
 *  everywhere yet). */
interface XRPlaneNative {
  orientation: 'horizontal' | 'vertical';
  semanticLabel?: string;
}

/** What a detected plane is to the game — or null for the furniture we
 *  leave alone. Vertical planes are walls; horizontal ones are the
 *  floor/ceiling when the runtime SAYS so, else judged by height (a
 *  labelless slab at lamp height is somebody's desk, and desks are out). */
function classifyPlane(plane: XRPlaneNative, poseY: number): SurfaceKind | null {
  if (plane.orientation === 'vertical') return 'wall';
  if (plane.orientation !== 'horizontal') return null;
  const label = (plane.semanticLabel ?? '').toLowerCase();
  if (label.includes('floor')) return 'floor';
  if (label.includes('ceiling')) return 'ceiling';
  if (label) return null; // a labelled table/desk/couch — furniture, out
  if (poseY < 0.25) return 'floor';
  if (poseY > 2.05) return 'ceiling';
  return null;
}

function polygonShape(polygon: ArrayLike<{ x: number; z: number }>): PlaneShape | null {
  if (!polygon || polygon.length < 3) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i];
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  if (!Number.isFinite(minX) || maxX - minX < 0.2 || maxZ - minZ < 0.2) return null;
  return { minX, maxX, minZ, maxZ };
}
