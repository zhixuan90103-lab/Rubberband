/**
 * Press, pull, release, fly, grab.
 * Positions are design pixels. +x right, +y down.
 */

import { firstPeg, nextPeg, type Peg, type Rng } from './pegs';
import {
  CAMERA_LAG,
  DRAG_BLOCK_Y,
  FIXED_DT,
  GRAB_RADIUS,
  GRAB_START_RADIUS,
  GRAVITY,
  HANG_DROP,
  LAUNCH_SCALE,
  MAX_PULL,
  MIN_PULL,
  OLD_PEG_LOCK,
  PEG_SCREEN_ANCHOR,
  PEGS_AHEAD,
  SHAFT_LEFT,
  SHAFT_RIGHT,
} from './tune';
import { DESIGN_HEIGHT } from '../adapt/design';

export type Phase = 'hang' | 'drag' | 'fly' | 'fall';

export type Body = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Radians, tumbling while airborne. */
  spin: number;
};

export type SlingWorld = {
  phase: Phase;
  pegs: Peg[];
  nextId: number;
  heldId: number;
  leftId: number;
  leftLock: number;
  body: Body;
  /** Extra pull from the hang pose, not from the peg. */
  pullX: number;
  pullY: number;
  /** Seconds of the release flash still left. */
  flash: number;
  /** Seconds of the grab squash still left. */
  squash: number;
  /** Camera world y. Visible design y is world y minus this. */
  cameraY: number;
  height: number;
  rng: Rng;
};

const ANCHOR_Y = DESIGN_HEIGHT * PEG_SCREEN_ANCHOR;

function pegById(world: SlingWorld, id: number): Peg {
  const peg = world.pegs.find((item) => item.id === id);
  if (!peg) throw new Error(`missing peg ${id}`);
  return peg;
}

function highest(world: SlingWorld): Peg {
  return world.pegs.reduce((top, peg) => (peg.y < top.y ? peg : top));
}

function fillAhead(world: SlingWorld): void {
  const held = pegById(world, world.heldId);
  while (world.pegs.filter((peg) => peg.y < held.y).length < PEGS_AHEAD) {
    const peg = nextPeg(highest(world), world.rng, world.nextId);
    world.nextId += 1;
    world.pegs.push(peg);
  }
}

function trimBelow(world: SlingWorld): void {
  const floor = world.cameraY + DESIGN_HEIGHT + 80;
  world.pegs = world.pegs.filter(
    (peg) => peg.y < floor || peg.id === world.heldId || peg.id === world.leftId,
  );
}

function hangPoint(peg: Peg): { x: number; y: number } {
  return { x: peg.x, y: peg.y + HANG_DROP };
}

function placeHang(world: SlingWorld, peg: Peg): void {
  const hang = hangPoint(peg);
  world.body.x = hang.x;
  world.body.y = hang.y;
  world.body.vx = 0;
  world.body.vy = 0;
  world.body.spin = 0;
  world.pullX = 0;
  world.pullY = 0;
}

function cameraTarget(world: SlingWorld): number {
  if (world.phase === 'fly') return world.body.y - ANCHOR_Y;
  const peg = pegById(world, world.heldId);
  return hangPoint(peg).y - ANCHOR_Y;
}

function approachCamera(world: SlingWorld, dt: number): void {
  const target = cameraTarget(world);
  const t = 1 - Math.exp(-dt / CAMERA_LAG);
  world.cameraY += (target - world.cameraY) * t;
}

export function createWorld(rng: Rng): SlingWorld {
  const origin = firstPeg(1);
  const world: SlingWorld = {
    phase: 'hang',
    pegs: [origin],
    nextId: 2,
    heldId: origin.id,
    leftId: -1,
    leftLock: 0,
    body: { x: origin.x, y: origin.y + HANG_DROP, vx: 0, vy: 0, spin: 0 },
    pullX: 0,
    pullY: 0,
    flash: 0,
    squash: 0,
    cameraY: origin.y + HANG_DROP - ANCHOR_Y,
    height: 0,
    rng,
  };
  fillAhead(world);
  return world;
}

export function pullLength(world: SlingWorld): number {
  return Math.hypot(world.pullX, world.pullY);
}

export function tryBeginDrag(world: SlingWorld, x: number, y: number): boolean {
  if (world.phase === 'fall') return false;
  if (world.phase !== 'hang') return false;
  if (y > DRAG_BLOCK_Y) return false;
  const dx = x - world.body.x;
  const dy = y - world.body.y;
  if (dx * dx + dy * dy > GRAB_START_RADIUS * GRAB_START_RADIUS) return false;
  world.phase = 'drag';
  world.pullX = 0;
  world.pullY = 0;
  return true;
}

export function dragTo(world: SlingWorld, x: number, y: number): void {
  if (world.phase !== 'drag') return;
  const hang = hangPoint(pegById(world, world.heldId));
  let px = x - hang.x;
  let py = y - hang.y;
  const length = Math.hypot(px, py);
  if (length > MAX_PULL && length > 0) {
    const scale = MAX_PULL / length;
    px *= scale;
    py *= scale;
  }
  world.pullX = px;
  world.pullY = py;
  world.body.x = hang.x + px;
  world.body.y = hang.y + py;
}

/** Release commits only when the pull is inside [MIN_PULL, MAX_PULL]. */
export function endDrag(world: SlingWorld): void {
  if (world.phase !== 'drag') return;
  const length = pullLength(world);
  const peg = pegById(world, world.heldId);
  if (length < MIN_PULL) {
    world.phase = 'hang';
    placeHang(world, peg);
    return;
  }
  const speed = length * LAUNCH_SCALE;
  world.body.vx = (-world.pullX / length) * speed;
  world.body.vy = (-world.pullY / length) * speed;
  world.pullX = 0;
  world.pullY = 0;
  world.leftId = peg.id;
  world.leftLock = OLD_PEG_LOCK;
  world.flash = 0.12;
  world.phase = 'fly';
}

function grab(world: SlingWorld, peg: Peg): void {
  world.phase = 'hang';
  world.heldId = peg.id;
  world.squash = 0.12;
  placeHang(world, peg);
  world.height = Math.max(world.height, -peg.y);
  fillAhead(world);
}

function stepFly(world: SlingWorld, dt: number): void {
  world.leftLock = Math.max(0, world.leftLock - dt);
  world.body.spin += world.body.vx * 0.004 * dt;
  world.body.vy += GRAVITY * dt;
  world.body.x += world.body.vx * dt;
  world.body.y += world.body.vy * dt;

  if (world.body.x < SHAFT_LEFT || world.body.x > SHAFT_RIGHT) {
    world.phase = 'fall';
    return;
  }

  // Hands sit one hang-length above the body. The torso never has to overlap the peg.
  const handY = world.body.y - HANG_DROP;
  let best: Peg | null = null;
  let bestDist = GRAB_RADIUS;
  for (const peg of world.pegs) {
    if (peg.id === world.leftId && world.leftLock > 0) continue;
    const dx = world.body.x - peg.x;
    const dy = handY - peg.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= bestDist) {
      best = peg;
      bestDist = dist;
    }
  }
  if (best) grab(world, best);
}

export function stepWorld(world: SlingWorld, dt: number): void {
  world.flash = Math.max(0, world.flash - dt);
  world.squash = Math.max(0, world.squash - dt);
  if (world.phase === 'fly') stepFly(world, dt);
  if (world.phase === 'fly' || world.phase === 'hang' || world.phase === 'drag') {
    approachCamera(world, dt);
  }
  if (
    world.phase === 'fly' &&
    world.body.y > world.cameraY + DESIGN_HEIGHT
  ) {
    world.phase = 'fall';
  }
  trimBelow(world);
}

export function advance(world: SlingWorld, frameDt: number): void {
  let left = Math.min(frameDt, 0.1);
  while (left > 0) {
    const dt = Math.min(FIXED_DT, left);
    stepWorld(world, dt);
    left -= dt;
  }
}

export function restart(world: SlingWorld): void {
  const fresh = createWorld(world.rng);
  Object.assign(world, fresh);
}
