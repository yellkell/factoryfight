/**
 * THE RECORDS — the shop's radio, and the one thing in TUBES' audio that
 * is not synthesised.
 *
 * Everything else in audio/sfx.ts is built from oscillators at runtime
 * because the shop's noises are struck metal and steam and want to be
 * parameterised. Music is the opposite: it is finished work, and the job
 * here is only to put the right record on and get out of the way.
 *
 * THREE DECKS, and which one is up is decided by where the game is:
 *
 *   THE BOARD    the menu record, looping, while you read the book
 *   THE FLOOR    the shift playlist, shuffled, while you build
 *   THE VAT      NOVUS — from the moment green starts filling the tank,
 *                through the birth, and under the whole dance
 *
 * They CROSSFADE rather than cut. A shift beginning is a door opening,
 * not a track change, and the finale in particular has to feel like the
 * room itself changing key: the shift playlist ducks away over a couple
 * of seconds while NOVUS comes up under it.
 *
 * STREAMED, NOT DECODED. Each track is an <audio> element piped into the
 * graph through a MediaElementSource. Decoding 17 MB of masters into
 * AudioBuffers would cost a Quest tens of megabytes of resident memory
 * and a stall on first play, to buy sample-accurate scheduling that a
 * jukebox has no use for. RAVE RAID decodes because a rhythm game needs
 * to pin beat zero to the audio clock; nothing here counts bars.
 *
 * Nothing autoplays. The AudioContext and the first play() both wait for
 * the PLAY tap, and a browser that refuses anyway just leaves the
 * shop quiet — every noise the game NEEDS to make is synthesised and
 * runs regardless.
 *
 * ALL FIVE ARE MP3. Novus arrived as an .m4a and was transcoded, because
 * AAC is a proprietary codec that only ships in browsers whose vendors
 * pay for it: Chromium's open-source builds have no idea what to do with
 * it, and the file simply refused to load. Silence would have been
 * survivable on a background track and is not survivable on THIS one —
 * it is the record the whole book walks toward. MP3 plays everywhere,
 * including on the codec-free builds the headless walks run in, which is
 * also how this got caught.
 */

import fourLeafClovers from '../assets/music/four-leaf-clovers.mp3';
import newSong129 from '../assets/music/new-song-129.mp3';
import newSong98 from '../assets/music/new-song-98.mp3';
import newSong104 from '../assets/music/new-song-104.mp3';
import novus from '../assets/music/novus.mp3';
import { audioContext, musicOut } from './sfx.js';

/** Which deck is up. */
export type Deck = 'off' | 'board' | 'floor' | 'vat';

export interface TrackSpec {
  id: string;
  /** What it is called, for the SYSTEM tab's now-playing line. */
  name: string;
  url: string;
  /** Per-track trim (dB-ish, linear here): these are five masters from
   *  five sessions and they do not arrive at one loudness. */
  gain: number;
}

/**
 * THE PLAYLISTS.
 *
 * FOUR LEAF CLOVERS holds the board on its own — it is the longest of
 * the four and the one you will hear from the top every time you come
 * back, so it wants to be the one with the most room in it. The three
 * NEW SONGs work the floor, shuffled, which is roughly six minutes of
 * rotation before anything repeats.
 *
 * Swapping which group goes where is this list and nothing else.
 */
export const BOARD_SET: TrackSpec[] = [
  { id: 'clovers', name: '4 LEAF CLOVERS', url: fourLeafClovers, gain: 0.85 },
];

export const FLOOR_SET: TrackSpec[] = [
  { id: 's129', name: 'NEW SONG 129', url: newSong129, gain: 1 },
  { id: 's98', name: 'NEW SONG 98', url: newSong98, gain: 1 },
  { id: 's104', name: 'NEW SONG 104', url: newSong104, gain: 1 },
];

/** THE VAT'S OWN RECORD. One track, no shuffle, and it loops — the goop
 *  dances until you down tools and the music has to still be there. */
export const VAT_SET: TrackSpec[] = [
  { id: 'novus', name: 'NOVUS', url: novus, gain: 0.95 },
];

const SETS: Record<Exclude<Deck, 'off'>, TrackSpec[]> = {
  board: BOARD_SET,
  floor: FLOOR_SET,
  vat: VAT_SET,
};

/** Crossfade time, seconds. Long enough to read as the room changing and
 *  not as a track skipping; short enough that walking out of the board
 *  into a shift does not carry the lobby record halfway across the floor. */
const FADE_S = 2.2;
/** The finale gets a longer, more deliberate handover. */
const FADE_VAT_S = 3.4;

interface Voice {
  el: HTMLAudioElement;
  gain: GainNode;
  spec: TrackSpec;
  /** Fading out and due to be dropped when it lands. */
  dying: boolean;
}

/** Nothing is attempted until the PLAY tap has primed us. Starting a
 *  record on the landing page would be refused by every browser worth
 *  shipping to, and the retry path is a fallback, not a plan. */
let primed = false;
let deck: Deck = 'off';
let live: Voice | null = null;
const fading: Voice[] = [];
/** Shuffle bag per set, so a playlist plays through before repeating. */
const bags = new Map<string, string[]>();
/** Set once a play() has actually been allowed — before that we are
 *  waiting on a gesture and must not spam the console. */
let unlocked = false;
let lastFailure = 0;

function nextSpec(which: Exclude<Deck, 'off'>): TrackSpec {
  const set = SETS[which];
  if (set.length === 1) return set[0];
  let bag = bags.get(which) ?? [];
  if (bag.length === 0) {
    bag = set.map((t) => t.id);
    // Fisher-Yates, and never start a fresh bag on the track that just
    // finished — the one repeat a shuffle must not make.
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    if (live && bag[0] === live.spec.id && bag.length > 1) {
      [bag[0], bag[1]] = [bag[1], bag[0]];
    }
  }
  const id = bag.shift()!;
  bags.set(which, bag);
  return set.find((t) => t.id === id) ?? set[0];
}

function makeVoice(spec: TrackSpec, loop: boolean): Voice | null {
  const ctx = audioContext();
  const out = musicOut();
  if (!ctx || !out) return null;
  const el = new Audio(spec.url);
  el.loop = loop;
  el.preload = 'auto';
  const src = ctx.createMediaElementSource(el);
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(gain).connect(out);
  return { el, gain, spec, dying: false };
}

function rampTo(voice: Voice, target: number, seconds: number): void {
  const ctx = audioContext();
  if (!ctx) return;
  const t = ctx.currentTime;
  const g = voice.gain.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(target, t + seconds);
}

function retire(voice: Voice, seconds: number): void {
  voice.dying = true;
  rampTo(voice, 0, seconds);
  fading.push(voice);
  window.setTimeout(() => {
    const n = fading.indexOf(voice);
    if (n >= 0) fading.splice(n, 1);
    try {
      voice.el.pause();
      voice.el.src = '';
    } catch {
      /* the element is going away regardless */
    }
  }, seconds * 1000 + 250);
}

function start(which: Exclude<Deck, 'off'>, seconds: number): void {
  const spec = nextSpec(which);
  // The vat's record loops; a playlist advances on `ended`.
  const voice = makeVoice(spec, which === 'vat');
  if (!voice) return;
  if (which !== 'vat') {
    voice.el.addEventListener('ended', () => {
      if (live === voice && deck === which) {
        retire(voice, 0.4);
        start(which, 0.8);
      }
    });
  }
  // A TRACK THAT WILL NOT LOAD MUST NOT STALL THE DECK. Playwright's
  // Chromium ships without the proprietary codecs, so the headless walks
  // see exactly this — and so would any browser that dislikes one of the
  // five files. Drop it and take the next one; a set of one just goes
  // quiet, which is the correct amount of fuss to make about music.
  voice.el.addEventListener('error', () => {
    if (live !== voice) return;
    live = null;
    retire(voice, 0.1);
    if (deck === which && SETS[which].length > 1) start(which, 0.6);
  });
  live = voice;
  const play = voice.el.play();
  if (play) {
    play.then(
      () => {
        unlocked = true;
      },
      () => {
        // Autoplay refused — the tap that unlocks it has not happened
        // yet. Keep the voice; `resume()` retries on the next gesture.
        lastFailure = Date.now();
      },
    );
  }
  rampTo(voice, spec.gain, seconds);
}

/**
 * Put a deck up. Idempotent: asking for the deck that is already playing
 * does nothing at all, which is what lets the systems call this every
 * frame off the game's own state instead of tracking transitions.
 */
export function setDeck(which: Deck): void {
  if (!primed || which === deck) return;
  const toVat = which === 'vat';
  const seconds = toVat || deck === 'vat' ? FADE_VAT_S : FADE_S;
  deck = which;
  if (live) {
    retire(live, seconds);
    live = null;
  }
  if (which !== 'off') start(which, seconds);
}

export function currentDeck(): Deck {
  return deck;
}

/** Call from the PLAY gesture, next to ensureAudio(): the first
 *  play() then happens inside a real user interaction and is allowed. */
export function primeMusic(): void {
  primed = true;
}

/** What is on, for the SYSTEM tab. Null when the shop is quiet. */
export function nowPlaying(): string | null {
  return live && !live.dying ? live.spec.name : null;
}

/**
 * Called from any user gesture: if a play() was refused before the page
 * had one, try again. Cheap, and the only way back from a browser that
 * blocked the first attempt.
 */
export function resumeMusic(): void {
  if (unlocked || !live || Date.now() - lastFailure < 250) return;
  void live.el.play().then(
    () => {
      unlocked = true;
    },
    () => {
      lastFailure = Date.now();
    },
  );
}

/** Everything off, now — DOWN TOOLS, or a session ending. */
export function stopMusic(): void {
  deck = 'off';
  if (live) {
    retire(live, 0.6);
    live = null;
  }
}

if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'click', 'keydown', 'touchstart']) {
    window.addEventListener(ev, resumeMusic, { capture: true });
  }
}

/**
 * Headless/dev hook (wired into __tubes in main.ts). The voices are
 * detached <audio> elements, so there is nothing in the DOM to look at —
 * a walk asking "is NOVUS on?" has to ask here.
 */
export const musicView: {
  state?: () => {
    deck: Deck;
    primed: boolean;
    /** The record that is up, and how far into it. */
    track: string | null;
    id: string | null;
    at: number;
    playing: boolean;
    loop: boolean;
    /** A media error code, when the browser refused the file — the
     *  headless Chromium has no proprietary codecs, so this is expected
     *  under the walks and must never be treated as a failure. */
    error: number | null;
    fading: number;
  };
} = {
  state: () => ({
    deck,
    primed,
    track: live?.spec.name ?? null,
    id: live?.spec.id ?? null,
    at: live ? Math.round(live.el.currentTime * 10) / 10 : 0,
    playing: Boolean(live && !live.el.paused),
    loop: Boolean(live?.el.loop),
    error: live?.el.error?.code ?? null,
    fading: fading.length,
  }),
};
