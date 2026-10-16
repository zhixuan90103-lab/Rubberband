/**
 * Level cards. One card is one 390×844 screen. The deck draws normal cards
 * at random and stitches them upward. Rules live in docs/LEVEL-EDITOR.md.
 * This module does not place pegs into the live sling world.
 */

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../adapt/design';
import shippedDeck from './levelDeck.json' with { type: 'json' };
import { COIN_PICKUP } from '../game/coins';
import {
  AIM_EXTRA,
  BODY_RADIUS,
  PEG_JUMP_MAX,
  PEG_JUMP_MIN,
  PEG_LOWER_Y,
  PEG_OPEN_SINGLE_GAP,
  PEG_ROW_STAGGER,
  SHAFT_CENTER,
  SHAFT_LEFT,
  SHAFT_RIGHT,
  feel,
  feelDefaults,
} from '../game/tune';

export const MAX_PEGS = 6;
export const MAX_COINS = 2;
/** Two pegs this close in height count as one row. A red peg cannot share a row. */
export const PAIR_ROW_DY = PEG_ROW_STAGGER * 2;
/** Pegs within this height of the selected peg are the same row for alignment. */
export const ROW_ALIGN_DY = 80;
export const STORAGE_KEY = 'rubberband.levelDeck.draft';
const LEGACY_STORAGE_KEY = 'rubberband.levelDeck.v1';

export type PegColor = 'green' | 'blue' | 'red';
export type CardKind = 'opening' | 'normal';
export type CardTag = 'left' | 'right';

export type LevelPeg = { id: string; x: number; y: number; color: PegColor };
export type LevelCoin = { id: string; x: number; y: number };
export type LevelCard = {
  id: string;
  name: string;
  kind: CardKind;
  weight: number;
  tags: CardTag[];
  pegs: LevelPeg[];
  coins: LevelCoin[];
  /**
   * Cards that share a series are played as one block.
   * Any order inside the block is allowed, so every pair in the series must connect.
   */
  series?: string;
};

export type LevelDoc = {
  version: 1;
  /** Set after the opening card is placed on the real start-screen spots. */
  openingPlaced?: boolean;
  /**
   * 1 after handmade pegs were pulled down so the next peg stays on screen
   * while hanging. Later editor moves are kept.
   */
  viewFit?: number;
  openingId: string;
  /** Normal cards currently in the draw bag. */
  deckIds: string[];
  cards: LevelCard[];
};

export type IssueCode =
  | 'tooClose'
  | 'tooFar'
  | 'grabOverlap'
  | 'aimOverlap'
  | 'wallPull'
  | 'redRequired'
  | 'coinMiss'
  | 'coinOnPeg'
  | 'noEntry'
  | 'noExit'
  | 'greenCount';

export type LevelIssue = {
  code: IssueCode;
  level: 'block' | 'warn';
  targetId: string;
  text: string;
};

const BLOCKS_DECK: IssueCode[] = ['tooClose', 'tooFar', 'wallPull', 'noEntry', 'noExit'];

export function bodyStops(): { left: number; right: number } {
  return { left: SHAFT_LEFT + BODY_RADIUS, right: SHAFT_RIGHT - BODY_RADIUS };
}

export function pullRoom(): number {
  return feel.restDrop + feel.minPull;
}

export function isExit(peg: LevelPeg): boolean {
  return peg.y <= PEG_JUMP_MAX;
}

export function isEntry(peg: LevelPeg): boolean {
  return peg.y >= DESIGN_HEIGHT - PEG_JUMP_MAX;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/** Distance after the upper card's bottom edge sits on the lower card's top edge. */
export function seamDistance(lower: LevelPeg, upper: LevelPeg): number {
  return dist(lower.x, lower.y, upper.x, upper.y - DESIGN_HEIGHT);
}

export function inJumpRing(d: number): boolean {
  return d >= PEG_JUMP_MIN && d <= PEG_JUMP_MAX;
}

/** An upward jump inside one card. Same-row neighbours are not a jump. */
export function canClimb(from: LevelPeg, to: LevelPeg): boolean {
  if (to.y >= from.y || sharesRow(from, to)) return false;
  return inJumpRing(dist(from.x, from.y, to.x, to.y));
}

/**
 * Pegs you leave the card from. The green birth peg is not one:
 * the first jump stays on the opening card, from green onto a blue peg.
 */
export function climbExits(card: LevelCard): LevelPeg[] {
  return card.pegs.filter(
    (peg) => peg.color !== 'green' && !card.pegs.some((other) => canClimb(peg, other)),
  );
}

/** Pegs you can arrive on. Nothing else on this card jumps up to them. */
export function climbEntries(card: LevelCard): LevelPeg[] {
  return card.pegs.filter(
    (peg) => peg.color !== 'green' && !card.pegs.some((other) => canClimb(other, peg)),
  );
}

function pegLimit(card: LevelCard): number {
  return card.kind === 'opening' ? MAX_PEGS + 1 : MAX_PEGS;
}

export function canAddPeg(card: LevelCard): boolean {
  return card.pegs.length < pegLimit(card);
}

export function canAddCoin(card: LevelCard): boolean {
  return card.coins.length < MAX_COINS;
}

export function sharesRow(a: LevelPeg, b: LevelPeg): boolean {
  return Math.abs(a.y - b.y) <= PAIR_ROW_DY;
}

/**
 * Pegs on the selected peg's row share its height and split the screen
 * into equal columns. Order stays left to right. Three pegs land on
 * x = 65, 195 and 325 when the screen is 390 wide.
 */
/** Selected pegs share their average height and split the screen width. */
export function spreadPicked(pegs: LevelPeg[], ids: string[], width: number): LevelPeg[] {
  const chosen = pegs.filter((peg) => ids.includes(peg.id));
  if (chosen.length < 2) return pegs;
  const y = Math.round(chosen.reduce((sum, peg) => sum + peg.y, 0) / chosen.length);
  const ordered = [...chosen].sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
  const xs = new Map(
    ordered.map((peg, index) => [peg.id, Math.round(((index + 0.5) * width) / ordered.length)]),
  );
  return pegs.map((peg) => {
    const x = xs.get(peg.id);
    if (x === undefined) return peg;
    return { ...peg, x, y };
  });
}

export function alignRowAcross(pegs: LevelPeg[], anchorId: string, width: number): LevelPeg[] {
  const anchor = pegs.find((peg) => peg.id === anchorId);
  if (!anchor) return pegs;
  const ordered = pegs
    .filter((peg) => Math.abs(peg.y - anchor.y) <= ROW_ALIGN_DY)
    .sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
  const count = ordered.length;
  const xs = new Map(ordered.map((peg, index) => [peg.id, Math.round(((index + 0.5) * width) / count)]));
  return pegs.map((peg) => {
    const x = xs.get(peg.id);
    if (x === undefined) return peg;
    return { ...peg, x, y: anchor.y };
  });
}

export function cardHasDerived(card: LevelCard, tag: 'red' | 'coin'): boolean {
  if (tag === 'red') return card.pegs.some((peg) => peg.color === 'red');
  return card.coins.length > 0;
}

function higherInRange(card: LevelCard, peg: LevelPeg, maxDist: number): boolean {
  return card.pegs.some(
    (other) => other.id !== peg.id && other.y < peg.y && dist(peg.x, peg.y, other.x, other.y) <= maxDist,
  );
}

function reachesExit(pegs: LevelPeg[], skipId: string | null): boolean {
  const exits = new Set(pegs.filter((peg) => peg.id !== skipId && isExit(peg)).map((peg) => peg.id));
  const alive = pegs.filter((peg) => peg.id !== skipId);
  const seen = new Set<string>(exits);
  let grew = true;
  while (grew) {
    grew = false;
    for (const peg of alive) {
      if (seen.has(peg.id)) continue;
      const ok = alive.some(
        (next) =>
          seen.has(next.id) &&
          next.y < peg.y &&
          inJumpRing(dist(peg.x, peg.y, next.x, next.y)),
      );
      if (ok) {
        seen.add(peg.id);
        grew = true;
      }
    }
  }
  return alive.every((peg) => isExit(peg) || seen.has(peg.id));
}

export function issuesFor(card: LevelCard): LevelIssue[] {
  const issues: LevelIssue[] = [];
  const grab = 2 * feel.grabRadius;
  const aim = 2 * (feel.grabRadius + AIM_EXTRA);
  const room = pullRoom();
  const stops = bodyStops();

  for (let i = 0; i < card.pegs.length; i += 1) {
    for (let j = i + 1; j < card.pegs.length; j += 1) {
      const a = card.pegs[i];
      const b = card.pegs[j];
      const d = dist(a.x, a.y, b.x, b.y);
      if (sharesRow(a, b)) continue;
      if (d < PEG_JUMP_MIN) {
        issues.push({ code: 'tooClose', level: 'block', targetId: a.id, text: `与另一颗钉相距 ${Math.round(d)} px，短于 ${PEG_JUMP_MIN}` });
        issues.push({ code: 'tooClose', level: 'block', targetId: b.id, text: `与另一颗钉相距 ${Math.round(d)} px，短于 ${PEG_JUMP_MIN}` });
      }
      if (d <= grab) {
        issues.push({ code: 'grabOverlap', level: 'warn', targetId: a.id, text: `抓取范围重叠（${Math.round(d)} px）` });
        issues.push({ code: 'grabOverlap', level: 'warn', targetId: b.id, text: `抓取范围重叠（${Math.round(d)} px）` });
      } else if (d <= aim) {
        issues.push({ code: 'aimOverlap', level: 'warn', targetId: a.id, text: `瞄准辅助会失效（${Math.round(d)} px）` });
        issues.push({ code: 'aimOverlap', level: 'warn', targetId: b.id, text: `瞄准辅助会失效（${Math.round(d)} px）` });
      }
    }
  }

  for (const peg of card.pegs) {
    if (!isExit(peg) && !higherInRange(card, peg, PEG_JUMP_MAX)) {
      issues.push({
        code: 'tooFar',
        level: 'block',
        targetId: peg.id,
        text: `往上 ${PEG_JUMP_MAX} px 内没有下一颗钉`,
      });
    }
    const side = Math.min(peg.x - stops.left, stops.right - peg.x);
    if (side < room) {
      issues.push({
        code: 'wallPull',
        level: 'block',
        targetId: peg.id,
        text: `朝墙只能拉 ${Math.round(side)} px，短于 ${Math.round(room)}`,
      });
    }
  }

  const reds = card.pegs.filter((peg) => peg.color === 'red');
  const connected = reachesExit(card.pegs, null);
  for (const red of reds) {
    const onlyExit = isExit(red) && card.pegs.filter(isExit).length === 1;
    const breaks = connected && !reachesExit(card.pegs, red.id);
    if (onlyExit || breaks) {
      issues.push({
        code: 'redRequired',
        level: 'warn',
        targetId: red.id,
        text: '这颗红钉是往上的唯一出口，挂满 3 秒会松开',
      });
    }
  }

  const pickup = COIN_PICKUP + BODY_RADIUS;
  for (const coin of card.coins) {
    const onPeg = card.pegs.some((peg) => dist(coin.x, coin.y, peg.x, peg.y) < BODY_RADIUS);
    if (onPeg) {
      issues.push({ code: 'coinOnPeg', level: 'warn', targetId: coin.id, text: '金币压在铆钉上' });
    }
    const reachable = card.pegs.some(
      (peg) => coin.y < peg.y && dist(coin.x, coin.y, peg.x, peg.y) <= PEG_JUMP_MAX + pickup,
    );
    if (!reachable) {
      issues.push({
        code: 'coinMiss',
        level: 'warn',
        targetId: coin.id,
        text: '向上飞时身体中心碰不到这枚金币',
      });
    }
  }

  if (card.kind === 'normal') {
    if (climbEntries(card).length === 0) {
      issues.push({ code: 'noEntry', level: 'block', targetId: card.id, text: '没有入口钉。下一屏要从这里的最下一排接上来' });
    }
    if (climbExits(card).length === 0) {
      issues.push({ code: 'noExit', level: 'block', targetId: card.id, text: '没有出口钉。这一屏要能从最上一排跳走' });
    }
  } else {
    const greens = card.pegs.filter((peg) => peg.color === 'green').length;
    if (greens !== 1) {
      issues.push({
        code: 'greenCount',
        level: 'block',
        targetId: card.id,
        text: greens === 0 ? '开局卡需要一颗绿钉' : '开局卡只能有一颗绿钉',
      });
    }
    if (climbExits(card).length === 0) {
      issues.push({ code: 'noExit', level: 'block', targetId: card.id, text: '开局要先从绿钉跳到蓝钉，蓝钉才是下一屏的出口' });
    }
  }

  return issues;
}

export function blocksDeck(issues: LevelIssue[]): boolean {
  return issues.some((issue) => issue.level === 'block' && BLOCKS_DECK.includes(issue.code));
}

export type SeamReport = {
  ok: boolean;
  lowerMisses: string[];
  upperMisses: string[];
};

export function checkSeam(lower: LevelCard, upper: LevelCard): SeamReport {
  const exits = climbExits(lower);
  const entries = climbEntries(upper);
  const lowerMisses = exits
    .filter((peg) => !entries.some((entry) => inJumpRing(seamDistance(peg, entry))))
    .map((peg) => peg.id);
  const upperMisses = entries
    .filter((peg) => !exits.some((exit) => inJumpRing(seamDistance(exit, peg))))
    .map((peg) => peg.id);
  const ok = exits.length > 0 && entries.length > 0 && lowerMisses.length === 0 && upperMisses.length === 0;
  return { ok, lowerMisses, upperMisses };
}

export function failingDeckSeams(doc: LevelDoc): { lowerId: string; upperId: string }[] {
  const cards = doc.deckIds
    .map((id) => doc.cards.find((card) => card.id === id))
    .filter((card): card is LevelCard => !!card && card.kind === 'normal');
  const failed: { lowerId: string; upperId: string }[] = [];
  for (const lower of cards) {
    for (const upper of cards) {
      if (lower.id === upper.id) continue;
      if (!checkSeam(lower, upper).ok) failed.push({ lowerId: lower.id, upperId: upper.id });
    }
  }
  return failed;
}

export function openingSeamMisses(doc: LevelDoc): string[] {
  const opening = doc.cards.find((card) => card.id === doc.openingId);
  if (!opening) return [];
  return doc.deckIds.filter((id) => {
    const card = doc.cards.find((item) => item.id === id);
    return !!card && !checkSeam(opening, card).ok;
  });
}

let seq = 1;
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

export function clampPoint(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.round(Math.min(DESIGN_WIDTH, Math.max(0, x))),
    y: Math.round(Math.min(DESIGN_HEIGHT, Math.max(0, y))),
  };
}

/**
 * Green birth peg and the centered blue peg, in this screen's pixels.
 * Same framing as a new game: the body rests at pegAnchor, the green peg
 * is one hang above the feet, and the blue peg is PEG_OPEN_SINGLE_GAP higher.
 */
export function openingScreenPegs(): LevelPeg[] {
  const cameraY = PEG_LOWER_Y + feelDefaults.restDrop - DESIGN_HEIGHT * feelDefaults.pegAnchor;
  const screenY = (worldY: number) => Math.round(worldY - cameraY);
  const x = Math.round(SHAFT_CENTER);
  return [
    { id: 'op-green', x, y: screenY(PEG_LOWER_Y), color: 'green' },
    { id: 'op-blue', x, y: screenY(PEG_LOWER_Y - PEG_OPEN_SINGLE_GAP), color: 'blue' },
  ];
}

export function defaultDoc(): LevelDoc {
  const opening: LevelCard = {
    id: 'opening',
    name: '开局',
    kind: 'opening',
    weight: 1,
    tags: [],
    pegs: openingScreenPegs(),
    coins: [],
  };
  const first: LevelCard = {
    id: 'card-rise',
    name: '上跳',
    kind: 'normal',
    weight: 1,
    tags: [],
    pegs: [
      { id: 'rise-low', x: 195, y: 775, color: 'blue' },
      { id: 'rise-high', x: 195, y: 200, color: 'blue' },
    ],
    coins: [{ id: 'rise-coin', x: 250, y: 490 }],
  };
  return {
    version: 1,
    openingPlaced: true,
    openingId: opening.id,
    deckIds: [first.id],
    cards: [opening, first],
  };
}

function placeOpening(doc: LevelDoc): LevelDoc {
  const opening = doc.cards.find((card) => card.id === doc.openingId);
  if (!opening) return doc;
  opening.kind = 'opening';
  opening.pegs = openingScreenPegs();
  opening.coins = [];
  doc.openingPlaced = true;
  return doc;
}

const RED_SERIES = new Set(['红点金币1', '红点金币2', '红点金币3']);

/**
 * While hanging, the body sits restDrop below the peg and the camera keeps
 * that point at pegAnchor (0.7). The next peg has to clear the top leaves,
 * so an upward step taller than this leaves the nail off the screen.
 */
export const VISIBLE_CLIMB = 340;

/** Mark the red-coin trio. Bridge cards are not styles and are not merged in. */
export function adoptDeck(doc: LevelDoc): LevelDoc {
  for (const card of doc.cards) {
    if (RED_SERIES.has(card.name)) card.series = '红点金币';
  }
  return doc;
}

function storedDoc(): LevelDoc | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LevelDoc;
    if (parsed.version !== 1 || !Array.isArray(parsed.cards) || !parsed.openingId) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Browser play and the editor share this. Node tests have no storage and get null. */
export function loadLevelDoc(): LevelDoc | null {
  const stored = storedDoc();
  if (stored) {
    if (!stored.openingPlaced) return adoptDeck(placeOpening(stored));
    return adoptDeck(stored);
  }
  if (typeof localStorage === 'undefined') return null;
  const shipped = structuredClone(shippedDeck) as LevelDoc;
  shipped.openingPlaced = true;
  return adoptDeck(shipped);
}

export function loadDoc(): LevelDoc {
  return loadLevelDoc() ?? adoptDeck(defaultDoc());
}

/** The editor opening card. A draft on this page wins. Otherwise the shipped file. */
export function openingCardPegs(): { x: number; y: number; color: 'green' | 'blue' | 'red' }[] {
  const doc = loadLevelDoc();
  const fromDoc = doc?.cards.find((card) => card.id === doc.openingId);
  const shipped = (shippedDeck as LevelDoc).cards.find((card) => card.id === shippedDeck.openingId);
  const card = fromDoc ?? shipped;
  return (card?.pegs ?? []).map((peg) => ({ x: peg.x, y: peg.y, color: peg.color }));
}

export function saveDoc(doc: LevelDoc): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
}
