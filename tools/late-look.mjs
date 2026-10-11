#!/usr/bin/env node
/**
 * THE LATE WAVE, PROFILED — where a headset's frame goes when the floor
 * is full of towers and the tide is in.
 *
 *   npm run dev
 *   node tools/late-look.mjs                       (60 towers, wave 9)
 *   TOWERS=80 WAVE=9 node tools/late-look.mjs
 *   TRACE=updateMatrixWorld,burst node tools/late-look.mjs
 *
 * Stands TOWERS towers (every kind, level 3) on the cells nearest the
 * core, starts wave WAVE+1, lets it build for 12 s, then samples 6 s:
 * frames, peak draw calls and triangles, scene objects, the sim's cost,
 * and a CPU profile of the main thread — the hottest functions, and who
 * calls the TRACE'd ones. (Headless Chromium draws in software, and the
 * desktop XR emulator adds its own getParameter calls: compare runs with
 * each other, not with a headset.)
 */
import { chromium } from 'playwright';
const BASE = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const WAVE = Number(process.env.WAVE ?? 8);
const TOWERS = Number(process.env.TOWERS ?? 60);
let browser;
try {
  browser = await chromium.launch();
} catch {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
}
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.click('#enter-ar');
await page.waitForFunction(() => Boolean(window.__tubes?.site));
await page.evaluate(() => window.__tubes.wallsInfo.forceFallback());
await page.waitForFunction(() => window.__tubes.site.wallsReady);
await page.evaluate(() => { window.__tubes.menu.act('tab:factory'); window.__tubes.menu.act('start-order'); });
await page.waitForTimeout(300);
await page.evaluate(() => { const t = window.__tubes; t.siege.core(); t.siege.wakeAll(); t.siege.coins(99999); });
await page.waitForTimeout(300);
const n = await page.evaluate((N) => {
  const t = window.__tubes;
  const core = t.plant.plan().find((u) => u.type === 'dock');
  const kinds = ['turret', 'hammer', 'flamer', 'tesla', 'mortar', 'turret'];
  const cells = [];
  for (let di = -9; di <= 9; di++) for (let dj = -9; dj <= 9; dj++) if (di || dj) cells.push([di, dj, Math.hypot(di, dj)]);
  cells.sort((a, b) => a[2] - b[2]);
  let k = 0;
  for (const [di, dj] of cells) { if (k >= N) break; if (t.build.placeAt(core.i + di, core.j + dj, kinds[k % kinds.length], 0)) k++; }
  for (const tw of t.siege.turrets()) { t.menu.inspect(tw.id); t.menu.act('box:upgrade'); t.menu.act('box:upgrade'); }
  t.menu.act('box:close');
  return k;
}, TOWERS);
const idle = await page.evaluate(() => ({ objs: (() => { let c = 0; window.__tubes.scene().traverse(() => c++); return c; })() }));
console.log(`${n} towers stood; ${idle.objs} objects in the scene`);
await page.evaluate((w) => { const t = window.__tubes; t.siege.jump(w); t.siege.start(); }, WAVE);
await page.waitForTimeout(12000);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
const r = await page.evaluate(() => new Promise((done) => {
  const t = window.__tubes; const t0 = performance.now(); let frames = 0; let maxCalls = 0; let maxTris = 0; let alive = 0; let sim = 0; const gaps = []; let last = performance.now();
  const f = () => { const now = performance.now(); gaps.push(now - last); last = now; frames++; const i = t.info(); maxCalls = Math.max(maxCalls, i.calls); maxTris = Math.max(maxTris, i.triangles); const p = t.siege.perf(); alive = Math.max(alive, p.alive); sim = Math.max(sim, p.sim); if (now - t0 < 6000) requestAnimationFrame(f); else { gaps.sort((a,b)=>a-b); done({ frames, maxCalls, maxTris, alive, sim, shards: p.shards, medFrame: gaps[gaps.length>>1] }); } };
  requestAnimationFrame(f);
}));
const { profile } = await cdp.send('Profiler.stop');
console.log(JSON.stringify(r));
const counts = new Map(); for (let k = 0; k < profile.samples.length; k++) counts.set(profile.samples[k], (counts.get(profile.samples[k]) ?? 0) + (profile.timeDeltas[k] ?? 0));
const self = new Map(); for (const nd of profile.nodes) { const key = `${nd.callFrame.functionName || '(anon)'} ${nd.callFrame.url.split('/').pop().split('?')[0]}:${nd.callFrame.lineNumber}`; self.set(key, (self.get(key) ?? 0) + (counts.get(nd.id) ?? 0)); }
const busy = [...self.entries()].filter(([k]) => !k.startsWith('(program)') && !k.startsWith('(idle)'));
const tot = busy.reduce((a, [, v]) => a + v, 0);
console.log(`JS busy ${(tot/1000).toFixed(0)} ms over 6 s`);
console.log(busy.sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => `${(v / tot * 100).toFixed(1).padStart(5)}%  ${k}`).join('\n'));
const byId = new Map(profile.nodes.map((nd) => [nd.id, nd]));
const parent = new Map(); for (const nd of profile.nodes) for (const c of nd.children ?? []) parent.set(c, nd.id);
const nm = (nd) => (nd.callFrame.functionName || '(anon)') + ' ' + nd.callFrame.url.split('/').pop().split('?')[0] + ':' + nd.callFrame.lineNumber;
for (const target of (process.env.TRACE ?? 'updateMatrixWorld').split(',')) {
  const chains = new Map();
  for (const nd of profile.nodes) {
    if ((nd.callFrame.functionName) !== target) continue;
    const t = counts.get(nd.id) ?? 0; if (!t) continue;
    const ch = []; let p = parent.get(nd.id); for (let d = 0; d < 7 && p; d++) { ch.push(nm(byId.get(p))); p = parent.get(p); }
    const k = ch.join(' < '); chains.set(k, (chains.get(k) ?? 0) + t);
  }
  console.log('== ' + target);
  for (const [k, v] of [...chains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)) console.log('  ' + (v/1000).toFixed(0) + 'ms  ' + k);
}
await browser.close();
