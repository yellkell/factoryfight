#!/usr/bin/env node
/**
 * THE FLOOR WALK — hazard tape and the lattice, worked headlessly.
 *
 *   npm run dev
 *   node tools/floor-walk.mjs
 *
 * Boots the page in the desktop emulator, clocks in, forces the fallback
 * room, then works phase 0 of the factory (FACTORY.md) through the REAL
 * modules: the SYSTEM tab's SET THE FLOOR, the default rectangle dealt
 * from the walls, every clamp law (the cap, the minimum floor, the
 * plant law), the wall snap through the live drag path, crates stamped
 * and refused on the lattice, and the layout surviving a reload.
 *
 * Exits non-zero if any of it fails.
 */

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const fails = [];
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) fails.push(what);
};
const near = (a, b, eps = 0.02) => Math.abs(a - b) < eps;

let browser;
try {
  browser = await chromium.launch();
} catch {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
}
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
page.on('pageerror', (e) => fails.push(`[pageerror] ${e.message}`));

/** Enter the headset and force the stand-in room. */
async function clockIn() {
  await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(base));
  await page.waitForTimeout(1000);
  await page.click('#enter-ar');
  await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 15000 });
  await page.waitForFunction(() => Boolean(window.__tubes?.site), { timeout: 10000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__tubes.wallsInfo.forceFallback());
  await page.waitForFunction(() => window.__tubes.site.wallsReady, { timeout: 5000 });
}

/** SYSTEM tab → SET THE FLOOR. */
async function enterFloor() {
  await page.evaluate(() => window.__tubes.menu.act('tab:sys'));
  const offered = await page.evaluate(() => window.__tubes.menu.boardButtons());
  check(offered.includes('floor:set'), `the SYSTEM tab offers SET THE FLOOR (${offered.join(', ')})`);
  await page.evaluate(() => window.__tubes.menu.act('floor:set'));
  await page.waitForFunction(() => window.__tubes.site.screen === 'floor', undefined, { timeout: 4000 });
  await page.waitForFunction(() => window.__tubes.floor.state().initialized, undefined, { timeout: 4000 });
}

const state = () => page.evaluate(() => window.__tubes.floor.state());
const moveSide = (side, v) => page.evaluate(({ s, val }) => window.__tubes.floor.moveSide(s, val), { s: side, val: v });
const dragTo = (side, v) => page.evaluate(({ s, val }) => window.__tubes.floor.dragTo(s, val), { s: side, val: v });

console.log('PLAY');
await clockIn();

console.log('THE FLOOR');
await enterFloor();

// The default rectangle: the fallback room's walls (4.6 × 3.6 around the
// player), inset by FLOOR.inset — the tape starts AT your walls.
let s = await state();
check(s.tapeUp === true, 'the tape stands while the floor is being marked');
check(near(s.layout.left, -2.05) && near(s.layout.right, 2.05), `default sides sit at the walls, inset (left ${s.layout.left.toFixed(2)}, right ${s.layout.right.toFixed(2)})`);
check(near(s.layout.far, -1.55) && near(s.layout.near, 1.55), `default ends too (far ${s.layout.far.toFixed(2)}, near ${s.layout.near.toFixed(2)})`);

// THE CAP: no side walks past FLOOR.maxSide, however hard it's hauled.
let v = await moveSide('left', -10);
check(near(v, -7), `the cap holds a runaway side (left → ${v.toFixed(2)})`);

// THE MINIMUM: sides can't close inside minWidth — the floor re-centres
// around the squeeze instead of collapsing.
v = await moveSide('left', 1.2);
s = await state();
check(near(s.layout.right - s.layout.left, 1.8), `the floor stays a floor (width ${(s.layout.right - s.layout.left).toFixed(2)})`);
check(s.layout.right > 2.06, `the squeeze pushed the far side out (right ${s.layout.right.toFixed(2)})`);

// RESET deals the room's rectangle again.
await page.evaluate(() => window.__tubes.floor.reset());
s = await state();
check(near(s.layout.left, -2.05) && near(s.layout.right, 2.05), 'reset deals the walls again');

// THE STAGE: the desktop has no boundary drawn (the emulator's bounded
// floor carries no geometry), so the walls dealt the default above —
// stand a room-scale box in for the headset's and it beats the walls,
// taken as drawn, no inset; lift it and the walls take their turn back.
let st = await page.evaluate(() => window.__tubes.stage.state());
check(st.settled && st.rect === null, `no boundary on the desktop: the stage settled empty (${JSON.stringify(st)})`);
await page.evaluate(() => window.__tubes.stage.force({ minX: -1.3, maxX: 1.1, minZ: -1.0, maxZ: 0.9 }));
await page.evaluate(() => window.__tubes.floor.reset());
s = await state();
check(
  near(s.layout.left, -1.3) && near(s.layout.right, 1.1) && near(s.layout.far, -1.0) && near(s.layout.near, 0.9),
  `the tape stands on the room-scale box (left ${s.layout.left.toFixed(2)}, right ${s.layout.right.toFixed(2)}, far ${s.layout.far.toFixed(2)}, near ${s.layout.near.toFixed(2)})`,
);
await page.evaluate(() => window.__tubes.stage.force({ minX: -0.4, maxX: 0.4, minZ: -0.3, maxZ: 0.3 }));
await page.evaluate(() => window.__tubes.floor.reset());
s = await state();
check(near(s.layout.right - s.layout.left, 1.8) && near(s.layout.near - s.layout.far, 1.8), `a box too small still gets a floor (${(s.layout.right - s.layout.left).toFixed(2)} × ${(s.layout.near - s.layout.far).toFixed(2)})`);
await page.evaluate(() => window.__tubes.stage.force(null));
await page.evaluate(() => window.__tubes.floor.reset());
s = await state();
check(near(s.layout.left, -2.05) && near(s.layout.right, 2.05), 'the box lifted, the walls deal again');

// THE SNAP, through the live drag path: inside snapDist of a parallel
// wall the side magnetises to just off the plaster (wall −2.3 + gap).
v = await dragTo('left', -2.25);
check(near(v, -2.26, 0.005), `the wall takes the tape (left → ${v.toFixed(3)})`);
v = await dragTo('left', -1.5);
check(near(v, -1.5, 0.005), `outside the window the hand keeps it (left → ${v.toFixed(3)})`);

console.log('THE LATTICE');
const placed = await page.evaluate(() => window.__tubes.build.placeAt(0, -2));
check(placed, 'a crate stamps onto a free cell');
const dup = await page.evaluate(() => window.__tubes.build.placeAt(0, -2));
check(dup === false, 'the taken cell refuses a second');
const out = await page.evaluate(() => window.__tubes.build.placeAt(20, 0));
check(out === false, 'a cell outside the tape refuses');
await page.evaluate(() => window.__tubes.build.placeAt(2, -3));
let count = await page.evaluate(() => window.__tubes.build.count());
check(count === 2, `two crates standing (${count})`);

// A look at the tape and the standing plant, for the humans — the rig
// steps back so the bench crates sit in frame, then comes home.
mkdirSync('shots', { recursive: true });
await page.evaluate(() => window.__tubes.rig(0, 1.3, 0));
await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/floor-walk.png' });
await page.evaluate(() => window.__tubes.rig(0, 0, 0));
console.log('  · shots/floor-walk.png');

const gone = await page.evaluate(() => window.__tubes.build.removeAt(2, -3));
count = await page.evaluate(() => window.__tubes.build.count());
check(gone && count === 1, `Ⓑ unbolts one (${count} left)`);

// THE PLANT LAW: a side refuses to cross the standing crate — it stops
// at the cell's edge plus the pad (one 0.35 m plant cell is 0.245 m of
// room at FACTORY FIGHT's 0.7 scale, + 0.15), outward moves stay free.
v = await moveSide('right', 0.1);
check(near(v, 0.35 * 0.7 + 0.15), `the tape refuses to cross plant (right → ${v.toFixed(2)})`);
v = await moveSide('right', 1.9);
check(near(v, 1.9), `outward is always legal (right → ${v.toFixed(2)})`);

// Clear the crate and the law lifts.
await page.evaluate(() => window.__tubes.build.removeAt(0, -2));
v = await moveSide('right', 0.9);
check(near(v, 0.9), `an empty floor moves freely again (right → ${v.toFixed(2)})`);

// A distinctive layout for the reload to find.
await dragTo('near', 1.2);
s = await state();
const kept = { ...s.layout };

// Ⓐ — done: the board comes back, the layout is on the shelf — and the
// TAPE COMES DOWN: barricade tape is site dressing, not furniture.
await page.evaluate(() => window.__tubes.floor.exit());
await page.waitForFunction(() => window.__tubes.site.screen === 'board', undefined, { timeout: 4000 });
check(true, 'DONE returns the board');
// (The rig lowers on the floor's next update — give it the frame.)
await page.waitForFunction(() => window.__tubes.floor.state().tapeUp === false, undefined, { timeout: 2000 }).catch(() => {});
s = await state();
check(s.tapeUp === false, 'the tape came down with the setup');

console.log('THE SHELF (reload)');
await clockIn();
await enterFloor();
s = await state();
check(
  near(s.layout.left, kept.left, 1e-3) &&
    near(s.layout.right, kept.right, 1e-3) &&
    near(s.layout.near, kept.near, 1e-3) &&
    near(s.layout.far, kept.far, 1e-3),
  `the saved floor greets the next shift (left ${s.layout.left.toFixed(2)}, right ${s.layout.right.toFixed(2)}, near ${s.layout.near.toFixed(2)}, far ${s.layout.far.toFixed(2)})`,
);
await page.evaluate(() => window.__tubes.floor.exit());

await browser.close();
if (fails.length) {
  console.error(`\n${fails.length} FAILED:\n - ${fails.join('\n - ')}`);
  process.exit(1);
}
console.log('\nTHE FLOOR IS MARKED OUT.');
