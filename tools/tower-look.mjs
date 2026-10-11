#!/usr/bin/env node
/**
 * THE LINE-UP — the five towers and the core, shoulder to shoulder, so
 * you can see at a glance whether they read as five different things.
 *
 *   npm run dev
 *   node tools/tower-look.mjs      → shots/weapons/lineup-*.png
 *
 * Counts first: how many scene objects (meshes, groups, the lot) one
 * tower of each kind adds to the scene, at level 1 and at level 3 —
 * three.js walks every one of them every frame. Then the line-up, a
 * row of TURRET · HAMMER · FLAMER · TESLA · MORTAR with the CORE at the
 * end, photographed at each level: from where a standing player's eyes
 * are (`lineup-l1.png`), level with them from the side (`-side`), and
 * from straight over (`-top`) — and the menu pictures the studio baked
 * of each (`lineup-pictures.png`).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const S = 0.7; // room metres per plant metre
const CELL = 0.35;
const KINDS = ['turret', 'hammer', 'flamer', 'tesla', 'mortar'];
let browser;
try {
  browser = await chromium.launch();
} catch {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
}
const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 2 });
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
await page.evaluate(() => {
  const t = window.__tubes;
  t.siege.core();
  t.siege.wakeAll();
  t.siege.coins(99999);
});
await page.waitForTimeout(300);
mkdirSync('shots/weapons', { recursive: true });

const count = () =>
  page.evaluate(() => {
    let c = 0;
    let m = 0;
    window.__tubes.scene().traverse((o) => {
      c++;
      if (o.isMesh) m++;
    });
    return [c, m];
  });
const upgrade = () =>
  page.evaluate(() => {
    const t = window.__tubes;
    for (const tw of t.siege.turrets()) {
      t.menu.inspect(tw.id);
      t.menu.act('box:upgrade');
      t.menu.act('box:upgrade');
    }
    t.menu.act('box:close');
  });
const core = (await page.evaluate(() => window.__tubes.plant.plan())).find((u) => u.type === 'dock');

// THE COUNT: one tower at a time on an empty floor, the scene walked
// before and after (and after two upgrades).
const counts = {};
for (const w of KINDS) {
  await page.waitForTimeout(150);
  const [c0, m0] = await count();
  const ok = await page.evaluate(({ i, j, w }) => window.__tubes.build.placeAt(i, j, w, 0), { i: core.i - 2, j: core.j, w });
  await page.waitForTimeout(150);
  const [c1, m1] = await count();
  await upgrade();
  await page.waitForTimeout(150);
  const [c3, m3] = await count();
  counts[w] = { ok, l1: c1 - c0, l1Meshes: m1 - m0, l3: c3 - c0, l3Meshes: m3 - m0 };
  await page.evaluate(({ i, j }) => window.__tubes.build.removeAt(i, j), { i: core.i - 2, j: core.j });
}
console.log('objects per tower (all / meshes):');
for (const [w, c] of Object.entries(counts)) console.log(`  ${w.padEnd(7)} L1 ${c.l1} / ${c.l1Meshes}   L3 ${c.l3} / ${c.l3Meshes}${c.ok ? '' : '  (not stood!)'}`);

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

// THE LINE-UP: the five in a row running up to the core along +Z. An
// idle head faces +Z too — down the row — so from the side every barrel
// shows in profile.
const row = [];
for (let k = 0; k < KINDS.length; k++) {
  const at = await page.evaluate(
    ({ i, j, w }) => (window.__tubes.build.placeAt(i, j, w, 0) ? [i, j] : null),
    { i: core.i, j: core.j - 5 + k, w: KINDS[k] },
  );
  row.push(at);
}
if (row.some((r) => !r)) console.log('  ✗ the row did not all stand', row);
await page.waitForTimeout(400);
const cx = (core.i + 0.5) * CELL * S;
const cz = (core.j - 2.5 + 0.5) * CELL * S;
for (const level of [1, 3]) {
  if (level === 3) {
    await upgrade();
    await page.waitForTimeout(400);
  }
  const shots = {
    '': [cx + 0.95, cz + 0.25, -0.35, cx, 0.1, cz],
    '-side': [cx + 1.0, cz, -1.4, cx, 0.17, cz],
    '-top': [cx + 0.05, cz, -0.3, cx, 0, cz],
  };
  for (const [tag, v] of Object.entries(shots)) {
    await lookAt(...v);
    await studio();
    await page.waitForTimeout(350);
    const path = `shots/weapons/lineup-l${level}${tag}.png`;
    await page.screenshot({ path, clip: { x: 160, y: 80, width: 960, height: 480 } });
    console.log(`  · ${path}`);
  }
}

// THE PICTURES: the menu tiles the studio baked of each, side by side.
const pics = await page.evaluate((ids) => {
  const urls = window.__tubes.pictures();
  const c = document.createElement('canvas');
  c.width = 256 * ids.length;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#1a1c22';
  g.fillRect(0, 0, c.width, c.height);
  return Promise.all(
    ids.map(
      (id, k) =>
        new Promise((done) => {
          const img = new Image();
          img.onload = () => {
            g.drawImage(img, k * 256, 0);
            done();
          };
          img.onerror = done;
          img.src = urls[id];
        }),
    ),
  ).then(() => c.toDataURL('image/png'));
}, [...KINDS, 'dock']);
writeFileSync('shots/weapons/lineup-pictures.png', Buffer.from(pics.split(',')[1], 'base64'));
console.log('  · shots/weapons/lineup-pictures.png');

if (errs.length) console.log('errors', errs);
await browser.close();
