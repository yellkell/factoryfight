#!/usr/bin/env node
/**
 * THE SIEGE, WALKED — FACTORY FIGHT end to end, headlessly, as a tower
 * defence.
 *
 *   npm run dev
 *   node tools/siege-walk.mjs      → shots/siege/
 *
 *   MAN THE WALLS   the board's one door; the floor waits for its CORE
 *   THE LANES       the core lands: four lanes laid, one open; nothing
 *                   can be built on a lane
 *   FIRST WATCH     three turrets beside the lane; the horn; the tide
 *                   dies; kills and the wave bonus fill the purse
 *   THE TOWER       its panel: UPGRADE (level 2, dearer, stronger), SELL
 *   THE CARDS       every page of the card, inside the card
 *   THE LEAK        an unguarded lane: whatever reaches the core takes a
 *                   bite out of it, and is gone
 *   THE FALL        a flood with no towers; TRY AGAIN deals a new floor
 */

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const CELL = 0.35; // plant metres — the tools speak the plant's units
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
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
page.on('pageerror', (e) => fails.push(`[pageerror] ${e.message}`));
await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(base));
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForTimeout(600);
await page.click('#enter-ar');
await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 15000 });
await page.waitForFunction(() => Boolean(window.__tubes?.site), { timeout: 10000 });
await page.waitForTimeout(400);
await page.evaluate(() => window.__tubes.wallsInfo.forceFallback());
await page.waitForFunction(() => window.__tubes.site.wallsReady, { timeout: 5000 });
mkdirSync('shots/siege', { recursive: true });

const siege = () => page.evaluate(() => window.__tubes.siege.state());
const plan = () => page.evaluate(() => window.__tubes.plant.plan());
const cellXZ = (i, j) => ({ x: (i + 0.5) * CELL, z: (j + 0.5) * CELL });
const arm = (tool) => page.evaluate((t) => window.__tubes.build.arm(t), tool);
const aim = (i, j, r = 0) =>
  page.evaluate(({ x, z, r }) => window.__tubes.build.aimAt(x, z, r), { ...cellXZ(i, j), r });
const pull = () => page.evaluate(() => window.__tubes.build.trigger());
async function handPlace(tool, i, j, r = 0) {
  await arm(tool);
  const view = await aim(i, j, r);
  const ok = await pull();
  await arm(null);
  return { view, ok };
}
/** Studio light, and the emulator's own furniture out of the frame. */
const studio = () =>
  page.evaluate(() => {
    const s = window.__tubes.scene();
    const rig = s.children.find((o) => o.children.some((c) => c.isCamera));
    if (rig) {
      rig.traverse((c) => {
        if (c.isMesh || c.isLine) c.material.visible = false;
      });
    }
    for (const o of s.children) {
      if (o.isHemisphereLight) o.intensity = 2.2;
      if (o.isDirectionalLight) o.intensity = 2.0;
    }
    for (const el of document.body.children) {
      if (el.tagName === 'SCRIPT' || el.tagName === 'CANVAS' || el.querySelector('canvas')) continue;
      el.style.display = 'none';
    }
    // The emulator's panels live in shadow roots.
    for (const el of document.querySelectorAll('*')) if (el.shadowRoot) el.style.display = 'none';
  });
/** Park the camera at room (px, py + eye, pz) looking at room (tx, ty, tz). */
async function lookAt(px, pz, py, tx, ty, tz) {
  const yaw = Math.atan2(px - tx, pz - tz);
  const pitch = Math.atan2(ty - (1.6 + py), Math.hypot(px - tx, pz - tz));
  // The rig pitches about its FLOOR origin, which swings the 1.6 m eye
  // off where it was asked to be — so stand the rig where the eye lands
  // right: rig = eye − Ry(yaw)·Rx(pitch)·(0, 1.6, 0).
  const e = 1.6;
  const ox = e * Math.sin(pitch) * Math.sin(yaw);
  const oy = e * Math.cos(pitch);
  const oz = e * Math.sin(pitch) * Math.cos(yaw);
  await page.evaluate(({ x, z, yaw, y, pitch }) => window.__tubes.rig(x, z, yaw, y, pitch), {
    x: px - ox,
    z: pz - oz,
    yaw,
    y: 1.6 + py - oy,
    pitch,
  });
}
const shot = async (name) => {
  await page.waitForTimeout(220);
  await page.screenshot({ path: `shots/siege/${name}.png` });
  console.log(`  · shots/siege/${name}.png`);
};
/* ── MAN THE WALLS ───────────────────────────────────────────────────── */

console.log('MAN THE WALLS');
await page.evaluate(() => window.__tubes.menu.act('tab:factory'));
await page.waitForTimeout(200);
const offered = await page.evaluate(() => window.__tubes.menu.boardButtons());
{
  const { writeFileSync } = await import('node:fs');
  const url = await page.evaluate(() => window.__tubes.menu.snapBoard());
  writeFileSync('shots/siege/board.png', Buffer.from(url.split(',')[1], 'base64'));
  console.log('  · shots/siege/board.png');
}
check(offered.includes('start-order'), `the board offers one door (${offered.join(', ')})`);
await page.evaluate(() => window.__tubes.menu.act('start-order'));
await page.waitForFunction(() => window.__tubes.site.screen === 'factory', undefined, { timeout: 5000 });
await page.waitForTimeout(300);
let sg = await siege();
check(sg.phase === 'core' && sg.lanes.length === 0, `the siege opens waiting for its CORE, no lanes yet (${sg.phase})`);
const cat0 = await page.evaluate(() => window.__tubes.build.catalogue().available);
check(cat0.length === 1 && cat0[0] === 'dock', `and the core is the only thing on offer (${cat0.join(', ')})`);

/* ── THE LANES ───────────────────────────────────────────────────────── */

console.log('THE LANES');
const coreAt = await handPlace('dock', 0, 0);
check(coreAt.ok, 'the CORE stands where you put it');
await page.waitForTimeout(200);
sg = await siege();
check(sg.phase === 'build' && sg.wave === 0, `and the siege begins: building for wave 1 (${sg.phase} ${sg.wave})`);
check(sg.lanes.length === 4 && sg.open === 1, `four lanes are laid, one open (${sg.lanes.length} laid, ${sg.open} open)`);
check(sg.lanes.every((l) => l.cells.length >= 3 && l.len > 1), `each runs from a crack to the core (${sg.lanes.map((l) => l.len.toFixed(1) + ' m').join(', ')})`);
const core = (await plan()).find((u) => u.type === 'dock');
check(
  sg.lanes.every((l) => {
    const last = l.cells[l.cells.length - 1];
    return Math.abs(last.i - core.i) + Math.abs(last.j - core.j) === 1;
  }),
  'and every lane ends right beside the core',
);
check(sg.coins === 150, `the purse opens with 150 coins (${sg.coins})`);
const cat = await page.evaluate(() => window.__tubes.build.catalogue().available);
check(cat.length === 1 && cat[0] === 'turret', `wave 1 offers the TURRET and nothing else (${cat.join(', ')})`);
const onLane = sg.lanes[0].cells[2];
const refused = await handPlace('turret', onLane.i, onLane.j);
check(!refused.ok && !refused.view?.placeable, 'a turret aimed at a lane cell is refused (the ghost says so)');
check((await siege()).coins === 150, 'and costs nothing');
await studio();
{
  const S = 0.7;
  const cx = (core.i + 0.5) * CELL * S;
  const cz = (core.j + 0.5) * CELL * S;
  await page.evaluate(() => window.__tubes.siege.breaches(4));
  await lookAt(cx + 0.2, cz + 2.2, 0.6, cx, 0, cz - 0.3);
  await shot('01-the-lanes');
  await page.evaluate(() => window.__tubes.siege.breaches(1));
}

/* ── FIRST WATCH ─────────────────────────────────────────────────────── */

console.log('FIRST WATCH');
const lane0 = sg.lanes[0].cells;
const stood = [];
for (const k of [lane0.length - 2, lane0.length - 5, lane0.length - 8]) {
  const c = lane0[Math.max(0, k)];
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const r = await handPlace('turret', c.i + di, c.j + dj);
    if (r.ok) {
      stood.push([c.i + di, c.j + dj]);
      break;
    }
  }
}
sg = await siege();
check(stood.length === 3 && sg.coins === 0, `three TURRETS beside the lane, 50 coins each (${stood.length} stood, ${sg.coins} left)`);
await page.evaluate(() => window.__tubes.siege.horn());
sg = await siege();
check(sg.phase === 'wave' && sg.queued + sg.enemies === 80, `the horn: 80 mites are coming (${sg.enemies} out, ${sg.queued} queued)`);
await page.waitForTimeout(4000);
{
  const S = 0.7;
  const b = sg.breaches[0];
  const cx = (core.i + 0.5) * CELL * S;
  const cz = (core.j + 0.5) * CELL * S;
  await lookAt(cx + (b.x * S - cx) * 0.2 + 0.5, cz + (b.z * S - cz) * 0.2 + 0.9, -0.3, (cx + b.x * S) / 2, 0, (cz + b.z * S) / 2);
  await shot('02-first-watch');
}
await page.evaluate(() => window.__tubes.plant.timeScale(4));
const cleared = await page
  .waitForFunction(() => window.__tubes.siege.state().wave === 1, undefined, { timeout: 120000 })
  .then(() => true)
  .catch(() => false);
await page.evaluate(() => window.__tubes.plant.timeScale(1));
sg = await siege();
check(cleared, `FIRST WATCH held (kills ${sg.kills}, core ${(sg.core * 100).toFixed(0)}%)`);
check(sg.kills === 80, `every mite put down (${sg.kills})`);
check(sg.coins === 80 + 55, `a coin a kill plus the wave bonus (${sg.coins} = 80 + 55)`);
check(sg.phase === 'build' && sg.open === 2, `wave 2 opens a second lane (${sg.open} open)`);
const cat2 = await page.evaluate(() => window.__tubes.build.catalogue().available);
check(cat2.includes('piston'), `and the PISTON joins the catalogue (${cat2.join(', ')})`);

/* ── THE TOWER ───────────────────────────────────────────────────────── */

console.log('THE TOWER');
let towers = await page.evaluate(() => window.__tubes.siege.turrets());
const t0 = towers[0];
await page.evaluate((id) => window.__tubes.menu.inspect(id), t0.id);
await page.waitForTimeout(250);
{
  const { writeFileSync } = await import('node:fs');
  const url = await page.evaluate(() => window.__tubes.menu.snapBox?.());
  if (url) {
    writeFileSync('shots/siege/tower-panel.png', Buffer.from(url.split(',')[1], 'base64'));
    console.log('  · shots/siege/tower-panel.png');
  }
}
const c1 = (await siege()).coins;
await page.evaluate(() => window.__tubes.menu.act('box:upgrade'));
towers = await page.evaluate(() => window.__tubes.siege.turrets());
const c2 = (await siege()).coins;
check(towers.find((t) => t.id === t0.id)?.level === 2 && c1 - c2 === 40, `UPGRADE: level 2 for 40 coins (${c1} → ${c2})`);
await page.evaluate(() => window.__tubes.menu.act('box:upgrade'));
towers = await page.evaluate(() => window.__tubes.siege.turrets());
const c3 = (await siege()).coins;
check(towers.find((t) => t.id === t0.id)?.level === 3 && c2 - c3 === 70, `UPGRADE again: level 3 for 70 (${c2} → ${c3})`);
await page.evaluate(() => window.__tubes.menu.act('box:upgrade'));
check((await siege()).coins === c3, 'and no further: level 3 is the top');
await page.evaluate(() => window.__tubes.menu.act('box:remove'));
towers = await page.evaluate(() => window.__tubes.siege.turrets());
const c4 = (await siege()).coins;
check(!towers.some((t) => t.id === t0.id) && c4 - c3 === 112, `SELL: it comes off the floor for 70% of 160 (${c3} → ${c4})`);

/* ── THE CARDS ───────────────────────────────────────────────────────── */

console.log('THE CARDS');
const savePng = async (name, dataUrl) => {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`shots/siege/${name}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`  · shots/siege/${name}.png`);
};
await page.evaluate(() => window.__tubes.menu.setPause(true));
for (const pg of ['build', 'goals', 'controls']) {
  await page.evaluate((p) => window.__tubes.menu.act(`card:${p}`), pg);
  await page.waitForTimeout(250);
  await savePng(`card-${pg}`, await page.evaluate(() => window.__tubes.menu.snapCard()));
  const rects = await page.evaluate(() => window.__tubes.menu.cardRects());
  const lay = await page.evaluate(() => window.__tubes.menu.cardLayout());
  const off = rects.filter((r) => r.x < 0 || r.y < 0 || r.x + r.w > lay.w || r.y + r.h > lay.h);
  check(off.length === 0, `card ${pg}: every control inside the card (${off.map((r) => r.id).join(',') || 'ok'})`);
}
const cardIds = await page.evaluate(() => window.__tubes.menu.cardButtons());
check(cardIds.includes('card:horn'), 'the card offers SOUND THE HORN while you build');
check(!cardIds.some((i) => /build:(maker|belt|wall|chest|combiner|post|delete)/.test(i)), 'and no factory machine anywhere on it');
await page.evaluate(() => window.__tubes.menu.act('card:build'));
await page.evaluate(() => window.__tubes.menu.setPause(false));

/* ── THE LEAK ────────────────────────────────────────────────────────── */

console.log('THE LEAK');
await page.evaluate(() => {
  const p = window.__tubes;
  for (const u of p.plant.plan()) if (u.type !== 'dock') p.build.removeAt(u.i, u.j);
});
const coreBefore = (await siege()).core;
await page.evaluate(() => window.__tubes.siege.spawn('mite', 0, 10));
await page.evaluate(() => window.__tubes.plant.timeScale(6));
await page
  .waitForFunction(() => window.__tubes.siege.state().enemies === 0, undefined, { timeout: 60000 })
  .catch(() => {});
await page.evaluate(() => window.__tubes.plant.timeScale(1));
const coreAfter = (await siege()).core;
check(Math.abs(coreBefore - coreAfter - 0.1) < 1e-6, `ten mites walk an empty lane into the core: −10 (${(coreBefore * 100).toFixed(0)}% → ${(coreAfter * 100).toFixed(0)}%)`);

/* ── THE FALL ────────────────────────────────────────────────────────── */

console.log('THE FALL');
await page.evaluate(() => {
  const p = window.__tubes;
  for (let k = 0; k < 4; k++) p.siege.spawn('hulk', k);
  p.plant.timeScale(10);
});
const fell = await page
  .waitForFunction(() => window.__tubes.site.finale, undefined, { timeout: 120000 })
  .then(() => true)
  .catch(() => false);
check(fell, 'an undefended core FALLS, and the last card comes up');
await page.evaluate(() => window.__tubes.plant.timeScale(1));
const finaleButtons = await page.evaluate(() => window.__tubes.menu.finaleButtons());
check(
  finaleButtons.includes('fin:retry') && finaleButtons.includes('fin:board'),
  `it offers TRY AGAIN and the board (${finaleButtons.join(', ')})`,
);
await page.evaluate(() => window.__tubes.menu.act('fin:retry'));
await page.waitForTimeout(400);
sg = await siege();
const units = await plan();
check(
  sg.phase === 'core' && sg.wave === 0 && units.length === 0 && sg.lanes.length === 0 && sg.coins === 150,
  `TRY AGAIN deals a bare floor waiting for its core (${sg.phase}, wave ${sg.wave + 1}, ${units.length} units, ${sg.lanes.length} lanes, ${sg.coins} coins)`,
);

await browser.close();
if (fails.length) {
  console.log(`\n${fails.length} FAILED:`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('\nTHE SIEGE HOLDS.');
