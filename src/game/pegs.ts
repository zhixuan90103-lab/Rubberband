/**
 * Peg rows. The opening is one green birth peg, then one centered blue peg.
 * Later rows are a blue pair or one single,
 * with a wide gap so a hang shows this row and the next one. A single may be red.
 * Slots come from a fixed pool and are moved, not constructed again.
 */

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../adapt/design';
import {
  BLUE_PEG_LIFE,
  PEG_FILL_LEAD,
  PEG_GAP_MAX,
  PEG_GAP_MIN,
  PEG_JUMP_MAX,
  PEG_JUMP_MIN,
  PEG_INVALID,
  PEG_KEEP_BELOW,
  PEG_LANES,
  PEG_LOWER_Y,
  PEG_OPEN_SINGLE_GAP,
  PEG_POOL,
  PEG_ROW_STAGGER,
  PEG_SINGLE_X0,
  PEG_SINGLE_X1,
  PEG_WARN,
  RED_PEG_CHANCE,
  RED_PEG_LIFE,
  SHAFT_CENTER,
} from './tune';

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
  /** False while this slot is waiting in the pool. */
  live: boolean;
};

export function pegLife(kind: PegKind): number {
  if (kind === 'green') return Infinity;
  if (kind === 'red') return RED_PEG_LIFE;
  return BLUE_PEG_LIFE;
}

export function makePeg(id: number, x: number, y: number, kind: PegKind, live = true): Peg {
  return { id, x, y, kind, age: 0, cool: 0, live };
}

/** One slot per pool entry. Nothing here is added or removed later. */
export function createPegPool(): Peg[] {
  const pegs: Peg[] = [];
  for (let id = 1; id <= PEG_POOL; id += 1) {
    pegs.push(makePeg(id, 0, 0, 'blue', false));
  }
  return pegs;
}

/** Idle slots sit here so a stale draw cannot land on the camera. */
export const PEG_PARK_Y = 1e6;

export function claimPeg(pegs: Peg[]): Peg | null {
  const peg = pegs.find((item) => !item.live);
  if (!peg) return null;
  peg.live = true;
  peg.age = 0;
  peg.cool = 0;
  return peg;
}

export function releasePeg(peg: Peg): void {
  peg.live = false;
  peg.age = 0;
  peg.cool = 0;
  peg.x = 0;
  peg.y = PEG_PARK_Y;
}

export type Rng = () => number;

export type PegSpot = { x: number; y: number; kind: PegKind };

/** Opening is a two-step stage machine. Later rows remember shape, not an index. */
export type RowStage = 'start' | 'opening' | 'run';

export type RowMemory = {
  stage: RowStage;
  pair: boolean;
  lane: number;
  singleX: number;
  lowSide: number;
};

export function freshRowMemory(): RowMemory {
  return { stage: 'start', pair: false, lane: -1, singleX: SHAFT_CENTER, lowSide: 1 };
}

export type RowPlan = { spots: PegSpot[]; memory: RowMemory };

/**
 * Live nails occupy the camera window. Fill until a row sits PEG_FILL_LEAD
 * above the view. Keep one jump above that so a just-placed row is not
 * recycled on the next tick. Keep PEG_KEEP_BELOW below the screen.
 */
export type PegBand = {
  viewTop: number;
  viewBottom: number;
  fillTop: number;
  keepTop: number;
  keepBottom: number;
};

export function pegBand(cameraY: number): PegBand {
  const viewTop = cameraY;
  const viewBottom = cameraY + DESIGN_HEIGHT;
  const fillTop = viewTop - PEG_FILL_LEAD;
  return {
    viewTop,
    viewBottom,
    fillTop,
    keepTop: fillTop - PEG_JUMP_MAX,
    keepBottom: viewBottom + PEG_KEEP_BELOW,
  };
}

export function pegInView(peg: Peg, band: PegBand): boolean {
  return peg.live && peg.y >= band.viewTop && peg.y <= band.viewBottom;
}

/**
 * Birth, then the centered opening blue peg, then procedural rows.
 * Stage lives on memory so a hole in the chain never replays row 0.
 */
export function planNextRow(prevY: number, rng: Rng, prev: RowMemory): RowPlan {
  if (prev.stage === 'start') {
    return {
      spots: [{ x: SHAFT_CENTER, y: PEG_LOWER_Y, kind: 'green' }],
      memory: { stage: 'opening', pair: false, lane: -1, singleX: SHAFT_CENTER, lowSide: 1 },
    };
  }
  if (prev.stage === 'opening') {
    return {
      spots: [{ x: SHAFT_CENTER, y: prevY - PEG_OPEN_SINGLE_GAP, kind: 'blue' }],
      memory: { ...prev, stage: 'run' },
    };
  }
  let pair = rng() < 0.5;
  if (pair === prev.pair && rng() < 0.7) pair = !pair;
  const prevXs = prev.pair ? [prev.lane, DESIGN_WIDTH - prev.lane] : [prev.singleX];
  let nextXs = prevXs;
  let lane = prev.lane;
  let singleX = prev.singleX;
  if (pair) {
    lane = PEG_LANES[Math.floor(rng() * PEG_LANES.length)];
    if (lane === prev.lane) {
      const at = PEG_LANES.findIndex((item) => item === lane);
      lane = PEG_LANES[(at + 1) % PEG_LANES.length];
    }
    nextXs = [lane, DESIGN_WIDTH - lane];
  } else {
    singleX = PEG_SINGLE_X0 + rng() * (PEG_SINGLE_X1 - PEG_SINGLE_X0);
    if (Math.abs(singleX - prev.singleX) < 36) singleX = DESIGN_WIDTH - singleX;
    nextXs = [singleX];
  }
  let gap = PEG_GAP_MIN + rng() * (PEG_GAP_MAX - PEG_GAP_MIN);
  const stagger = PEG_ROW_STAGGER * 1.3;
  let nearest = Infinity;
  let farthest = 0;
  for (const ax of prevXs) {
    for (const bx of nextXs) {
      const dx = Math.abs(ax - bx);
      nearest = Math.min(nearest, Math.hypot(dx, Math.max(0, gap - stagger)));
      farthest = Math.max(farthest, Math.hypot(dx, gap + stagger));
    }
  }
  if (farthest > PEG_JUMP_MAX) gap -= farthest - PEG_JUMP_MAX;
  if (nearest < PEG_JUMP_MIN) gap += PEG_JUMP_MIN - nearest;
  gap = Math.max(PEG_JUMP_MIN, Math.min(PEG_JUMP_MAX, gap));
  const y = prevY - gap;
  if (pair) {
    const drop = PEG_ROW_STAGGER * (0.7 + rng() * 0.6);
    const lowSide = prev.lowSide > 0 && rng() < 0.75 ? -1 : 1;
    const leftDrop = lowSide > 0 ? drop : 0;
    const rightDrop = lowSide > 0 ? 0 : drop;
    return {
      spots: [
        { x: lane, y: y + leftDrop, kind: 'blue' },
        { x: DESIGN_WIDTH - lane, y: y + rightDrop, kind: 'blue' },
      ],
      memory: { stage: 'run', pair: true, lane, singleX: prev.singleX, lowSide },
    };
  }
  const kind: PegKind = rng() < RED_PEG_CHANCE ? 'red' : 'blue';
  return {
    spots: [{ x: singleX, y, kind }],
    memory: { stage: 'run', pair: false, lane: prev.lane, singleX, lowSide: prev.lowSide },
  };
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


