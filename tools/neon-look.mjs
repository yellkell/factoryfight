#!/usr/bin/env node
/**
 * THE NEON LINE-UP — one of every machine on the floor, shot two ways,
 * plus every PICTURE the menus use (the baked renders, not drawings).
 *
 *   npm run dev
 *   node tools/neon-look.mjs      → shots/neon/
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
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
  window.__tubes.menu.act('tab:factory');
  window.__tubes.menu.act('start-order');
});
await page.waitForTimeout(300);
await page.evaluate(() => window.__tubes.plant.openAll());
mkdirSync('shots/neon', { recursive: true });

const row = [
  ['dock', -3],
  ['maker', -2],
  ['combiner', -1],
  ['chest', 0],
  ['turret', 1],
  ['wall', 2],
  ['post', 3],
];
await page.evaluate((row) => {
  for (const [t, i] of row) window.__tubes.build.placeAt(i, -1, t, 2);
  for (let i = -3; i <= 3; i++) window.__tubes.build.placeAt(i, 1, 'belt', 1);
  window.__tubes.build.placeAt(2, 0, 'wall', 0);
  window.__tubes.build.placeAt(3, 0, 'wall', 0);
}, row);
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
await lookAt(0, 1.25, -0.55, 0, 0.35, -0.2);
await page.screenshot({ path: 'shots/neon/lineup.png' });
await lookAt(-0.9, 0.7, -0.75, -0.3, 0.35, -0.25);
await page.screenshot({ path: 'shots/neon/lineup-close.png' });

// The pictures, as baked.
const pics = await page.evaluate(() => window.__tubes.pictures?.() ?? {});
for (const [id, url] of Object.entries(pics)) {
  writeFileSync(`shots/neon/pic-${id}.png`, Buffer.from(url.split(',')[1], 'base64'));
}
// …and all of them on one dark contact sheet, labelled.
const sheet = await page.evaluate(async (pics) => {
  const ids = Object.keys(pics);
  const W = 170;
  const cols = 8;
  const c = document.createElement('canvas');
  c.width = W * cols;
  c.height = (W + 26) * Math.ceil(ids.length / cols);
  const g = c.getContext('2d');
  g.fillStyle = '#14120e';
  g.fillRect(0, 0, c.width, c.height);
  for (let k = 0; k < ids.length; k++) {
    const img = new Image();
    img.src = pics[ids[k]];
    await img.decode();
    const x = (k % cols) * W;
    const y = Math.floor(k / cols) * (W + 26);
    g.drawImage(img, x + 5, y + 5, W - 10, W - 10);
    g.fillStyle = '#ccc';
    g.font = '16px sans-serif';
    g.textAlign = 'center';
    g.fillText(ids[k].toUpperCase(), x + W / 2, y + W + 14);
  }
  return c.toDataURL('image/png');
}, pics);
writeFileSync('shots/neon/contact.png', Buffer.from(sheet.split(',')[1], 'base64'));
console.log(`  · shots/neon/ (lineup, lineup-close, contact, ${Object.keys(pics).length} pictures)`);
if (errs.length) console.log('errors', errs);
await browser.close();
