#!/usr/bin/env node
/**
 * THE CRAWLERS — every enemy, held still and photographed.
 *
 *   npm run dev
 *   node tools/enemy-look.mjs      → shots/enemies/
 *
 * The fight is frozen (a tools-only hook), each kind is stood on the
 * floor facing the camera, and the room's own lights are left as they
 * are — this is what they look like in play, not in a studio.
 */

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const S = 0.7; // room metres per plant metre
let browser;
try {
  browser = await chromium.launch();
} catch {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
}
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(base, { waitUntil: 'networkidle' });
await page.click('#enter-ar');
await page.waitForFunction(() => Boolean(window.__tubes?.site));
await page.waitForTimeout(300);
await page.evaluate(() => window.__tubes.wallsInfo.forceFallback());
await page.waitForFunction(() => window.__tubes.site.wallsReady);
await page.evaluate(() => {
  for (const el of document.querySelectorAll('*')) if (el.shadowRoot) el.style.display = 'none';
  const s = window.__tubes.scene();
  const rig = s.children.find((o) => o.children.some((c) => c.isCamera));
  rig?.traverse((c) => {
    if (c.isMesh || c.isLine) c.material.visible = false;
  });
  const cs = [...document.querySelectorAll('canvas')].sort(
    (a, b) => Number(getComputedStyle(a).zIndex || 0) - Number(getComputedStyle(b).zIndex || 0),
  );
  cs.slice(1).forEach((c) => (c.style.visibility = 'hidden'));
  window.__tubes.menu.act('tab:factory');
  window.__tubes.menu.act('start-order');
});
await page.waitForTimeout(300);
mkdirSync('shots/enemies', { recursive: true });

// The core goes down behind them (so the plate and its ring are in the
// world, as in play), then the fight is held still.
const kinds = ['mite', 'beetle', 'hulk'];
const xs = [-0.6, -0.2, 0.45]; // plant metres
const Z = -1.6;
await page.evaluate(
  ({ kinds, xs, Z }) => {
    const t = window.__tubes;
    t.siege.core();
    t.siege.freeze(true);
    kinds.forEach((k, n) => t.siege.place(k, xs[n], Z, -0.35));
  },
  { kinds, xs, Z },
);
await page.waitForTimeout(400);

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
  await page.waitForTimeout(300);
}

// The line-up, from a crouch.
await lookAt(0.0, Z * S + 0.8, -1.2, 0.0, 0.05, Z * S);
await page.screenshot({ path: 'shots/enemies/lineup.png' });
console.log('  · shots/enemies/lineup.png');

// Each one, close.
const reach = { mite: 0.3, beetle: 0.4, hulk: 0.8 };
for (let n = 0; n < kinds.length; n++) {
  const x = xs[n] * S;
  const z = Z * S;
  const d = reach[kinds[n]];
  await lookAt(x - d * 0.35, z + d, -1.6 + d * 0.55, x, 0.06, z);
  await page.screenshot({ path: `shots/enemies/${kinds[n]}.png` });
  console.log(`  · shots/enemies/${kinds[n]}.png`);
}
// A crowd: two hundred of them, frozen mid-stride.
await page.evaluate(() => {
  const t = window.__tubes;
  t.siege.clear();
  for (let k = 0; k < 220; k++) {
    const a = Math.random() * Math.PI * 2;
    const d = 0.25 + Math.sqrt(Math.random()) * 0.9;
    t.siege.place(Math.random() < 0.08 ? 'beetle' : 'mite', Math.sin(a) * d, -1.6 + Math.cos(a) * d * 0.6, Math.PI + (Math.random() - 0.5));
  }
  t.siege.place('hulk', 0.1, -1.7, Math.PI);
});
await lookAt(0.0, Z * S + 1.0, -0.9, 0.0, 0.05, Z * S);
await page.screenshot({ path: 'shots/enemies/crowd.png' });
console.log('  · shots/enemies/crowd.png');
if (errs.length) console.log('errors', errs);
await browser.close();
