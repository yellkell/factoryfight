#!/usr/bin/env node
/**
 * THE SOCKET, FROM EVERYWHERE — the anti-culling check.
 *
 *   npm run dev
 *   node tools/socket-look.mjs
 *
 * A socket is the thing you look hardest at, and it is the piece most
 * exposed to backface culling: its throat is an OPEN cylinder, so a
 * one-sided material draws only the wall facing the camera and the mouth
 * reads as half a rim — a defect that is invisible from any single
 * viewpoint and obvious the moment you walk round it.
 *
 * So walk round it: this parks the rig on an arc through the socket's
 * facing hemisphere (grazing left → square on → grazing right, near and
 * far) and shoots each one into shots/socket/. Flip through them; the
 * mouth must read as a WHOLE ring in every frame.
 */

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
mkdirSync('shots/socket', { recursive: true });

let browser;
try {
  browser = await chromium.launch();
} catch {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
}
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(base));
await page.waitForTimeout(1200);
await page.click('#enter-ar');
await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 15000 });
await page.waitForFunction(() => Boolean(window.__tubes?.site), { timeout: 10000 });
await page.evaluate(() => window.__tubes.wallsInfo.forceFallback());
await page.waitForFunction(() => window.__tubes.site.wallsReady, { timeout: 5000 });

// A wall-mounted run, so the socket wakes on a wall (the hardest case:
// a floor/ceiling port is looked at from above or below, a wall socket
// gets walked past at every grazing angle there is).
const target = await page.evaluate(() => {
  const t = window.__tubes;
  const wallsOnly = t.walls.filter((w) => w.kind === 'wall');
  for (let seed = 1; seed <= 40; seed++) {
    t.startJob(0, seed);
    t.place.mountAt(wallsOnly[seed % wallsOnly.length].id, 0.2, 0.1);
    const run = t.site.runs[0];
    const w = t.walls.find((x) => x.id === run.wallB);
    if (w && w.kind === 'wall') {
      return { seed, B: { ...run.pointB }, n: { ...run.normalB } };
    }
    t.abandonShift();
  }
  return null;
});
if (!target) {
  console.error('no wall socket found');
  await browser.close();
  process.exit(1);
}
await page.waitForFunction(() => window.__tubes.site.runs[0]?.phase === 'pull', undefined, {
  timeout: 6000,
});
await page.waitForTimeout(400);

// The arc: yaw the socket's own normal around world up, near and far.
const HEAD = 1.6; // the emulated headset's height above the rig
for (const dist of [0.55, 1.2]) {
  for (const deg of [-75, -50, -25, 0, 25, 50, 75]) {
    const a = (deg * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    // Rotate the normal about Y, step out along it, look back at the mouth.
    const dx = target.n.x * cos - target.n.z * sin;
    const dz = target.n.x * sin + target.n.z * cos;
    const px = target.B.x + dx * dist;
    const pz = target.B.z + dz * dist;
    const yaw = Math.atan2(dx, dz); // face back toward the socket
    await page.evaluate(
      ({ px, pz, yaw, y }) => window.__tubes.rig(px, pz, yaw, y),
      { px, pz, yaw, y: target.B.y - HEAD },
    );
    await page.waitForTimeout(140);
    const tag = `${dist.toFixed(2)}m_${deg >= 0 ? '+' : ''}${deg}`;
    await page.screenshot({ path: `shots/socket/${tag}.png` });
  }
}

console.log(`shots/socket/: 14 angles on a wall socket (seed ${target.seed})`);
await browser.close();
