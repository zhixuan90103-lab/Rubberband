/**
 * Next-peg placement. Gameplay calls only `nextPeg`.
 * Swap the body of `nextPeg` to change the layout rule.
 */

import {
  PEG_GAP_MAX,
  PEG_GAP_MIN,
  PEG_X_SPREAD,
  RED_PEG_CHANCE,
  SHAFT_CENTER,
} from './tune';

export type PegKind = 'blue' | 'red';

export type Peg = {
  id: number;
  x: number;
  y: number;
  kind: PegKind;
};

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * One step up the shaft. `y` decreases because design +y is down.
 * Distance stays inside a full vertical pull plus the grab radius.
 */
export function nextPeg(prev: Peg, rng: Rng, nextId: number): Peg {
  const gap = lerp(PEG_GAP_MIN, PEG_GAP_MAX, rng());
  const spread = (rng() * 2 - 1) * PEG_X_SPREAD;
  const x = Math.min(
    SHAFT_CENTER + PEG_X_SPREAD,
    Math.max(SHAFT_CENTER - PEG_X_SPREAD, prev.x + spread),
  );
  const kind: PegKind = rng() < RED_PEG_CHANCE ? 'red' : 'blue';
  return { id: nextId, x, y: prev.y - gap, kind };
}

export function firstPeg(id: number): Peg {
  return { id, x: SHAFT_CENTER, y: 0, kind: 'blue' };
}
