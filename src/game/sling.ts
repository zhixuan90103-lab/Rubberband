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
import {
  beginPegCooldown,
  claimPeg,
  createPegPool,
  freshRowMemory,
  pegBand,
  pegSpent,
  planNextRow,
  releasePeg,
  tickPeg,
  type Peg,
  type PegBand,
  type Rng,
  type RowMemory,
} from './pegs';
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
  AIM_EXTRA,
  feel,
  FIXED_DT,
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

/**
 * Catch facing, separate from the arm.
 * `watch` only keeps the flight spin. `arc` is one locked long turn to
 * crown-up. `settle` is the short turn to the nearest upright.
 */
export type CatchFacing =
  | { kind: 'watch'; fromX: number; fromY: number; fromAngle: number; sign: number }
  | { kind: 'arc'; goal: number }
  | { kind: 'settle' };

/** Present while the catch band has not settled back to the hang length. */
export type Catch = {
  held: true;
  /** Unit direction of the velocity at the grab. Overshoot is motion along this. */
  dirX: number;
  dirY: number;
  /** Speed along that direction at the grab. */
  surge0: number;
  /**
   * Facing while this catch lasts. Watch the rope first. A real swing
   * locks one long arc. A rope that dies first settles to the nearest upright.
   */
  facing: CatchFacing;
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
  /** Y of the last row placed. The birth row uses the green peg. */
  rowY: number;
  /** Shape of the last row, so the next row does not repeat it. */
  rowMemory: RowMemory;
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
  /** Increments once each time a flight grab lands. The view plays the burst. */
  grabPulse: number;
  /** The finger is past the arm cap, and the wall did not stop it short. */
  fullPull: boolean;
  /** Peg given a wider catch for this shot. -1 means no assist. */
  aimId: number;
  /** Catch radius used for `aimId` until the flight grabs or ends. */
  aimRadius: number;
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

function livePegs(world: SlingWorld): Peg[] {
  return world.pegs.filter((peg) => peg.live);
}

function highest(world: SlingWorld): Peg | null {
  const live = livePegs(world);
  if (live.length === 0) return null;
  return live.reduce((top, peg) => (peg.y < top.y ? peg : top));
}

function lowest(world: SlingWorld): Peg | null {
  const live = livePegs(world);
  if (live.length === 0) return null;
  return live.reduce((bottom, peg) => (peg.y > bottom.y ? peg : bottom));
}

function pegReserved(world: SlingWorld, peg: Peg): boolean {
  return peg.id === world.heldId || peg.id === world.leftId;
}

/** Move free slots onto the next row. The pool size never changes. */
function placeNextRow(world: SlingWorld): boolean {
  const plan = planNextRow(world.rowY, world.rng, world.rowMemory);
  const spots = plan.spots;
  const claimed: Peg[] = [];
  for (let i = 0; i < spots.length; i += 1) {
    const peg = claimPeg(world.pegs);
    if (!peg) {
      for (const taken of claimed) releasePeg(taken);
      return false;
    }
    claimed.push(peg);
  }
  for (let i = 0; i < spots.length; i += 1) {
    const peg = claimed[i];
    const spot = spots[i];
    peg.x = spot.x;
    peg.y = spot.y;
    peg.kind = spot.kind;
    peg.age = 0;
    peg.cool = 0;
  }
  world.rowY = Math.min(...spots.map((spot) => spot.y));
  world.rowMemory = plan.memory;
  return true;
}

/** Free the lowest unreserved peg that is already below the screen. */
function evictBelowView(world: SlingWorld, band: PegBand): boolean {
  let spare: Peg | null = null;
  for (const peg of world.pegs) {
    if (!peg.live || pegReserved(world, peg)) continue;
    if (peg.y <= band.viewBottom) continue;
    if (!spare || peg.y > spare.y) spare = peg;
  }
  if (!spare) return false;
  releasePeg(spare);
  return true;
}

/**
 * The live field is the camera band. Recycle outside it, then place rows
 * until the top sits on the fill line. A full pool evicts off-screen
 * nails below the view so the window can still grow upward.
 */
function refillPegs(world: SlingWorld): void {
  const band = pegBand(world.cameraY);
  for (const peg of world.pegs) {
    if (!peg.live || pegReserved(world, peg)) continue;
    if (peg.y < band.keepTop || peg.y > band.keepBottom) releasePeg(peg);
  }
  const top = highest(world);
  if (!top) {
    world.rowY = 0;
    world.rowMemory = freshRowMemory();
  } else if (top.y > world.rowY) {
    world.rowY = top.y;
    world.rowMemory = { ...world.rowMemory, stage: 'run' };
  }
  for (let n = 0; n < world.pegs.length * 2; n += 1) {
    const head = highest(world);
    if (head && head.y <= band.fillTop) break;
    if (placeNextRow(world)) continue;
    if (!evictBelowView(world, band)) break;
  }
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
  world.aimId = -1;
  world.aimRadius = feel.grabRadius;
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
    const floor = lowest(world);
    if (floor && world.body.y > floor.y + feel.grabRadius) {
      const held = Math.min(bodyFrame, hangPoint(floor).y - anchorY());
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
  const pegs = createPegPool();
  const world: SlingWorld = {
    phase: 'hang',
    pegs,
    rowY: 0,
    rowMemory: freshRowMemory(),
    heldId: 1,
    leftId: -1,
    leftLock: 0,
    leftCleared: true,
    body: { x: 0, y: 0, vx: 0, vy: 0, spin: 0, spinVel: 0 },
    catch: null,
    shot: null,
    pullX: 0,
    pullY: 0,
    flash: 0,
    squash: -1,
    grabPulse: 0,
    fullPull: false,
    aimId: -1,
    aimRadius: feel.grabRadius,
    cameraY: 0,
    cameraX: 0,
    cameraVel: 0,
    cameraVelX: 0,
    height: 0,
    rng,
    sim: createSim(0, 0),
  };
  placeNextRow(world);
  const origin = world.pegs[0];
  world.heldId = origin.id;
  world.body.x = origin.x;
  world.body.y = origin.y + feel.restDrop;
  world.cameraY = world.body.y - anchorY();
  simWrite(world.sim, world.body.x, world.body.y, 0, 0);
  refillPegs(world);
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

/** The system took the touch. Ease back even if the arm is already past a shot. */
export function cancelDrag(world: SlingWorld): void {
  if (world.phase !== 'drag') return;
  world.pullX = 0;
  world.pullY = 0;
  world.fullPull = false;
  world.shot = null;
  world.aimId = -1;
  world.aimRadius = feel.grabRadius;
  world.body.vx = 0;
  world.body.vy = 0;
  simWrite(world.sim, world.body.x, world.body.y, 0, 0);
  world.phase = 'return';
}

export type AimRead = {
  points: { x: number; y: number }[];
  pegId: number;
  radius: number;
};

/**
 * The flight this pull would take, and the one peg it is clearly aimed at.
 * The curve uses the same release point, speed, and gravity as a real shot.
 */
export function readAim(world: SlingWorld): AimRead {
  const none = (points: { x: number; y: number }[]): AimRead => ({
    points,
    pegId: -1,
    radius: feel.grabRadius,
  });
  if (world.phase !== 'drag') return none([]);
  const peg = pegById(world, world.heldId);
  const dx = world.body.x - peg.x;
  const dy = world.body.y - peg.y;
  const reach = Math.hypot(dx, dy) || 1;
  const extension = Math.max(0, reach - armSlack());
  if (extension < 1) return none([]);
  const outX = dx / reach;
  const outY = dy / reach;
  const speed = feel.armOmega * extension;
  let x = peg.x + outX * armSlack();
  let y = peg.y + outY * armSlack();
  let vx = -outX * speed;
  let vy = -outY * speed;
  const dt = 1 / 60;
  const left = SHAFT_LEFT + BODY_RADIUS;
  const right = SHAFT_RIGHT - BODY_RADIUS;
  const points = [{ x, y }];
  const misses = new Map<number, number>();
  const floor = world.cameraY + DESIGN_HEIGHT + 40;
  for (let i = 0; i < 110; i += 1) {
    vy += feel.gravity * dt;
    x += vx * dt;
    y += vy * dt;
    if (x < left) {
      x = left;
      vx = Math.abs(vx) * feel.wallRestitution;
    } else if (x > right) {
      x = right;
      vx = -Math.abs(vx) * feel.wallRestitution;
    }
    points.push({ x, y });
    for (const candidate of world.pegs) {
      if (!candidate.live || pegSpent(candidate) || candidate.id === peg.id) continue;
      const dist = Math.hypot(candidate.x - x, candidate.y - y);
      const prev = misses.get(candidate.id);
      if (prev === undefined || dist < prev) misses.set(candidate.id, dist);
    }
    if (y > floor && vy > 0) break;
  }
  let pegId = -1;
  let secondId = -1;
  let first = Infinity;
  let second = Infinity;
  for (const [id, dist] of misses) {
    if (dist < first) {
      second = first;
      secondId = pegId;
      first = dist;
      pegId = id;
    } else if (dist < second) {
      second = dist;
      secondId = id;
    }
  }
  const cap = feel.grabRadius + AIM_EXTRA;
  if (pegId < 0 || first > cap) return none(points);
  const radius = first <= feel.grabRadius ? feel.grabRadius : cap;
  // Aiming between two pegs still assists the nearer one, unless the
  // widened catch would overlap the other peg's catch.
  if (radius > feel.grabRadius && secondId >= 0 && second <= cap) {
    const chosen = pegById(world, pegId);
    const other = pegById(world, secondId);
    const gap = Math.hypot(chosen.x - other.x, chosen.y - other.y);
    if (gap <= radius + cap) return none(points);
  }
  return { points, pegId, radius };
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
    world.aimId = -1;
    world.aimRadius = feel.grabRadius;
    world.phase = 'return';
    return;
  }
  const aim = readAim(world);
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
  world.aimId = aim.pegId;
  world.aimRadius = aim.radius;
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
  world.grabPulse += 1;
  world.pullX = 0;
  world.pullY = 0;
  world.aimId = -1;
  world.aimRadius = feel.grabRadius;
  if (reach < 1) {
    const dir = Math.hypot(world.body.vx, world.body.vy) || 1;
    dx = (world.body.vx / dir) * 14;
    dy = (world.body.vy / dir) * 14;
    reach = 14;
    world.body.x = peg.x + dx;
    world.body.y = peg.y + dy;
  }
  const speed = Math.hypot(world.body.vx, world.body.vy) || 1;
  world.catch = {
    held: true,
    dirX: world.body.vx / speed,
    dirY: world.body.vy / speed,
    surge0: speed,
    facing: {
      kind: 'watch',
      fromX: world.body.x,
      fromY: world.body.y,
      fromAngle: Math.atan2(dx, dy),
      sign: catchTurnSign(dx, dy, world.body.vx, world.body.vy),
    },
    stage: 'out',
    progress: 0,
    span: 1,
  };
  world.height = Math.max(world.height, -peg.y);
  refillPegs(world);
}

const REST_SPEED = 16;
const REST_ANGLE = 0.06;
/** Body travel after the grab that counts as a real rope swing. */
const CATCH_SWING_MOVE = 72;
/** Rope-angle change after the grab that counts as a real swing. */
const CATCH_SWING_ANGLE = 1.05;

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

/** Which way a long catch turn goes. Sideways hits follow the tangent. */
function catchTurnSign(dx: number, dy: number, vx: number, vy: number): number {
  const reach = Math.hypot(dx, dy) || 1;
  const tangent = (dx * vy - dy * vx) / reach;
  return Math.sign(tangent) || -Math.sign(vy) || 1;
}

/** How far the rope has moved since the grab. */
function ropeSwing(facing: Extract<CatchFacing, { kind: 'watch' }>, x: number, y: number, pegX: number, pegY: number): { moved: number; turned: number } {
  const moved = Math.hypot(x - facing.fromX, y - facing.fromY);
  let turned = Math.atan2(x - pegX, y - pegY) - facing.fromAngle;
  const tau = Math.PI * 2;
  turned -= Math.round(turned / tau) * tau;
  return { moved, turned };
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
  const speed = Math.hypot(world.body.vx, world.body.vy);
  const hung =
    world.catch.stage === 'back' &&
    world.body.y > peg.y &&
    Math.abs(reach - feel.restDrop) < 4 &&
    speed < 40;
  world.catch.facing = stepCatchFacing(world.body, world.catch.facing, peg, world.catch.surge0, world.catch.stage, dt);
  if (world.catch.facing.kind === 'watch') return;
  const goal = catchGoal(world.catch.facing, world.body.spin);
  const landed = Math.abs(world.body.spin - goal) < 0.08 && Math.abs(world.body.spinVel) < 0.6;
  if (hung && landed) world.catch = null;
}

/**
 * One catch pose. A rope that swings locks the long arc. A rope that
 * stops first uses the hang settle. Arrival speed only scales the long arc.
 */
function stepCatchFacing(body: Body, facing: CatchFacing, peg: Peg, surge0: number, stage: Catch['stage'], dt: number): CatchFacing {
  if (facing.kind === 'watch') {
    body.spin += body.spinVel * dt;
    const swing = ropeSwing(facing, body.x, body.y, peg.x, peg.y);
    if (swing.moved >= CATCH_SWING_MOVE || Math.abs(swing.turned) >= CATCH_SWING_ANGLE) {
      return { kind: 'arc', goal: body.spin + turnToUpright(body.spin, facing.sign) };
    }
    if (stage === 'back') return { kind: 'settle' };
    return facing;
  }
  const goal = catchGoal(facing, body.spin);
  const rate = facing.kind === 'arc' ? catchTurnRate(surge0) : feel.settleSpin;
  steerSpin(body, goal, dt, rate);
  return facing;
}

function catchGoal(facing: Exclude<CatchFacing, { kind: 'watch' }>, spin: number): number {
  return facing.kind === 'arc' ? facing.goal : nearestAngle(spin, 0);
}

function stepHang(world: SlingWorld, dt: number): void {
  const peg = pegById(world, world.heldId);
  if (world.catch) {
    stepCatch(world, peg, dt);
    return;
  }
  stepAttached(world, dt, false);
  steerSpin(world.body, nearestAngle(world.body.spin, 0), dt, feel.settleSpin);
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
  let bestDist = Infinity;
  for (const peg of world.pegs) {
    const dx = world.body.x - peg.x;
    const dy = world.body.y - peg.y;
    const dist = Math.hypot(dx, dy);
    if (peg.id === world.leftId) {
      if (dist > feel.grabRadius) world.leftCleared = true;
      if (!world.leftCleared || world.leftLock > 0) continue;
    }
    if (!peg.live || pegSpent(peg)) continue;
    const limit = peg.id === world.aimId ? world.aimRadius : feel.grabRadius;
    if (dist <= limit && dist < bestDist) {
      best = peg;
      bestDist = dist;
    }
  }
  if (best) grab(world, best);
}

/**
 * Angle that lands on crown-up by the longer arc. A 10° miss therefore
 * turns almost a full circle. Exactly upright takes a full turn; `sign`
 * picks which way.
 */
function turnToUpright(spin: number, sign: number): number {
  const tau = Math.PI * 2;
  let short = -spin;
  short -= Math.round(short / tau) * tau;
  if (Math.abs(short) < 1e-3) return (sign >= 0 ? 1 : -1) * tau;
  const longSign = short > 0 ? -1 : 1;
  return longSign * (tau - Math.abs(short));
}

/**
 * Panel `catchSpin` is the rate of a full-power arrival. A softer grab
 * uses a slower turn, down to 40% when the body is nearly stopped.
 */
function catchTurnRate(arrivalSpeed: number): number {
  const full = feel.armOmega * Math.max(1, armMax() - armSlack());
  const power = Math.min(1, Math.max(0, arrivalSpeed / full));
  return feel.catchSpin * (0.4 + 0.6 * power);
}

/** Absolute angle nearest to `spin` that faces `target`. */
function nearestAngle(spin: number, target: number): number {
  const tau = Math.PI * 2;
  let delta = target - spin;
  delta -= Math.round(delta / tau) * tau;
  return spin + delta;
}

/**
 * One turn for every aimed pose. Critically damped, so a new goal
 * keeps the spin the body already has and eases onto the new angle.
 */
function steerSpin(body: Body, goal: number, dt: number, omega: number): void {
  const delta = goal - body.spin;
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
  for (const peg of world.pegs) {
    if (peg.live) tickPeg(peg, dt, hanging && peg.id === world.heldId);
  }
}

export function stepWorld(world: SlingWorld, dt: number): void {
  tickPegs(world, dt);
  dropSpentHold(world);
  world.flash = Math.max(0, world.flash - dt);
  if (world.squash >= 0) {
    world.squash += dt;
    if (world.squash > 0.34) world.squash = -1;
  }
  // Aimed poses share one spring. Launch and flight only keep spinVel.
  if (world.phase === 'drag' || world.phase === 'return') {
    steerSpin(world.body, nearestAngle(world.body.spin, heldAim(world)), dt, feel.aimSpin);
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
  const floor = lowest(world);
  if (
    floor &&
    (world.phase === 'fly' || world.phase === 'launch') &&
    world.body.vy > 0 &&
    world.body.y > floor.y + feel.grabRadius &&
    world.body.y > world.cameraY + DESIGN_HEIGHT
  ) {
    world.phase = 'fall';
  }
  refillPegs(world);
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
