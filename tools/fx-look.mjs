#!/usr/bin/env node
/**
 * THE MOMENTS — every big effect in the fight, stopped mid-flight.
 *
 *   npm run dev
 *   node tools/fx-look.mjs            → shots/fx/
 *   ONLY=mortar,tesla node tools/fx-look.mjs
 *
 * A core in the middle of a bare floor, one weapon at a time on the
 * road south of it, a crowd of mites (and a sitter or two) in its reach.
 * The shutter is the game's own (`__tubes.siege.snap`): the next time
 * the effect plays, the clock runs on for a set slice of EFFECT time and
 * stops dead — so a bolt that lives a fifth of a second is caught at
 * 30 ms every time, whatever the headless frame rate.
 *
 * Then the moments no weapon makes on cue — a multi-kill (thirty at
 * once), a hulk going down, the core bitten, a wave cleared — called up
 * with the tools hooks, and the same multi-kill again with THE LOAD
 * pinned to its floor (fewer, bigger pieces). Fails on a page error.
 */

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
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
page.on('console', (m) => {
  if (m.type() === 'error' && /shader|program|GLSL/i.test(m.text())) errs.push(m.text());
});
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
mkdirSync('shots/fx', { recursive: true });

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

/** Stand the camera at room (px, pz), py under eye height, looking at (tx, ty, tz). */
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
  const t = window.__tubes;
  t.siege.core();
  t.siege.wakeAll();
  t.siege.coins(5000);
});
await page.waitForTimeout(300);
const core = (await page.evaluate(() => window.__tubes.plant.plan())).find((u) => u.type === 'dock');
const C = { x: (core.i + 0.5) * CELL, z: (core.j + 0.5) * CELL };

/** A clean floor: no crawlers, no towers but the core, the clock running. */
const clean = () =>
  page.evaluate(() => {
    const t = window.__tubes;
    t.plant.timeScale(1);
    t.siege.freeze(false);
    t.siege.fxQuality(1);
    t.siege.clear();
    // …and the last scene's stains off the floor.
    t.scene().traverse((o) => o.userData?.splats?.clear());
    for (const u of t.plant.plan()) if (u.type !== 'dock') t.build.removeAt(u.i, u.j);
    t.siege.coins(5000);
  }).then(() => page.waitForTimeout(1800));

/** A crowd of n mites round plant (x, z), facing the core. */
const crowd = (n, x, z, spread, kind = 'mite') =>
  page.evaluate(
    ({ n, x, z, spread, kind, cx, cz }) => {
      const h = Math.atan2(cx - x, cz - z);
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * spread;
        window.__tubes.siege.place(kind, x + Math.sin(a) * d, z + Math.cos(a) * d, h + (Math.random() - 0.5) * 0.6);
      }
    },
    { n, x, z, spread, kind, cx: C.x, cz: C.z },
  );

/** Arm the shutter, wait for it, photograph. */
async function shoot(name, kind, after, timeout = 20000, trigger = null) {
  await page.evaluate(({ kind, after }) => window.__tubes.siege.snap(kind, after), { kind, after });
  if (trigger) await trigger();
  const ok = await page
    .waitForFunction(() => window.__tubes.siege.snapped(), null, { timeout, polling: 16 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(120);
  const lit = await page.evaluate(() => window.__tubes.siege.glows());
  await page.screenshot({ path: `shots/fx/${name}.png` });
  console.log(`  ${ok ? '✓' : '✗'} ${name} — glows lit: ${lit.rings} rings, ${lit.balls} balls, ${lit.rods} rods · shots/fx/${name}.png`);
  return ok;
}

/** One weapon two cells south of the core; the camera off to the side. */
async function stand(w, di = 0, dj = -2) {
  const at = await page.evaluate(
    ({ i, j, w }) => {
      for (let r = 0; r < 4; r++)
        for (let a = -r; a <= r; a++)
          for (let b = -r; b <= r; b++) {
            if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue;
            if (window.__tubes.build.placeAt(i + a, j + b, w, 0)) return [i + a, j + b];
          }
      return null;
    },
    { i: core.i + di, j: core.j + dj, w },
  );
  return at ? { x: (at[0] + 0.5) * CELL, z: (at[1] + 0.5) * CELL } : null;
}

const want = (name) => !ONLY || ONLY.includes(name);
let fails = 0;
const check = (ok) => {
  if (!ok) fails++;
};

// The weapon scenes: the camera set and the gun stood first, the shutter
// armed, and only THEN the crowd walked in — a gun that fires the moment
// it has a target would otherwise spend its shot before the shutter is
// listening.

// THE MORTAR: a shell in the air over a crowd, its landing, and the glow
// it leaves.
if (want('mortar')) {
  await clean();
  const g = await stand('mortar', 0, -2);
  const tx = g.x;
  const tz = g.z - 1.4;
  await lookAt((g.x + 1.5) * S, (g.z - 0.5) * S, -0.95, g.x * S, 0.25, (g.z - 0.75) * S);
  await studio();
  const walkIn = async () => {
    await crowd(40, tx, tz, 0.35);
    await page.evaluate(() => window.__tubes.siege.tough(3));
  };
  check(await shoot('mortar-flight', 'fire', 0.45, 20000, walkIn));
  await lookAt((tx + 1.1) * S, (tz + 0.7) * S, -1.05, tx * S, 0.05, tz * S);
  await page.evaluate(() => window.__tubes.plant.timeScale(1));
  check(await shoot('mortar-blast', 'shell', 0.07, 20000, () => page.evaluate(() => window.__tubes.plant.timeScale(1))));
  // …and the same blast half a second on: the glow it leaves.
  check(await shoot('mortar-glow', 'now', 0.45, 5000, () => page.evaluate(() => window.__tubes.plant.timeScale(1))));
}

// THE COIL: a chain through a crowd, caught mid-flicker.
if (want('tesla')) {
  await clean();
  const g = await stand('tesla', 0, -2);
  await lookAt((g.x + 1.2) * S, (g.z - 0.3) * S, -1.05, g.x * S, 0.12, (g.z - 0.7) * S);
  await studio();
  const walkIn = async () => {
    await crowd(30, g.x, g.z - 0.9, 0.45);
    await page.evaluate(() => window.__tubes.siege.tough(30));
  };
  check(await shoot('tesla', 'arc', 0.03, 20000, walkIn));
}

// THE HAMMER: a slam into a knot of them.
if (want('hammer')) {
  await clean();
  const g = await stand('hammer', 0, -2);
  await lookAt((g.x + 0.8) * S, (g.z - 0.2) * S, -1.15, g.x * S, 0.1, (g.z - 0.35) * S);
  await studio();
  const walkIn = async () => {
    await crowd(14, g.x, g.z - 0.36, 0.14);
    await page.evaluate(() => window.__tubes.siege.tough(1));
  };
  check(await shoot('hammer', 'punch', 0.07, 20000, walkIn));
}

// THE FLAMER: the jet poured for a while, scorches and all.
if (want('flamer')) {
  await clean();
  const g = await stand('flamer', 0, -2);
  await lookAt((g.x + 1.1) * S, (g.z - 0.4) * S, -1.05, g.x * S, 0.12, (g.z - 0.55) * S);
  await studio();
  const walkIn = async () => {
    await crowd(30, g.x, g.z - 0.8, 0.35);
    await page.evaluate(() => window.__tubes.siege.tough(60));
  };
  check(await shoot('flamer', 'flame', 1.4, 20000, walkIn));
}

// THE GUN: a slug landing on a sitter.
if (want('turret')) {
  await clean();
  const g = await stand('turret', 0, -2);
  await lookAt((g.x + 1.0) * S, (g.z - 0.35) * S, -1.1, g.x * S, 0.15, (g.z - 0.5) * S);
  await studio();
  const walkIn = async () => {
    await crowd(1, g.x, g.z - 0.9, 0.01, 'hulk');
    await crowd(6, g.x, g.z - 1.0, 0.25);
    await page.evaluate(() => window.__tubes.siege.tough(20));
  };
  check(await shoot('turret', 'hit', 0.015, 20000, walkIn));
}

// A MULTI-KILL: thirty at once, under a shell — and again, THE LOAD
// pinned low.
for (const [name, q] of [
  ['multikill', 1],
  ['multikill-lowq', 0.35],
]) {
  if (!want(name)) continue;
  await clean();
  const x = C.x;
  const z = C.z - 1.1;
  await crowd(30, x, z, 0.32);
  await lookAt((x + 1.0) * S, (z + 0.6) * S, -1.05, x * S, 0.05, z * S);
  await studio();
  await page.evaluate((q) => window.__tubes.siege.fxQuality(q), q);
  check(await shoot(name, 'shell', 0.09, 5000, () => page.evaluate(({ x, z }) => window.__tubes.siege.smite(x, z, 0.4, 'mortar'), { x, z })));
}

// A HULK goes down.
if (want('hulk')) {
  await clean();
  const x = C.x + 0.4;
  const z = C.z - 1.1;
  await crowd(1, x, z, 0.01, 'hulk');
  await crowd(8, x, z, 0.4);
  await lookAt((x + 0.9) * S, (z + 0.5) * S, -1.1, x * S, 0.1, z * S);
  await studio();
  check(await shoot('hulk', 'death', 0.12, 5000, () => page.evaluate(({ x, z }) => window.__tubes.siege.smite(x, z, 0.05, 'turret'), { x, z })));
}

// THE CORE bitten, and A WAVE CLEARED — from over the core.
for (const [name, kind, after] of [
  ['core-hit', 'core-hit', 0.06],
  ['clear', 'clear', 0.45],
]) {
  if (!want(name)) continue;
  await clean();
  await lookAt((C.x + 1.4) * S, (C.z + 1.4) * S, -0.7, C.x * S, 0.2, C.z * S);
  await studio();
  const fire = () => page.evaluate(({ kind, x, z }) => window.__tubes.siege.fx({ kind, x, y: 0, z, radius: 2 }), { kind, x: C.x, z: C.z });
  check(await shoot(name, kind, after, 5000, fire));
}

await page.evaluate(() => window.__tubes.plant.timeScale(1));
const load = await page.evaluate(() => window.__tubes.siege.fxQuality());
console.log(`  · THE LOAD: q ${load.q.toFixed(2)}, frame EMA ${load.ema.toFixed(1)} ms, beat ${load.beat.toFixed(1)} ms`);
if (errs.length) {
  console.log('errors', errs);
  fails++;
}
await browser.close();
if (fails) {
  console.log(`\n${fails} moment(s) missed.`);
  process.exit(1);
}
console.log('\nEVERY MOMENT CAUGHT.');
