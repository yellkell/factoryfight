#!/usr/bin/env node
/**
 * THE HANDS — FACTORY FIGHT played with bare hands, headlessly.
 *
 *   npm run dev
 *   node tools/hand-walk.mjs
 *
 * The emulator (IWER) is switched to HAND input and put under program
 * control, so every pose below is a real tracked hand: real joints, real
 * grip spaces, a real index tip. Nothing here calls a game verb directly
 * except where a hand genuinely cannot be emulated (IWER ships no fist
 * pose, so the fist DETECTOR is checked against joint data and the haul
 * holds its fists through the tools' override — positions stay real).
 *
 *   HANDS ARE INPUT   both sides read as hands; a pinch is a point
 *   THE FIST          open / pinch / point never grab; a fist does, and holds
 *   THE CUFF          turn the wrist and it rises; look away and it sinks
 *   THE POKE          the right index tip presses MENU, BACK, DOWN
 *   TWO FISTS         a tube hauled out of the feed into a maker
 */

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const S = 0.7; // room metres per plant metre
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
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForTimeout(500);
await page.click('#enter-ar');
await page.waitForFunction(() => Boolean(window.__tubes?.site), { timeout: 15000 });
await page.evaluate(() => {
  const d = window.IWER_DEVICE;
  d.controlMode = 'programmatic';
  d.primaryInputMode = 'hand';
  for (const el of document.querySelectorAll('*')) if (el.shadowRoot) el.style.display = 'none';
});
await page.waitForTimeout(400);
await page.evaluate(() => window.__tubes.wallsInfo.forceFallback());
await page.waitForFunction(() => window.__tubes.site.wallsReady, { timeout: 5000 });
mkdirSync('shots/hands', { recursive: true });

const hands = () => page.evaluate(() => window.__tubes.hands.state());
const cuff = () => page.evaluate(() => window.__tubes.hands.cuff());
const frames = (n = 6) => page.waitForTimeout(n * 40);
/** Pose a hand: room position, and a quaternion. */
const pose = (side, p, q = [0, 0, 0, 1]) =>
  page.evaluate(
    ({ side, p, q }) => {
      const h = window.IWER_DEVICE.hands[side];
      h.position.set(...p);
      h.quaternion.set(...q);
    },
    { side, p, q },
  );
const R = Math.SQRT1_2;
const WRIST_UP = [-R, 0, 0, R]; // left palm turned to the eyes
const LEFT_REST = [-0.25, 1.3, -0.35];
const RIGHT_REST = [0.25, 1.3, -0.35];

/* ── HANDS ARE INPUT ─────────────────────────────────────────────────── */

console.log('HANDS ARE INPUT');
let h = await hands();
check(h.handMode && h.left.mode === 'hand' && h.right.mode === 'hand', 'both sides read as tracked hands');
await page.evaluate(() => window.IWER_DEVICE.hands.right.updatePinchValue(1));
await frames();
h = await hands();
check(h.right.point && !h.right.grab, 'a right PINCH is a point (and not a grab)');
await page.evaluate(() => window.IWER_DEVICE.hands.right.updatePinchValue(0));
await frames();
h = await hands();
check(!h.right.point, 'and letting go lets go');
await page.evaluate(() => {
  window.IWER_DEVICE.hands.right.poseId = 'point';
});
await frames();
h = await hands();
check(!h.right.grab && !h.right.point, 'a POINT (index out, the rest curled) is neither');
await page.evaluate(() => {
  window.IWER_DEVICE.hands.right.poseId = 'default';
});

/* ── THE FIST ────────────────────────────────────────────────────────── */

console.log('THE FIST');
// Joint data built to shape: wrist at the origin, each finger's
// proximal knuckle 9 cm out, its tip either out (17 cm) or curled back.
const verdicts = await page.evaluate(async () => {
  const { isFist } = await import('/src/input/intents.ts');
  const hand = (curled) => {
    const m = new Float32Array(25 * 16);
    const put = (j, x, y, z) => {
      m[j * 16 + 12] = x;
      m[j * 16 + 13] = y;
      m[j * 16 + 14] = z;
    };
    put(0, 0, 0, 0);
    put(4, 0.05, 0, -0.08); // thumb tip
    [[6, 9], [11, 14], [16, 19], [21, 24]].forEach(([prox, tip], k) => {
      const x = (k - 1.5) * 0.02;
      put(prox, x, 0, -0.09);
      put(tip, x, curled[k] ? -0.03 : 0, curled[k] ? -0.06 : -0.17);
    });
    return m;
  };
  return {
    open: isFist(hand([0, 0, 0, 0]), false),
    point: isFist(hand([0, 1, 1, 1]), false),
    fist: isFist(hand([1, 1, 1, 1]), false),
    relaxing: isFist(hand([0, 1, 1, 0]), true),
    letGo: isFist(hand([0, 0, 0, 1]), true),
  };
});
check(!verdicts.open, 'an open hand is not a fist');
check(!verdicts.point, 'a point is not a fist');
check(verdicts.fist, 'four curled fingers ARE a fist');
check(verdicts.relaxing, 'a held fist that loosens to two fingers keeps its grip');
check(!verdicts.letGo, 'one finger left curled has let go');

/* ── THE PAGES ───────────────────────────────────────────────────────── */

console.log('THE PAGES');
const savePng = async (name, url) => {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`shots/hands/${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
  console.log(`  · shots/hands/${name}.png`);
};
await page.evaluate(() => window.__tubes.menu.act('tab:controls'));
await frames(4);
await savePng('board-controls', await page.evaluate(() => window.__tubes.menu.snapBoard()));
await page.evaluate(() => window.__tubes.menu.act('tab:factory'));
await frames(4);
const note = await page.evaluate(() => window.__tubes.menu.boardButtons());
void note;

/* ── THE LEFT HAND ───────────────────────────────────────────────────── */

console.log('THE LEFT HAND');
await page.evaluate(() => window.__tubes.startShop());
await page.waitForFunction(() => window.__tubes.site.screen === 'factory', undefined, { timeout: 5000 });
await pose('left', LEFT_REST);
await pose('right', RIGHT_REST);
await frames(8);
let c = await cuff();
check(!c.shown, `hands at rest: nothing on the left hand (facing ${c.facing.toFixed(2)})`);
const raiseLeft = () => pose('left', [-0.04, 1.42, -0.28], WRIST_UP);
await raiseLeft();
await frames(10);
c = await cuff();
check(c.shown, `open the left hand toward you and the menu RISES (facing ${c.facing.toFixed(2)})`);
let ids = c.studs.map((s) => s.id);
check(
  ids.includes('tool:dock') && ids.filter((i) => i.startsWith('tool:')).length === 1,
  `a bare floor: the toolbelt holds ONE tile, the CORE (${ids.join(', ')})`,
);
check(ids.includes('menu') && !ids.includes('horn'), 'and the watch offers PAUSE, no horn yet');
await page.screenshot({ path: 'shots/hands/core-first.png' });
console.log('  · shots/hands/core-first.png');

/** Drive the RIGHT hand so its real index tip lands on a face (or `off`
 *  metres out along the face's normal). */
async function tipTo(t, off = 0) {
  const want = [t.x + t.nx * off, t.y + t.ny * off, t.z + t.nz * off];
  // The tip hangs off the hand at a fixed offset: move the hand by the
  // miss, twice, and the tip lands where it was asked to.
  for (let pass = 0; pass < 2; pass++) {
    const tip = await page.evaluate(() => window.__tubes.hands.tip('right'));
    // (IWER's vectors keep x/y/z on the prototype — read them out by hand.)
    const hp = await page.evaluate(() => {
      const p = window.IWER_DEVICE.hands.right.position;
      return [p.x, p.y, p.z];
    });
    await pose('right', [hp[0] + want[0] - tip[0], hp[1] + want[1] - tip[1], hp[2] + want[2] - tip[2]]);
    await frames(4);
  }
}
/** Hover, press, lift — one honest poke. */
async function poke(t) {
  await tipTo(t, 0.05);
  await frames(4);
  await tipTo(t, 0.0);
  await frames(6);
  await tipTo(t, 0.06);
  await frames(4);
}
const stud = async (id) => (await cuff()).studs.find((s) => s.id === id);
const armed = () => page.evaluate(() => window.__tubes.build.armed());
check(Array.isArray(await page.evaluate(() => window.__tubes.hands.tip('right'))), 'the right index tip is tracked');

await poke(await stud('tool:dock'));
check((await armed()) === 'dock', 'POKE the CORE tile: the core is in your hand');
// Placing is the ray and a pinch; the walk aims through the same resolve.
await page.evaluate(() => {
  window.__tubes.build.aimAt(0.175, 0.175, 0);
  window.__tubes.build.trigger();
});
await frames(6);
const sgNow = await page.evaluate(() => window.__tubes.siege.state());
check(sgNow.phase === 'build', `the core lands and the siege begins (${sgNow.phase})`);
check((await armed()) === null, 'and the tool goes back down by itself — there is only one core');
await raiseLeft();
await frames(6);
ids = (await cuff()).studs.map((s) => s.id);
check(
  ['tool:maker', 'tool:belt', 'tool:turret', 'tool:delete'].every((t) => ids.includes(t)) && !ids.includes('tool:dock'),
  `now the belt holds the shop (${ids.filter((i) => i.startsWith('tool:')).join(', ')})`,
);
check(ids.includes('horn') && ids.includes('menu'), 'and the watch offers HORN and PAUSE');
await page.screenshot({ path: 'shots/hands/toolbelt.png' });
console.log('  · shots/hands/toolbelt.png');

// THE WHOLE ARSENAL ON THE PALM: late in the ladder every machine and
// every weapon is offered — all of them must still sit on the hand,
// within a finger's reach, and take a poke.
await page.evaluate(() => {
  window.__tubes.siege.wakeAll();
  window.__tubes.plant.grantBank({ gear: 60, cell: 30, chip: 10, pump: 10 });
  // Posts come with an upgrade off the core, not with a wave.
  window.__tubes.menu.act('buy:route-posts');
});
await frames(8);
const full = (await cuff()).studs.filter((s) => s.id.startsWith('tool:'));
const want = ['maker', 'belt', 'combiner', 'chest', 'post', 'wall', 'piston', 'flamer', 'turret', 'tesla', 'mortar', 'delete'];
check(
  want.every((t) => full.some((s) => s.id === `tool:${t}`)),
  `the full arsenal is on the palm: ${full.length} tiles (${full.map((s) => s.id.slice(5)).join(', ')})`,
);
{
  const cx = full.reduce((a, s) => a + s.x, 0) / full.length;
  const cy = full.reduce((a, s) => a + s.y, 0) / full.length;
  const cz = full.reduce((a, s) => a + s.z, 0) / full.length;
  const spread = Math.max(...full.map((s) => Math.hypot(s.x - cx, s.y - cy, s.z - cz)));
  check(spread < 0.14, `and it stays a palm's width (furthest tile ${(spread * 100).toFixed(1)} cm from the middle)`);
}
// (Held a little higher for the photograph, so all three rows are in it.)
await pose('left', [-0.04, 1.52, -0.3], WRIST_UP);
await frames(8);
await page.screenshot({ path: 'shots/hands/toolbelt-full.png' });
console.log('  · shots/hands/toolbelt-full.png');
await raiseLeft();
await frames(8);
await poke(await stud('tool:mortar'));
check((await armed()) === 'mortar', 'POKE the MORTAR tile: a mortar in your hand');
await poke(await stud('tool:mortar'));
check((await armed()) === null, 'and poke it again to put it down');

/* ── PAUSE, BY TOUCH ─────────────────────────────────────────────────── */

console.log('PAUSE, BY TOUCH');
await poke(await stud('menu'));
check(await page.evaluate(() => window.__tubes.site.paused), 'POKE PAUSE: the pause plate comes up');
const pauseIds = await page.evaluate(() => window.__tubes.menu.cardButtons());
check(
  pauseIds.includes('resume') && pauseIds.includes('quit') && !pauseIds.some((i) => i.startsWith('card:build')),
  `and it is just RESUME / HORN / QUIT — no tabs (${pauseIds.join(', ')})`,
);
await page.screenshot({ path: 'shots/hands/pause.png' });
console.log('  · shots/hands/pause.png');
const resume = await page.evaluate(() => window.__tubes.menu.buttonWorld('resume'));
check(Boolean(resume), 'RESUME stands within reach');
await poke(resume);
check(!(await page.evaluate(() => window.__tubes.site.paused)), 'POKE RESUME with a fingertip: back to it');

/* ── A TOOL IN HAND ──────────────────────────────────────────────────── */

console.log('A TOOL IN HAND');
await raiseLeft();
await frames(6);
await poke(await stud('tool:turret'));
check((await armed()) === 'turret', 'POKE the TURRET tile: a gun in your hand');
ids = (await cuff()).studs.map((s) => s.id);
check(['turn', 'stow', 'menu'].every((i) => ids.includes(i)), `the watch grows TURN and DOWN (${ids.filter((i) => !i.startsWith('tool:')).join(', ')})`);
await poke(await stud('stow'));
check((await armed()) === null, 'POKE DOWN: the tool is put away');
await poke(await stud('tool:maker'));
check((await armed()) === 'maker', 'pick the MAKER');
await poke(await stud('tool:maker'));
check((await armed()) === null, 'and poke the same tile again to put it down');

/* ── TOUCH THE CORE ──────────────────────────────────────────────────── */

console.log('TOUCH THE CORE');
await pose('left', LEFT_REST);
await page.evaluate(() => window.__tubes.plant.grantBank({ gear: 12, cell: 4 }));
const coreUnit = (await page.evaluate(() => window.__tubes.plant.plan())).find((u) => u.type === 'dock');
const corePt = { x: (coreUnit.i + 0.5) * 0.35 * S, y: 0.45, z: (coreUnit.j + 0.5) * 0.35 * S, nx: 0, ny: 1, nz: 0 };
await tipTo(corePt, 0.3);
await frames(4);
await tipTo(corePt, 0);
await frames(14);
check(
  (await page.evaluate(() => window.__tubes.menu.panelsUp())).includes('core'),
  'touch the core: its panel opens — the bank and the upgrades',
);
await page.screenshot({ path: 'shots/hands/core-panel.png' });
console.log('  · shots/hands/core-panel.png');
await tipTo(corePt, 0.35);
const buy = await page.evaluate(() => window.__tubes.menu.buttonWorld('buy:thick-plate'));
await poke(buy);
const owned = (await page.evaluate(() => window.__tubes.plant.state())).upgrades;
check(owned.includes('thick-plate'), `POKE THICK PLATE: bought off the core (${owned.join(', ')})`);
await poke(await page.evaluate(() => window.__tubes.menu.buttonWorld('box:close')));
check(!(await page.evaluate(() => window.__tubes.menu.panelsUp())).includes('core'), 'POKE CLOSE: the core panel goes');
await pose('right', RIGHT_REST);
await frames(4);

/* ── TWO FISTS ───────────────────────────────────────────────────────── */

console.log('TWO FISTS');
// A maker near the amber feed, the way a hand would stand it.
const core = (await page.evaluate(() => window.__tubes.plant.plan())).find((u) => u.type === 'dock');
const placed = await page.evaluate(
  ({ i, j }) => window.__tubes.build.placeAt(i, j, 'maker', 0),
  { i: core.i, j: core.j - 2 },
);
check(placed, 'a MAKER stands two cells toward the far feed');
const maker = (await page.evaluate(() => window.__tubes.plant.plan())).find((u) => u.type === 'maker');
const run0 = (await page.evaluate(() => window.__tubes.plant.state())).runs.find((r) => r.side === 'far');
const head = [run0.head.x * S, run0.head.y * S, run0.head.z * S];
// Both hands to the collar (a fist each side of it), and close them.
await pose('left', [head[0] - 0.06, head[1], head[2] + 0.02]);
await pose('right', [head[0] + 0.06, head[1], head[2] + 0.02]);
await frames(6);
await page.evaluate(() => {
  window.__tubes.hands.force('left', 'grab', true);
  window.__tubes.hands.force('right', 'grab', true);
});
await frames(6);
let run = (await page.evaluate(() => window.__tubes.plant.state())).runs.find((r) => r.side === 'far');
// Walk both fists to the maker's gland.
const g = (await page.evaluate(() => window.__tubes.plant.glands('far'))).find((x) => x.unit === maker.id);
const seat = [(g.x + g.nx * 0.1) * S, g.y * S, (g.z + g.nz * 0.1) * S];
for (let k = 1; k <= 10; k++) {
  const p = [head[0] + (seat[0] - head[0]) * (k / 10), head[1] + (seat[1] - head[1]) * (k / 10), head[2] + (seat[2] - head[2]) * (k / 10)];
  await pose('left', [p[0] - 0.06, p[1], p[2]]);
  await pose('right', [p[0] + 0.06, p[1], p[2]]);
  await frames(5);
}
const seated = await page
  .waitForFunction(
    (u) => {
      const r = window.__tubes.plant.state().runs.find((x) => x.side === 'far');
      return r && (r.phase === 'seated' || r.phase === 'flowing') && r.target === u;
    },
    maker.id,
    { timeout: 8000 },
  )
  .then(() => true)
  .catch(() => false);
run = (await page.evaluate(() => window.__tubes.plant.state())).runs.find((r) => r.side === 'far');
check(seated, `two FISTS haul the amber tube into the maker (${run.phase}, ext ${run.ext.toFixed(2)} m)`);
await page.evaluate(() => {
  window.__tubes.hands.force('left', 'grab', null);
  window.__tubes.hands.force('right', 'grab', null);
});

await browser.close();
if (fails.length) {
  console.log(`\n${fails.length} FAILED:`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('\nBARE HANDS HOLD.');
