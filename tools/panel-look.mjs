#!/usr/bin/env node
/**
 * THE PANELS, photographed — every painted face in the game, as the raw
 * canvas the headset gets, into shots/panels/.
 *
 *   npm run dev
 *   node tools/panel-look.mjs
 *
 * The board's three tabs, the pause plate, the palm: header, studs and
 * tiles from the first
 * core to the full arsenal, a tower's panel and the core's, and the last
 * card. Plus a room shot of the palm, which is how it is actually read.
 * Every control on every panel is also checked to sit inside its frame.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const OUT = 'shots/panels';
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
await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(base));
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForTimeout(500);
await page.click('#enter-ar');
await page.waitForFunction(() => Boolean(window.__tubes?.site), { timeout: 15000 });
await page.evaluate(() => {
  window.IWER_DEVICE.controlMode = 'programmatic';
  for (const el of document.querySelectorAll('*')) if (el.shadowRoot) el.style.display = 'none';
});
await page.evaluate(() => window.__tubes.wallsInfo.forceFallback());
await page.waitForFunction(() => window.__tubes.site.wallsReady, { timeout: 5000 });
// The pictures are photographed at boot; give the studio its moment.
await page.waitForTimeout(1200);
mkdirSync(OUT, { recursive: true });

const frames = (n = 6) => page.waitForTimeout(n * 40);
const save = (name, url) => {
  if (!url) return;
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
  console.log(`  · ${OUT}/${name}.png`);
};
const act = (id) => page.evaluate((id) => window.__tubes.menu.act(id), id);
/** Nothing painted past the panel's edge. */
const inFrame = async (what, rects, layout) => {
  const out = rects.filter((r) => r.x < 0 || r.y < 0 || r.x + r.w > layout.w || r.y + r.h > layout.h);
  check(out.length === 0, `${what}: every control inside the frame${out.length ? ` (${out.map((r) => r.id).join(', ')})` : ''}`);
};

/* ── THE BOARD ───────────────────────────────────────────────────────── */

console.log('THE BOARD');
for (const [tab, name] of [
  ['tab:factory', 'board-siege'],
  ['tab:controls', 'board-hands'],
  ['tab:sys', 'board-settings'],
]) {
  await act(tab);
  await frames(4);
  save(name, await page.evaluate(() => window.__tubes.menu.snapBoard()));
}
await act('tab:factory');

/* ── THE PAUSE PLATE ─────────────────────────────────────────────────── */

console.log('THE PAUSE PLATE');
await page.evaluate(() => window.__tubes.startShop());
await page.waitForFunction(() => window.__tubes.site.screen === 'factory', undefined, { timeout: 5000 });
await frames(6);
await page.evaluate(() => window.__tubes.menu.setPause(true));
await frames(6);
save('pause-core', await page.evaluate(() => window.__tubes.menu.snapCard()));
await page.evaluate(() => window.__tubes.siege.core());
await page.evaluate(() => window.__tubes.menu.setPause(true));
await frames(6);
save('pause-build', await page.evaluate(() => window.__tubes.menu.snapCard()));
await inFrame('pause-build', await page.evaluate(() => window.__tubes.menu.cardRects()), await page.evaluate(() => window.__tubes.menu.cardLayout()));
await page.evaluate(() => window.__tubes.menu.setPause(false));
await frames(4);

/* ── A TOWER, AND THE CORE ───────────────────────────────────────────── */

console.log('THE TOWER PANEL');
await page.evaluate(() => window.__tubes.siege.coins(500));
const core = await page.evaluate(() => window.__tubes.plant.plan().find((u) => u.type === 'dock'));
for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
  const ok = await page.evaluate(({ i, j }) => window.__tubes.build.placeAt(i, j, 'turret'), { i: core.i + di, j: core.j + dj });
  if (ok) break;
}
const towers = await page.evaluate(() => window.__tubes.siege.turrets());
if (towers.length) {
  await page.evaluate((id) => window.__tubes.menu.inspect(id), towers[0].id);
  await frames(8);
  const id = towers[0].id;
  save('tower', await page.evaluate(() => window.__tubes.menu.snapBox()));
  await inFrame('tower', await page.evaluate(() => window.__tubes.menu.boxRects()), await page.evaluate(() => window.__tubes.menu.boxLayout()));
  const grant = (frac) =>
    page.evaluate(
      ({ id, frac }) => {
        const tw = window.__tubes.siege.turrets().find((t) => t.id === id);
        window.__tubes.siege.xp(id, tw.xpNeed * frac - tw.xp);
      },
      { id, frac },
    );
  await grant(0.55);
  await frames(6);
  save('tower-earning', await page.evaluate(() => window.__tubes.menu.snapBox()));
  await grant(1);
  await frames(6);
  save('tower-ready', await page.evaluate(() => window.__tubes.menu.snapBox()));
  await act('box:upgrade');
  await grant(1);
  await act('box:upgrade');
  await frames(6);
  save('tower-max', await page.evaluate(() => window.__tubes.menu.snapBox()));
  await act('box:close');
} else {
  check(false, 'a turret stood for its panel');
}
await page.evaluate((id) => window.__tubes.menu.inspect(id), core.id);
await frames(8);
save('core', await page.evaluate(() => window.__tubes.menu.snapBox()));
await act('box:close');
await frames(4);

/* ── THE PALM (hands) ────────────────────────────────────────────────── */

console.log('THE PALM');
await page.evaluate(() => window.__tubes.abandonFactory());
await page.waitForFunction(() => window.__tubes.site.screen === 'board', undefined, { timeout: 5000 });
await page.evaluate(() => {
  window.IWER_DEVICE.primaryInputMode = 'hand';
});
await frames(6);

await page.evaluate(() => window.__tubes.startShop());
await page.waitForFunction(() => window.__tubes.site.screen === 'factory', undefined, { timeout: 5000 });
const R = Math.SQRT1_2;
const pose = (side, p, q = [0, 0, 0, 1]) =>
  page.evaluate(
    ({ side, p, q }) => {
      const h = window.IWER_DEVICE.hands[side];
      h.position.set(...p);
      h.quaternion.set(...q);
    },
    { side, p, q },
  );
await pose('right', [0.25, 1.3, -0.35]);
await pose('left', [-0.04, 1.42, -0.28], [-R, 0, 0, R]);
await frames(12);
const palm = async (name) => {
  const s = await page.evaluate(() => window.__tubes.hands.snap());
  save(`${name}-header`, s.header);
  s.studs.forEach((u, k) => save(`${name}-stud${k}`, u));
  for (const [tool, u] of Object.entries(s.tiles)) save(`${name}-tile-${tool}`, u);
  await page.screenshot({ path: `${OUT}/${name}-room.png` });
  console.log(`  · ${OUT}/${name}-room.png`);
};
await palm('palm-core');
await page.evaluate(() => window.__tubes.siege.core());
await page.evaluate(() => {
  window.__tubes.siege.wakeAll();
  window.__tubes.siege.coins(90);
});
await frames(10);
await palm('palm-build');
await page.evaluate(() => window.__tubes.build.arm('turret'));
await frames(8);
await palm('palm-armed');
await page.evaluate(() => window.__tubes.build.arm(null));
await page.evaluate(() => window.__tubes.siege.start());
await frames(10);
await palm('palm-wave');

console.log('THE PAUSE PLATE, MID-WAVE');
await page.evaluate(() => window.__tubes.menu.setPause(true));
await frames(8);
save('pause-wave', await page.evaluate(() => window.__tubes.menu.snapCard()));
await inFrame('pause-wave', await page.evaluate(() => window.__tubes.menu.cardRects()), await page.evaluate(() => window.__tubes.menu.cardLayout()));
await page.evaluate(() => window.__tubes.menu.setPause(false));

/* ── THE LAST CARD ───────────────────────────────────────────────────── */

console.log('THE LAST CARD');
await page.evaluate(() => {
  window.__tubes.site.finale = true;
});
await frames(10);
save('finale', await page.evaluate(() => window.__tubes.menu.snapFinale()));

await browser.close();
if (fails.length) {
  console.log(`\n${fails.length} FAILED:\n  ${fails.join('\n  ')}`);
  process.exit(1);
}
console.log('\nEVERY PANEL PHOTOGRAPHED.');
