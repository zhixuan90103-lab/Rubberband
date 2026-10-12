/**
 * One body, gravity always. The arms are a rubber band while a pull returns
 * to hang length, then a fixed-length constraint after a grab.
 * Positions are design pixels. +x right, +y down.
 */

import { firstPeg, nextPeg, type Peg, type Rng } from './pegs';
import {
  createSim,
  simClearJoint,
  simFree,
  simRead,
  simSpring,
  simStep,
  simWrite,
  type Sim,
} from './sim';
import {
  ARM_DAMP,
  ARM_RATE,
  DRAG_BLOCK_Y,
  FIXED_DT,
  GRAB_RADIUS,
  GRAB_START_RADIUS,
  GRAVITY,
  HANG_DROP,
  REST_DROP,
  CATCH_KEEP,
  LAUNCH_SCALE,
  MAX_PULL,
  MIN_PULL,
  OLD_PEG_LOCK,
  PEG_SCREEN_ANCHOR,
  PEGS_AHEAD,
  RETURN_LAG,
  CAMERA_DAMP,
  CAMERA_OVERSHOOT,
  BODY_RADIUS,
  SHAFT_LEFT,
  SHAFT_RIGHT,
  SWING_DAMP,
} from './tune';
import { DESIGN_HEIGHT } from '../adapt/design';

export type Phase = 'hang' | 'drag' | 'return' | 'launch' | 'fly' | 'fall';

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
  /** The peg just left stays ungrabbable until the hand has moved outside it. */
  leftCleared: boolean;
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
  /** Smoothed camera velocity. Kept so a start and a stop ease instead of stepping. */
  cameraVel: number;
  height: number;
  rng: Rng;
  sim: Sim;
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
  while (
    world.pegs.length < PEGS_AHEAD + 1 &&
    world.pegs.filter((peg) => peg.y < held.y).length < PEGS_AHEAD
  ) {
    const peg = nextPeg(highest(world), world.rng, world.nextId);
    world.nextId += 1;
    world.pegs.push(peg);
  }
}

function trimBelow(world: SlingWorld): void {
  if (world.pegs.length <= PEGS_AHEAD + 1) return;
  const floor = world.cameraY + DESIGN_HEIGHT + 80;
  world.pegs = world.pegs.filter(
    (peg) => peg.y < floor || peg.id === world.heldId || peg.id === world.leftId,
  );
}

function syncFromSim(world: SlingWorld): void {
  const next = simRead(world.sim);
  world.body.x = next.x;
  world.body.y = next.y;
  world.body.vx = next.vx;
  world.body.vy = next.vy;
}

function hangPoint(peg: Peg): { x: number; y: number } {
  return { x: peg.x, y: peg.y + REST_DROP };
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
  simClearJoint(world.sim);
  world.sim.body.setRotation(0, true);
  simWrite(world.sim, world.body.x, world.body.y, 0, 0);
}

/**
 * Where the framing point should sit. This is the virtual-camera target, not the
 * rendered camera. Launch never aims below the hang frame, so a pull does not
 * drag the view down. Past the lowest peg the target holds, so the body can leave.
 */
function cameraAim(world: SlingWorld): { y: number; vel: number } {
  const hangFrame = hangPoint(pegById(world, world.heldId)).y - ANCHOR_Y;
  if (world.phase !== 'launch' && world.phase !== 'fly') return { y: hangFrame, vel: 0 };

  const bodyFrame = world.body.y - ANCHOR_Y;
  if (world.phase === 'launch' && bodyFrame > hangFrame) return { y: hangFrame, vel: 0 };
  if (world.phase === 'fly') {
    const lowest = world.pegs.reduce((bottom, peg) => (peg.y > bottom.y ? peg : bottom));
    if (world.body.y > lowest.y + GRAB_RADIUS) {
      const held = Math.min(bodyFrame, hangPoint(lowest).y - ANCHOR_Y);
      return { y: held, vel: 0 };
    }
  }
  return { y: bodyFrame, vel: world.body.vy };
}

/**
 * Unity's SmoothDamp. Critically damped, so it eases out of a start and into a
 * stop without overshooting. `smoothTime` is seconds, not a per-frame fraction.
 */
function smoothDamp(current: number, target: number, vel: number, smoothTime: number, dt: number): { y: number; vel: number } {
  const omega = 2 / Math.max(0.0001, smoothTime);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (vel + omega * change) * dt;
  let nextVel = (vel - omega * temp) * exp;
  let y = target + (change + temp) * exp;
  // Shrink a coast past the goal into CAMERA_OVERSHOOT pixels, and slow by the same ratio.
  const past = y - target;
  if (past !== 0 && (target - current > 0) === past > 0 && Math.abs(past) > CAMERA_OVERSHOOT) {
    const scale = CAMERA_OVERSHOOT / Math.abs(past);
    y = target + past * scale;
    nextVel *= scale;
  }
  return { y, vel: nextVel };
}

function placeCamera(world: SlingWorld, dt: number): void {
  if (world.phase === 'fall') return;
  const aim = cameraAim(world);
  // Lead by the damp time so a constant speed sits on the body, not behind it.
  // The lead is zero whenever the aim itself is holding still.
  const goal = aim.y + aim.vel * CAMERA_DAMP;
  const next = smoothDamp(world.cameraY, goal, world.cameraVel, CAMERA_DAMP, dt);
  world.cameraY = next.y;
  world.cameraVel = next.vel;
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
    leftCleared: true,
    body: { x: origin.x, y: origin.y + REST_DROP, vx: 0, vy: 0, spin: 0 },
    pullX: 0,
    pullY: 0,
    flash: 0,
    squash: 0,
    cameraY: origin.y + REST_DROP - ANCHOR_Y,
    cameraVel: 0,
    height: 0,
    rng,
    sim: createSim(origin.x, origin.y + REST_DROP),
  };
  fillAhead(world);
  return world;
}

/** Stretch past the still pose. Zero at rest and while the arm is shorter. */
export function pullLength(world: SlingWorld): number {
  return Math.max(0, Math.hypot(world.pullX, world.pullY) - REST_DROP);
}

/**
 * Design-space pointer → world. The ortho frustum is top=0, bottom=DESIGN_HEIGHT,
 * camera at y=cameraY, so design y=0 is world y=cameraY and +y stays downward.
 */
export function pointerToWorld(
  world: SlingWorld,
  x: number,
  y: number,
): { x: number; y: number } {
  return { x, y: y + world.cameraY };
}

export function tryBeginDrag(world: SlingWorld, x: number, y: number): boolean {
  if (world.phase !== 'hang' && world.phase !== 'return') return false;
  if (y > DRAG_BLOCK_Y) return false;
  const dx = x - world.body.x;
  const dy = y - world.body.y;
  if (dx * dx + dy * dy > GRAB_START_RADIUS * GRAB_START_RADIUS) return false;
  world.phase = 'drag';
  world.body.vx = 0;
  world.body.vy = 0;
  world.pullX = 0;
  world.pullY = 0;
  return true;
}

export function dragTo(world: SlingWorld, x: number, y: number): void {
  if (world.phase !== 'drag') return;
  const peg = pegById(world, world.heldId);
  let dx = x - peg.x;
  let dy = y - peg.y;
  const reach = Math.hypot(dx, dy);
  const maxReach = REST_DROP + MAX_PULL;
  if (reach > maxReach && reach > 0) {
    const scale = maxReach / reach;
    dx *= scale;
    dy *= scale;
  }
  // Stay inside the shaft on the ray from the peg. Clamping x alone
  // shears the body off the arm and the shot leaves at a bent angle.
  const minX = SHAFT_LEFT + BODY_RADIUS;
  const maxX = SHAFT_RIGHT - BODY_RADIUS;
  const bodyX = peg.x + dx;
  if ((bodyX < minX || bodyX > maxX) && Math.abs(dx) > 1e-4) {
    const limit = bodyX < minX ? minX : maxX;
    const scale = (limit - peg.x) / dx;
    if (scale > 0 && scale < 1) {
      dx *= scale;
      dy *= scale;
    }
  }
  world.pullX = dx;
  world.pullY = dy;
  world.body.x = peg.x + dx;
  world.body.y = peg.y + dy;
}

/** Inside the dead zone the body eases back. Past it, the arm starts contracting. */
export function endDrag(world: SlingWorld): void {
  if (world.phase !== 'drag') return;
  const length = pullLength(world);
  const peg = pegById(world, world.heldId);
  world.pullX = 0;
  world.pullY = 0;
  if (length < MIN_PULL) {
    world.phase = 'return';
    world.body.vx = 0;
    world.body.vy = 0;
    return;
  }
  world.body.vx = 0;
  world.body.vy = 0;
  world.leftId = peg.id;
  world.leftLock = 0;
  world.leftCleared = false;
  world.flash = 0.12;
  world.phase = 'launch';
}

function detach(world: SlingWorld): void {
  world.phase = 'fly';
  world.leftLock = OLD_PEG_LOCK;
  world.leftCleared = false;
}

function grab(world: SlingWorld, peg: Peg): void {
  const dx = world.body.x - peg.x;
  const dy = world.body.y - peg.y;
  const reach = Math.hypot(dx, dy);
  world.phase = 'hang';
  world.heldId = peg.id;
  world.squash = 0.12;
  world.pullX = 0;
  world.pullY = 0;
  simClearJoint(world.sim);
  // Hands stick. The body keeps its speed and carries past the peg,
  // then the soft band yanks it back. That is the overshoot.
  if (reach < 12) {
    const dirX = Math.abs(world.body.vx) + Math.abs(world.body.vy) > 1 ? world.body.vx : 0;
    const dirY = Math.abs(world.body.vx) + Math.abs(world.body.vy) > 1 ? world.body.vy : 1;
    const dir = Math.hypot(dirX, dirY) || 1;
    world.body.x = peg.x + (dirX / dir) * 12;
    world.body.y = peg.y + (dirY / dir) * 12;
  }
  world.body.vx *= CATCH_KEEP;
  world.body.vy *= CATCH_KEEP;
  world.height = Math.max(world.height, -peg.y);
  fillAhead(world);
}

function stepReturn(world: SlingWorld, dt: number): void {
  const hang = hangPoint(pegById(world, world.heldId));
  const t = 1 - Math.exp(-dt / RETURN_LAG);
  world.body.x += (hang.x - world.body.x) * t;
  world.body.y += (hang.y - world.body.y) * t;
  world.body.vx = 0;
  world.body.vy = 0;
  if (Math.hypot(hang.x - world.body.x, hang.y - world.body.y) < 0.5) {
    placeHang(world, pegById(world, world.heldId));
    world.phase = 'hang';
  }
}

/** Arm contracts toward the peg. Slack at HANG_DROP, then the shot is ballistic. */
function stepLaunch(world: SlingWorld, dt: number): void {
  world.leftLock = Math.max(0, world.leftLock - dt);
  const peg = pegById(world, world.heldId);
  const dx = world.body.x - peg.x;
  const dy = world.body.y - peg.y;
  const reach = Math.hypot(dx, dy);
  if (reach <= HANG_DROP) {
    detach(world);
    return;
  }
  simClearJoint(world.sim);
  simWrite(world.sim, world.body.x, world.body.y, world.body.vx, world.body.vy);
  simSpring(world.sim, peg.x, peg.y, LAUNCH_SCALE);
  simStep(world.sim, dt);
  syncFromSim(world);

  const nx = world.body.x - peg.x;
  const ny = world.body.y - peg.y;
  const next = Math.hypot(nx, ny);
  if (next <= HANG_DROP && next > 1e-4) {
    const ninv = 1 / next;
    world.body.x = peg.x + nx * ninv * HANG_DROP;
    world.body.y = peg.y + ny * ninv * HANG_DROP;
    detach(world);
  }
}

function stepHang(world: SlingWorld, dt: number): void {
  const peg = pegById(world, world.heldId);
  // Sticky soft band. Hands stay on the peg until the player pulls.
  // Tension only while stretched; slack just falls back into the band.
  simClearJoint(world.sim);
  const dx = world.body.x - peg.x;
  const dy = world.body.y - peg.y;
  const reach = Math.hypot(dx, dy);
  let ax = 0;
  let ay = GRAVITY;
  if (reach > HANG_DROP && reach > 1e-4) {
    const inv = 1 / reach;
    const pull = ARM_RATE * ARM_RATE * (reach - HANG_DROP);
    ax -= dx * inv * pull;
    ay -= dy * inv * pull;
  }
  world.body.vx += ax * dt;
  world.body.vy += ay * dt;
  if (reach > 1e-4) {
    const inv = 1 / reach;
    const radial = world.body.vx * dx * inv + world.body.vy * dy * inv;
    const tx = world.body.vx - radial * dx * inv;
    const ty = world.body.vy - radial * dy * inv;
    const radialKeep = Math.exp(-ARM_DAMP * dt);
    const tangentKeep = Math.exp(-SWING_DAMP * dt);
    world.body.vx = radial * dx * inv * radialKeep + tx * tangentKeep;
    world.body.vy = radial * dy * inv * radialKeep + ty * tangentKeep;
  }
  world.body.x += world.body.vx * dt;
  world.body.y += world.body.vy * dt;
  simWrite(world.sim, world.body.x, world.body.y, world.body.vx, world.body.vy);
}

function stepFly(world: SlingWorld, dt: number): void {
  world.leftLock = Math.max(0, world.leftLock - dt);
  world.body.spin += world.body.vx * 0.004 * dt;
  simClearJoint(world.sim);
  simWrite(world.sim, world.body.x, world.body.y, world.body.vx, world.body.vy);
  simStep(world.sim, dt);
  syncFromSim(world);

  // The arm catches when the body reaches a peg. The peg then becomes the anchor.
  let best: Peg | null = null;
  let bestDist = GRAB_RADIUS;
  for (const peg of world.pegs) {
    const dx = world.body.x - peg.x;
    const dy = world.body.y - peg.y;
    const dist = Math.hypot(dx, dy);
    if (peg.id === world.leftId) {
      if (dist > GRAB_RADIUS) world.leftCleared = true;
      if (!world.leftCleared || world.leftLock > 0) continue;
    }
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
  if (world.phase === 'return') stepReturn(world, dt);
  else if (world.phase === 'launch') stepLaunch(world, dt);
  else if (world.phase === 'fly') stepFly(world, dt);
  else if (world.phase === 'hang') stepHang(world, dt);
  placeCamera(world, dt);
  // A fast downward shot outruns the camera. Dying at the screen edge
  // skips a peg that is still below the body. Fall only after the body
  // has passed the lowest peg and left the camera.
  const lowest = world.pegs.reduce((y, peg) => Math.max(y, peg.y), -Infinity);
  if (
    (world.phase === 'fly' || world.phase === 'launch') &&
    world.body.y > lowest + GRAB_RADIUS &&
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
  const previous = world.sim;
  const fresh = createWorld(world.rng);
  simFree(previous);
  Object.assign(world, fresh);
}
