import { mulberry32, nextPeg, firstPeg } from './pegs';
import { createWorld, dragTo, endDrag, stepWorld, tryBeginDrag } from './sling';
import { GRAB_RADIUS, MAX_PULL, MIN_PULL } from './tune';

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

const world = createWorld(mulberry32(1));
assert(world.pegs.length === 5, `expected 5 pegs, got ${world.pegs.length}`);
assert(world.body.y === world.pegs[0].y + 78, 'body hangs below the peg');

const origin = firstPeg(1);
const rng = mulberry32(2);
let prev = origin;
for (let i = 0; i < 20; i += 1) {
  const peg = nextPeg(prev, rng, i + 2);
  const dist = Math.hypot(peg.x - prev.x, peg.y - prev.y);
  assert(peg.y < prev.y, 'next peg must be up the shaft');
  assert(dist <= 280, `peg too far ${dist}`);
  prev = peg;
}

assert(tryBeginDrag(world, world.body.x, 820) === false, 'bottom edge must refuse a new drag');
assert(tryBeginDrag(world, world.body.x + 80, world.body.y) === false, 'miss must refuse');
assert(tryBeginDrag(world, world.body.x, world.body.y) === true, 'press on the body');

dragTo(world, world.body.x, world.body.y + 10);
endDrag(world);
assert(world.phase === 'hang', 'short pull cancels');

assert(tryBeginDrag(world, world.body.x, world.body.y), 'press again');
const peg = world.pegs[0];
dragTo(world, peg.x, world.body.y + MAX_PULL);
const camBefore = world.cameraY;
stepWorld(world, 1 / 60);
assert(Math.abs(world.cameraY - camBefore) < 2, 'aim camera stays on the peg');
endDrag(world);
assert(world.phase === 'fly', 'full pull launches');
assert(world.body.vy < 0, 'downward pull launches up');

const y0 = world.body.y;
for (let i = 0; i < 27; i += 1) stepWorld(world, 1 / 60);
assert(world.body.y < y0 - 150 || world.phase === 'hang', 'full pull climbs');

let grabbed = world.phase === 'hang';
for (let i = 0; i < 90 && world.phase === 'fly'; i += 1) stepWorld(world, 1 / 60);
grabbed = grabbed || world.phase === 'hang';
assert(grabbed, 'a generated peg is reachable');
assert(world.leftLock === 0 || world.heldId !== world.leftId, 'did not stick to the peg just left');

const near = createWorld(mulberry32(3));
tryBeginDrag(near, near.body.x, near.body.y);
dragTo(near, near.body.x, near.body.y + MIN_PULL);
endDrag(near);
assert(near.phase === 'fly', 'min pull still fires');
assert(near.leftLock > 0, 'old peg is locked');
const stuck = near.pegs[0];
near.body.x = stuck.x;
near.body.y = stuck.y + 78;
stepWorld(near, 1 / 60);
assert(near.phase === 'fly', 'locked peg is not grabbed inside the radius');
assert(GRAB_RADIUS > 0, 'radius used');

console.log('sling self-test ok');
