/**
 * PlacementSystem — the one thing YOU put on a wall.
 *
 * When a run is in 'place', the flange's hologram rides the right
 * controller's ray: aim anywhere on a wall and the ghost stands there,
 * upright on the plaster, with its reticle breathing under it. The aim is
 * FORGIVING by construction — a hit anywhere near a wall's face clamps
 * into the mount band (edge insets, hand-reach heights; see
 * room/walls.ts), so the reticle is always somewhere legal and the
 * trigger is always a yes.
 *
 * The trigger stamps the flange on — THE WORKS answers from inside
 * another wall (knock knock), the socket irises awake where the knocks
 * came from, and the run hands over to the pull. The socket's spot is
 * picked the moment the flange lands, seeded, so a tool can replay a
 * layout exactly (see pickSocket).
 *
 * This system owns only the aiming ghosts; the real hardware belongs to
 * TubeSystem the moment the mount lands.
 */

import { intents } from '../input/intents.js';
import { createSystem } from '@iwsdk/core';
import { Quaternion, Vector3 } from 'three';
import { JOBS, PORTS, RUN_RANGE, WAKE } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { buzz } from '../game/haptics.js';
import { mix } from '../game/rng.js';
import { site } from '../game/state.js';
import {
  clampToBand,
  mountBand,
  mountQuaternion,
  pickSocket,
  pointOn,
  usable,
  type Wall,
} from '../room/walls.js';
import { buildHologram, type HologramRefs } from '../tube/build.js';
import { PointerRay } from '../ui/pointer.js';
import { walls } from './WallSystem.js';

/** Headless/dev hooks (wired into __tubes in main.ts). */
export const placeView: {
  /** What the reticle is on right now: wall id + band point, or null. */
  aim?: () => { wall: number; point: { x: number; y: number; z: number } } | null;
  /** The headless mount: wall-local (u, v), clamped into the band. */
  mountAt?: (wallId: number, u: number, v: number) => boolean;
} = {};

const _origin = new Vector3();
const _dir = new Vector3();
const _hit = new Vector3();
const _clamped = new Vector3();
const _feet = new Vector3();
const _quat = new Quaternion();

export class PlacementSystem extends createSystem({}) {
  private holo: HologramRefs | null = null;
  private holoLine = '';
  private pointer!: PointerRay;
  private clock = 0;
  /** The current aim, refreshed every placing frame. */
  private aimWall: Wall | null = null;
  private aimPoint = new Vector3();
  private lastGeneration = -1;

  init(): void {
    this.pointer = new PointerRay(this.scene);

    placeView.aim = () =>
      this.aimWall
        ? {
            wall: this.aimWall.id,
            point: { x: this.aimPoint.x, y: this.aimPoint.y, z: this.aimPoint.z },
          }
        : null;
    placeView.mountAt = (wallId, u, v) => {
      const run = this.placingRun();
      const wall = walls.find((w) => w.id === wallId);
      if (!run || !wall || wall.kind !== 'wall') return false;
      const band = mountBand(wall);
      if (!band) return false;
      const uu = Math.max(-band.u, Math.min(band.u, u));
      const vv = Math.max(band.vLo, Math.min(band.vHi, v));
      this.mount(wall, pointOn(wall, uu, vv, _clamped));
      return true;
    };
  }

  private placingRun(): (typeof site.runs)[number] | null {
    if (site.screen !== 'shift' || site.activeRun < 0) return null;
    const run = site.runs[site.activeRun];
    return run && run.phase === 'place' ? run : null;
  }

  update(delta: number): void {
    this.clock += delta;

    // A new shift (or a re-deal) drops any ghost from the last one.
    if (this.lastGeneration !== site.generation) {
      this.lastGeneration = site.generation;
      this.dropHologram();
    }

    // The wake clock lives here too: it's placement theatre — the room
    // answering — and the hand-over to the pull when it's done.
    this.tickWake(delta);

    // Under the JOB CARD the hands belong to the card, not the walls.
    const run = this.placingRun();
    if (!run || !site.wallsReady || site.paused) {
      this.dropHologram();
      this.pointer.hide();
      this.aimWall = null;
      return;
    }

    // The right hand aims. (The left keeps the board's laser habits — a
    // one-hand job stays one-handed.)
    const rayObj = this.world.playerSpaceEntities?.raySpaces?.right?.object3D;
    if (!rayObj) {
      this.pointer.hide();
      this.aimWall = null;
      return;
    }
    rayObj.getWorldPosition(_origin);
    rayObj.getWorldDirection(_dir).negate();

    this.aimWall = this.castAtWalls(_origin, _dir);
    if (!this.aimWall) {
      this.pointer.update(delta, _origin, null, false);
      this.hideHologram();
      return;
    }

    // The ghost stands where the mount would.
    const holo = this.ensureHologram(run.line.id);
    holo.group.visible = true;
    holo.group.position.copy(this.aimPoint);
    holo.group.quaternion.copy(mountQuaternion(this.aimWall, _quat));
    // The reticle breathes — alive, not alarmed.
    const breathe = 0.5 + 0.5 * Math.sin(this.clock * 3.2);
    holo.ringMat.opacity = 0.24 + 0.18 * breathe;
    holo.mat.opacity = 0.16 + 0.08 * breathe;

    this.pointer.update(delta, _origin, this.aimPoint, true);

    if (intents.right.point.down) {
      this.pointer.click();
      this.mount(this.aimWall, this.aimPoint);
    }
  }

  /** Nearest usable wall the ray approaches face-on; the hit is clamped
   *  into the wall's mount band before anyone else sees it. */
  private castAtWalls(origin: Vector3, dir: Vector3): Wall | null {
    let best: Wall | null = null;
    let bestT = Infinity;
    for (const w of walls) {
      // Flanges are WALL hardware — the floor and ceiling answer runs,
      // they don't take mounts. (The room's half gets adventurous; the
      // half you were taught stays where you were taught it.)
      if (w.kind !== 'wall' || !usable(w)) continue;
      const facing = dir.dot(w.normal);
      if (facing > -1e-4) continue; // approaching from behind (or parallel)
      const t =
        _hit.copy(w.center).sub(origin).dot(w.normal) / facing;
      if (t < 0.05 || t > 9 || t >= bestT) continue;
      _hit.copy(origin).addScaledVector(dir, t);
      // Anywhere NEAR the face counts; the band clamp does the rest. The
      // margin keeps a ray off one wall from stealing through a corner.
      const local = _clamped.copy(_hit).sub(w.center);
      if (Math.abs(local.dot(w.right)) > w.halfW + 0.4) continue;
      if (Math.abs(local.dot(w.up)) > w.halfH + 0.4) continue;
      const clamped = clampToBand(w, _hit, _clamped);
      if (!clamped) continue;
      best = w;
      bestT = t;
      this.aimPoint.copy(clamped);
    }
    return best;
  }

  /* ── the mount ────────────────────────────────────────────────────────── */

  private mount(wall: Wall, point: Vector3): void {
    const run = this.placingRun();
    if (!run) return;
    run.wallA = wall.id;
    run.pointA.copy(point);
    run.normalA.copy(wall.normal);

    // The room answers NOW (seeded per run), so the wake theatre already
    // knows which wall to knock on.
    const seed = mix(site.seed, site.activeRun, 17);
    const longHaul = Boolean(JOBS[site.jobIndex]?.longHaul);
    // Own scratch, and it matters: `point` often IS _clamped (the
    // headless mount hands it over), and reading the camera into that
    // vector here once re-aimed the whole picker at the player's head —
    // every range, facing and alignment measured from the wrong place.
    const eye = this.camera.getWorldPosition(_feet);
    // Where the fitter stands, and how high they can honestly work: no
    // port wakes above the hands (PORTS.overheadReach), which is what
    // keeps the room from answering on a ceiling nobody can reach.
    const fitter = { x: eye.x, z: eye.z, reachY: eye.y + PORTS.overheadReach };
    const spot =
      pickSocket(walls, wall.id, point, wall.normal, seed, longHaul, fitter) ??
      this.lastResort(wall, point, fitter.reachY);
    if (!spot) {
      // No legal answer anywhere (a broom-cupboard scan). Stay placing —
      // the player can try a wall with more room across from it.
      sfx.oneHandRattle();
      return;
    }
    run.wallB = spot.wall.id;
    run.pointB.copy(spot.point);
    run.normalB.copy(spot.normal);

    run.phase = 'wake';
    run.phaseT = 0;
    site.fx.push({ kind: 'mount', runIndex: site.activeRun });
    sfx.mountThunk();
    sfx.boltSpin();
    buzz(this.world, 'right', 0.7, 60);
    this.dropHologram();
    this.pointer.hide();
  }

  /** When the picker finds nothing legal: the farthest band point on any
   *  other usable wall, range be damned — a short run beats no job. The
   *  reach law still holds, though: a fallback the hands can't get to is
   *  not a fallback, it's a dead job. */
  private lastResort(
    mountWall: Wall,
    mountPoint: Vector3,
    reachY: number,
  ): ReturnType<typeof pickSocket> {
    let best: { wall: Wall; point: Vector3 } | null = null;
    let bestD = RUN_RANGE.min * 0.6; // still never closer than a stride
    for (const w of walls) {
      if (w.id === mountWall.id || !usable(w)) continue;
      const band = mountBand(w);
      if (!band) continue;
      const p = pointOn(w, 0, (band.vLo + band.vHi) / 2, new Vector3());
      if (p.y > reachY) continue;
      const d = p.distanceTo(mountPoint);
      if (d > bestD) {
        bestD = d;
        best = { wall: w, point: p };
      }
    }
    return best ? { wall: best.wall, point: best.point, normal: best.wall.normal.clone() } : null;
  }

  /* ── the wake ─────────────────────────────────────────────────────────── */

  private tickWake(delta: number): void {
    if (site.screen !== 'shift') return;
    for (let i = 0; i < site.runs.length; i++) {
      const run = site.runs[i];
      if (run.phase !== 'wake') continue;
      const before = run.phaseT;
      run.phaseT += delta;
      if (before < WAKE.knockAt && run.phaseT >= WAKE.knockAt) sfx.wallKnock();
      if (before < WAKE.socketAt && run.phaseT >= WAKE.socketAt) {
        sfx.socketWake();
        site.fx.push({ kind: 'wake', runIndex: i });
      }
      if (run.phaseT >= WAKE.doneAt) {
        run.phase = 'pull';
        run.phaseT = 0;
      }
    }
  }

  /* ── the ghost ────────────────────────────────────────────────────────── */

  private ensureHologram(lineId: string): HologramRefs {
    if (this.holo && this.holoLine === lineId) return this.holo;
    this.dropHologram();
    const run = this.placingRun();
    this.holo = buildHologram(run!.line);
    this.holoLine = lineId;
    this.scene.add(this.holo.group);
    return this.holo;
  }

  private hideHologram(): void {
    if (this.holo) this.holo.group.visible = false;
  }

  private dropHologram(): void {
    if (!this.holo) return;
    this.holo.group.removeFromParent();
    this.holo.mat.dispose();
    this.holo.ringMat.dispose();
    this.holo = null;
    this.holoLine = '';
  }
}
