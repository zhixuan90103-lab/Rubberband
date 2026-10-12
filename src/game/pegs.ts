/**
 * Next-peg placement. Gameplay calls only `nextPeg`.
 * Swap the body of `nextPeg` to change the layout rule.
 */

import { PEG_UPPER_GAP, SHAFT_CENTER } from './tune';

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

/** The other peg: shaft center, one fixed gap above the start peg. */
export function nextPeg(prev: Peg, _rng: Rng, nextId: number): Peg {
  return { id: nextId, x: SHAFT_CENTER, y: prev.y - PEG_UPPER_GAP, kind: 'blue' };
}

export function firstPeg(id: number): Peg {
  return { id, x: SHAFT_CENTER, y: 0, kind: 'blue' };
}
