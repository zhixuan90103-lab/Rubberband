/**
 * One body, gravity always. Positions are design pixels. +x right, +y down.
 *
 * The arm pulls only past armSlack() and never pushes. Catch and hang
 * use that force, plus damping. A launch does not. Its speed is the
 * undamped spring speed for the release length, in the arm's direction.
 * Gravity, damping, and how fast the finger moved do not change it.
 * The body spins about its own center.
 */

/** Radians per second added for each px/s of velocity change in a wall hit. */
import { beginPegCooldown, firstPeg, nextPeg, pegSpent, sidePegs, tickPeg, type Peg, type Rng } from './pegs';
import {
  createSim,
  simApplyArm,
  simFree,
  simRead,
  simStep,
  simWrite,
  type Sim,
} from './sim';
import {
  armMax,
  armSlack,
  BODY_RADIUS,
  DRAG_BLOCK_Y,
  feel,
  FIXED_DT,
  PEGS_AHEAD,
  CAMERA_HOLD_HALF,
  CAMERA_X_GAIN,
  CAMERA_X_MAX,
  SHAFT_CENTER,
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
  /** Seconds since the peg impact. Negative means no impact pose. */
  squash: number;
  /** The finger is past the arm cap, and the wall did not stop it short. */
  fullPull: boolean;
  /** Camera world y. Visible design y is world y minus this. */
  cameraY: number;
  /** Camera world x. A small follow of the body's sideways move. */
  cameraX: number;
  /** Smoothed camera velocity. Kept so a start and a stop ease instead of stepping. */
  cameraVel: number;
  cameraVelX: number;
  height: number;
  rng: Rng;
  sim: Sim;
  catch: Catch | null;
  /** Set at release. The contraction follows cos(ω t) and lets go at slack. */
  shot: Shot | null;
};

type Shot = {
  /** Unit vector from the peg out to the hand at release. */
  outX: number;
  outY: number;
  /** Reach past the slack length. Exit speed is armOmega times this. */
  extension: number;
  age: number;
};

function anchorY(): number {
  return DESIGN_HEIGHT * feel.pegAnchor;
}

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
  const bottomY = world.pegs.reduce((y, peg) => Math.max(y, peg.y), -Infinity);
  world.pegs = world.pegs.filter(
    (peg) =>
      peg.y < floor ||
      peg.y >= bottomY - 0.5 ||
      peg.id === world.heldId ||
      peg.id === world.leftId,
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
  return { x: peg.x, y: peg.y + feel.restDrop };
}

/** Respawn uses this share of a full-pull launch. The full shot crosses the screen too fast. */
const ENTER_LAUNCH = 0.8;
/** First try is this far below the screen. Each miss steps the start upward. */
const ENTER_BELOW = 40;
const ENTER_RAISE = 16;

/** Full-pull rate is `launchSpin`. Shorter pulls scale with the stretch. Straight up still rolls. */
function releaseSpin(dx: number, extension: number): number {
  const side = Math.sign(dx) || 1;
  const fullStretch = Math.max(1e-4, armMax() - armSlack());
  return side * feel.launchSpin * (extension / fullStretch);
}

/**
 * Velocity that reaches `dx, dy` under the same gravity at a fixed speed.
 * `dx, dy` point from the body to the target. +y is down. `ok` is false when
 * the speed cannot cover that distance.
 */
function shotAt(
  dx: number,
  dy: number,
  speed: number,
): { vx: number; vy: number; t: number; ok: boolean } {
  const gravity = feel.gravity;
  const reach = Math.hypot(dx, dy) || 1;
  const straight = {
    vx: (dx / reach) * speed,
    vy: (dy / reach) * speed,
    t: reach / speed,
    ok: false,
  };
  const a = 0.25 * gravity * gravity;
  const b = -dy * gravity - speed * speed;
  const c = dx * dx + dy * dy;
  const disc = b * b - 4 * a * c;
  if (disc < 0 || a === 0) return straight;
  const root = Math.sqrt(disc);
  const times = [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter((item) => item > 1e-6).sort((p, q) => p - q);
  const u = times[0];
  if (u === undefined) return straight;
  const t = Math.sqrt(u);
  return { vx: dx / t, vy: dy / t - 0.5 * gravity * t, t, ok: true };
}

/**
 * One ordinary flight back to the spawn peg. `fromX` is where the body fell.
 * The start is as low as this launch speed can still reach the peg.
 */
function respawnFlight(
  peg: Peg,
  fromX: number,
  cameraY: number,
): { x: number; y: number; vx: number; vy: number; t: number } {
  const speed = feel.armOmega * Math.max(0, armMax() - armSlack()) * ENTER_LAUNCH;
  const minX = SHAFT_LEFT + BODY_RADIUS;
  const maxX = SHAFT_RIGHT - BODY_RADIUS;
  let x = Math.min(maxX, Math.max(minX, fromX));
  let y = cameraY + DESIGN_HEIGHT + ENTER_BELOW;
  let shot = shotAt(peg.x - x, peg.y - y, speed);
  while (!shot.ok && y > peg.y + feel.grabRadius + 8) {
    y -= ENTER_RAISE;
    shot = shotAt(peg.x - x, peg.y - y, speed);
  }
  return { x, y, vx: shot.vx, vy: shot.vy, t: shot.t };
}

/** After a death retry. Same flight and grab as any other shot, plus one roll. */
export function beginEnter(world: SlingWorld, fromX: number): void {
  const peg = pegById(world, world.heldId);
  const flight = respawnFlight(peg, fromX, world.cameraY);
  world.body.x = flight.x;
  world.body.y = flight.y;
  world.body.vx = flight.vx;
  world.body.vy = flight.vy;
  world.body.spin = 0;
  world.body.spinVel = (Math.PI * 2) / flight.t;
  world.phase = 'fly';
  world.catch = null;
  world.shot = null;
  world.squash = -1;
  world.leftId = -1;
  world.leftLock = 0;
  world.leftCleared = true;
  simWrite(world.sim, world.body.x, world.body.y, world.body.vx, world.body.vy);
}

function placeHang(world: SlingWorld, peg: Peg): void {
  const hang = hangPoint(peg);
  world.body.x = hang.x;
  world.body.y = hang.y;
  world.body.vx = 0;
  world.body.vy = 0;
  world.catch = null;
  world.shot = null;
  world.pullX = 0;
  world.pullY = 0;
  world.sim.body.setRotation(0, true);
  simWrite(world.sim, world.body.x, world.body.y, 0, 0);
}

/**
 * Where the framing point should sit. This is the virtual-camera target, not the
 * rendered camera. Launch never aims below the hang frame, so a pull does not
 * drag the view down. Past the lowest peg the target holds, so the body can leave.
 */
function cameraAim(world: SlingWorld): { y: number; vel: number } {
  const hangFrame = hangPoint(pegById(world, world.heldId)).y - anchorY();
  if (world.phase !== 'launch' && world.phase !== 'fly') return { y: hangFrame, vel: 0 };

  const bodyFrame = world.body.y - anchorY();
  if (world.phase === 'launch' && bodyFrame > hangFrame) return { y: hangFrame, vel: 0 };
  if (world.phase === 'fly') {
    const lowest = world.pegs.reduce((bottom, peg) => (peg.y > bottom.y ? peg : bottom));
    if (world.body.y > lowest.y + feel.grabRadius) {
      const held = Math.min(bodyFrame, hangPoint(lowest).y - anchorY());
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
  // Shrink a coast past the goal into feel.cameraOvershoot pixels, and slow by the same ratio.
  const past = y - target;
  if (past !== 0 && (target - current > 0) === past > 0 && Math.abs(past) > feel.cameraOvershoot) {
    const scale = feel.cameraOvershoot / Math.abs(past);
    y = target + past * scale;
    nextVel *= scale;
  }
  return { y, vel: nextVel };
}

/**
 * Sideways camera. Zero unless the player is pulling an outer peg toward
 * the nearer wall. The middle is a band around the shaft center, not one peg.
 * Hang, return, launch, and fly stay centered.
 */
function cameraSide(world: SlingWorld): number {
  if (world.phase !== 'drag') return 0;
  const held = pegById(world, world.heldId);
  const fromCenter = held.x - SHAFT_CENTER;
  if (Math.abs(fromCenter) <= CAMERA_HOLD_HALF) return 0;
  const past = world.body.x - held.x;
  const towardWall = fromCenter < 0 ? Math.min(0, past) : Math.max(0, past);
  return Math.max(-CAMERA_X_MAX, Math.min(CAMERA_X_MAX, towardWall * CAMERA_X_GAIN));
}

function placeCamera(world: SlingWorld, dt: number): void {
  if (world.phase !== 'fall') {
    const aim = cameraAim(world);
    // Lead by the damp time so a constant speed sits on the body, not behind it.
    // The lead is zero whenever the aim itself is holding still.
    const goal = aim.y + aim.vel * feel.cameraDamp;
    const next = smoothDamp(world.cameraY, goal, world.cameraVel, feel.cameraDamp, dt);
    world.cameraY = next.y;
    world.cameraVel = next.vel;
  }
  const side = cameraSide(world);
  const nextX = smoothDamp(world.cameraX, side, world.cameraVelX, feel.cameraDamp, dt);
  world.cameraX = nextX.y;
  world.cameraVelX = nextX.vel;
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
    body: { x: origin.x, y: origin.y + feel.restDrop, vx: 0, vy: 0, spin: 0, spinVel: 0 },
    catch: null,
    shot: null,
    pullX: 0,
    pullY: 0,
    flash: 0,
    squash: -1,
    fullPull: false,
    cameraY: origin.y + feel.restDrop - anchorY(),
    cameraX: 0,
    cameraVel: 0,
    cameraVelX: 0,
    height: 0,
    rng,
    sim: createSim(origin.x, origin.y + feel.restDrop),
  };
  fillAhead(world);
  const bottom = world.pegs.reduce((low, peg) => (peg.y > low.y ? peg : low));
  const sides = sidePegs(bottom, world.nextId);
  world.nextId += sides.length;
  world.pegs.push(...sides);
  return world;
}

/** Stretch past the still pose. Zero at rest and while the arm is shorter. */
export function pullLength(world: SlingWorld): number {
  return Math.max(0, Math.hypot(world.pullX, world.pullY) - feel.restDrop);
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
  return { x: x + world.cameraX, y: y + world.cameraY };
}

export function tryBeginDrag(world: SlingWorld, x: number, y: number): boolean {
  if (world.phase !== 'hang' && world.phase !== 'return') return false;
  if (pegSpent(pegById(world, world.heldId))) return false;
  if (y > DRAG_BLOCK_Y) return false;
  const dx = x - world.body.x;
  const dy = y - world.body.y;
  if (dx * dx + dy * dy > feel.grabStartRadius * feel.grabStartRadius) return false;
  world.phase = 'drag';
  world.catch = null;
  world.squash = -1;
  world.fullPull = false;
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
  const maxReach = armMax();
  const wantedMax = reach >= maxReach - 0.5;
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
  world.fullPull = wantedMax && Math.hypot(dx, dy) >= maxReach - 1;
}

/** Inside the dead zone the body eases back. Past it, the arm starts contracting. */
export function endDrag(world: SlingWorld): void {
  if (world.phase !== 'drag') return;
  const length = pullLength(world);
  const peg = pegById(world, world.heldId);
  world.pullX = 0;
  world.pullY = 0;
  world.body.vx = 0;
  world.body.vy = 0;
  simWrite(world.sim, world.body.x, world.body.y, 0, 0);
  if (length < feel.minPull) {
    world.shot = null;
    world.phase = 'return';
    return;
  }
  const dx = world.body.x - peg.x;
  const dy = world.body.y - peg.y;
  const reach = Math.hypot(dx, dy) || 1;
  const extension = Math.max(0, reach - armSlack());
  world.shot = {
    outX: dx / reach,
    outY: dy / reach,
    extension,
    age: 0,
  };
  world.body.spinVel = releaseSpin(dx, extension);
  beginPegCooldown(peg);
  world.leftId = peg.id;
  world.leftLock = 0;
  world.leftCleared = false;
  world.flash = 0.12;
  world.phase = 'launch';
}

function detach(world: SlingWorld): void {
  world.phase = 'fly';
  world.leftLock = feel.oldPegLock;
  world.leftCleared = false;
}

function grab(world: SlingWorld, peg: Peg): void {
  let dx = world.body.x - peg.x;
  let dy = world.body.y - peg.y;
  let reach = Math.hypot(dx, dy);
  world.phase = 'hang';
  world.heldId = peg.id;
  world.squash = 0;
  world.pullX = 0;
  world.pullY = 0;
  if (reach < 1) {
    const dir = Math.hypot(world.body.vx, world.body.vy) || 1;
    dx = (world.body.vx / dir) * 14;
    dy = (world.body.vy / dir) * 14;
    reach = 14;
    world.body.x = peg.x + dx;
    world.body.y = peg.y + dy;
  }
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

const REST_SPEED = 16;
const REST_ANGLE = 0.06;

/** Park a crossed shot on the slack circle and keep the velocity it already has. */
function releaseIfSlack(world: SlingWorld, peg: Peg): boolean {
  const dx = world.body.x - peg.x;
  const dy = world.body.y - peg.y;
  const reach = Math.hypot(dx, dy);
  if (reach > armSlack()) return false;
  if (reach > 1e-4) {
    const scale = armSlack() / reach;
    world.body.x = peg.x + dx * scale;
    world.body.y = peg.y + dy * scale;
    simWrite(world.sim, world.body.x, world.body.y, world.body.vx, world.body.vy);
  }
  detach(world);
  return true;
}

/** Keep the body on the ray once the arm is fully stretched. */
function clampArm(world: SlingWorld, peg: Peg): void {
  const dx = world.body.x - peg.x;
  const dy = world.body.y - peg.y;
  const reach = Math.hypot(dx, dy);
  if (reach <= armMax() || reach < 1e-4) return;
  const nx = dx / reach;
  const ny = dy / reach;
  world.body.x = peg.x + nx * armMax();
  world.body.y = peg.y + ny * armMax();
  const radial = world.body.vx * nx + world.body.vy * ny;
  if (radial > 0) {
    world.body.vx -= radial * nx;
    world.body.vy -= radial * ny;
  }
  simWrite(world.sim, world.body.x, world.body.y, world.body.vx, world.body.vy);
}

/**
 * The arm, while it is on a peg. Launch detaches at armSlack().
 * A quiet body under the peg latches to the hang pose.
 */
function stepAttached(world: SlingWorld, dt: number, release: boolean): void {
  const peg = pegById(world, world.heldId);
  if (release && releaseIfSlack(world, peg)) return;
  simWrite(world.sim, world.body.x, world.body.y, world.body.vx, world.body.vy);
  simApplyArm(world.sim, peg.x, peg.y, dt);
  simStep(world.sim, dt);
  syncFromSim(world);
  clampArm(world, peg);
  if (release && releaseIfSlack(world, peg)) return;
  const dx = world.body.x - peg.x;
  const dy = world.body.y - peg.y;
  const reach = Math.hypot(dx, dy);
  const speed = Math.hypot(world.body.vx, world.body.vy);
  const angle = Math.atan2(dx, dy);
  const quiet = speed < REST_SPEED && Math.abs(angle) < REST_ANGLE && Math.abs(reach - feel.restDrop) < 4;
  if (!release && !world.catch && quiet && world.body.y > peg.y) {
    placeHang(world, peg);
    if (world.phase === 'return') world.phase = 'hang';
  }
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

/** The catch pose. Motion is the same arm as a hang. */
function stepCatch(world: SlingWorld, peg: Peg, dt: number): void {
  if (!world.catch) return;
  stepAttached(world, dt, false);
  if (!world.catch) return;
  const dx = world.body.x - peg.x;
  const dy = world.body.y - peg.y;
  const reach = Math.hypot(dx, dy);
  const surge = world.body.vx * world.catch.dirX + world.body.vy * world.catch.dirY;
  const hangX = peg.x;
  const hangY = peg.y + feel.restDrop;
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
  const aimed = Math.min(1, world.catch.progress * 1.15);
  followSpin(world.body, world.catch.spinFrom + world.catch.turn * aimed, dt, feel.catchSpin);
  const speed = Math.hypot(world.body.vx, world.body.vy);
  const hung =
    world.catch.stage === 'back' &&
    world.body.y > peg.y &&
    Math.abs(reach - feel.restDrop) < 4 &&
    speed < 40;
  if (hung) world.catch = null;
}

function stepHang(world: SlingWorld, dt: number): void {
  const peg = pegById(world, world.heldId);
  if (world.catch) {
    stepCatch(world, peg, dt);
    return;
  }
  stepAttached(world, dt, false);
  const before = world.body.spin;
  easeSpin(world.body, 0, dt, feel.settleSpin);
  if (before * world.body.spin < 0) {
    world.body.spin = 0;
    world.body.spinVel = 0;
  }
}

function stepLaunch(world: SlingWorld, dt: number): void {
  world.leftLock = Math.max(0, world.leftLock - dt);
  const shot = world.shot;
  const peg = pegById(world, world.heldId);
  if (!shot || shot.extension <= 0) {
    world.shot = null;
    detach(world);
    return;
  }
  shot.age += dt;
  const omega = feel.armOmega;
  const phase = omega * shot.age;
  const slack = armSlack();
  const done = phase >= Math.PI / 2;
  const along = done ? 0 : Math.cos(phase);
  const reach = slack + shot.extension * along;
  const speed = omega * shot.extension * (done ? 1 : Math.sin(phase));
  world.body.x = peg.x + shot.outX * reach;
  world.body.y = peg.y + shot.outY * reach;
  world.body.vx = -shot.outX * speed;
  world.body.vy = -shot.outY * speed;
  world.body.spin += world.body.spinVel * dt;
  simWrite(world.sim, world.body.x, world.body.y, world.body.vx, world.body.vy);
  if (!done) return;
  world.shot = null;
  detach(world);
}

function stepReturn(world: SlingWorld, dt: number): void {
  stepAttached(world, dt, false);
}

function stepFly(world: SlingWorld, dt: number): void {
  world.leftLock = Math.max(0, world.leftLock - dt);
  const vxBefore = world.body.vx;
  simWrite(world.sim, world.body.x, world.body.y, world.body.vx, world.body.vy);
  simStep(world.sim, dt);
  syncFromSim(world);
  if (vxBefore * world.body.vx < 0 && Math.abs(vxBefore) > 80) {
    world.body.spinVel += (world.body.vx - vxBefore) * feel.hitSpin;
  }
  world.body.spin += world.body.spinVel * dt;

  // The arm catches when the body reaches a peg. The peg then becomes the anchor.
  let best: Peg | null = null;
  let bestDist = feel.grabRadius;
  for (const peg of world.pegs) {
    const dx = world.body.x - peg.x;
    const dy = world.body.y - peg.y;
    const dist = Math.hypot(dx, dy);
    if (peg.id === world.leftId) {
      if (dist > feel.grabRadius) world.leftCleared = true;
      if (!world.leftCleared || world.leftLock > 0) continue;
    }
    if (pegSpent(peg)) continue;
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

function dropSpentHold(world: SlingWorld): void {
  const held = world.pegs.find((peg) => peg.id === world.heldId);
  if (!held || !pegSpent(held)) return;
  if (world.phase !== 'hang' && world.phase !== 'drag' && world.phase !== 'return') return;
  world.fullPull = false;
  world.catch = null;
  world.shot = null;
  world.phase = 'fly';
  world.leftId = held.id;
  world.leftLock = feel.oldPegLock;
  world.leftCleared = false;
}

function tickPegs(world: SlingWorld, dt: number): void {
  const hanging = world.phase === 'hang' || world.phase === 'drag' || world.phase === 'return';
  for (const peg of world.pegs) tickPeg(peg, dt, hanging && peg.id === world.heldId);
}

export function stepWorld(world: SlingWorld, dt: number): void {
  tickPegs(world, dt);
  dropSpentHold(world);
  world.flash = Math.max(0, world.flash - dt);
  if (world.squash >= 0) {
    world.squash += dt;
    if (world.squash > 0.34) world.squash = -1;
  }
  // Drag and the dead-zone return show the crown toward the peg.
  // A launch rolls instead, and that spinVel continues into the flight.
  if (world.phase === 'drag' || world.phase === 'return') {
    easeSpin(world.body, heldAim(world), dt, feel.aimSpin);
  }
  if (world.phase === 'return') stepReturn(world, dt);
  else if (world.phase === 'launch') stepLaunch(world, dt);
  else if (world.phase === 'fly') stepFly(world, dt);
  else if (world.phase === 'hang') stepHang(world, dt);
  placeCamera(world, dt);
  // A fast downward shot outruns the camera. Dying at the screen edge
  // skips a peg that is still below the body. Fall only while moving
  // downward, past the lowest peg, and off the bottom of the camera.
  // An upward flight that starts below the screen is not a death.
  const lowest = world.pegs.reduce((y, peg) => Math.max(y, peg.y), -Infinity);
  if (
    (world.phase === 'fly' || world.phase === 'launch') &&
    world.body.vy > 0 &&
    world.body.y > lowest + feel.grabRadius &&
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
