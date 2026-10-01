#!/usr/bin/env node
/** Render the production liquid materials and connection hardware at fixed
 * times. Run alongside job-walk/order-walk to inspect shader and FX changes.
 * PREVIEW_BASE defaults to the Vite dev server. Outputs go to shots/effects/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

let browser;
try {
  browser = await chromium.launch();
} catch {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
}
const page = await browser.newPage({ viewport: { width: 1200, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
mkdirSync('shots/effects', { recursive: true });
try {
  await page.goto(process.env.PREVIEW_BASE ?? 'http://localhost:5173', { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { LINES } = await import('/src/config.ts');
    const { buildSegment, buildSocket } = await import('/src/tube/build.ts');
    const { buildGland } = await import('/src/factory/units.ts');
    const { createVatLiquid } = await import('/src/materials/vat.ts');
    const { updateConnectionGuide } = await import('/src/tube/connection.ts');
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1200, 860);
    renderer.setPixelRatio(1);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x10151b);
    const camera = new THREE.PerspectiveCamera(38, 1200 / 860, 0.01, 50);
    camera.position.set(0.3, 2.6, 7);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xdaf0ff, 0x302216, 2));
    const key = new THREE.DirectionalLight(0xffffff, 3);
    key.position.set(1, 4, 4);
    scene.add(key);
    const pours = [];
    Object.values(LINES).forEach((line, index) => {
      const seg = buildSegment(line, 0);
      seg.shell.scale.set(0.115, 2.7, 0.115);
      seg.pour.scale.set(0.1, 2.7, 0.1);
      for (const mesh of [seg.shell, seg.pour]) {
        mesh.rotation.z = -Math.PI / 2;
        mesh.position.set(-0.75, 0.9 - index * 0.55, 0);
        scene.add(mesh);
      }
      seg.pour.visible = true;
      const u = seg.pourMat.uniforms;
      u.uS0.value = 0;
      u.uS1.value = 2.7;
      u.uEnergy.value = 1;
      pours.push(seg.pourMat);
    });
    const socket = buildSocket(LINES.coolant);
    socket.group.position.set(-1.25, -1.5, 0);
    scene.add(socket.group);
    const gland = buildGland();
    gland.group.position.set(-0.25, -1.5, 0);
    scene.add(gland.group);
    const liquid = createVatLiquid();
    // Production liquid uses a unit-radius mesh; preserve that local space.
    const vat = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 32), liquid.mat);
    vat.scale.set(0.5, 0.65, 0.5);
    vat.position.set(1.5, 0, 0);
    scene.add(vat);
    liquid.height.value = 0.65;
    liquid.activity.value = 1;
    window.effectsShot = (time, front, state) => {
      for (const mat of pours) {
        mat.uniforms.uTime.value = time;
        mat.uniforms.uFront.value = front;
      }
      liquid.time.value = time;
      for (const target of [socket, gland]) {
        updateConnectionGuide(target, time, state.proximity ?? 0, state.magnet ?? false,
          state.progress ?? 0, state.phase ?? 'pull', state.age ?? 0);
      }
      renderer.render(scene, camera);
      return { image: renderer.domElement.toDataURL('image/png'), calls: renderer.info.render.calls,
        guides: [socket, gland].map((t) => ({ visible: t.guide.visible, opacity: t.guideMat.opacity })) };
    };
    window.disposeEffects = () => renderer.dispose();
  });
  const cases = [
    ['approach', 1.2, 1.25, { proximity: 0.75 }],
    ['capture', 1.4, 1.6, { magnet: true, progress: 0.65 }],
    ['latch', 1.6, 2, { phase: 'seated', age: 0.15 }],
    ['flow', 2.1, 20, { phase: 'flowing', age: 1 }],
    ['flow-later', 2.6, 20, { phase: 'flowing', age: 1.5 }],
  ];
  const results = [];
  for (const [name, time, front, state] of cases) {
    const result = await page.evaluate(({ time, front, state }) => window.effectsShot(time, front, state),
      { time, front, state });
    writeFileSync(`shots/effects/${name}.png`, Buffer.from(result.image.split(',')[1], 'base64'));
    results.push(result);
    console.log(`${name}: ${result.calls} draws`);
  }
  if (results[3].guides.some((g) => g.visible || g.opacity !== 0)) errors.push('Connection rings did not settle');
  if (results[3].image === results[4].image) errors.push('Flow and vat surface did not animate');
  // Reconnecting must restore a guide hidden by the preceding arrival.
  const again = await page.evaluate(() => window.effectsShot(3, 0, { magnet: true, progress: 0 }));
  if (again.guides.some((g) => !g.visible)) errors.push('Connection guide did not reset');
  await page.evaluate(() => window.disposeEffects());
} finally {
  await browser.close();
}
if (errors.length) throw new Error(errors.join('\n'));
console.log('Liquid shaders compiled; effects animate and reset. Inspect shots/effects/.');
