#!/usr/bin/env node
/**
 * THE CRAWLERS — every enemy, held still and photographed.
 *
 *   npm run dev
 *   node tools/enemy-look.mjs      → shots/enemies/
 *
 * The line-up from a crouch and from standing height; each kind close
 * (three-quarters, low from the side, straight down); and a crowd.
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
// Twice the pixels, so a close-up can crop the middle and stay sharp.
const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
// A shader that fails to compile draws nothing, and says so only here.
page.on('console', (m) => {
  if (/Shader Error|WebGLProgram|Program Info Log/.test(m.text())) errs.push(`[shader] ${m.text().slice(0, 400)}`);
});
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

/** Put the eye at room point `eye` and look at room point `at`. */
async function look(eye, at) {
  const [ex, ey, ez] = eye;
  const [tx, ty, tz] = at;
  const yaw = Math.atan2(ex - tx, ez - tz);
  const pitch = Math.atan2(ty - ey, Math.hypot(ex - tx, ez - tz));
  const e = 1.6;
  await page.evaluate(({ x, z, yaw, y, pitch }) => window.__tubes.rig(x, z, yaw, y, pitch), {
    x: ex - e * Math.sin(pitch) * Math.sin(yaw),
    z: ez - e * Math.sin(pitch) * Math.cos(yaw),
    yaw,
    y: ey - e * Math.cos(pitch),
    pitch,
  });
  await page.waitForTimeout(300);
}
async function shot(name, zoom = false) {
  await page.screenshot(
    zoom
      ? { path: `shots/enemies/${name}.png`, clip: { x: 320, y: 190, width: 640, height: 380 }, scale: 'device' }
      : { path: `shots/enemies/${name}.png`, scale: 'css' },
  );
  console.log(`  · shots/enemies/${name}.png`);
}

// What each body costs.
const tris = await page.evaluate(() => {
  const out = {};
  window.__tubes.scene().traverse((o) => {
    if (o.isMesh && o.name.startsWith('swarm-')) {
      const g = o.geometry;
      out[o.name.slice(6)] = `${(g.index ? g.index.count : g.getAttribute('position').count) / 3} tris, ${g.getAttribute('position').count} verts`;
    }
  });
  return out;
});
console.log('  triangles', tris);

// The line-up, from a crouch, and from where a standing player sees it.
const mid = [0.0, 0.05, Z * S];
await look([0.0, 0.28, Z * S + 0.62], mid);
await shot('lineup');
await look([0.05, 1.55, Z * S + 0.55], mid);
await shot('lineup-top');

// Each one, close (the middle of the frame, cropped: twice the zoom):
// three-quarters from above, low from the side, and straight down.
const reach = { mite: 0.12, beetle: 0.2, hulk: 0.42 };
for (let n = 0; n < kinds.length; n++) {
  const x = xs[n] * S;
  const z = Z * S;
  const d = reach[kinds[n]];
  const at = [x, d * 0.12, z];
  await look([x - d * 0.35, d * 0.75, z + d], at);
  await shot(kinds[n], true);
  await look([x + d * 1.15, d * 0.3, z + d * 0.6], at);
  await shot(`${kinds[n]}-low`, true);
  await look([x, d * 1.35, z + d * 0.25], at);
  await shot(`${kinds[n]}-top`, true);
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
await look([0.0, 0.7, Z * S + 1.0], [0.0, 0.05, Z * S]);
await shot('crowd');
await look([0.0, 1.6, Z * S + 0.7], [0.0, 0.0, Z * S]);
await shot('crowd-top');
if (errs.length) {
  console.log('errors', errs);
  process.exitCode = 1;
}
await browser.close();
