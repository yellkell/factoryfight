/**
 * GoopSystem — the last two minutes of TUBES.
 *
 * The book ends with a machine you cannot use. Three SERVOS crank the
 * fourth manifold's gate off the near pillar; behind it is PEARL, which
 * is green, and nothing in the catalogue drinks green. So the last sheet
 * hands you the VAT — the only glass on the floor — and asks you to run
 * the green line into it. The level comes up. And then something climbs
 * out.
 *
 * THE ARC, and every beat of it is a real object in your real room:
 *
 *   BREWING   the vat fills (FactorySystem owns the level; the sim owns
 *             the clock). Nothing of ours exists yet.
 *   BIRTH     a dome of gel forms INSIDE the tank, swells over the rim,
 *             and hauls itself up onto the LID.
 *   RISE      it stands up out of the puddle — the sim's own glob→boxer
 *             morph, which is the trick this creature was built around.
 *   DANCE     ON TOP OF THE VAT: the tank it was brewed in is its
 *             podium, head at your eye line, hopping on the machine
 *             that made it. It hits a stance on every beat and keeps
 *             you in its eyes. THANKS FOR PLAYING comes up over its
 *             shoulder; dismissing the card leaves it dancing.
 *
 * The creature itself knows nothing about any of this (goop/GoopDancer)
 * — it is fed a form target, a stance and a place to be, exactly as the
 * club fed it. This file is the choreography and nothing else.
 */

import { createSystem } from '@iwsdk/core';
import { Vector3 } from 'three';
import { UNITS } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { cellCenter } from '../floor/grid.js';
import { buzz } from '../game/haptics.js';
import { site } from '../game/state.js';
import { plant, unitById } from '../factory/state.js';
import { DANCE_COMBOS } from '../goop/dancePoses.js';
import { GoopDancer } from '../goop/GoopDancer.js';

/** How big the thing is, against the sim's native 1.78 m man. A shop
 *  floor is a small room and the goop is a guest in it: two-thirds
 *  scale, stood on the vat's lid, puts its head right at your eye line
 *  — eye-to-eye without a crouch, and still cheerfully unthreatening. */
const SCALE = 0.62;

/** Seconds for each beat of the birth. */
const FORM_S = 2.6; // the dome gathering inside the glass
const CLIMB_S = 2.4; // up over the rim and onto the lid
const STAND_S = 1.6; // up onto its feet before the card comes up

/** The dance's tempo. No music plays in TUBES — the shop's own hum is
 *  the backing track — so this is a private clock, slow enough to read
 *  every shape it hits. */
const BEAT_S = 0.62;
/** Bars per combo before it picks a new pair of shapes. */
const BARS_PER_COMBO = 4;

export const goopView: {
  /** Where the finale stands, for the walk: the phase, how far through
   *  the birth it is, and where the creature is in the room. */
  state?: () => {
    phase: string;
    birth: number;
    /** Where it is standing, so a shot tool can point a camera at it. */
    x: number;
    y: number;
    z: number;
    form: number;
    dancing: boolean;
  } | null;
} = {};

const _head = new Vector3();
const _c = { x: 0, z: 0 };

export class GoopSystem extends createSystem({}) {
  private goop: GoopDancer | null = null;
  /** Seconds since the vat filled. */
  private t = 0;
  /** Where it was born (the vat) and where it dances (just in front). */
  private vat = new Vector3();
  private stage = new Vector3();
  private beat = 0;
  private bar = 0;
  private combo = 0;
  private stanceIx = 0;
  private hopT = 0;

  init(): void {
    goopView.state = () =>
      this.goop
        ? {
            phase: plant.goop,
            birth: Math.min(1, this.t / (FORM_S + CLIMB_S + STAND_S)),
            x: this.goop.group.position.x,
            z: this.goop.group.position.z,
            y: this.goop.group.position.y,
            form: this.goop.formValue,
            dancing: plant.goop === 'dancing' || plant.goop === 'done',
          }
        : null;
  }

  update(delta: number): void {
    // The whole finale lives and dies with the shift.
    const wanted = plant.goop === 'born' || plant.goop === 'dancing' || plant.goop === 'done';
    if (!wanted || site.screen !== 'factory') {
      if (this.goop) {
        this.goop.dispose();
        this.goop = null;
      }
      return;
    }
    if (!this.goop) this.birth();
    const goop = this.goop;
    if (!goop) return;

    this.t += delta;
    this.camera.getWorldPosition(_head);

    const total = FORM_S + CLIMB_S;
    if (this.t < FORM_S) {
      // GATHERING. It is a dome at the bottom of the tank, swelling. The
      // group scale carries the swell so the sim never has to know.
      const p = this.t / FORM_S;
      const s = SCALE * (0.24 + 0.5 * p);
      goop.group.scale.setScalar(s);
      goop.group.position.set(this.vat.x, this.vatFloor() + 0.02 * p, this.vat.z);
      goop.setForm(0);
    } else if (this.t < total) {
      // CLIMBING UP. Out of the brew, over the rim, and it SETTLES ON
      // THE LID — one heave with a little overshoot at the top, the
      // mass lagging behind it (the dancer's own inertia does that part
      // for free). The tank it was brewed in is where it stays: the vat
      // is its podium now.
      const p = (this.t - FORM_S) / CLIMB_S;
      const ease = p < 0.5 ? 2 * p * p : 1 - (1 - p) ** 2 * 2;
      const lidY = this.stage.y;
      const overshoot = Math.sin(Math.min(1, p / 0.85) * Math.PI) * 0.1;
      const y = this.vatFloor() + (lidY - this.vatFloor()) * ease + overshoot;
      goop.group.scale.setScalar(SCALE * (0.74 + 0.26 * ease));
      goop.group.position.set(this.vat.x, y, this.vat.z);
      goop.setForm(0);
      if (p > 0.9 && plant.goop === 'born' && this.hopT === 0) {
        this.hopT = 1;
        sfx.goopStep(true);
        buzz(this.world, 'both', 0.6, 90);
      }
    } else {
      // ON THE LID. Stand up, then dance — and the card comes up the
      // moment it is on its feet, not a second before.
      goop.group.scale.setScalar(SCALE);
      goop.setForm(1);
      if (plant.goop === 'born' && this.t > total + STAND_S) {
        plant.goop = 'dancing';
        site.finale = true;
        site.paused = false;
        sfx.finaleChord();
      }
      if (plant.goop !== 'born') this.dance(delta, goop);
    }

    goop.faceToward(_head);
    goop.update(delta, _head);
  }

  /** The vat's tank floor, in world Y — where the dome first gathers. */
  private vatFloor(): number {
    return UNITS.vat.tankFloor;
  }

  /** Stand the creature up: work out where the vat is, because the vat
   *  is also the stage — it dances on the tank's own lid. */
  private birth(): void {
    const unit = plant.goopUnit >= 0 ? unitById(plant.goopUnit) : undefined;
    if (unit) {
      cellCenter(unit.i, unit.j, _c);
      this.vat.set(_c.x, 0, _c.z);
    } else {
      this.vat.set(0, 0, 0);
    }
    // THE PODIUM: dead centre of the lid, at lid height (the pan, the
    // glass, and the lid plate it lands on — see the vat builder).
    this.stage.copy(this.vat);
    this.stage.y = UNITS.vat.tankFloor + UNITS.vat.height + 0.035;

    this.goop = new GoopDancer();
    this.goop.group.position.copy(this.vat);
    this.goop.group.scale.setScalar(SCALE * 0.24);
    this.scene.add(this.goop.group);
    this.t = 0;
    this.beat = 0;
    this.bar = 0;
    this.hopT = 0;
    this.combo = Math.floor(Math.random() * DANCE_COMBOS.length);
    this.stanceIx = 0;
  }

  /**
   * THE DANCE. One stance per beat, alternating the combo's two shapes
   * (they are authored to OPPOSE — up/down, left/right, tight/wide — so
   * every beat visibly throws the mass somewhere new), a new combo every
   * four bars, and a hop on the downbeat that the gel lands out of with
   * a wobble.
   */
  private dance(delta: number, goop: GoopDancer): void {
    this.beat -= delta;
    if (this.beat <= 0) {
      this.beat += BEAT_S;
      this.stanceIx ^= 1;
      this.bar++;
      if (this.bar % BARS_PER_COMBO === 0) {
        this.combo = (this.combo + 1 + Math.floor(Math.random() * 2)) % DANCE_COMBOS.length;
      }
      goop.setStance(DANCE_COMBOS[this.combo][this.stanceIx].pose);
      // The downbeat gets a real hop; the offbeat just a bob.
      this.hopT = this.bar % 2 === 0 ? 1 : 0.45;
      sfx.goopStep(this.bar % 2 === 0);
    }
    // The hop: a quick rise and a heavy landing, ridden by the group so
    // the dancer's own inertia whips the body through it — off the lid
    // and back onto it, the whole vat its drum.
    this.hopT = Math.max(0, this.hopT - delta / BEAT_S);
    const lift = Math.sin(Math.min(1, this.hopT) * Math.PI) * 0.09;
    goop.group.position.set(this.stage.x, this.stage.y + lift, this.stage.z);
  }
}
