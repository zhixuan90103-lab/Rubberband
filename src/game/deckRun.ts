/**
 * Plays a saved card deck in place of procedural rows.
 * No saved deck means the caller keeps the old row generator.
 */

import { DESIGN_HEIGHT } from '../adapt/design';
import {
  climbEntries,
  climbExits,
  loadLevelDoc,
  type LevelCard,
  type LevelDoc,
  type LevelPeg,
} from '../editor/levelModel';
import { hangRise } from './tune';
import type { Rng } from './pegs';

/** A content-to-content seam longer than this gets one bridge card between them. */
const BRIDGE_GAP = 300;

export type DeckPlay = {
  doc: LevelDoc;
  bag: string[];
  pending: LevelCard[];
  last: LevelCard;
  /** World y of local y = 0 for the card just placed. */
  lastTop: number;
  /** World y of local y = 0 for the card about to be placed. */
  nextTop: number;
};

/** Saved editor deck on this origin, otherwise the deck shipped with the game. */
export function loadPlayDeck(): LevelDoc | null {
  return loadLevelDoc();
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const next = items.slice();
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const swap = next[i];
    next[i] = next[j] as T;
    next[j] = swap as T;
  }
  return next;
}

function isBridge(card: LevelCard): boolean {
  return card.name.startsWith('衔接');
}

/** Every normal card except the bridge cards. Editor “不能入组” does not drop them. */
function deckCards(doc: LevelDoc): LevelCard[] {
  return doc.cards.filter((card) => card.kind === 'normal' && !isBridge(card));
}

function bridgeCards(doc: LevelDoc): LevelCard[] {
  return doc.cards.filter((card) => card.kind === 'normal' && isBridge(card));
}

function ends(card: LevelCard, role: 'exit' | 'entry'): LevelPeg[] {
  const picked = role === 'exit' ? climbExits(card) : climbEntries(card);
  if (picked.length > 0) return picked;
  return card.pegs.filter((peg) => peg.color !== 'green');
}

/** Shortest editor-seam distance from an exit of `lower` to an entry of `upper`. */
function minSeam(lower: LevelCard, upper: LevelCard): number {
  const exits = ends(lower, 'exit');
  const entries = ends(upper, 'entry');
  let best = Number.POSITIVE_INFINITY;
  for (const exit of exits) {
    for (const entry of entries) {
      const rise = exit.y - entry.y + DESIGN_HEIGHT;
      best = Math.min(best, Math.hypot(exit.x - entry.x, rise));
    }
  }
  return best;
}

/** Move `upper` so its nearest entry sits within `limit` of `lower`'s highest exit. */
function shiftWithin(lower: LevelCard, upper: LevelCard, limit: number): number {
  const exits = ends(lower, 'exit');
  const entries = ends(upper, 'entry');
  if (exits.length === 0 || entries.length === 0) return -DESIGN_HEIGHT;
  const anchor = exits.reduce((top, peg) => (peg.y < top.y ? peg : top));
  const entry = entries.reduce((best, peg) =>
    Math.abs(peg.x - anchor.x) < Math.abs(best.x - anchor.x) ? peg : best,
  );
  const dx = anchor.x - entry.x;
  const room = Math.sqrt(Math.max(0, limit * limit - dx * dx));
  const rise = Math.min(hangRise(), room, Math.max(200, Math.min(room, 260)));
  return anchor.y - entry.y - Math.max(48, rise);
}

function refillBag(doc: LevelDoc, rng: Rng): string[] {
  return shuffle(deckCards(doc).map((card) => card.id), rng);
}

export function startDeck(doc: LevelDoc, opening: LevelCard, openingTop: number, rng: Rng): DeckPlay {
  return {
    doc,
    bag: refillBag(doc, rng),
    pending: [],
    last: opening,
    lastTop: openingTop,
    nextTop: openingTop,
  };
}

/**
 * One design screen, unless that leaves the next entry in the top leaves.
 * Then the card moves down until that entry is just inside the visible hang.
 * Pegs on the card keep their authored offsets.
 */
function stackShift(lower: LevelCard, upper: LevelCard): number {
  const exits = climbExits(lower);
  const entries = climbEntries(upper);
  if (exits.length === 0 || entries.length === 0) return -DESIGN_HEIGHT;
  const anchor = exits.reduce((top, peg) => (peg.y < top.y ? peg : top));
  let entry = entries[0];
  let rise = Number.POSITIVE_INFINITY;
  for (const peg of entries) {
    const next = anchor.y - peg.y + DESIGN_HEIGHT;
    if (next < rise) {
      rise = next;
      entry = peg;
    }
  }
  const limit = hangRise();
  if (!entry || rise <= limit) return -DESIGN_HEIGHT;
  return anchor.y - entry.y - limit;
}

function drawContent(play: DeckPlay, rng: Rng): LevelCard | null {
  if (deckCards(play.doc).length === 0) return null;
  if (play.bag.length === 0) play.bag = refillBag(play.doc, rng);
  const id = play.bag.shift();
  return play.doc.cards.find((card) => card.id === id) ?? drawContent(play, rng);
}

/** 衔接1 is never placed directly against 衔接2. A content card may sit between them. */
function pickBridge(play: DeckPlay, rng: Rng): LevelCard | null {
  const bridges = bridgeCards(play.doc);
  if (bridges.length === 0) return null;
  if (isBridge(play.last)) return bridges.find((card) => card.name === play.last.name) ?? bridges[0] ?? null;
  const index = Math.floor(rng() * bridges.length);
  return bridges[index] ?? null;
}

function commit(play: DeckPlay, card: LevelCard, limit: number | null): LevelCard {
  const shift = limit == null ? stackShift(play.last, card) : shiftWithin(play.last, card, limit);
  play.nextTop = play.lastTop + shift;
  play.lastTop = play.nextTop;
  play.last = card;
  return card;
}

/**
 * Next authored card. A seam longer than 300 px gets one bridge card in between.
 * The bag reshuffles when it runs out, so the climb does not end.
 */
function takeNext(play: DeckPlay, rng: Rng): LevelCard | null {
  const waiting = play.pending.shift();
  if (waiting) return commit(play, waiting, BRIDGE_GAP);
  const card = drawContent(play, rng);
  if (!card) return null;
  if (minSeam(play.last, card) > BRIDGE_GAP) {
    const bridge = pickBridge(play, rng);
    if (bridge) {
      play.pending = [card];
      return commit(play, bridge, BRIDGE_GAP);
    }
  }
  return commit(play, card, null);
}

/** The next shuffled deck card, stacked one screen above the card just placed. */
export function pullDeckCard(play: DeckPlay, rng: Rng): LevelCard | null {
  return takeNext(play, rng);
}
