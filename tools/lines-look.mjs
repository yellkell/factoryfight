#!/usr/bin/env node
/**
 * THE LINES, WHERE THEY MEET — the clearance pass, the joints and the
 * rail hookups, on camera and under a rule.
 *
 *   npm run dev
 *   node tools/lines-look.mjs
 *
 * Three complaints from the headset, one tool to catch every one of
 * them coming back:
 *
 *   THE ROOM     HOT AND COLD's two long hauls cross mid-room. The
 *                seated pair must clear each other (the shared pass
 *                in tube/clearance.ts) — measured off the drawn curves,
 *                not eyeballed — and every seated run's last section
 *                must lie on its socket's axis whatever it dodged.
 *   THE SHOP     three feeds seated over a lane of plant, then a box
 *                landed under one of them: each gland's last section
 *                stays on the gland's axis through the re-solve, the
 *                drawn offset EASES to the new answer instead of
 *                popping, and the same clearances hold.
 *   THE RAILS    the maker's chute slide and both combiner port slides
 *                land ON the rails that stand there: shot close, and
 *                the slot a part waits on is at rail height.
 *
 * Shots go to shots/lines/. Exits non-zero if a rule breaks.
 */

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const CELL = 0.35;
const fails = [];
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) fails.push(what);
};
mkdirSync('shots/lines', { recursive: true });
const cellXZ = (i, j) => ({ x: (i + 0.5) * CELL, z: (j + 0.5) * CELL });

let browser;
try {
  browser = await chromium.launch();
} catch {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
}
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
page.on('pageerror', (e) => fails.push(`[pageerror] ${e.message}`));
// Every sheet open: the room half starts on HOT AND COLD.
await page.addInitScript(() => {
  try {
    localStorage.setItem('tubes-progress', JSON.stringify({ unlocked: 5, orders: 7 }));
  } catch {
    /* fine */
  }
});
await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(base));
await page.waitForTimeout(1000);
await page.click('#enter-ar');
await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 15000 });
await page.waitForFunction(() => Boolean(window.__tubes?.site), { timeout: 10000 });
await page.waitForTimeout(400);
await page.evaluate(() => window.__tubes.wallsInfo.forceFallback());
await page.waitForFunction(() => window.__tubes.site.wallsReady, { timeout: 5000 });

/** Studio light, and the emulator's own furniture out of the frame. */
const studio = () =>
  page.evaluate(() => {
    const s = window.__tubes.scene();
    const rig = s.children.find((o) => o.children.some((c) => c.isCamera));
    if (rig) {
      rig.traverse((c) => {
        if (c.isMesh || c.isLine) c.material.visible = false;
      });
    }
    for (const o of s.children) {
      if (o.isHemisphereLight) o.intensity = 2.2;
      if (o.isDirectionalLight) o.intensity = 2.0;
    }
    for (const el of document.body.children) {
      if (el.tagName === 'SCRIPT' || el.tagName === 'CANVAS' || el.querySelector('canvas')) continue;
      el.style.display = 'none';
    }
  });
/** Park the camera at (px, py + eye, pz) looking at (tx, ty, tz). */
async function lookAt(px, pz, py, tx, ty, tz) {
  const yaw = Math.atan2(px - tx, pz - tz);
  const pitch = Math.atan2(ty - (1.6 + py), Math.hypot(px - tx, pz - tz));
  await page.evaluate(
    ({ x, z, yaw, y, pitch }) => window.__tubes.rig(x, z, yaw, y, pitch),
    { x: px, z: pz, yaw, y: py, pitch },
  );
}
const shot = async (name) => {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `shots/lines/${name}.png` });
};

/** Closest approach between two sampled centrelines, ignoring the
 *  fitting corridors at both ends (the first and last fifth), which the
 *  pass leaves to the fittings on purpose. */
const closest = (a, b) => {
  let best = Infinity;
  const inner = (pts) => pts.slice(Math.floor(pts.length * 0.2), Math.ceil(pts.length * 0.8));
  for (const p of inner(a)) {
    for (const q of inner(b)) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
  }
  return best;
};
/** Degrees between a curve's last step and the axis it should land on.
 *  The bezier's own curvature over that last step is worth 2–3° on a
 *  steep run; the dodge's share is exactly zero, and 4 is the bar. */
const landing = (pts, n) => {
  const [a, b] = [pts[pts.length - 2], pts[pts.length - 1]];
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L = Math.hypot(...d) || 1;
  // The run ARRIVES against the socket's normal (which points out of it).
  const cos = -(d[0] * n.x + d[1] * n.y + d[2] * n.z) / L;
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
};

/* ── THE SHOP ────────────────────────────────────────────────────────────── */

console.log('THE SHOP');
await page.evaluate(() => {
  window.__tubes.menu.act('tab:factory');
  window.__tubes.menu.act('start-order');
});
await page.waitForFunction(() => window.__tubes.site.screen === 'factory', undefined, { timeout: 5000 });
await page.evaluate(() => window.__tubes.plant.openAll());
await page.waitForTimeout(300);
await studio();
const place = (t, i, j, rot = 0) =>
  page.evaluate(({ t, i, j, rot }) => window.__tubes.build.placeAt(i, j, t, rot), { t, i, j, rot });

// A combiner fed from both sides down two rail lanes, each off a maker,
// with its out lane running to the dock; a third maker for the last
// feed. The far/left/right lines then cross this whole lane of plant.
const stood = [
  await place('combiner', 1, -1, 2),
  await place('maker', -2, -1, 1),
  await place('belt', -1, -1, 1),
  await place('belt', 0, -1, 1),
  await place('maker', 4, -1, 3),
  await place('belt', 3, -1, 3),
  await place('belt', 2, -1, 3),
  await place('belt', 1, 0, 2),
  await place('belt', 1, 1, 2),
  await place('dock', 1, 2, 2),
  await place('maker', -3, 2, 1),
];
check(stood.every(Boolean), 'the lane stands: two makers into a combiner, its out lane to the dock');
await page.waitForTimeout(300);

// THE RAILS. The chute slide's foot and the rail it lands on.
let c = cellXZ(-2, -1);
await lookAt(c.x + 0.19, c.z + 0.75, -0.55, c.x + 0.19, 0.82, c.z);
await shot('rail-maker-chute');
await lookAt(c.x + 0.55, c.z + 0.55, -0.35, c.x + 0.19, 0.82, c.z);
await shot('rail-maker-chute-2');
c = cellXZ(1, -1);
await lookAt(c.x + 0.7, c.z + 0.8, -0.3, c.x, 0.85, c.z);
await shot('rail-combiner-ports');
await lookAt(c.x - 0.2, c.z + 0.75, -0.55, c.x - 0.19, 0.82, c.z);
await shot('rail-combiner-port-2');
// The slot a stamped part waits on is at RAIL height, not bench height:
// that is the whole hand-off.
const slotY = await page.evaluate(async () => {
  const { chuteY, chuteReach, CHUTE_SLIDE } = await import('/src/factory/sim.ts');
  return { slot0: chuteY(chuteReach(0)), slot1: chuteY(chuteReach(1)), foot: CHUTE_SLIDE.footY + CHUTE_SLIDE.seat };
});
check(
  Math.abs(slotY.slot0 - slotY.foot) < 1e-6 && slotY.slot1 > slotY.slot0 + 0.03,
  `the chute's first slot waits at the slide's foot, on the rail (${slotY.slot0.toFixed(3)} vs ${slotY.slot1.toFixed(3)} behind it)`,
);

/** Walk a feed's collar onto the maker nearest a cell. */
async function seat(side, cell) {
  const at = cellXZ(...cell);
  const g = (await page.evaluate((s) => window.__tubes.plant.glands(s), side))
    .filter((g) => g.type === 'maker' && !g.seated)
    .map((g) => ({ g, d: Math.hypot(g.x - at.x, g.z - at.z) }))
    .sort((a, b) => a.d - b.d)[0]?.g;
  if (!g) return check(false, `${side} has a free maker near ${cell.join(',')}`);
  await page.evaluate((s) => window.__tubes.plant.grab(s), side);
  const head = (await page.evaluate(() => window.__tubes.plant.state())).runs.find((r) => r.side === side).head;
  const seatAt = { x: g.x + g.nx * 0.1, y: g.y, z: g.z + g.nz * 0.1 };
  for (let k = 1; k <= 8; k++) {
    await page.evaluate(
      ({ a, b, k }) => window.__tubes.plant.dragTo(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k),
      { a: head, b: seatAt, k: k / 8 },
    );
    await page.waitForTimeout(140);
  }
  try {
    await page.waitForFunction(
      (s) => {
        const r = window.__tubes.plant.state().runs.find((x) => x.side === s);
        return r && (r.phase === 'seated' || r.phase === 'flowing');
      },
      side,
      { timeout: 8000 },
    );
    check(true, `${side} seats`);
  } catch {
    check(false, `${side} should seat`);
  }
  await page.evaluate(() => window.__tubes.plant.release());
}
await seat('far', [-2, -1]);
await seat('right', [-3, 2]);
await seat('left', [4, -1]);
await page.waitForTimeout(1500);

/** Every seated shop line: its curve, its gland normal, its offset. */
const shopLines = () =>
  page.evaluate(() => {
    const t = window.__tubes;
    const out = [];
    for (const r of t.plant.state().runs) {
      if (r.phase !== 'seated' && r.phase !== 'flowing') continue;
      const gland = t.plant.glands(r.side).find((g) => g.unit === r.target);
      out.push({ side: r.side, curve: t.plant.runCurve(r.side, 64), n: { x: gland.nx, y: gland.ny, z: gland.nz } });
    }
    return { lines: out, dodges: t.plant.dodges() };
  });
const shop = await shopLines();
check(shop.lines.length === 3, `three lines seated over the lane (${shop.lines.length})`);
for (const l of shop.lines) {
  const deg = landing(l.curve, l.n);
  check(deg < 4, `${l.side} lands on its gland's axis (${deg.toFixed(1)}°, offset ${(shop.dodges[l.side]?.[1] ?? 0).toFixed(2)} m up)`);
}
for (let i = 0; i < shop.lines.length; i++) {
  for (let j = i + 1; j < shop.lines.length; j++) {
    const d = closest(shop.lines[i].curve, shop.lines[j].curve);
    check(d > 0.22, `${shop.lines[i].side} and ${shop.lines[j].side} clear each other (${d.toFixed(2)} m)`);
  }
}
await lookAt(0.2, 2.6, 0.2, 0.2, 0.9, -0.3);
await shot('shop-lines');
await lookAt(-2.4, 1.6, 0.1, 0.2, 0.9, -0.3);
await shot('shop-lines-side');
const left = shop.lines.find((l) => l.side === 'left');
if (left) {
  const pts = left.curve;
  const [gx, gy, gz] = pts[pts.length - 1];
  const dx = pts[pts.length - 1][0] - pts[pts.length - 8][0];
  const dz = pts[pts.length - 1][2] - pts[pts.length - 8][2];
  const L = Math.hypot(dx, dz) || 1;
  await lookAt(gx - (dz / L) * 0.9 - (dx / L) * 0.3, gz + (dx / L) * 0.9 - (dz / L) * 0.3, -0.5, gx, gy, gz);
  await shot('shop-gland-flush');
  const mid = pts[Math.floor(pts.length / 2)];
  await lookAt(mid[0] + 0.6, mid[2] + 0.6, -0.2, mid[0], mid[1], mid[2]);
  await shot('shop-joint');
}

// THE RE-SOLVE: a box lands under a line. The drawn offset must EASE
// there — moving a frame later, settled a second later — and the line
// must still land square.
const before = await page.evaluate(() => window.__tubes.plant.runCurve('right', 64));
// Both chests land in one round trip, and the curve is read in the same
// one — then again a few frames on. A pop is there in full at the
// first read; an ease is still climbing at the second.
const landed = await page.evaluate(() => {
  const b = window.__tubes.build;
  const ok = b.placeAt(-1, 1, 'chest', 0) && b.placeAt(0, 0, 'chest', 0);
  return { ok, curve: window.__tubes.plant.runCurve('right', 64) };
});
check(landed.ok, 'two chests land under the right line');
await page.waitForTimeout(120);
const soon = await page.evaluate(() => window.__tubes.plant.runCurve('right', 64));
await page.waitForTimeout(1500);
const after = await shopLines();
const right = after.lines.find((l) => l.side === 'right');
const midBefore = before[32][1];
const midAtOnce = landed.curve[32][1];
const midSoon = soon[32][1];
const midAfter = right.curve[32][1];
check(
  midAfter > midBefore + 0.05,
  `the right line rose to clear the chests (${midBefore.toFixed(2)} → ${midAfter.toFixed(2)} m at mid-run)`,
);
check(
  midAtOnce < midAfter - 0.03 && midSoon > midAtOnce && midSoon < midAfter - 0.005,
  `…and EASED there rather than popping (${midAtOnce.toFixed(2)} m as they landed, ${midSoon.toFixed(2)} m a beat later)`,
);
check(landing(right.curve, right.n) < 4, `…still landing on its gland's axis (${landing(right.curve, right.n).toFixed(1)}°)`);
await lookAt(-2.4, 1.6, 0.1, 0.2, 0.9, -0.3);
await shot('shop-lines-redodged');
await page.evaluate(() => window.__tubes.abandonFactory());
await page.waitForTimeout(500);

/* ── THE ROOM ────────────────────────────────────────────────────────────── */

// (TUBES' ROOM section — two hauls across the wall jobs — is gone with
// the jobs: FACTORY FIGHT has no wall jobs to cross.)

await browser.close();
if (fails.length) {
  console.error(`\n${fails.length} FAILED:\n  ${fails.join('\n  ')}`);
  process.exit(1);
}
console.log('\nTHE LINES CLEAR, LAND SQUARE, AND THE RAILS MEET THEIR MACHINES. Look at shots/lines/.');
