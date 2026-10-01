/**
 * Shift flow — the only place screens change hands. These are plain state
 * mutations; the systems notice (`site.generation`, `site.screen`) and do
 * the physical work: PlacementSystem hands you the next flange,
 * TubeSystem builds the hardware, FlowSystem pours the light, MenuSystem
 * brings the board back with the sheet stamped.
 */

import { CEREMONY_S, JOBS, ORDERS, UPGRADES, type ItemId, type UpgradeId } from '../config.js';
import { freshSeed } from './rng.js';
import {
  recordJobDone,
  recordOrderDone,
  recordSiege,
  recordUpgrade,
  saveBank,
  unlockedJobs,
  upgradeOwned,
} from './progress.js';
import { buildRuns, site } from './state.js';
import { clearPlant, openShopFully, orderSpec, plant, postOrder } from '../factory/state.js';
import { startSiege } from '../factory/siege.js';
import * as sfx from '../audio/sfx.js';

/** Clock in on a job. `seed` is for the tools — a layout replayed exactly. */
export function startJob(jobIndex: number, seed?: number): void {
  if (jobIndex < 0 || jobIndex >= JOBS.length || jobIndex >= unlockedJobs()) return;
  site.jobIndex = jobIndex;
  site.seed = seed ?? freshSeed();
  site.runs = buildRuns(JOBS[jobIndex]);
  site.activeRun = 0;
  site.elapsedMs = 0;
  site.ceremonyT = 0;
  site.screen = 'shift';
  site.fx.length = 0;
  site.generation++;
}

/** Down tools mid-shift (the JOB CARD's walk-away): everything mounted
 *  comes off the walls and the board takes over. */
export function abandonShift(): void {
  if (site.screen === 'board') return;
  site.runs = [];
  site.activeRun = -1;
  site.screen = 'board';
  site.fx.length = 0;
  sfx.stopAllHums();
  site.generation++;
}

/** A run's pour landed (FlowSystem calls this). Advance the shift: wake
 *  the next run's flange, or — last one down — start the ceremony. */
export function runLanded(runIndex: number): void {
  if (site.screen !== 'shift') return;
  const next = runIndex + 1;
  if (next < site.runs.length) {
    site.runs[next].phase = 'place';
    site.runs[next].phaseT = 0;
    site.activeRun = next;
    return;
  }
  // The last seat of the job — the room gets its moment before the board.
  site.activeRun = -1;
  site.screen = 'ceremony';
  site.ceremonyT = CEREMONY_S;
  site.fx.push({ kind: 'ceremony', runIndex });
  const job = JOBS[site.jobIndex];
  const newBest = recordJobDone(job.id, site.elapsedMs);
  sfx.stampDone();
  if (newBest) {
    /* the board will show the time in the accent — no popup needed */
  }
}

/* ── the factory (FACTORY.md phases 1–2) ─────────────────────────────────── */

/**
 * OPEN THE FACTORY. ONE ENTRANCE — and it picks up where you left off.
 *
 * Two mistakes have been made on this function and it is worth naming
 * both, because the second was made fixing the first.
 *
 * The board used to let you PICK any sheet you had ever reached, which
 * sounds generous and was a trap: a shift starts with a bare floor, so
 * choosing sheet four dealt you sheet four's demands with none of sheets
 * one to three's feeds, plant or parts. Unwinnable, silently.
 *
 * The fix was one door that always opened at sheet one — and that threw
 * every session's progress on the floor. Come back after a week and the
 * catalogue was a single MAKER again; `stored.orders` was written
 * faithfully by recordOrderDone and then read by nobody. "We can't build
 * a bank" was the literal truth.
 *
 * So: one door, and it opens on the sheet the book had got to, with
 * everything sheets before it ever switched on already switched on
 * (postOrder's wakes are cumulative — that is the half of this fix that
 * makes arriving mid-book survivable). Fill the book and the door opens
 * onto the shop wide open instead. The floor is still bare, because a
 * shift is a shift; the BANK rides in from the shelf, and the plant is
 * yours to stand again.
 *
 * `index` stays as a tools-only override, so a walk can jump the ladder.
 */
export function startShop(atWave?: number): void {
  if (site.screen !== 'board') return;
  clearPlant();
  site.paused = false;
  site.inspect = -1;
  site.finale = false;
  site.screen = 'factory';
  // MAN THE WALLS: the core stands, the first breaches crack, the clock
  // starts. `atWave` is a tools-only jump down the ladder.
  startSiege(Math.max(0, atWave ?? 0));
  site.generation++;
}

/** DOWN TOOLS: the whole shift comes off the floor, the board returns.
 *  The siege's marks are kept (waves held, enemies put down); the bank
 *  was this siege's and goes with it — the fittings bought out of it
 *  stay bought. */
export function abandonFactory(): void {
  if (site.screen !== 'factory') return;
  recordSiege(wavesHeld(), plant.siege.kills);
  clearPlant();
  site.screen = 'board';
  site.inspect = -1;
  site.finale = false;
  sfx.stopAllHums();
  site.generation++;
}

/** Waves this siege has actually survived. */
export function wavesHeld(): number {
  // Building for wave N, fighting it, or fallen to it: N waves held.
  return plant.siege.wave;
}

/** THE CORE WENT (SiegeSystem calls this after the fall has played):
 *  the marks are kept, and the last card comes up — TRY AGAIN or the
 *  board. The floor stays as it fell until you choose. */
export function siegeFallen(): void {
  if (site.screen !== 'factory') return;
  recordSiege(wavesHeld(), plant.siege.kills);
  site.paused = false;
  site.inspect = -1;
  site.finale = true;
}

/** TRY AGAIN — straight back onto a fresh floor, no trip to the board. */
export function retrySiege(): void {
  if (site.screen !== 'factory') return;
  clearPlant();
  site.finale = false;
  site.paused = false;
  site.inspect = -1;
  sfx.stopAllHums();
  startSiege(0);
  site.generation++;
}

/** A goal filled (the sim's 'complete' event lands here): stamp it and
 *  post the next one INTO THE SAME SHIFT — the plant persists, the
 *  catalogue grows, and nothing kicks you out to a menu. The last goal
 *  simply opens the shop the rest of the way. */
export function orderComplete(): void {
  const spec = orderSpec();
  if (!spec || site.screen !== 'factory') return;
  // The clock is the SHIFT's, not the sheet's — the book advances in
  // place and never resets it — so a sheet's "best" is honestly "how
  // fast you got this far from an empty floor", which is the only
  // comparable number a continuous session can offer.
  recordOrderDone(spec.id, plant.elapsedMs);
  saveBank(plant.bank);
  const next = plant.orderIndex + 1;
  if (next < ORDERS.length) {
    postOrder(next);
    return;
  }
  openShopFully();
  sfx.stampDone();
  sfx.ceremonyChord();
}

/** Pay a bill: the fitting is bought with banked parts, kept for good,
 *  live the moment the stamp lands. False when the bank can't cover it
 *  (or it's already fitted). */
export function buyUpgrade(id: UpgradeId): boolean {
  const spec = UPGRADES.find((u) => u.id === id);
  if (!spec || upgradeOwned(id)) return false;
  for (const [item, n] of Object.entries(spec.bill)) {
    if ((plant.bank[item as ItemId] ?? 0) < (n ?? 0)) return false;
  }
  for (const [item, n] of Object.entries(spec.bill)) {
    plant.bank[item as ItemId] = (plant.bank[item as ItemId] ?? 0) - (n ?? 0);
  }
  recordUpgrade(id);
  saveBank(plant.bank);
  sfx.stampDone();
  return true;
}

/** THE FLOOR (FACTORY.md, phase 0): step off the board and mark the
 *  site out in hazard tape. FloorSystem owns the verb and the exit
 *  button; these own the screen change. */
export function enterFloorSetup(): void {
  if (site.screen !== 'board') return;
  site.screen = 'floor';
  site.generation++;
}

export function exitFloorSetup(): void {
  if (site.screen !== 'floor') return;
  site.screen = 'board';
  site.generation++;
}

/** Ceremony over: the hardware stays lit in memory, the board returns. */
export function ceremonyDone(): void {
  if (site.screen !== 'ceremony') return;
  site.runs = [];
  site.activeRun = -1;
  site.screen = 'board';
  sfx.stopAllHums();
  // Land the board on the next open sheet, ready to start.
  site.jobIndex = Math.min(unlockedJobs() - 1, JOBS.length - 1);
  site.generation++;
}
