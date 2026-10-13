/**
 * One body, gravity always. Positions are design pixels. +x right, +y down.
 *
 * Every shot angle uses the same three steps. There is no up, down, or
 * sideways variant.
 * 1. Launch. One spring along the arm toward the held peg. The arm goes
 *    slack at HANG_DROP and the body flies.
 * 2. Catch. One one-sided band on whatever peg the body touches. It is
 *    slack inside the hang length, pulls only when stretched, and stops
 *    at one extra hang length. The body spins about its own center
 *    and settles crown-up along the arm. A grab does not owe a full turn.
 * 3. Hang. The same arm, locked at the hang length, returns once and
 *    stops under the peg. The crown squares onto the arm.
 */

/** Radians per second added for each px/s of velocity change in a wall hit. */
const HIT_SPIN = 0.015;

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
  CATCH_KEEP,
  DRAG_BLOCK_Y,
  FIXED_DT,
  GRAB_RADIUS,
  GRAB_START_RADIUS,
  GRAVITY,
  HANG_DROP,
  REST_DROP,
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
} from './tune';
import { DESIGN_HEIGHT } from '../adapt/design';

export type Phase = 'hang' | 'drag' | 'return' | 'launch' | 'fly' | 'fall';

export type Body = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Radians. Airborne tumble, and the hang pose once a swing has settled. */
  spin: number;
  /** Radians per second. A grab or a wall hit sets this from the impact. */
  spinVel: number;
};

/** Present while the catch band has not settled back to the hang length. */
export type Catch = {
  held: true;
  /** Unit direction of the velocity at the grab. Overshoot is motion along this. */
  dirX: number;
  dirY: number;
  /** Speed along that direction at the grab. */
  surge0: number;
  spinFrom: number;
  sign: number;
  /** Signed angle from the grab pose to the next crown-up angle. */
  turn: number;
  /** `out` is the carry past the peg. `back` is the fall back to the hang. */
  stage: 'out' | 'back';
  /** 0 at the grab, 1 when the fall-back has reached the hang. Never decreases. */
  progress: number;
  /** Distance from the hang point when the carry turns around. */
  span: number;
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
  catch: Catch | null;
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
  world.catch = null;
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
    body: { x: origin.x, y: origin.y + REST_DROP, vx: 0, vy: 0, spin: 0, spinVel: 0 },
    catch: null,
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
  world.catch = null;
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
  let dx = world.body.x - peg.x;
  let dy = world.body.y - peg.y;
  let reach = Math.hypot(dx, dy);
  world.phase = 'hang';
  world.heldId = peg.id;
  world.squash = 0.12;
  world.pullX = 0;
  world.pullY = 0;
  simClearJoint(world.sim);
  if (reach < 1) {
    const dir = Math.hypot(world.body.vx, world.body.vy) || 1;
    dx = (world.body.vx / dir) * 14;
    dy = (world.body.vy / dir) * 14;
    reach = 14;
    world.body.x = peg.x + dx;
    world.body.y = peg.y + dy;
  }
  world.body.vx *= CATCH_KEEP;
  world.body.vy *= CATCH_KEEP;
  const speed = Math.hypot(world.body.vx, world.body.vy) || 1;
  world.body.spinVel = 0;
  world.catch = {
    held: true,
    dirX: world.body.vx / speed,
    dirY: world.body.vy / speed,
    surge0: speed,
    spinFrom: world.body.spin,
    sign: Math.sign(catchSpin(dx, dy, world.body.vx, world.body.vy)) || 1,
    turn: turnToUpright(world.body.spin, Math.sign(catchSpin(dx, dy, world.body.vx, world.body.vy)) || 1),
    stage: 'out',
    progress: 0,
    span: 1,
  };
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

/** One extra hang length. Past this the band is fully stretched. */
const BAND_MAX = REST_DROP * 2;
/** sqrt(k) of the band, 1/s. Underdamped so one rebound shows. */
const BAND_RATE = 14;
const BAND_DAMP = 18;
/**
 * Tangential decay on the catch, 1/s. The pendulum rate is about 4.8/s,
 * so this is one shorter swing rather than several. It does not touch
 * the radial spring, so the stretch and rebound stay.
 */
const CATCH_SWING_DAMP = 5;

/**
 * Settled hang, after the catch band has cleared.
 * Near-critical damping: the pendulum rate is sqrt(GRAVITY / REST_DROP) ≈ 4.8/s,
 * so 8/s is one short return. Plain gravity. The heavier fall rate pumps a swing.
 */
const ROPE_DAMP = 8;
const ROPE_REST_SPEED = 16;
const ROPE_REST_ANGLE = 0.06;

/** Rise uses GRAVITY. Falling adds weight so the drop does not float. */
function weightGravity(vy: number): number {
  const fall = Math.min(1, Math.max(0, vy / 160));
  return GRAVITY * (1 + fall * 0.95);
}

/**
 * Angular kick from the tangential speed, rad/s. A real sideways hit
 * gets enough speed to finish the turn. A head-on hit stays small.
 */
function catchSpin(dx: number, dy: number, vx: number, vy: number): number {
  const reach = Math.hypot(dx, dy) || 1;
  const tangent = (dx * vy - dy * vx) / reach;
  const speed = Math.hypot(vx, vy);
  // Head-on, including a straight upward catch, has almost no tangent.
  // Still give a visible turn. The coast rate below keeps it near one revolution.
  const sign = Math.sign(tangent) || -Math.sign(vy) || 1;
  const kick = Math.max(Math.abs(tangent) * 0.006, speed > 180 ? 6 : 0);
  return sign * Math.min(8, kick);
}

type Arm = {
  rest: number;
  /** 0 does not clamp. */
  max: number;
  /** 0 locks the length to rest. Otherwise a one-sided spring past rest. */
  rate: number;
  radialDamp: number;
  tangentDamp: number;
};

/**
 * The arm, for a catch and for a settled hang. Gravity is applied by the caller.
 * The body is already moved for this step.
 */
function stepArm(body: Body, peg: Peg, dt: number, arm: Arm): { dx: number; dy: number; reach: number } {
  let dx = body.x - peg.x;
  let dy = body.y - peg.y;
  let reach = Math.hypot(dx, dy);
  if (arm.max > 0 && reach > arm.max && reach > 1e-4) {
    const prevX = body.x - body.vx * dt;
    const prevY = body.y - body.vy * dt;
    const inv = arm.max / reach;
    body.x = peg.x + dx * inv;
    body.y = peg.y + dy * inv;
    body.vx = (body.x - prevX) / dt;
    body.vy = (body.y - prevY) / dt;
    dx = body.x - peg.x;
    dy = body.y - peg.y;
    reach = arm.max;
  }
  if (reach > 1e-4 && arm.rate === 0) {
    const inv = 1 / reach;
    body.x = peg.x + dx * inv * arm.rest;
    body.y = peg.y + dy * inv * arm.rest;
    dx = body.x - peg.x;
    dy = body.y - peg.y;
    reach = arm.rest;
    const nx = dx / reach;
    const ny = dy / reach;
    const radial = body.vx * nx + body.vy * ny;
    body.vx -= radial * nx;
    body.vy -= radial * ny;
  } else if (reach > arm.rest && reach > 1e-4 && arm.rate > 0) {
    const nx = dx / reach;
    const ny = dy / reach;
    const radial = body.vx * nx + body.vy * ny;
    const pull = arm.rate * arm.rate * (reach - arm.rest);
    const next = radial + (-pull - arm.radialDamp * radial - GRAVITY * ny) * dt;
    body.vx += (next - radial) * nx;
    body.vy += (next - radial) * ny;
  }
  if (reach > 1e-4 && arm.tangentDamp > 0) {
    const nx = dx / reach;
    const ny = dy / reach;
    const radial = body.vx * nx + body.vy * ny;
    const keep = Math.exp(-arm.tangentDamp * dt);
    body.vx = (body.vx - radial * nx) * keep + radial * nx;
    body.vy = (body.vy - radial * ny) * keep + radial * ny;
  }
  return { dx, dy, reach };
}

/** Gravity, then the catch band. */
function stepCatch(world: SlingWorld, peg: Peg, dt: number): void {
  if (!world.catch) return;
  world.body.vy += weightGravity(world.body.vy) * dt;
  world.body.x += world.body.vx * dt;
  world.body.y += world.body.vy * dt;
  const arm = stepArm(world.body, peg, dt, {
    rest: REST_DROP,
    max: BAND_MAX,
    rate: BAND_RATE,
    radialDamp: BAND_DAMP,
    tangentDamp: CATCH_SWING_DAMP,
  });
  const reach = arm.reach;
  // One turn covers both the carry past the peg and the fall back.
  // It does not finish at the top, and it does not rewind on the rebound.
  const surge = world.body.vx * world.catch.dirX + world.body.vy * world.catch.dirY;
  const hangX = peg.x;
  const hangY = peg.y + REST_DROP;
  if (world.catch.stage === 'out') {
    const climbed = Math.min(1, Math.max(0, 1 - surge / world.catch.surge0));
    world.catch.progress = Math.max(world.catch.progress, climbed * 0.5);
    if (surge <= 40) {
      world.catch.stage = 'back';
      world.catch.span = Math.max(8, Math.hypot(world.body.x - hangX, world.body.y - hangY));
    }
  } else {
    const left = Math.hypot(world.body.x - hangX, world.body.y - hangY);
    const returned = Math.min(1, Math.max(0, 1 - left / world.catch.span));
    world.catch.progress = Math.max(world.catch.progress, 0.5 + returned * 0.5);
  }
  // Reach crown-up before the hang finishes, and do not travel past it.
  const aimed = Math.min(1, world.catch.progress * 1.15);
  followSpin(world.body, world.catch.spinFrom + world.catch.turn * aimed, dt, 10);
  const speed = Math.hypot(world.body.vx, world.body.vy);
  // Same settle for every side of the peg. The rope then brings the body underneath.
  // Settle only after the fall-back, under the peg. The top of the carry
  // is also slow and about one arm away, and must not end the catch.
  const hung =
    world.catch.stage === 'back' &&
    world.body.y > peg.y &&
    Math.abs(reach - REST_DROP) < 4 &&
    speed < 40;
  if (hung) world.catch = null;
  simWrite(world.sim, world.body.x, world.body.y, world.body.vx, world.body.vy);
}

function stepHang(world: SlingWorld, dt: number): void {
  const peg = pegById(world, world.heldId);
  simClearJoint(world.sim);
  if (world.catch) {
    stepCatch(world, peg, dt);
    return;
  }
  world.body.vy += GRAVITY * dt;
  world.body.x += world.body.vx * dt;
  world.body.y += world.body.vy * dt;
  const arm = stepArm(world.body, peg, dt, {
    rest: REST_DROP,
    max: 0,
    rate: 0,
    radialDamp: 0,
    tangentDamp: ROPE_DAMP,
  });
  // atan2(x, y) is 0 when the body is straight under the peg.
  const hangAngle = Math.atan2(arm.dx, arm.dy);
  const speed = Math.hypot(world.body.vx, world.body.vy);
  const resting = speed < ROPE_REST_SPEED && Math.abs(hangAngle) < ROPE_REST_ANGLE;
  if (resting) {
    world.body.x = peg.x;
    world.body.y = peg.y + REST_DROP;
    world.body.vx = 0;
    world.body.vy = 0;
  }
  // Crown up. A downward grab starts crown-down, so the catch turn aims here
  // and this spring finishes whatever is left without a snap.
  const before = world.body.spin;
  easeSpin(world.body, 0, dt, 8);
  if (before * world.body.spin < 0) {
    world.body.spin = 0;
    world.body.spinVel = 0;
  }
  simWrite(world.sim, world.body.x, world.body.y, world.body.vx, world.body.vy);
}

function stepFly(world: SlingWorld, dt: number): void {
  world.leftLock = Math.max(0, world.leftLock - dt);
  const vxBefore = world.body.vx;
  world.body.vy += (weightGravity(world.body.vy) - GRAVITY) * dt;
  simClearJoint(world.sim);
  simWrite(world.sim, world.body.x, world.body.y, world.body.vx, world.body.vy);
  simStep(world.sim, dt);
  syncFromSim(world);
  if (vxBefore * world.body.vx < 0 && Math.abs(vxBefore) > 80) {
    world.body.spinVel += (world.body.vx - vxBefore) * HIT_SPIN;
  }

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

/**
 * Angle that lands on crown-up. A pose that is already close gets one turn,
 * so the grab is visible, and the turn stops on crown-up.
 */
function turnToUpright(spin: number, sign: number): number {
  const tau = Math.PI * 2;
  let delta = -spin;
  delta -= Math.round(delta / tau) * tau;
  if (Math.abs(delta) < 0.9) delta += (sign >= 0 ? 1 : -1) * tau;
  return delta;
}

/** Follow a moving angle. Stop on the goal instead of swinging past it. */
function followSpin(body: Body, goal: number, dt: number, omega: number): void {
  const delta = goal - body.spin;
  body.spinVel += (omega * omega * delta - 2 * omega * body.spinVel) * dt;
  const step = body.spinVel * dt;
  if (delta === 0 || step * delta >= delta * delta) {
    body.spin = goal;
    body.spinVel = 0;
    return;
  }
  body.spin += step;
}

/** Shortest-arc spring. Keeps spinVel so a new target joins the turn already in motion. */
function easeSpin(body: Body, target: number, dt: number, omega: number): void {
  let delta = target - body.spin;
  const tau = Math.PI * 2;
  delta -= Math.round(delta / tau) * tau;
  body.spinVel += (omega * omega * delta - 2 * omega * body.spinVel) * dt;
  body.spin += body.spinVel * dt;
}

function heldAim(world: SlingWorld): number {
  const peg = pegById(world, world.heldId);
  return Math.atan2(peg.x - world.body.x, -(peg.y - world.body.y));
}

export function stepWorld(world: SlingWorld, dt: number): void {
  world.flash = Math.max(0, world.flash - dt);
  world.squash = Math.max(0, world.squash - dt);
  // Drag, the dead-zone return, and the launch all show the crown toward the peg.
  // The angle eases there, so letting go continues the same turn into the flight.
  if (world.phase === 'drag' || world.phase === 'return' || world.phase === 'launch') {
    easeSpin(world.body, heldAim(world), dt, 14);
  }
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
