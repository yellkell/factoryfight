#!/usr/bin/env node
/**
 * THE ARSENAL — every weapon, photographed in the act.
 *
 *   npm run dev
 *   node tools/weapons-look.mjs      → shots/weapons/
 *
 * A core in the middle of a bare floor, one weapon out along each road
 * to it, and a crawler set walking in down that road. The camera stands
 * behind the gun, low, looking out at what is coming — and the shutter
 * waits for the gun to fire. The burners are plumbed first: the flamer
 * off the amber feed's twin spout, the coil off the volt feed.
 */

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const S = 0.7; // room metres per plant metre
const CELL = 0.35;
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
mkdirSync('shots/weapons', { recursive: true });

/** The emulator's furniture out of the frame, every time (it comes back). */
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
    // The emulator draws its hand gizmos on its own canvas, stacked over
    // the app's: hide every canvas above the lowest.
    const cs = [...document.querySelectorAll('canvas')].sort(
      (a, b) => Number(getComputedStyle(a).zIndex || 0) - Number(getComputedStyle(b).zIndex || 0),
    );
    cs.slice(1).forEach((c) => (c.style.visibility = 'hidden'));
  });

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

async function seatRun(key, unit) {
  const g = (await page.evaluate((s) => window.__tubes.plant.glands(s), key)).find((x) => x.unit === unit);
  if (!g) return false;
  await page.evaluate((s) => window.__tubes.plant.grab(s), key);
  const head = (await page.evaluate(() => window.__tubes.plant.state())).runs.find((r) => r.key === key).head;
  const seat = { x: g.x + g.nx * 0.1, y: g.y, z: g.z + g.nz * 0.1 };
  for (let k = 1; k <= 6; k++) {
    await page.evaluate(
      ({ a, b, k }) =>
        window.__tubes.plant.dragTo(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k),
      { a: head, b: seat, k: k / 6 },
    );
    await page.waitForTimeout(140);
  }
  const ok = await page
    .waitForFunction(
      ({ s, u }) => {
        const r = window.__tubes.plant.state().runs.find((x) => x.key === s);
        return r && r.phase === 'flowing' && r.target === u;
      },
      { s: key, u: unit },
      { timeout: 10000 },
    )
    .then(() => true)
    .catch(() => false);
  await page.evaluate(() => window.__tubes.plant.release());
  return ok;
}

// The core, every feed awake, a fat bank — then the five guns, one per
// road. (dx, dz) is the road's direction out from the core, in cells.
await page.evaluate(() => {
  const t = window.__tubes;
  t.siege.core();
  t.siege.wakeAll();
  t.plant.grantBank({ gear: 60, cell: 8, chip: 8, pump: 6 });
});
await page.waitForTimeout(300);
const core = (await page.evaluate(() => window.__tubes.plant.plan())).find((u) => u.type === 'dock');
// One weapon at a time, on a clean floor: where it stands (cells off the
// core), the road its crawlers come down, and how far out they start.
const roads = {
  flamer: { at: [0, -2], d: [0, -1], far: 0.95, kind: 'beetle', more: 'mite', crowd: 40 },
  piston: { at: [0, -2], d: [0, -1], far: 0.45, kind: 'beetle', more: 'mite', crowd: 14 },
  turret: { at: [0, -2], d: [0, -1], far: 1.3, kind: 'hulk', more: 'mite', crowd: 10 },
  tesla: { at: [0, -2], d: [0, -1], far: 1.0, kind: 'beetle', more: 'mite', crowd: 30 },
  mortar: { at: [-5, -3], d: [1, 0], far: 1.6, kind: 'hulk', more: 'mite', crowd: 60, flip: -1, eye: -0.6 },
};
const feedOf = { flamer: 'far:1', tesla: 'right:0' };
for (const [w, r] of Object.entries(roads)) {
  await page.evaluate(() => {
    const t = window.__tubes;
    t.siege.clear();
    for (const u of t.plant.plan()) if (u.type !== 'dock') t.build.removeAt(u.i, u.j);
    t.plant.grantBank({ gear: 10, cell: 2, chip: 3, pump: 2 });
  });
  const i = core.i + r.at[0];
  const j = core.j + r.at[1];
  const stood = await page.evaluate(({ i, j, w }) => window.__tubes.build.placeAt(i, j, w, 0), { i, j, w });
  const g = { x: (i + 0.5) * CELL, z: (j + 0.5) * CELL };
  let plumbed = true;
  if (feedOf[w]) {
    await page.waitForTimeout(400);
    const uid = (await page.evaluate(() => window.__tubes.plant.plan())).find((u) => u.type === w).id;
    plumbed = await seatRun(feedOf[w], uid);
  }
  const len = Math.hypot(r.d[0], r.d[1]);
  const ux = r.d[0] / len;
  const uz = r.d[1] / len;
  const ex = g.x + ux * r.far;
  const ez = g.z + uz * r.far;
  const head = Math.atan2(-ux, -uz);
  const place = (k, x, z) => page.evaluate(({ k, x, z, h }) => window.__tubes.siege.place(k, x, z, h), { k, x, z, h: head });
  await place(r.kind, ex, ez);
  if (r.more) {
    await place(r.more, ex - uz * 0.32 + ux * 0.2, ez + ux * 0.32 + uz * 0.2);
    await place(r.more, ex + uz * 0.34 + ux * 0.35, ez - ux * 0.34 + uz * 0.35);
  }
  await page.evaluate(() => window.__tubes.siege.tough(40));
  // …and a crowd of ordinary mites round it, which die like mites: the
  // shot is of the tide coming apart, not of one sitter.
  await page.evaluate(
    ({ n, x, z, ux, uz, h }) => {
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * 0.32;
        window.__tubes.siege.place('mite', x + Math.sin(a) * d + ux * 0.15, z + Math.cos(a) * d + uz * 0.15, h + (Math.random() - 0.5) * 0.6);
      }
    },
    { n: r.crowd ?? 0, x: ex, z: ez, ux, uz, h: head },
  );
  // The camera: square-on to the road, a little back toward the gun,
  // low — the gun on one side of the frame, what it is killing on the
  // other.
  const mid = [((g.x + ex) / 2) * S, ((g.z + ez) / 2) * S];
  const span = r.far * S;
  const dist = 0.5 + span * 0.8;
  const flip = r.flip ?? 1;
  const cam = [mid[0] + uz * dist * flip - ux * 0.1, mid[1] - ux * dist * flip - uz * 0.1];
  await lookAt(cam[0], cam[1], r.eye ?? -1.15, mid[0], 0.25, mid[1]);
  await studio();
  const fired = await page
    .waitForFunction((w) => window.__tubes.siege.turrets().some((t) => t.type === w && t.fired < 0.05), w, {
      timeout: 15000,
      polling: 16,
    })
    .then(() => true)
    .catch(() => false);
  // Hold for the part worth seeing: the shell's landing, the fire's
  // full tongue. The quick ones (a slug, a bolt, the ram) are caught in
  // slow motion: the next shot after this one, at a twelfth speed, so
  // the shutter's own lag can't miss a bolt that lives a fifth of a
  // second.
  if (w === 'mortar' || w === 'flamer') {
    await page.waitForTimeout(w === 'mortar' ? 1000 : 700);
    await page.evaluate(() => window.__tubes.plant.timeScale(0.05));
  } else {
    await page.evaluate(() => window.__tubes.plant.timeScale(0.08));
    await page
      .waitForFunction((w) => window.__tubes.siege.turrets().some((t) => t.type === w && t.fired < 0.012), w, {
        timeout: 30000,
        polling: 16,
      })
      .catch(() => {});
  }
  await page.waitForTimeout(w === 'piston' ? 400 : 60);
  await page.screenshot({ path: `shots/weapons/${w}.png` });
  await page.evaluate(() => window.__tubes.plant.timeScale(1));
  console.log(`  ${stood && plumbed && fired ? '✓' : '✗'} ${w} (stood ${stood}, plumbed ${plumbed}, fired ${fired}) · shots/weapons/${w}.png`);
}

// The whole ring round the core, from above and behind, mid-wave.
await page.evaluate(({ ci, cj }) => {
  const t = window.__tubes;
  t.siege.clear();
  for (const u of t.plant.plan()) if (u.type !== 'dock') t.build.removeAt(u.i, u.j);
  t.plant.grantBank({ gear: 40, cell: 4, chip: 6, pump: 4 });
  const ring = { flamer: [0, -2], piston: [-1, -1], turret: [2, -1], tesla: [-2, 1], mortar: [1, 2] };
  for (const [w, [di, dj]] of Object.entries(ring)) t.build.placeAt(ci + di, cj + dj, w, 0);
}, { ci: core.i, cj: core.j });
await page.waitForTimeout(400);
{
  const pl = await page.evaluate(() => window.__tubes.plant.plan());
  await seatRun('far:1', pl.find((u) => u.type === 'flamer').id);
  await seatRun('right:0', pl.find((u) => u.type === 'tesla').id);
}
await page.evaluate(() => {
  const t = window.__tubes;
  t.siege.breaches(4);
  for (let b = 0; b < 4; b++) t.siege.spawn('mite', b, 120);
  t.siege.spawn('hulk', 0);
  t.siege.spawn('beetle', 1, 10);
  t.siege.tough(6);
});
// The whole ring, from above and behind the core.
await lookAt(core.i * CELL * S + 0.2, core.j * CELL * S + 2.0, -0.2, core.i * CELL * S, 0.2, core.j * CELL * S);
await studio();
await page.waitForTimeout(3500);
await page.screenshot({ path: 'shots/weapons/ring.png' });
console.log('  · shots/weapons/ring.png');

if (errs.length) console.log('errors', errs);
await browser.close();
