#!/usr/bin/env node
/**
 * THE BALANCE BOT — plays the whole ladder the blunt way, to see where
 * the difficulty curve really sits.
 *
 *   npm run dev
 *   node tools/balance-bot.mjs              (every tower it can afford)
 *   MODE=turret node tools/balance-bot.mjs  (turrets only)
 *
 * Every build phase it spends the lot: the cheapest tower type it has
 * fewest of, on the free cell nearest the core along an open lane; when
 * nothing more fits, it upgrades. Then it sounds the horn and watches
 * at 6× speed. A careful player beats this bot; the ladder is tuned so
 * the bot finishes bloodied (SIEGE.hpPerWave/hpPerWave2, the coins).
 */

import { chromium } from 'playwright';
let browser;
try {
  browser = await chromium.launch();
} catch {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
}
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.click('#enter-ar');
await page.waitForFunction(() => Boolean(window.__tubes?.site));
await page.waitForTimeout(300);
await page.evaluate(() => window.__tubes.wallsInfo.forceFallback());
await page.waitForFunction(() => window.__tubes.site.wallsReady);
await page.evaluate(() => { window.__tubes.menu.act('tab:factory'); window.__tubes.menu.act('start-order'); });
await page.waitForTimeout(300);
await page.evaluate(() => window.__tubes.siege.core());
await page.waitForTimeout(500);
const MODE = process.env.MODE ?? 'mixed';
for (let w = 0; w < 10; w++) {
  const r = await page.evaluate((MODE) => {
    const t = window.__tubes;
    const st = t.siege.state();
    const plan = t.plant.plan();
    const core = plan.find((u) => u.type === 'dock');
    const COST = { turret: 50, hammer: 70, flamer: 80, tesla: 100, mortar: 120 };
    const avail = t.build.catalogue().available.filter((x) => x in COST && (MODE !== 'turret' || x === 'turret'));
    const cellsNow = () => {
      const s2 = t.siege.state(); const out = [];
      s2.lanes.slice(0, s2.open).forEach((l) => l.cells.forEach((c, k) => out.push({ ...c, k: l.cells.length - k })));
      return out.sort((a, b) => a.k - b.k);
    };
    const cells = cellsNow();
    for (let guard = 0; guard < 300; guard++) {
      const coins = t.siege.state().coins;
      const have = {}; for (const tw of t.siege.turrets()) have[tw.type] = (have[tw.type] ?? 0) + 1;
      const pick = avail.filter((x) => COST[x] <= coins).sort((a, b) => (have[a] ?? 0) - (have[b] ?? 0))[0];
      let ok = false;
      if (pick) {
        for (const c of cells) {
          for (const [di, dj] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]) {
            if (t.build.placeAt(c.i + di, c.j + dj, pick, 0)) { ok = true; break; }
          }
          if (ok) break;
        }
      }
      if (ok) continue;
      let up = false;
      for (const tw of t.siege.turrets()) {
        t.menu.inspect(tw.id);
        const c0 = t.siege.state().coins;
        t.menu.act('box:upgrade');
        if (t.siege.state().coins < c0) { up = true; break; }
      }
      t.menu.act('box:close');
      if (!up) break;
    }
    t.siege.horn();
    t.plant.timeScale(6);
    return { wave: st.wave + 1, name: st.name, towers: t.siege.turrets().length, coins: t.siege.state().coins };
  }, MODE);
  await page.waitForFunction(() => { const s = window.__tubes.siege.state(); return s.phase !== 'wave'; }, undefined, { timeout: 400000, polling: 500 });
  const st = await page.evaluate(() => window.__tubes.siege.state());
  console.log(`wave ${r.wave} ${r.name}: ${r.towers} towers → core ${(st.core * 100).toFixed(0)}% ${st.phase}, coins ${st.coins}`);
  if (st.phase === 'fallen' || st.phase === 'core') break;
}
await browser.close();
