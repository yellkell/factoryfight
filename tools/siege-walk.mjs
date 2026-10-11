#!/usr/bin/env node
/**
 * THE SIEGE, WALKED — FACTORY FIGHT end to end, headlessly, as a tower
 * defence.
 *
 *   npm run dev
 *   node tools/siege-walk.mjs      → shots/siege/
 *
 *   MAN THE WALLS   the board's one door; the floor waits for its CORE
 *   THE OPEN FLOOR  the core lands; towers stand right up against it
 *   FIRST WATCH     three turrets hugging the core; START; the tide
 *                   comes out of every wall and dies; kills and the
 *                   wave bonus fill the purse
 *   THE TOWER       its panel: UPGRADE (level 2, dearer, stronger), SELL
 *   THE CARDS       every page of the card, inside the card
 *   THE RIFT        a pack splits the floor open and climbs out of it
 *   THE CHEW        a core boxed in by towers: they chew their way in
 *   THE LEAK        an unguarded core: whatever reaches it takes a bite
 *                   out of it, and is gone
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
check(sg.phase === 'core' && sg.breaches.length === 0, `the siege opens waiting for its CORE, no rifts (${sg.phase})`);
const cat0 = await page.evaluate(() => window.__tubes.build.catalogue().available);
check(cat0.length === 1 && cat0[0] === 'dock', `and the core is the only thing on offer (${cat0.join(', ')})`);

/* ── THE OPEN FLOOR ──────────────────────────────────────────────────── */

console.log('THE OPEN FLOOR');
const coreAt = await handPlace('dock', 0, 0);
check(coreAt.ok, 'the CORE stands where you put it');
await page.waitForTimeout(200);
sg = await siege();
check(sg.phase === 'build' && sg.wave === 0, `and the siege begins: building for wave 1 (${sg.phase} ${sg.wave})`);
check(sg.breaches.length === 0, 'no rift shows before the wave: they could come from anywhere');
const core = (await plan()).find((u) => u.type === 'dock');
check(sg.coins === 150, `the purse opens with 150 coins (${sg.coins})`);
const cat = await page.evaluate(() => window.__tubes.build.catalogue().available);
check(cat.length === 1 && cat[0] === 'turret', `wave 1 offers the TURRET and nothing else (${cat.join(', ')})`);

/* ── FIRST WATCH ─────────────────────────────────────────────────────── */

console.log('FIRST WATCH');
{
  // THE REACH, while you place: arm a turret, aim beside the core, and
  // the circle it will shoot within lies on the floor under the ghost.
  await arm('turret');
  const v = await aim(core.i + 1, core.j);
  check(Boolean(v?.placeable), 'a turret aimed at the cell right beside the core is offered');
  await page.waitForTimeout(150);
  let r = await page.evaluate(() => window.__tubes.build.reach());
  // (WEAPONS.turret.range, plant m: what the sim measures from a cell.)
  check(r.shown && Math.abs(r.radius - 2.1) < 1e-6, `placing a TURRET shows its reach on the floor (${r.radius.toFixed(2)} m)`);
  const S = 0.7;
  const p = cellXZ(core.i + 1, core.j);
  await lookAt(p.x * S + 0.3, p.z * S + 1.6, 0.1, p.x * S, 0, p.z * S);
  await studio();
  await shot('01b-placing-reach');
  await arm(null);
  await page.waitForTimeout(100);
  r = await page.evaluate(() => window.__tubes.build.reach());
  check(!r.shown, 'and it goes when the tool is put down');
}
const stood = [];
// Hugging the core: three sides of it.
for (const [di, dj] of [[1, 0], [-1, 0], [0, 1]]) {
  const r = await handPlace('turret', core.i + di, core.j + dj);
  if (r.ok) stood.push([core.i + di, core.j + dj]);
}
sg = await siege();
check(stood.length === 3 && sg.coins === 0, `three TURRETS right up against the core, 50 coins each (${stood.length} stood, ${sg.coins} left)`);
await page.evaluate(() => window.__tubes.siege.start());
sg = await siege();
check(sg.phase === 'wave' && sg.queued + sg.enemies === 100, `START: 100 mites are coming (${sg.enemies} out, ${sg.queued} queued)`);
check(sg.breaches.length === 0, 'wave 1 has no pack: every one of them comes out of the walls');
{
  // FROM EVERY SIDE: where each one climbed out, by its bearing from the
  // core (watched as they come — the turrets don't leave them long).
  const S = 0.7;
  const cx = (core.i + 0.5) * CELL;
  const cz = (core.j + 0.5) * CELL;
  const first = await page.evaluate(
    () =>
      new Promise((done) => {
        const seen = new Map();
        const t0 = performance.now();
        const look = () => {
          for (const c of window.__tubes.siege.crawlers()) if (!seen.has(c.uid)) seen.set(c.uid, c);
          if (performance.now() - t0 < 8000) setTimeout(look, 100);
          else done([...seen.values()]);
        };
        look();
      }),
  );
  const octants = new Set(first.map((c) => Math.floor(((Math.atan2(c.x - cx, c.z - cz) + Math.PI) / (Math.PI * 2)) * 8) % 8));
  check(octants.size >= 5, `they come out of every wall (${first.length} so far, from ${octants.size} of 8 bearings)`);
  await lookAt(cx * S + 0.6, cz * S + 1.8, 0.4, cx * S, 0, cz * S);
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
check(sg.kills === 100, `every mite put down (${sg.kills})`);
check(sg.coins === 20 + 55, `a fifth of a coin a mite plus the wave bonus (${sg.coins} = 20 + 55)`);
check(sg.phase === 'build' && sg.wave === 1, `wave 2 is building (${sg.phase})`);
const cat2 = await page.evaluate(() => window.__tubes.build.catalogue().available);
check(cat2.includes('hammer'), `and the HAMMER joins the catalogue (${cat2.join(', ')})`);

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
await page.evaluate(() => window.__tubes.siege.coins(100));
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
check(cardIds.includes('card:start'), 'the card offers START WAVE while you build');
check(!cardIds.some((i) => /build:(maker|belt|wall|chest|combiner|post|delete)/.test(i)), 'and no factory machine anywhere on it');
await page.evaluate(() => window.__tubes.menu.act('card:build'));
await page.evaluate(() => window.__tubes.menu.setPause(false));

/* ── THE RIFT ────────────────────────────────────────────────────────── */

console.log('THE RIFT');
await page.evaluate(() => {
  const p = window.__tubes;
  for (const u of p.plant.plan()) if (u.type !== 'dock') p.build.removeAt(u.i, u.j);
  p.siege.rifts(1);
  p.siege.spawn('mite', 0, 40);
});
{
  sg = await siege();
  const rift = sg.breaches[0];
  const crawlers = await page.evaluate(() => window.__tubes.siege.crawlers());
  const far = Math.max(...crawlers.map((c) => Math.hypot(c.x - rift.x, c.z - rift.z)));
  check(sg.breaches.length === 1 && rift.state === 'pouring', `a RIFT splits the floor open (${rift?.state})`);
  check(crawlers.length === 40 && far < 0.6, `and its PACK climbs out of that one crack (all 40 within ${far.toFixed(2)} m)`);
  check(crawlers.every((c) => c.y < 0), 'up from under the floor');
  {
    const S0 = (await plan()).find((u) => u.type === 'dock');
    const d = Math.hypot(rift.x - (S0.i + 0.5) * CELL, rift.z - (S0.j + 0.5) * CELL);
    check(d >= 1.5, `out in the room, clear of the core (${d.toFixed(2)} m from it)`);
  }
  const S = 0.7;
  const cx = (core.i + 0.5) * CELL;
  const cz = (core.j + 0.5) * CELL;
  await page.evaluate(() => window.__tubes.plant.timeScale(0.5));
  await page.waitForTimeout(1200);
  await lookAt(cx * S + (rift.x - cx) * S * 0.35 + 0.4, cz * S + (rift.z - cz) * S * 0.35 + 0.4, 0, rift.x * S, 0.15, rift.z * S);
  await shot('03-the-rift');
  await page.evaluate(() => {
    window.__tubes.siege.clear();
    window.__tubes.plant.timeScale(1);
  });
}

/* ── THE CHEW ────────────────────────────────────────────────────────── */

console.log('THE CHEW');
{
  // Box the core in on all eight sides: there is no way in but through.
  await page.evaluate(() => window.__tubes.siege.coins(1000));
  let boxed = 0;
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    if ((await handPlace('turret', core.i + di, core.j + dj)).ok) boxed++;
  }
  check(boxed === 8, `eight turrets box the core in (${boxed})`);
  const before = (await siege()).core;
  await page.evaluate(() => {
    const p = window.__tubes;
    p.siege.flood('beetle', 40);
    p.siege.tough(400);
    p.plant.timeScale(4);
  });
  const chewed = await page
    .waitForFunction(() => window.__tubes.siege.turrets().some((t) => t.hp < t.maxHp - 1), undefined, { timeout: 60000, polling: 200 })
    .then(() => true)
    .catch(() => false);
  await page.evaluate(() => window.__tubes.plant.timeScale(1));
  const towersNow = await page.evaluate(() => window.__tubes.siege.turrets());
  const worst = Math.min(...towersNow.map((t) => t.hp / t.maxHp));
  check(chewed, `with no way round, they CHEW a tower (the worst is down to ${(worst * 100).toFixed(0)}%)`);
  const bites = (await page.evaluate(() => window.__tubes.siege.enemies())).filter((e) => e.phase === 'bite').length;
  check(bites > 0, `${bites} of them are at it`);
  const S = 0.7;
  const cx = (core.i + 0.5) * CELL;
  const cz = (core.j + 0.5) * CELL;
  await lookAt(cx * S + 0.5, cz * S + 0.9, -0.6, cx * S, 0.05, cz * S);
  await shot('04-the-chew');
  check((await siege()).core === before, 'and while the ring stands, nothing reaches the core');
  await page.evaluate(() => {
    const p = window.__tubes;
    p.siege.clear();
    for (const u of p.plant.plan()) if (u.type !== 'dock') p.build.removeAt(u.i, u.j);
  });
}

/* ── THE LEAK ────────────────────────────────────────────────────────── */

console.log('THE LEAK');
await page.evaluate(() => {
  const p = window.__tubes;
  for (const u of p.plant.plan()) if (u.type !== 'dock') p.build.removeAt(u.i, u.j);
});
const coreBefore = (await siege()).core;
await page.evaluate(() => window.__tubes.siege.spawn('mite', -1, 10));
await page.evaluate(() => window.__tubes.plant.timeScale(6));
await page
  .waitForFunction(() => window.__tubes.siege.state().enemies === 0, undefined, { timeout: 60000 })
  .catch(() => {});
await page.evaluate(() => window.__tubes.plant.timeScale(1));
const coreAfter = (await siege()).core;
check(Math.abs(coreBefore - coreAfter - 0.1) < 1e-6, `ten mites walk an empty floor into the core: −10 (${(coreBefore * 100).toFixed(0)}% → ${(coreAfter * 100).toFixed(0)}%)`);

/* ── THE FALL ────────────────────────────────────────────────────────── */

console.log('THE FALL');
await page.evaluate(() => {
  const p = window.__tubes;
  p.siege.spawn('hulk', -1, 6);
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
  sg.phase === 'core' && sg.wave === 0 && units.length === 0 && sg.breaches.length === 0 && sg.coins === 150,
  `TRY AGAIN deals a bare floor waiting for its core (${sg.phase}, wave ${sg.wave + 1}, ${units.length} units, ${sg.breaches.length} rifts, ${sg.coins} coins)`,
);

await browser.close();
if (fails.length) {
  console.log(`\n${fails.length} FAILED:`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('\nTHE SIEGE HOLDS.');
