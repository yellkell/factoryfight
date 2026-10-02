/**
 * THE TAPE — hazard tape round the shop floor.
 *
 * SLUGFEST marked its boundary with prizefight ropes; a workshop marks
 * it the way workshops do: amber-and-black barricade tape strung post to
 * post at hip height, with a hairline deck mark under it. The stripes
 * are the game's own furnace amber — TUBES' one accent IS caution
 * livery, which is the kind of luck you take.
 *
 * The rig is furniture, not effects: opaque unlit bands (signage reads
 * flat), four bench-height corner posts, a deck line, grab rings that
 * only show in adjust mode, and a faint build lattice inside the tape.
 * Everything re-lays in place on `floorAdjust.dirty` — no geometry churn
 * for the bands and posts; only the deck/lattice lines rebuild, and only
 * while adjust mode has them visible.
 *
 * One live detail: a GRABBED side's stripes scroll — tape feeding off
 * the reel while you walk it out.
 */

import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  DoubleSide,
} from 'three';
import { FLOOR } from '../config.js';
import { CELL } from './grid.js';
import { FLOOR_SIDES, floorAdjust, floorLayout, sideHandle, type FloorSide } from './plan.js';

export type TapeMode = 'idle' | 'adjust';

export interface TapeRig {
  group: Group;
  /** Re-read floorLayout and stand everything where it now belongs. */
  relay(): void;
  setMode(mode: TapeMode): void;
  /** Breathing, the grabbed side's reel-feed, the handle swell. */
  tick(delta: number): void;
}

/** The stripes: one cycle of amber/black diagonals, drawn once. */
function stripeCanvas(): HTMLCanvasElement {
  const w = 128;
  const h = 48;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#ffa22e';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#171216';
  const period = w / 2; // two black bars per tile
  for (let x = -h; x < w + h; x += period) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + period / 2, 0);
    g.lineTo(x + period / 2 - h, h);
    g.lineTo(x - h, h);
    g.closePath();
    g.fill();
  }
  return canvas;
}

const _hp = { x: 0, y: 0, z: 0 };

export function buildTapeRig(): TapeRig {
  const group = new Group();
  group.visible = false;

  const canvas = stripeCanvas();
  const bandGeo = new PlaneGeometry(1, 1);

  const bands = {} as Record<FloorSide, { mesh: Mesh; mat: MeshBasicMaterial; tex: CanvasTexture }>;
  const handles = {} as Record<FloorSide, { mesh: Mesh; mat: MeshBasicMaterial }>;

  for (const side of FLOOR_SIDES) {
    const tex = new CanvasTexture(canvas);
    tex.wrapS = RepeatWrapping;
    tex.colorSpace = SRGBColorSpace;
    const mat = new MeshBasicMaterial({ map: tex, side: DoubleSide, toneMapped: false });
    const mesh = new Mesh(bandGeo, mat);
    // left/right tape runs along Z; near/far along X.
    mesh.rotation.y = side === 'left' || side === 'right' ? Math.PI / 2 : 0;
    group.add(mesh);
    bands[side] = { mesh, mat, tex };

    const hMat = new MeshBasicMaterial({
      color: 0xffa22e,
      transparent: true,
      opacity: 0.4,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const hMesh = new Mesh(new TorusGeometry(0.062, 0.013, 10, 26), hMat);
    // The ring wraps the tape: its axis runs the tape's own direction.
    hMesh.rotation.y = side === 'left' || side === 'right' ? 0 : Math.PI / 2;
    hMesh.visible = false;
    group.add(hMesh);
    handles[side] = { mesh: hMesh, mat: hMat };
  }

  // Corner posts, bench height — the shop's one datum, planted early.
  const postGeo = new CylinderGeometry(1, 1, 1, 12);
  const postMat = new MeshStandardMaterial({ color: 0x2b2622, roughness: 0.55, metalness: 0.75 });
  const tipMat = new MeshBasicMaterial({ color: 0xffa22e, toneMapped: false });
  const posts: Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const post = new Mesh(postGeo, postMat);
    post.scale.set(0.022, FLOOR.postHeight, 0.022);
    post.position.y = FLOOR.postHeight / 2;
    const tip = new Mesh(postGeo, tipMat);
    // Child of a scaled post: sizes are relative to the parent's scale.
    tip.scale.set(0.026 / 0.022, 0.05 / FLOOR.postHeight, 0.026 / 0.022);
    tip.position.y = 0.5 + 0.025 / FLOOR.postHeight;
    post.add(tip);
    group.add(post);
    posts.push(post);
  }

  // The deck line (always) and the build lattice (adjust only).
  const deckMat = new LineBasicMaterial({ color: 0xffa22e, transparent: true, opacity: 0.28 });
  const latticeMat = new LineBasicMaterial({ color: 0xffa22e, transparent: true, opacity: 0.09 });
  let deck: LineLoop | null = null;
  let lattice: LineSegments | null = null;

  let mode: TapeMode = 'idle';
  let clock = 0;

  function relayLines(): void {
    const l = floorLayout;
    if (deck) {
      deck.removeFromParent();
      deck.geometry.dispose();
    }
    const y = 0.012;
    deck = new LineLoop(
      new BufferGeometry().setFromPoints([
        new Vector3(l.left, y, l.far),
        new Vector3(l.right, y, l.far),
        new Vector3(l.right, y, l.near),
        new Vector3(l.left, y, l.near),
      ]),
      deckMat,
    );
    group.add(deck);

    if (lattice) {
      lattice.removeFromParent();
      lattice.geometry.dispose();
      lattice = null;
    }
    if (mode !== 'adjust') return;
    const pts: Vector3[] = [];
    const gy = 0.011;
    for (let i = Math.ceil(l.left / CELL); i * CELL <= l.right; i++) {
      pts.push(new Vector3(i * CELL, gy, l.far), new Vector3(i * CELL, gy, l.near));
    }
    for (let j = Math.ceil(l.far / CELL); j * CELL <= l.near; j++) {
      pts.push(new Vector3(l.left, gy, j * CELL), new Vector3(l.right, gy, j * CELL));
    }
    lattice = new LineSegments(new BufferGeometry().setFromPoints(pts), latticeMat);
    group.add(lattice);
  }

  function relay(): void {
    const l = floorLayout;
    for (const side of FLOOR_SIDES) {
      const b = bands[side];
      const along = side === 'left' || side === 'right' ? l.near - l.far : l.right - l.left;
      sideHandle(side, _hp);
      b.mesh.position.set(_hp.x, FLOOR.tapeHeight, _hp.z);
      b.mesh.scale.set(Math.max(0.01, along), FLOOR.tapeWidth, 1);
      b.tex.repeat.x = Math.max(1, along / FLOOR.stripePeriod);
      handles[side].mesh.position.set(_hp.x, _hp.y, _hp.z);
    }
    posts[0].position.set(l.left, FLOOR.postHeight / 2, l.far);
    posts[1].position.set(l.right, FLOOR.postHeight / 2, l.far);
    posts[2].position.set(l.right, FLOOR.postHeight / 2, l.near);
    posts[3].position.set(l.left, FLOOR.postHeight / 2, l.near);
    relayLines();
  }

  function setMode(next: TapeMode): void {
    if (mode === next) return;
    mode = next;
    for (const side of FLOOR_SIDES) handles[side].mesh.visible = next === 'adjust';
    relayLines();
  }

  function tick(delta: number): void {
    clock += delta;
    if (mode !== 'adjust') return;
    const breathe = 0.5 + 0.5 * Math.sin(clock * 3.1);
    for (const side of FLOOR_SIDES) {
      const held = floorAdjust.grabbed === side;
      const h = handles[side];
      h.mat.opacity = held ? 0.95 : 0.3 + 0.25 * breathe;
      h.mesh.scale.setScalar(held ? 1.3 : 1 + 0.06 * breathe);
      if (held) {
        // Tape feeding off the reel while the side walks.
        bands[side].tex.offset.x -= (delta * 0.55) / FLOOR.stripePeriod;
      }
    }
  }

  return { group, relay, setMode, tick };
}
