#!/usr/bin/env node
/**
 * THE LANES, FROM ABOVE — every lane laid and open, photographed looking
 * straight down on the core, then low along a bend, to judge the roads'
 * corners (and a crowd walking round them).
 *
 *   npm run dev
 *   node tools/lane-look.mjs     → shots/lanes/
 */

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const S = 0.7;
const CELL = 0.35;
let browser;
try {
  browser = await chromium.launch();
} catch {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
}
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
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
mkdirSync('shots/lanes', { recursive: true });
await page.evaluate(() => window.__tubes.siege.core());
await page.waitForTimeout(400);
await page.evaluate(() => {
  const t = window.__tubes;
  t.siege.breaches(4);
  t.siege.horn();
});
const core = (await page.evaluate(() => window.__tubes.plant.plan())).find((u) => u.type === 'dock');
const cx = (core.i + 0.5) * CELL * S;
const cz = (core.j + 0.5) * CELL * S;

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
await page.evaluate(() => {
  for (const el of document.querySelectorAll('*')) if (el.shadowRoot) el.style.display = 'none';
  const cs = [...document.querySelectorAll('canvas')].sort(
    (a, b) => Number(getComputedStyle(a).zIndex || 0) - Number(getComputedStyle(b).zIndex || 0),
  );
  cs.slice(1).forEach((c) => (c.style.visibility = 'hidden'));
});

// Straight down over the core, high enough to see every lane's bends.
await lookAt(cx, cz + 0.02, 1.2, cx, 0, cz);
await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/lanes/above.png' });
console.log('  · shots/lanes/above.png');

// The first bend of lane 0, close and low, with a crowd going round it.
const st = await page.evaluate(() => window.__tubes.siege.state());
const pts = st.lanes[0].pts;
let bend = null;
for (let k = 2; k + 2 < pts.length; k += 2) {
  const ax = pts[k] - pts[k - 2];
  const az = pts[k + 1] - pts[k - 1];
  const bx = pts[k + 2] - pts[k];
  const bz = pts[k + 3] - pts[k + 1];
  if (Math.abs(ax * bz - az * bx) > 1e-4) {
    bend = { x: pts[k] * S, z: pts[k + 1] * S };
    break;
  }
}
await page.evaluate(() => window.__tubes.siege.spawn('mite', 0, 60));
await page.waitForTimeout(5000);
if (bend) {
  await lookAt(bend.x + 0.5, bend.z + 0.6, -0.9, bend.x, 0, bend.z);
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'shots/lanes/bend.png' });
  console.log('  · shots/lanes/bend.png');
}
await lookAt(cx, cz + 0.02, 1.2, cx, 0, cz);
await page.waitForTimeout(200);
await page.screenshot({ path: 'shots/lanes/above-crowd.png' });
console.log('  · shots/lanes/above-crowd.png');
// THE GATES: one pouring, close, from the room; and the same one
// gathering (build phase) for comparison.
{
  // Which way a gate faces: along its lane's first step into the room.
  const facing = (k) => {
    const p = st.lanes[k].pts;
    const dx = p[2] - p[0];
    const dz = p[3] - p[1];
    const l = Math.hypot(dx, dz) || 1;
    return { x: p[0], z: p[1], nx: dx / l, nz: dz / l };
  };
  const b = facing(0);
  const gx = b.x * S;
  const gz = b.z * S;
  await lookAt(gx + b.nx * 0.9 + b.nz * 0.25, gz + b.nz * 0.9 - b.nx * 0.25, -0.95, gx, 0.18, gz);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/lanes/gate-open.png' });
  console.log('  · shots/lanes/gate-open.png');
  const b3 = facing(3);
  await page.evaluate(() => window.__tubes.siege.breaches(1));
  await page.waitForTimeout(400);
  await lookAt(b3.x * S + b3.nx * 0.9, b3.z * S + b3.nz * 0.9, -0.95, b3.x * S, 0.18, b3.z * S);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/lanes/gate-sealed.png' });
  console.log('  · shots/lanes/gate-sealed.png');
}
await browser.close();
