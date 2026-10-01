/**
 * MusicSystem — which record is on, decided entirely by where the game
 * already is.
 *
 * It owns no state of its own and remembers no transitions: every frame
 * it reads `site.screen` and `plant.goop`, works out which deck that
 * means, and asks for it. `music.setDeck` ignores a request for the deck
 * already playing, so "every frame" costs one comparison and the whole
 * system is a pure function of the game's state. Nothing can get the
 * music stuck in the wrong place, because nothing is being tracked.
 *
 * THE THREE DECKS:
 *
 *   BOARD   the work board, and marking the floor out — the record you
 *           read the book to
 *   FLOOR   a live shift, pipe jobs and factory alike: the working set
 *   VAT     NOVUS, from the instant green starts filling the tank, up
 *           through the birth and under the dance, and it does not stop
 *           until you down tools
 *
 * The vat's takeover is deliberately one-way within a shift. Unplug the
 * green line half way and the level holds where it is; the record keeps
 * going, because the thing in the tank is still in the tank and cutting
 * back to the work playlist would undo the moment.
 */

import { createSystem } from '@iwsdk/core';
import { setDeck, type Deck } from '../audio/music.js';
import { site } from '../game/state.js';
import { plant } from '../factory/state.js';

export class MusicSystem extends createSystem({}) {
  update(): void {
    setDeck(deckFor());
  }
}

/** The one rule, exported so a walk can assert it without a frame. */
export function deckFor(): Deck {
  switch (site.screen) {
    case 'board':
    case 'floor':
      return 'board';
    case 'factory':
      // THE HORN CHANGES THE RECORD. The build phase works to the shop's
      // own set; the moment they come out of the wall, NOVUS takes the
      // room (the deck still carries its TUBES name), and it holds until
      // the last of them is down — or the core is.
      return plant.siege.phase === 'wave' || plant.siege.phase === 'fallen' ? 'vat' : 'floor';
    case 'shift':
    case 'ceremony':
      return 'floor';
    default:
      return 'off';
  }
}
