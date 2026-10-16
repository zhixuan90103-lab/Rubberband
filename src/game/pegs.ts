/**
 * Peg rows. The editor opening card is placed by the world.
 * After that the climb is procedural: short singles, then pairs and a long
 * step, then a two-peg choice whose coin marks only one landing.
 * Slots come from a fixed pool and are moved, not constructed again.
 */

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../adapt/design';
import {
  BLUE_PEG_LIFE,
  CLIMB_EARLY,
  CLIMB_MID,
  PEG_FILL_LEAD,
  PEG_JUMP_MAX,
  PEG_JUMP_MIN,
  hangRise,
  PEG_INVALID,
  PEG_KEEP_BELOW,
  PEG_LOWER_Y,
  PEG_OPEN_SINGLE_GAP,
  PEG_POOL,
  PEG_WARN,
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

/** Kept so a saved row cursor still parses. The climb no longer samples card shapes. */
export type RowPattern = 'none' | 'side' | 'emergency' | 'redCoin' | 'longClimb';

export type RowMemory = {
  stage: RowStage;
  pair: boolean;
  lane: number;
  singleX: number;
  lowSide: number;
  pattern: RowPattern;
  /** Steps left in the current pattern, including the one about to be placed. 0 means sample again. */
  step: number;
  /** 1 puts the next alternating peg on the right. */
  side: number;
  /** How far the lower peg of this row sits below the row cursor. */
  span: number;
};

export function freshRowMemory(): RowMemory {
  return {
    stage: 'start',
    pair: false,
    lane: -1,
    singleX: SHAFT_CENTER,
    lowSide: 1,
    pattern: 'none',
    step: 0,
    side: 1,
    span: 0,
  };
}

export type RowCoin = { x: number; y: number };

export type RowPlan = { spots: PegSpot[]; memory: RowMemory; coins: RowCoin[] };

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

function blankRun(prev: RowMemory): RowMemory {
  return {
    stage: 'run',
    pair: false,
    lane: prev.lane,
    singleX: prev.singleX,
    lowSide: prev.lowSide,
    pattern: prev.pattern,
    step: prev.step,
    side: prev.side,
    span: prev.span,
  };
}

function sourceXs(prev: RowMemory): number[] {
  if (!prev.pair) return [prev.singleX];
  const right = prev.singleX === prev.lane ? DESIGN_WIDTH - prev.lane : prev.singleX;
  return [prev.lane, right];
}

/** Pull a step onto every source peg: above the row band, inside hangRise, distance 200–600. */
function fitStep(prev: RowMemory, x: number, desired: number): { x: number; rise: number } {
  const pad = prev.span;
  const limit = Math.max(48, hangRise() - pad);
  let rise = Math.min(Math.max(desired, 48), limit);
  const sources = sourceXs(prev);
  const anchor = sources.reduce((best, ax) => (Math.abs(ax - x) < Math.abs(best - x) ? ax : best));
  for (let n = 0; n < 8; n += 1) {
    const far = Math.max(...sources.map((ax) => Math.hypot(ax - x, rise + pad)));
    const near = Math.min(...sources.map((ax) => Math.hypot(ax - x, rise)));
    if (far > PEG_JUMP_MAX) rise -= far - PEG_JUMP_MAX;
    if (near < PEG_JUMP_MIN && rise < limit - 8) rise += Math.min(limit - rise, PEG_JUMP_MIN - near);
    else if (near < PEG_JUMP_MIN) x += Math.sign(anchor - x || 1) * 14;
    rise = Math.min(limit, Math.max(48, rise));
    x = Math.min(278, Math.max(112, x));
  }
  return { x, rise };
}

/** Coin sits well along the flight to one peg, clear of the other landing. */
function coinToward(prev: RowMemory, prevY: number, x: number, y: number): RowCoin {
  const sources = sourceXs(prev);
  const anchor = sources.reduce((best, ax) => (Math.abs(ax - x) < Math.abs(best - x) ? ax : best));
  return { x: anchor + (x - anchor) * 0.72, y: prevY + (y - prevY) * 0.72 };
}

function clampX(x: number): number {
  return Math.min(278, Math.max(112, x));
}

/** Anywhere on the other half of the shaft, at least 70 px from the last peg. */
function offsetX(from: number, rng: Rng): number {
  const side = from <= SHAFT_CENTER ? 1 : -1;
  const inner = SHAFT_CENTER + side * 28;
  const outer = side > 0 ? 278 : 112;
  let x = inner + (outer - inner) * rng();
  if (Math.abs(x - from) < 70) x = from + side * (70 + rng() * (side > 0 ? 278 - from - 70 : from - 112 - 70));
  x = clampX(x);
  if (Math.sign(x - SHAFT_CENTER) !== side) x = clampX(SHAFT_CENTER + side * (36 + rng() * 90));
  return x;
}

function keptOffset(fit: { x: number; rise: number }, aim: number): { x: number; rise: number } {
  if (Math.sign(fit.x - SHAFT_CENTER) === Math.sign(aim - SHAFT_CENTER)) return fit;
  return { x: aim, rise: fit.rise };
}

type ClimbPhase = 'early' | 'mid' | 'late';

function climbPhase(prevY: number): ClimbPhase {
  const climbed = PEG_LOWER_Y - prevY;
  if (climbed < CLIMB_EARLY) return 'early';
  if (climbed < CLIMB_MID) return 'mid';
  return 'late';
}

function rememberSingle(memory: RowMemory, x: number, side: number): RowMemory {
  return { ...memory, pair: false, singleX: x, lane: x, pattern: 'none', step: 0, side, span: 0 };
}

/**
 * Birth, then the centered opening blue peg, then one sampled card-style at a time.
 * Styles come from the saved cards. Coordinates are not copied.
 * Stage lives on memory so a hole in the chain never replays row 0.
 */
export function planNextRow(prevY: number, rng: Rng, prev: RowMemory): RowPlan {
  if (prev.stage === 'start') {
    return {
      spots: [{ x: SHAFT_CENTER, y: PEG_LOWER_Y, kind: 'green' }],
      memory: { ...freshRowMemory(), stage: 'opening', singleX: SHAFT_CENTER },
      coins: [],
    };
  }
  if (prev.stage === 'opening') {
    return {
      spots: [{ x: SHAFT_CENTER, y: prevY - Math.min(PEG_OPEN_SINGLE_GAP, hangRise()), kind: 'blue' }],
      memory: { ...prev, stage: 'run', pattern: 'none', step: 0, singleX: SHAFT_CENTER, pair: false },
      coins: [],
    };
  }
  const memory = blankRun(prev);
  const phase = climbPhase(prevY);
  if (phase === 'early') return earlyStep(prevY, rng, memory);
  const roll = rng();
  if (phase === 'mid') {
    if (roll < 0.22) return longStep(prevY, rng, memory);
    if (roll < 0.62) return choiceStep(prevY, rng, memory, false);
    return singleStep(prevY, rng, memory, 200, 300);
  }
  return choiceStep(prevY, rng, memory, true);
}

/** Early: one short peg. Side offset is a fresh roll, and some pegs are red. */
function earlyStep(prevY: number, rng: Rng, memory: RowMemory): RowPlan {
  const sources = sourceXs(memory);
  const from = sources.reduce((sum, x) => sum + x, 0) / sources.length;
  const aim = offsetX(from, rng);
  const fit = keptOffset(fitStep(memory, aim, 200 + rng() * 70), aim);
  const y = prevY - fit.rise;
  const kind = rng() < 0.34 ? 'red' : 'blue';
  const side = fit.x < SHAFT_CENTER ? -1 : 1;
  return {
    spots: [{ x: fit.x, y, kind }],
    memory: rememberSingle(memory, fit.x, side),
    coins: [],
  };
}

/** One peg, a short sideways step, no second landing and no coin. */
function singleStep(prevY: number, rng: Rng, memory: RowMemory, riseMin: number, riseMax: number): RowPlan {
  const sources = sourceXs(memory);
  const from = sources.reduce((sum, x) => sum + x, 0) / sources.length;
  const aim = offsetX(from, rng);
  const fit = keptOffset(fitStep(memory, aim, riseMin + rng() * (riseMax - riseMin)), aim);
  const y = prevY - fit.rise;
  const side = fit.x < SHAFT_CENTER ? -1 : 1;
  return {
    spots: [{ x: fit.x, y, kind: 'blue' }],
    memory: rememberSingle(memory, fit.x, side),
    coins: [],
  };
}

/** One peg near the top of the visible hang. Still a single landing. */
function longStep(prevY: number, rng: Rng, memory: RowMemory): RowPlan {
  const cap = Math.max(260, hangRise() - 10);
  return singleStep(prevY, rng, memory, cap - 18, cap);
}

/**
 * Two catchable pegs. The coin lies on the way to the farther, higher one.
 * Reaching either peg grabs it. Aiming the other peg misses the coin.
 */
function choiceStep(prevY: number, rng: Rng, memory: RowMemory, late: boolean): RowPlan {
  const baitSide = rng() < 0.5 ? 1 : -1;
  const safeX = clampX(SHAFT_CENTER - baitSide * (28 + rng() * 110));
  const baitX = clampX(SHAFT_CENTER + baitSide * (28 + rng() * 110));
  const rise = 200 + rng() * (late ? 80 : 60);
  const safe = fitStep(memory, safeX, rise);
  const bait = fitStep(memory, baitX, rise + 10 + rng() * 26);
  const safeY = prevY - safe.rise;
  const baitY = prevY - bait.rise;
  const left = safe.x < bait.x ? safe.x : bait.x;
  const right = safe.x < bait.x ? bait.x : safe.x;
  const span = Math.abs(safeY - baitY);
  return {
    spots: [
      { x: safe.x, y: safeY, kind: 'blue' },
      { x: bait.x, y: baitY, kind: !late && rng() < 0.5 ? 'red' : 'blue' },
    ],
    memory: {
      ...memory,
      pair: true,
      lane: left,
      singleX: right,
      pattern: 'none',
      step: 0,
      side: baitSide,
      span,
    },
    coins: [coinToward(memory, prevY, bait.x, baitY)],
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


