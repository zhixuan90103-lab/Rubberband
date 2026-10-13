import { mulberry32 } from './pegs';
import { initPhysics } from './sim';
import { createWorld, dragTo, endDrag, pointerToWorld, stepWorld, tryBeginDrag } from './sling';
import { BODY_RADIUS, GRAB_RADIUS, HANG_DROP, MAX_PULL, MIN_PULL, REST_DROP, SHAFT_LEFT, SHAFT_RIGHT, WALL_RESTITUTION } from './tune';

function shortestSpin(delta: number): number {
  const tau = Math.PI * 2;
  return delta - Math.round(delta / tau) * tau;
}

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

await initPhysics();

const world = createWorld(mulberry32(1));
assert(world.pegs.length === 2, `expected 2 pegs, got ${world.pegs.length}`);
assert(world.body.y === world.pegs[0].y + REST_DROP, 'body hangs below the peg');
assert(world.pegs[1].x === world.pegs[0].x, 'the upper peg is centered on the start peg');
assert(world.pegs[1].y < world.pegs[0].y, 'the upper peg is above the start peg');

const onScreen = pointerToWorld(world, world.body.x, world.body.y - world.cameraY);
assert(Math.abs(onScreen.y - world.body.y) < 1e-6, 'drawn body maps back to world');
assert(Math.abs(world.body.y - world.cameraY) > 200, 'body is not at the same y as the screen point');

assert(tryBeginDrag(world, world.body.x, 820) === false, 'bottom edge must refuse a new drag');
assert(tryBeginDrag(world, world.body.x + 80, world.body.y) === false, 'miss must refuse');
assert(tryBeginDrag(world, world.body.x, world.body.y) === true, 'press on the body');

dragTo(world, world.body.x, world.body.y + 10);
endDrag(world);
assert(world.phase === 'return', 'short pull eases back');
assert(tryBeginDrag(world, world.body.x, world.body.y), 'press interrupts the return');
endDrag(world);

assert(tryBeginDrag(world, world.body.x, world.body.y), 'press again');
const peg = world.pegs[0];
dragTo(world, peg.x, world.body.y + MAX_PULL);
const camBefore = world.cameraY;
stepWorld(world, 1 / 60);
assert(Math.abs(world.cameraY - camBefore) < 2, 'aim camera stays on the peg');
endDrag(world);
assert(world.phase === 'launch', 'full pull starts the contraction');
assert(Math.hypot(world.body.vx, world.body.vy) < 1, 'speed is still near zero at release');

let detached = false;
for (let i = 0; i < 40 && world.phase === 'launch'; i += 1) {
  stepWorld(world, 1 / 60);
  if (world.phase === 'launch') {
    assert(world.cameraY <= camBefore + 0.01, 'launch does not drop the camera');
  }
}
detached = world.phase === 'fly' || world.phase === 'hang';
assert(detached, 'the arm goes slack');
if (world.phase === 'fly') {
  const reach = Math.hypot(world.body.x - peg.x, world.body.y - peg.y);
  assert(Math.abs(reach - HANG_DROP) < 2, 'slack is the hang length');
  assert(world.body.vy < -100, 'downward pull is moving up at slack');
}

const y0 = world.body.y;
for (let i = 0; i < 40; i += 1) stepWorld(world, 1 / 60);
assert(world.body.y < y0 - 80 || world.phase === 'hang', 'full pull climbs');

let grabbed = world.phase === 'hang';
for (let i = 0; i < 120 && world.phase === 'fly'; i += 1) stepWorld(world, 1 / 60);
grabbed = grabbed || world.phase === 'hang';
assert(grabbed, 'a generated peg is reachable');
assert(world.heldId !== world.leftId, 'did not stick to the peg just left');

const upward = createWorld(mulberry32(4));
const upPeg = upward.pegs[0];
assert(tryBeginDrag(upward, upward.body.x, upward.body.y), 'press for an upward pull');
dragTo(upward, upPeg.x, upPeg.y - (REST_DROP + MAX_PULL));
const upReach = Math.hypot(upward.body.x - upPeg.x, upward.body.y - upPeg.y);
assert(upward.body.y < upPeg.y, 'the body can be pulled above the peg');
assert(Math.abs(upReach - (REST_DROP + MAX_PULL)) < 1, 'upward pull uses the same max arm length');
endDrag(upward);
assert(upward.phase === 'launch', 'an upward pull launches');
for (let i = 0; i < 40 && upward.phase === 'launch'; i += 1) stepWorld(upward, 1 / 60);
assert(upward.phase === 'fly', 'the upward pull goes slack');
assert(upward.body.vy > 100, 'pulling above the peg launches downward');

const down = createWorld(mulberry32(8));
const lower = down.pegs[0];
const upper = down.pegs[1];
down.heldId = upper.id;
down.body.x = upper.x;
down.body.y = upper.y + REST_DROP;
down.cameraY = down.body.y - 844 * 0.7;
assert(tryBeginDrag(down, down.body.x, down.body.y), 'press on the upper peg');
dragTo(down, upper.x, upper.y - (REST_DROP + MAX_PULL));
endDrag(down);
for (let i = 0; i < 240 && down.phase !== 'hang' && down.phase !== 'fall'; i += 1) stepWorld(down, 1 / 60);
assert(down.phase === 'hang' && down.heldId === lower.id, 'a downward shot catches the peg below');
assert(Math.hypot(down.body.x - lower.x, down.body.y - lower.y) < REST_DROP - 8, 'the catch does not snap the arms to full length');
for (let i = 0; i < 180 && down.phase === 'hang'; i += 1) stepWorld(down, 1 / 60);
assert(
  Math.abs(Math.hypot(down.body.x - lower.x, down.body.y - lower.y) - REST_DROP) < 8,
  'the arms extend back to the hang length',
);
assert(down.phase === 'hang', 'the swing stays on the peg');

const angled = createWorld(mulberry32(5));
const sidePeg = angled.pegs[0];
tryBeginDrag(angled, angled.body.x, angled.body.y);
dragTo(angled, sidePeg.x + 400, sidePeg.y + 40);
const adx = angled.body.x - sidePeg.x;
const ady = angled.body.y - sidePeg.y;
assert(angled.body.x <= SHAFT_RIGHT - BODY_RADIUS + 0.01, 'a sideways pull stays in the shaft');
assert(Math.abs(adx * 40 - ady * 400) < 2, 'the shaft limit keeps the arm on the peg ray');

const near = createWorld(mulberry32(3));
tryBeginDrag(near, near.body.x, near.body.y);
dragTo(near, near.body.x, near.body.y + MIN_PULL);
endDrag(near);
assert(near.phase === 'launch', 'min pull still fires');
assert(near.leftId === near.pegs[0].id && near.leftCleared === false, 'old peg is marked');
const stuck = near.pegs[0];
near.body.x = stuck.x;
near.body.y = stuck.y + HANG_DROP;
stepWorld(near, 1 / 60);
assert(near.phase === 'fly', 'locked peg is not grabbed inside the radius');
assert(GRAB_RADIUS > 0, 'radius used');

const swing = createWorld(mulberry32(4));
const anchor = swing.pegs[0];
swing.body.x = anchor.x + REST_DROP;
swing.body.y = anchor.y;
swing.body.vy = -400;
let rose = false;
let maxReach = 0;
for (let i = 0; i < 180; i += 1) {
  stepWorld(swing, 1 / 60);
  const x = swing.body.x - anchor.x;
  if (swing.body.y < anchor.y - 10) rose = true;
  maxReach = Math.max(maxReach, Math.hypot(x, swing.body.y - anchor.y));
}
assert(swing.phase === 'hang', 'a catch stays on the peg until the player pulls');
assert(rose, 'the incoming speed carries the body up the rope');
assert(maxReach < REST_DROP + 14, 'the rope stays near the hang length');
assert(tryBeginDrag(swing, swing.body.x, swing.body.y), 'press interrupts the swing');

const arc = createWorld(mulberry32(5));
const arcPeg = arc.pegs[0];
arc.body.x = arcPeg.x + Math.sin(0.7) * REST_DROP;
arc.body.y = arcPeg.y + Math.cos(0.7) * REST_DROP;
arc.body.vx = 0;
arc.body.vy = 0;
for (let i = 0; i < 24; i += 1) stepWorld(arc, 1 / 60);
const swung = Math.atan2(arc.body.x - arcPeg.x, arc.body.y - arcPeg.y);
assert(arc.phase === 'hang', 'an offset hang keeps the rope');
assert(Math.abs(swung) < 0.7, 'gravity pulls the swing down');
assert(Math.abs(swung) > 0.05, 'the swing does not stick on the way down');
arc.body.spin = 1.2;
arc.body.spinVel = 4;
for (let i = 0; i < 150; i += 1) stepWorld(arc, 1 / 60);
const settled = Math.atan2(arc.body.x - arcPeg.x, arc.body.y - arcPeg.y);
const settledAim = Math.atan2(arcPeg.x - arc.body.x, -(arcPeg.y - arc.body.y));
let tilt = settledAim - arc.body.spin;
tilt -= Math.round(tilt / (Math.PI * 2)) * Math.PI * 2;
assert(Math.abs(settled) < 0.08, 'the rope stops under the peg');
assert(Math.hypot(arc.body.vx, arc.body.vy) < 1, 'the rope does not keep swinging');
assert(Math.abs(tilt) < 0.05, 'the body squares onto the arm');

const wall = createWorld(mulberry32(6));
wall.phase = 'fly';
wall.body.x = SHAFT_LEFT + BODY_RADIUS + 2;
wall.body.vx = -400;
wall.body.vy = -200;
stepWorld(wall, 1 / 60);
assert(wall.phase === 'fly', 'a wall hit does not end the run');
assert(wall.body.x >= SHAFT_LEFT + BODY_RADIUS - 0.01, 'the body stays inside the shaft');
assert(wall.body.vx > 0, 'horizontal speed reverses');
assert(wall.body.vx <= 400 * WALL_RESTITUTION + 1, 'the bounce keeps the restitution');
assert(Math.abs(wall.body.spinVel) > 5, 'a wall hit adds a tumble');

const rise = createWorld(mulberry32(7));
const risePeg = rise.pegs[0];
rise.phase = 'fly';
rise.body.x = risePeg.x;
rise.body.y = risePeg.y + GRAB_RADIUS + 40;
rise.body.vx = 0;
rise.body.vy = -800;
rise.body.spin = 0;
for (let i = 0; i < 30 && String(rise.phase) === 'fly'; i += 1) stepWorld(rise, 1 / 60);
assert(String(rise.phase) === 'hang', 'an upward arrival catches');
if (!rise.catch) throw new Error('a catch starts the band');
const spin0 = rise.body.spin;
let highest = rise.body.y;
let longest = 0;
let fell = false;
let spun = 0;
for (let i = 0; i < 240; i += 1) {
  stepWorld(rise, 1 / 60);
  spun = Math.max(spun, Math.abs(shortestSpin(rise.body.spin - spin0)));
  highest = Math.min(highest, rise.body.y);
  longest = Math.max(longest, Math.hypot(rise.body.x - risePeg.x, rise.body.y - risePeg.y));
  if (highest < risePeg.y && rise.body.vy > 200) fell = true;
}
assert(longest <= REST_DROP * 2 + 1, 'the band stretches at most one extra hang length');
assert(highest < risePeg.y - 20, 'the body carries above the peg');
assert(fell, 'the body falls back under gravity');
assert(spun > 1, 'the body spins about its own center');
assert(Math.abs(Math.hypot(rise.body.x - risePeg.x, rise.body.y - risePeg.y) - REST_DROP) < 14, 'the arms return to the hang length');
assert(rise.catch === null, 'the body settles on the hang');

console.log('sling self-test ok');
