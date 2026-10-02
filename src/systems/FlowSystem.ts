/**
 * FlowSystem — the payoff. Everything after the latch dogs is this file:
 *
 *  CHARGE — a held breath (FLOW.chargeS): the hardware wakes, the pour
 *  volumes light dim inside the shells, a riser climbs. Anticipation is
 *  the cheapest special effect there is.
 *
 *  THE POUR — the front races the run at the line's own speed, a hot
 *  band burning behind its face (materials/flow.ts does the pixels; this
 *  system just moves one number per run).
 *
 *  ARRIVAL — the front lands in the socket and the room gets paid: a
 *  burst of lens glints off the socket mouth, the line's chord, the hum
 *  settling in — and THE SHAFT: a ramped light cone firing straight
 *  out of the socket's mouth with dust motes drifting in it, sunlight
 *  out of a wall that never had a window. Passthrough sells this harder
 *  than any void could: the light lands in YOUR room.
 *
 *  CEREMONY — the job's last run landed: every pour surges, every halo
 *  leans in, the room chord plays, and after CEREMONY_S the board comes
 *  back with the sheet stamped (game/flow.ts owns the screen change).
 *
 * This system also breathes the idle hardware halos — flanges and
 * sockets are plant, and plant at readiness never reads as dead.
 */

import { createSystem } from '@iwsdk/core';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Points,
  Vector3,
} from 'three';
import { CEREMONY_S, FLOW } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { buzz } from '../game/haptics.js';
import { ceremonyDone, runLanded } from '../game/flow.js';
import { site } from '../game/state.js';
import { beamGradientTexture, glintTexture, sizedPointsMaterial } from '../materials/glow.js';
import { runHardware } from './TubeSystem.js';

/** Headless/dev hooks (wired into __tubes in main.ts). */
export const flowView: {
  progress?: () => Array<{ phase: string; front: number; length: number; energy: number }>;
} = {};

interface Bloom {
  points: Points;
  velocities: Float32Array;
  life: number;
}

interface Shaft {
  cone: Mesh;
  motes: Points;
  axis: Vector3;
  origin: Vector3;
  /** Per-mote distance along the axis (recycled at the far end). */
  travel: Float32Array;
  sway: Float32Array;
}

const _axis = new Vector3();
const _pos = new Vector3();
const UP_Y = new Vector3(0, 1, 0);

export class FlowSystem extends createSystem({}) {
  private clock = 0;
  private lastGeneration = -1;
  private blooms: Bloom[] = [];
  private shafts = new Map<number, Shaft>();
  /** Per-run energy (0..1), eased — drives pour + halos together. */
  private energy: number[] = [];
  private ceremonySurge = 0;

  init(): void {
    flowView.progress = () =>
      site.runs.map((r, i) => ({
        phase: r.phase,
        front: r.front,
        length: r.extension,
        energy: this.energy[i] ?? 0,
      }));
  }

  update(delta: number): void {
    this.clock += delta;

    if (this.lastGeneration !== site.generation) {
      this.lastGeneration = site.generation;
      this.teardownFx();
    }

    this.drainFx();
    this.tickRuns(delta);
    this.tickBlooms(delta);
    this.tickShafts(delta);
    this.tickCeremony(delta);
  }

  /* ── the bus ──────────────────────────────────────────────────────────── */

  private drainFx(): void {
    for (const ev of site.fx.splice(0)) {
      const hw = runHardware[ev.runIndex];
      if (ev.kind === 'seat') {
        sfx.chargeRise(FLOW.chargeS);
        if (hw) for (const seg of hw.segments) seg.pour.visible = seg.shell.visible;
      } else if (ev.kind === 'ceremony') {
        sfx.ceremonyChord();
        this.ceremonySurge = 1;
      }
      // 'mount' and 'wake' land their pops through the halo breathing
      // below (phaseT is fresh, so the flash term is at its peak).
    }
  }

  /* ── the runs ─────────────────────────────────────────────────────────── */

  private tickRuns(delta: number): void {
    for (let i = 0; i < site.runs.length; i++) {
      const run = site.runs[i];
      const hw = runHardware[i];
      if (!hw) continue;

      // phaseT means "seconds since the phase changed" everywhere; the
      // phases nobody else clocks are clocked here.
      if (run.phase === 'pull' || run.phase === 'flowing') run.phaseT += delta;

      // Energy: dormant → charged, eased both ways.
      let targetEnergy = 0;
      if (run.phase === 'seated') {
        run.phaseT += delta;
        targetEnergy = Math.min(1, run.phaseT / FLOW.chargeS);
        if (run.phaseT >= FLOW.chargeS && run.front < 0) run.front = 0.001;
      } else if (run.phase === 'flowing') {
        targetEnergy = 1;
      }
      const e = (this.energy[i] ??= 0);
      this.energy[i] = e + (targetEnergy - e) * (1 - Math.exp(-delta * 6));

      // The front races the run.
      if (run.phase === 'seated' && run.front >= 0) {
        run.front += run.line.flowSpeed * delta;
        if (run.front >= run.extension) {
          run.front = run.extension + 10; // past every span forever
          run.phase = 'flowing';
          run.phaseT = 0;
          this.arrive(i);
        }
      }

      // Feed every pour volume its shared numbers.
      const surge = 1 + this.ceremonySurge * 0.35;
      for (const seg of hw.segments) {
        const u = seg.pourMat.uniforms;
        u.uTime.value = this.clock;
        u.uFront.value = run.front;
        u.uEnergy.value = Math.min(1.2, this.energy[i] * surge);
      }

      // Halos: plant at readiness breathes; fresh events flash (phaseT
      // is seconds since the last phase change, so young states run hot).
      const breathe = 0.5 + 0.5 * Math.sin(this.clock * 2.2 + i * 1.7);
      const flash = Math.max(0, 1 - run.phaseT * 1.6);
      const en = this.energy[i];
      hw.flange.glowMat.opacity = 0.18 + 0.14 * breathe + 0.3 * en + 0.3 * flash * (run.phase === 'wake' ? 1 : 0);
      hw.socket.glowMat.opacity =
        Math.min(1, 0.16 + 0.12 * breathe + 0.4 * en
          + (run.phase === 'wake' || run.phase === 'seated' || run.phase === 'flowing' ? 0.4 * flash : 0));
    }
  }

  /* ── arrival ──────────────────────────────────────────────────────────── */

  private arrive(runIndex: number): void {
    const run = site.runs[runIndex];
    const hw = runHardware[runIndex];
    sfx.flowArrive(run.line.id);
    sfx.startHum(`run${runIndex}`, run.line.id, run.line.pulseHz);
    buzz(this.world, 'both', 0.5, 120);
    if (hw) {
      this.spawnBloom(run.pointB, run.normalB, run.line.glow);
      this.spawnShaft(runIndex, run.pointB, run.normalB, run.line.glow);
    }
    site.fx.push({ kind: 'arrive', runIndex });
    runLanded(runIndex);
    // runLanded may have started the ceremony — drain it next frame.
  }

  /** A burst of lens glints off the socket mouth. */
  private spawnBloom(at: Vector3, normal: Vector3, color: number): void {
    const n = FLOW.bloomCount;
    const geo = new BufferGeometry();
    const pos = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = at.x;
      pos[i * 3 + 1] = at.y;
      pos[i * 3 + 2] = at.z;
      // Mostly outward along the normal, scattered wide — a splash of
      // light off a wall, not a firework.
      _axis
        .set(
          normal.x + (Math.random() - 0.5) * 1.4,
          normal.y + (Math.random() - 0.2) * 1.2,
          normal.z + (Math.random() - 0.5) * 1.4,
        )
        .normalize();
      const speed = 0.5 + Math.random() * 1.4;
      vel[i * 3] = _axis.x * speed;
      vel[i * 3 + 1] = _axis.y * speed;
      vel[i * 3 + 2] = _axis.z * speed;
      // A population: dust, grains, the odd hero catch.
      const r = Math.random();
      sizes[i] = r < 0.72 ? 0.4 + r : r < 0.94 ? 1.4 : 2.6;
    }
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new BufferAttribute(sizes, 1));
    const mat = sizedPointsMaterial({
      map: glintTexture(),
      color: new Color(color).lerp(new Color(0xffffff), 0.35),
      size: 0.05,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new Points(geo, mat);
    points.renderOrder = 20;
    points.frustumCulled = false;
    this.scene.add(points);
    this.blooms.push({ points, velocities: vel, life: 0 });
  }

  private tickBlooms(delta: number): void {
    for (let b = this.blooms.length - 1; b >= 0; b--) {
      const bloom = this.blooms[b];
      bloom.life += delta;
      const t = bloom.life / FLOW.bloomLifeS;
      if (t >= 1) {
        bloom.points.removeFromParent();
        bloom.points.geometry.dispose();
        (bloom.points.material as MeshBasicMaterial).dispose();
        this.blooms.splice(b, 1);
        continue;
      }
      const pos = bloom.points.geometry.getAttribute('position') as BufferAttribute;
      const vel = bloom.velocities;
      for (let i = 0; i < pos.count; i++) {
        // Drift out, ease off, die in the air — never litter on the floor.
        const damp = Math.exp(-1.9 * delta);
        vel[i * 3] *= damp;
        vel[i * 3 + 1] = vel[i * 3 + 1] * damp - 0.25 * delta;
        vel[i * 3 + 2] *= damp;
        pos.setXYZ(
          i,
          pos.getX(i) + vel[i * 3] * delta,
          pos.getY(i) + vel[i * 3 + 1] * delta,
          pos.getZ(i) + vel[i * 3 + 2] * delta,
        );
      }
      pos.needsUpdate = true;
      (bloom.points.material as { opacity: number }).opacity = 1 - t * t;
    }
  }

  /* ── the shaft ────────────────────────────────────────────────────────── */

  private spawnShaft(runIndex: number, at: Vector3, normal: Vector3, color: number): void {
    if (this.shafts.has(runIndex)) return;
    // Straight out of the socket's mouth, every surface alike — a wall
    // port throws its light level across the room, the floor's rises,
    // the ceiling's pours straight down. (This used to lean every shaft
    // downward for "sunlight", which read beautifully from the floor —
    // where the lean happened to normalise to dead-centre — and droopy
    // from every wall. The centred one WAS the good one; now they all
    // are. The sun flavour lives in the ramp and the motes, not a sag.)
    const axis = normal.clone().normalize();
    const len = FLOW.shaftLength;

    const cone = new Mesh(
      new CylinderGeometry(0.07, FLOW.shaftRadius, len, 20, 1, true),
      new MeshBasicMaterial({
        map: beamGradientTexture(true),
        color: new Color(color).lerp(new Color(0xfff6e0), 0.55),
        transparent: true,
        opacity: 0.34,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide, // you will stand inside this light
      }),
    );
    cone.position.copy(at).addScaledVector(axis, len / 2);
    cone.quaternion.setFromUnitVectors(UP_Y, _axis.copy(axis).negate());
    cone.renderOrder = 14;
    this.scene.add(cone);

    // The motes: what makes it SUN and not a spotlight gel.
    const n = FLOW.moteCount;
    const geo = new BufferGeometry();
    const pos = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const travel = new Float32Array(n);
    const sway = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      travel[i] = Math.random() * len;
      sway[i] = Math.random() * Math.PI * 2;
      sizes[i] = 0.35 + Math.random() * (Math.random() < 0.9 ? 0.8 : 2);
    }
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new BufferAttribute(sizes, 1));
    const motes = new Points(
      geo,
      sizedPointsMaterial({
        map: glintTexture(),
        color: new Color(color).lerp(new Color(0xffffff), 0.6),
        size: 0.028,
        transparent: true,
        opacity: 0.7,
        blending: AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    motes.renderOrder = 21;
    motes.frustumCulled = false;
    this.scene.add(motes);

    this.shafts.set(runIndex, { cone, motes, axis, origin: at.clone(), travel, sway });
  }

  private tickShafts(delta: number): void {
    for (const shaft of this.shafts.values()) {
      const pos = shaft.motes.geometry.getAttribute('position') as BufferAttribute;
      const len = FLOW.shaftLength;
      for (let i = 0; i < pos.count; i++) {
        shaft.travel[i] += delta * (0.1 + 0.06 * Math.sin(shaft.sway[i]));
        shaft.sway[i] += delta * (0.6 + (i % 5) * 0.13);
        if (shaft.travel[i] > len) shaft.travel[i] = 0.05;
        const t = shaft.travel[i];
        const spread = 0.05 + (FLOW.shaftRadius - 0.08) * (t / len);
        const a = shaft.sway[i];
        _pos
          .copy(shaft.origin)
          .addScaledVector(shaft.axis, t)
          .add(
            _axis
              .set(Math.cos(a) * spread, Math.sin(a * 0.7) * spread * 0.6, Math.sin(a) * spread)
          );
        pos.setXYZ(i, _pos.x, _pos.y, _pos.z);
      }
      pos.needsUpdate = true;
      // The shaft breathes with the room.
      const breathe = 0.5 + 0.5 * Math.sin(this.clock * 0.9);
      (shaft.cone.material as MeshBasicMaterial).opacity =
        (0.3 + 0.08 * breathe) * (1 + this.ceremonySurge * 0.5);
    }
  }

  /* ── ceremony ─────────────────────────────────────────────────────────── */

  private tickCeremony(delta: number): void {
    this.ceremonySurge = Math.max(0, this.ceremonySurge - delta / CEREMONY_S);
    if (site.screen !== 'ceremony') return;
    site.ceremonyT -= delta;
    if (site.ceremonyT <= 0) ceremonyDone();
  }

  /* ── teardown ─────────────────────────────────────────────────────────── */

  private teardownFx(): void {
    for (const bloom of this.blooms) {
      bloom.points.removeFromParent();
      bloom.points.geometry.dispose();
      (bloom.points.material as MeshBasicMaterial).dispose();
    }
    this.blooms = [];
    for (const shaft of this.shafts.values()) {
      shaft.cone.removeFromParent();
      shaft.cone.geometry.dispose();
      (shaft.cone.material as MeshBasicMaterial).dispose();
      shaft.motes.removeFromParent();
      shaft.motes.geometry.dispose();
      (shaft.motes.material as MeshBasicMaterial).dispose();
    }
    this.shafts.clear();
    this.energy = [];
    this.ceremonySurge = 0;
  }
}
