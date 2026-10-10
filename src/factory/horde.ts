/**
 * THE HORDE — every crawler on the floor, as columns of numbers.
 *
 * A siege is thousands of the things, so they are not objects: each
 * field is one typed array and a crawler is an index into all of them.
 * The live ones are packed into [0, n). A death only MARKS (`dead`), and
 * `sweep()` packs the survivors down once a tick, so an index stays good
 * for the whole of a tick and every loop is a straight run over memory.
 * `uid` is what to hold across ticks: an index moves when the crawlers
 * behind it are swept, a uid never does.
 *
 * THE WAY. Nobody here knows the way to the core: the room does
 * (factory/field.ts), and a crawler's step is a lookup in it. `veer` is
 * its own small lean off the way, so ten thousand of them fan out into
 * a tide instead of filing down the same few streamlines.
 *
 * THE BUCKETS. A spatial hash over the floor (cell HASH_CELL plant m),
 * rebuilt once a tick, answers "who is near here" for splash, the
 * flamer's cone, the coil's next hop, the hammer's smash and a slug's
 * landing — without any of them walking all n.
 *
 * Deaths leave a record in `deaths` (x, z, kind, cause) for the renderer
 * to burst, splat and voice; the sim never draws.
 */

export const HORDE_CAP = 8192;
/** Spatial hash bucket edge (plant m) and table size (power of two). */
export const HASH_CELL = 0.2;
const TABLE = 16384;
/** Most deaths a single tick reports (a mortar into a carpet of them). */
export const DEATH_CAP = 2048;

export const PHASE_EMERGE = 0;
export const PHASE_WALK = 1;
/** In your fist: it goes where the hand goes and nothing else moves it. */
export const PHASE_HELD = 2;
/** Thrown: a ballistic arc until it hits the floor. */
export const PHASE_FLY = 3;
/** Landed and alive: dazed a moment, then back on its way. */
export const PHASE_RETURN = 4;
/** Up against a tower that stands in its way, and chewing it. */
export const PHASE_BITE = 5;

export class Horde {
  n = 0;
  nextUid = 1;
  readonly uid = new Uint32Array(HORDE_CAP);
  /** Index into HORDE_KINDS (config's ENEMIES, in order). */
  readonly kind = new Uint8Array(HORDE_CAP);
  readonly dead = new Uint8Array(HORDE_CAP);
  readonly x = new Float32Array(HORDE_CAP);
  readonly z = new Float32Array(HORDE_CAP);
  readonly hp = new Float32Array(HORDE_CAP);
  readonly maxHp = new Float32Array(HORDE_CAP);
  /** Damage already in the air at it (slugs that haven't landed): a gun
   *  doesn't waste a round on one that is as good as dead. */
  readonly pend = new Float32Array(HORDE_CAP);
  readonly heading = new Float32Array(HORDE_CAP);
  readonly phase = new Uint8Array(HORDE_CAP);
  readonly phaseT = new Float32Array(HORDE_CAP);
  /** Its pace, as a share of its kind's (a tide that all walked in step
   *  would read as one thing). */
  readonly pace = new Float32Array(HORDE_CAP);
  /** Its lean off the way (radians, −0.5..0.5 of SIEGE.veer). */
  readonly veer = new Float32Array(HORDE_CAP);
  readonly flash = new Float32Array(HORDE_CAP);
  /** Distance walked (the legs' cycle). */
  readonly stride = new Float32Array(HORDE_CAP);
  /** Knockback: velocity on the plan, and seconds of it left; then a
   *  stun. */
  readonly kvx = new Float32Array(HORDE_CAP);
  readonly kvz = new Float32Array(HORDE_CAP);
  readonly kT = new Float32Array(HORDE_CAP);
  readonly stunT = new Float32Array(HORDE_CAP);
  readonly burnT = new Float32Array(HORDE_CAP);
  readonly burnDps = new Float32Array(HORDE_CAP);
  /** How far it still has to go to the core, by the road (targeting:
   *  least = first). */
  readonly fd = new Float32Array(HORDE_CAP);
  /** Off the floor (held or thrown): height, and velocity (plant m, m/s).
   *  Climbing out of the plaster, vx/vz are the way it climbs. */
  readonly y = new Float32Array(HORDE_CAP);
  readonly vx = new Float32Array(HORDE_CAP);
  readonly vy = new Float32Array(HORDE_CAP);
  readonly vz = new Float32Array(HORDE_CAP);

  /** This tick's deaths: x, z, kind, cause (weapon index; −1 = none). */
  readonly deaths = new Float32Array(DEATH_CAP * 4);
  deathN = 0;

  readonly head = new Int32Array(TABLE);
  readonly next = new Int32Array(HORDE_CAP);

  clear(): void {
    this.n = 0;
    this.deathN = 0;
  }

  /** Add one (returns its index, or −1 at the cap). */
  add(kind: number, x: number, z: number, hp: number, heading: number): number {
    if (this.n >= HORDE_CAP) return -1;
    const i = this.n++;
    this.uid[i] = this.nextUid++;
    this.kind[i] = kind;
    this.dead[i] = 0;
    this.x[i] = x;
    this.z[i] = z;
    this.hp[i] = hp;
    this.maxHp[i] = hp;
    this.pend[i] = 0;
    this.heading[i] = heading;
    this.phase[i] = PHASE_EMERGE;
    this.phaseT[i] = 0;
    this.pace[i] = 0.85 + Math.random() * 0.3;
    this.veer[i] = Math.random() - 0.5;
    this.flash[i] = 0;
    this.stride[i] = Math.random() * 10;
    this.kvx[i] = 0;
    this.kvz[i] = 0;
    this.kT[i] = 0;
    this.stunT[i] = 0;
    this.burnT[i] = 0;
    this.burnDps[i] = 0;
    this.fd[i] = Infinity;
    this.y[i] = 0;
    this.vx[i] = 0;
    this.vy[i] = 0;
    this.vz[i] = 0;
    return i;
  }

  /** Mark one dead and log it for the renderer. */
  kill(i: number, cause: number): void {
    if (this.dead[i]) return;
    this.dead[i] = 1;
    if (this.deathN < DEATH_CAP) {
      const o = this.deathN++ * 4;
      this.deaths[o] = this.x[i];
      this.deaths[o + 1] = this.z[i];
      this.deaths[o + 2] = this.kind[i];
      this.deaths[o + 3] = cause;
    }
  }

  /** Pack the living down over the dead. Order is not kept (nothing
   *  depends on it), so each hole takes the last live crawler. */
  sweep(): void {
    let i = 0;
    while (i < this.n) {
      if (!this.dead[i]) {
        i++;
        continue;
      }
      const last = --this.n;
      if (i !== last) this.move(last, i);
    }
  }

  private move(from: number, to: number): void {
    this.uid[to] = this.uid[from];
    this.kind[to] = this.kind[from];
    this.dead[to] = this.dead[from];
    this.x[to] = this.x[from];
    this.z[to] = this.z[from];
    this.hp[to] = this.hp[from];
    this.maxHp[to] = this.maxHp[from];
    this.pend[to] = this.pend[from];
    this.heading[to] = this.heading[from];
    this.phase[to] = this.phase[from];
    this.phaseT[to] = this.phaseT[from];
    this.pace[to] = this.pace[from];
    this.veer[to] = this.veer[from];
    this.flash[to] = this.flash[from];
    this.stride[to] = this.stride[from];
    this.kvx[to] = this.kvx[from];
    this.kvz[to] = this.kvz[from];
    this.kT[to] = this.kT[from];
    this.stunT[to] = this.stunT[from];
    this.burnT[to] = this.burnT[from];
    this.burnDps[to] = this.burnDps[from];
    this.fd[to] = this.fd[from];
    this.y[to] = this.y[from];
    this.vx[to] = this.vx[from];
    this.vy[to] = this.vy[from];
    this.vz[to] = this.vz[from];
  }

  /** Where a uid lives now (−1 gone). `hint` is where it was last seen. */
  find(uid: number, hint = -1): number {
    if (hint >= 0 && hint < this.n && this.uid[hint] === uid && !this.dead[hint]) return hint;
    for (let i = 0; i < this.n; i++) if (this.uid[i] === uid && !this.dead[i]) return i;
    return -1;
  }

  /* ── the buckets ──────────────────────────────────────────────────── */

  rebucket(): void {
    this.head.fill(-1);
    for (let i = 0; i < this.n; i++) {
      if (this.dead[i]) continue;
      const h = bucketOf(Math.floor(this.x[i] / HASH_CELL), Math.floor(this.z[i] / HASH_CELL));
      this.next[i] = this.head[h];
      this.head[h] = i;
    }
  }

  /**
   * Every live crawler within `r` of (x, z) — calls `fn(i, d)` with its
   * distance. Return true from `fn` to stop early. (Hash collisions only
   * add candidates; each is distance-checked.)
   */
  near(x: number, z: number, r: number, fn: (i: number, d: number) => boolean | void): void {
    const ci0 = Math.floor((x - r) / HASH_CELL);
    const ci1 = Math.floor((x + r) / HASH_CELL);
    const cj0 = Math.floor((z - r) / HASH_CELL);
    const cj1 = Math.floor((z + r) / HASH_CELL);
    // Wider than the table can tell apart: walk everyone instead.
    if ((ci1 - ci0 + 1) * (cj1 - cj0 + 1) > this.n) {
      for (let i = 0; i < this.n; i++) {
        if (this.dead[i]) continue;
        const dx = this.x[i] - x;
        const dz = this.z[i] - z;
        const d2 = dx * dx + dz * dz;
        if (d2 <= r * r && fn(i, Math.sqrt(d2))) return;
      }
      return;
    }
    for (let cj = cj0; cj <= cj1; cj++) {
      for (let ci = ci0; ci <= ci1; ci++) {
        for (let i = this.head[bucketOf(ci, cj)]; i >= 0; i = this.next[i]) {
          if (this.dead[i]) continue;
          // A colliding bucket can hand back someone from elsewhere:
          // only take crawlers that really are in THIS cell.
          if (Math.floor(this.x[i] / HASH_CELL) !== ci || Math.floor(this.z[i] / HASH_CELL) !== cj) continue;
          const dx = this.x[i] - x;
          const dz = this.z[i] - z;
          const d2 = dx * dx + dz * dz;
          if (d2 <= r * r && fn(i, Math.sqrt(d2))) return;
        }
      }
    }
  }
}

function bucketOf(ci: number, cj: number): number {
  return (Math.imul(ci, 73856093) ^ Math.imul(cj, 19349663)) & (TABLE - 1);
}
