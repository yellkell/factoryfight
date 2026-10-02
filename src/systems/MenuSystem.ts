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
  UPGRADES,
  WAVES,
  WEAPONS,
  type WeaponId,
  ENEMIES,
  type WaveSpec,
  type ItemId,
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
  upgradeOwned,
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
import { canAfford, isWeapon, refundUnit, removeUnit, unitCost } from '../factory/sim.js';

/** "50 COINS" — what a tower costs out of the purse. */
function costText(type: UnitType): string {
  const n = unitCost(type);
  return n > 0 ? `${n} COINS` : 'free';
}
import { coreHealth, levelOf, sellValue, siegeLeft, soundHorn, upgradeCost, upgradeTower, waveSpec } from '../factory/siege.js';
import { buildView, typeAvailable, type BuildTool } from './BuildSystem.js';
import { goopView } from './GoopSystem.js';
import { font } from '../ui/fonts.js';
import {
  GLYPH_DEAD,
  GLYPH_LIVE,

  itemGlyph,
  unitGlyph,
  type GlyphId,
} from '../ui/icons.js';
import { Panel, UI, type PanelButton } from '../ui/panel.js';
import { callout, drawController, faceGlyph, type Control, type Hand } from '../ui/controller.js';
import { controllerModelView, onControllerImage } from '../ui/controllerModel.js';
import { PointerRay } from '../ui/pointer.js';
import { walls } from './WallSystem.js';
import { stage } from '../room/stage.js';

/** A button's picture: the machine's own shop drawing, greyed with the
 *  plate when the catalogue is refusing it. */
const toolGlyph =
  (id: GlyphId): NonNullable<PanelButton['glyph']> =>
  (g, x, y, size, dead) =>
    unitGlyph(g, id, x, y, size, dead ? GLYPH_DEAD : GLYPH_LIVE);

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
  piston: 'PISTON',
};

/** One line on what each piece of plant is FOR — the box panel's
 *  subtitle, and the catalogue's tooltip line. */
const UNIT_DOCKET: Record<UnitType, string> = {
  dock: 'What they are coming for. Every one that reaches it takes a bite. Lose it, lose the siege.',
  maker: 'Turns a supply feed into parts. Feed colour sets the recipe.',
  belt: 'Carries parts between machines. Hold trigger to extend.',
  combiner: 'Combines two parts. Inputs on the sides; output at the front.',
  chest: 'Stores parts from rails. Grip a part to take it out.',
  post: 'Guides a rail route. Place where you want it to bend.',
  vat: 'Takes the green feed. Fill it to complete the final goal.',
  turret: 'Rapid rounds, a mite a shot. The workhorse.',
  mortar: 'Lobs shells into the thick of a lane. Long reach, blind up close.',
  tesla: 'A bolt that jumps through ten of them at once.',
  flamer: 'A cone of fire: a whole column burns. Short reach — put it right by a lane.',
  piston: 'Shoves the front of a column back down its lane. Best at a corner.',
  wall: 'Costs 1 GEAR. Thick plate they have to chew. Drag to lay a run.',
};

/** The same instruction, said for the hands you are actually using: a
 *  controller's buttons, or a pinch and the wrist cuff. */
function say(pad: string, hand: string): string {
  return intents.handMode ? hand : pad;
}

/** The four gestures, drawn as plain line-art: a pinch is two fingertips
 *  meeting, a fist a closed knuckle row, two fists a pair, the cuff a
 *  wrist with a plate on it and a finger coming in. */
function handGlyph(
  g: CanvasRenderingContext2D,
  shape: 'pinch' | 'fist' | 'fists' | 'cuff',
  x: number,
  y: number,
  size: number,
): void {
  g.save();
  g.translate(x, y);
  g.scale(size / 100, size / 100);
  g.lineWidth = 5;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  const fist = (cx: number): void => {
    g.beginPath();
    g.roundRect(cx - 22, 34, 44, 46, 12);
    g.stroke();
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      g.moveTo(cx - 22 + 11 * (k + 1), 34);
      g.lineTo(cx - 22 + 11 * (k + 1), 50);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(cx - 14, 80);
    g.lineTo(cx - 14, 96);
    g.moveTo(cx + 14, 80);
    g.lineTo(cx + 14, 96);
    g.stroke();
  };
  if (shape === 'pinch') {
    g.beginPath();
    g.moveTo(30, 96);
    g.quadraticCurveTo(26, 50, 52, 30);
    g.moveTo(72, 96);
    g.quadraticCurveTo(84, 60, 58, 32);
    g.stroke();
    g.fillStyle = '#ffa22e';
    g.beginPath();
    g.arc(55, 30, 7, 0, Math.PI * 2);
    g.fill();
  } else if (shape === 'fist') {
    fist(50);
  } else if (shape === 'fists') {
    fist(26);
    fist(74);
    g.strokeStyle = '#ffa22e';
    g.beginPath();
    g.moveTo(4, 24);
    g.lineTo(96, 24);
    g.stroke();
  } else {
    g.beginPath();
    g.moveTo(10, 90);
    g.lineTo(60, 40);
    g.moveTo(30, 98);
    g.lineTo(76, 52);
    g.stroke();
    g.fillStyle = 'rgba(255,162,46,0.85)';
    g.save();
    g.translate(42, 70);
    g.rotate(-Math.PI / 4);
    g.fillRect(-16, -9, 32, 18);
    g.restore();
    g.strokeStyle = '#ffa22e';
    g.beginPath();
    g.moveTo(90, 8);
    g.lineTo(58, 52);
    g.stroke();
  }
  g.restore();
}

/** One wave's bill of crawlers, in a line: "5 SKITTER · 2 GRUB · 2 BREACHES". */
function waveSummary(w: WaveSpec): string {
  const n = new Map<string, number>();
  for (const sp of w.spawns) n.set(sp.enemy, (n.get(sp.enemy) ?? 0) + sp.count);
  const parts = [...n.entries()].map(([e, c]) => `${c} ${ENEMIES[e as keyof typeof ENEMIES].name}`);
  parts.push(`${w.breaches} LANE${w.breaches === 1 ? '' : 'S'}`);
  return parts.join(' \u00b7 ');
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
const SYS_Y0 = 188;
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
  /** THE REAL CONTROLLER — its picture, for the CONTROLS pages. */
  controllers?: typeof controllerModelView;
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
    menuView.controllers = controllerModelView;
    // The real controller pictures arrive after the first paint of a
    // CONTROLS page; when they do, the page that drew the stand-in
    // redraws with the thing itself.
    onControllerImage(() => {
      this.lastKey = '';
    });
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
    } else if (id === 'card:horn') {
      soundHorn();
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
      { id: 'tab:controls', tab: 'controls', label: 'CONTROLS' },
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

  /** Header chrome: the wordmark, the room status, the rail's guide line. */
  private paintChrome(g: CanvasRenderingContext2D): void {
    // Wordmark — the title stencilled on, with its service stripe.
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.font = font(700, 64);
    g.letterSpacing = '6px';
    g.fillStyle = UI.textHi;
    g.fillText(GAME_TITLE, RAIL_X + 4, 96);
    // Measured WITH the spacing it was drawn with — the tagline sits
    // after the whole word, however long the title is.
    const wmW = g.measureText(GAME_TITLE).width + 10;
    g.letterSpacing = '0px';
    g.fillStyle = UI.accent;
    g.beginPath();
    g.roundRect(RAIL_X + 6, 110, Math.min(wmW, 190), 5, 2.5);
    g.fill();
    g.font = font(500, 22);
    g.fillStyle = UI.faint;
    g.fillText('BUILD THE TOWERS. HOLD THE CORE.', RAIL_X + Math.max(226, wmW + 26), 100);

    // Room status, top right: what the scan gave us. Walls only — the
    // floor and ceiling are registry citizens too, but "6 WALLS" over a
    // four-walled room reads as a bug, not a feature.
    const real = walls.filter((w) => w.real && w.kind === 'wall').length;
    const label = !site.wallsReady
      ? 'WAITING FOR WALLS'
      : site.stageRoom
        ? 'ROOM-SCALE BOX'
        : site.fallbackRoom
          ? 'STAND-IN ROOM'
          : `ROOM SCANNED · ${real} WALL${real === 1 ? '' : 'S'}`;
    g.textAlign = 'right';
    g.font = font(600, 24);
    g.fillStyle = site.fallbackRoom || !site.wallsReady ? UI.warn : UI.positive;
    const dotX = W - 34 - g.measureText(label).width - 24;
    g.fillText(label, W - 34, 96);
    g.beginPath();
    g.arc(dotX, 88, 7, 0, Math.PI * 2);
    g.fill();

    // Hairline under the header, and the rail's guide.
    g.strokeStyle = UI.lineFaint;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(RAIL_X, 138);
    g.lineTo(W - 32, 138);
    g.stroke();

    // The rail marker: the accent sliding to the active tab.
    if (Number.isFinite(this.railY)) {
      g.fillStyle = UI.accent;
      g.beginPath();
      g.roundRect(RAIL_X - 10, this.railY + 18, 5, 54, 2.5);
      g.fill();
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
    buttons.push(
      {
        id: 'start-order',
        label: 'MAN THE WALLS',
        sub:
          held > 0
            ? `best: ${held} wave${held === 1 ? '' : 's'} held \u00b7 ${bestKills()} down`
            : 'something is in the walls',
        primary: true,
        disabled: !site.wallsReady,
        x: SHEET_X + 10,
        y: H - 182,
        w: SHEET_W - 20,
        h: 96,
      },
      {
        // THE ONE CONTROL NOBODY CAN GUESS: every verb in the siege lives
        // on the Ⓐ card, so the first thing to know is that Ⓐ exists.
        id: 'shop-note',
        label: say('\u24b6 MENU', 'TURN YOUR LEFT PALM \u00b7 MENU'),
        display: true,
        small: true,
        x: SHEET_X + 10,
        y: H - 76,
        w: SHEET_W - 20,
        h: 62,
      },
    );

    const ROW = 66;
    const RH = 58;
    this.boardOrdersBody = (g: CanvasRenderingContext2D): void => {
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.font = font(600, 24);
      g.fillStyle = UI.faint;
      g.letterSpacing = '2px';
      g.fillText('THE SIEGE', ROW_X + 2, ROW_Y0 - 22);
      g.letterSpacing = '0px';

      WAVES.forEach((w, i) => {
        const y = ROW_Y0 + i * ROW;
        const cleared = i < held;
        const next = i === held;
        g.fillStyle = next ? UI.accentFaint : 'rgba(255,255,255,0.028)';
        g.beginPath();
        g.roundRect(ROW_X, y, ROW_W, RH, 12);
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = next ? 'rgba(255,162,46,0.85)' : 'rgba(255,255,255,0.07)';
        g.stroke();
        g.textAlign = 'center';
        g.font = font(700, 24);
        g.fillStyle = cleared ? UI.positive : next ? UI.accent : UI.disabled;
        g.fillText(cleared ? '\u2713' : next ? '\u25b8' : '\u00b7', ROW_X + 28, y + RH / 2);
        g.textAlign = 'left';
        g.font = font(600, 25);
        g.fillStyle = cleared ? UI.dim : next ? UI.textHi : UI.faint;
        g.fillText(`${i + 1}. ${w.name}`, ROW_X + 52, y + RH / 2 - 10, ROW_W - 70);
        g.font = font(500, 18);
        g.fillStyle = UI.faint;
        g.fillText(waveSummary(w), ROW_X + 52, y + RH / 2 + 14, ROW_W - 70);
      });

      // THE BRIEF.
      const sheetH = H - ROW_Y0 - 190;
      g.fillStyle = UI.well;
      g.beginPath();
      g.roundRect(SHEET_X, ROW_Y0, SHEET_W, sheetH, 18);
      g.fill();
      g.textAlign = 'left';
      g.font = font(700, 40);
      g.letterSpacing = '2px';
      g.fillStyle = UI.textHi;
      g.fillText('HOLD THE CORE', SHEET_X + 26, ROW_Y0 + 50);
      g.letterSpacing = '0px';
      let y = ROW_Y0 + 96;
      y +=
        28 *
          wrapText(
            g,
            'Something lives behind your walls. Place your CORE, and glowing lanes run from cracks in the plaster to it. Build towers beside the lanes, anywhere but on them. When the horn goes they pour out in their thousands and march for the core. Every kill pays coins; every wave you hold pays more. Touch a tower to upgrade it.',
            SHEET_X + 26,
            y,
            SHEET_W - 52,
            28,
            font(500, 22),
            UI.dim,
          ) +
        16;
      // THE ARSENAL — every weapon the siege will hand you, at a glance.
      g.font = font(500, 21);
      g.fillStyle = UI.faint;
      g.fillText('THE ARSENAL', SHEET_X + 26, y);
      y += 30;
      (['turret', 'flamer', 'piston', 'tesla', 'mortar'] as WeaponId[]).forEach((w, k) => {
        const cx = SHEET_X + 26 + (k % 2) * ((SHEET_W - 52) / 2);
        const cy = y + Math.floor(k / 2) * 44;
        unitGlyph(g, w, cx, cy - 18, 36);
        g.font = font(600, 21);
        g.fillStyle = UI.text;
        g.fillText(WEAPONS[w].name, cx + 44, cy);
      });

      if (!site.wallsReady) {
        g.textAlign = 'left';
        g.font = font(500, 23);
        g.fillStyle = UI.warn;
        g.fillText('Look around to find walls', SHEET_X + 26, ROW_Y0 + sheetH - 26);
      }
    };
  }

  /* ── CONTROLS tab ─────────────────────────────────────────────────────── */

  /**
   * THE CONTROLS TAB — both controllers drawn, every button named, and a
   * table of what each one does on each kind of shift.
   *
   * Five controls carry the whole game and until now the only one written
   * down before you needed it was Ⓐ. The diagram is the thing in your
   * hands with the words pointing at it; the table under it is the
   * part you come back for — "what does Ⓑ do in the factory again" —
   * split by where you are, because the trigger mounts a flange on one
   * shift and stamps a machine on the next. No buttons: it is a sheet
   * you read, not one you press.
   */
  private paintControls(): void {
    if (intents.handMode) {
      this.boardControlsBody = (g: CanvasRenderingContext2D): void =>
        this.paintHandControls(g, CONTENT_X, 190, W - CONTENT_X - 60, 150);
      return;
    }
    const S = 230;
    const TOP = 186;
    const LX = 470;
    const RX = 930;
    const MID = (LX + S + RX) / 2;
    const litRight = new Set<Control>(['trigger', 'grip', 'upper', 'lower']);
    const litLeft = new Set<Control>(['trigger', 'grip', 'upper', 'lower']);

    // THE TABLE. Rows are the controls, columns are the three kinds of
    // shift; each cell is at most three short lines, and a dash is an
    // honest cell: that button does nothing there.
    const T0 = 460;
    const LBL_W = 118;
    const COL_X0 = ROW_X + LBL_W + 14;
    const COL_GAP = 10;
    const COL_W = (W - 34 - COL_X0 - 2 * COL_GAP) / 3;
    const PITCH = 66;
    const rows: Array<{ name: string; hand: string; cells: [string, string, string] }> = [
      {
        name: 'TRIGGER',
        hand: 'right hand',
        cells: [
          'Aim at a wall and pull: the flange mounts there.',
          'Place the tower in hand. Empty-handed on a tower: open its panel (UPGRADE, SELL).',
          'Squeeze near a tape side to take it, drag, let go to save. It snaps to your walls.',
        ],
      },
      {
        name: 'GRIP',
        hand: 'both hands',
        cells: [
          'Both hands on the collar: haul the tube. One hand only rattles it. Let go and it parks.',
          '—',
          '—',
        ],
      },
      {
        name: faceGlyph('right', 'lower'),
        hand: 'right hand',
        cells: [
          'The job card: the lines, the clock, RESUME or QUIT.',
          'The siege card: BUILD · WAVES · CONTROLS. Also puts a tower panel away.',
          'Done. The floor saves and the board comes back.',
        ],
      },
      {
        name: faceGlyph('right', 'upper'),
        hand: 'right hand',
        cells: [
          '—',
          'Holding a tower: turn it a quarter.',
          '—',
        ],
      },
      {
        name: `${faceGlyph('left', 'lower')} ${faceGlyph('left', 'upper')}`,
        hand: 'left hand',
        cells: ['—', 'Put the tool away.', `${faceGlyph('left', 'lower')}: done, the same as Ⓐ.`],
      },
    ];

    this.boardControlsBody = (g: CanvasRenderingContext2D): void => {
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.font = font(600, 24);
      g.fillStyle = UI.faint;
      g.letterSpacing = '2px';
      g.fillText('THE CONTROLLERS', ROW_X + 2, ROW_Y0 - 22);
      g.letterSpacing = '0px';

      // THE PAIR — the real models when they are in, and the anchors
      // every callout below points at come back from the drawing.
      const anchors: Record<Hand, Record<Control, { x: number; y: number }>> = {
        left: drawController(g, 'left', LX, TOP, S, litLeft),
        right: drawController(g, 'right', RX, TOP, S, litRight),
      };
      const at = (hand: Hand, c: Control): { x: number; y: number } => anchors[hand][c];
      g.textAlign = 'center';
      g.font = font(500, 19);
      g.letterSpacing = '2px';
      g.fillStyle = UI.faint;
      g.fillText('LEFT HAND', LX + S / 2, TOP + S + 18);
      g.fillText('RIGHT HAND', RX + S / 2, TOP + S + 18);
      g.letterSpacing = '0px';

      // Outer callouts: the face buttons and the trigger, out to each
      // margin. Inner callouts: the stick and the grip, which the two
      // controllers share, named once between them.
      const lm = LX - 24;
      const rm = RX + S + 24;
      callout(g, at('left', 'trigger'), lm, TOP + 14, 'left', 'TRIGGER');
      callout(g, at('left', 'upper'), lm, TOP + 54, 'left', faceGlyph('left', 'upper'));
      callout(g, at('left', 'lower'), lm, TOP + 94, 'left', faceGlyph('left', 'lower'));
      callout(g, at('right', 'trigger'), rm, TOP + 14, 'right', 'TRIGGER');
      callout(g, at('right', 'upper'), rm, TOP + 54, 'right', faceGlyph('right', 'upper'));
      callout(g, at('right', 'lower'), rm, TOP + 94, 'right', faceGlyph('right', 'lower'));
      // The two shared controls sit at nearly the same height on the
      // picture, so their words take rows of their own — STICK above,
      // GRIP below — and the leaders fan to them.
      const between = (c: Control, label: string, live: boolean, y: number): void => {
        const l = at('left', c);
        const r = at('right', c);
        g.save();
        g.strokeStyle = live ? 'rgba(255,255,255,0.38)' : 'rgba(255,255,255,0.18)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(l.x, l.y);
        g.lineTo(MID - 52, y);
        g.moveTo(r.x, r.y);
        g.lineTo(MID + 52, y);
        g.stroke();
        g.fillStyle = live ? UI.accent : UI.disabled;
        for (const p of [l, r]) {
          g.beginPath();
          g.arc(p.x, p.y, 4, 0, Math.PI * 2);
          g.fill();
        }
        g.textAlign = 'center';
        g.font = font(600, 22);
        g.letterSpacing = '1.5px';
        g.fillStyle = live ? UI.text : UI.disabled;
        g.fillText(label, MID, y);
        g.restore();
      };
      between('stick', 'STICK', false, TOP + 30);
      between('grip', 'GRIP', true, TOP + 176);

      // THE TABLE.
      g.textAlign = 'left';
      g.font = font(600, 19);
      g.letterSpacing = '2px';
      g.fillStyle = UI.faint;
      ['PIPE JOBS', 'THE FACTORY', 'THE FLOOR'].forEach((h, c) => {
        g.fillText(h, COL_X0 + c * (COL_W + COL_GAP), T0 + 8);
      });
      g.letterSpacing = '0px';
      g.strokeStyle = UI.lineFaint;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(ROW_X, T0 + 26);
      g.lineTo(W - 34, T0 + 26);
      g.stroke();

      rows.forEach((row, i) => {
        const y = T0 + 36 + i * PITCH;
        if (i > 0) {
          g.strokeStyle = 'rgba(255,255,255,0.06)';
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(ROW_X, y - 5);
          g.lineTo(W - 34, y - 5);
          g.stroke();
        }
        g.textAlign = 'left';
        g.font = font(600, 25);
        g.letterSpacing = '1px';
        g.fillStyle = UI.text;
        g.fillText(row.name, ROW_X, y + 16);
        g.letterSpacing = '0px';
        g.font = font(500, 15);
        g.fillStyle = UI.faint;
        g.fillText(row.hand, ROW_X, y + 42, LBL_W + 8);
        row.cells.forEach((cell, c) => {
          const x = COL_X0 + c * (COL_W + COL_GAP);
          if (cell === '—') {
            g.font = font(500, 18);
            g.fillStyle = UI.disabled;
            g.textAlign = 'left';
            g.fillText(cell, x, y + 12);
            return;
          }
          wrapText(g, cell, x, y + 10, COL_W - 8, 20, font(500, 18), UI.dim);
        });
      });

      g.textAlign = 'left';
      g.font = font(500, 19);
      g.fillStyle = UI.faint;
      g.fillText(
        'The sticks and the menu buttons do nothing. Walk — it is your room.',
        ROW_X,
        H - 40,
      );
    };
  }

  /* ── SYSTEM tab ───────────────────────────────────────────────────────── */

  private paintSystem(buttons: PanelButton[]): void {
    const rowW = 150;
    const valueW = 260;
    const y0 = SYS_Y0;
    buttons.push(
      { id: 'sfx:down', label: '−', x: CONTENT_X + 330, y: y0, w: rowW, h: 96, px: 48 },
      {
        id: 'sfx:vol',
        label: `${Math.round(sfxVolume() * 100)}%`,
        display: true,
        x: CONTENT_X + 330 + rowW + 16,
        y: y0,
        w: valueW,
        h: 96,
      },
      {
        id: 'sfx:up',
        label: '+',
        x: CONTENT_X + 330 + rowW + valueW + 32,
        y: y0,
        w: rowW,
        h: 96,
        px: 48,
      },
      { id: 'mus:down', label: '−', x: CONTENT_X + 330, y: y0 + SYS_PITCH, w: rowW, h: 96, px: 48 },
      {
        id: 'mus:vol',
        label: `${Math.round(musicVolume() * 100)}%`,
        display: true,
        x: CONTENT_X + 330 + rowW + 16,
        y: y0 + SYS_PITCH,
        w: valueW,
        h: 96,
      },
      {
        id: 'mus:up',
        label: '+',
        x: CONTENT_X + 330 + rowW + valueW + 32,
        y: y0 + SYS_PITCH,
        w: rowW,
        h: 96,
        px: 48,
      },
      {
        id: 'walls:toggle',
        label: site.showWalls ? 'SHOWN' : 'HIDDEN',
        selected: site.showWalls,
        x: CONTENT_X + 330,
        y: y0 + SYS_PITCH * 2,
        w: rowW + valueW + 16,
        h: 96,
      },
      {
        id: 'floor:set',
        label: 'SET THE FLOOR',
        x: CONTENT_X + 330,
        y: y0 + SYS_PITCH * 3,
        w: rowW + valueW + 16,
        h: 96,
      },
      {
        id: 'reset',
        label: this.resetArm > 0 ? 'SURE? PRESS AGAIN' : 'RESET PROGRESS',
        tone: UI.danger,
        x: CONTENT_X + 330,
        y: y0 + SYS_PITCH * 4,
        w: rowW + valueW + 16 + rowW + 16,
        h: 96,
        small: true,
      },
    );

    this.boardSysBody = (g: CanvasRenderingContext2D): void => {
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      // THE LABEL COLUMN HAS A WIDTH, and the sub-line has to respect
      // it: the controls start at CONTENT_X + 330, and a sub that ran
      // long used to print straight through SET THE FLOOR. Clamped, not
      // trusted.
      const labelW = 306;
      const label = (text: string, sub: string, y: number): void => {
        g.font = font(600, 30);
        g.fillStyle = UI.text;
        g.fillText(text, CONTENT_X + 10, y + 34, labelW);
        g.font = font(500, 22);
        g.fillStyle = UI.faint;
        g.fillText(sub, CONTENT_X + 10, y + 68, labelW);
      };
      label('SOUND', 'Effects volume', SYS_Y0);
      // The now-playing line rides the MUSIC row's sub, because a record
      // you cannot name is a record you cannot ask for again.
      const on = nowPlaying();
      label('MUSIC', on ? `now playing · ${on}` : 'the records', SYS_Y0 + SYS_PITCH);
      label('WALL FRAMES', 'Show detected walls', SYS_Y0 + SYS_PITCH * 2);
      label('THE FLOOR', 'Drag the tape to resize', SYS_Y0 + SYS_PITCH * 3);
      label('PROGRESS', 'Clear unlocks and best times', SYS_Y0 + SYS_PITCH * 4);

      const real = walls.filter((w) => w.real && w.kind === 'wall').length;
      const flats = walls.filter((w) => w.kind !== 'wall').length;
      const fake = walls.filter((w) => !w.real && w.kind === 'wall').length;
      g.font = font(500, 22);
      g.fillStyle = UI.faint;
      g.fillText(
        site.stageRoom
          ? `room: the headset's room-scale box (${stage.why})${flats ? ` · floor/ceiling ports live` : ''}`
          : `room: ${real} scanned wall${real === 1 ? '' : 's'}${fake ? ` · ${fake} stand-in` : ''}${flats ? ` · floor/ceiling ports live` : ''} · stage: ${stage.why}`,
        CONTENT_X + 10,
        H - 44,
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
   * that is left for a pause is to come back, call the horn, or leave.
   */
  private paintHandPause(): void {
    const [cw, ch] = BOARD.cardPx;
    const sg = plant.siege;
    const buttons: PanelButton[] = [
      { id: 'resume', label: 'RESUME', primary: true, x: 40, y: 236, w: cw - 80, h: 160 },
    ];
    if (sg.phase === 'build') {
      buttons.push({
        id: 'card:horn',
        label: 'SOUND THE HORN',
        tone: UI.danger,
        x: 40,
        y: 420,
        w: cw - 80,
        h: 120,
      });
    }
    buttons.push({
      id: 'quit',
      label: this.quitArm > 0 ? 'SURE? POKE AGAIN' : 'QUIT',
      tone: UI.danger,
      small: true,
      x: 40,
      y: ch - 150,
      w: cw - 80,
      h: 110,
    });
    const wave = waveSpec(sg.wave);
    this.card.paint(
      'PAUSED',
      (g) => {
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = font(600, 30);
        g.fillStyle = UI.dim;
        const status =
          sg.phase === 'core'
            ? 'PLACE THE CORE'
            : sg.phase === 'build'
              ? `WAVE ${sg.wave + 1} \u00b7 ${wave.name} \u00b7 ${Math.ceil(sg.buildT)}s`
              : sg.phase === 'wave'
                ? `WAVE ${sg.wave + 1} \u00b7 ${siegeLeft()} INCOMING`
                : 'THE CORE HAS FALLEN';
        g.fillText(status, cw / 2, 150, cw - 80);
        g.font = font(500, 22);
        g.fillStyle = UI.faint;
        g.fillText('The works keeps running while you are here.', cw / 2, 196, cw - 80);
      },
      buttons,
      this.hover,
    );
  }

  private canAfford(id: UpgradeId): boolean {
    const spec = UPGRADES.find((u) => u.id === id);
    if (!spec) return false;
    for (const [item, n] of Object.entries(spec.bill)) {
      if ((plant.bank[item as ItemId] ?? 0) < (n ?? 0)) return false;
    }
    return true;
  }

  /**
   * THE SHIFT CARD — Ⓐ, dead ahead, and the only menu a shift has.
   * Three pages: BUILD (the plant, plus the wrecking bar), GOALS (the
   * book, tappable for what a sheet actually asks of you) and SUPPLY
   * (the bank's bills). The live goal rides the header, so the room
   * floats nothing.
   */
  private paintFactoryCard(): void {
    if (intents.handMode) {
      this.paintHandPause();
      return;
    }
    const [cw, ch] = BOARD.cardPx;
    const armed = buildView.armed?.() ?? null;
    // Three columns, measured off the card instead of nailed to pixels —
    // the card grew and every hard-coded 166 would have left a gutter.
    const colW = (cw - 2 * CARD_PAD - 2 * CARD_GAP) / 3;
    const colX = (c: number): number => CARD_PAD + c * (colW + CARD_GAP);
    // The page tabs are THREE across, on their own measure.
    const tabW = (cw - 2 * CARD_PAD - 2 * CARD_GAP) / 3;
    const tab = (id: string, label: string, on: boolean, c: number): PanelButton => ({
      id,
      label,
      small: true,
      px: 24,
      selected: on,
      x: CARD_PAD + c * (tabW + CARD_GAP),
      y: 162,
      w: tabW,
      h: 42,
    });
    const buttons: PanelButton[] = [
      tab('card:build', 'BUILD', this.cardMode === 'build', 0),
      tab('card:goals', 'WAVES', this.cardMode === 'goals', 1),
      tab('card:controls', 'CONTROLS', this.cardMode === 'controls', 2),
      {
        id: 'resume',
        label: 'RESUME',
        primary: true,
        x: 34,
        y: ch - 84,
        w: cw / 2 - 46,
        h: 64,
      },
      {
        id: 'quit',
        label: this.quitArm > 0 ? 'SURE? PRESS AGAIN' : 'QUIT',
        tone: UI.danger,
        x: cw / 2 + 12,
        y: ch - 84,
        w: cw / 2 - 46,
        h: 64,
        small: true,
      },
    ];

    if (this.cardMode === 'build') {
      // EVERY TOOL CARRIES ITS PICTURE. Seven words in one weight is a
      // list you re-read every time you open the card; seven silhouettes
      // is a thing you learn once and then recognise on the floor,
      // because the ghost on your ray wears the same shape.
      //
      // The wrecking bar sits in the catalogue like any other tool —
      // playtest went looking for a delete and found nothing.
      const kit: Array<{ tool: BuildTool; label: string }> = [
        { tool: 'dock', label: 'CORE' },
        { tool: 'turret', label: 'TURRET' },
        { tool: 'piston', label: 'PISTON' },
        { tool: 'flamer', label: 'FLAMER' },
        { tool: 'tesla', label: 'TESLA' },
        { tool: 'mortar', label: 'MORTAR' },
      ].filter((e) => e.tool !== 'dock' || typeAvailable('dock')) as Array<{ tool: BuildTool; label: string }>;
      kit.forEach((entry, i) => {
        buttons.push({
          id: `build:${entry.tool}`,
          label: entry.label,
          small: true,
          px: 22,
          glyph: toolGlyph(entry.tool),
          // A gun you cannot pay for is a gun you cannot pick up.
          disabled:
            entry.tool === 'delete'
              ? false
              : !typeAvailable(entry.tool as UnitType) || !canAfford(entry.tool as UnitType),
          selected: armed === entry.tool,
          tone: entry.tool === 'delete' ? UI.danger : undefined,
          x: colX(i % 3),
          y: CARD_BODY + Math.floor(i / 3) * 100,
          w: colW,
          h: 92,
        });
      });
    } else if (this.cardMode === 'supply') {
      UPGRADES.forEach((u, i) => {
        buttons.push({
          id: `buy:${u.id}`,
          label: '',
          ghost: true,
          disabled: upgradeOwned(u.id) || !this.canAfford(u.id),
          x: CARD_PAD,
          y: CARD_BODY + i * billRowStep(ch),
          w: cw - 2 * CARD_PAD,
          h: billRowStep(ch) - 8,
        });
      });
    }

    // THE HORN — the build phase ends when you say so.
    const sg = plant.siege;
    if (sg.phase === 'build') {
      buttons.push({
        id: 'card:horn',
        label: 'SOUND THE HORN',
        small: true,
        px: 21,
        tone: UI.danger,
        x: cw - 34 - 236,
        y: 92,
        w: 236,
        h: 52,
      });
    }
    const wave = waveSpec(sg.wave);
    const title = `WAVE ${sg.wave + 1} \u00b7 ${wave.name}`;
    this.card.paint(
      title,
      (g) => {
        g.textBaseline = 'middle';
        g.textAlign = 'left';
        g.font = font(700, 30);
        if (sg.phase === 'build') {
          const secs = Math.ceil(sg.buildT);
          g.fillStyle = UI.accent;
          g.fillText(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, 36, 112);
          g.font = font(500, 20);
          g.fillStyle = UI.faint;
          g.fillText('until the horn', 120, 113);
        } else if (sg.phase === 'wave') {
          g.fillStyle = UI.danger;
          g.fillText(`${siegeLeft()} INCOMING`, 36, 112);
        } else if (sg.phase === 'core') {
          g.fillStyle = UI.accent;
          g.fillText('PLACE THE CORE', 36, 112);
        } else {
          g.fillStyle = UI.danger;
          g.fillText('THE CORE HAS FALLEN', 36, 112);
        }
        // The core, as a bar — the number the whole siege is about.
        const core = coreHealth();
        const barW = sg.phase === 'build' ? cw - 34 - 236 - 36 - 20 : cw - 72;
        g.fillStyle = 'rgba(255,255,255,0.08)';
        g.beginPath();
        g.roundRect(36, 138, barW, 12, 6);
        g.fill();
        g.fillStyle = core > 0.5 ? UI.positive : core > 0.25 ? UI.warn : UI.danger;
        g.beginPath();
        g.roundRect(36, 138, Math.max(6, barW * core), 12, 6);
        g.fill();
        g.font = font(600, 16);
        g.fillStyle = UI.faint;
        g.textAlign = 'right';
        g.fillText(`CORE ${Math.round(core * 100)}%  \u00b7  ${sg.coins} COINS`, 36 + barW, 124);
        g.textAlign = 'left';

        if (this.cardMode === 'goals') this.paintWaves(g, cw, ch);
        else if (this.cardMode === 'supply') this.paintBills(g, cw, ch);
        else if (this.cardMode === 'controls') this.paintCardControls(g);
        else {
          g.textAlign = 'center';
          const hoveredTool = this.hover?.startsWith('build:') ? this.hover.slice(6) : null;
          const describedTool = hoveredTool ?? armed;
          if (describedTool && describedTool in UNIT_DOCKET) {
            g.font = font(500, 18);
            g.fillStyle = UI.dim;
            g.fillText(UNIT_DOCKET[describedTool as UnitType], cw / 2, ch - CARD_FOOT - 64, cw - 2 * CARD_PAD);
          }
          g.font = font(500, 20);
          g.fillStyle = UI.faint;
          g.fillText(
            armed === 'delete'
              ? say('Aim at a machine; trigger to remove (refunds its cost)', 'Aim at a machine; pinch to remove (refunds its cost)')
              : armed === 'belt'
                ? ''
                : armed && isWeapon(armed as UnitType)
                  ? say(
                      `Place a ${UNIT_NAME[armed as UnitType]} (${costText(armed as UnitType)}) beside a lane · it fires on its own`,
                      `Pinch a ${UNIT_NAME[armed as UnitType]} down (${costText(armed as UnitType)}) beside a lane · it fires on its own`,
                    )
                  : armed
                    ? say('Aim at the floor · Trigger: place', 'Aim at the floor · Pinch: place')
                    : say('Choose a tower. Empty-handed: trigger a tower to upgrade or sell it.', 'Choose a tower. Touch a tower to upgrade or sell it.'),
            cw / 2,
            ch - CARD_FOOT - 34,
          );
          // THE WAY BACK OUT. Arming a tool used to be a one-way door
          // and nothing on this card said otherwise, so it says so now —
          // on the page where you pick the tool up, which is the only
          // place anybody is going to read it.
          if (armed) {
            g.font = font(600, 19);
            g.fillStyle = UI.dim;
            g.fillText(say('\u24cd / \u24ce PUT TOOL AWAY', 'PALM \u00b7 DOWN PUTS THE TOOL AWAY'), cw / 2, ch - CARD_FOOT - 8);
          }
        }
      },
      buttons,
      this.hover,
    );
  }

  /**
   * BARE HANDS — the controls page when there is nothing in your hands.
   * Four gestures carry the whole game, so it is a table of four, each
   * with the shape drawn beside it.
   */
  private paintHandControls(g: CanvasRenderingContext2D, x0: number, y0: number, w: number, pitch: number): void {
    const rows: Array<{ shape: 'pinch' | 'fist' | 'fists' | 'cuff'; name: string; does: string }> = [
      { shape: 'cuff', name: 'YOUR PALM', does: 'Turn your left palm toward you: the towers, the wave, the coins. Poke a tower with your right index finger to pick it up.' },
      { shape: 'pinch', name: 'PINCH', does: 'Aim with your right hand and pinch to put the tower down — anywhere but on a lane.' },
      { shape: 'pinch', name: 'TOUCH', does: 'Reach out and touch a tower: UPGRADE it, or SELL it. The palm\'s HORN calls the wave early.' },
    ];
    let y = y0;
    for (const row of rows) {
      handGlyph(g, row.shape, x0 + 6, y, 60);
      g.textAlign = 'left';
      g.textBaseline = 'top';
      g.font = font(700, 22);
      g.fillStyle = UI.accent;
      g.fillText(row.name, x0 + 90, y);
      wrapText(g, row.does, x0 + 90, y + 32, w - 96, 22, font(500, 18), UI.dim);
      y += pitch;
    }
    g.textBaseline = 'middle';
  }

  /** THE WAVES PAGE — where you are on the ladder, what this wave is
   *  teaching, and what is coming after it. Read-only: the siege has one
   *  way forward and it is the horn. */
  private paintWaves(g: CanvasRenderingContext2D, cw: number, ch: number): void {
    const sg = plant.siege;
    let y = CARD_BODY + 10;
    const spec = waveSpec(sg.wave);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = font(500, 20);
    g.fillStyle = UI.faint;
    g.fillText(sg.phase === 'wave' ? 'FIGHTING' : 'NEXT UP', CARD_PAD, y);
    y += 34;
    g.font = font(700, 30);
    g.fillStyle = UI.textHi;
    g.fillText(spec.name, CARD_PAD, y);
    y += 30;
    g.font = font(500, 19);
    g.fillStyle = UI.dim;
    g.fillText(waveSummary(spec), CARD_PAD, y, cw - 2 * CARD_PAD);
    y += 28;
    y +=
      26 * wrapText(g, spec.tip, CARD_PAD, y, cw - 2 * CARD_PAD, 26, font(600, 21), UI.accent) + 14;
    // What lives in the walls — every kind this wave sends.
    const kinds = [...new Set(spec.spawns.map((sp) => sp.enemy))];
    for (const k of kinds) {
      if (y > ch - CARD_FOOT - 120) break;
      const e = ENEMIES[k];
      g.font = font(700, 20);
      g.fillStyle = UI.text;
      g.fillText(e.name, CARD_PAD, y);
      g.font = font(500, 18);
      g.fillStyle = UI.faint;
      g.fillText(e.docket, CARD_PAD + 120, y, cw - 2 * CARD_PAD - 120);
      y += 28;
    }
    y += 10;
    // The ladder ahead.
    g.font = font(500, 18);
    g.fillStyle = UI.faint;
    g.fillText('AFTER THAT', CARD_PAD, y);
    y += 28;
    for (let n = sg.wave + 1; n < sg.wave + 6 && y < ch - CARD_FOOT - 20; n++) {
      const w = waveSpec(n);
      g.font = font(600, 20);
      g.fillStyle = UI.dim;
      g.fillText(`${n + 1}. ${w.name}`, CARD_PAD, y, 230);
      g.font = font(500, 17);
      g.fillStyle = UI.faint;
      g.fillText(waveSummary(w), CARD_PAD + 240, y, cw - 2 * CARD_PAD - 240);
      y += 28;
    }
  }

  /**
   * THE CARD'S CONTROLS PAGE — the factory's buttons, with the
   * controller they live on drawn beside them.
   *
   * The board's CONTROLS tab is the whole map; this is the one page of
   * it that matters mid-shift, at arm's length, with the words pointing
   * at the button. The right controller carries nearly everything, so
   * it goes on top; the left is here for Ⓧ, and to say the grip is a
   * two-handed thing.
   */
  private paintCardControls(g: CanvasRenderingContext2D): void {
    if (intents.handMode) {
      this.paintHandControls(g, CARD_PAD, CARD_BODY, BOARD.cardPx[0] - 2 * CARD_PAD, 94);
      return;
    }
    const S = 160;
    const X0 = CARD_PAD + 10;
    const RY = CARD_BODY + 4;
    const LY = RY + S + 28;
    const LBL = 250;
    const litRight = new Set<Control>(['trigger', 'grip', 'upper', 'lower']);
    const litLeft = new Set<Control>(['trigger', 'grip', 'upper', 'lower']);

    const aR = drawController(g, 'right', X0, RY, S, litRight);
    const aL = drawController(g, 'left', X0, LY, S, litLeft);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = font(500, 16);
    g.letterSpacing = '2px';
    g.fillStyle = UI.faint;
    g.fillText('RIGHT HAND', X0 + S / 2, RY + S + 12);
    g.fillText('LEFT HAND', X0 + S / 2, LY + S + 12);
    g.letterSpacing = '0px';

    const r = (c: Control): { x: number; y: number } => aR[c];
    const l = (c: Control): { x: number; y: number } => aL[c];
    callout(g, r('trigger'), LBL, RY + 12, 'right', 'TRIGGER',
      'Place the tower. Empty-handed on a tower: upgrade or sell.');
    callout(g, r('upper'), LBL, RY + 60, 'right', faceGlyph('right', 'upper'),
      'Turn the tower in hand a quarter.');
    callout(g, r('lower'), LBL, RY + 108, 'right', faceGlyph('right', 'lower'),
      'This card. Also puts a tower panel away.');
    callout(g, r('grip'), LBL, RY + 156, 'right', 'GRIP',
      'Not used.');
    callout(
      g,
      l('lower'),
      LBL,
      LY + 40,
      'right',
      `${faceGlyph('left', 'lower')} ${faceGlyph('left', 'upper')}`,
      'Put the tool away.',
    );
    callout(g, l('stick'), LBL, LY + 96, 'right', 'STICKS · MENU', 'Not used. Walk — it is your room.', false);
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
    const [cw, ch] = BOARD.boxPx;
    const PAD = 26;
    const footY = ch - 78;
    const tower = isWeapon(unit.type);
    const level = levelOf(unit);
    const next = tower ? upgradeCost(unit) : null;
    const coins = plant.siege.coins;
    const half = (cw - PAD * 2 - 12) / 2;
    const buttons: PanelButton[] = [];
    if (tower) {
      buttons.push(
        {
          id: 'box:upgrade',
          label: next === null ? 'MAX LEVEL' : `UPGRADE · ${next}`,
          small: true,
          px: 22,
          disabled: next === null || coins < next,
          tone: next !== null && coins >= next ? UI.positive : undefined,
          x: PAD,
          y: footY,
          w: half,
          h: 58,
        },
        {
          id: 'box:remove',
          label: `SELL · ${sellValue(unit)}`,
          small: true,
          px: 22,
          tone: UI.danger,
          x: PAD + half + 12,
          y: footY,
          w: half,
          h: 58,
        },
      );
    }
    // CLOSE lives in the corner, away from SELL.
    buttons.push({ id: 'box:close', label: 'CLOSE', small: true, px: 19, x: cw - PAD - 92, y: 22, w: 92, h: 42 });

    this.box.paint(
      unit.type === 'dock' ? 'THE CORE' : `${UNIT_NAME[unit.type]} · LEVEL ${level}`,
      (g) => {
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        unitGlyph(g, unit.type, PAD, 108, 74);
        wrapText(g, UNIT_DOCKET[unit.type], PAD + 92, 126, cw - PAD * 2 - 96, 24, font(500, 19), UI.dim);
        let y = 214;
        if (!tower) {
          // The core: its health and the purse.
          g.font = font(600, 22);
          g.fillStyle = UI.text;
          g.fillText(`CORE ${Math.round(coreHealth() * 100)}%  ·  ${coins} COINS`, PAD, y);
          return;
        }
        // THE LEVEL PIPS.
        for (let k = 0; k < SIEGE.levels.length; k++) {
          g.fillStyle = k < level ? UI.accent : 'rgba(255,255,255,0.12)';
          g.beginPath();
          g.roundRect(PAD + k * 54, y - 9, 46, 18, 9);
          g.fill();
        }
        g.font = font(600, 20);
        g.fillStyle = UI.faint;
        g.fillText(`${coins} COINS`, PAD + SIEGE.levels.length * 54 + 14, y);
        // NOW → NEXT: what the upgrade buys.
        y += 44;
        const spec = WEAPONS[unit.type as WeaponId];
        const cur = SIEGE.levels[level - 1];
        const nxt = SIEGE.levels[level];
        const rows: Array<[string, (l: typeof cur) => string]> = [
          ['DAMAGE', (l) => `${Math.round(spec.damage * l.damage)}`],
          ['REACH', (l) => `${(spec.range * l.range * 0.7).toFixed(2)} m`],
          ['RATE', (l) => `${((1 / spec.cycleS) * l.rate).toFixed(1)}/s`],
        ];
        for (const [name, f] of rows) {
          g.font = font(500, 19);
          g.fillStyle = UI.faint;
          g.fillText(name, PAD, y);
          g.font = font(600, 22);
          g.fillStyle = UI.text;
          g.fillText(f(cur), PAD + 120, y);
          if (nxt) {
            g.fillStyle = UI.positive;
            g.fillText(`→ ${f(nxt)}`, PAD + 260, y);
          }
          y += 34;
        }
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
        y: ch - 132,
        w: 420,
        h: 92,
      },
      {
        id: 'fin:board',
        label: 'BACK TO THE BOARD',
        x: cw / 2 + 20,
        y: ch - 132,
        w: 420,
        h: 92,
      },
    ];
    const sg = plant.siege;
    this.finale.paint(
      '',
      (g) => {
        g.textAlign = 'center';
        g.textBaseline = 'middle';

        // THE PLATE: a bolted rectangle with a hairline inside it and
        // four hex heads holding it on, in the works' own iron.
        const px = 40;
        const py = 30;
        const pw = cw - px * 2;
        const ph = ch - py - 158;
        g.fillStyle = 'rgba(255,162,46,0.05)';
        g.beginPath();
        g.roundRect(px, py, pw, ph, 18);
        g.fill();
        g.strokeStyle = UI.accentDim;
        g.lineWidth = 3;
        g.stroke();
        g.strokeStyle = UI.lineFaint;
        g.lineWidth = 1.5;
        g.beginPath();
        g.roundRect(px + 13, py + 13, pw - 26, ph - 26, 12);
        g.stroke();
        for (const [bx, by] of [
          [px + 34, py + 34],
          [px + pw - 34, py + 34],
          [px + 34, py + ph - 34],
          [px + pw - 34, py + ph - 34],
        ]) {
          g.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
            const hx = bx + Math.cos(a) * 11;
            const hy = by + Math.sin(a) * 11;
            if (i === 0) g.moveTo(hx, hy);
            else g.lineTo(hx, hy);
          }
          g.closePath();
          g.fillStyle = 'rgba(255,255,255,0.10)';
          g.fill();
          g.strokeStyle = UI.line;
          g.lineWidth = 2;
          g.stroke();
        }

        unitGlyph(g, 'dock', cw / 2 - 52, 64, 104, GLYPH_LIVE);

        g.font = font(700, 58);
        g.letterSpacing = '8px';
        g.fillStyle = UI.textHi;
        g.fillText('THE CORE HAS FALLEN', cw / 2, 214);
        g.letterSpacing = '0px';
        g.font = font(600, 28);
        g.fillStyle = UI.accent;
        g.fillText(
          `${sg.wave} wave${sg.wave === 1 ? '' : 's'} held \u00b7 ${sg.kills} put down`,
          cw / 2,
          262,
        );

        // The stamped rule under the title: amber, broken in the middle
        // the way a maker's plate carries its serial.
        g.strokeStyle = UI.accent;
        g.lineWidth = 3;
        for (const dir of [-1, 1]) {
          g.beginPath();
          g.moveTo(cw / 2 + dir * 56, 296);
          g.lineTo(cw / 2 + dir * 296, 296);
          g.stroke();
        }
        g.fillStyle = UI.accent;
        g.beginPath();
        g.arc(cw / 2, 296, 6, 0, Math.PI * 2);
        g.fill();

        // THE CREDITS: small stencilled label over a big name — a plate,
        // not a paragraph. The names are given the type size that FITS
        // rather than a fixed one, because a name is not something to
        // wrap, hyphenate or run off the end of a card.
        const stencil = (label: string, y: number): void => {
          g.font = font(600, 21);
          g.letterSpacing = '6px';
          g.fillStyle = UI.faint;
          g.fillText(label, cw / 2, y);
          g.letterSpacing = '0px';
        };
        const name = (text: string, y: number, want: number, colour: string): void => {
          let size = want;
          for (; size > 18; size -= 2) {
            g.font = font(700, size);
            if (g.measureText(text).width <= pw - 96) break;
          }
          g.fillStyle = colour;
          g.fillText(text, cw / 2, y);
        };

        stencil('CREATED BY', 348);
        name('yellkell', 396, 48, UI.accent);
        stencil('MUSIC BY', 460);
        name('IBWildcat1998, poopoodoodoo698 & JakeThePro', 506, 34, UI.text);
      },
      buttons,
      this.hover,
    );
  }

  /**
   * THE BANK'S BILLS.
   *
   * The old cut printed a bill as a run of words — "8 CELL + 4 PUMP" —
   * on a row of grey text, which told you the price and nothing at all
   * about whether you could pay it: you had to hold the number in your
   * head and go and look at the bank. Every bill is CHIPS now, one per
   * ingredient, each carrying the part's own drawing, what it costs, and
   * what the bank actually holds — and each chip turns green on its own
   * the moment that line of the bill is covered. You can see at a glance
   * which single part you are short of, which is the only question
   * anybody ever asks this page.
   */
  private paintBills(g: CanvasRenderingContext2D, cw: number, ch: number): void {
    const hoverOf = (id: string): number => this.card.hoverOf(id);
    const step = billRowStep(ch);
    const h = step - 8;
    const CHIP = 94;
    UPGRADES.forEach((u, i) => {
      const y = CARD_BODY + i * step;
      const owned = upgradeOwned(u.id);
      const afford = this.canAfford(u.id);
      const hov = hoverOf(`buy:${u.id}`);
      g.fillStyle = owned
        ? UI.accentFaint
        : `rgba(255,255,255,${(0.035 + 0.05 * hov).toFixed(3)})`;
      g.beginPath();
      g.roundRect(CARD_PAD, y, cw - 2 * CARD_PAD, h, 12);
      g.fill();
      g.strokeStyle = owned
        ? 'rgba(255,162,46,0.5)'
        : `rgba(255,255,255,${(0.08 + 0.2 * hov).toFixed(3)})`;
      g.lineWidth = 2;
      g.stroke();

      const bill = Object.entries(u.bill) as Array<[ItemId, number]>;
      const billW = owned ? 96 : bill.length * CHIP;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.font = font(600, 21);
      g.fillStyle = owned ? UI.dim : afford ? UI.text : UI.disabled;
      g.fillText(u.name, CARD_PAD + 18, y + h / 2 - 12, cw - 2 * CARD_PAD - billW - 40);
      g.font = font(500, 16);
      g.fillStyle = UI.faint;
      g.fillText(u.effect, CARD_PAD + 18, y + h / 2 + 13, cw - 2 * CARD_PAD - billW - 40);

      if (owned) {
        g.textAlign = 'right';
        g.font = font(700, 19);
        g.fillStyle = UI.accent;
        g.fillText('FITTED', cw - CARD_PAD - 20, y + h / 2);
        return;
      }
      // One chip per ingredient: the drawing, the price, and what the
      // bank has against it.
      bill.forEach(([item, need], n) => {
        const have = plant.bank[item] ?? 0;
        const covered = have >= (need ?? 0);
        const x = cw - CARD_PAD - billW + n * CHIP + 6;
        itemGlyph(g, item, x, y + h / 2 - 17, 34, covered ? GLYPH_LIVE : GLYPH_DEAD);
        g.textAlign = 'left';
        g.font = font(700, 19);
        g.fillStyle = covered ? UI.positive : UI.warn;
        g.fillText(String(need ?? 0), x + 40, y + h / 2 - 9);
        g.font = font(500, 14);
        g.fillStyle = UI.faint;
        g.fillText(`bank ${have}`, x + 40, y + h / 2 + 12);
      });
    });
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

/* ── the shift card's layout band ───────────────────────────────────────
 * The card has three fixed zones — header (goal + clock), body (the
 * page), footer (BACK TO IT / DOWN TOOLS, and whatever the page parks
 * above them) — and every page measures itself against these instead of
 * guessing pixels. Playtest found text over text on the GOALS page; it
 * was all fixed offsets that had outgrown a 500 px card.
 */
const CARD_PAD = 34;
const CARD_GAP = 8;
/** Where a page's body may start — clear of the tabs at y 162. */
const CARD_BODY = 220;
/** How much of the bottom belongs to the footer, measured up from ch.
 *  BACK TO IT / QUIT sit at ch − 84 and stand 64 tall, so 124 is that
 *  band plus a hairline of air — the old 150 was sized for a shorter
 *  card and left every page a dead stripe it could have been reading
 *  in. */
const CARD_FOOT = 124;

/** Row pitch for the goals ladder: share the body band out over the
 *  book, so a longer book tightens up instead of running off the card. */

/** The same share-out for the bills. They are fatter than goal rows
 *  because each one carries its bill as chips rather than as words. */
function billRowStep(ch: number): number {
  const band = ch - CARD_FOOT - 26 - CARD_BODY;
  return Math.max(46, Math.min(72, Math.floor(band / Math.max(1, UPGRADES.length))));
}

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
