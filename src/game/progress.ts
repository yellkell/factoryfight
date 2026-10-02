/**
 * The fitter's record — which jobs are open and the best time each has
 * been worked in, kept in localStorage. It works with no network at all
 * because there is no network: TUBES is a shop, not a service.
 */

import { JOBS, ORDERS, UPGRADES, type ItemId, type UpgradeId } from '../config.js';

const KEY = 'ffight-progress';

interface Stored {
  /** How many jobs are open (1 = just FIRST LIGHT). */
  unlocked: number;
  /** Best completion, ms, by job id. */
  best: Record<string, number>;
  /** The factory's book: how far down it this headset has got (1 = only
   *  the first sheet has ever been posted), best per sheet, the banked
   *  parts, and the fittings bought with them. */
  orders: number;
  /** THE BOOK IS FILLED. `orders` saturates at ORDERS.length the moment
   *  the LAST sheet is posted, so it cannot tell "reached the last one"
   *  from "finished it" — and those two want different shifts (the last
   *  sheet, or the shop wide open). This says which. */
  bookDone: boolean;
  orderBest: Record<string, number>;
  bank: Record<string, number>;
  upgrades: string[];
  /** THE SIEGE: the furthest wave this headset has ever cleared (0 =
   *  none), and the most enemies one siege has put down. */
  bestWave: number;
  bestKills: number;
}

let stored: Stored = {
  unlocked: 1,
  best: {},
  orders: 1,
  bookDone: false,
  orderBest: {},
  bank: {},
  upgrades: [],
  bestWave: 0,
  bestKills: 0,
};

function readTimes(into: Record<string, number>, from: unknown): void {
  if (!from || typeof from !== 'object') return;
  for (const [id, ms] of Object.entries(from)) {
    if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) into[id] = ms;
  }
}

(() => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (typeof parsed.unlocked === 'number' && parsed.unlocked >= 1) {
      stored.unlocked = Math.min(JOBS.length, Math.floor(parsed.unlocked));
    }
    readTimes(stored.best, parsed.best);
    if (typeof parsed.orders === 'number' && parsed.orders >= 1) {
      stored.orders = Math.min(ORDERS.length, Math.floor(parsed.orders));
    }
    stored.bookDone = parsed.bookDone === true;
    readTimes(stored.orderBest, parsed.orderBest);
    if (parsed.bank && typeof parsed.bank === 'object') {
      for (const [item, n] of Object.entries(parsed.bank)) {
        if (typeof n === 'number' && Number.isFinite(n) && n > 0) stored.bank[item] = Math.floor(n);
      }
    }
    if (typeof parsed.bestWave === 'number' && parsed.bestWave > 0) {
      stored.bestWave = Math.floor(parsed.bestWave);
    }
    if (typeof parsed.bestKills === 'number' && parsed.bestKills > 0) {
      stored.bestKills = Math.floor(parsed.bestKills);
    }
    if (Array.isArray(parsed.upgrades)) {
      stored.upgrades = parsed.upgrades.filter(
        (u): u is string => typeof u === 'string' && UPGRADES.some((s) => s.id === u),
      );
    }
  } catch {
    /* fine — a fresh sheet */
  }
})();

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    /* private mode — the shift still counts, it just won't keep */
  }
}

export function unlockedJobs(): number {
  return stored.unlocked;
}

export function bestMs(jobId: string): number | null {
  return stored.best[jobId] ?? null;
}

/** A job landed: keep the better time, open the next sheet. Returns true
 *  if this time is a new best. */
export function recordJobDone(jobId: string, ms: number): boolean {
  const jobIndex = JOBS.findIndex((j) => j.id === jobId);
  if (jobIndex >= 0) {
    stored.unlocked = Math.max(stored.unlocked, Math.min(JOBS.length, jobIndex + 2));
  }
  const prev = stored.best[jobId];
  const better = prev === undefined || ms < prev;
  if (better) stored.best[jobId] = Math.round(ms);
  save();
  return better;
}

/* ── the factory's book ──────────────────────────────────────────────────── */

export function ordersUnlocked(): number {
  return stored.orders;
}

/**
 * How far down the book this headset has got — the sheet a returning
 * shift picks up on, and the sheet the FACTORY tab points its ticks at.
 * −1 once the book is filled, which is a different thing again: the shop
 * opens the whole way.
 */
export function bookAt(): number {
  if (stored.bookDone) return -1;
  return Math.max(0, Math.min(ORDERS.length - 1, stored.orders - 1));
}

/** The book is filled — every sheet, on this headset, for good. */
export function bookFinished(): boolean {
  return stored.bookDone;
}

export function orderBestMs(orderId: string): number | null {
  return stored.orderBest[orderId] ?? null;
}

/** A sheet filled: keep the better time, open the next page. */
export function recordOrderDone(orderId: string, ms: number): boolean {
  const idx = ORDERS.findIndex((o) => o.id === orderId);
  if (idx >= 0) {
    stored.orders = Math.max(stored.orders, Math.min(ORDERS.length, idx + 2));
    if (idx === ORDERS.length - 1) stored.bookDone = true;
  }
  const prev = stored.orderBest[orderId];
  const better = prev === undefined || ms < prev;
  if (better) stored.orderBest[orderId] = Math.round(ms);
  save();
  return better;
}

/** The bank lives on the shelf between shifts. */
export function loadBank(): Partial<Record<ItemId, number>> {
  return { ...(stored.bank as Partial<Record<ItemId, number>>) };
}

export function saveBank(bank: Partial<Record<ItemId, number>>): void {
  const clean: Record<string, number> = {};
  for (const [item, n] of Object.entries(bank)) {
    if (typeof n === 'number' && n > 0) clean[item] = Math.floor(n);
  }
  stored.bank = clean;
  save();
}

/* ── the fittings (bought upgrades) ──────────────────────────────────────── */

export function upgradeOwned(id: UpgradeId): boolean {
  return stored.upgrades.includes(id);
}

export function ownedUpgrades(): string[] {
  return [...stored.upgrades];
}

export function recordUpgrade(id: UpgradeId): void {
  if (!stored.upgrades.includes(id)) stored.upgrades.push(id);
  save();
}

/** The fittings' effects — read live by the sim and the pull. */
export function craftFactor(): number {
  return upgradeOwned('quick-boxes') ? 0.75 : 1;
}
export function railFactor(): number {
  return upgradeOwned('belt-pace') ? 1.25 : 1;
}
export function chestBonus(): number {
  return upgradeOwned('deep-crates') ? 12 : 0;
}

/** Posts are a bought VERB: until the fitting is paid for, the catalogue
 *  doesn't offer sticks and a haul always goes the direct way. */
export function postsUnlocked(): boolean {
  return upgradeOwned('route-posts');
}
/** THICK PLATE doubles a wall; CORE ARMOUR adds half again to the core. */
export function hpFactor(type: string): number {
  if (type === 'wall' && upgradeOwned('thick-plate')) return 2;
  if (type === 'dock' && upgradeOwned('core-armour')) return 1.5;
  return 1;
}
/** LONG BARRELS: every turret reaches a quarter further. */
export function rangeFactor(): number {
  return upgradeOwned('long-barrels') ? 1.25 : 1;
}
/** RAPID BREECH: every turret cycles a third faster. */
export function cycleFactor(): number {
  return upgradeOwned('rapid-breech') ? 0.75 : 1;
}
export function reachBonus(): number {
  return upgradeOwned('long-reach') ? 2 : 0;
}

/** SYSTEM tab: tear the sheet up and start the trade again. */
export function resetProgress(): void {
  stored = {
    unlocked: 1,
    best: {},
    orders: 1,
    bookDone: false,
    orderBest: {},
    bank: {},
    upgrades: [],
    bestWave: 0,
    bestKills: 0,
  };
  save();
}

/* ── the siege's record ──────────────────────────────────────────────────── */

export function bestWave(): number {
  return stored.bestWave;
}
export function bestKills(): number {
  return stored.bestKills;
}
/** A siege ended (fallen, or walked away from): keep the better marks. */
export function recordSiege(wavesCleared: number, kills: number): boolean {
  const better = wavesCleared > stored.bestWave;
  stored.bestWave = Math.max(stored.bestWave, wavesCleared);
  stored.bestKills = Math.max(stored.bestKills, kills);
  save();
  return better;
}
