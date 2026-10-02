/**
 * FloorSystem — THE FLOOR: mark the site out in hazard tape.
 *
 * The verb is SLUGFEST's ring adjust, ported whole (goopboxing2
 * `systems/ArenaSystem.ts`): on the FLOOR screen every side of the tape
 * grows a glowing grab ring; reach toward a side, hold the TRIGGER, and
 * that side follows your hand along its own normal — one side at a time,
 * to the walls if you like. Release to drop it; the layout saves per
 * headset and greets you next shift. Ⓐ (or Ⓧ) is done — the board
 * comes back.
 *
 * What the port gained here:
 *  - WALL SNAP. Drag a side inside FLOOR.snapDist of a parallel scanned
 *    wall and it magnetises to just off the plaster (FLOOR.snapGap) with
 *    a ratchet click — the tape wants your real walls, doorway-style.
 *  - THE PLANT LAW. Sides refuse to cross standing crates (the clamp
 *    lives in floor/plan.ts; the grid feeds it), so re-planning the
 *    boundary can never orphan a machine.
 *  - THE STAGE. A headset with its boundary drawn deals the tape onto
 *    that room-scale box first (room/stage.ts); the scan's walls only
 *    take their turn when there is no box to stand on.
 *
 * This system owns the tape rig and the adjust verb. What stands INSIDE
 * the tape belongs to BuildSystem.
 */

import { intents } from '../input/intents.js';
import { createSystem } from '@iwsdk/core';
import { Vector3, type Object3D } from 'three';
import { FLOOR } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { buzz } from '../game/haptics.js';
import { enterFloorSetup, exitFloorSetup } from '../game/flow.js';
import { site } from '../game/state.js';
import {
  floorAdjust,
  floorLayout,
  initLayout,
  layoutWithin,
  nearestSide,
  resetLayout,
  saveLayout,
  setSide,
  sideHandle,
  type FloorLayout,
  type FloorSide,
} from '../floor/plan.js';
import { buildTapeRig, type TapeRig } from '../floor/tape.js';
import { stage } from '../room/stage.js';
import { usable } from '../room/walls.js';
import { walls } from './WallSystem.js';

/** Headless/dev hooks (wired into __tubes in main.ts). */
export const floorView: {
  enter?: () => void;
  exit?: () => void;
  /** Drag one side through the LIVE snap+clamp path; returns where it
   *  landed — the same maths a held trigger drives. */
  dragTo?: (side: FloorSide, value: number) => number;
  /** Raw set, clamp only (SLUGFEST's moveSide). */
  moveSide?: (side: FloorSide, value: number) => number;
  reset?: () => void;
  state?: () => {
    initialized: boolean;
    grabbed: FloorSide | null;
    layout: FloorLayout;
    tapeUp: boolean;
  };
} = {};

const _hand = new Vector3();
const _cam = new Vector3();
const _hh = { x: 0, y: 0, z: 0 };

export class FloorSystem extends createSystem({}) {
  private rig?: TapeRig;
  private painted = -1;

  init(): void {
    this.rig = buildTapeRig();
    this.scene.add(this.rig.group);

    floorView.enter = () => enterFloorSetup();
    floorView.exit = () => {
      saveLayout();
      exitFloorSetup();
    };
    floorView.dragTo = (side, value) => {
      sideHandle(side, _hh);
      if (side === 'left' || side === 'right') _hh.x = value;
      else _hh.z = value;
      const snap = this.snapValue(side, value, _hh.x, _hh.y, _hh.z);
      setSide(side, snap ?? value);
      return floorLayout[side];
    };
    floorView.moveSide = (side, value) => {
      setSide(side, value);
      return floorLayout[side];
    };
    floorView.reset = () => {
      this.camera.getWorldPosition(_cam);
      resetLayout(walls, _cam.x, _cam.z, stage.rect);
    };
    floorView.state = () => ({
      initialized: floorAdjust.initialized,
      grabbed: floorAdjust.grabbed,
      layout: { ...floorLayout },
      tapeUp: this.rig?.group.visible ?? false,
    });
  }

  update(delta: number): void {
    const rig = this.rig;
    if (!rig) return;

    // Deal the layout once the room can vote — the stage first, then the
    // walls (or the moment the player asks for the floor with no room
    // yet — the starter rect stands in). WallSystem asks the stage
    // question; it is answered within a few frames of the session, so
    // waiting on it costs nothing.
    if (
      !floorAdjust.initialized &&
      stage.settled &&
      (stage.rect !== null || site.wallsReady || site.screen === 'floor')
    ) {
      this.camera.getWorldPosition(_cam);
      initLayout(walls, _cam.x, _cam.z, stage.rect);
    }

    // THE BOX ARRIVING LATE. Quest fills its bounds a moment after the
    // session starts, and a boundary can be redrawn mid-session: a floor
    // the ROOM dealt, or a save that stands outside the box, re-deals
    // onto it — never a floor you set yourself inside the box, and never
    // mid-shift.
    if (
      floorAdjust.initialized &&
      stage.rect &&
      site.screen === 'board' &&
      floorAdjust.source !== 'stage' &&
      (floorAdjust.source === 'room' || !layoutWithin(floorLayout, stage.rect))
    ) {
      this.camera.getWorldPosition(_cam);
      resetLayout(walls, _cam.x, _cam.z, stage.rect);
    }

    // THE TAPE COMES DOWN once you're set up: barricade tape is site
    // dressing, not furniture — it stands only while the floor is being
    // marked out. The boundary lives on in the lattice and the feeds.
    const adjusting = site.screen === 'floor';
    rig.group.visible = floorAdjust.initialized && adjusting;
    if (!floorAdjust.initialized) return;

    rig.setMode(adjusting ? 'adjust' : 'idle');

    if (adjusting) {
      this.adjustTick();

      // Ⓐ (or Ⓧ) — done: the tape stays, the layout saves, the board
      // comes back.
      if (intents.done) {
        this.release(true);
        saveLayout();
        sfx.uiClick();
        exitFloorSetup();
      }
    } else if (floorAdjust.grabbed) {
      this.release(false);
    }

    if (this.painted !== floorAdjust.dirty) {
      this.painted = floorAdjust.dirty;
      rig.relay();
    }
    rig.tick(delta);
  }

  /* ── the adjust: one side, one hand, one axis ──────────────────────────── */

  private adjustTick(): void {
    const spaces = (
      this.world as {
        playerSpaceEntities?: {
          gripSpaces?: Record<'left' | 'right', { object3D?: Object3D } | undefined>;
          raySpaces?: Record<'left' | 'right', { object3D?: Object3D } | undefined>;
        };
      }
    ).playerSpaceEntities;

    for (const hand of ['left', 'right'] as const) {
      const obj = spaces?.gripSpaces?.[hand]?.object3D ?? spaces?.raySpaces?.[hand]?.object3D;
      const it = intents[hand];
      if (!obj || it.mode === 'none') continue;
      obj.getWorldPosition(_hand);
      // A tape side takes a pinch OR a fist — both are "hold this".
      const holding = it.point.pressed || it.grab.pressed;

      if (floorAdjust.grabbed && floorAdjust.grabHand === hand) {
        if (!holding) {
          // Dropped: the side stays, the layout saves.
          this.release(true);
          continue;
        }
        const side = floorAdjust.grabbed;
        const raw = side === 'left' || side === 'right' ? _hand.x : _hand.z;
        const snap = this.snapValue(side, raw, _hand.x, _hand.y, _hand.z);
        if (snap !== null && !floorAdjust.snapped) {
          // The wall takes the tape — a ratchet click you can feel.
          sfx.segmentClick(2);
          buzz(this.world, hand, 0.5, 40);
        }
        floorAdjust.snapped = snap !== null;
        setSide(side, snap ?? raw);
        continue;
      }

      // A fresh squeeze near a side takes it (one side at a time).
      if (!floorAdjust.grabbed && (it.point.down || it.grab.down)) {
        const side = nearestSide({ x: _hand.x, y: _hand.y, z: _hand.z });
        if (side) {
          floorAdjust.grabbed = side;
          floorAdjust.grabHand = hand;
          floorAdjust.snapped = false;
          floorAdjust.dirty++;
          sfx.uiHover();
          buzz(this.world, hand, 0.35, 30);
        }
      }
    }
  }

  private release(save: boolean): void {
    if (!floorAdjust.grabbed) return;
    floorAdjust.grabbed = null;
    floorAdjust.grabHand = null;
    floorAdjust.snapped = false;
    floorAdjust.dirty++;
    if (save) {
      // A side you set yourself is yours: no box re-deals it.
      floorAdjust.source = 'save';
      saveLayout();
      sfx.uiClick();
    }
  }

  /** The nearest parallel wall the dragged side could seat against —
   *  its coordinate just off the plaster — or null when nothing is
   *  inside the snap window. Pure plane maths against the registry. */
  private snapValue(side: FloorSide, raw: number, hx: number, hy: number, hz: number): number | null {
    const axisX = side === 'left' || side === 'right';
    let best: number | null = null;
    let bestGap = FLOOR.snapDist;
    for (const w of walls) {
      if (w.kind !== 'wall' || !usable(w)) continue;
      const nAxis = axisX ? w.normal.x : w.normal.z;
      if (Math.abs(nAxis) < 0.85) continue; // face not square to this side
      // Where the drag axis through the hand meets the wall's plane:
      // (h + t·a − c)·n = 0, a·n = nAxis.
      const t =
        ((w.center.x - hx) * w.normal.x +
          (w.center.y - hy) * w.normal.y +
          (w.center.z - hz) * w.normal.z) /
        nAxis;
      const at = (axisX ? hx : hz) + t;
      const inner = at + nAxis * FLOOR.snapGap; // normal points into the room
      const gap = Math.abs(inner - raw);
      if (gap < bestGap) {
        bestGap = gap;
        best = inner;
      }
    }
    return best;
  }
}
