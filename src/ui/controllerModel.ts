/**
 * THE REAL CONTROLLER — the Touch Plus models the SDK already fetches
 * for the hands, rendered once into a picture for the CONTROLS pages.
 *
 * The first cut of the controls diagram was hand-drawn line-art, and
 * the note back was the right one: "can't we use a real controller
 * diagram". We can — @iwsdk/xr-input loads its controller models from
 * the WebXR input-profiles CDN (meta-quest-touch-plus/{left,right}.glb,
 * the immersive-web working group's own assets), so the exact model
 * that draws in your hands mid-shift is the one that draws on the card.
 *
 * Better than a picture: the profile names the NODE for every control
 * (a_button_pressed_value, xr_standard_trigger_pressed_value, …), so
 * each callout's anchor is the button's own projected position, not a
 * guess. The view is derived from the model too — the handle axis from
 * the squeeze node to the face plate (stick, upper, lower define the
 * plate) is the picture's up; the camera stands on the plate's side of
 * that axis, raised ELEV above it — which is the same for both hands
 * and survives an asset update that moves things.
 *
 * Off-screen, once, on a private renderer that is thrown away when
 * both hands are in. Until they arrive (or if the CDN never answers —
 * the shop plays offline) the line-art in ui/controller.ts stands in.
 */

import {
  Box3,
  DirectionalLight,
  HemisphereLight,
  type Mesh,
  Object3D,
  OrthographicCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Control, Hand } from './controller.js';

const PROFILE =
  'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/meta-quest-touch-plus';

/** Pixel size of the rendered square. Drawn at 230 px on the board and
 *  160 on the card, so this is plenty and still cheap. */
const PX = 720;

/** The camera's elevation over the handle's horizon, radians. The view
 *  sits on the face plate's side of the handle, this far above square-
 *  on: high enough to read the buttons, low enough that the handle
 *  hangs down the picture instead of vanishing behind the plate. */
const ELEV = 0.42;

/** …and how far it swings round the handle toward the face buttons'
 *  side, radians. Square-on, the trigger hides under the plate's front
 *  lip and its callout landed on Ⓑ; from a little round the side the
 *  paddle shows below the plate, and the buttons are still the nearer
 *  half of the picture. */
const YAW = 0.55;

/** The profile's node for each control, per hand. The right controller
 *  exposes no menu node (its system button is not ours to read). */
function nodeName(hand: Hand, c: Control): string | null {
  switch (c) {
    case 'trigger':
      return 'xr_standard_trigger_pressed_value';
    case 'grip':
      return 'xr_standard_squeeze_pressed_value';
    case 'stick':
      return 'xr_standard_thumbstick_pressed_value';
    case 'upper':
      return hand === 'right' ? 'b_button_pressed_value' : 'y_button_pressed_value';
    case 'lower':
      return hand === 'right' ? 'a_button_pressed_value' : 'x_button_pressed_value';
    case 'menu':
      return hand === 'left' ? 'menu_pressed_value' : null;
  }
}

export interface ControllerImage {
  canvas: HTMLCanvasElement;
  /** Each control's centre in the unit square of `canvas`. */
  anchors: Partial<Record<Control, { x: number; y: number }>>;
}

const images: Record<Hand, ControllerImage | null> = { left: null, right: null };
const listeners: Array<() => void> = [];
let started = false;
let failed = false;

/** The rendered picture for a hand, or null while it is still on its
 *  way (the first call starts the fetch). */
export function controllerImage(hand: Hand): ControllerImage | null {
  if (!started) void start();
  return images[hand];
}

/** Be told when a picture lands, so a card painted with the line-art
 *  can repaint with the real thing. */
export function onControllerImage(cb: () => void): void {
  listeners.push(cb);
}

/** Headless hooks: is it in, and what does it look like. */
export const controllerModelView: {
  ready?: () => boolean;
  failed?: () => boolean;
  snap?: (hand: Hand) => string | null;
  anchors?: (hand: Hand) => ControllerImage['anchors'] | null;
} = {
  ready: () => Boolean(images.left && images.right),
  failed: () => failed,
  snap: (hand) => images[hand]?.canvas.toDataURL('image/png') ?? null,
  anchors: (hand) => images[hand]?.anchors ?? null,
};

async function start(): Promise<void> {
  started = true;
  let renderer: WebGLRenderer | null = null;
  try {
    const loader = new GLTFLoader();
    const [left, right] = await Promise.all([
      loader.loadAsync(`${PROFILE}/left.glb`),
      loader.loadAsync(`${PROFILE}/right.glb`),
    ]);
    renderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(PX, PX, false);
    renderer.setClearColor(0x000000, 0);
    images.left = shoot(renderer, 'left', left.scene);
    images.right = shoot(renderer, 'right', right.scene);
  } catch (err) {
    failed = true;
    console.warn('[tubes] controller models did not load; the drawing stands in', err);
  } finally {
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
  if (images.left && images.right) for (const cb of listeners) cb();
}

const _a = new Vector3();
const _b = new Vector3();
const _n = new Vector3();
const _t = new Vector3();
const _s = new Vector3();
const _up = new Vector3();
const _v = new Vector3();
const _p = new Vector3();

function shoot(renderer: WebGLRenderer, hand: Hand, model: Object3D): ControllerImage {
  const scene = new Scene();
  scene.add(model);
  model.updateMatrixWorld(true);

  // The parts we care about, in world space — the CENTRE OF THE PART,
  // not its pivot. The trigger's and squeeze's value nodes pivot deep
  // in the body (a hinge is where a hinge is), and a callout to the
  // hinge landed on the face plate. The part's own bounds land on the
  // part.
  const at = (c: Control): Vector3 | null => {
    const name = nodeName(hand, c);
    const node = name ? model.getObjectByName(name) : null;
    if (!node) return null;
    const b = new Box3().setFromObject(node);
    return b.isEmpty() ? node.getWorldPosition(new Vector3()) : b.getCenter(new Vector3());
  };
  const stick = at('stick');
  const upper = at('upper');
  const lower = at('lower');
  const box = new Box3().setFromObject(model);
  const centre = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3()).length();

  // Every vertex, in world space, once: the handle's end is the one
  // farthest from the plate, and the frame is fitted round all of them.
  const verts: Vector3[] = [];
  model.traverse((o) => {
    const mesh = o as Mesh;
    const pos = mesh.isMesh ? mesh.geometry.getAttribute('position') : null;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      verts.push(new Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
    }
  });

  // THE VIEW. The face plate's normal from its three controls, signed to
  // point out of the body. The handle axis — from the vertex farthest
  // from the plate, which is the butt of the grip, up to the plate — is
  // the picture's up. (Not the squeeze node: that sits on the handle
  // right under the plate, so plate-minus-squeeze points ACROSS the
  // controller, and the first cut of this looked up its skirt.) The
  // camera stands where the plate faces — the normal's component across
  // the handle — and climbs ELEV above that.
  const plate =
    stick && upper && lower
      ? new Vector3().copy(stick).add(upper).add(lower).multiplyScalar(1 / 3)
      : centre.clone();
  if (stick && upper && lower) {
    _a.subVectors(upper, stick);
    _b.subVectors(lower, stick);
    _n.crossVectors(_a, _b).normalize();
    _p.subVectors(stick, centre);
    if (_n.dot(_p) < 0) _n.negate();
  } else {
    _n.set(0, 1, 0);
  }
  let butt: Vector3 | null = null;
  let buttD = -1;
  for (const v of verts) {
    const d = v.distanceToSquared(plate);
    if (d > buttD) {
      buttD = d;
      butt = v;
    }
  }
  if (butt) _up.subVectors(plate, butt).normalize();
  else _up.set(0, 1, 0);
  _t.copy(_n).addScaledVector(_up, -_n.dot(_up));
  if (_t.lengthSq() < 1e-6) _t.set(0, 0, 1).addScaledVector(_up, -_up.z);
  _t.normalize();
  // Across the plate, from the stick toward the face buttons, squared
  // to the handle: the side the camera swings toward.
  if (stick && upper && lower) {
    _s.copy(upper).add(lower).multiplyScalar(0.5).sub(stick);
    _s.addScaledVector(_up, -_s.dot(_up)).normalize();
  } else {
    _s.crossVectors(_up, _t).normalize();
  }
  _v.copy(_t)
    .multiplyScalar(Math.cos(YAW))
    .addScaledVector(_s, Math.sin(YAW))
    .multiplyScalar(Math.cos(ELEV))
    .addScaledVector(_up, Math.sin(ELEV))
    .normalize();
  _up.addScaledVector(_v, -_up.dot(_v)).normalize();

  const cam = new OrthographicCamera(-1, 1, 1, -1, 0.001, 10);
  cam.position.copy(centre).addScaledVector(_v, size * 2);
  cam.up.copy(_up);
  cam.lookAt(centre);
  cam.updateMatrixWorld(true);

  // Frame: every vertex into view space, then a square round them. (The
  // bounding box's corners would do, but an oblique view of a box is a
  // good deal bigger than the thing inside it, and this is done once.)
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const v of verts) {
    _p.copy(v).applyMatrix4(cam.matrixWorldInverse);
    minX = Math.min(minX, _p.x);
    maxX = Math.max(maxX, _p.x);
    minY = Math.min(minY, _p.y);
    maxY = Math.max(maxY, _p.y);
  }
  const half = Math.max(maxX - minX, maxY - minY) * 0.53;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  cam.left = cx - half;
  cam.right = cx + half;
  cam.top = cy + half;
  cam.bottom = cy - half;
  cam.near = 0.001;
  cam.far = size * 6;
  cam.updateProjectionMatrix();

  // Light it like a product shot: a soft sky, one key from over the
  // shoulder of the camera, one rim from behind.
  scene.add(new HemisphereLight(0xffffff, 0x2a2420, 2.2));
  const key = new DirectionalLight(0xffffff, 1.6);
  key.position.copy(cam.position).addScaledVector(_up, size * 0.6).addScaledVector(_t, -size * 0.4);
  key.target.position.copy(centre);
  scene.add(key, key.target);
  const rim = new DirectionalLight(0xffb060, 0.8);
  rim.position.copy(centre).addScaledVector(_v, -size).addScaledVector(_up, -size * 0.5);
  rim.target.position.copy(centre);
  scene.add(rim, rim.target);

  renderer.render(scene, cam);

  const canvas = document.createElement('canvas');
  canvas.width = PX;
  canvas.height = PX;
  canvas.getContext('2d')!.drawImage(renderer.domElement, 0, 0);

  const anchors: ControllerImage['anchors'] = {};
  for (const c of ['trigger', 'grip', 'stick', 'upper', 'lower', 'menu'] as const) {
    const w = at(c);
    if (!w) continue;
    _p.copy(w).project(cam);
    anchors[c] = { x: (_p.x + 1) / 2, y: (1 - _p.y) / 2 };
  }
  // THE TRIGGER IS UNDER THE PLATE from any angle that reads the
  // buttons, so its centre projects onto the plate — next to Ⓑ, which
  // is where its callout used to land. Its anchor is the paddle's
  // highest point in the picture instead: where it peeks past the
  // plate's lip, and honestly "up there, at the front".
  const trig = model.getObjectByName(nodeName(hand, 'trigger') ?? '');
  if (trig) {
    let top: { x: number; y: number } | null = null;
    trig.traverse((o) => {
      const mesh = o as Mesh;
      const pos = mesh.isMesh ? mesh.geometry.getAttribute('position') : null;
      if (!pos) return;
      for (let i = 0; i < pos.count; i++) {
        _p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).project(cam);
        if (!top || _p.y > top.y) top = { x: _p.x, y: _p.y };
      }
    });
    if (top) {
      const t = top as { x: number; y: number };
      anchors.trigger = { x: (t.x + 1) / 2, y: (1 - t.y) / 2 };
    }
  }
  scene.remove(model);
  return { canvas, anchors };
}
