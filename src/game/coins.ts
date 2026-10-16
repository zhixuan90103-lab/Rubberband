/**
 * Coins are planted with the peg row, before the player flies there.
 * Every 3, 4, or 5 rows puts one coin in the gap under that row.
 */

import { DESIGN_HEIGHT } from '../adapt/design';
import { BODY_RADIUS, SHAFT_LEFT, SHAFT_RIGHT } from './tune';
import type { Rng } from './pegs';

export const COIN_POOL = 8;
export const COIN_PICKUP = 36;
/** How long the collected coin stays out of the pool while it flies to the counter. */
export const COIN_FLY = 0.36;
export type Coin = {
  live: boolean;
  /** Collected. The view flies to the counter, then the slot returns to the pool. */
  taken: boolean;
  x: number;
  y: number;
  spin: number;
  pop: number;
};

export function createCoinPool(): Coin[] {
  const coins: Coin[] = [];
  for (let i = 0; i < COIN_POOL; i += 1) {
    coins.push({ live: false, taken: false, x: 0, y: 1e6, spin: 0, pop: 0 });
  }
  return coins;
}

/** Inclusive 3..5. */
export function nextCoinGap(rng: Rng): number {
  return 3 + Math.floor(rng() * 3);
}

/** Park a coin in a gap that already exists. Returns false when the pool is full. */
export function placeCoin(coins: Coin[], x: number, y: number, spin: number): boolean {
  const coin = coins.find((item) => !item.live);
  if (!coin) return false;
  const margin = BODY_RADIUS + 36;
  coin.live = true;
  coin.taken = false;
  coin.pop = 0;
  coin.spin = spin;
  coin.x = Math.min(SHAFT_RIGHT - margin, Math.max(SHAFT_LEFT + margin, x));
  coin.y = y;
  return true;
}

export function tickCoins(
  coins: Coin[],
  dt: number,
  phase: string,
  x: number,
  y: number,
  vy: number,
  cameraY: number,
): number {
  let got = 0;
  const pulling = phase === 'drag' || phase === 'return';
  const rising = (phase === 'launch' || phase === 'fly') && vy < 0;
  const floor = cameraY + DESIGN_HEIGHT + 80;
  for (const coin of coins) {
    if (!coin.live) continue;
    coin.spin += dt * 10;
    if (coin.taken) {
      coin.pop += dt;
      if (coin.pop >= COIN_FLY) coin.live = false;
      continue;
    }
    if (coin.y > floor) {
      coin.live = false;
      continue;
    }
    if (!pulling && !rising) continue;
    if (Math.hypot(coin.x - x, coin.y - y) > COIN_PICKUP + BODY_RADIUS) continue;
    coin.taken = true;
    coin.pop = 0;
    got += 1;
  }
  return got;
}
