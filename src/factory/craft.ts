/**
 * THE CRAFT THEATRE — every item is made in its own way, in front of you.
 *
 * A maker used to bob a piston on a sine wave for four seconds and then a
 * part popped onto the chute, whatever the part was; a combiner dipped
 * its clamp the same way for six. Nothing about the motion said WHAT was
 * being made, and the one moment that did — the pop — was over in a
 * third of a second. This module gives each of the six items its own
 * making, timed to the sim's own craft progress (0..1, so QUICK BOXES
 * and the tools' fast-forward just play it faster) and staged on the
 * machine's own hardware:
 *
 *   GEAR   is STRUCK  — a molten slug on the anvil, three hammer blows
 *                       from the ram, sparks off each, the plates spread
 *                       and the teeth index a third of a pitch per blow,
 *                       the glow cools to iron
 *   CELL   is DRAWN   — the canister extrudes up out of the die under a
 *                       raised ram, the ram comes down and PRESSES the
 *                       caps on with a hydraulic sigh, then the charge
 *                       band lights and pulses full
 *   CHIP   is ETCHED  — a wafer on an indexing table under a scriber:
 *                       six clicks round, the probe dipping on each, the
 *                       traces growing a sixth at a time, then the pin
 *                       pressed in with a snap of arc
 *   PUMP   is SCREWED — the gear slides in, the cell arcs in over it and
 *                       SCREWS down onto it, four turns, then the clamp
 *                       presses the union
 *   LAMP   is KINDLED — the chip is lowered onto the cell as a crown,
 *                       tapped home, then the filament flickers twice
 *                       and comes on to stay
 *   SERVO  is TORQUED — lamp onto pump, clamped, and the stack indexed a
 *                       quarter turn four times under the press — one
 *                       bolt per line, the flash cycling amber, cyan,
 *                       violet, white — then run in: it spins up and
 *                       brakes
 *
 * and every one ends the same way: the finished thing slides forward to
 * the exact chute slot the sim will stand it on, turning into the spin
 * the real part will be born with, so the swap from ghost to part is a
 * hand-off and not a cut.
 *
 * Makers form a PHANTOM — the item's own kit (units.partKit), rendered
 * through FactorySystem's instanced pools with the per-component matrices
 * this file writes, so a molten slug and a finished gear cost the same
 * draw calls as a gear on a rail. Combiners animate the two REAL parts
 * sitting in their ports (the sim leaves them there until the craft
 * lands): this file hands FactorySystem a pose per port and the parts
 * walk in, meet and fit. Nothing here reads a controller or a speaker —
 * cues go out through a callback and FactorySystem plays them.
 */

import { Matrix4, Quaternion, Vector3, type Mesh, type MeshBasicMaterial, type Object3D, type Points, type PointsMaterial } from 'three';
import { LINES, type ItemId } from '../config.js';
import { CHUTE_Y, PORT_REACH, chuteY } from './sim.js';
import { SPARKS, partKit } from './units.js';

export type CraftCue =
  | 'strike'
  | 'press'
  | 'charge'
  | 'etch'
  | 'pin'
  | 'thread'
  | 'seat'
  | 'torque'
  | 'spark'
  | 'lit'
  | 'spin';

/** Everything a rig owns: the hardware units.ts built for it, and the
 *  live state this file carries across frames. */
export interface CraftRig {
  kind: 'maker' | 'combiner';
  /** The ram (maker) or the clamp bar (combiner); lifted off `headBase`. */
  head: Object3D;
  headBase: number;
  /** Where a part forms — the anvil top, or the lobe tops (m up). */
  stageY: number;
  glow: Mesh;
  glowMat: MeshBasicMaterial;
  flash: Mesh;
  flashMat: MeshBasicMaterial;
  flashSize: number;
  /** The additive shell round the work (a unit open cylinder). */
  heat: Mesh;
  heatMat: MeshBasicMaterial;
  sparks: Points;
  sparkMat: PointsMaterial;
  sparkPos: Float32Array;
  sparkVel: Float32Array;
  /** The item being (or last) made — remembered so a maker whose line
   *  was pulled mid-craft still shows the thing it was making. */
  item: ItemId | null;
  lastP: number;
  /** Seconds since the flash ring / the spark burst was struck. */
  flashT: number;
  sparkT: number;
  /** The phantom's per-component matrices (unit-local, kit local
   *  folded in), and how many are live this frame. */
  phantom: Matrix4[];
  phantomN: number;
  /** The combiner's two port parts, posed (unit-local), when `portOn`. */
  portPose: [Matrix4, Matrix4];
  portOn: boolean;
}

export interface CraftContext {
  dt: number;
  clock: number;
  /** The chute slot the finished part will stand on (unit-local Z). */
  slotZ: number;
  /** No slot free — hold the finished thing on the stage instead. */
  chuteFull: boolean;
  /** The idle spin the real part will be born with (the sim's next id
   *  is known before it spawns), so the ghost can turn into it. */
  spinTarget: number;
  /** Combiner: what sits in each port, and the idle spin each part is
   *  turning with — the choreography takes over from that, smoothly. */
  ports: [ItemId | null, ItemId | null];
  portSpin: [number, number];
  cue: (cue: CraftCue, n: number) => void;
}

/* ── the parts' measurements ──────────────────────────────────────────────
 * Read off the kits in units.ts: how far a part's origin sits above its
 * lowest point (so it can rest on a stage) and below its highest (so
 * something can rest on it).
 */
const REST: Record<ItemId, number> = {
  gear: 0.017,
  cell: 0.037,
  chip: 0.012,
  pump: 0.033,
  lamp: 0.036,
  servo: 0.044,
};
const TOP: Record<ItemId, number> = {
  gear: 0.017,
  cell: 0.037,
  chip: 0.0135,
  pump: 0.059,
  lamp: 0.0545,
  servo: 0.074,
};
/** Which ingredient is the BODY of a fitting; the other is the crown
 *  that comes down onto it. (The kits agree: a pump is a gear-body with
 *  a cell-throat, a lamp a cell with a chip-crown, a servo a pump under
 *  a lamp.) */
const BASE: Partial<Record<ItemId, ItemId>> = { pump: 'gear', lamp: 'cell', servo: 'pump' };

const AMBER = LINES.mains.glow;
const CYAN = LINES.coolant.glow;
const VIOLET = LINES.volt.glow;
const WHITE = 0xfff4e2;

/* ── timing helpers ─────────────────────────────────────────────────────── */

const seg = (p: number, a: number, b: number): number =>
  Math.min(1, Math.max(0, (p - a) / (b - a)));
const smooth = (t: number): number => t * t * (3 - 2 * t);
const easeOut = (t: number): number => 1 - (1 - t) ** 3;
const easeIn = (t: number): number => t * t * t;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const TAU = Math.PI * 2;
/** The shortest way round from yaw `a` to yaw `b`. */
function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}

const _pos = new Vector3();
const _scl = new Vector3();
const _q = new Quaternion();
const _m = new Matrix4();
const _mo = new Matrix4();
const UP = new Vector3(0, 1, 0);

/** Per-component tweak on top of the whole-part pose. */
interface CompTweak {
  dy: number;
  ry: number;
  sx: number;
  sy: number;
  sz: number;
}
const _tweak: CompTweak = { dy: 0, ry: 0, sx: 1, sy: 1, sz: 1 };
const resetTweak = (): CompTweak => {
  _tweak.dy = 0;
  _tweak.ry = 0;
  _tweak.sx = 1;
  _tweak.sy = 1;
  _tweak.sz = 1;
  return _tweak;
};

/** Write the phantom: the item's kit at (pos, yaw, scale), each
 *  component through `tweak(c)` first. */
function writePhantom(
  rig: CraftRig,
  item: ItemId,
  yaw: number,
  tweak: (c: number, t: CompTweak) => void,
): void {
  const kit = partKit(item);
  _q.setFromAxisAngle(UP, yaw);
  _m.compose(_pos, _q, _scl);
  for (let c = 0; c < kit.length && c < rig.phantom.length; c++) {
    const t = resetTweak();
    tweak(c, t);
    _q.setFromAxisAngle(UP, t.ry);
    _mo.compose(_pos.set(0, t.dy, 0), _q, _scl.set(t.sx, t.sy, t.sz));
    rig.phantom[c].multiplyMatrices(_m, _mo).multiply(kit[c].local);
  }
  rig.phantomN = Math.min(kit.length, rig.phantom.length);
}

/* ── the effects ────────────────────────────────────────────────────────── */

function setLift(rig: CraftRig, lift: number): void {
  rig.head.position.y = rig.headBase + lift;
}

/** The heat shell round the work: centre (unit-local), radius, height. */
function heatAt(
  rig: CraftRig,
  x: number,
  y: number,
  z: number,
  r: number,
  h: number,
  color: number,
  opacity: number,
): void {
  rig.heat.visible = opacity > 0.01;
  if (!rig.heat.visible) return;
  rig.heat.position.set(x, y, z);
  rig.heat.scale.set(r, h, r);
  rig.heatMat.color.setHex(color);
  rig.heatMat.opacity = Math.min(1, opacity);
}

/** How much of a struck flash is still lighting the work (1 → 0). */
const afterglow = (rig: CraftRig, dur = 0.25): number =>
  rig.flashT < dur ? 1 - rig.flashT / dur : 0;

function flash(rig: CraftRig, color: number, size: number): void {
  rig.flashT = 0;
  rig.flashSize = size;
  rig.flashMat.color.setHex(color);
}

function burst(rig: CraftRig, color: number, count: number, up: number): void {
  rig.sparkT = 0;
  rig.sparkMat.color.setHex(color);
  const p = rig.sparkPos;
  const v = rig.sparkVel;
  for (let n = 0; n < SPARKS; n++) {
    const live = n < count;
    const a = Math.random() * TAU;
    const r = live ? 0.25 + Math.random() * 0.55 : 0;
    p[n * 3] = (Math.random() - 0.5) * 0.02;
    p[n * 3 + 1] = rig.stageY + 0.02 + (live ? 0 : -50); // the rest sit out of sight
    p[n * 3 + 2] = (Math.random() - 0.5) * 0.02;
    v[n * 3] = Math.cos(a) * r;
    v[n * 3 + 1] = live ? up * (0.5 + Math.random()) : 0;
    v[n * 3 + 2] = Math.sin(a) * r;
  }
}

/** Advance the flash ring and the spark cloud — every craft's shared
 *  afterglow, ticked whether or not a craft is running. */
function tickFx(rig: CraftRig, dt: number): void {
  if (rig.flashT < 0.35) {
    const t = rig.flashT / 0.35;
    rig.flash.visible = true;
    rig.flash.scale.setScalar(rig.flashSize * (0.35 + 0.65 * easeOut(t)));
    rig.flashMat.opacity = 0.9 * (1 - t) * (1 - t);
    rig.flashT += dt;
  } else if (rig.flash.visible) {
    rig.flash.visible = false;
  }
  if (rig.sparkT < 0.7) {
    const t = rig.sparkT / 0.7;
    rig.sparks.visible = true;
    rig.sparkMat.opacity = (1 - t) ** 1.5;
    const p = rig.sparkPos;
    const v = rig.sparkVel;
    for (let n = 0; n < SPARKS; n++) {
      v[n * 3 + 1] -= 4 * dt;
      p[n * 3] += v[n * 3] * dt;
      p[n * 3 + 1] += v[n * 3 + 1] * dt;
      p[n * 3 + 2] += v[n * 3 + 2] * dt;
      // Sparks bounce once off the bench and die there.
      if (p[n * 3 + 1] < rig.stageY - 0.02 && p[n * 3 + 1] > -1) {
        p[n * 3 + 1] = rig.stageY - 0.02;
        v[n * 3 + 1] *= -0.3;
      }
    }
    rig.sparks.geometry.getAttribute('position').needsUpdate = true;
    rig.sparkT += dt;
  } else if (rig.sparks.visible) {
    rig.sparks.visible = false;
  }
  rig.glow.visible = rig.glowMat.opacity > 0.01;
}

/** Did this frame's progress step over `t`? Cues fire on the crossing,
 *  so a craft played at any speed fires each exactly once. */
const crossed = (rig: CraftRig, p: number, t: number): boolean => rig.lastP < t && p >= t;

/* ── the tick ───────────────────────────────────────────────────────────── */

/**
 * One frame of the theatre on one machine. `item` is what it is making
 * (null = nothing to make), `p` its craft progress (−1 = idle; the sim
 * holds 1 while a finished part waits for chute room).
 */
export function tickCraft(rig: CraftRig, item: ItemId | null, p: number, ctx: CraftContext): void {
  const dt = ctx.dt;
  if (item) rig.item = item;
  rig.phantomN = 0;
  rig.portOn = false;

  if (p < 0 || !rig.item) {
    // Idle: the head settles home, the stage goes dark.
    rig.head.position.y += (rig.headBase - rig.head.position.y) * (1 - Math.exp(-dt * 8));
    rig.glowMat.opacity *= Math.exp(-dt * 6);
    rig.heat.visible = false;
    rig.lastP = -1;
    tickFx(rig, dt);
    return;
  }

  // A fresh craft starting while the last flash is still fading: fine —
  // only the crossings care, and lastP resets with the progress.
  if (p < rig.lastP) rig.lastP = -1;

  if (rig.kind === 'maker') {
    if (rig.item === 'gear') gearStruck(rig, p, ctx);
    else if (rig.item === 'cell') cellDrawn(rig, p, ctx);
    else chipEtched(rig, p, ctx);
  } else if (rig.item === 'pump') combine(rig, p, ctx, pumpScrewed);
  else if (rig.item === 'lamp') combine(rig, p, ctx, lampKindled);
  else combine(rig, p, ctx, servoTorqued);

  rig.lastP = p;
  tickFx(rig, dt);
}

/* ── the eject: every maker craft ends the same way ─────────────────────── */

/** Where the phantom stands as the craft ends: on the stage until 0.88,
 *  then sliding forward onto its chute slot (or holding on the stage
 *  when the chute is full). Sets _pos; returns the blend for yaw. */
function eject(rig: CraftRig, p: number, ctx: CraftContext, restY: number, from = 0.88): number {
  const e = ctx.chuteFull ? 0 : smooth(seg(p, from, 1));
  // …down the chute slide: the slot's own height, which is rail height
  // once the slot is past the slide's foot.
  _pos.set(0, lerp(rig.stageY + restY, chuteY(ctx.slotZ), e), ctx.slotZ * e);
  return e;
}

/* ── GEAR — STRUCK ──────────────────────────────────────────────────────── */

const STRIKES = [0.3, 0.5, 0.7];

function gearStruck(rig: CraftRig, p: number, ctx: CraftContext): void {
  // The slug: fat and round on the anvil, spread and toothed by blows.
  let n = 0;
  for (const s of STRIKES) if (p >= s) n++;
  const thick = 2.2 - 0.4 * n; // plate y-scale: a slug three plates tall → one
  const wide = 0.7 + 0.1 * n;
  const appear = easeOut(seg(p, 0.06, 0.16));

  // The ram: clear of the work, then wind up and DROP for each strike.
  let lift = 0.12 * easeOut(seg(p, 0, 0.15));
  for (let k = 0; k < STRIKES.length; k++) {
    const t = p - STRIKES[k];
    // Where the head bottoms out: the plate stack AFTER this blow, or
    // the axle once it stands proud of the plates.
    const contact = Math.max(0.026 * (2.2 - 0.4 * (k + 1)), (0.034 * (k + 1)) / 3);
    if (t >= -0.14 && t < -0.03) lift = 0.12 + 0.03 * smooth((t + 0.14) / 0.11);
    else if (t >= -0.03 && t < 0) lift = lerp(0.15, contact, easeIn((t + 0.03) / 0.03));
    else if (t >= 0 && t <= 0.04) lift = contact;
    else if (t > 0.04 && t <= 0.16) lift = lerp(contact, 0.12, easeOut((t - 0.04) / 0.12));
    if (crossed(rig, p, STRIKES[k])) {
      ctx.cue('strike', k);
      flash(rig, AMBER, 0.12);
      burst(rig, AMBER, 14 + k * 4, 1.2);
    }
  }
  const e = eject(rig, p, ctx, Math.max(0.013 * thick, (0.017 * n) / 3) * appear);
  if (e > 0) lift = 0.12 + 0.03 * e;
  setLift(rig, lift);

  // Molten → iron: the pool under the slug dims with every blow and
  // cools out entirely before the eject.
  const molten = [0.85, 0.6, 0.35, 0.12][n] * appear * (1 - seg(p, 0.76, 0.88));
  rig.glowMat.color.setHex(AMBER);
  rig.glowMat.opacity = molten + 0.4 * afterglow(rig, 0.2);
  heatAt(
    rig,
    _pos.x,
    _pos.y,
    _pos.z,
    0.052 * wide * 1.1 * appear,
    (0.026 * thick + 0.012) * appear,
    AMBER,
    0.6 * molten + 0.35 * afterglow(rig),
  );

  _scl.setScalar(Math.max(0.001, appear));
  const yaw = lerpAngle(0, ctx.spinTarget, e);
  writePhantom(rig, 'gear', yaw, (c, t) => {
    if (c === 0 || c === 1) {
      t.sx = t.sz = wide;
      t.sy = thick;
      // The two plates start coincident (an octagonal slug) and the top
      // one indexes a third of the half-tooth per blow.
      if (c === 1) t.ry = (-Math.PI / 8) * (1 - n / 3);
    } else {
      // Hub and axle rise out of the iron with the blows.
      const s = Math.max(0.001, n / 3);
      t.sx = t.sz = s;
      t.sy = s;
    }
  });
}

/* ── CELL — DRAWN ───────────────────────────────────────────────────────── */

function cellDrawn(rig: CraftRig, p: number, ctx: CraftContext): void {
  const drawn = easeOut(seg(p, 0.1, 0.5));
  // The press squeezes the caps on, then eases off.
  const squeeze = seg(p, 0.62, 0.66) * (1 - seg(p, 0.66, 0.72));
  const sy = Math.max(0.02, drawn) * (1 - 0.05 * squeeze);
  const top = 0.074 * sy; // the canister's crown above the stage

  let lift = 0.13 * easeOut(seg(p, 0, 0.1));
  if (p >= 0.5 && p < 0.62) lift = lerp(0.13, top, smooth(seg(p, 0.5, 0.62)));
  else if (p >= 0.62 && p < 0.72) lift = top;
  else if (p >= 0.72) lift = lerp(0.074, 0.11, easeOut(seg(p, 0.72, 0.8)));
  if (crossed(rig, p, 0.62)) ctx.cue('press', 0);
  if (crossed(rig, p, 0.72)) {
    ctx.cue('charge', 0);
    flash(rig, CYAN, 0.11);
  }
  const e = eject(rig, p, ctx, 0.037 * sy, 0.86);
  if (e > 0) lift = 0.11 + 0.03 * e;
  setLift(rig, lift);

  // Coolant pools under the die while it draws, then the charge PULSES
  // in — three surges — and settles to a steady band.
  const charge = seg(p, 0.72, 0.84);
  const pulse = charge < 1 ? Math.abs(Math.sin(Math.PI * 2.5 * charge)) : 0;
  rig.glowMat.color.setHex(CYAN);
  rig.glowMat.opacity =
    (0.2 * seg(p, 0, 0.1) * (1 - 0.4 * drawn) + 0.6 * pulse + 0.3 * charge) *
    (1 - seg(p, 0.9, 1));
  // The canister sweats coolant as it is drawn, and lights as it charges.
  heatAt(
    rig,
    _pos.x,
    _pos.y,
    _pos.z,
    0.038 * 1.12,
    0.074 * sy + 0.006,
    CYAN,
    (0.14 * drawn * (1 - seg(p, 0.5, 0.62)) + 0.45 * pulse + 0.12 * charge) * (1 - seg(p, 0.9, 1)),
  );

  _scl.set(1, sy, 1);
  const yaw = lerpAngle(0, ctx.spinTarget, e);
  writePhantom(rig, 'cell', yaw, (c, t) => {
    // The band is a hairline until the charge comes up.
    if (c === 3) t.sy = Math.max(0.02, easeOut(charge));
  });
}

/* ── CHIP — ETCHED ──────────────────────────────────────────────────────── */

const ETCHES = [0.16, 0.26, 0.36, 0.46, 0.56, 0.66];

function chipEtched(rig: CraftRig, p: number, ctx: CraftContext): void {
  const appear = easeOut(seg(p, 0.04, 0.12));
  let n = 0;
  for (const s of ETCHES) if (p >= s) n++;
  // The table indexes a sixth of a turn per etch, snapping round.
  let yaw = 0;
  if (n > 0) yaw = ((n - 1) * Math.PI) / 3 + (Math.PI / 3) * easeOut(seg(p, ETCHES[n - 1], ETCHES[n - 1] + 0.03));

  // The scriber hovers low and DIPS on every index.
  // The wafer's top face is 0.018 up (REST + half the hex); the pin's
  // head, once it is in, 0.024.
  let lift = 0.07 * easeOut(seg(p, 0, 0.1));
  for (let k = 0; k < ETCHES.length; k++) {
    const t = p - ETCHES[k];
    if (t >= -0.025 && t < 0) lift = lerp(0.07, 0.018, easeIn((t + 0.025) / 0.025));
    else if (t >= 0 && t <= 0.015) lift = 0.018;
    else if (t > 0.015 && t <= 0.06) lift = lerp(0.018, 0.07, easeOut((t - 0.015) / 0.045));
    if (crossed(rig, p, ETCHES[k])) {
      ctx.cue('etch', k);
      flash(rig, VIOLET, 0.06);
    }
  }
  // The pin comes down from above and the probe presses it home.
  const pinDrop = smooth(seg(p, 0.72, 0.8));
  if (p >= 0.72 && p < 0.8) lift = lerp(0.07, 0.024, pinDrop);
  else if (p >= 0.8) lift = lerp(0.024, 0.07, easeOut(seg(p, 0.8, 0.86)));
  if (crossed(rig, p, 0.8)) {
    ctx.cue('pin', 0);
    flash(rig, VIOLET, 0.12);
    burst(rig, VIOLET, 8, 0.6);
  }
  const e = eject(rig, p, ctx, 0.012, 0.86);
  if (e > 0) lift = 0.07 + 0.04 * e;
  setLift(rig, lift);

  rig.glowMat.color.setHex(VIOLET);
  rig.glowMat.opacity = (0.08 * appear + 0.45 * afterglow(rig, 0.2)) * (1 - seg(p, 0.9, 1));
  // Each pass lights the wafer's edge for an instant.
  heatAt(rig, _pos.x, _pos.y + 0.004, _pos.z, 0.056 * appear, 0.026, VIOLET, 0.4 * afterglow(rig));

  _scl.set(Math.max(0.001, appear), 1, Math.max(0.001, appear));
  writePhantom(rig, 'chip', lerpAngle(yaw, ctx.spinTarget, e), (c, t) => {
    if (c === 1) {
      // The traces grow a sixth per pass.
      const s = Math.max(0.001, n / 6);
      t.sx = t.sz = s;
    } else if (c === 2) {
      if (p < 0.72) t.sx = t.sy = t.sz = 0.001;
      else t.dy = 0.06 * (1 - pinDrop);
    }
  });
}

/* ── the combiner: two parts walk in, meet, and FIT ─────────────────────── */

/** The two ingredients' poses, once they have met: where the crown sits
 *  over the base, how far the clamp must come down to touch it. Each
 *  item's routine fills these in from the shared walk-in. */
interface Fit {
  item: ItemId;
  base: ItemId;
  crown: ItemId;
  /** The crown's origin height when seated on the base, and hovering. */
  seatY: number;
  hoverY: number;
  /** Clamp lift that just touches the seated stack's crown, and the
   *  most the clamp rises for this fitting (under the column caps, and
   *  clear of the crown hovering beneath it). */
  contactLift: number;
  maxLift: number;
  /** Outputs: the poses. */
  baseY: number;
  crownY: number;
  baseYaw: number;
  crownYaw: number;
  lift: number;
  /** How far along the walk-in is (1 = met). */
  met: number;
  /** The heat shell round the stack: colour and strength (0 = none). */
  heatColor: number;
  heat: number;
}
const _fit: Fit = {
  item: 'pump',
  base: 'gear',
  crown: 'cell',
  seatY: 0,
  hoverY: 0,
  contactLift: 0,
  maxLift: 0,
  baseY: 0,
  crownY: 0,
  baseYaw: 0,
  crownYaw: 0,
  lift: 0,
  met: 0,
  heatColor: 0,
  heat: 0,
};

const _pA = new Vector3();
const _pB = new Vector3();

function combine(
  rig: CraftRig,
  p: number,
  ctx: CraftContext,
  routine: (rig: CraftRig, p: number, ctx: CraftContext, f: Fit) => void,
): void {
  const item = rig.item!;
  const base = BASE[item];
  if (!base) return;
  const basePort: 0 | 1 | -1 = ctx.ports[0] === base ? 0 : ctx.ports[1] === base ? 1 : -1;
  if (basePort === -1) return;
  const crownPort: 0 | 1 = basePort === 0 ? 1 : 0;
  const crown = ctx.ports[crownPort];
  if (!crown) return;

  const f = _fit;
  f.item = item;
  f.base = base;
  f.crown = crown;
  f.seatY = CHUTE_Y + TOP[base] + REST[crown] - 0.004;
  // The clamp's underside rests at headBase − 0.02 (a 0.04 bar); it
  // rises as far as the stack needs and no further, and the crown
  // hovers just under it while it waits to come down.
  const under = rig.headBase - 0.02;
  f.contactLift = f.seatY + TOP[crown] - under;
  f.maxLift = item === 'servo' ? 0.23 : item === 'pump' ? 0.19 : 0.16;
  f.hoverY = Math.min(f.seatY + 0.06, under + f.maxLift - TOP[crown] - 0.006);
  f.met = smooth(seg(p, 0, 0.28));
  // Both parts walk IN from the foot of their port slides (rail height)
  // up onto the stage (bench height) as they meet.
  f.baseY = lerp(chuteY(PORT_REACH), CHUTE_Y, f.met);
  f.crownY = lerp(chuteY(PORT_REACH), f.hoverY, f.met);
  f.baseYaw = lerpAngle(ctx.portSpin[basePort], 0, f.met);
  f.crownYaw = lerpAngle(ctx.portSpin[crownPort], 0, f.met);
  f.lift = 0;
  f.heat = 0;
  f.heatColor = AMBER;
  routine(rig, p, ctx, f);

  // The walk-in, and the slide out to the chute at the end.
  const e = ctx.chuteFull ? 0 : smooth(seg(p, 0.88, 1));
  const xB = (basePort === 0 ? 1 : -1) * PORT_REACH * (1 - f.met);
  const xC = (crownPort === 0 ? 1 : -1) * PORT_REACH * (1 - f.met);
  // The finished stack slides out and DOWN the chute to its slot.
  const drop = chuteY(ctx.slotZ) - CHUTE_Y;
  _pA.set(xB, f.baseY + drop * e, ctx.slotZ * e);
  _pB.set(xC, f.crownY + drop * e, ctx.slotZ * e);
  const yawB = lerpAngle(f.baseYaw, ctx.spinTarget, e);
  const yawC = lerpAngle(f.crownYaw, ctx.spinTarget, e);
  _scl.setScalar(1);
  _q.setFromAxisAngle(UP, yawB);
  rig.portPose[basePort].compose(_pA, _q, _scl);
  _q.setFromAxisAngle(UP, yawC);
  rig.portPose[crownPort].compose(_pB, _q, _scl);
  rig.portOn = true;
  setLift(rig, f.lift);
  // The shell round the whole stack, base foot to crown top.
  const foot = f.baseY - REST[base];
  const crownTop = f.crownY + TOP[crown];
  heatAt(rig, 0, (foot + crownTop) / 2, ctx.slotZ * e, 0.058, crownTop - foot + 0.01, f.heatColor, f.heat);
}

/* ── PUMP — SCREWED ─────────────────────────────────────────────────────── */

function pumpScrewed(rig: CraftRig, p: number, ctx: CraftContext, f: Fit): void {
  // The cell screws down onto the gear: four turns, constant pitch.
  const thread = seg(p, 0.3, 0.7);
  if (p >= 0.3) {
    f.crownY = lerp(f.hoverY, f.seatY, thread);
    f.crownYaw = -4 * TAU * thread;
  }
  // The press, with a squeeze that eases off.
  const squeeze = seg(p, 0.78, 0.82) * (1 - seg(p, 0.82, 0.86));
  if (p >= 0.7) f.crownY -= 0.006 * squeeze;
  let lift = f.maxLift * easeOut(seg(p, 0, 0.15));
  if (p >= 0.7 && p < 0.78) lift = lerp(f.maxLift, f.contactLift, smooth(seg(p, 0.7, 0.78)));
  else if (p >= 0.78 && p < 0.86) lift = f.contactLift - 0.006 * squeeze;
  else if (p >= 0.86) lift = lerp(f.contactLift, f.maxLift, easeOut(seg(p, 0.86, 0.92)));
  f.lift = lift;

  if (crossed(rig, p, 0.3) || crossed(rig, p, 0.52)) ctx.cue('thread', 0);
  if (crossed(rig, p, 0.78)) {
    ctx.cue('press', 0);
    flash(rig, AMBER, 0.14);
  }
  // Amber under the work while the thread runs; a cyan wash as it seats.
  rig.glowMat.color.setHex(thread < 1 ? AMBER : CYAN);
  rig.glowMat.opacity =
    (0.25 * seg(p, 0.3, 0.4) * (1 - seg(p, 0.86, 0.92)) + 0.35 * afterglow(rig)) *
    (1 - seg(p, 0.92, 1));
  f.heatColor = AMBER;
  f.heat = 0.4 * afterglow(rig, 0.3);
}

/* ── LAMP — KINDLED ─────────────────────────────────────────────────────── */

const FLICKERS = [0.62, 0.69];

function lampKindled(rig: CraftRig, p: number, ctx: CraftContext, f: Fit): void {
  // The crown is lowered on — slow, straight down.
  if (p >= 0.3) f.crownY = lerp(f.hoverY, f.seatY, smooth(seg(p, 0.3, 0.5)));
  let lift = f.maxLift * easeOut(seg(p, 0, 0.15));
  if (p >= 0.5 && p < 0.58) lift = lerp(f.maxLift, f.contactLift, smooth(seg(p, 0.5, 0.58)));
  else if (p >= 0.58 && p < 0.64) lift = f.contactLift;
  else if (p >= 0.64) lift = lerp(f.contactLift, f.maxLift, easeOut(seg(p, 0.64, 0.72)));
  f.lift = lift;

  if (crossed(rig, p, 0.5)) ctx.cue('seat', 0);
  if (crossed(rig, p, 0.58)) ctx.cue('press', 1);
  // Ignition: two flickers that die, then it comes on and stays.
  let flicker = 0;
  for (let k = 0; k < FLICKERS.length; k++) {
    if (p >= FLICKERS[k] && p < FLICKERS[k] + 0.02) flicker = 1;
    if (crossed(rig, p, FLICKERS[k])) {
      ctx.cue('spark', k);
      flash(rig, VIOLET, 0.07);
    }
  }
  const lit = seg(p, 0.74, 0.8);
  if (crossed(rig, p, 0.74)) {
    ctx.cue('lit', 0);
    flash(rig, VIOLET, 0.18);
  }
  rig.glowMat.color.setHex(VIOLET);
  rig.glowMat.opacity = Math.max(0.9 * flicker, 0.65 * lit) * (1 - seg(p, 0.92, 1));
  f.heatColor = VIOLET;
  f.heat = Math.max(0.55 * flicker, 0.3 * lit) * (1 - seg(p, 0.92, 1));
}

/* ── SERVO — TORQUED ────────────────────────────────────────────────────── */

const TORQUES = [0.52, 0.59, 0.66, 0.73];
const TORQUE_COLORS = [AMBER, CYAN, VIOLET, WHITE];

function servoTorqued(rig: CraftRig, p: number, ctx: CraftContext, f: Fit): void {
  if (p >= 0.28) f.crownY = lerp(f.hoverY, f.seatY, smooth(seg(p, 0.28, 0.44)));
  let lift = f.maxLift * easeOut(seg(p, 0, 0.15));
  if (p >= 0.44 && p < 0.5) lift = lerp(f.maxLift, f.contactLift, smooth(seg(p, 0.44, 0.5)));
  else if (p >= 0.5 && p < 0.78) lift = f.contactLift;
  else if (p >= 0.78) lift = lerp(f.contactLift, f.maxLift, easeOut(seg(p, 0.78, 0.84)));
  if (crossed(rig, p, 0.44)) ctx.cue('seat', 1);
  if (crossed(rig, p, 0.5)) ctx.cue('press', 2);

  // Four bolts, a quarter turn each, under the press — and the clamp
  // bites on every one.
  let n = 0;
  for (const t of TORQUES) if (p >= t) n++;
  let stackYaw = 0;
  if (n > 0) {
    stackYaw = ((n - 1) * Math.PI) / 2 + (Math.PI / 2) * easeOut(seg(p, TORQUES[n - 1], TORQUES[n - 1] + 0.04));
  }
  for (let k = 0; k < TORQUES.length; k++) {
    const t = p - TORQUES[k];
    if (t >= 0 && t <= 0.03) lift -= 0.006 * Math.sin((Math.PI * t) / 0.03);
    if (crossed(rig, p, TORQUES[k])) {
      ctx.cue('torque', k);
      flash(rig, TORQUE_COLORS[k], 0.15);
    }
  }
  // RUN IN: the fitted servo spins up and brakes to a stop.
  const spin = smooth(seg(p, 0.78, 0.9));
  stackYaw += 3 * TAU * spin;
  if (crossed(rig, p, 0.78)) ctx.cue('spin', 0);
  if (p >= 0.44) {
    f.baseYaw = stackYaw;
    f.crownYaw = stackYaw;
  }
  f.lift = lift;

  const bolt = n > 0 ? TORQUE_COLORS[Math.min(3, n - 1)] : AMBER;
  rig.glowMat.color.setHex(bolt);
  rig.glowMat.opacity = 0.4 * afterglow(rig, 0.3) + 0.35 * spin * (1 - seg(p, 0.9, 1));
  // Each bolt lights the stack its own colour; the run-in lights it white.
  f.heatColor = spin > 0 ? WHITE : bolt;
  f.heat = 0.35 * afterglow(rig, 0.3) + 0.3 * spin * (1 - seg(p, 0.9, 1));
}
