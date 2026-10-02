#!/usr/bin/env node
/**
 * THE THROW — your fist as a weapon of last resort.
 *
 *   npm run dev
 *   node tools/throw-walk.mjs     → shots/throw/
 *
 * Through the same sim doors the fists use (siege.grab / hold / throw):
 * close on a MITE, lift it, and throw it into a crowd — it breaks, and
 * so do the ones it lands on. Drop a BEETLE gently and it lives, and
 * scrabbles back to its lane. A HULK is too big to take.
 */

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const S = 0.7;
const CELL = 0.35;
const G = 9.8 / 0.7;
const fails = [];
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) fails.push(what);
};
let browser;
try {
  browser = await chromium.launch();
} catch {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
}
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
page.on('pageerror', (e) => fails.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (/Shader Error|WebGLProgram|Program Info Log/.test(m.text())) fails.push(`[shader] ${m.text().slice(0, 300)}`);
});
await page.goto(base, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.click('#enter-ar');
await page.waitForFunction(() => Boolean(window.__tubes?.site));
await page.waitForTimeout(300);
await page.evaluate(() => window.__tubes.wallsInfo.forceFallback());
await page.waitForFunction(() => window.__tubes.site.wallsReady);
await page.evaluate(() => {
  window.__tubes.menu.act('tab:factory');
  window.__tubes.menu.act('start-order');
});
await page.waitForTimeout(300);
mkdirSync('shots/throw', { recursive: true });
await page.evaluate(() => window.__tubes.siege.core());
await page.waitForTimeout(400);
const core = (await page.evaluate(() => window.__tubes.plant.plan())).find((u) => u.type === 'dock');
const cx = (core.i + 0.5) * CELL;
const cz = (core.j + 0.5) * CELL;

async function lookAt(px, pz, py, tx, ty, tz) {
  const yaw = Math.atan2(px - tx, pz - tz);
  const pitch = Math.atan2(ty - (1.6 + py), Math.hypot(px - tx, pz - tz));
  const e = 1.6;
  await page.evaluate(({ x, z, yaw, y, pitch }) => window.__tubes.rig(x, z, yaw, y, pitch), {
    x: px - e * Math.sin(pitch) * Math.sin(yaw),
    z: pz - e * Math.sin(pitch) * Math.cos(yaw),
    yaw,
    y: 1.6 + py - e * Math.cos(pitch),
    pitch,
  });
}
/** The emulator's furniture out of the frame. */
const studio = () =>
  page.evaluate(() => {
    const s = window.__tubes.scene();
    s.traverse((o) => {
      if (o.type?.includes?.('TransformControls')) o.visible = false;
    });
    const rig = s.children.find((o) => o.children.some((c) => c.isCamera));
    rig?.traverse((c) => {
      if (c.isMesh || c.isLine) c.material.visible = false;
    });
    for (const el of document.body.children) {
      if (el.tagName === 'SCRIPT' || el.tagName === 'CANVAS' || el.querySelector('canvas')) continue;
      el.style.display = 'none';
    }
    for (const el of document.querySelectorAll('*')) if (el.shadowRoot) el.style.display = 'none';
    const cs = [...document.querySelectorAll('canvas')].sort(
      (a, b) => Number(getComputedStyle(a).zIndex || 0) - Number(getComputedStyle(b).zIndex || 0),
    );
    cs.slice(1).forEach((c) => (c.style.visibility = 'hidden'));
  });
const crawlers = () => page.evaluate(() => window.__tubes.siege.crawlers());
const place = (k, x, z) => page.evaluate(({ k, x, z }) => window.__tubes.siege.place(k, x, z, 0), { k, x, z });

// Off to one side of the core: the one to throw, and a crowd to throw
// it into, a metre on.
const ax = cx + 0.9;
const az = cz + 0.9;
await place('mite', ax, az);
const bx = ax + 1.0;
const bz = az;
for (let k = 0; k < 14; k++) await place('mite', bx + (Math.random() - 0.5) * 0.14, bz + (Math.random() - 0.5) * 0.14);
await place('hulk', ax, az - 0.6);
await page.waitForTimeout(200);

console.log('THE MITE');
let all = await crawlers();
const mite = all.find((c) => c.kind === 0 && Math.hypot(c.x - ax, c.z - az) < 0.05);
check(Boolean(mite), 'a mite on the floor');
check(await page.evaluate(({ x, z }) => window.__tubes.siege.grab(1, x, 0.6, z), { x: mite.x, z: mite.z }) === false, 'a fist half a metre above it takes nothing');
check(await page.evaluate(({ x, z }) => window.__tubes.siege.grab(1, x, 0.05, z), { x: mite.x, z: mite.z }), 'a fist closed on it takes it');
await page.evaluate(({ x, z }) => window.__tubes.siege.hold(1, x, 0.7, z), { x: ax, z: az });
await page.waitForTimeout(200);
all = await crawlers();
let held = all.find((c) => c.uid === mite.uid);
check(held?.phase === 2 && held.y > 0.6, `it comes up with the hand (${held?.y.toFixed(2)} m up, thrashing)`);
await lookAt(ax * S + 0.25, az * S + 0.55, -1.05, ax * S, 0.42, az * S);
await studio();
await page.waitForTimeout(250);
await page.screenshot({ path: 'shots/throw/held.png' });
console.log('  · shots/throw/held.png');
// Towers hold their fire on the one in your hand: a turret right by it.
await page.evaluate(({ i, j }) => {
  window.__tubes.siege.coins(200);
  window.__tubes.build.placeAt(i, j, 'turret', 0);
}, { i: Math.floor(ax / CELL) - 1, j: Math.floor(az / CELL) + 1 });
await page.waitForTimeout(800);
all = await crawlers();
held = all.find((c) => c.uid === mite.uid);
check(held?.phase === 2 && held.hp > 0, 'the turret beside it holds its fire on the one in your hand');
await page.evaluate(() => {
  for (const u of window.__tubes.plant.plan()) if (u.type === 'turret') window.__tubes.build.removeAt(u.i, u.j);
});
// The throw: an arc from 0.7 m up to land on the crowd a metre on.
const before = (await page.evaluate(() => window.__tubes.siege.state())).kills;
const vy = 1.5;
const t = (vy + Math.sqrt(vy * vy + 2 * G * 0.66)) / G;
await page.evaluate(({ vx, vy }) => window.__tubes.siege.throw(1, vx, vy, 0), { vx: (bx - ax) / t, vy });
await lookAt(bx * S + 0.2, bz * S + 1.1, -0.8, ((ax + bx) / 2) * S, 0.15, bz * S);
await page.waitForTimeout(Math.round(t * 1000 * 0.55));
await page.screenshot({ path: 'shots/throw/flying.png' });
console.log('  · shots/throw/flying.png');
await page.waitForTimeout(900);
await page.screenshot({ path: 'shots/throw/landed.png' });
console.log('  · shots/throw/landed.png');
all = await crawlers();
const after = (await page.evaluate(() => window.__tubes.siege.state())).kills;
check(!all.some((c) => c.uid === mite.uid), 'THROWN: it breaks where it lands');
check(after - before >= 3, `and takes ${after - before - 1} of the crowd with it`);

console.log('THE BEETLE');
await place('beetle', ax - 0.5, az);
await page.waitForTimeout(100);
all = await crawlers();
const beetle = all.find((c) => c.kind === 1);
check(await page.evaluate(({ x, z }) => window.__tubes.siege.grab(0, x, 0.07, z), { x: beetle.x, z: beetle.z }), 'the other fist takes a BEETLE');
await page.evaluate(({ x, z }) => window.__tubes.siege.hold(0, x, 0.15, z), { x: beetle.x, z: beetle.z });
await page.evaluate(() => window.__tubes.siege.throw(0, 0, 0, 0));
// It lands dazed, scrabbles back to the nearest point of a lane, and
// falls in (phase 1, WALK) to march on.
let b2 = null;
let landed = false;
for (let k = 0; k < 40; k++) {
  await page.waitForTimeout(100);
  b2 = (await crawlers()).find((c) => c.uid === beetle.uid);
  if (b2?.phase === 4) landed = true;
  if (!b2 || (landed && b2.phase === 1)) break;
}
check(landed, 'set down gently it lands alive, and scrabbles for its lane');
check(b2?.phase === 1, `and falls back into the column on its lane (phase ${b2?.phase})`);
all = await crawlers();

console.log('THE HULK');
const hulk = all.find((c) => c.kind === 2);
check(await page.evaluate(({ x, z }) => window.__tubes.siege.grab(1, x, 0.12, z), { x: hulk.x, z: hulk.z }) === false, 'a HULK is too big to take');

await browser.close();
if (fails.length) {
  console.log(`\n${fails.length} FAILED:`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('\nTHE FIST HOLDS.');
