#!/usr/bin/env node
/**
 * THE CRAFT THEATRE, PHOTOGRAPHED — one machine per item, shot at the
 * moments that matter in its making.
 *
 *   npm run dev
 *   node tools/craft-look.mjs
 *
 * Every item is made in its own way now (factory/craft.ts): the gear is
 * struck, the cell drawn, the chip etched, the pump screwed, the lamp
 * kindled, the servo torqued. None of that can be asserted and all of it
 * can be seen, so this stands three makers on the fallback floor, seats
 * a line in each, feeds a combiner by hand through the whole tree, and
 * shoots each craft at a handful of progress marks from a three-quarter
 * view a metre off the bench. Outputs go to shots/craft/<item>-<p>.png.
 *
 * It also asserts the few things that CAN be: that the theatre is live
 * (phantom or port poses while a craft runs), that the ram and clamp
 * actually leave their rests, and that the draw budget still holds.
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

let browser;
try {
  browser = await chromium.launch();
} catch {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
}
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
page.on('pageerror', (e) => fails.push(`[pageerror] ${e.message}`));
await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(base));
await page.waitForTimeout(800);
await page.click('#enter-ar');
await page.waitForFunction(() => Boolean(window.__tubes?.site), { timeout: 15000 });
await page.evaluate(() => window.__tubes.wallsInfo.forceFallback());
await page.waitForFunction(() => window.__tubes.site.wallsReady, { timeout: 5000 });

const cellXZ = (i, j) => ({ x: (i + 0.5) * CELL, z: (j + 0.5) * CELL });
const crafts = () => page.evaluate(() => window.__tubes.plant.crafts());
const parts = () => page.evaluate(() => window.__tubes.plant.parts());
const place = (t, i, j, rot = 0) =>
  page.evaluate(({ t, i, j, rot }) => window.__tubes.build.placeAt(i, j, t, rot), { t, i, j, rot });

console.log('THE SHOP');
await page.evaluate(() => {
  window.__tubes.menu.act('tab:factory');
  window.__tubes.menu.act('start-order');
});
await page.waitForFunction(() => window.__tubes.site.screen === 'factory', undefined, { timeout: 5000 });
await page.evaluate(() => window.__tubes.plant.openAll());
await page.waitForTimeout(300);

// Three makers, one per line, each with its chute facing +X so the
// three-quarter camera sees the ram, the anvil and the slide to the
// chute in one frame; the combiner in the middle of the floor.
const MAKERS = { far: [0, -2], left: [-3, 0], right: [2, 0] };
const COMB = [0, 1];
for (const [i, j] of Object.values(MAKERS)) check(await place('maker', i, j, 1), `a maker stands at ${i},${j}`);
check(await place('combiner', COMB[0], COMB[1], 1), 'and the combiner in the middle');
await page.waitForTimeout(300);

/** Walk a feed's collar onto the maker nearest it. */
async function seat(side) {
  const target = (await page.evaluate((s) => window.__tubes.plant.glands(s), side))
    .filter((g) => g.type === 'maker' && !g.seated)
    .map((g) => ({ g, d: Math.hypot(g.x - cellXZ(...MAKERS[side]).x, g.z - cellXZ(...MAKERS[side]).z) }))
    .sort((a, b) => a.d - b.d)[0]?.g;
  if (!target) return check(false, `${side} has a maker to feed`);
  await page.evaluate((s) => window.__tubes.plant.grab(s), side);
  const head = (await page.evaluate(() => window.__tubes.plant.state())).runs.find((r) => r.side === side).head;
  const seatAt = { x: target.x + target.nx * 0.1, y: target.y, z: target.z + target.nz * 0.1 };
  for (let k = 1; k <= 8; k++) {
    await page.evaluate(
      ({ a, b, k }) => window.__tubes.plant.dragTo(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k),
      { a: head, b: seatAt, k: k / 8 },
    );
    await page.waitForTimeout(140);
  }
  try {
    await page.waitForFunction(
      ({ s, u }) => {
        const r = window.__tubes.plant.state().runs.find((x) => x.side === s);
        return r && r.target === u && (r.phase === 'seated' || r.phase === 'flowing');
      },
      { s: side, u: target.unit },
      { timeout: 8000 },
    );
    check(true, `${side} seats on the maker at ${MAKERS[side].join(',')}`);
  } catch {
    check(false, `${side} should seat on its maker`);
  }
  await page.evaluate(() => window.__tubes.plant.release());
  return target.unit;
}

const units = {};
for (const side of ['far', 'left', 'right']) units[side] = await seat(side);
const combId = (await page.evaluate(() => window.__tubes.plant.plan())).find((u) => u.type === 'combiner')?.id;

// Studio light for the shots only — passthrough supplies the real room —
// and the emulator's own panels out of the frame.
await page.evaluate(() => {
  const s = window.__tubes.scene();
  for (const o of s.children) {
    if (o.isHemisphereLight) o.intensity = 2.2;
    if (o.isDirectionalLight) o.intensity = 2.0;
  }
  // The emulator's panels: anything on the body that draws no canvas.
  for (const el of document.body.children) {
    if (el.tagName === 'SCRIPT' || el.tagName === 'CANVAS' || el.querySelector('canvas')) continue;
    el.style.display = 'none';
  }
});
mkdirSync('shots/craft', { recursive: true });

/** Park the camera a metre off a cell, three-quarter, looking down at
 *  the bench. three's camera looks down −Z at yaw 0; standing at
 *  bearing `a` from the machine and yawing BY `a` points it back. */
async function aimAt(i, j) {
  const c = cellXZ(i, j);
  const a = Math.atan2(0.62, 0.8);
  await page.evaluate(
    ({ x, z, yaw }) => window.__tubes.rig(x, z, yaw, -0.42, -0.42),
    { x: c.x + 0.62, z: c.z + 0.8, yaw: a },
  );
}

/** Empty a maker's chute onto the floor so it starts a fresh craft. */
async function drain(unitId) {
  for (let n = 0; n < 4; n++) {
    const on = (await parts()).filter((p) => p.kind === 'chute' && p.unit === unitId);
    if (on.length === 0) return;
    const plan = (await page.evaluate(() => window.__tubes.plant.plan())).find((u) => u.id === unitId);
    const c = cellXZ(plan.i, plan.j);
    const d = [[0, -1], [1, 0], [0, 1], [-1, 0]][plan.rot];
    const id = await page.evaluate(
      ({ x, z }) => window.__tubes.plant.take(x, 0.9, z),
      { x: c.x + d[0] * 0.2, z: c.z + d[1] * 0.2 },
    );
    if (id === null) return;
    const park = cellXZ(-4 + n, -4);
    await page.evaluate(({ x, z }) => window.__tubes.plant.drop(x, 0.9, z), park);
  }
}

const setScale = (s) => page.evaluate((v) => window.__tubes.plant.timeScale(v), s);

/** Shoot one machine's craft at the given progress marks: wait for a
 *  craft to (re)start, then catch each mark as the sim passes it. The
 *  craft runs at quarter speed and the sim all but stops for the
 *  exposure itself, so a shot lands within a hundredth of its mark. */
async function shootCraft(unitId, item, marks, cell) {
  await aimAt(...cell);
  await setScale(0.25);
  const started = await page
    .waitForFunction(
      (u) => {
        const c = window.__tubes.plant.crafts().find((x) => x.unit === u);
        return c && c.p >= 0 && c.p < 0.06;
      },
      unitId,
      { timeout: 40000 },
    )
    .then(() => true)
    .catch(() => false);
  check(started, `${item}: a craft starts on unit ${unitId}`);
  if (!started) return;
  let theatre = false;
  let moved = 0;
  for (const mark of marks) {
    const ok = await page
      .waitForFunction(
        ({ u, m }) => {
          const c = window.__tubes.plant.crafts().find((x) => x.unit === u);
          return c && c.p >= m;
        },
        { u: unitId, m: mark },
        { timeout: 40000, polling: 16 },
      )
      .then(() => true)
      .catch(() => false);
    await setScale(0.1);
    const c = (await crafts()).find((x) => x.unit === unitId);
    if (c && (c.phantom > 0 || c.portOn)) theatre = true;
    if (c) moved = Math.max(moved, Math.abs(c.lift));
    const name = `shots/craft/${item}-${String(Math.round(mark * 100)).padStart(2, '0')}.png`;
    // Clipped to the middle of the frame: the emulator's controller
    // panels sit in the bottom corners and refuse to be hidden.
    await page.screenshot({ path: name, clip: { x: 235, y: 90, width: 630, height: 640 } });
    await setScale(0.25);
    console.log(`  · ${name}${ok ? '' : ' (late)'}  p=${c?.p.toFixed(2)} lift=${c?.lift.toFixed(3)} item=${c?.item}`);
  }
  await setScale(1);
  check(theatre, `${item}: the theatre is live (a phantom or the port parts posed)`);
  check(moved > 0.03, `${item}: the ram/clamp leaves its rest (${moved.toFixed(3)} m)`);
}

console.log('THE MAKERS');
await drain(units.far);
await shootCraft(units.far, 'gear', [0.2, 0.305, 0.5, 0.62, 0.705, 0.8, 0.93], MAKERS.far);
await drain(units.left);
await shootCraft(units.left, 'cell', [0.3, 0.48, 0.63, 0.74, 0.8, 0.93], MAKERS.left);
await drain(units.right);
await shootCraft(units.right, 'chip', [0.2, 0.365, 0.6, 0.75, 0.805, 0.93], MAKERS.right);

/** A part of `item` from any chute, into the driven fist. */
async function grab(item) {
  for (let tries = 0; tries < 80; tries++) {
    const at = (await parts()).find((p) => p.item === item && p.kind === 'chute');
    if (at) {
      const plan = (await page.evaluate(() => window.__tubes.plant.plan())).find((u) => u.id === at.unit);
      const c = cellXZ(plan.i, plan.j);
      const d = [[0, -1], [1, 0], [0, 1], [-1, 0]][plan.rot];
      const id = await page.evaluate(
        ({ x, z }) => window.__tubes.plant.take(x, 0.9, z),
        { x: c.x + d[0] * 0.2, z: c.z + d[1] * 0.2 },
      );
      if (id !== null) return id;
    }
    await page.waitForTimeout(200);
  }
  return null;
}
/** …and into the combiner's nearest free port. */
async function feed(item) {
  const id = await grab(item);
  check(id !== null, `a ${item} comes off a chute`);
  if (id === null) return false;
  const c = cellXZ(...COMB);
  const ok = await page.evaluate(({ x, z }) => window.__tubes.plant.drop(x, 0.9, z), c);
  const where = (await parts()).find((p) => p.id === id);
  check(ok && where?.kind === 'port', `and drops into the combiner's port (${where?.kind})`);
  return ok;
}
/** Each fitting parks on its own cell, well away from the makers' drained
 *  stock, so the servo run picks up a PUMP and a LAMP and not whatever
 *  happened to be nearest. */
const PARK = { pump: [4, 3], lamp: [2, 3] };

/** Wait for the combiner's chute to hold `item`, take it, park it on the floor. */
async function collect(item) {
  const got = await page
    .waitForFunction(
      ({ u, it }) => window.__tubes.plant.parts().some((p) => p.item === it && p.kind === 'chute' && p.unit === u),
      { u: combId, it: item },
      { timeout: 30000 },
    )
    .then(() => true)
    .catch(() => false);
  check(got, `a ${item} lands on the combiner's chute`);
  if (!got) return;
  const id = await grab(item);
  const park = cellXZ(...PARK[item]);
  await page.evaluate(({ x, z }) => window.__tubes.plant.drop(x, 0.9, z), park);
  return id;
}
/** Bring a parked part back to the combiner. */
async function refeed(item) {
  const park = cellXZ(...PARK[item]);
  const loose = (await parts()).filter((p) => p.item === item && p.kind === 'loose');
  check(loose.length > 0, `a ${item} waits on the floor`);
  const id = await page.evaluate(({ x, z }) => window.__tubes.plant.take(x, 0.1, z), park);
  const got = (await parts()).find((p) => p.id === id);
  check(got?.item === item, `and the ${item} comes back up (${got?.item})`);
  const c = cellXZ(...COMB);
  const ok = await page.evaluate(({ x, z }) => window.__tubes.plant.drop(x, 0.9, z), c);
  check(ok, `into the combiner`);
}

console.log('THE COMBINER');
// PUMP: gear + cell.
if ((await feed('gear')) && (await feed('cell'))) {
  await shootCraft(combId, 'pump', [0.15, 0.4, 0.6, 0.79, 0.84, 0.94], COMB);
}
const pumpId = await collect('pump');
// LAMP: cell + chip.
if ((await feed('cell')) && (await feed('chip'))) {
  await shootCraft(combId, 'lamp', [0.2, 0.45, 0.56, 0.63, 0.78, 0.94], COMB);
}
await collect('lamp');
// SERVO: pump + lamp, both back off the floor.
if (pumpId !== undefined) {
  await refeed('pump');
  await refeed('lamp');
  await shootCraft(combId, 'servo', [0.2, 0.47, 0.6, 0.67, 0.74, 0.85, 0.94], COMB);
}

const info = await page.evaluate(() => window.__tubes.info());
check(info && info.calls < 420, `draw budget holds with the theatre running (${info?.calls} calls)`);

await browser.close();
if (fails.length) {
  console.error(`\n${fails.length} FAILED:\n  ${fails.join('\n  ')}`);
  process.exit(1);
}
console.log('\nLOOK AT IT: shots/craft/');
