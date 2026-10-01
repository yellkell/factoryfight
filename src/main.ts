/**
 * TUBES — entry point.
 *
 * Boots an IWSDK World as a PASSTHROUGH AR (immersive-ar) session. Nothing
 * here draws a world, because the world is your room: the renderer runs
 * with an alpha backdrop over the headset's camera feed, the room scan
 * (WebXR plane detection) hands the game your real walls, and everything
 * TUBES adds — flanges, sockets, the tube in your hands, the board — is
 * bolted onto or carried through the space you actually live in.
 *
 * `npm run dev` and open the page: a headset offers PLAY; on desktop
 * the IWSDK dev plugin provides a WebXR emulator (WASD + mouse), where the
 * fallback room stands in for the scan (see room/walls.ts).
 */

import { launchXR, SessionMode, World } from '@iwsdk/core';
import { DirectionalLight, HemisphereLight } from 'three';
import { ensureAudio } from './audio/sfx.js';
import { musicView, primeMusic } from './audio/music.js';
import { BuildSystem, buildView } from './systems/BuildSystem.js';
import { FactorySystem, factoryView } from './systems/FactorySystem.js';
import { FloorSystem, floorView } from './systems/FloorSystem.js';
import { FlowSystem, flowView } from './systems/FlowSystem.js';
import { goopView } from './systems/GoopSystem.js';
import { SiegeSystem, siegeView } from './systems/SiegeSystem.js';
import { HandSystem, handsView } from './systems/HandSystem.js';
import { MenuSystem, menuView } from './systems/MenuSystem.js';
import { MusicSystem } from './systems/MusicSystem.js';
import { PlacementSystem, placeView } from './systems/PlacementSystem.js';
import { TubeSystem, tubeView } from './systems/TubeSystem.js';
import { WallSystem, wallsView } from './systems/WallSystem.js';
import { stageView } from './room/stage.js';
import { bakePictures, pictureUrls } from './ui/pictures.js';

const container = document.getElementById('scene-container') as HTMLDivElement;
const enterButton = document.getElementById('enter-ar') as HTMLButtonElement | null;

/** The created world, for the debug hook below (set once boot resolves). */
let worldRef: World | null = null;

enterButton?.setAttribute('disabled', '');

function hideLanding(): void {
  document.body.classList.add('app-entered');
}

function showLanding(): void {
  document.body.classList.remove('app-entered');
  enterButton?.removeAttribute('disabled');
}

World.create(container, {
  // The landing button calls IWSDK's explicit WebXR launcher from the
  // user's tap. Quest Browser needs that direct requestSession gesture path.
  xr: {
    sessionMode: SessionMode.ImmersiveAR,
    offer: 'none',
    features: {
      // The room scan. Optional, never required: a headset that refuses
      // (or an emulator that can't) still plays — the fallback room stands
      // in the moment the grace runs out.
      planeDetection: true,
      // BARE HANDS FIRST. Optional, so a controller-only headset still
      // plays — HandSystem reads whichever the headset gives it.
      handTracking: true,
      anchors: true,
      hitTest: true,
    },
  },
  // The tube is our own two-hand mechanic and the board raycasts its own
  // lasers — the stock grab/locomotion/UI stacks would only fight them.
  features: {
    sceneUnderstanding: true,
    grabbing: false,
    locomotion: false,
    spatialUI: false,
  },
  render: {
    // PASSTHROUGH IS THE BACKDROP. No dome, no background — a lit
    // environment would paint over the camera feed (the renderer runs
    // alpha in AR). Two plain lights below stand in for the room's own.
    defaultLighting: false,
    far: 60,
    camera: { position: [0, 1.65, 0] },
  },
}).then((world) => {
  worldRef = world;
  // THE STUDIO: every menu picture is photographed now, before the first
  // panel paints (ui/pictures.ts).
  bakePictures();

  // Hardware needs SOME light to read as metal. A soft sky/ground pair
  // plus one keyed directional approximates a ceiling fixture well enough
  // that PBR surfaces sit believably in most real rooms.
  const hemi = new HemisphereLight(0xfff4e2, 0x40382e, 1.05);
  const key = new DirectionalLight(0xffffff, 1.3);
  key.position.set(0.6, 2.4, 0.8);
  world.scene.add(hemi, key);

  // Order matters lightly: walls first (everything reads the registry),
  // then the shift's verbs in the order a run lives them, the payoff, and
  // the board last so it reads final state.
  world.registerSystem(HandSystem); // FIRST: every verb below reads its intents
  world.registerSystem(WallSystem);
  world.registerSystem(FloorSystem); // reads the registry; owns the tape
  world.registerSystem(BuildSystem); // after the tape claims a hand, before the flange
  world.registerSystem(FactorySystem); // the shift: feeds, runs, sim, parts
  world.registerSystem(SiegeSystem); // the fight: crawlers, guns, breaches, the core
  world.registerSystem(PlacementSystem);
  world.registerSystem(TubeSystem);
  world.registerSystem(FlowSystem);
  world.registerSystem(MenuSystem);
  world.registerSystem(MusicSystem); // last: it only reads where everything else got to

  const arSupported = navigator.xr
    ?.isSessionSupported(SessionMode.ImmersiveAR)
    .catch(() => false);

  Promise.resolve(arSupported).then((ok) => {
    if (!enterButton) return;
    if (ok !== true) {
      enterButton.textContent = 'XR unavailable';
      return;
    }
    enterButton.removeAttribute('disabled');
    enterButton.addEventListener('click', () => {
      enterButton.setAttribute('disabled', '');
      ensureAudio(); // unlock the AudioContext inside the tap gesture
      primeMusic(); // …and let the records start, for the same reason
      launchXR(world, { sessionMode: SessionMode.ImmersiveAR });

      const watchForSession = (): void => {
        if (world.session) {
          hideLanding();
          world.session.addEventListener('end', showLanding, { once: true });
          return;
        }
        if (!document.body.classList.contains('app-entered')) {
          requestAnimationFrame(watchForSession);
        }
      };
      requestAnimationFrame(watchForSession);
      window.setTimeout(() => {
        if (!world.session) enterButton.removeAttribute('disabled');
      }, 4000);
    });
  });

  // eslint-disable-next-line no-console
  console.info('[FACTORY FIGHT] World ready — something in the walls is listening.');
});

// Dev/debug hook: drive the whole shift from the console (or a headless
// tool) without controllers — e.g. __tubes.menu.act('start'),
// __tubes.place.mountAt(0, 0, 0), __tubes.tube.grab(), __tubes.tube.dragTo(...).
import { site } from './game/state.js';
import { abandonFactory, abandonShift, startJob, startShop } from './game/flow.js';
import { walls } from './systems/WallSystem.js';

declare global {
  interface Window {
    __tubes?: {
      site: typeof site;
      /** The wall registry, live — the room as the game sees it. */
      walls: typeof walls;
      wallsInfo: typeof wallsView;
      /** THE STAGE: the headset's room-scale box, and a stand-in for it. */
      stage: typeof stageView;
      startJob: typeof startJob;
      abandonShift: typeof abandonShift;
      /** The board + job card, drivable headlessly. */
      menu: typeof menuView;
      /** Flange placement: reticle state, and the headless mount. */
      place: typeof placeView;
      /** THE FLOOR: hazard tape adjust, drivable headlessly. */
      floor: typeof floorView;
      /** The lattice: stamp/remove units, read occupancy. */
      build: typeof buildView;
      /** The factory: orders, runs, parts, the sim — drivable headlessly. */
      plant: typeof factoryView;
      /** THE SIEGE: waves, crawlers, guns — drivable headlessly. */
      siege: typeof siegeView;
      /** THE PICTURES: every baked menu photograph, as data URLs. */
      pictures: typeof pictureUrls;
      /** THE HANDS: intents, the wrist cuff, the fist detector. */
      hands: typeof handsView;
      startShop: typeof startShop;
      abandonFactory: typeof abandonFactory;
      /** The tube: pull state, and the headless hands. */
      tube: typeof tubeView;
      /** The pour: fronts, energies, what's landed. */
      flow: typeof flowView;
      /** THE GOOP: the finale's own state (null until the vat is full). */
      goop: typeof goopView;
      /** THE RECORDS: which deck is up, and what is on it. */
      music: typeof musicView;
      /** Draw calls / triangles this frame — the budget check. */
      info: () => { calls: number; triangles: number } | null;
      /** Park the player rig at (x, z) facing `yaw` — headless walks.
       *  `pitch` tips the whole rig, which no player can do and every
       *  screenshot wants (a level camera at bench height sees the shop
       *  edge-on). Shot tools only. */
      rig: (x: number, z: number, yaw?: number, y?: number, pitch?: number) => void;
      /** The live scene graph — probes walk it by name. */
      scene: () => import('three').Scene | null;
    };
  }
}
window.__tubes = {
  site,
  walls,
  wallsInfo: wallsView,
  stage: stageView,
  startJob,
  abandonShift,
  menu: menuView,
  place: placeView,
  floor: floorView,
  build: buildView,
  plant: factoryView,
  siege: siegeView,
  hands: handsView,
  pictures: pictureUrls,
  startShop,
  abandonFactory,
  tube: tubeView,
  flow: flowView,
  goop: goopView,
  music: musicView,
  info: () => {
    const r = worldRef?.renderer;
    return r ? { calls: r.info.render.calls, triangles: r.info.render.triangles } : null;
  },
  rig: (x, z, yaw = 0, y = 0, pitch = 0) => {
    const w = worldRef;
    if (!w) return;
    w.player.position.set(x, y, z);
    w.player.rotation.set(0, yaw, 0);
    if (pitch) {
      // Yaw-then-pitch, applied to the rig itself: good enough for a
      // still, and nothing in play ever sets it.
      w.player.rotation.order = 'YXZ';
      w.player.rotation.set(pitch, yaw, 0);
    }
  },
  scene: () => worldRef?.scene ?? null,
};
