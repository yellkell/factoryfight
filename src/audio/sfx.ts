/**
 * Tiny WebAudio sound kit — every sound is synthesised at runtime (no asset
 * files to ship or load), tuned to the shop's palette: struck cast iron,
 * ratchet pawls, steam off hot metal, transformer hum, and the three
 * voices of the lines themselves. The core building blocks carry over
 * from RAVE RAID — `tone` (a glided oscillator), `whooshNoise` (bandpassed
 * noise) and `clank` (an inharmonic partial stack with a noisy attack,
 * metal on metal) — because struck plate steel was already the right
 * instrument; TUBES just plays it slower and lets it ring.
 *
 * The AudioContext can only start inside a user gesture, so we unlock it on
 * the first DOM interaction; after that, sounds triggered from the frame
 * loop play fine.
 */

// Two gain stages: the synth SFX sit under `_master` (0.3, the quiet mix
// bus); `_sfxOut` sits ABOVE it as the user's master SFX-volume fader. One
// knob scales EVERY sound while keeping the relative balance.
//
// MUSIC RUNS BESIDE THEM, not through them: `_musicOut` is its own fader
// straight to the destination. Two reasons, both practical. The records
// are already mastered, so pushing them through the SFX glue compressor
// would only pump them against the ratchet clicks; and a player who turns
// the shop down to hear the music (or the other way round) is asking for
// two knobs, not one.
type Ctx = AudioContext & { _master?: GainNode; _sfxOut?: GainNode; _musicOut?: GainNode };

const SFX_VOL_KEY = 'ffight-sfx-vol';
const MUSIC_VOL_KEY = 'ffight-music-vol';

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function storedVol(key: string, fallback: number): number {
  try {
    const n = parseFloat(localStorage.getItem(key) ?? '');
    return Number.isFinite(n) ? clamp01(n) : fallback;
  } catch {
    return fallback;
  }
}

let sfxVol = storedVol(SFX_VOL_KEY, 1);
// Music sits under the shop by default: this is a game about listening to
// machinery, and the records are the room it happens in.
let musicVol = storedVol(MUSIC_VOL_KEY, 0.55);

let ctx: Ctx | null = null;

function getCtx(): Ctx | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC() as Ctx;
    // User master fader → speakers.
    const sfxOut = ctx.createGain();
    sfxOut.gain.value = sfxVol;
    sfxOut.connect(ctx.destination);
    ctx._sfxOut = sfxOut;
    // A gentle glue compressor between the synth mix and the fader: a
    // shift's worth of hand-tuned one-shots will never sit at exactly one
    // loudness, so the bus evens the spread — the big seats lose a little
    // spike, the ratchet ticks keep their place, and the SFX slider scales
    // ONE coherent level. Soft knee, low ratio: glue, not pumping.
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -24;
    glue.knee.value = 14;
    glue.ratio.value = 3;
    glue.attack.value = 0.004;
    glue.release.value = 0.18;
    glue.connect(sfxOut);
    // Quiet synth mix bus → the glue → the fader.
    const master = ctx.createGain();
    master.gain.value = 0.3;
    master.connect(glue);
    ctx._master = master;
  }
  return ctx;
}

/** The user master SFX bus. */
export function sfxOut(): GainNode | null {
  return getCtx()?._sfxOut ?? null;
}

/** The AudioContext itself — the jukebox needs it to make a
 *  MediaElementSource out of each streaming <audio> element. */
export function audioContext(): AudioContext | null {
  return getCtx();
}

/** THE MUSIC BUS: the records' own fader, straight to the speakers. */
export function musicOut(): GainNode | null {
  const c = getCtx();
  if (!c) return null;
  if (!c._musicOut) {
    const out = c.createGain();
    out.gain.value = musicVol;
    out.connect(c.destination);
    c._musicOut = out;
  }
  return c._musicOut;
}

export function musicVolume(): number {
  return musicVol;
}

/** Set + persist the music volume; live-updates the running bus. */
export function setMusicVolume(v: number): void {
  musicVol = clamp01(v);
  try {
    localStorage.setItem(MUSIC_VOL_KEY, musicVol.toFixed(3));
  } catch {
    /* private mode — the choice just won't persist */
  }
  if (ctx?._musicOut) ctx._musicOut.gain.value = musicVol;
}

/** Current master SFX volume, 0..1 (1 = full). */
export function sfxVolume(): number {
  return sfxVol;
}

/** Set + persist the master SFX volume; live-updates the running bus. */
export function setSfxVolume(v: number): void {
  sfxVol = clamp01(v);
  try {
    localStorage.setItem(SFX_VOL_KEY, sfxVol.toFixed(3));
  } catch {
    /* private mode — the choice just won't persist */
  }
  if (ctx?._sfxOut) ctx._sfxOut.gain.value = sfxVol;
}

function unlock(): void {
  const c = getCtx();
  if (c && c.state === 'suspended') void c.resume();
}

if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'click', 'keydown', 'touchstart']) {
    window.addEventListener(ev, unlock, { capture: true });
  }
}

/** Call from a user gesture (e.g. PLAY) to make sure audio is live. */
export function ensureAudio(): void {
  unlock();
}

function ready(): Ctx | null {
  const c = getCtx();
  if (!c) return null;
  if (c.state === 'suspended') void c.resume();
  return c.state === 'running' ? c : null;
}

/* ── the instruments ────────────────────────────────────────────────────── */

interface ToneOpts {
  freq: number;
  to?: number; // glide target
  type?: OscillatorType;
  dur?: number;
  gain?: number;
  delay?: number;
}

function tone(o: ToneOpts): void {
  const c = ready();
  if (!c) return;
  const { freq, to, type = 'sine', dur = 0.12, gain = 0.2, delay = 0 } = o;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c._master!);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

/** Bandpass-filtered noise burst — the basis of every hiss and whoosh. */
function whooshNoise(dur: number, gain: number, fromHz: number, toHz: number, delay = 0): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const frames = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    const p = i / frames;
    data[i] = (Math.random() * 2 - 1) * (p < 0.12 ? p / 0.12 : 1) * (1 - p) ** 0.8;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.1;
  bp.frequency.setValueAtTime(fromHz, t0);
  bp.frequency.exponentialRampToValueAtTime(toHz, t0 + dur * 0.6);
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(c._master!);
  src.start(t0);
}

/**
 * Struck plate steel: an inharmonic partial stack (plate-bell ratios, each
 * slightly detuned) over a sharp noise tick. `base` sets the pitch of the
 * plate, `dur` how long it rings. TUBES' hardware is HEAVY — most calls
 * sit the base an octave under RAVE RAID's and let the ring run long.
 */
function clank(base: number, gain = 0.2, dur = 0.3, delay = 0): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const ratios = [1, 1.51, 2.27, 3.43, 4.83];
  ratios.forEach((ratio, i) => {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = base * ratio * (1 + (Math.random() - 0.5) * 0.015);
    const env = c.createGain();
    const g = gain * (1 / (i + 1));
    const d = dur * (1 - i * 0.12);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(g, t0 + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.04, d));
    osc.connect(env).connect(c._master!);
    osc.start(t0);
    osc.stop(t0 + d + 0.05);
  });
  // The impact tick that sells the strike.
  whooshNoise(0.03, gain * 0.7, base * 4, base * 2, delay);
}

/** A slow sub-bass sine swell — the WEIGHT under every big plant moment. */
function subSwell(from: number, to: number, dur: number, gain: number, delay = 0, attack = 0.05): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(attack, dur * 0.5));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c._master!);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** Servo whine: a narrow-banded saw gliding between two pitches. */
function servo(from: number, to: number, dur: number, gain = 0.07, delay = 0): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 7;
  bp.frequency.setValueAtTime(from * 2, t0);
  bp.frequency.exponentialRampToValueAtTime(Math.max(1, to * 2), t0 + dur);
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(bp).connect(env).connect(c._master!);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/* ── the board ──────────────────────────────────────────────────────────── */

export function uiClick(): void {
  tone({ freq: 900, to: 620, type: 'triangle', dur: 0.07, gain: 0.12 });
  whooshNoise(0.03, 0.06, 2400, 1400);
}

export function uiHover(): void {
  tone({ freq: 1400, type: 'sine', dur: 0.035, gain: 0.04 });
}

/** The sheet stamped DONE — a rubber-stamp thump with a ring of approval. */
export function stampDone(): void {
  clank(190, 0.2, 0.32);
  subSwell(90, 44, 0.3, 0.16, 0, 0.01);
  tone({ freq: 660, type: 'triangle', dur: 0.3, gain: 0.07, delay: 0.1 });
  tone({ freq: 990, type: 'triangle', dur: 0.36, gain: 0.06, delay: 0.16 });
}

/* ── mounting the flange ────────────────────────────────────────────────── */

/** The flange stamps onto the wall — one heavy arrival. */
export function mountThunk(): void {
  clank(120, 0.3, 0.5);
  subSwell(70, 36, 0.4, 0.22, 0, 0.012);
  whooshNoise(0.16, 0.1, 900, 300, 0.01);
}

/** Hex bolts pull themselves tight — three quick servo bites. */
export function boltSpin(): void {
  for (let i = 0; i < 3; i++) {
    servo(620 + i * 90, 220, 0.14, 0.06, i * 0.11);
    clank(700 + i * 120, 0.06, 0.06, i * 0.11 + 0.1);
  }
}

/** Something answers from INSIDE the wall — two muffled knocks. A clank
 *  with all its top end filtered off by the plaster it's behind. */
export function wallKnock(): void {
  const c = ready();
  if (!c) return;
  for (const delay of [0, 0.26]) {
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(88, t0);
    osc.frequency.exponentialRampToValueAtTime(52, t0 + 0.16);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.24, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
    osc.connect(g).connect(c._master!);
    osc.start(t0);
    osc.stop(t0 + 0.25);
  }
}

/** The socket irises awake on its wall, a beat after the knocks. */
export function socketWake(): void {
  servo(240, 760, 0.4, 0.06);
  tone({ freq: 520, to: 780, type: 'sine', dur: 0.35, gain: 0.06, delay: 0.12 });
}

/* ── the pull ───────────────────────────────────────────────────────────── */

/** Both hands take the collar. */
export function grabLatch(): void {
  clank(340, 0.1, 0.12);
  servo(300, 180, 0.1, 0.04, 0.02);
}

/** One hand alone: the collar rocks in its gland and settles — a loose
 *  double rattle that says "more hands", without a word. */
export function oneHandRattle(): void {
  clank(460, 0.08, 0.07);
  clank(390, 0.06, 0.09, 0.07);
}

/** A telescoping detent — the ratchet pawl dropping into the next groove.
 *  Pitch steps with the segment so a long haul plays a rising scale. */
export function segmentClick(step: number): void {
  const base = 520 + Math.min(step, 14) * 46;
  clank(base, 0.09, 0.08);
  tone({ freq: base * 2.2, type: 'triangle', dur: 0.03, gain: 0.03 });
}

/** A whole new SECTION emerges from the one behind it — the ratchet's big
 *  brother: a proper clank, deeper the fatter the section arriving. */
export function sectionArrive(index: number): void {
  clank(200 - Math.min(index, 7) * 14, 0.16, 0.24);
  whooshNoise(0.08, 0.05, 700, 350, 0.01);
}

/** All the way out — the stops take the load and the metal complains. */
export function strainCreak(): void {
  servo(140, 96, 0.5, 0.07);
  whooshNoise(0.3, 0.05, 500, 220, 0.05);
}

/** Let go mid-carry: the free end sags onto its own weight. */
export function droopSettle(): void {
  subSwell(90, 52, 0.28, 0.1, 0, 0.02);
  clank(210, 0.07, 0.16, 0.1);
}

/* ── the seat ───────────────────────────────────────────────────────────── */

/** The magnet takes the head — a rising promise. */
export function magnetTake(): void {
  tone({ freq: 300, to: 620, type: 'sine', dur: 0.16, gain: 0.08 });
  whooshNoise(0.12, 0.05, 800, 2000);
}

/** HOME. The heavy double clunk every satisfying thing is measured by. */
export function seatClunk(): void {
  clank(96, 0.34, 0.5);
  clank(150, 0.22, 0.34, 0.09);
  subSwell(64, 30, 0.5, 0.26, 0, 0.01);
}

/** The latch dogs walk round the collar — three bites and it's held. */
export function latchDogs(): void {
  for (let i = 0; i < 3; i++) {
    servo(520, 260, 0.09, 0.06, 0.06 + i * 0.09);
    clank(430 + i * 60, 0.08, 0.07, 0.12 + i * 0.09);
  }
}

/* ── the craft theatre ──────────────────────────────────────────────────── */

/** The ram lands on the slug — a forge blow, each one a little deader
 *  than the last as the iron takes its shape. */
export function forgeStrike(n: number): void {
  clank(150 - n * 12, 0.26, 0.3);
  whooshNoise(0.08, 0.06, 2600, 900, 0.005);
  subSwell(60, 34, 0.24, 0.12, 0, 0.008);
}

/** A servo running: winds up and holds (the thread), or winds up and
 *  BRAKES (the run-in) — the fitting's own voice. */
export function servoRun(brake: boolean): void {
  servo(180, 760, 0.45, 0.05);
  if (brake) servo(760, 200, 0.28, 0.05, 0.45);
  else servo(760, 700, 0.2, 0.03, 0.45);
}

/** Steam off hot metal — MAINS' signature exhale on a fresh seat. */
export function steamHiss(): void {
  whooshNoise(0.7, 0.1, 3400, 900, 0.05);
}

/** A hydraulic sigh — COOLANT's version of the exhale. */
export function hydraulicSigh(): void {
  servo(400, 140, 0.4, 0.05, 0.05);
  whooshNoise(0.35, 0.06, 1200, 500, 0.08);
}

/** VOLT bites — a snap of arc with crackle in its teeth. */
export function arcZap(): void {
  tone({ freq: 2400, to: 300, type: 'square', dur: 0.08, gain: 0.09 });
  for (let i = 0; i < 4; i++) {
    whooshNoise(0.02, 0.07, 5200 - i * 700, 2400, 0.02 + i * 0.045);
  }
}

/* ── the pour ───────────────────────────────────────────────────────────── */

/** The line charges — held breath, rising. `dur` matches FLOW.chargeS. */
export function chargeRise(dur: number): void {
  subSwell(40, 90, dur, 0.14, 0, dur * 0.7);
  servo(120, 460, dur, 0.05);
}

/** The front lands in the socket: each line gets its own resolution.
 *  MAINS lands a warm major third low; COOLANT a bright fifth; VOLT an
 *  electric octave with bite; PEARL a low open fifth that sounds WET —
 *  the fourth manifold does not arrive like plant, it arrives like
 *  something waking up. All four share the same soft boom under. */
export function flowArrive(line: 'mains' | 'coolant' | 'volt' | 'pearl'): void {
  subSwell(80, 38, 0.5, 0.2, 0, 0.015);
  const chords: Record<typeof line, number[]> = {
    mains: [220, 277, 330],
    coolant: [330, 494, 660],
    volt: [262, 524, 1048],
    pearl: [146, 220, 293],
  };
  chords[line].forEach((f, i) => {
    tone({ freq: f, type: 'triangle', dur: 0.7 - i * 0.1, gain: 0.07, delay: 0.05 + i * 0.06 });
  });
  whooshNoise(0.4, 0.06, 700, 2600, 0.05);
}

/** Every line lit at once — the room's chord, saved for the last seat of
 *  FULL PRESSURE. All three arrivals stacked into one rising spread. */
export function ceremonyChord(): void {
  subSwell(50, 26, 1.6, 0.24, 0, 0.05);
  const spread = [220, 277, 330, 440, 554, 660, 880];
  spread.forEach((f, i) => {
    tone({ freq: f, type: 'triangle', dur: 1.4 - i * 0.12, gain: 0.055, delay: 0.08 + i * 0.09 });
  });
  whooshNoise(0.9, 0.07, 600, 3200, 0.2);
}

/* ── the hums (continuous) ──────────────────────────────────────────────
 * A connected run keeps a voice. Each line's hum is a tiny patch that
 * fades in after the arrival and holds until the job resolves — quiet
 * enough to live under a conversation, present enough that a room with
 * three lines lit sounds like a plant at readiness. Every hum detunes
 * slightly per run so two MAINS never phase-lock into one flat drone.
 */

interface Hum {
  nodes: OscillatorNode[];
  noise?: AudioBufferSourceNode;
  lfo?: OscillatorNode;
  gain: GainNode;
}

const hums = new Map<string, Hum>();

export function startHum(
  id: string,
  line: 'mains' | 'coolant' | 'volt' | 'pearl',
  pulseHz: number,
): void {
  const c = ready();
  if (!c || hums.has(id)) return;
  const t0 = c.currentTime;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  // A running floor can hold three or four of these at once, and there is
  // a record playing over them now — they were levelled for silence.
  gain.gain.exponentialRampToValueAtTime(line === 'volt' ? 0.028 : 0.042, t0 + 1.2);
  gain.connect(c._master!);
  const detune = 1 + (Math.random() - 0.5) * 0.02;
  const nodes: OscillatorNode[] = [];
  let noise: AudioBufferSourceNode | undefined;
  let lfo: OscillatorNode | undefined;

  if (line === 'pearl') {
    // THE FOURTH MANIFOLD. Not a machine noise at all: a slow wet breath
    // under a low drone, filtered so dark it reads as something big
    // moving in a tank rather than plant running.
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    lp.connect(gain);
    for (const f of [41, 61.5]) {
      const osc = c.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f * detune;
      osc.connect(lp);
      osc.start(t0);
      nodes.push(osc);
    }
    const frames = c.sampleRate * 2;
    const buf = c.createBuffer(1, frames, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    noise = c.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 320;
    bp.Q.value = 1.4;
    const ng = c.createGain();
    ng.gain.value = 0.35;
    // The breath: a slow LFO swelling the wet band in and out.
    lfo = c.createOscillator();
    lfo.frequency.value = 0.22;
    const depth = c.createGain();
    depth.gain.value = 0.28;
    lfo.connect(depth).connect(ng.gain);
    lfo.start(t0);
    noise.connect(bp).connect(ng).connect(gain);
    noise.start(t0);
  } else if (line === 'mains') {
    // A boiler two rooms over: two low saws a hair apart, darkened hard.
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    lp.connect(gain);
    for (const f of [55, 55.7]) {
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f * detune;
      osc.connect(lp);
      osc.start(t0);
      nodes.push(osc);
    }
  } else if (line === 'coolant') {
    // Moving fluid: soft filtered noise over a cool sine.
    const frames = c.sampleRate * 2;
    const buf = c.createBuffer(1, frames, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    noise = c.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.7;
    const ng = c.createGain();
    ng.gain.value = 0.5;
    noise.connect(bp).connect(ng).connect(gain);
    noise.start(t0);
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 220 * detune;
    const og = c.createGain();
    og.gain.value = 0.35;
    osc.connect(og).connect(gain);
    osc.start(t0);
    nodes.push(osc);
  } else {
    /* A transformer at readiness — and the one hum in the kit that had to
     * be rebuilt.
     *
     * The first VOLT hum was a 110 Hz SQUARE through a 900 Hz lowpass,
     * amplitude-modulated at the line's own 2.2 Hz strobe. Every one of
     * those choices is wrong for something that plays CONTINUOUSLY for as
     * long as a violet line is plugged in: a square at that pitch is all
     * odd harmonics right in the ear's most sensitive band, and 2.2 Hz is
     * squarely in the flutter range that reads as a fault rather than as
     * a pulse. Playtest, correctly: "way too annoying."
     *
     * What it is now: a steady BODY of two triangles an octave apart,
     * heavily darkened — a transformer sitting there being a transformer
     * — with the electric character moved entirely onto a very quiet
     * bandpassed CORONA up top. Only the corona pulses, at half the old
     * rate, so VOLT still ticks the way violet should and the drone
     * underneath it never wavers. Quieter than the other two lines on
     * purpose: it is the highest-pitched of the three, and equal-loudness
     * makes that the one you notice after ten minutes.
     */
    const body = c.createGain();
    body.gain.value = 0.55;
    body.connect(gain);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    lp.Q.value = 0.7;
    lp.connect(body);
    for (const f of [55, 110.4]) {
      const osc = c.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f * detune;
      osc.connect(lp);
      osc.start(t0);
      nodes.push(osc);
    }
    // The corona: filtered noise, barely there, breathing at half the
    // line's strobe. This is the only part that moves.
    const frames = c.sampleRate * 2;
    const buf = c.createBuffer(1, frames, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    noise = c.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2100;
    bp.Q.value = 2.2;
    const corona = c.createGain();
    corona.gain.value = 0.05;
    lfo = c.createOscillator();
    lfo.frequency.value = Math.max(0.4, pulseHz * 0.5);
    const depth = c.createGain();
    depth.gain.value = 0.03;
    lfo.connect(depth).connect(corona.gain);
    lfo.start(t0);
    noise.connect(bp).connect(corona).connect(gain);
    noise.start(t0);
  }

  hums.set(id, { nodes, noise, lfo, gain });
}

export function stopHum(id: string): void {
  const c = ctx;
  const hum = hums.get(id);
  if (!c || !hum) return;
  hums.delete(id);
  const t0 = c.currentTime;
  hum.gain.gain.cancelScheduledValues(t0);
  hum.gain.gain.setValueAtTime(Math.max(0.0001, hum.gain.gain.value), t0);
  hum.gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
  const stopAt = t0 + 0.7;
  for (const n of hum.nodes) n.stop(stopAt);
  hum.noise?.stop(stopAt);
  hum.lfo?.stop(stopAt);
  window.setTimeout(() => hum.gain.disconnect(), 800);
}

/** Silence every hum (job resolved, board back up). */
export function stopAllHums(): void {
  for (const id of [...hums.keys()]) stopHum(id);
}

/* ── THE GOOP (the last sheet) ───────────────────────────────────────────
 * The fourth manifold does not sound like plant. Everything below is wet:
 * pitch-bent sines with no attack, low-passed noise with a swallow in it,
 * and not one struck plate anywhere. The shop has spent a whole book
 * sounding like iron — the point of these is that something else has
 * arrived.
 */

/** A bubble breaking the surface of the vat. Pitch rises as the level
 *  does, so the brew audibly fills up. */
export function vatBubble(fill = 0.5): void {
  const base = 160 + fill * 260;
  tone({ freq: base * 0.6, to: base, type: 'sine', dur: 0.13, gain: 0.09 });
  whooshNoise(0.09, 0.03, 320, 140);
}

/** The vat takes the green line: a long swallow, not a latch. */
export function vatFill(): void {
  subSwell(30, 70, 2.2, 0.16, 0, 0.5);
  whooshNoise(1.6, 0.05, 200, 600);
  tone({ freq: 98, to: 147, type: 'sine', dur: 1.4, gain: 0.08, delay: 0.2 });
}

/** IT STANDS UP. The one moment the whole book has been walking toward:
 *  a rising wet swell, a tear as it comes off the vat's rim, and a low
 *  chord underneath that is nearly the ceremony's, one third flatter. */
export function goopRise(): void {
  subSwell(28, 96, 1.9, 0.24, 0, 0.12);
  whooshNoise(1.2, 0.09, 180, 900);
  for (const [i, f] of [147, 220, 262, 349].entries()) {
    tone({ freq: f * 0.5, to: f, type: 'sine', dur: 1.5 - i * 0.15, gain: 0.075, delay: 0.25 + i * 0.11 });
  }
}

/** A dance step: gel landing on your real floor. Soft, fat, no ring. */
export function goopStep(hard = false): void {
  const g = hard ? 0.14 : 0.08;
  subSwell(70, 34, 0.24, g, 0, 0.005);
  whooshNoise(0.16, g * 0.5, 520, 180);
}

/** THANKS FOR PLAYING. Everything the works has, at once, and then a
 *  long open fifth left ringing over your actual room. */
export function finaleChord(): void {
  subSwell(44, 22, 2.6, 0.26, 0, 0.06);
  const spread = [147, 220, 294, 370, 440, 588, 740, 880];
  spread.forEach((f, i) => {
    tone({ freq: f, type: 'triangle', dur: 2.4 - i * 0.14, gain: 0.05, delay: 0.1 + i * 0.1 });
  });
  whooshNoise(1.4, 0.06, 400, 3600, 0.25);
}

/** THE TOOL GOES BACK ON THE BELT. Ⓧ with a piece in hand: a short
 *  downward double-click with no ring to it — deliberately the opposite
 *  shape to mountThunk's arrival, so "put down" and "put up" are never
 *  confused in the dark. */
export function toolStow(): void {
  tone({ freq: 520, to: 300, type: 'triangle', dur: 0.06, gain: 0.1 });
  tone({ freq: 300, to: 190, type: 'triangle', dur: 0.07, gain: 0.08, delay: 0.05 });
  whooshNoise(0.05, 0.04, 1200, 500, 0.01);
}

/* ══ THE SIEGE ════════════════════════════════════════════════════════════
 * The fight's voice, from the same kit: every gun is a clank and a noise
 * burst tuned to its line, every death a crunch of scrap. Rate-limited
 * per voice — thirty skitters dying in a frost cloud is one wet crunch,
 * not thirty, and the compressor is spared a wall of transients.
 */

const lastAt: Record<string, number> = {};
/** True if `key` may sound now (at most once per `gapS`). */
function gate(key: string, gapS: number): boolean {
  const c = ready();
  if (!c) return false;
  const now = c.currentTime;
  if (now - (lastAt[key] ?? -1) < gapS) return false;
  lastAt[key] = now;
  return true;
}

/** A gun fires — each round its own report. */
export function gunFire(kind: 'slug' | 'frost' | 'arc' | 'hammer' | 'beam' | 'bigone'): void {
  if (!gate(`fire-${kind}`, kind === 'slug' ? 0.06 : 0.1)) return;
  if (kind === 'slug') {
    clank(420, 0.07, 0.08);
    whooshNoise(0.06, 0.09, 3200, 900);
  } else if (kind === 'frost') {
    whooshNoise(0.32, 0.1, 5200, 1800);
    tone({ freq: 1800, to: 900, type: 'sine', dur: 0.25, gain: 0.04 });
  } else if (kind === 'arc') {
    arcZap();
  } else if (kind === 'hammer') {
    subSwell(110, 50, 0.28, 0.2, 0, 0.005);
    clank(160, 0.14, 0.2);
  } else if (kind === 'beam') {
    tone({ freq: 1400, to: 300, type: 'sawtooth', dur: 0.22, gain: 0.05 });
    whooshNoise(0.2, 0.06, 6000, 2000);
  } else {
    subSwell(80, 30, 0.6, 0.3, 0, 0.004);
    clank(90, 0.2, 0.5);
    whooshNoise(0.4, 0.14, 2200, 200);
  }
}

/** A shell lands — boom, sized. */
export function shellBurst(big: boolean): void {
  if (!gate(big ? 'burst-big' : 'burst', 0.08)) return;
  subSwell(big ? 70 : 110, 28, big ? 0.9 : 0.4, big ? 0.32 : 0.18, 0, 0.004);
  whooshNoise(big ? 0.7 : 0.3, big ? 0.2 : 0.12, 1800, 120);
}

/** A crack of ice off a frost round. */
export function frostCrack(): void {
  if (!gate('frost', 0.08)) return;
  whooshNoise(0.18, 0.07, 7000, 3000);
  tone({ freq: 2600, to: 1500, type: 'triangle', dur: 0.12, gain: 0.03 });
}

/** One of them goes down — a crunch of scrap. */
export function scrapCrunch(heavy: boolean): void {
  if (!gate(heavy ? 'crunch-h' : 'crunch', 0.05)) return;
  clank(heavy ? 140 : 300 + Math.random() * 120, heavy ? 0.16 : 0.08, heavy ? 0.35 : 0.12);
  whooshNoise(heavy ? 0.3 : 0.1, heavy ? 0.12 : 0.07, 2600, 400);
}

/** A bite lands on plant — a dull gnaw. */
export function plantGnaw(): void {
  if (!gate('gnaw', 0.12)) return;
  clank(210 + Math.random() * 40, 0.05, 0.1);
  whooshNoise(0.08, 0.05, 900, 300);
}

/** A bite lands on the CORE — this one has to cut through everything. */
export function coreAlarm(): void {
  if (!gate('core', 0.35)) return;
  tone({ freq: 880, type: 'square', dur: 0.12, gain: 0.05 });
  tone({ freq: 660, type: 'square', dur: 0.14, gain: 0.05, delay: 0.13 });
}

/** A piece of plant is chewed to nothing. */
export function clangWreck(): void {
  if (!gate('wreck', 0.1)) return;
  clank(95, 0.24, 0.6);
  subSwell(90, 30, 0.5, 0.2, 0, 0.004);
  whooshNoise(0.45, 0.14, 1500, 150);
}

/** THE HORN — a wave begins. Two low brass blasts, out of the walls. */
export function siegeHorn(): void {
  for (const [delay, f] of [
    [0, 98],
    [0.62, 92],
  ] as const) {
    tone({ freq: f, type: 'sawtooth', dur: 0.55, gain: 0.08, delay });
    tone({ freq: f * 1.5, type: 'sawtooth', dur: 0.55, gain: 0.04, delay });
    subSwell(f, f * 0.9, 0.6, 0.14, delay, 0.08);
  }
}

/** The last of a wave goes down: a short rising all-clear. */
export function allClear(): void {
  tone({ freq: 523, type: 'triangle', dur: 0.22, gain: 0.07 });
  tone({ freq: 659, type: 'triangle', dur: 0.22, gain: 0.07, delay: 0.12 });
  tone({ freq: 784, type: 'triangle', dur: 0.4, gain: 0.08, delay: 0.24 });
}

/** THE CORE GOES. Everything drops an octave and keeps falling. */
export function coreFall(): void {
  subSwell(120, 18, 2.4, 0.4, 0, 0.004);
  clank(70, 0.3, 1.2);
  whooshNoise(1.6, 0.2, 1400, 60);
  tone({ freq: 440, to: 55, type: 'sawtooth', dur: 2, gain: 0.06, delay: 0.1 });
}

/** The flamethrower: a rushing roar, gated so a held cone is one sound. */
export function flameRoar(): void {
  if (!gate('flame', 0.16)) return;
  whooshNoise(0.24, 0.09, 900, 320);
  whooshNoise(0.18, 0.05, 2600, 1200, 0.03);
}

/** The hammer: a hiss of hydraulics and a steel slam. */
export function hammerSlam(): void {
  if (!gate('hammer', 0.12)) return;
  whooshNoise(0.12, 0.08, 4200, 1800);
  clank(130, 0.2, 0.3, 0.05);
  subSwell(90, 40, 0.25, 0.18, 0.05, 0.004);
}

/** A mortar shell lands: deep, and it shakes the floor. */
export function mortarBoom(): void {
  if (!gate('mortar', 0.1)) return;
  subSwell(60, 24, 0.9, 0.34, 0, 0.004);
  whooshNoise(0.6, 0.18, 1600, 90);
  clank(70, 0.12, 0.5, 0.02);
}

/* ── THE SWARM: deaths by the dozen ──────────────────────────────────── */

let _popBuf: AudioBuffer | null = null;
/** One short decaying burst of noise, made once and replayed at random
 *  rates — a pop a frame must not cost a fresh buffer a frame. */
function popBuffer(c: AudioContext): AudioBuffer {
  if (_popBuf && _popBuf.sampleRate === c.sampleRate) return _popBuf;
  const frames = Math.floor(c.sampleRate * 0.09);
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    const p = i / frames;
    data[i] = (Math.random() * 2 - 1) * (1 - p) ** 2.2;
  }
  _popBuf = buf;
  return buf;
}

function popNoise(gain: number, hz: number, rate: number, delay = 0): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = popBuffer(c);
  src.playbackRate.value = rate;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = hz;
  bp.Q.value = 1.4;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(c._master!);
  src.start(t0);
}

/** Mites popping — `n` of them this frame. One voice however many die,
 *  louder and fatter the more there are, so a carpet going up sounds
 *  like a carpet and not like a stuck key. */
export function swarmPop(n: number): void {
  if (n <= 0 || !gate('pop', 0.035)) return;
  const k = Math.log2(1 + n);
  const g = Math.min(0.2, 0.05 + k * 0.03);
  tone({ freq: 1100 + Math.random() * 900, to: 160 + Math.random() * 80, type: 'triangle', dur: 0.05, gain: g * 0.55 });
  popNoise(g, 1800 + Math.random() * 1600, 0.8 + Math.random() * 0.6);
  if (n > 3) popNoise(g * 0.7, 900 + Math.random() * 600, 0.6 + Math.random() * 0.3, 0.012);
}

/** A whole patch of them goes at once (a shell, a bolt through ten): a
 *  wet, crunching thump under the pops. */
export function swarmCrunch(n: number): void {
  if (!gate('swarm-crunch', 0.1)) return;
  const g = Math.min(0.26, 0.08 + Math.log2(1 + n) * 0.025);
  subSwell(150, 45, 0.3, g, 0, 0.004);
  popNoise(g * 1.2, 700, 0.5);
  popNoise(g, 2600, 0.9, 0.02);
  clank(240 + Math.random() * 60, g * 0.5, 0.18, 0.01);
}
