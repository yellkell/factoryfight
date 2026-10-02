/**
 * THE PICTURES — every menu image is a photograph of the real thing.
 *
 * The catalogue used to carry line-art shop drawings; now, once at boot,
 * a small studio photographs every machine and every part — built by the
 * very same builders the floor uses, in their neon — and the menus draw
 * those photographs. Redesign a machine and its picture redesigns itself
 * on the next load.
 *
 * The studio is its own little renderer on its own canvas (never the XR
 * one, which belongs to the headset once a session starts), used once and
 * let go. Each subject is shot twice — on black and on white — and the
 * pair gives every pixel its true alpha, so neon glow comes out as light
 * that sits on any panel, not as a dark square with a picture in it.
 */

import {
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three';
import type { ItemId, UnitType } from '../config.js';
import { buildUnit, partKit, setBeltForm } from '../factory/units.js';
import { NEON, Trim } from '../factory/neon.js';

/** Everything with a picture: a machine, a tool, or a part. */
export type PictureId = UnitType | 'delete' | 'unplug' | ItemId;

const SIZE = 256;
const pictures = new Map<PictureId, HTMLCanvasElement>();

export function picture(id: PictureId): HTMLCanvasElement | undefined {
  return pictures.get(id);
}

/** Data URLs of every picture — the look tool saves them. */
export function pictureUrls(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, c] of pictures) out[id] = c.toDataURL('image/png');
  return out;
}

const MACHINES: UnitType[] = ['dock', 'maker', 'belt', 'combiner', 'chest', 'post', 'turret', 'wall', 'flamer', 'hammer', 'tesla', 'mortar'];
const PARTS: ItemId[] = ['gear', 'cell', 'chip', 'pump', 'lamp', 'servo'];

/** Take every photograph. Safe to call once; a failure leaves the menus
 *  without pictures rather than taking the game down. */
export function bakePictures(): void {
  if (pictures.size > 0) return;
  let renderer: WebGLRenderer | null = null;
  try {
    const canvas = document.createElement('canvas');
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
    renderer.outputColorSpace = SRGBColorSpace;
    const scene = new Scene();
    scene.add(new HemisphereLight(0xfff4e2, 0x40382e, 1.4));
    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(0.8, 2.4, 1.4);
    scene.add(key);
    const camera = new PerspectiveCamera(26, 1, 0.01, 20);

    const shoot = (id: PictureId, subject: Object3D, view = new Vector3(0.7, 0.5, 1), minY = -Infinity): void => {
      scene.add(subject);
      frame(camera, subject, view, minY);
      pictures.set(id, develop(renderer!, scene, camera));
      scene.remove(subject);
    };

    for (const type of MACHINES) {
      const refs = buildUnit(type);
      if (type === 'belt') setBeltForm(refs, 0, -1);
      // A photograph of a machine, not of its glow on the floor: the
      // floor ring makes the frame twice as wide as the thing in it.
      refs.group.traverse((o) => {
        const m = o as Mesh;
        if ((m.isMesh && m.geometry.type === 'RingGeometry') || o.name === 'pad-glow') o.visible = false;
      });
      // A machine's picture is a portrait of its WORKING BODY: the bench
      // leg under the old factory boxes only made them small in their own
      // picture. The towers and the core stand on the floor on their hex
      // pads, and are shot whole.
      const whole = !(type === 'maker' || type === 'combiner' || type === 'chest' || type === 'vat');
      shoot(
        type,
        refs.group,
        type === 'belt' ? new Vector3(0.9, 1.3, 0.5) : undefined,
        whole ? -Infinity : 0.42,
      );
    }
    for (const item of PARTS) {
      const g = new Group();
      for (const c of partKit(item)) {
        const m = new Mesh(c.geometry, c.material);
        m.applyMatrix4(c.local);
        g.add(m);
      }
      shoot(item, g, new Vector3(0.6, 0.8, 1));
    }
    // The two tools with no machine: REMOVE (a neon cross-out) and
    // UNPLUG (a collar pulled off its ring).
    const del = new Group();
    new Trim()
      .line(-0.1, 0.02, -0.1, 0.1, 0.22, 0.1, 0.012)
      .line(-0.1, 0.22, -0.1, 0.1, 0.02, 0.1, 0.012)
      .into(del, NEON.delete);
    shoot('delete', del, new Vector3(0, 0.2, 1));
    const plug = new Group();
    new Trim().hoop(-0.06, 0.1, 0, 0.06, 0.008).hoop(0.06, 0.1, 0, 0.05, 0.008).line(0.06, 0.1, 0, 0.16, 0.1, 0, 0.02).into(plug, NEON.maker);
    shoot('unplug', plug, new Vector3(0.3, 0.3, 1));
  } catch (e) {
    console.warn('[pictures] studio failed — menus go without pictures', e);
  } finally {
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
}

const _box = new Box3();
const _c = new Vector3();
const _s = new Vector3();

/** Stand the camera off along `view` so the subject fills the frame
 *  (everything below `minY` is left out of the framing — the leg). */
function frame(camera: PerspectiveCamera, subject: Object3D, view: Vector3, minY: number): void {
  subject.updateMatrixWorld(true);
  _box.makeEmpty();
  subject.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || !m.visible) return;
    m.geometry.computeBoundingBox();
    if (m.geometry.boundingBox) _box.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld));
  });
  _box.min.y = Math.max(_box.min.y, Math.min(minY, _box.max.y - 0.05));
  _box.getCenter(_c);
  _box.getSize(_s);
  const radius = _s.length() / 2;
  const dist = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 0.92;
  camera.position.copy(_c).addScaledVector(view.clone().normalize(), dist);
  camera.near = Math.max(0.005, dist - radius * 3);
  camera.far = dist + radius * 2;
  camera.updateProjectionMatrix();
  camera.lookAt(_c);
}

/** Two exposures, black then white; alpha is what the background showed
 *  through. Returns a transparent 2D canvas of the subject. */
function develop(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera): HTMLCanvasElement {
  const shot = (bg: number): Uint8ClampedArray => {
    renderer.setClearColor(bg, 1);
    renderer.render(scene, camera);
    const c = document.createElement('canvas');
    c.width = SIZE;
    c.height = SIZE;
    const g = c.getContext('2d')!;
    g.drawImage(renderer.domElement, 0, 0);
    return g.getImageData(0, 0, SIZE, SIZE).data;
  };
  const black = shot(0x000000);
  const white = shot(0xffffff);
  const out = document.createElement('canvas');
  out.width = SIZE;
  out.height = SIZE;
  const g = out.getContext('2d')!;
  const img = g.createImageData(SIZE, SIZE);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    // On white, the background adds (1 − α)·255 to every channel.
    const seen = (white[i] - black[i] + white[i + 1] - black[i + 1] + white[i + 2] - black[i + 2]) / 3;
    const a = Math.max(0, Math.min(255, 255 - seen));
    d[i + 3] = a;
    if (a > 0) {
      const k = 255 / a;
      d[i] = Math.min(255, black[i] * k);
      d[i + 1] = Math.min(255, black[i + 1] * k);
      d[i + 2] = Math.min(255, black[i + 2] * k);
    }
  }
  g.putImageData(img, 0, 0);
  return out;
}
