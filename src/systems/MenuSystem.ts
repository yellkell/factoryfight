/**
 * MenuSystem — the work board.
 *
 * Between shifts the board floats where you're looking (re-planted in
 * front of you every time it comes back — in AR the menu comes to the
 * room, not the room to the menu), laid out like a fitter's sheet:
 *
 *   ┌──────┬──────────────────────┬─────────────────┐
 *   │ TUBES│  JOBS: the ladder    │  THE JOB SHEET  │
 *   │ JOBS │  five rows, best     │  brief · lines  │
 *   │ SYS  │  times, locks        │  best · START   │
 *   └──────┴──────────────────────┴─────────────────┘
 *
 * One rail, one content region, no floating sub-panels. The look and
 * motion contract lives in ui/panel.ts (quiet glass, hairlines, one
 * furnace-amber accent, eased everything); this file decides WHAT each
 * button is, never how it looks.
 *
 * Mid-shift the board is gone and the right controller's Ⓐ raises THE
 * JOB CARD — a small pop-up dead ahead with the sheet's live state and
 * two honest buttons: BACK TO IT, or DOWN TOOLS. Raising it pauses the
 * hands (placement and the pull ignore input under the card) but never
 * the room: a pour mid-race keeps racing, because the machine doesn't
 * know you stopped.
 *
 * FOUR THINGS THIS FILE LEARNED LATE:
 *
 *  · ONE DOOR. The board used to list every sheet in the book and let
 *    you START any of them — which meant starting sheet four on an empty
 *    floor, with no feeds awake, no rails and no gears, and no way to
 *    get any. Every entry but the first was a trap dressed as a choice.
 *    The tab is called FACTORY now, it offers exactly one button, and
 *    the book advances inside the shift where the plant you built is
 *    still standing.
 *  · PICTURES. A catalogue of seven words in one weight is a list you
 *    read every single time. Every build button carries its machine's
 *    shop drawing (ui/icons.ts) over the word, and so does every part
 *    on every sheet.
 *  · THE BOX PANEL. Click any standing plant and a small card says what
 *    is inside it and what is plumbed into it — and carries UNPLUG,
 *    which is the verb that did not exist at all until playtest went
 *    looking for it and found DELETE instead.
 *  · THE COACH LINE. The first flange got lost: the board says "trigger
 *    to mount" and leaves, the beam only draws once it is already on a
 *    wall, and the only words left were behind Ⓐ. FIRST LIGHT now says
 *    its one sentence in the room, low and ahead, until the mount lands
 *    (JobSpec.coach) — and only FIRST LIGHT: after that the flange on
 *    the ray is the cue.
 */

import { intents } from '../input/intents.js';
import { createSystem } from '@iwsdk/core';
import { Raycaster, Vector3, type Intersection, type Object3D } from 'three';
import {
  BOARD,
  GAME_TITLE,
  JOBS,
  LINES,
  ORDERS,
  SIEGE,
  WAVES,
  WEAPONS,
  type WeaponId,
  ENEMIES,
  type UnitType,
  type UpgradeId,
} from '../config.js';
import * as sfx from '../audio/sfx.js';
import { setMusicVolume, musicVolume, setSfxVolume, sfxVolume } from '../audio/sfx.js';
import { nowPlaying } from '../audio/music.js';
import {
  abandonFactory,
  abandonShift,
  buyUpgrade,
  retrySiege,
  enterFloorSetup,
  startJob,
  startShop,
} from '../game/flow.js';
import {
  bestKills,
  bestMs,
  bestWave,
  bookFinished,
  orderBestMs,
  ordersUnlocked,
  ownedUpgrades,
  resetProgress,
  unlockedJobs,
} from '../game/progress.js';
import { jobSpec, site } from '../game/state.js';
import {
  bankTotal,
  chestParts,
  chuteParts,
  plant,
  runSeatedAt,
  unitById,
} from '../factory/state.js';
import { isWeapon, refundUnit, removeUnit } from '../factory/sim.js';

import { coreHealth, levelOf, sellValue, siegeLeft, startWave, upgradeCost, upgradeTower } from '../factory/siege.js';
import { buildView, type BuildTool } from './BuildSystem.js';
import { goopView } from './GoopSystem.js';
import { font } from '../ui/fonts.js';
import {
  GLYPH_DEAD,

  unitGlyph,
} from '../ui/icons.js';
import { Panel, UI, type PanelButton } from '../ui/panel.js';
import {
  SKIN,
  titleBar,
  caps,
  hexPath,
  chamfer,
  coreGauge,
  dot,
  hexPad,
  neonOf,
  pips,
  price,
  rgba,
  rule,
  well,
} from '../ui/skin.js';
import { PointerRay } from '../ui/pointer.js';
import { walls } from './WallSystem.js';
import { stage } from '../room/stage.js';

/** What a piece of plant is CALLED on a card. The catalogue's words and
 *  the box panel's title come from one table, so they can never drift. */
export const UNIT_NAME: Record<UnitType, string> = {
  dock: 'CORE',
  maker: 'MAKER',
  belt: 'RAIL',
  combiner: 'COMBINER',
  chest: 'CHEST',
  post: 'POST',
  vat: 'VAT',
  turret: 'TURRET',
  wall: 'WALL',
  mortar: 'MORTAR',
  tesla: 'TESLA COIL',
  flamer: 'FLAMETHROWER',
  hammer: 'HAMMER',
};

/** A tower's name where a tile is narrow (FLAMETHROWER won't fit one). */
const TOWER_SHORT: Record<WeaponId, string> = {
  turret: 'TURRET',
  hammer: 'HAMMER',
  flamer: 'FLAMER',
  tesla: 'TESLA',
  mortar: 'MORTAR',
};

/** What each tower is FOR, in two words. */
const TOWER_ROLE: Record<WeaponId, string> = {
  turret: 'ONE AT A TIME',
  hammer: 'SMASHES A CLUMP',
  flamer: 'SETS THEM ALIGHT',
  tesla: 'CHAINS THROUGH TEN',
  mortar: 'LONG-RANGE SHELLS',
};

/** The gestures, drawn as gold line-art in a 100-unit square: the open
 *  palm with the menu over it, a fingertip poking, a pinch, a fingertip
 *  on a tower, and a fist. */
type Gesture = 'palm' | 'poke' | 'pinch' | 'touch' | 'fist';
function handGlyph(g: CanvasRenderingContext2D, shape: Gesture, x: number, y: number, size: number): void {
  g.save();
  g.translate(x, y);
  g.scale(size / 100, size / 100);
  g.lineWidth = 5;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const ink = 'rgba(255,255,255,0.88)';
  const gold = SKIN.gold;
  g.strokeStyle = ink;
  /** An index finger, from (x0, y0) to its tip at (x1, y1). */
  const finger = (x0: number, y0: number, x1: number, y1: number): void => {
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  };
  const tip = (cx: number, cy: number, r = 6): void => {
    g.fillStyle = gold;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
  };
  if (shape === 'palm') {
    // An open hand, palm on, and the menu hanging over it.
    g.beginPath();
    g.roundRect(32, 56, 36, 34, 10);
    g.stroke();
    for (const [fx, top] of [[38, 40], [47, 34], [56, 36], [64, 44]]) finger(fx, 56, fx, top);
    finger(32, 70, 20, 58);
    g.strokeStyle = gold;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(26, 10);
    g.lineTo(74, 10);
    g.lineTo(78, 14);
    g.lineTo(78, 24);
    g.lineTo(74, 28);
    g.lineTo(26, 28);
    g.lineTo(22, 24);
    g.lineTo(22, 14);
    g.closePath();
    g.stroke();
  } else if (shape === 'poke') {
    // A fingertip pressing a hex button.
    g.strokeStyle = gold;
    g.lineWidth = 4;
    hexPath(g, 34, 34, 20);
    g.stroke();
    g.strokeStyle = ink;
    g.lineWidth = 5;
    finger(86, 92, 44, 44);
    finger(86, 92, 78, 62);
    tip(42, 42);
  } else if (shape === 'pinch') {
    finger(30, 96, 30, 96);
    g.beginPath();
    g.moveTo(30, 96);
    g.quadraticCurveTo(26, 50, 52, 30);
    g.moveTo(72, 96);
    g.quadraticCurveTo(84, 60, 58, 32);
    g.stroke();
    tip(55, 30, 7);
  } else if (shape === 'touch') {
    // A finger reaching to a tower on its pad.
    g.strokeStyle = gold;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(22, 88);
    g.lineTo(54, 88);
    g.moveTo(30, 88);
    g.lineTo(34, 40);
    g.lineTo(42, 40);
    g.lineTo(46, 88);
    g.stroke();
    g.strokeStyle = ink;
    g.lineWidth = 5;
    finger(94, 70, 50, 46);
    finger(94, 70, 86, 84);
    tip(50, 46);
  } else {
    // A fist: a knuckle row, closed.
    g.beginPath();
    g.roundRect(18, 34, 44, 46, 12);
    g.stroke();
    for (let k = 0; k < 3; k++) finger(18 + 11 * (k + 1), 34, 18 + 11 * (k + 1), 50);
    finger(26, 80, 26, 96);
    finger(54, 80, 54, 96);
    // …and the throw: three gold streaks off it.
    g.strokeStyle = gold;
    g.lineWidth = 4;
    for (const dy of [-12, 0, 12]) finger(80, 56 + dy, 94 - Math.abs(dy) * 0.4, 56 + dy * 1.3);
  }
  g.restore();
}

/** Canvas geometry of the board. */
const W = BOARD.pxW;
const H = BOARD.pxH;
const RAIL_X = 28;
const RAIL_W = 240;
const CONTENT_X = 304;
/** JOBS: the ladder rows and the sheet beside them. */
const ROW_X = CONTENT_X;
const ROW_W = 486;
const ROW_Y0 = 172;
const ROW_H = 118;
const ROW_PITCH = 134;
const SHEET_X = 822;
const SHEET_W = W - SHEET_X - 34;
/** SYSTEM rows. */
const SYS_Y0 = 166;
/** Five rows now that MUSIC has its own fader — 140 put RESET PROGRESS
 *  straight through the room-status footer. */
const SYS_PITCH = 124;

type Tab = 'jobs' | 'factory' | 'controls' | 'sys';

/** Headless/dev hooks (wired into __tubes in main.ts) — drive the board
 *  without controllers: hover, press, read what's offered. */
export const menuView: {
  setTab?: (t: Tab) => void;
  setHover?: (id: string | null) => void;
  setPause?: (on: boolean) => void;
  /** Press any button by id — the headless finger. */
  act?: (id: string) => void;
  /** The board's raw canvas as a data URL — pixel-perfect style checks. */
  snapBoard?: () => string;
  /** Which buttons the board is actually offering right now. */
  boardButtons?: () => string[];
  snapCard?: () => string;
  cardButtons?: () => string[];
  /** What the card's controls SAY — a label carries state the id can't
   *  (QUIT asking "SURE? PRESS AGAIN", for one). */
  cardLabels?: () => string[];
  /** Every control on the card, in card pixels — the overlap check. */
  cardRects?: () => Array<{ id: string; x: number; y: number; w: number; h: number }>;
  /** The card's pixel frame those rects have to fit inside. */
  cardLayout?: () => { w: number; h: number };
  /** THE BOX PANEL, headless: open one on a unit id, read what it is
   *  offering, and see it close. */
  inspect?: (unitId: number) => void;
  boxButtons?: () => string[];
  boxLabels?: () => string[];
  boxRects?: () => Array<{ id: string; x: number; y: number; w: number; h: number }>;
  boxLayout?: () => { w: number; h: number };
  snapBox?: () => string;
  /** THANKS FOR PLAYING — is it up, and what does it say. */
  finaleUp?: () => boolean;
  finaleButtons?: () => string[];
  /** Where a shown panel's button sits in the ROOM — its centre and the
   *  panel's face normal — so a walk can poke it with a real fingertip. */
  buttonWorld?: (id: string) => { x: number; y: number; z: number; nx: number; ny: number; nz: number } | null;
  /** Which panels are up (board / card / box / core / finale). */
  panelsUp?: () => string[];
  snapFinale?: () => string;
  /** THE COACH LINE — is it up, and what does it say. */
  coachUp?: () => boolean;
  snapCoach?: () => string;
} = {};

const _origin = new Vector3();
const _tip = new Vector3();
/** THE POKE's distances (room metres, along the panel's face normal):
 *  hover inside `hover`, press when the tip crosses `press`, re-arm once
 *  it is back out past `rearm`; past `through` it has gone right through
 *  and stops counting. */
const POKE = { hover: 0.05, rearm: 0.018, press: 0.006, through: 0.06 };
const _dir = new Vector3();
const _fwd = new Vector3();
const _avoid = new Vector3();
const _avoidAt = new Vector3();
/** Roughly half the creature's shoulder width, for the finale card's
 *  step-aside. Generous on purpose: it dances. */
const GOOP_HALF_WIDTH = 0.34;
/** Hand mode: how far ahead, and how far under the eyes, a panel lands —
 *  where a fingertip falls with the elbow bent. */
const HAND_REACH = 0.42;
const HAND_DROP = 0.3;

export class MenuSystem extends createSystem({}) {
  private board!: Panel;
  private card!: Panel;
  /** THE BOX PANEL — one standing machine, opened up. */
  private box!: Panel;
  /** THANKS FOR PLAYING. */
  private finale!: Panel;
  /** THE COACH LINE — the first sheet's one sentence. */
  private coach!: Panel;
  private pointers!: Record<'left' | 'right', PointerRay>;
  private ray = new Raycaster();
  private hits: Intersection[] = [];
  private hover: string | null = null;
  private tab: Tab = 'factory';
  private lastKey = '';
  private clock = 0;
  /** The rail marker slides between tabs instead of teleporting. */
  private railY = NaN;
  private railTargetY = NaN;
  /** RESET PROGRESS asks twice; the arm decays after a beat. */
  private resetArm = 0;
  /** QUIT is armed, not instant. A shift card mis-click used to take a
   *  whole floor of plant with it — the same two-press confirm RESET
   *  PROGRESS has always had, for the same reason. Seconds remaining. */
  private quitArm = 0;
  private lastScreen = '';
  private lastHandMode = false;
  /** THE CORE PANEL (hands): the bank and the upgrades, on the core. */
  private core!: Panel;
  /** Per-hand poke state: a press fires once, then waits for the tip to
   *  come back out of the face. */
  private poke: Record<'left' | 'right', { armed: boolean }> = {
    left: { armed: true },
    right: { armed: true },
  };
  /** The factory card's page: the catalogue, or the bank's bills. */
  private cardMode: 'build' | 'goals' | 'supply' | 'controls' = 'build';
  /** The GOALS page's open sheet (null = the list). */
  private goalOpen: number | null = null;

  init(): void {
    this.board = new Panel(BOARD.widthM, BOARD.heightM, W, H);
    this.scene.add(this.board.group);

    this.card = new Panel(BOARD.cardW, BOARD.cardH, BOARD.cardPx[0], BOARD.cardPx[1]);
    this.card.setShown(false, true);
    this.scene.add(this.card.group);

    this.box = new Panel(BOARD.boxW, BOARD.boxH, BOARD.boxPx[0], BOARD.boxPx[1]);
    this.box.setShown(false, true);
    this.scene.add(this.box.group);

    this.core = new Panel(0.62, 0.7, 620, 700);
    this.core.setShown(false, true);
    this.scene.add(this.core.group);

    this.finale = new Panel(BOARD.widthM * 0.78, BOARD.heightM * 0.78, 1060, 700);
    this.finale.setShown(false, true);
    this.finale.alwaysOnTop();
    this.scene.add(this.finale.group);

    this.coach = new Panel(BOARD.coachW, BOARD.coachH, BOARD.coachPx[0], BOARD.coachPx[1]);
    this.coach.setShown(false, true);
    this.scene.add(this.coach.group);

    this.pointers = { left: new PointerRay(this.scene), right: new PointerRay(this.scene) };

    this.plant(this.board.group, BOARD.position[1], 1.35);

    menuView.setTab = (t) => {
      this.tab = t;
      this.lastKey = '';
    };
    menuView.setHover = (id) => {
      this.hover = id;
      this.lastKey = '';
    };
    menuView.setPause = (on) => {
      site.paused = on && (site.screen === 'shift' || site.screen === 'factory');
      this.lastKey = '';
    };
    menuView.act = (id) => this.action(id);
    menuView.snapBoard = () => (this.board.ctx().canvas as HTMLCanvasElement).toDataURL('image/png');
    menuView.boardButtons = () => this.board.liveButtons();
    menuView.snapCard = () => (this.card.ctx().canvas as HTMLCanvasElement).toDataURL('image/png');
    menuView.cardButtons = () => this.card.buttonIds();
    menuView.cardRects = () => this.card.buttonRects();
    menuView.cardLabels = () => this.card.buttonLabels();
    menuView.cardLayout = () => this.card.layout();
    menuView.inspect = (unitId) => {
      if (!unitById(unitId)) return;
      site.inspect = unitId;
      site.paused = true;
      this.lastKey = '';
    };
    menuView.boxButtons = () => this.box.buttonIds();
    menuView.boxLabels = () => this.box.buttonLabels();
    menuView.boxRects = () => this.box.buttonRects();
    menuView.boxLayout = () => this.box.layout();
    menuView.snapBox = () => (this.box.ctx().canvas as HTMLCanvasElement).toDataURL('image/png');
    menuView.finaleUp = () => site.finale;
    menuView.finaleButtons = () => this.finale.buttonIds();
    menuView.panelsUp = () =>
      (
        [
          ['board', this.board],
          ['card', this.card],
          ['box', this.box],
          ['core', this.core],
          ['finale', this.finale],
        ] as Array<[string, Panel]>
      )
        .filter(([, p]) => p.isShown)
        .map(([n]) => n);
    menuView.buttonWorld = (id) => {
      for (const panel of [this.board, this.card, this.box, this.core, this.finale]) {
        if (!panel.isShown) continue;
        const r = panel.buttonRects().find((b) => b.id === id);
        if (!r) continue;
        const lay = panel.layout();
        const geo = panel.mesh.geometry as import('three').PlaneGeometry;
        const lx = ((r.x + r.w / 2) / lay.w - 0.5) * geo.parameters.width;
        const ly = (0.5 - (r.y + r.h / 2) / lay.h) * geo.parameters.height;
        panel.mesh.updateWorldMatrix(true, false);
        const p = new Vector3(lx, ly, 0).applyMatrix4(panel.mesh.matrixWorld);
        const n = new Vector3(0, 0, 1).transformDirection(panel.mesh.matrixWorld);
        return { x: p.x, y: p.y, z: p.z, nx: n.x, ny: n.y, nz: n.z };
      }
      return null;
    };
    menuView.snapFinale = () =>
      (this.finale.ctx().canvas as HTMLCanvasElement).toDataURL('image/png');
    menuView.coachUp = () => this.coach.isShown;
    menuView.snapCoach = () => (this.coach.ctx().canvas as HTMLCanvasElement).toDataURL('image/png');
  }

  /** Does the shift want the coach line up: a sheet that carries one,
   *  its live run still placing, and the hands not under the card. */
  private coachWanted(): boolean {
    if (site.screen !== 'shift' || site.paused) return false;
    if (!jobSpec().coach) return false;
    const run = site.runs[site.activeRun];
    return Boolean(run && run.phase === 'place');
  }

  /** Plant a panel in front of the player's face: forward on the floor
   *  plane, at a comfortable height, facing back at them. */
  private plant(group: Object3D, height: number, reach: number, handScale = 0.6): void {
    this.camera.getWorldPosition(_origin);
    this.camera.getWorldDirection(_fwd);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    _fwd.normalize();
    // WITHIN REACH, ON HANDS. A hand presses a panel by touching it, so
    // the panel comes to where a fingertip falls — a forearm out, a hand
    // below the eyes — and shrinks to fit there (same canvas, so every
    // layout and font below is unchanged; it is just nearer and smaller).
    if (intents.handMode) {
      reach = HAND_REACH;
      height = _origin.y - HAND_DROP;
    }
    group.scale.setScalar(intents.handMode ? handScale : 1);
    group.position.set(_origin.x + _fwd.x * reach, height, _origin.z + _fwd.z * reach);
    group.rotation.set(0, Math.atan2(_fwd.x, _fwd.z) + Math.PI, 0);
  }

  /**
   * Plant a panel that must NOT land on something else in the room —
   * which, on the last screen, is the whole creature you just made.
   *
   * The finale card used to go dead ahead like every other panel, so it
   * came up ON the goop: the gel is transparent and writes no depth, but
   * its EYES are solid, so the card drew over the body and the eyes drew
   * over the card. Half a creature in front of a sign and half behind
   * it. The card steps aside instead: if `avoid` falls inside the cone
   * the card will occupy, the placement bearing swings just past it —
   * to whichever side moves it less — so the sign stands BESIDE the
   * thing it is congratulating you for, and both are whole.
   */
  private plantClear(
    group: Object3D,
    height: number,
    reach: number,
    halfWidth: number,
    avoid: Vector3 | null,
  ): void {
    this.camera.getWorldPosition(_origin);
    this.camera.getWorldDirection(_fwd);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    _fwd.normalize();
    let yaw = Math.atan2(_fwd.x, _fwd.z);
    if (avoid) {
      _avoid.copy(avoid).sub(_origin);
      _avoid.y = 0;
      const range = _avoid.length();
      if (range > 0.2) {
        // How wide each of them looks from here, plus a little air.
        const cardHalf = Math.atan2(halfWidth, reach);
        const goopHalf = Math.atan2(GOOP_HALF_WIDTH, range);
        const clear = cardHalf + goopHalf + 0.1;
        let off = Math.atan2(_avoid.x, _avoid.z) - yaw;
        off = Math.atan2(Math.sin(off), Math.cos(off)); // to (-pi, pi]
        if (Math.abs(off) < clear) yaw += off >= 0 ? -(clear - off) : clear + off;
      }
    }
    if (intents.handMode) {
      reach = HAND_REACH;
      height = _origin.y - HAND_DROP;
    }
    group.scale.setScalar(intents.handMode ? 0.5 : 1);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    group.position.set(_origin.x + fx * reach, height, _origin.z + fz * reach);
    group.rotation.set(0, yaw + Math.PI, 0);
  }

  /** The plant's idle envelope — the under-halo's slow chug. */
  private chug(): number {
    const t = (this.clock % 2.4) / 2.4;
    const att = Math.min(1, t / 0.1);
    return att * (1 - t) ** 2;
  }

  update(delta: number): void {
    this.clock += delta;
    this.resetArm = Math.max(0, this.resetArm - delta);
    this.quitArm = Math.max(0, this.quitArm - delta);

    if (site.screen === 'shift') site.elapsedMs += delta * 1000;

    // Mid-shift (pipe jobs and factory orders alike), Ⓐ raises the card —
    // and, if the box panel happens to be open, puts THAT away first.
    // One button, one back-step, which is what a hand expects of it.
    const midShift = site.screen === 'shift' || site.screen === 'factory';
    if (midShift) {
      if (intents.menu) {
        sfx.uiClick();
        if (site.inspect >= 0) {
          this.closeBox();
        } else {
          site.paused = !site.paused;
          if (site.paused) this.plant(this.card.group, BOARD.cardPosition[1], 1.0, 0.5);
        }
        this.lastKey = '';
      }
    } else if (site.paused) {
      site.paused = false;
      site.inspect = -1;
    }

    // A box that stopped existing (the wrecking bar, DOWN TOOLS) closes
    // its own panel rather than painting a card about nothing.
    if (site.inspect >= 0 && (!unitById(site.inspect) || site.screen !== 'factory')) {
      this.closeBox();
    }

    // THANKS FOR PLAYING outranks everything: it comes up once, and it
    // is not something to have a box panel open in front of.
    const boardUp = site.screen === 'board';
    const finaleUp = site.finale;
    const boxUp = site.inspect >= 0 && site.screen === 'factory' && !finaleUp;
    const cardUp = site.paused && midShift && !boxUp && !finaleUp;
    // THE CORE, on hands, opens its own panel: the bank and the upgrades
    // — poked, so the things you spend live on the thing you defend.
    const coreUp = false;
    const boxShow = boxUp && !coreUp;
    // Switching between hands and controllers re-plants the board, so it
    // is always at the distance (and size) the input in hand wants.
    if (boardUp && intents.handMode !== this.lastHandMode) {
      this.plant(this.board.group, BOARD.position[1], 1.35, 0.46);
      this.lastKey = '';
    }
    this.lastHandMode = intents.handMode;
    // THE COACH LINE: the first sheet's one sentence, up while its
    // flange rides the ray and the card is not. The card pauses the
    // hands and says the same thing bigger, so the two never stack.
    const coachUp = this.coachWanted() && !cardUp;

    // The board re-plants every time it comes back — you wandered.
    if (site.screen !== this.lastScreen) {
      this.lastScreen = site.screen;
      if (boardUp) {
        this.plant(this.board.group, BOARD.position[1], 1.35, 0.46);
        this.lastKey = '';
      }
    }
    // The box panel and the finale card come to WHERE YOU ARE, the same
    // as everything else in this file: you clicked a box from wherever
    // you were standing, so that is where the answer appears.
    if (boxShow && !this.box.isShown) this.plant(this.box.group, BOARD.boxPosition[1], 0.86, 0.7);
    if (coreUp && !this.core.isShown) this.plant(this.core.group, BOARD.boxPosition[1], 0.86, 0.62);
    if (finaleUp && !this.finale.isShown) {
      // …and the finale card comes to where you are AND steps out of
      // the creature's way, which is the only thing on the last screen
      // worth looking at.
      const g = goopView.state?.();
      this.plantClear(
        this.finale.group,
        1.4,
        1.5,
        (BOARD.widthM * 0.78) / 2,
        g ? _avoidAt.set(g.x, g.y, g.z) : null,
      );
    }

    // The coach line comes to where you are, like everything else in
    // this file — planted the moment it rises, never followed (a sign
    // that chases the head is a sign you cannot read).
    if (coachUp && !this.coach.isShown) this.plant(this.coach.group, BOARD.coachPosition[1], 0.9);

    this.board.setShown(boardUp);
    this.card.setShown(cardUp);
    this.box.setShown(boxShow);
    this.core.setShown(coreUp);
    this.finale.setShown(finaleUp);
    this.coach.setShown(coachUp);

    const pulse = this.chug();

    if (!boardUp && !cardUp && !boxUp && !finaleUp) {
      this.pointers.left.hide();
      this.pointers.right.hide();
      // Nothing to press — but the coach line may still want painting.
      this.repaintIfNeeded(boardUp, cardUp, boxUp, finaleUp, coachUp);
      this.board.tick(delta, pulse);
      this.card.tick(delta, pulse);
      this.box.tick(delta, pulse);
      this.core.tick(delta, pulse);
      this.finale.tick(delta, pulse);
      this.coach.tick(delta, pulse);
      return;
    }

    // Pointers + hover + click.
    const targets: Object3D[] = [];
    if (boardUp) targets.push(this.board.mesh);
    if (cardUp) targets.push(this.card.mesh);
    if (boxShow) targets.push(this.box.mesh);
    if (coreUp) targets.push(this.core.mesh);
    if (finaleUp) targets.push(this.finale.mesh);

    let hover: string | null = null;
    let clicked: string | null = null;
    let clickedPanel: Panel | null = null;
    for (const hand of ['left', 'right'] as const) {
      const hit = this.updatePointer(hand, delta, targets);
      if (hit?.uv) {
        const panel = this.panelOf(hit.object);
        const id = panel?.buttonAt(hit.uv.x, hit.uv.y) ?? null;
        if (id) {
          hover = id;
          if (intents[hand].point.down) {
            clicked = id;
            clickedPanel = panel;
            this.pointers[hand].click();
          }
        }
      }
    }
    // THE POKE: a fingertip pushed through a panel's face presses what
    // is under it. Hover is the tip within a few centimetres of the face.
    for (const hand of ['left', 'right'] as const) {
      const st = this.poke[hand];
      const tipObj = this.world.playerSpaceEntities?.indexTipSpaces?.[hand]?.object3D;
      if (intents[hand].mode !== 'hand' || !tipObj) {
        st.armed = true;
        continue;
      }
      tipObj.getWorldPosition(_tip);
      let over: { panel: Panel; id: string | null; depth: number } | null = null;
      for (const panel of [this.board, this.card, this.box, this.core, this.finale]) {
        if (!panel.isShown) continue;
        const at = panel.pokeAt(_tip);
        if (!at || at.depth > POKE.hover || at.depth < -POKE.through) continue;
        over = { panel, id: panel.buttonAt(at.u, at.v), depth: at.depth };
        break;
      }
      if (!over) {
        st.armed = true;
        continue;
      }
      if (over.id) hover = over.id;
      if (over.depth > POKE.rearm) st.armed = true;
      else if (over.depth < POKE.press && st.armed && over.id) {
        st.armed = false;
        clicked = over.id;
        clickedPanel = over.panel;
      }
    }
    if (hover !== this.hover) {
      this.hover = hover;
      this.lastKey = '';
      if (hover) sfx.uiHover();
    }
    if (clicked) {
      sfx.uiClick();
      clickedPanel?.press(clicked);
      this.action(clicked);
    }

    // The rail marker's slide.
    if (boardUp && Number.isFinite(this.railY) && Number.isFinite(this.railTargetY)) {
      const gap = this.railTargetY - this.railY;
      if (Math.abs(gap) > 0.5) {
        this.railY += gap * Math.min(1, delta / 0.09);
        this.lastKey = '';
      } else if (this.railY !== this.railTargetY) {
        this.railY = this.railTargetY;
        this.lastKey = '';
      }
    }

    this.repaintIfNeeded(boardUp, cardUp, boxUp, finaleUp, coachUp);
    this.board.tick(delta, pulse);
    this.card.tick(delta, pulse);
    this.box.tick(delta, pulse);
    this.core.tick(delta, pulse);
    this.finale.tick(delta, pulse);
    this.coach.tick(delta, pulse);
  }

  /** Which of our four panels a raycast landed on. */
  private panelOf(obj: Object3D): Panel | null {
    if (obj === this.board.mesh) return this.board;
    if (obj === this.card.mesh) return this.card;
    if (obj === this.box.mesh) return this.box;
    if (obj === this.core.mesh) return this.core;
    if (obj === this.finale.mesh) return this.finale;
    return null;
  }

  /** Put the box panel away and give the hands back. */
  private closeBox(): void {
    site.inspect = -1;
    site.paused = false;
    this.lastKey = '';
  }

  private updatePointer(
    hand: 'left' | 'right',
    delta: number,
    targets: Object3D[],
  ): Intersection | undefined {
    const p = this.pointers[hand];
    const rayObj = this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D;
    if (!rayObj) {
      p.hide();
      return undefined;
    }
    rayObj.getWorldPosition(_origin);
    rayObj.getWorldDirection(_dir).negate();
    this.ray.set(_origin, _dir);
    this.hits.length = 0;
    const hit = this.ray.intersectObjects(targets, false, this.hits)[0];
    const overButton = Boolean(
      hit?.uv && this.panelOf(hit.object)?.buttonAt(hit.uv.x, hit.uv.y),
    );
    p.update(delta, _origin, hit ? hit.point : null, overButton);
    return hit;
  }

  /* ── actions ──────────────────────────────────────────────────────────── */

  private action(id: string): void {
    if (id === 'tab:jobs') this.tab = 'jobs';
    // 'tab:orders' is kept as an alias on purpose: the tools and anyone's
    // muscle memory both still say it, and a renamed tab is no reason to
    // break a door that already works.
    else if (id === 'tab:factory' || id === 'tab:orders') this.tab = 'factory';
    else if (id === 'tab:controls') this.tab = 'controls';
    else if (id === 'tab:sys') this.tab = 'sys';
    else if (id.startsWith('job:')) {
      const i = Number(id.slice(4));
      if (i < unlockedJobs()) site.jobIndex = i;
    } else if (id === 'start') {
      startJob(site.jobIndex);
    } else if (id === 'start-order') {
      // ONE DOOR, and no argument: startShop with nothing passed means
      // "where the book got to". Passing 0 here is what threw a returning
      // player's whole progress away — the resume logic was in place and
      // the only caller in the game was walking straight past it.
      startShop();
    } else if (id.startsWith('box:')) {
      this.boxAction(id.slice(4));
    } else if (id === 'finale:close') {
      site.finale = false;
      plant.goop = 'done';
    } else if (id === 'fin:retry') {
      retrySiege();
    } else if (id === 'fin:board') {
      site.finale = false;
      abandonFactory();
    } else if (id === 'card:start') {
      startWave();
      site.paused = false;
    } else if (id.startsWith('build:')) {
      // Arm the tool and put the card away — the hands do the rest.
      buildView.arm?.(id.slice(6) as BuildTool);
      site.paused = false;
    } else if (id === 'card:build') {
      this.cardMode = 'build';
    } else if (id === 'card:goals') {
      this.cardMode = 'goals';
    } else if (id === 'card:supply') {
      this.cardMode = 'supply';
    } else if (id === 'card:controls') {
      this.cardMode = 'controls';
    } else if (id === 'goal:back') {
      // BEFORE the prefix test below — 'goal:back' starts with 'goal:'
      // too, and parsing it as an index put NaN in goalOpen, which sent
      // the detail paint through ORDERS[NaN] and threw inside the paint
      // callback every frame. That is how a menu bricks a game.
      this.goalOpen = null;
    } else if (id.startsWith('goal:')) {
      const i = Number(id.slice(5));
      this.goalOpen = Number.isInteger(i) && i >= 0 && i < ORDERS.length ? i : null;
    } else if (id.startsWith('buy:')) {
      buyUpgrade(id.slice(4) as UpgradeId);
    } else if (id === 'sfx:down') {
      setSfxVolume(Math.max(0, Math.round((sfxVolume() - 0.1) * 10) / 10));
    } else if (id === 'sfx:up') {
      setSfxVolume(Math.min(1, Math.round((sfxVolume() + 0.1) * 10) / 10));
    } else if (id === 'mus:down') {
      setMusicVolume(Math.max(0, Math.round((musicVolume() - 0.1) * 10) / 10));
    } else if (id === 'mus:up') {
      setMusicVolume(Math.min(1, Math.round((musicVolume() + 0.1) * 10) / 10));
    } else if (id === 'walls:toggle') {
      site.showWalls = !site.showWalls;
    } else if (id === 'floor:set') {
      enterFloorSetup();
    } else if (id === 'reset') {
      if (this.resetArm > 0) {
        resetProgress();
        site.jobIndex = 0;
        this.resetArm = 0;
      } else {
        this.resetArm = 3;
      }
    } else if (id === 'resume') {
      site.paused = false;
      site.inspect = -1;
      this.quitArm = 0;
    } else if (id === 'quit') {
      // Ask once. Everything standing on the floor is about to go.
      if (this.quitArm <= 0) {
        this.quitArm = 4;
        return;
      }
      this.quitArm = 0;
      site.paused = false;
      if (site.screen === 'factory') abandonFactory();
      else abandonShift();
    }
    this.lastKey = '';
  }

  /**
   * THE BOX PANEL'S VERBS.
   *
   * UNPLUG is the one that had to exist: playtest said "we can't
   * disconnect the tubes when they're connected to the boxes — I delete
   * the boxes at the moment", which is a sentence about a missing verb,
   * not a missing button. The tug (both hands on the collar, haul and
   * hold) is still the good way to do it in the room; this is the way
   * you can find, and it goes through the same sim door, so the hum
   * stops and the iris shuts identically.
   */
  private boxAction(what: string): void {
    const unit = unitById(site.inspect);
    if (!unit) {
      this.closeBox();
      return;
    }
    if (what === 'close') {
      this.closeBox();
      return;
    }
    if (what === 'upgrade') {
      if (!upgradeTower(unit)) sfx.oneHandRattle();
      this.lastKey = '';
      return;
    }
    if (what === 'turn') {
      unit.rot = ((unit.rot + 1) % 4) as typeof unit.rot;
      plant.generation++;
      sfx.segmentClick(unit.rot);
      return;
    }
    if (what === 'remove') {
      if (unit.type === 'dock') return; // the core stays
      refundUnit(unit);
      removeUnit(unit);
      sfx.boltSpin();
      sfx.droopSettle();
      this.closeBox();
    }
  }

  /* ── painting ─────────────────────────────────────────────────────────── */

  private repaintIfNeeded(
    boardUp: boolean,
    cardUp: boolean,
    boxUp: boolean,
    finaleUp: boolean,
    coachUp: boolean,
  ): void {
    const runsKey = site.runs.map((r) => r.phase).join(',');
    const key = [
      site.screen,
      this.tab,
      this.hover,
      site.jobIndex,
      unlockedJobs(),
      JOBS.map((j) => bestMs(j.id) ?? 0).join(','),
      sfxVolume().toFixed(1),
      musicVolume().toFixed(1),
      nowPlaying() ?? '',
      site.showWalls,
      this.resetArm > 0,
      this.quitArm > 0,
      walls.length,
      site.fallbackRoom,
      site.stageRoom,
      stage.why,
      site.wallsReady,
      runsKey,
      ordersUnlocked(),
      bookFinished(),
      ORDERS.map((o) => orderBestMs(o.id) ?? 0).join(','),
      plant.mode,
      plant.orderIndex,
      plant.count,
      plant.goop,
      Math.floor(plant.brewT * 4),
      bankTotal(),
      Object.entries(plant.bank).map(([k, n]) => `${k}${n}`).join(''),
      buildView.armed?.() ?? '',
      this.cardMode,
      this.goalOpen,
      plant.goalsDone,
      ownedUpgrades().join(','),
      site.inspect,
      // The box panel is a LIVE window on one machine: a part landing in
      // the chest you are looking at has to appear, so the contents are
      // part of the key.
      boxUp ? this.boxKey() : '',
      plant.siege.coins,
      site.finale,
      intents.handMode,
      plant.siege.phase,
      plant.siege.wave,
      cardUp
        ? Math.floor((site.screen === 'factory' ? plant.elapsedMs : site.elapsedMs) / 100)
        : 0,
    ].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    if (boardUp) this.paintBoard();
    if (cardUp) this.paintCard();
    if (boxUp) this.paintBox();
    if (finaleUp) this.paintFinale();
    if (coachUp) this.paintCoach();
  }

  /* ── THE COACH LINE ───────────────────────────────────────────────────── */

  /** One sentence in the room, under the line's own name and colour: which
   *  line, what to do with it. No buttons — it is read, not pressed. Before
   *  the scan lands there is no plaster to aim at, so it says that instead. */
  private paintCoach(): void {
    const [cw] = BOARD.coachPx;
    const run = site.runs[site.activeRun];
    const text = site.wallsReady ? (jobSpec().coach ?? '') : 'Look around to find walls.';
    this.coach.paint(
      '',
      (g) => {
        g.textBaseline = 'middle';
        g.textAlign = 'left';
        if (run) {
          g.fillStyle = run.line.hex;
          g.beginPath();
          g.arc(52, 58, 9, 0, Math.PI * 2);
          g.fill();
          g.font = font(700, 24);
          g.letterSpacing = '3px';
          g.fillText(`${run.line.name} \u00b7 MOUNT THE FLANGE`, 74, 59);
          g.letterSpacing = '0px';
        }
        wrapText(g, text, 44, 104, cw - 88, 34, font(600, 29), UI.text);
      },
      [],
      null,
    );
  }

  /** Everything about the inspected box that could change under you. */
  private boxKey(): string {
    const unit = unitById(site.inspect);
    if (!unit) return 'gone';
    const held = [
      ...chestParts(unit.id),
      ...chuteParts(unit.id),
      ...plant.parts.filter((p) => p.at.kind === 'belt' && p.at.unit === unit.id),
    ]
      .map((p) => p.item)
      .join(',');
    const run = runSeatedAt(unit.id);
    return [
      unit.id,
      unit.rot,
      Math.round((unit.hp / Math.max(1, unit.maxHp)) * 20),
      levelOf(unit),
      held,
      unit.ports.join('/'),
      unit.craftT >= 0,
      run ? `${run.line.id}:${run.phase}` : '-',
    ].join('~');
  }

  private paintBoard(): void {
    const buttons: PanelButton[] = [];

    // The rail.
    const tabs: Array<{ id: string; tab: Tab; label: string }> = [
      { id: 'tab:factory', tab: 'factory', label: 'SIEGE' },
      { id: 'tab:controls', tab: 'controls', label: 'HANDS' },
      { id: 'tab:sys', tab: 'sys', label: 'SETTINGS' },
    ];
    tabs.forEach((t, i) => {
      buttons.push({
        id: t.id,
        label: t.label,
        x: RAIL_X,
        y: 172 + i * 104,
        w: RAIL_W,
        h: 90,
        selected: this.tab === t.tab,
      });
    });
    this.railTargetY = 172 + Math.max(0, tabs.findIndex((t) => t.tab === this.tab)) * 104;
    if (!Number.isFinite(this.railY)) this.railY = this.railTargetY;

    // Each tab painter installs its own body; the shared chrome fronts it.
    this.boardJobsBody = null;
    this.boardOrdersBody = null;
    this.boardControlsBody = null;
    this.boardSysBody = null;
    if (this.tab === 'jobs') this.paintJobs(buttons);
    else if (this.tab === 'factory') this.paintFactoryTab(buttons);
    else if (this.tab === 'controls') this.paintControls();
    else this.paintSystem(buttons);

    this.board.paint('', (g) => this.paintBoardBody(g), buttons, this.hover);
  }

  /** Header chrome: the emblem and wordmark, the room status, the rail's
   *  marker. */
  private paintChrome(g: CanvasRenderingContext2D): void {
    // THE EMBLEM: the core on its hex pad — the thing the whole game is
    // about, standing where a logo would.
    const ex = RAIL_X + 50;
    const ey = 76;
    hexPad(g, ex, ey, 48, SKIN.gold);
    unitGlyph(g, 'dock', ex - 34, ey - 36, 68);

    // The wordmark, lit, and the line under it.
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.font = font(700, 60);
    g.letterSpacing = '7px';
    g.fillStyle = UI.textHi;
    g.shadowColor = rgba(SKIN.gold, 0.6);
    g.shadowBlur = 18;
    g.fillText(GAME_TITLE, RAIL_X + 118, 82);
    g.shadowBlur = 0;
    g.letterSpacing = '0px';
    g.textBaseline = 'middle';
    caps(g, 'BUILD THE TOWERS \u00b7 HOLD THE CORE', RAIL_X + 122, 112, { px: 19, color: SKIN.gold, track: 5 });

    // Room status, top right, in its own chip: what the scan gave us.
    // Walls only — the floor and ceiling are registry citizens too, but
    // "6 WALLS" over a four-walled room reads as a bug, not a feature.
    const real = walls.filter((w) => w.real && w.kind === 'wall').length;
    const label = !site.wallsReady
      ? 'WAITING FOR WALLS'
      : site.stageRoom
        ? 'ROOM-SCALE BOX'
        : site.fallbackRoom
          ? 'STAND-IN ROOM'
          : `ROOM SCANNED \u00b7 ${real} WALL${real === 1 ? '' : 'S'}`;
    const tone = site.fallbackRoom || !site.wallsReady ? UI.warn : UI.positive;
    g.font = font(600, 21);
    g.letterSpacing = '2px';
    const tw = g.measureText(label).width;
    g.letterSpacing = '0px';
    const chipW = tw + 70;
    const chipX = W - 40 - chipW;
    well(g, chipX, 52, chipW, 50, 12, rgba(tone, 0.35));
    dot(g, chipX + 26, 77, 7, tone);
    caps(g, label, chipX + 46, 78, { px: 21, color: tone, track: 2 });

    // The divider: gold off the emblem side, fading across.
    const div = g.createLinearGradient(RAIL_X, 0, W - 32, 0);
    div.addColorStop(0, rgba(SKIN.gold, 0.7));
    div.addColorStop(0.35, rgba(SKIN.gold, 0.18));
    div.addColorStop(1, 'rgba(160,185,255,0.08)');
    g.strokeStyle = div;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(RAIL_X, 142);
    g.lineTo(W - 32, 142);
    g.stroke();

    // The rail marker: a gold blade sliding to the active tab.
    if (Number.isFinite(this.railY)) {
      g.save();
      g.shadowColor = SKIN.gold;
      g.shadowBlur = 12;
      g.fillStyle = SKIN.gold;
      g.beginPath();
      g.moveTo(RAIL_X - 14, this.railY + 16);
      g.lineTo(RAIL_X - 8, this.railY + 22);
      g.lineTo(RAIL_X - 8, this.railY + 68);
      g.lineTo(RAIL_X - 14, this.railY + 74);
      g.closePath();
      g.fill();
      g.restore();
    }
  }

  /* ── JOBS tab ─────────────────────────────────────────────────────────── */

  private paintJobs(buttons: PanelButton[]): void {
    const unlocked = unlockedJobs();
    JOBS.forEach((_job, i) => {
      buttons.push({
        id: `job:${i}`,
        label: '',
        ghost: true,
        disabled: i >= unlocked,
        x: ROW_X,
        y: ROW_Y0 + i * ROW_PITCH,
        w: ROW_W,
        h: ROW_H,
      });
    });
    const job = JOBS[site.jobIndex];
    const locked = site.jobIndex >= unlocked;
    buttons.push({
      id: 'start',
      label: locked ? 'LOCKED' : 'START JOB',
      sub: locked ? 'finish the sheet above it' : job.name,
      primary: !locked,
      disabled: locked || !site.wallsReady,
      x: SHEET_X + 10,
      y: H - 164,
      w: SHEET_W - 20,
      h: 112,
    });

    const hoverOf = (id: string): number => this.board.hoverOf(id);
    this.boardJobsBody = (g: CanvasRenderingContext2D): void => {
      const unlockedNow = unlockedJobs();
      JOBS.forEach((j, i) => {
        const y = ROW_Y0 + i * ROW_PITCH;
        const open = i < unlockedNow;
        const selected = i === site.jobIndex;
        const hov = hoverOf(`job:${i}`);
        // Plate.
        g.fillStyle = selected
          ? UI.accentFaint
          : `rgba(255,255,255,${(open ? 0.045 + 0.045 * hov : 0.02).toFixed(3)})`;
        g.beginPath();
        g.roundRect(ROW_X, y, ROW_W, ROW_H, 16);
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = selected
          ? 'rgba(255,162,46,0.9)'
          : `rgba(255,255,255,${(open ? 0.1 + 0.2 * hov : 0.05).toFixed(3)})`;
        g.stroke();
        if (selected) {
          g.fillStyle = UI.accent;
          g.beginPath();
          g.roundRect(ROW_X + 7, y + 12, 5, ROW_H - 24, 2.5);
          g.fill();
        }
        // Name + the run pips in their line colours.
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.font = font(600, 33);
        g.letterSpacing = '1.5px';
        g.fillStyle = open ? UI.text : UI.disabled;
        g.fillText(`${i + 1}. ${j.name}`, ROW_X + 26, y + 36, ROW_W - 150);
        g.letterSpacing = '0px';
        j.runs.forEach((lineId, r) => {
          const line = LINES[lineId];
          g.fillStyle = open ? line.hex : 'rgba(255,255,255,0.14)';
          g.beginPath();
          g.arc(ROW_X + 34 + r * 34, y + 82, 9, 0, Math.PI * 2);
          g.fill();
        });
        // Best time (or the lock).
        g.textAlign = 'right';
        g.font = font(500, 24);
        if (!open) {
          g.fillStyle = UI.disabled;
          g.fillText('LOCKED', ROW_X + ROW_W - 22, y + 82);
        } else {
          const best = bestMs(j.id);
          g.fillStyle = best === null ? UI.faint : UI.dim;
          g.fillText(best === null ? '—' : fmtMs(best), ROW_X + ROW_W - 22, y + 82);
        }
        if (j.longHaul && open) {
          g.textAlign = 'right';
          g.font = font(500, 20);
          g.fillStyle = UI.faint;
          g.fillText('LONG HAUL', ROW_X + ROW_W - 22, y + 36);
        }
      });

      // THE JOB SHEET.
      const sel = JOBS[site.jobIndex];
      g.fillStyle = UI.well;
      g.beginPath();
      g.roundRect(SHEET_X, ROW_Y0, SHEET_W, H - ROW_Y0 - 190, 18);
      g.fill();
      g.textAlign = 'left';
      g.font = font(700, 42);
      g.letterSpacing = '2px';
      g.fillStyle = UI.textHi;
      g.fillText(sel.name, SHEET_X + 26, ROW_Y0 + 52);
      g.letterSpacing = '0px';
      wrapText(g, sel.brief, SHEET_X + 26, ROW_Y0 + 106, SHEET_W - 52, 32, font(500, 25), UI.dim);
      // The lines this sheet wants, as service chips.
      sel.runs.forEach((lineId, r) => {
        const line = LINES[lineId];
        const cx = SHEET_X + 26 + r * 172;
        const cy = ROW_Y0 + 236;
        g.fillStyle = 'rgba(255,255,255,0.04)';
        g.beginPath();
        g.roundRect(cx, cy, 156, 62, 12);
        g.fill();
        g.strokeStyle = UI.lineFaint;
        g.lineWidth = 2;
        g.stroke();
        g.fillStyle = line.hex;
        g.beginPath();
        g.arc(cx + 30, cy + 31, 11, 0, Math.PI * 2);
        g.fill();
        g.font = font(600, 25);
        g.fillStyle = UI.text;
        g.fillText(line.name, cx + 52, cy + 33);
      });
      const best = bestMs(sel.id);
      g.font = font(500, 24);
      g.fillStyle = UI.faint;
      g.fillText('BEST', SHEET_X + 26, ROW_Y0 + 356);
      g.font = font(600, 34);
      g.fillStyle = best === null ? UI.faint : UI.text;
      g.fillText(best === null ? 'Not completed' : fmtMs(best), SHEET_X + 108, ROW_Y0 + 356);
      if (!site.wallsReady) {
        g.font = font(500, 23);
        g.fillStyle = UI.warn;
        g.fillText('Look around to find walls', SHEET_X + 26, ROW_Y0 + 412);
      }
    };
  }

  private boardJobsBody: ((g: CanvasRenderingContext2D) => void) | null = null;
  private boardOrdersBody: ((g: CanvasRenderingContext2D) => void) | null = null;
  private boardControlsBody: ((g: CanvasRenderingContext2D) => void) | null = null;
  private boardSysBody: ((g: CanvasRenderingContext2D) => void) | null = null;

  /* ── FACTORY tab (one door into the book) ────────────────────────────── */

  /**
   * THE FACTORY TAB — the book, and ONE button.
   *
   * It used to be a list of five startable sheets and it was actively
   * hostile: pressing sheet four dealt you a bare floor with sheet
   * four's demands and none of sheet one, two or three's plant, feeds or
   * parts. There was no way to succeed and no way to tell. Every row is
   * read-only now; the ladder is a MAP of the shift, not a menu of
   * shifts, and the shift itself has one entrance.
   */
  private paintFactoryTab(buttons: PanelButton[]): void {
    const held = bestWave();
    const CW = W - 34 - CONTENT_X;
    const CTA_Y = 744;
    const CTA_H = 122;
    const NOTE_W = 340;
    buttons.push(
      {
        id: 'start-order',
        label: 'MAN THE WALLS',
        sub: held > 0 ? 'the core is waiting' : 'something is in the walls',
        primary: true,
        px: 46,
        disabled: !site.wallsReady,
        x: CONTENT_X,
        y: CTA_Y,
        w: CW - NOTE_W - 18,
        h: CTA_H,
      },
      {
        // THE ONE CONTROL NOBODY CAN GUESS: every verb in the siege lives
        // on the menu, so the first thing to know is where the menu is.
        id: 'shop-note',
        label: 'LEFT PALM \u00b7 MENU',
        sub: 'turn it toward you',
        display: true,
        small: true,
        x: CONTENT_X + CW - NOTE_W,
        y: CTA_Y,
        w: NOTE_W,
        h: CTA_H,
      },
    );

    this.boardOrdersBody = (g: CanvasRenderingContext2D): void => {
      // THE HERO: the core, big, on its pad — and what you are doing here.
      const HY = 166;
      const HH = 300;
      well(g, CONTENT_X, HY, CW, HH, 18);
      const cx = CONTENT_X + 156;
      const cy = HY + HH / 2;
      g.save();
      const halo = g.createRadialGradient(cx, cy, 0, cx, cy, 170);
      halo.addColorStop(0, rgba(SKIN.gold, 0.18));
      halo.addColorStop(1, rgba(SKIN.gold, 0));
      g.fillStyle = halo;
      g.fillRect(CONTENT_X, HY, 320, HH);
      g.restore();
      hexPad(g, cx, cy + 10, 118, SKIN.gold);
      unitGlyph(g, 'dock', cx - 92, cy - 96, 184);

      const tx = CONTENT_X + 316;
      const tw = CW - 316 - 30;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.font = font(700, 46);
      g.letterSpacing = '4px';
      g.fillStyle = UI.textHi;
      g.fillText('HOLD THE CORE', tx, HY + 52);
      g.letterSpacing = '0px';
      wrapText(
        g,
        'Something lives behind your walls. Place your CORE and ring it with towers. They climb out of EVERY wall in their thousands, split the floor open, and chew through whatever stands in the way.',
        tx,
        HY + 100,
        tw,
        30,
        font(500, 23),
        UI.dim,
      );

      // THE RECORD: three figures, each a label over a number.
      const stats: Array<[string, string, string]> = [
        ['WAVES', `${WAVES.length}`, UI.text],
        ['BEST HELD', held > 0 ? `${held}` : '\u2014', held > 0 ? SKIN.gold : UI.faint],
        ['PUT DOWN', held > 0 ? bestKills().toLocaleString('en-US') : '\u2014', held > 0 ? SKIN.magentaSoft : UI.faint],
      ];
      const SW = (tw - 2 * 14) / 3;
      stats.forEach(([label, value, tone], k) => {
        const sx = tx + k * (SW + 14);
        const sy = HY + HH - 86;
        chamfer(g, sx, sy, SW, 66, 10);
        g.fillStyle = 'rgba(150,175,255,0.05)';
        g.fill();
        g.strokeStyle = SKIN.lineFaint;
        g.lineWidth = 1.5;
        g.stroke();
        caps(g, label, sx + 18, sy + 20, { px: 15, track: 3 });
        g.textAlign = 'left';
        g.font = font(700, 32);
        g.fillStyle = tone;
        g.fillText(value, sx + 18, sy + 46, SW - 30);
      });

      // IN THE WALLS — the three kinds, down the rail under the tabs, each
      // in the neon its legs glow on the floor.
      rule(g, 'IN THE WALLS', RAIL_X, RAIL_X + RAIL_W, 502);
      (['mite', 'beetle', 'hulk'] as const).forEach((id, k) => {
        const e = ENEMIES[id];
        const hue = `#${e.neon.toString(16).padStart(6, '0')}`;
        const ey = 524 + k * 116;
        chamfer(g, RAIL_X, ey, RAIL_W, 104, 12);
        g.fillStyle = rgba(hue, 0.05);
        g.fill();
        g.strokeStyle = rgba(hue, 0.28);
        g.lineWidth = 1.5;
        g.stroke();
        dot(g, RAIL_X + 22, ey + 26, 7, hue);
        g.textAlign = 'left';
        g.font = font(700, 23);
        g.letterSpacing = '2px';
        g.fillStyle = hue;
        g.fillText(e.name, RAIL_X + 40, ey + 27);
        g.letterSpacing = '0px';
        wrapText(g, e.docket, RAIL_X + 16, ey + 56, RAIL_W - 30, 21, font(500, 17), UI.faint);
      });

      // THE ARSENAL — every tower the siege will hand you, in its own neon.
      rule(g, 'THE ARSENAL', CONTENT_X, W - 34, 502);
      const kit: WeaponId[] = ['turret', 'hammer', 'flamer', 'tesla', 'mortar'];
      const GAP = 14;
      const AW = (CW - GAP * (kit.length - 1)) / kit.length;
      const AY = 524;
      const AH = 196;
      kit.forEach((w, k) => {
        const ax = CONTENT_X + k * (AW + GAP);
        const hue = neonOf(w);
        chamfer(g, ax, AY, AW, AH, 14);
        const plate = g.createLinearGradient(0, AY, 0, AY + AH);
        plate.addColorStop(0, rgba(hue, 0.1));
        plate.addColorStop(1, 'rgba(150,175,255,0.02)');
        g.fillStyle = plate;
        g.fill();
        g.strokeStyle = rgba(hue, 0.38);
        g.lineWidth = 2;
        g.stroke();
        hexPad(g, ax + AW / 2, AY + 74, 56, hue);
        unitGlyph(g, w, ax + AW / 2 - 46, AY + 22, 92);
        g.textAlign = 'center';
        g.font = font(700, 23);
        g.letterSpacing = '2px';
        g.fillStyle = UI.text;
        g.fillText(TOWER_SHORT[w], ax + AW / 2, AY + 148, AW - 16);
        g.letterSpacing = '0px';
        caps(g, TOWER_ROLE[w], ax + AW / 2, AY + 174, { px: 14, color: hue, align: 'center', track: 2, max: AW - 70 });
        price(g, WEAPONS[w].cost, ax + AW - 14, AY + 22, { px: 18, align: 'right' });
      });

      if (!site.wallsReady) {
        caps(g, 'LOOK AROUND TO FIND YOUR WALLS', CONTENT_X + (CW - NOTE_W - 18) / 2, CTA_Y - 14, {
          px: 17,
          color: UI.warn,
          align: 'center',
        });
      }
    };
  }

  /* ── HANDS tab ────────────────────────────────────────────────────────── */

  /**
   * THE HANDS TAB — the whole game is five gestures, so this is a sheet
   * of five: each drawn on its pad beside what it does. No controllers:
   * the siege is played with bare hands. Read, not pressed.
   */
  private paintControls(): void {
    const rows: Array<{ shape: Gesture; name: string; does: string }> = [
      {
        shape: 'palm',
        name: 'OPEN YOUR LEFT PALM',
        does: 'Turn it toward you and the menu rises over it: the wave, the clock, your coins, START and PAUSE, and every tower you can build.',
      },
      {
        shape: 'poke',
        name: 'POKE',
        does: 'Poke a tower on your palm with your right index finger to pick it up; poke it again to put it back. Remember to close the panel to interact with something else.',
      },
      {
        shape: 'pinch',
        name: 'PINCH',
        does: 'Aim with your right hand and pinch to set the tower down, anywhere on the floor. Remember to close the panel to interact with something else.',
      },
      {
        shape: 'touch',
        name: 'TOUCH A TOWER',
        does: 'Reach out and touch one standing on the floor: its panel opens. UPGRADE it, or SELL it.',
      },
      {
        shape: 'fist',
        name: 'GRAB',
        does: 'Close a fist on a mite or a beetle and it is yours. Open your hand to throw it into the crowd.',
      },
    ];
    this.boardControlsBody = (g: CanvasRenderingContext2D): void => {
      const CW = W - 34 - CONTENT_X;
      const PITCH = 138;
      const RH = 124;
      rows.forEach((row, i) => {
        const y = 168 + i * PITCH;
        chamfer(g, CONTENT_X, y, CW, RH, 14);
        g.fillStyle = 'rgba(150,175,255,0.045)';
        g.fill();
        g.strokeStyle = SKIN.lineFaint;
        g.lineWidth = 1.5;
        g.stroke();
        const cx = CONTENT_X + 72;
        const cy = y + RH / 2;
        hexPad(g, cx, cy, 52, SKIN.gold);
        handGlyph(g, row.shape, cx - 42, cy - 42, 84);
        g.textBaseline = 'middle';
        caps(g, String(i + 1).padStart(2, '0'), CONTENT_X + CW - 22, y + 26, { px: 15, align: 'right', track: 2 });
        g.textAlign = 'left';
        g.font = font(700, 27);
        g.letterSpacing = '3px';
        g.fillStyle = SKIN.gold;
        g.fillText(row.name, CONTENT_X + 150, y + 34);
        g.letterSpacing = '0px';
        wrapText(g, row.does, CONTENT_X + 150, y + 72, CW - 210, 28, font(500, 22), UI.dim);
      });
      caps(g, 'TURN YOUR HAND AWAY AND THE MENU GOES. WALK \u2014 IT IS YOUR ROOM.', CONTENT_X, H - 34, {
        px: 15,
        track: 2,
      });
    };
  }

  /* ── SYSTEM tab ───────────────────────────────────────────────────────── */

  private paintSystem(buttons: PanelButton[]): void {
    const BX = CONTENT_X + 360;
    const stepW = 120;
    const valueW = 300;
    const BH = 84;
    const y0 = SYS_Y0;
    const rowY = (k: number): number => y0 + k * SYS_PITCH + 10;
    const fullW = stepW * 2 + valueW + 32;
    buttons.push(
      { id: 'sfx:down', label: '\u2212', x: BX, y: rowY(0), w: stepW, h: BH, px: 48 },
      {
        id: 'sfx:vol',
        label: `${Math.round(sfxVolume() * 100)}%`,
        display: true,
        ghost: true,
        x: BX + stepW + 16,
        y: rowY(0),
        w: valueW,
        h: BH,
      },
      { id: 'sfx:up', label: '+', x: BX + stepW + valueW + 32, y: rowY(0), w: stepW, h: BH, px: 48 },
      { id: 'mus:down', label: '\u2212', x: BX, y: rowY(1), w: stepW, h: BH, px: 48 },
      {
        id: 'mus:vol',
        label: `${Math.round(musicVolume() * 100)}%`,
        display: true,
        ghost: true,
        x: BX + stepW + 16,
        y: rowY(1),
        w: valueW,
        h: BH,
      },
      { id: 'mus:up', label: '+', x: BX + stepW + valueW + 32, y: rowY(1), w: stepW, h: BH, px: 48 },
      {
        id: 'walls:toggle',
        label: site.showWalls ? 'SHOWN' : 'HIDDEN',
        selected: site.showWalls,
        x: BX,
        y: rowY(2),
        w: fullW,
        h: BH,
      },
      {
        id: 'floor:set',
        label: 'SET THE FLOOR',
        x: BX,
        y: rowY(3),
        w: fullW,
        h: BH,
      },
      {
        id: 'reset',
        label: this.resetArm > 0 ? 'SURE? PRESS AGAIN' : 'RESET PROGRESS',
        tone: UI.danger,
        x: BX,
        y: rowY(4),
        w: fullW,
        h: BH,
        small: true,
      },
    );

    this.boardSysBody = (g: CanvasRenderingContext2D): void => {
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      // THE LABEL COLUMN HAS A WIDTH, and the sub-line has to respect
      // it: the controls start at BX, and a sub that ran long used to
      // print straight through SET THE FLOOR. Clamped, not trusted.
      const labelW = BX - CONTENT_X - 50;
      const row = (k: number, text: string, sub: string, hue: string): void => {
        const y = y0 + k * SYS_PITCH;
        chamfer(g, CONTENT_X, y, W - 34 - CONTENT_X, SYS_PITCH - 14, 14);
        g.fillStyle = 'rgba(150,175,255,0.04)';
        g.fill();
        g.strokeStyle = SKIN.lineFaint;
        g.lineWidth = 1.5;
        g.stroke();
        // A lit tick at the row's head, in the row's own colour.
        g.fillStyle = hue;
        g.shadowColor = hue;
        g.shadowBlur = 8;
        g.fillRect(CONTENT_X + 14, y + 26, 4, SYS_PITCH - 66);
        g.shadowBlur = 0;
        g.textAlign = 'left';
        g.font = font(700, 30);
        g.letterSpacing = '2px';
        g.fillStyle = UI.text;
        g.fillText(text, CONTENT_X + 34, y + 38, labelW);
        g.letterSpacing = '0px';
        g.font = font(500, 21);
        g.fillStyle = UI.faint;
        g.fillText(sub, CONTENT_X + 34, y + 72, labelW);
      };
      row(0, 'SOUND', 'Effects volume', SKIN.gold);
      // The now-playing line rides the MUSIC row's sub, because a record
      // you cannot name is a record you cannot ask for again.
      const on = nowPlaying();
      row(1, 'MUSIC', on ? `now playing \u00b7 ${on}` : 'the records', SKIN.gold);
      row(2, 'WALL FRAMES', 'Show the walls the headset found', SKIN.info);
      row(3, 'THE FLOOR', 'Drag the tape to resize', SKIN.info);
      row(4, 'PROGRESS', 'Clear your best waves', SKIN.magenta);

      // The two faders: the figure over a ten-step bar.
      const fader = (k: number, v: number): void => {
        const x = BX + stepW + 16;
        const y = rowY(k);
        well(g, x, y, valueW, BH, 10);
        g.textAlign = 'center';
        g.font = font(700, 32);
        g.fillStyle = UI.text;
        g.fillText(`${Math.round(v * 100)}%`, x + valueW / 2, y + 32);
        const n = 10;
        const gap = 5;
        const segW = (valueW - 48 - gap * (n - 1)) / n;
        const lit = Math.round(v * n);
        for (let i = 0; i < n; i++) {
          const sx = x + 24 + i * (segW + gap);
          g.beginPath();
          g.moveTo(sx + 4, y + 58);
          g.lineTo(sx + segW + 4, y + 58);
          g.lineTo(sx + segW, y + 68);
          g.lineTo(sx, y + 68);
          g.closePath();
          if (i < lit) {
            g.fillStyle = SKIN.gold;
            g.shadowColor = SKIN.gold;
            g.shadowBlur = 6;
          } else {
            g.fillStyle = 'rgba(160,185,255,0.14)';
          }
          g.fill();
          g.shadowBlur = 0;
        }
      };
      fader(0, sfxVolume());
      fader(1, musicVolume());

      const real = walls.filter((w) => w.real && w.kind === 'wall').length;
      const flats = walls.filter((w) => w.kind !== 'wall').length;
      const fake = walls.filter((w) => !w.real && w.kind === 'wall').length;
      g.textAlign = 'left';
      g.font = font(500, 19);
      g.fillStyle = UI.faint;
      g.fillText(
        site.stageRoom
          ? `room: the headset's room-scale box (${stage.why})${flats ? ` \u00b7 floor/ceiling ports live` : ''}`
          : `room: ${real} scanned wall${real === 1 ? '' : 's'}${fake ? ` \u00b7 ${fake} stand-in` : ''}${flats ? ` \u00b7 floor/ceiling ports live` : ''} \u00b7 stage: ${stage.why}`,
        CONTENT_X + 4,
        H - 40,
        W - 34 - CONTENT_X,
      );
    };
  }

  /* ── THE JOB CARD ─────────────────────────────────────────────────────── */

  private paintCard(): void {
    if (site.screen === 'factory') {
      this.paintFactoryCard();
      return;
    }
    const [cw, ch] = BOARD.cardPx;
    const job = JOBS[site.jobIndex];
    const buttons: PanelButton[] = [
      {
        id: 'resume',
        label: 'RESUME',
        primary: true,
        x: 34,
        y: ch - 118,
        w: cw / 2 - 46,
        h: 88,
      },
      {
        id: 'quit',
        label: this.quitArm > 0 ? 'SURE? PRESS AGAIN' : 'QUIT',
        tone: UI.danger,
        x: cw / 2 + 12,
        y: ch - 118,
        w: cw / 2 - 46,
        h: 88,
        small: true,
      },
    ];
    this.card.paint(
      job.name,
      (g) => {
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        // Keep the completion requirement visible above the live steps.
        g.textAlign = 'center';
        g.font = font(600, 34);
        g.fillStyle = UI.dim;
        const complete = site.runs.filter((run) => run.phase === 'flowing').length;
        g.fillText(`${complete} / ${site.runs.length} LINES CONNECTED`, cw / 2, 132);
        // One row per run: line dot, name, where it stands.
        site.runs.forEach((run, i) => {
          const y = 176 + i * 40;
          g.textAlign = 'left';
          g.fillStyle = run.line.hex;
          g.beginPath();
          g.arc(56, y, 8, 0, Math.PI * 2);
          g.fill();
          g.font = font(600, 24);
          g.fillStyle = UI.text;
          g.fillText(run.line.name, 76, y + 1);
          g.textAlign = 'right';
          g.font = font(500, 22);
          const state =
            run.phase === 'flowing'
              ? 'FLOWING'
              : run.phase === 'seated'
                ? 'CHARGING'
                : run.phase === 'pull'
                  ? 'CONNECT TO SOCKET'
                  : run.phase === 'wake'
                    ? 'SOCKET OPENING'
                    : run.phase === 'place'
                      ? 'MOUNT FLANGE'
                      : 'UP NEXT';
          g.fillStyle = run.phase === 'flowing' ? UI.positive : UI.dim;
          g.fillText(state, cw - 44, y + 1);
        });
        const active = site.runs.find((run) => run.phase === 'place' || run.phase === 'wake' || run.phase === 'pull');
        const instruction = active?.phase === 'place'
          ? 'Aim at a wall. Pull the trigger to mount the flange.'
          : active?.phase === 'wake'
            ? 'Find the matching socket as it opens.'
            : active?.phase === 'pull'
              ? 'Hold the collar with both grips. Carry it to the matching socket.'
              : 'Let the connected lines fill.';
        wrapText(g, instruction, 44, 358, cw - 88, 32, font(600, 26), UI.text, 'center');
        g.textAlign = 'center';
        g.font = font(500, 22);
        g.fillStyle = UI.dim;
        g.fillText(fmtMs(site.elapsedMs), cw / 2, ch - 162);
      },
      buttons,
      this.hover,
    );
  }

  /** Can the live bank cover a bill? */
  /**
   * PAUSED, ON HANDS — three big plates and nothing else. Building lives
   * on your palm, the money on the core, the wave on your watch; all
   * that is left for a pause is to come back, start the wave, or leave.
   */
  private paintHandPause(): void {
    const [cw, ch] = BOARD.cardPx;
    const sg = plant.siege;
    const buttons: PanelButton[] = [
      { id: 'resume', label: 'RESUME', primary: true, px: 48, x: CARD_PAD, y: 262, w: cw - 2 * CARD_PAD, h: 150 },
    ];
    if (sg.phase === 'build') {
      buttons.push({
        id: 'card:start',
        label: 'START THE NEXT WAVE',
        tone: SKIN.gold,
        x: CARD_PAD,
        y: 428,
        w: cw - 2 * CARD_PAD,
        h: 110,
      });
    }
    buttons.push({
      id: 'quit',
      label: this.quitArm > 0 ? 'SURE? POKE AGAIN' : 'QUIT',
      tone: UI.danger,
      small: true,
      x: CARD_PAD,
      y: ch - 140,
      w: cw - 2 * CARD_PAD,
      h: 104,
    });
    this.card.paint(
      'PAUSED',
      (g) => {
        this.paintHud(g, CARD_PAD, CARD_HUD, cw - 2 * CARD_PAD, 84);
        g.textBaseline = 'middle';
        const status =
          sg.phase === 'core'
            ? 'A NEW SIEGE \u00b7 THE FLOOR IS YOURS'
            : sg.phase === 'fallen'
              ? 'THE CORE HAS FALLEN'
              : sg.wave < WAVES.length
                ? `WAVE ${sg.wave + 1} OF ${WAVES.length}`
                : `OVERTIME \u00b7 WAVE ${sg.wave + 1}`;
        caps(g, status, cw / 2, 226, { px: 19, color: SKIN.gold, align: 'center', track: 4, max: cw - 80 });
      },
      buttons,
      this.hover,
    );
  }

  /** THE SIEGE'S PAUSE: the plate you poke (paintHandPause). */
  private paintFactoryCard(): void {
    this.paintHandPause();
  }

  /**
   * THE HUD STRIP — the three numbers a siege is about, in one recessed
   * bay: the clock to the next wave (or how many are left), the core as
   * the same ten segments that float over it in the room, and the purse.
   */
  private paintHud(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const sg = plant.siege;
    well(g, x, y, w, h, 12);
    let clockLabel = '';
    let clock = '';
    let clockTone: string = SKIN.gold;
    if (sg.phase === 'build') {
      const secs = Math.ceil(sg.buildT);
      clockLabel = 'NEXT WAVE IN';
      clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    } else if (sg.phase === 'wave') {
      clockLabel = 'ENEMIES LEFT';
      clock = siegeLeft().toLocaleString('en-US');
      clockTone = SKIN.magentaSoft;
    } else if (sg.phase === 'core') {
      clockLabel = 'FIRST';
      clock = 'PLACE THE CORE';
    } else {
      clockLabel = 'THE CORE';
      clock = 'FALLEN';
      clockTone = SKIN.magenta;
    }
    const ly = y + 24;
    const vy = y + h - 28;
    const clockW = 170;
    const coinsW = 128;
    g.textBaseline = 'middle';
    caps(g, clockLabel, x + 18, ly, { px: 14, track: 2 });
    g.textAlign = 'left';
    g.font = font(700, clock.length > 6 ? 24 : 36);
    g.fillStyle = clockTone;
    g.shadowColor = rgba(clockTone, 0.6);
    g.shadowBlur = 10;
    g.fillText(clock, x + 18, vy, clockW - 26);
    g.shadowBlur = 0;

    // Hairlines between the cells.
    g.strokeStyle = SKIN.lineFaint;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x + clockW, y + 14);
    g.lineTo(x + clockW, y + h - 14);
    g.moveTo(x + w - coinsW, y + 14);
    g.lineTo(x + w - coinsW, y + h - 14);
    g.stroke();

    // Before the core stands there is nothing to gauge: the bar sits dark.
    const core = sg.phase === 'core' ? 0 : coreHealth();
    const gx = x + clockW + 18;
    const gw = w - clockW - coinsW - 36;
    caps(g, 'CORE', gx, ly, { px: 14, track: 2 });
    caps(g, sg.phase === 'core' ? '\u2014' : `${Math.round(core * 100)}%`, gx + gw, ly, {
      px: 14,
      track: 1,
      align: 'right',
      color: UI.dim,
    });
    coreGauge(g, gx, vy - 9, gw, 18, core);

    caps(g, 'COINS', x + w - coinsW + 18, ly, { px: 14, track: 2 });
    price(g, sg.coins, x + w - coinsW + 18, vy, { px: 30 });
  }

  /* ── THE BOX PANEL ────────────────────────────────────────────────────
   * Point at any standing plant with an empty hand, pull the trigger,
   * and this opens: what the box IS, what it is HOLDING, what is
   * PLUMBED into it, and the three verbs that were homeless until now.
   *
   * Two playtest notes, one panel:
   *   "we should be able to check what is in a chest by clicking on it
   *    and seeing a menu with the stuff"          → the contents grid
   *   "we can't disconnect the tubes when they're connected to the
   *    boxes — I delete the boxes at the moment"  → UNPLUG
   *
   * The tug (both hands on the collar, haul and hold) is still the good
   * way to break a seal, and it is still there. This is the way you can
   * FIND, which is a different requirement and needs its own answer.
   */
  private paintBox(): void {
    const unit = unitById(site.inspect);
    if (!unit) return;
    // THE TOWER PANEL, kept to the one decision it is for: what it is,
    // how far it has come, how it is holding up, and two big buttons —
    // UPGRADE (its price) and SELL (what you get back). It wears the
    // tower's own neon, so the panel and the thing you touched are one.
    const [cw, ch] = BOARD.boxPx;
    const PAD = 24;
    const tower = isWeapon(unit.type);
    const hue = neonOf(unit.type);
    this.box.setAccent(hue);
    const level = levelOf(unit);
    const next = tower ? upgradeCost(unit) : null;
    const coins = plant.siege.coins;
    const half = (cw - PAD * 2 - 12) / 2;
    const footY = ch - PAD - 84;
    const buttons: PanelButton[] = [];
    if (tower) {
      buttons.push(
        {
          id: 'box:upgrade',
          label: next === null ? 'MAX LEVEL' : 'UPGRADE',
          sub: next === null ? 'fully built' : `${next} coins`,
          px: 26,
          disabled: next === null || coins < next,
          tone: next !== null && coins >= next ? UI.positive : undefined,
          x: PAD,
          y: footY,
          w: half,
          h: 84,
        },
        {
          id: 'box:remove',
          label: 'SELL',
          sub: `+${sellValue(unit)} coins`,
          px: 26,
          tone: UI.danger,
          x: PAD + half + 12,
          y: footY,
          w: half,
          h: 84,
        },
      );
    }
    buttons.push({ id: 'box:close', label: '\u2715', small: true, px: 22, x: cw - PAD - 46, y: 22, w: 46, h: 42 });

    this.box.paint(
      '',
      (g) => {
        g.textBaseline = 'middle';
        // The tower itself, on its pad.
        const pcx = PAD + 54;
        const pcy = 96;
        hexPad(g, pcx, pcy + 6, 54, hue);
        unitGlyph(g, unit.type, pcx - 46, pcy - 46, 92);

        const tx = PAD + 124;
        g.textAlign = 'left';
        g.font = font(700, 30);
        g.letterSpacing = '3px';
        g.fillStyle = UI.textHi;
        g.shadowColor = rgba(hue, 0.7);
        g.shadowBlur = 12;
        g.fillText(unit.type === 'dock' ? 'THE CORE' : UNIT_NAME[unit.type], tx, 50, cw - tx - PAD - 56);
        g.shadowBlur = 0;
        g.letterSpacing = '0px';

        if (!tower) {
          const core = coreHealth();
          caps(g, 'INTEGRITY', tx, 92, { px: 14, track: 2 });
          caps(g, `${Math.round(core * 100)}%`, cw - PAD, 92, { px: 16, track: 1, align: 'right', color: UI.text });
          coreGauge(g, tx, 108, cw - PAD - tx, 16, core);
          wrapText(g, 'It never heals. Whatever reaches it takes a bite.', PAD, 196, cw - 2 * PAD, 24, font(500, 19), UI.dim);
          return;
        }
        // THE LEVEL: one hex per level, lit in the tower's neon.
        pips(g, tx, 90, SIEGE.levels.length, level, hue, 10, 25);
        caps(g, `LEVEL ${level}/${SIEGE.levels.length}`, tx + SIEGE.levels.length * 25 + 8, 91, { px: 14, track: 2, color: UI.dim });
        price(g, coins, cw - PAD, 91, { px: 20, align: 'right' });
        // THE PLATE: how much chewing it can still take.
        const hp = unit.maxHp > 0 ? Math.max(0, unit.hp / unit.maxHp) : 1;
        caps(g, 'PLATE', tx, 128, { px: 14, track: 2 });
        coreGauge(g, tx + 64, 120, cw - PAD - tx - 64, 15, hp);
      },
      buttons,
      this.hover,
    );
  }

  /**
   * THANKS FOR PLAYING — the last card in the game.
   *
   * It comes up once, on its own, while the goop dances on your actual
   * floor BESIDE it (see plantClear: the card steps out of the
   * creature's way rather than fighting it for the same air).
   * Deliberately the only screen in TUBES that is not made of shop
   * chrome — but it is made of the shop's METAL: a bolted nameplate,
   * the kind screwed to the side of a machine to say who built it,
   * which is exactly what a credits card is.
   *
   * It used to carry a closing paragraph about the shift. The names are
   * the point of the last screen, so the paragraph is gone and the
   * credits have the plate to themselves.
   */
  private paintFinale(): void {
    const cw = 1060;
    const ch = 700;
    // THE LAST CARD of a siege: the core went. Two doors — straight back
    // onto a fresh floor, or back to the board.
    const buttons: PanelButton[] = [
      {
        id: 'fin:retry',
        label: 'TRY AGAIN',
        primary: true,
        x: cw / 2 - 440,
        y: ch - 136,
        w: 420,
        h: 92,
      },
      {
        id: 'fin:board',
        label: 'BACK TO THE BOARD',
        x: cw / 2 + 20,
        y: ch - 136,
        w: 420,
        h: 92,
      },
    ];
    const sg = plant.siege;
    // The fall wears the tide's colour: they got what they came for.
    this.finale.setAccent(SKIN.magenta);
    this.finale.paint(
      '',
      (g) => {
        g.textAlign = 'center';
        g.textBaseline = 'middle';

        // THE CORE, gone dark on a magenta pad.
        g.save();
        const glow = g.createRadialGradient(cw / 2, 104, 0, cw / 2, 104, 200);
        glow.addColorStop(0, rgba(SKIN.magenta, 0.2));
        glow.addColorStop(1, rgba(SKIN.magenta, 0));
        g.fillStyle = glow;
        g.fillRect(0, 0, cw, 320);
        g.restore();
        hexPad(g, cw / 2, 112, 66, SKIN.magenta);
        g.save();
        g.globalAlpha = 0.5;
        unitGlyph(g, 'dock', cw / 2 - 52, 52, 104, GLYPH_DEAD);
        g.restore();

        titleBar(g, 'THE CORE HAS FALLEN', cw / 2, 220, { px: 54, accent: SKIN.magenta, span: 120 });

        // THE TALLY: what you held, what you put down.
        const stats: Array<[string, string, string]> = [
          ['WAVES HELD', `${sg.wave}`, SKIN.gold],
          ['PUT DOWN', sg.kills.toLocaleString('en-US'), SKIN.magentaSoft],
          ['BEST EVER', `${Math.max(bestWave(), sg.wave)}`, UI.text],
        ];
        const SW = 230;
        const GAP = 18;
        const x0 = cw / 2 - (stats.length * SW + (stats.length - 1) * GAP) / 2;
        stats.forEach(([label, value, tone], k) => {
          const sx = x0 + k * (SW + GAP);
          well(g, sx, 268, SW, 84, 12);
          caps(g, label, sx + SW / 2, 290, { px: 15, align: 'center', track: 3 });
          g.textAlign = 'center';
          g.font = font(700, 38);
          g.fillStyle = tone;
          g.fillText(value, sx + SW / 2, 326, SW - 24);
        });

        // THE CREDITS: small stencilled label over a big name. The names
        // get the type size that FITS rather than a fixed one, because a
        // name is not something to wrap or run off the end of a card.
        const name = (text: string, y: number, want: number, colour: string): void => {
          let size = want;
          for (; size > 18; size -= 2) {
            g.font = font(700, size);
            if (g.measureText(text).width <= cw - 160) break;
          }
          g.textAlign = 'center';
          g.fillStyle = colour;
          g.fillText(text, cw / 2, y);
        };
        caps(g, 'CREATED BY', cw / 2, 388, { px: 17, align: 'center', track: 6 });
        name('yellkell', 424, 42, SKIN.gold);
        caps(g, 'MUSIC BY', cw / 2, 470, { px: 17, align: 'center', track: 6 });
        name('IBWildcat1998, poopoodoodoo698 & JakeThePro', 506, 30, UI.text);
      },
      buttons,
      this.hover,
    );
  }

  /* ── shared body dispatcher ───────────────────────────────────────────── */

  /** Panel.paint takes one body; the board's is whichever tab's painter
   *  was built last, behind the shared chrome. */
  private paintBoardBody(g: CanvasRenderingContext2D): void {
    this.paintChrome(g);
    this.boardJobsBody?.(g);
    this.boardOrdersBody?.(g);
    this.boardControlsBody?.(g);
    this.boardSysBody?.(g);
  }
}

/* ── little helpers ───────────────────────────────────────────────────────── */

function fmtMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 100) / 10);
  const m = Math.floor(total / 60);
  const s = (total - m * 60).toFixed(1);
  return m > 0 ? `${m}:${s.padStart(4, '0')}` : `${s}s`;
}

/* ── the pause plate's layout ───────────────────────────────────────── */
const CARD_PAD = 34;
/** The HUD strip under the title. */
const CARD_HUD = 112;

function wrapText(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lineH: number,
  fontStr: string,
  color: string,
  align: CanvasTextAlign = 'left',
): number {
  g.font = fontStr;
  g.fillStyle = color;
  g.textAlign = align;
  // Centred blocks are measured from the middle of the box, so the
  // caller still passes the box's LEFT edge and gets what they drew.
  const at = align === 'center' ? x + maxW / 2 : x;
  const words = text.split(' ');
  let line = '';
  let yy = y;
  let lines = 0;
  for (const word of words) {
    const probe = line ? `${line} ${word}` : word;
    if (g.measureText(probe).width > maxW && line) {
      g.fillText(line, at, yy);
      lines++;
      line = word;
      yy += lineH;
    } else {
      line = probe;
    }
  }
  if (line) {
    g.fillText(line, at, yy);
    lines++;
  }
  g.textAlign = 'left';
  return lines;
}
