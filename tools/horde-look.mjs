#!/usr/bin/env node
/**
 * THE TIDE — thousands of them against a ring of every weapon.
 *
 *   npm run dev
 *   node tools/horde-look.mjs            → shots/horde/
 *   COUNT=4000 node tools/horde-look.mjs
 *
 * A core in the middle of the floor, a ring of towers round it (off the
 * lanes), all four lanes open — and then COUNT crawlers
 * at once, already out of the plaster. It photographs the tide coming
 * in, the guns tearing into it and the floor after, and reports what
 * the sim and the swarm's draw cost per frame while it was at its
 * thickest. (Headless Chromium draws in software: the frame rate here is
 * not a headset's. The sim's milliseconds are the honest number.)
 */

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const COUNT = Number(process.env.COUNT ?? 3000);
const S = 0.7;
const CELL = 0.35;
const fails = [];
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) fails.push(what);
};
let browser;
try {
  browser = await chromium.launch();
} catch {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
}
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
page.on('pageerror', (e) => fails.push(`[pageerror] ${e.message}`));
// A shader that fails to compile draws NOTHING and says so only here —
// the swarm, its shards and its splats are all hand-written GLSL.
page.on('console', (m) => {
  if (/Shader Error|WebGLProgram|Program Info Log/.test(m.text())) fails.push(`[shader] ${m.text().slice(0, 300)}`);
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
mkdirSync('shots/horde', { recursive: true });

const studio = () =>
  page.evaluate(() => {
    const s = window.__tubes.scene();
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


/* ── the ring ──────────────────────────────────────────────────────────── */

console.log('THE RING');
await page.evaluate(() => {
  const t = window.__tubes;
  t.siege.core();
  t.siege.wakeAll();
});
await page.waitForTimeout(300);
const core = (await page.evaluate(() => window.__tubes.plant.plan())).find((u) => u.type === 'dock');
const corePos0 = { x: (core.i + 0.5) * 0.35 * 0.7, z: (core.j + 0.5) * 0.35 * 0.7 };

/* ── the crowd: the worst case, before a gun stands ─────────────────────── */

console.log('THE CROWD');
const CROWD = Number(process.env.CROWD ?? 3600);
await page.evaluate((n) => {
  const t = window.__tubes;
  t.siege.breaches(4);
  t.siege.flood('mite', Math.round(n * 0.95));
  t.siege.flood('beetle', Math.round(n * 0.045));
  t.siege.flood('hulk', 6);
  // Slow time: the cost of a tick doesn't care, and the core (with no
  // gun yet) outlives the measurement.
  t.plant.timeScale(0.05);
}, CROWD);
await lookAt(corePos0.x + 0.3, corePos0.z + 2.4, 0.35, corePos0.x, 0.0, corePos0.z - 0.4);
await studio();
const crowd = await page.evaluate(
  () =>
    new Promise((done) => {
      const t = window.__tubes;
      const t0 = performance.now();
      let worst = 0;
      let sum = 0;
      let k = 0;
      const tick = () => {
        const p = t.siege.perf();
        // Skip the first frames: the flood itself is in them.
        if (performance.now() - t0 > 800) {
          worst = Math.max(worst, p.sim);
          sum += p.sim;
          k++;
        }
        if (performance.now() - t0 < 4000) requestAnimationFrame(tick);
        else done({ alive: p.alive, worst, mean: sum / Math.max(1, k), draw: p.draw });
      };
      requestAnimationFrame(tick);
    }),
);
await page.screenshot({ path: 'shots/horde/00-the-crowd.png' });
console.log('  · shots/horde/00-the-crowd.png');
console.log(
  `  · ${crowd.alive} alive — sim ${crowd.mean.toFixed(2)} ms a tick (worst ${crowd.worst.toFixed(2)}), swarm upload ${crowd.draw.toFixed(2)} ms`,
);
check(crowd.alive >= CROWD * 0.9, `${crowd.alive} crawlers alive on the floor at once`);
check(crowd.worst < 6, `the sim carries them (worst ${crowd.worst.toFixed(2)} ms a tick on this CPU)`);
await page.evaluate(() => {
  window.__tubes.siege.clear();
  window.__tubes.plant.timeScale(1);
});

// Close in: hammers and flamers; further out: turrets and coils; the
// mortars behind the core, where their blind spot is covered.
const ring = [
  ['hammer', 0, -1],
  ['hammer', 0, 1],
  ['hammer', -1, 0],
  ['hammer', 1, 0],
  ['flamer', -1, -1],
  ['flamer', 1, 1],
  ['turret', 1, -1],
  ['turret', -1, 1],
  ['turret', 2, 0],
  ['turret', -2, 0],
  ['tesla', 0, -2],
  ['tesla', 0, 2],
  ['mortar', 2, 2],
  ['mortar', -2, -2],
  // …and the second ring a player has by wave 7 (the balance bot stands
  // about two dozen): further out along every side.
  ['turret', 4, 0],
  ['turret', -4, 0],
  ['turret', 0, 4],
  ['turret', 0, -4],
  ['flamer', 3, -3],
  ['flamer', -3, 3],
  ['tesla', 3, 3],
  ['tesla', -3, -3],
  ['hammer', 4, 2],
  ['hammer', -4, -2],
  ['mortar', 2, -4],
  ['mortar', -2, 4],
];
const stood = await page.evaluate(
  ({ ring, ci, cj }) => {
    const near = (w, i, j) => {
    // The cell asked for, or the nearest free one off every lane.
    for (let r = 0; r < 6; r++) {
      for (let di = -r; di <= r; di++) {
        for (let dj = -r; dj <= r; dj++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          if (window.__tubes.build.placeAt(i + di, j + dj, w, 0)) return [i + di, j + dj];
        }
      }
    }
    return null;
  };
    window.__tubes.siege.coins(9000);
    return ring.filter(([w, di, dj]) => near(w, ci + di, cj + dj)).length;
  },
  { ring, ci: core.i, cj: core.j },
);
check(stood === ring.length, `a ring of ${stood}/${ring.length} towers round the core, off the lanes`);
// By wave 7 a player has had thousands of coins through their hands:
// the ring is upgraded to the top, the way theirs would be.
const top = await page.evaluate(() => {
  const t = window.__tubes;
  for (const tw of t.siege.turrets()) {
    t.menu.inspect(tw.id);
    t.menu.act('box:upgrade');
    t.menu.act('box:upgrade');
  }
  t.menu.act('box:close');
  return t.siege.turrets().filter((tw) => tw.level === 3).length;
});
check(top === ring.length, `and every one of them upgraded to level 3 (${top}/${ring.length})`);

/* ── the tide ──────────────────────────────────────────────────────────── */

console.log('THE TIDE');
// A real wave: SWARM, four doors, two and a half thousand pouring out at
// forty a second each.
const WAVE = Number(process.env.WAVE ?? 6);
await page.evaluate((n) => {
  const t = window.__tubes;
  t.siege.jump(n);
  t.siege.horn();
}, WAVE);
let st = await page.evaluate(() => window.__tubes.siege.state());
const total = st.queued + st.enemies;
check(total >= 2000, `wave ${WAVE + 1}, ${st.name}: ${total} of them, out of ${st.breaches.length} breaches`);
const corePos = { x: (core.i + 0.5) * CELL * S, z: (core.j + 0.5) * CELL * S };
// Watch it in sim time at a steady 1/60 s a frame (headless frames are
// slow; scaling time keeps the sim's dt honest), sampling the cost.
const watch = (secs) =>
  page.evaluate(
    (secs) =>
      new Promise((done) => {
        const t = window.__tubes;
        let peak = 0;
        let simAtPeak = 0;
        let worst = 0;
        const t0 = performance.now();
        const tick = () => {
          const p = t.siege.perf();
          if (p.alive > peak) {
            peak = p.alive;
            simAtPeak = p.sim;
          }
          worst = Math.max(worst, p.sim);
          if (performance.now() - t0 < secs * 1000) requestAnimationFrame(tick);
          else done({ peak, simAtPeak, worst, draw: p.draw, shards: p.shards, alive: p.alive });
        };
        requestAnimationFrame(tick);
      }),
    secs,
  );
await lookAt(corePos.x + 0.4, corePos.z + 2.6, 0.5, corePos.x, 0.0, corePos.z - 0.4);
await studio();
const p1 = await watch(4);
await page.screenshot({ path: 'shots/horde/01-the-tide.png' });
console.log('  · shots/horde/01-the-tide.png');
console.log(
  `  · peak ${p1.peak} alive — sim ${p1.simAtPeak.toFixed(2)} ms at the peak (worst ${p1.worst.toFixed(2)}), swarm upload ${p1.draw.toFixed(2)} ms, ${p1.shards} shards`,
);
// Into the guns: low, at the front line.
await lookAt(corePos.x - 0.9, corePos.z + 0.9, -0.95, corePos.x, 0.05, corePos.z - 0.2);
await page.waitForTimeout(2500);
await page.screenshot({ path: 'shots/horde/02-the-guns.png' });
console.log('  · shots/horde/02-the-guns.png');
await lookAt(corePos.x + 0.8, corePos.z - 0.9, -0.9, corePos.x - 0.2, 0.05, corePos.z + 0.1);
await page.waitForTimeout(2000);
await page.screenshot({ path: 'shots/horde/03-the-front.png' });
console.log('  · shots/horde/03-the-front.png');

const p2 = await watch(3);
console.log(`  · ${p2.alive} alive now, peak ${p2.peak} — sim worst ${p2.worst.toFixed(2)} ms`);
check(Math.max(p1.worst, p2.worst) < 6, `the sim keeps up with the tide (worst ${Math.max(p1.worst, p2.worst).toFixed(2)} ms a tick on this CPU)`);
// Let it play out.
await page.evaluate(() => window.__tubes.plant.timeScale(3));
await page
  .waitForFunction(() => window.__tubes.siege.state().phase !== 'wave', undefined, {
    timeout: 240000,
    polling: 500,
  })
  .catch(() => {});
await page.evaluate(() => window.__tubes.plant.timeScale(1));
st = await page.evaluate(() => window.__tubes.siege.state());
check(st.phase === 'build', `the ring HOLDS: ${st.kills} killed, core ${(st.core * 100).toFixed(0)}% (${st.phase})`);
check(st.coins > 2000, `and the tide paid its coins (${st.coins} in the purse)`);
await lookAt(corePos.x + 0.4, corePos.z + 2.0, 0.1, corePos.x, 0.0, corePos.z - 0.3);
await page.waitForTimeout(200);
await page.screenshot({ path: 'shots/horde/04-after.png' });
console.log('  · shots/horde/04-after.png');

await browser.close();
if (fails.length) {
  console.log(`\n${fails.length} FAILED:`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('\nTHE TIDE BREAKS.');
