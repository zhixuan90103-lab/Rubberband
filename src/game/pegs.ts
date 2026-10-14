/**
 * Next-peg placement. Gameplay calls only `nextPeg`.
 * Swap the body of `nextPeg` to change the layout rule.
 */

import { BLUE_PEG_LIFE, PEG_INVALID, PEG_LOWER_Y, PEG_UPPER_GAP, PEG_WARN, PEG_X_SPREAD, RED_PEG_CHANCE, RED_PEG_LIFE, SHAFT_CENTER } from './tune';

export type PegKind = 'blue' | 'red' | 'green';

export type Peg = {
  id: number;
  x: number;
  y: number;
  kind: PegKind;
  /** Seconds the monkey has hung on this peg since it last recovered. */
  age: number;
  /** Seconds it has stayed gray. Zero while it is still usable. */
  cool: number;
};

export function pegLife(kind: PegKind): number {
  if (kind === 'green') return Infinity;
  if (kind === 'red') return RED_PEG_LIFE;
  return BLUE_PEG_LIFE;
}

export function makePeg(id: number, x: number, y: number, kind: PegKind): Peg {
  return { id, x, y, kind, age: 0, cool: 0 };
}

/** Seconds of hang time left. Green never runs out. */
export function pegRemain(peg: Peg): number {
  return pegLife(peg.kind) - peg.age;
}

/** Usable, or in the gray cooldown. Green is never in cooldown. */
function pegOnCooldown(peg: Peg): boolean {
  const life = pegLife(peg.kind);
  return Number.isFinite(life) && peg.age >= life;
}

/** Gray, and not yet recovered. */
export function pegSpent(peg: Peg): boolean {
  return pegOnCooldown(peg) && peg.cool < PEG_INVALID;
}

/**
 * Usable pegs become cooldown on a real release. Green and an ongoing
 * cooldown stay as they are. Recovery still goes through `tickPeg`.
 */
export function beginPegCooldown(peg: Peg): void {
  if (!Number.isFinite(pegLife(peg.kind)) || pegOnCooldown(peg)) return;
  peg.age = pegLife(peg.kind);
  peg.cool = 0;
}

/**
 * Hang time counts only while `counting`. Cooldown always runs, then both
 * clocks return to zero and the peg is usable again.
 */
export function tickPeg(peg: Peg, dt: number, counting: boolean): void {
  if (!Number.isFinite(pegLife(peg.kind))) return;
  if (pegOnCooldown(peg)) {
    peg.cool += dt;
    if (peg.cool >= PEG_INVALID) {
      peg.age = 0;
      peg.cool = 0;
    }
    return;
  }
  if (counting) peg.age += dt;
}

/** Last PEG_WARN seconds of this peg's own hang time, while it is still usable. */
export function pegWarn(peg: Peg): boolean {
  const remain = pegRemain(peg);
  return Number.isFinite(remain) && !pegSpent(peg) && remain <= PEG_WARN && remain > 0;
}

/** 0 at the start of the warning, 1 when the peg is about to turn gray. */
export function pegUrgency(peg: Peg): number {
  return 1 - Math.min(PEG_WARN, Math.max(0, pegRemain(peg))) / PEG_WARN;
}

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
export function nextPeg(prev: Peg, rng: Rng, nextId: number): Peg {
  const kind: PegKind = rng() < RED_PEG_CHANCE ? 'red' : 'blue';
  return makePeg(nextId, SHAFT_CENTER, prev.y - PEG_UPPER_GAP, kind);
}

export function firstPeg(id: number): Peg {
  return makePeg(id, SHAFT_CENTER, PEG_LOWER_Y, 'green');
}

/** Left and right of a peg, on that same row. */
export function sidePegs(bottom: Peg, nextId: number): [Peg, Peg] {
  return [
    makePeg(nextId, bottom.x - PEG_X_SPREAD, bottom.y, 'blue'),
    makePeg(nextId + 1, bottom.x + PEG_X_SPREAD, bottom.y, 'red'),
  ];
}
