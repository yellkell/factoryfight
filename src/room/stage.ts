/**
 * THE STAGE — the headset's own room-scale box.
 *
 * A headset that has had its boundary drawn knows a rectangle of floor
 * it is happy for you to walk: WebXR hands it over as the `bounded-floor`
 * reference space's `boundsGeometry`. The game itself lives in
 * `local-floor` (you spawn at the origin facing −Z, and every wall,
 * flange and crate is measured from there), so this module asks the
 * session for the bounded space ON THE SIDE, reads its polygon once a
 * frame can pose the two spaces against each other, and folds the
 * corners into the game's frame as one axis-aligned box.
 *
 * That box is the room, for everything: the hazard tape deals itself
 * from it first (floor/plan.ts), and the wall registry becomes it —
 * four faces on its edges, the floor and the ceiling trimmed to it
 * (systems/WallSystem.ts) — so a job's flange and ports stand on the
 * boundary you already drew rather than on the scan's plaster beyond
 * it. No boundary — a stationary guardian, an emulator, a browser that
 * refuses the space — and `rect` settles to null, and the scan's walls
 * take their turn as before.
 *
 * THE POLYGON IS LATE. On Quest the bounded space answers at once but
 * its `boundsGeometry` is EMPTY for the first frames of a session and
 * fills in a moment later (Meta's forums are full of it). An empty
 * polygon is therefore "not yet", never "no": the reader keeps asking
 * for STAGE.patienceMs before it settles empty, and the space's `reset`
 * event — bounds redrawn mid-session — re-arms it. `why` says what the
 * headset actually said, for the board's SYSTEM tab.
 *
 * A rotated boundary (drawn off-axis to the heading you entered on) gets
 * the box AROUND it, same honest v0 caveat as an off-axis scan: the drag
 * and the snap are how it comes home.
 */

import { Matrix4, Vector3 } from 'three';

export interface StageRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const STAGE = {
  /** How long an empty polygon (or an unposed one) is "not yet" before
   *  it is "no". Quest fills the bounds within a few frames; a boundary
   *  that has not answered in this long is not going to. */
  patienceMs: 4000,
  /** A box thinner than this on either axis is a stationary guardian's
   *  token square, not a floor. */
  minSide: 0.6,
};

export const stage = {
  /** The bounded-floor question has been answered, one way or the other
   *  (a session with no answer yet is not settled — the floor waits). */
  settled: false,
  /** The room-scale box in world x/z, or null when the headset drew none. */
  rect: null as StageRect | null,
  /** What the headset said, in a phrase — the SYSTEM tab shows it. */
  why: 'no session',
};

/** Headless/dev hook (wired into __tubes in main.ts). */
export const stageView: {
  /** Stand in a box for the headset's (null lifts it) — the tools' way
   *  to walk the stage path on a desktop that has no boundary. */
  force?: (rect: StageRect | null) => void;
  state?: () => { settled: boolean; rect: StageRect | null; why: string };
} = {};

let forced: StageRect | null = null;
/** What the headset itself answered (null: nothing drawn) — restored
 *  when a forced box is lifted. */
let read: StageRect | null = null;
let seenSession: XRSession | null = null;
let boundedSpace: XRReferenceSpace | null = null;
let asked = false;
/** When the bounded space arrived (or was last reset) — the patience
 *  clock starts here. */
let armedAt = 0;
/** The last polygon size seen, for the diagnosis. */
let lastPoints = -1;

const _m = new Matrix4();
const _p = new Vector3();

stageView.force = (rect) => {
  forced = rect ? { ...rect } : null;
  if (forced) {
    stage.rect = { ...forced };
    stage.settled = true;
    stage.why = 'forced';
  } else {
    // Lifted: back to whatever the headset said (or is still saying).
    stage.rect = read ? { ...read } : null;
    stage.why = read ? boxWhy(read) : 'lifted';
  }
};
stageView.state = () => ({ settled: stage.settled, rect: stage.rect ? { ...stage.rect } : null, why: stage.why });

function boxWhy(r: StageRect): string {
  return `box ${(r.maxX - r.minX).toFixed(1)} × ${(r.maxZ - r.minZ).toFixed(1)} m`;
}

function settle(rect: StageRect | null, why: string): void {
  read = rect;
  stage.rect = rect ? { ...rect } : null;
  stage.settled = true;
  stage.why = why;
  // eslint-disable-next-line no-console
  console.info(`[TUBES] stage: ${why}`);
}

function resetForSession(session: XRSession | null): void {
  seenSession = session;
  boundedSpace = null;
  asked = false;
  armedAt = 0;
  lastPoints = -1;
  read = null;
  if (!forced) {
    stage.settled = false;
    stage.rect = null;
    stage.why = session ? 'asking' : 'no session';
  }
}

/**
 * Called once a frame by the walls. Asks the session for its bounded
 * space the first time it sees one, then reads the box the first frame
 * it can. Cheap after that — one branch.
 */
export function pollStage(
  session: XRSession | null,
  frame: XRFrame | undefined,
  refSpace: XRReferenceSpace | null,
): void {
  if (session !== seenSession) resetForSession(session);
  if (forced) return;
  if (!session) {
    // Nothing to ask: a page outside the headset settles empty so the
    // floor never waits on an answer that can't come.
    stage.settled = true;
    return;
  }
  if (stage.settled) return;

  if (!asked) {
    asked = true;
    const s = session;
    s.requestReferenceSpace('bounded-floor').then(
      (space) => {
        if (s !== seenSession) return;
        boundedSpace = space;
        armedAt = performance.now();
        // Bounds redrawn mid-session (the player re-did the boundary,
        // the runtime recentred): ask again from the top.
        space.addEventListener('reset', () => {
          if (s !== seenSession) return;
          armedAt = performance.now();
          lastPoints = -1;
          stage.settled = false;
          stage.why = 'asking again';
        });
      },
      () => {
        // The space is refused outright: no boundary to stand on.
        if (s !== seenSession) return;
        settle(null, 'bounded floor refused');
      },
    );
    return;
  }
  if (!boundedSpace) return;

  const geom = (boundedSpace as Partial<XRBoundedReferenceSpace>).boundsGeometry;
  if (geom === undefined) {
    // Not a bounded space at all (the emulator's stand-in): the walls
    // take their turn.
    settle(null, 'no bounds on this runtime');
    return;
  }
  const waited = performance.now() - armedAt;
  lastPoints = geom.length;
  if (geom.length < 3) {
    // Empty is "not yet" on Quest — the polygon fills in a few frames
    // after the space arrives. Only patience running out makes it "no".
    if (waited > STAGE.patienceMs) settle(null, `no boundary drawn (${lastPoints} points)`);
    return;
  }
  if (!frame || !refSpace) return;

  let pose: XRPose | null | undefined;
  try {
    pose = frame.getPose(boundedSpace, refSpace);
  } catch {
    pose = null;
  }
  if (!pose) {
    if (waited > STAGE.patienceMs) settle(null, `boundary could not be posed (${lastPoints} points)`);
    return;
  }

  _m.fromArray(pose.transform.matrix);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const c of geom) {
    _p.set(c.x, c.y, c.z).applyMatrix4(_m);
    minX = Math.min(minX, _p.x);
    maxX = Math.max(maxX, _p.x);
    minZ = Math.min(minZ, _p.z);
    maxZ = Math.max(maxZ, _p.z);
  }
  const finite = [minX, maxX, minZ, maxZ].every(Number.isFinite);
  if (!finite) {
    settle(null, 'boundary corners unreadable');
    return;
  }
  if (maxX - minX < STAGE.minSide || maxZ - minZ < STAGE.minSide) {
    settle(null, `boundary too small (${(maxX - minX).toFixed(1)} × ${(maxZ - minZ).toFixed(1)} m, ${lastPoints} points)`);
    return;
  }
  const rect = { minX, maxX, minZ, maxZ };
  settle(rect, `${boxWhy(rect)}, ${lastPoints} points`);
}
