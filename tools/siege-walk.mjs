#!/usr/bin/env node
/**
 * THE SIEGE — the fight, walked end to end, headlessly.
 *
 *   npm run dev
 *   node tools/siege-walk.mjs
 *
 * Everything goes through the hands' own doors (build.aimAt / trigger,
 * the haul, the pull's driven grips) — the same resolve-and-commit path a
 * controller runs — and the sim runs for real: real breaches on the
 * fallback room's walls, real flow field, real crawlers, real guns.
 *
 *   MAN THE WALLS   one door; the core stands; the first breach cracks
 *   THE GUN CHAIN   amber feed → maker → hauled rail → turret
 *   FIRST WATCH     the horn; five skitters; the gun holds the core
 *   THE WALL        walls cost gears; a hauled run is as long as the bank
 *   THE CHEW        a ring of plate gets chewed, not walked through
 *   THE FALL        an undefended core falls; TRY AGAIN deals a new floor
 */

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const CELL = 0.35; // plant metres — the tools speak the plant's units
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
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
page.on('pageerror', (e) => fails.push(`[pageerror] ${e.message}`));
await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(base));
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForTimeout(600);
await page.click('#enter-ar');
await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 15000 });
await page.waitForFunction(() => Boolean(window.__tubes?.site), { timeout: 10000 });
await page.waitForTimeout(400);
await page.evaluate(() => window.__tubes.wallsInfo.forceFallback());
await page.waitForFunction(() => window.__tubes.site.wallsReady, { timeout: 5000 });
mkdirSync('shots/siege', { recursive: true });

const siege = () => page.evaluate(() => window.__tubes.siege.state());
const plan = () => page.evaluate(() => window.__tubes.plant.plan());
const cellXZ = (i, j) => ({ x: (i + 0.5) * CELL, z: (j + 0.5) * CELL });
const arm = (tool) => page.evaluate((t) => window.__tubes.build.arm(t), tool);
const aim = (i, j, r = 0) =>
  page.evaluate(({ x, z, r }) => window.__tubes.build.aimAt(x, z, r), { ...cellXZ(i, j), r });
const pull = () => page.evaluate(() => window.__tubes.build.trigger());
async function handPlace(tool, i, j, r = 0) {
  await arm(tool);
  const view = await aim(i, j, r);
  const ok = await pull();
  await arm(null);
  return { view, ok };
}
async function haulRun(tool, from, to) {
  await arm(tool);
  await aim(from[0], from[1], 0);
  if (!(await pull())) {
    await arm(null);
    return { anchor: false, laid: 0, steps: [] };
  }
  const steps = await page.evaluate(({ x, z }) => window.__tubes.build.haulTo(x, z), cellXZ(to[0], to[1]));
  const laid = await page.evaluate(() => window.__tubes.build.haulRelease());
  await arm(null);
  return { anchor: true, laid, steps };
}
async function seatRun(side, unit) {
  const g = (await page.evaluate((s) => window.__tubes.plant.glands(s), side)).find((x) => x.unit === unit);
  if (!g) return false;
  await page.evaluate((s) => window.__tubes.plant.grab(s), side);
  const head = (await page.evaluate(() => window.__tubes.plant.state())).runs.find((r) => r.key === (side.includes(':') ? side : `${side}:0`)).head;
  const seat = { x: g.x + g.nx * 0.1, y: g.y, z: g.z + g.nz * 0.1 };
  for (let k = 1; k <= 6; k++) {
    await page.evaluate(
      ({ a, b, k }) =>
        window.__tubes.plant.dragTo(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k),
      { a: head, b: seat, k: k / 6 },
    );
    await page.waitForTimeout(160);
  }
  const ok = await page
    .waitForFunction(
      ({ s, u }) => {
        const r = window.__tubes.plant.state().runs.find((x) => x.key === (s.includes(':') ? s : `${s}:0`));
        return r && (r.phase === 'seated' || r.phase === 'flowing') && r.target === u;
      },
      { s: side, u: unit },
      { timeout: 10000 },
    )
    .then(() => true)
    .catch(() => false);
  await page.evaluate(() => window.__tubes.plant.release());
  return ok;
}

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
    // The emulator's panels live in shadow roots.
    for (const el of document.querySelectorAll('*')) if (el.shadowRoot) el.style.display = 'none';
  });
/** Park the camera at room (px, py + eye, pz) looking at room (tx, ty, tz). */
async function lookAt(px, pz, py, tx, ty, tz) {
  const yaw = Math.atan2(px - tx, pz - tz);
  const pitch = Math.atan2(ty - (1.6 + py), Math.hypot(px - tx, pz - tz));
  // The rig pitches about its FLOOR origin, which swings the 1.6 m eye
  // off where it was asked to be — so stand the rig where the eye lands
  // right: rig = eye − Ry(yaw)·Rx(pitch)·(0, 1.6, 0).
  const e = 1.6;
  const ox = e * Math.sin(pitch) * Math.sin(yaw);
  const oy = e * Math.cos(pitch);
  const oz = e * Math.sin(pitch) * Math.cos(yaw);
  await page.evaluate(({ x, z, yaw, y, pitch }) => window.__tubes.rig(x, z, yaw, y, pitch), {
    x: px - ox,
    z: pz - oz,
    yaw,
    y: 1.6 + py - oy,
    pitch,
  });
}
const shot = async (name) => {
  await page.waitForTimeout(220);
  await page.screenshot({ path: `shots/siege/${name}.png` });
  console.log(`  · shots/siege/${name}.png`);
};

/* ── MAN THE WALLS ───────────────────────────────────────────────────── */

console.log('MAN THE WALLS');
await page.evaluate(() => window.__tubes.menu.act('tab:factory'));
await page.waitForTimeout(200);
const offered = await page.evaluate(() => window.__tubes.menu.boardButtons());
{
  const { writeFileSync } = await import('node:fs');
  const url = await page.evaluate(() => window.__tubes.menu.snapBoard());
  writeFileSync('shots/siege/board.png', Buffer.from(url.split(',')[1], 'base64'));
  console.log('  · shots/siege/board.png');
}
check(offered.includes('start-order'), `the board offers one door (${offered.join(', ')})`);
await page.evaluate(() => window.__tubes.menu.act('start-order'));
await page.waitForFunction(() => window.__tubes.site.screen === 'factory', undefined, { timeout: 5000 });
await page.waitForTimeout(300);
let sg = await siege();
check(sg.phase === 'core' && sg.breaches.length === 0, `the siege opens waiting for its CORE, no clock, no breach (${sg.phase})`);
const cat0 = await page.evaluate(() => window.__tubes.build.catalogue().available);
check(cat0.length === 1 && cat0[0] === 'dock', `and the core is the only thing on offer (${cat0.join(', ')})`);
const coreAt = await handPlace('dock', 0, 0);
check(coreAt.ok, 'the CORE stands where you put it');
await page.waitForTimeout(200);
sg = await siege();
check(sg.phase === 'build' && sg.wave === 0, `and the siege begins: building for wave 1 (${sg.phase} ${sg.wave})`);
check(sg.breaches.length === 1, `one breach is already cracking (${sg.breaches.length})`);
check((sg.bank.gear ?? 0) === 5, `the bank opens with 5 GEAR (${sg.bank.gear})`);
let units = await plan();
const core = units.find((u) => u.type === 'dock');
check(Boolean(core), 'the CORE is on the plan');
const cat = await page.evaluate(() => window.__tubes.build.catalogue().available);
check(
  ['maker', 'belt', 'turret'].every((t) => cat.includes(t)) && !cat.includes('wall') && !cat.includes('dock'),
  `wave 1's catalogue: maker, rail, turret — no wall, no second core (${cat.join(', ')})`,
);
await studio();

/* ── THE GUN CHAIN ───────────────────────────────────────────────────── */

console.log('THE GUN CHAIN');
// The gun costs parts and fires for free: it goes between the breach and
// the core, and the factory's job is to rail GEARS into the CORE's bank.
const b0 = sg.breaches[0];
const cx = core.i;
const cz = core.j;
const gunAt = [cx + (b0.x > 0 ? 1 : -1), cz - 2];
const sideStep = b0.x > 0 ? -1 : 1;
const makerAt = [cx + sideStep * 3, cz];
let r = await handPlace('turret', gunAt[0], gunAt[1]);
check(r.ok, `a TURRET stands at ${gunAt} (cost: 3 GEAR)`);
sg = await siege();
check((sg.bank.gear ?? 0) === 2, `and the bank paid for it (${sg.bank.gear} left)`);
const railFrom = [makerAt[0] - sideStep, cz];
const railTo = [cx + sideStep, cz];
const hauled = await haulRun('belt', railFrom, railTo);
check(hauled.laid >= 1, `a rail run hauled ${railFrom} → ${railTo} (${hauled.laid + 1} pieces)`);
r = await handPlace('maker', makerAt[0], makerAt[1]);
check(r.ok, `a MAKER stands at ${makerAt}`);
units = await plan();
const maker = units.find((u) => u.type === 'maker');
const gun = units.find((u) => u.type === 'turret');
// Walk the chain: maker → … → core.
let at = maker;
let hops = 0;
while (at && at.feeds !== null && hops < 20) {
  at = units.find((u) => u.id === at.feeds);
  hops++;
}
check(at?.id === core.id, `the maker's chute runs down the lane into the CORE (${hops} hops)`);
check(await seatRun('far', maker.id), 'the amber feed is hauled into the maker');
await page.evaluate(() => window.__tubes.plant.timeScale(6));
const banked = await page
  .waitForFunction(() => (window.__tubes.siege.state().bank.gear ?? 0) >= 5, undefined, { timeout: 30000 })
  .then(() => true)
  .catch(() => false);
sg = await siege();
check(banked, `GEARS ride the rail into the core's bank (${sg.bank.gear} GEAR)`);
await page.evaluate(() => window.__tubes.plant.timeScale(1));
const idle = (await page.evaluate(() => window.__tubes.siege.turrets())).find((t) => t.id === gun.id);
check(idle && idle.fired > 5, `and the gun sits quiet with nothing to shoot (no magazine to fill)`);
await lookAt(0.2, 0.9, -0.5, 0.05, 0.4, -0.35);
await shot('01-the-chain');

/* ── FIRST WATCH ─────────────────────────────────────────────────────── */

console.log('FIRST WATCH');
await page.evaluate(() => window.__tubes.siege.horn());
sg = await siege();
check(
  sg.phase === 'wave' && sg.queued + sg.enemies === 5,
  `the horn: wave 1 is coming (${sg.enemies} out, ${sg.queued} queued)`,
);
await page.waitForTimeout(5200);
const b = sg.breaches[0];
// Look from behind the core, toward the breach (room metres = plant × 0.7).
{
  const S = 0.7;
  const bl = Math.hypot(b.x, b.z);
  const ux = b.x / bl;
  const uz = b.z / bl;
  await lookAt(-ux * 0.9 + uz * 0.5, -uz * 0.9 - ux * 0.5, 0.1, b.x * S * 0.5, 0.1, b.z * S * 0.5);
}
await shot('02-first-watch');
const fired = await page
  .waitForFunction(() => window.__tubes.siege.turrets().some((t) => t.type === 'turret' && t.fired < 1), undefined, { timeout: 30000 })
  .then(() => true)
  .catch(() => false);
check(fired, 'the turret opens up on its own — free rounds, no hands');
await page.evaluate(() => window.__tubes.plant.timeScale(3));
const cleared = await page
  .waitForFunction(() => window.__tubes.siege.state().wave === 1, undefined, { timeout: 90000 })
  .then(() => true)
  .catch(() => false);
await page.evaluate(() => window.__tubes.plant.timeScale(1));
sg = await siege();
check(cleared, `FIRST WATCH held (kills ${sg.kills}, core ${(sg.core * 100).toFixed(0)}%)`);
check(sg.kills === 5, `every skitter put down by the gun (${sg.kills})`);
check(sg.core > 0.6, `the core barely scratched (${(sg.core * 100).toFixed(0)}%)`);
check(sg.phase === 'build' && sg.breaches.length === 2, `wave 2's two breaches crack (${sg.breaches.length})`);

/* ── THE CARDS ───────────────────────────────────────────────────────── */

console.log('THE CARDS');
const savePng = async (name, dataUrl) => {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`shots/siege/${name}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`  · shots/siege/${name}.png`);
};
await page.evaluate(() => window.__tubes.menu.setPause(true));
for (const pg of ['build', 'goals', 'supply']) {
  await page.evaluate((p) => window.__tubes.menu.act(`card:${p}`), pg);
  await page.waitForTimeout(250);
  await savePng(`card-${pg}`, await page.evaluate(() => window.__tubes.menu.snapCard()));
  const rects = await page.evaluate(() => window.__tubes.menu.cardRects());
  const lay = await page.evaluate(() => window.__tubes.menu.cardLayout());
  const off = rects.filter((r) => r.x < 0 || r.y < 0 || r.x + r.w > lay.w || r.y + r.h > lay.h);
  check(off.length === 0, `card ${pg}: every control inside the card (${off.map((r) => r.id).join(',') || 'ok'})`);
}
const cardIds = await page.evaluate(() => window.__tubes.menu.cardButtons());
check(cardIds.includes('card:horn'), 'the card offers SOUND THE HORN while you build');
await page.evaluate(() => window.__tubes.menu.act('card:build'));
await page.evaluate(() => window.__tubes.menu.setPause(false));

/* ── THE WALL ────────────────────────────────────────────────────────── */

console.log('THE WALL');
const cat2 = await page.evaluate(() => window.__tubes.build.catalogue().available);
check(cat2.includes('wall'), 'clearing wave 1 unlocks the WALL');
const gearsBefore = (await siege()).bank.gear ?? 0;
const want = 10;
const wallRow = cz + 2;
const wr = await haulRun('wall', [cx - 4, wallRow], [cx - 4 + want, wallRow]);
const gearsAfter = (await siege()).bank.gear ?? 0;
const laidWalls = (await plan()).filter((u) => u.type === 'wall').length;
check(
  // (The maker is still banking GEARS while the wall goes down, so the
  // bank can only be held to "paid at least this much".)
  laidWalls === Math.min(gearsBefore, want + 1) && gearsAfter <= gearsBefore - laidWalls + 2,
  `a hauled wall is as long as the bank can pay for (${laidWalls} laid, ${gearsBefore} → ${gearsAfter} GEAR)`,
);
void wr;
await lookAt(0.1, 1.5, -0.4, 0.1, 0.3, 0.35);
await shot('03-the-wall');

/* ── THE CHEW ────────────────────────────────────────────────────────── */

console.log('THE CHEW');
// A full ring of plate round the core (tools stand it for free with a
// bank top-up), then a grub dropped at a breach: it must chew, not walk.
await page.evaluate(
  ({ cx, cz }) => {
    const p = window.__tubes;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        if (di === 0 && dj === 0) continue;
        p.build.removeAt(cx + di, cz + dj);
      }
    }
  },
  { cx, cz },
);
const ring = [];
for (let di = -1; di <= 1; di++) {
  for (let dj = -1; dj <= 1; dj++) if (di || dj) ring.push([cx + di, cz + dj]);
}
// A tools-only bank top-up: this is a test of the chew, not the economy.
const ringOk = await page.evaluate(
  ({ ring }) => {
    const p = window.__tubes;
    p.plant.grantBank({ gear: ring.length });
    return ring.filter(([i, j]) => p.build.placeAt(i, j, 'wall', 0)).length;
  },
  { ring },
);
check(ringOk === 8, `a closed ring of plate round the core (${ringOk}/8)`);
await page.evaluate(() => window.__tubes.siege.spawn('grub', 0));
await page.evaluate(() => window.__tubes.plant.timeScale(4));
const chewing = await page
  .waitForFunction(
    () => window.__tubes.siege.enemies().some((e) => e.kind === 'grub' && e.phase === 'bite'),
    undefined,
    { timeout: 40000 },
  )
  .then(() => true)
  .catch(() => false);
const coreNow = (await siege()).core;
check(chewing, 'the grub reaches the ring and CHEWS');
check(coreNow > 0.99, `and the core behind the plate is untouched (${(coreNow * 100).toFixed(0)}%)`);
await page.evaluate(() => window.__tubes.plant.timeScale(1));
const g = (await page.evaluate(() => window.__tubes.siege.enemies())).find((e) => e.kind === 'grub');
if (g) {
  await lookAt(g.x * 0.7 * 0.4 + 0.6, g.z * 0.7 * 0.4 + 0.9, -0.5, g.x * 0.7 * 0.6, 0.15, g.z * 0.7 * 0.6);
  await shot('04-the-chew');
}

/* ── THE ARSENAL ─────────────────────────────────────────────────────── */

console.log('THE ARSENAL');
// Every weapon stood round the core, each with a crawler in front of it.
// They cost parts and fire for free; the flamer and the coil fire only
// while their feed's tube is seated — the TWIN spouts mean the amber feed
// can run a maker and a flamer at once.
await page.evaluate(
  ({ cx, cz }) => {
    const p = window.__tubes;
    for (const u of p.plant.plan()) if (u.type === 'wall') p.build.removeAt(u.i, u.j);
    p.siege.wakeAll();
    p.plant.grantBank({ gear: 40, cell: 6, chip: 6, pump: 4 });
  },
  { cx, cz },
);
await page.waitForTimeout(300);
const arms = {
  piston: [cx, cz + 1, 2],
  flamer: [cx - 1, cz - 1, 0],
  tesla: [cx + 1, cz + 1, 2],
  mortar: [cx, cz + 3, 2],
};
const stood = await page.evaluate(
  ({ arms }) =>
    Object.fromEntries(
      Object.entries(arms).map(([t, [i, j, r]]) => [t, window.__tubes.build.placeAt(i, j, t, r)]),
    ),
  { arms },
);
check(Object.values(stood).every(Boolean), `four more weapons stand (${JSON.stringify(stood)})`);
units = await plan();
const unitOf = (t) => units.find((u) => u.type === t);
const runs0 = (await page.evaluate(() => window.__tubes.plant.state())).runs.map((r) => r.key);
check(runs0.includes('far:0') && runs0.includes('far:1'), `every feed pours from TWO spouts (${runs0.join(' ')})`);
const fuelled = async (t) =>
  (await page.evaluate(() => window.__tubes.siege.turrets())).find((w) => w.type === t)?.fuelled;
check(!(await fuelled('flamer')), 'an unplumbed flamer is dark');
check(await seatRun('far:1', unitOf('flamer').id), "the amber feed's TWIN spout is hauled into the flamer (the maker keeps its own)");
{
  const r0 = (await page.evaluate(() => window.__tubes.plant.state())).runs.find((r) => r.key === 'far:0');
  check(r0?.target === maker.id, `and the main amber spout is still in the maker (${r0?.target} = ${maker.id})`);
}
check(await seatRun('right', unitOf('tesla').id), 'the volt feed is hauled into the tesla coil');
await page.waitForTimeout(600);
check((await fuelled('flamer')) && (await fuelled('tesla')), 'both burners light their pilots');
const S = 0.7;
const cell = 0.35;
const cellAt = (i, j) => [(i + 0.5) * cell, (j + 0.5) * cell];
// A crawler in front of each weapon, inside its reach.
const targets = {
  piston: [cellAt(cx, cz + 1)[0], cellAt(cx, cz + 1)[1] + 0.38, 'brute'],
  flamer: [cellAt(cx - 1, cz - 1)[0], cellAt(cx - 1, cz - 1)[1] - 0.7, 'grub'],
  tesla: [cellAt(cx + 1, cz + 1)[0] + 0.4, cellAt(cx + 1, cz + 1)[1] + 0.9, 'skitter'],
  mortar: [cellAt(cx, cz + 3)[0] - 0.4, cellAt(cx, cz + 3)[1] + 1.9, 'brute'],
};
for (const [w, [x, z, kind]] of Object.entries(targets)) {
  await page.evaluate(({ kind, x, z }) => window.__tubes.siege.place(kind, x, z, Math.PI), { kind, x, z });
  // Second skitter for the coil to chain to.
  if (w === 'tesla') await page.evaluate(({ x, z }) => window.__tubes.siege.place('skitter', x + 0.3, z + 0.25, Math.PI), { x, z });
}
await page.evaluate(() => window.__tubes.siege.tough(8));
// Watch all four at once: each must fire at least once.
const heard = await page.evaluate(
  () =>
    new Promise((done) => {
      const seen = new Set();
      const t0 = performance.now();
      const look = () => {
        for (const t of window.__tubes.siege.turrets()) if (t.fired < 0.3) seen.add(t.type);
        if (seen.size >= 5 || performance.now() - t0 > 20000) return done([...seen]);
        requestAnimationFrame(look);
      };
      look();
    }),
);
for (const w of ['piston', 'flamer', 'tesla', 'mortar']) {
  check(heard.includes(w), `the ${w.toUpperCase()} fires on its own`);
}
// (The portraits of each weapon firing are tools/weapons-look.mjs.)

/* ── THE FALL ────────────────────────────────────────────────────────── */

console.log('THE FALL');
await page.evaluate(() => {
  const p = window.__tubes;
  for (const u of p.plant.plan()) if (u.type !== 'dock') p.build.removeAt(u.i, u.j);
  for (let k = 0; k < 4; k++) p.siege.spawn('brute', k);
  p.plant.timeScale(10);
});
const fell = await page
  .waitForFunction(() => window.__tubes.site.finale, undefined, { timeout: 120000 })
  .then(() => true)
  .catch(() => false);
check(fell, 'an undefended core FALLS, and the last card comes up');
await page.evaluate(() => window.__tubes.plant.timeScale(1));
const finaleButtons = await page.evaluate(() => window.__tubes.menu.finaleButtons());
check(
  finaleButtons.includes('fin:retry') && finaleButtons.includes('fin:board'),
  `it offers TRY AGAIN and the board (${finaleButtons.join(', ')})`,
);
await lookAt(0, 1.4, 0, 0, 1.2, -1);
await shot('05-fallen');
await page.evaluate(() => window.__tubes.menu.act('fin:retry'));
await page.waitForTimeout(400);
sg = await siege();
units = await plan();
check(
  sg.phase === 'core' && sg.wave === 0 && units.length === 0,
  `TRY AGAIN deals a bare floor waiting for its core (${sg.phase}, wave ${sg.wave + 1}, ${units.length} units)`,
);

await browser.close();
if (fails.length) {
  console.log(`\n${fails.length} FAILED:`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('\nTHE SIEGE HOLDS.');
