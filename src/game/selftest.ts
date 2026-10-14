import { mulberry32 } from './pegs';
import { initPhysics } from './sim';
import { beginEnter, createWorld, dragTo, endDrag, pointerToWorld, stepWorld, tryBeginDrag } from './sling';
import { armMax, armSlack, BLUE_PEG_LIFE, BODY_RADIUS, feel, PEG_LOWER_Y, PEG_UPPER_GAP, PEG_X_SPREAD, SHAFT_CENTER, SHAFT_LEFT, SHAFT_RIGHT } from './tune';

function shortestSpin(delta: number): number {
  const tau = Math.PI * 2;
  return delta - Math.round(delta / tau) * tau;
}

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

await initPhysics();

const world = createWorld(mulberry32(1));
assert(world.pegs.length === 4, `expected 4 pegs, got ${world.pegs.length}`);
assert(world.body.y === world.pegs[0].y + feel.restDrop, 'body hangs below the peg');
assert(world.pegs[1].x === world.pegs[0].x, 'the upper peg is centered on the start peg');
assert(Math.abs(world.pegs[0].y - PEG_LOWER_Y) < 0.5, 'the start peg sits on the feet');
assert(Math.abs(world.pegs[0].y - world.pegs[1].y - PEG_UPPER_GAP) < 0.5, 'the upper peg is 600px above the start peg');
assert(world.pegs[2].y === world.pegs[0].y && world.pegs[3].y === world.pegs[0].y, 'side pegs share the bottom row');
assert(world.pegs[2].x === world.pegs[0].x - PEG_X_SPREAD, 'one side peg is left of the bottom peg');
assert(world.pegs[3].x === world.pegs[0].x + PEG_X_SPREAD, 'one side peg is right of the bottom peg');
assert(world.pegs[2].kind === 'blue' && world.pegs[3].kind === 'red', 'bottom row is blue on the left and red on the right');

const onScreen = pointerToWorld(world, world.body.x, world.body.y - world.cameraY);
assert(Math.abs(onScreen.y - world.body.y) < 1e-6, 'drawn body maps back to world');
assert(Math.abs(world.body.y - world.cameraY) > 200, 'body is not at the same y as the screen point');

assert(tryBeginDrag(world, world.body.x, 820) === false, 'bottom edge must refuse a new drag');
assert(tryBeginDrag(world, world.body.x + 160, world.body.y) === false, 'miss must refuse');
const fingerX = world.body.x + 100;
assert(tryBeginDrag(world, fingerX, world.body.y) === true, 'press near the body');
dragTo(world, fingerX, world.body.y);
assert(Math.abs(world.body.x - fingerX) < 1e-6, 'the body moves to the finger');

dragTo(world, world.pegs[0].x, world.pegs[0].y + feel.restDrop + 10);
endDrag(world);
assert(world.phase === 'return', 'short pull eases back');
assert(tryBeginDrag(world, world.body.x, world.body.y), 'press interrupts the return');
endDrag(world);

assert(tryBeginDrag(world, world.body.x, world.body.y), 'press again');
const peg = world.pegs[0];
dragTo(world, peg.x, world.body.y + feel.maxPull);
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
  assert(Math.abs(reach - armSlack()) < 2, 'slack is the zero-force length');
  assert(world.body.vy < -100, 'downward pull is moving up at slack');
  const expected = feel.armOmega * (armMax() - armSlack());
  assert(Math.abs(Math.hypot(world.body.vx, world.body.vy) - expected) < 1, 'exit speed is the stretch times the rate');
}

const y0 = world.body.y;
for (let i = 0; i < 40; i += 1) stepWorld(world, 1 / 60);
assert(world.body.y < y0 - 80 || world.phase === 'hang', 'full pull climbs');

for (let i = 0; i < 120 && world.phase === 'fly'; i += 1) stepWorld(world, 1 / 60);

const upward = createWorld(mulberry32(4));
const upPeg = upward.pegs[0];
assert(tryBeginDrag(upward, upward.body.x, upward.body.y), 'press for an upward pull');
dragTo(upward, upPeg.x, upPeg.y - (feel.restDrop + feel.maxPull));
const upReach = Math.hypot(upward.body.x - upPeg.x, upward.body.y - upPeg.y);
assert(upward.body.y < upPeg.y, 'the body can be pulled above the peg');
assert(Math.abs(upReach - (feel.restDrop + feel.maxPull)) < 1, 'upward pull uses the same max arm length');
endDrag(upward);
assert(upward.phase === 'launch', 'an upward pull launches');
for (let i = 0; i < 40 && upward.phase === 'launch'; i += 1) stepWorld(upward, 1 / 60);
assert(upward.phase === 'fly', 'the upward pull goes slack');
assert(upward.body.vy > 100, 'pulling above the peg launches downward');
assert(Math.abs(Math.abs(upward.body.spinVel) - feel.launchSpin) < 0.05, 'a full pull spins at launchSpin');
assert(
  Math.abs(Math.hypot(upward.body.vx, upward.body.vy) - feel.armOmega * (armMax() - armSlack())) < 1,
  'an upward pull leaves at the same speed as a downward one',
);

const down = createWorld(mulberry32(8));
const lower = down.pegs[0];
const upper = down.pegs[1];
down.heldId = upper.id;
down.body.x = upper.x;
down.body.y = upper.y + feel.restDrop;
down.cameraY = down.body.y - 844 * 0.7;
assert(tryBeginDrag(down, down.body.x, down.body.y), 'press on the upper peg');
dragTo(down, upper.x, upper.y - (feel.restDrop + feel.maxPull));
endDrag(down);
for (let i = 0; i < 240 && down.phase !== 'hang' && down.phase !== 'fall'; i += 1) stepWorld(down, 1 / 60);
assert(down.phase === 'hang' && down.heldId === lower.id, 'a downward shot catches the peg below');
assert(Math.hypot(down.body.x - lower.x, down.body.y - lower.y) < feel.restDrop - 8, 'the catch does not snap the arms to full length');
for (let i = 0; i < 180 && down.phase === 'hang'; i += 1) stepWorld(down, 1 / 60);
assert(
  Math.abs(Math.hypot(down.body.x - lower.x, down.body.y - lower.y) - feel.restDrop) < 8,
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
dragTo(near, near.body.x, near.body.y + feel.minPull);
endDrag(near);
assert(near.phase === 'launch', 'min pull still fires');
assert(near.leftId === near.pegs[0].id && near.leftCleared === false, 'old peg is marked');
const stuck = near.pegs[0];
for (let i = 0; i < 8 && near.phase === 'launch'; i += 1) stepWorld(near, 1 / 60);
assert(near.phase === 'fly', 'locked peg is not grabbed inside the radius');
assert(near.heldId === stuck.id, 'the launch did not grab the peg it just left');
assert(feel.grabRadius > 0, 'radius used');

const swing = createWorld(mulberry32(4));
const anchor = swing.pegs[0];
swing.body.x = anchor.x + feel.restDrop;
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
assert(maxReach <= armMax() + 1, 'the arm stops at its maximum length');
assert(tryBeginDrag(swing, swing.body.x, swing.body.y), 'press interrupts the swing');

const bob = createWorld(mulberry32(9));
const bobPeg = bob.pegs[0];
bob.phase = 'fly';
bob.heldId = -1;
bob.body.x = bobPeg.x;
bob.body.y = bobPeg.y + 20;
bob.body.vy = -300;
for (let i = 0; i < 30 && bob.catch === null; i += 1) stepWorld(bob, 1 / 60);
assert(bob.catch !== null, 'a new peg starts the catch bob');
const bobFinger = bob.body.x + 90;
assert(tryBeginDrag(bob, bobFinger, bob.body.y), 'press interrupts the catch bob');
assert(bob.catch === null, 'the catch bob stops on press');
assert(bob.phase !== 'fly' && bob.phase !== 'hang', 'the press takes the body out of the catch');
dragTo(bob, bobFinger, bob.body.y);
assert(Math.abs(bob.body.x - bobFinger) < 1e-6, 'the catch bob moves to the finger');

const arc = createWorld(mulberry32(5));
const arcPeg = arc.pegs[0];
arc.body.x = arcPeg.x + Math.sin(0.7) * feel.restDrop;
arc.body.y = arcPeg.y + Math.cos(0.7) * feel.restDrop;
arc.body.vx = 0;
arc.body.vy = 0;
for (let i = 0; i < 24; i += 1) stepWorld(arc, 1 / 60);
const swung = Math.atan2(arc.body.x - arcPeg.x, arc.body.y - arcPeg.y);
assert(arc.phase === 'hang', 'an offset hang keeps the rope');
assert(Math.abs(swung) < 0.7, 'gravity pulls the swing down');
assert(Math.abs(swung) > 0.05, 'the swing does not stick on the way down');
for (let i = 0; i < 150; i += 1) stepWorld(arc, 1 / 60);
const settled = Math.atan2(arc.body.x - arcPeg.x, arc.body.y - arcPeg.y);
assert(Math.abs(settled) < 0.08, 'the rope stops under the peg');
assert(Math.hypot(arc.body.vx, arc.body.vy) < 1, 'the rope does not keep swinging');

const wall = createWorld(mulberry32(6));
wall.phase = 'fly';
wall.body.x = SHAFT_LEFT + BODY_RADIUS + 2;
wall.body.vx = -400;
wall.body.vy = -200;
stepWorld(wall, 1 / 60);
assert(wall.phase === 'fly', 'a wall hit does not end the run');
assert(wall.body.x >= SHAFT_LEFT + BODY_RADIUS - 1, 'the body stays inside the shaft');
assert(wall.body.vx > 0, 'horizontal speed reverses');
assert(wall.body.vx <= 400 * feel.wallRestitution + 1, 'the bounce keeps the restitution');
assert(Math.abs(wall.body.spinVel) > 0.5, 'a wall hit adds a tumble');

const rise = createWorld(mulberry32(7));
const risePeg = rise.pegs[0];
rise.phase = 'fly';
rise.body.x = risePeg.x;
rise.body.y = risePeg.y + feel.grabRadius + 40;
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
assert(longest <= armMax() + 1, 'the band stops at the same maximum as a pull');
assert(highest < risePeg.y, 'the body carries above the peg');
assert(fell, 'the body falls back under gravity');
assert(rise.body.y > risePeg.y, 'the body hangs below the peg');
assert(Math.abs(shortestSpin(rise.body.spin)) < 0.2, 'the body rests crown-up under the peg');
assert(Math.abs(Math.hypot(rise.body.x - risePeg.x, rise.body.y - risePeg.y) - feel.restDrop) < 14, 'the arms return to the hang length');
assert(rise.catch === null, 'the body settles on the hang');

const drop = createWorld(mulberry32(8));
const dropPeg = drop.pegs[0];
drop.phase = 'fly';
drop.body.x = dropPeg.x;
drop.body.y = dropPeg.y - feel.grabRadius - 30;
drop.body.vx = 0;
drop.body.vy = 700;
drop.body.spin = Math.PI;
for (let i = 0; i < 40 && String(drop.phase) === 'fly'; i += 1) stepWorld(drop, 1 / 60);
assert(String(drop.phase) === 'hang', 'a downward arrival catches');
for (let i = 0; i < 240; i += 1) stepWorld(drop, 1 / 60);
assert(drop.body.y > dropPeg.y, 'a downward catch ends under the peg');
assert(Math.abs(shortestSpin(drop.body.spin)) < 0.25, 'a downward catch ends crown-up');

const look = createWorld(mulberry32(10));
const centerPeg = look.pegs[0];
const leftPeg = look.pegs.find((peg) => peg.x < SHAFT_CENTER - 1);
const rightPeg = look.pegs.find((peg) => peg.x > SHAFT_CENTER + 1);
if (!leftPeg || !rightPeg) throw new Error('side pegs missing');
look.phase = 'drag';
look.heldId = centerPeg.id;
look.body.x = centerPeg.x - 80;
for (let i = 0; i < 40; i += 1) stepWorld(look, 1 / 60);
assert(Math.abs(look.cameraX) < 0.5, 'a peg in the center band does not shift the camera');

look.heldId = leftPeg.id;
look.body.x = leftPeg.x;
look.body.y = leftPeg.y + feel.restDrop;
look.phase = 'hang';
for (let i = 0; i < 20; i += 1) stepWorld(look, 1 / 60);
assert(Math.abs(look.cameraX) < 0.5, 'hanging on the left peg does not shift the camera');

look.phase = 'drag';
look.body.x = leftPeg.x + 50;
for (let i = 0; i < 40; i += 1) stepWorld(look, 1 / 60);
assert(Math.abs(look.cameraX) < 0.5, 'pulling inward from the left peg does not shift the camera');

look.body.x = leftPeg.x - 80;
for (let i = 0; i < 50; i += 1) stepWorld(look, 1 / 60);
assert(look.cameraX < -4, 'pulling from the left peg toward the wall shifts the camera');

look.phase = 'fly';
look.heldId = rightPeg.id;
look.body.x = rightPeg.x + 40;
for (let i = 0; i < 90; i += 1) stepWorld(look, 1 / 60);
assert(Math.abs(look.cameraX) < 0.5, 'flight does not keep a sideways camera shift');

const intro = createWorld(mulberry32(4));
const fellLeft = intro.pegs[0].x - 110;
beginEnter(intro, fellLeft);
assert(intro.phase === 'fly', 'respawn is a normal flight');
assert(intro.body.y > intro.pegs[0].y + feel.restDrop, 'the flight starts below the hang');
assert(Math.abs(intro.body.x - fellLeft) < 1, 'respawn starts where the body fell');
const fromRight = createWorld(mulberry32(5));
const fellRight = fromRight.pegs[0].x + 130;
beginEnter(fromRight, fellRight);
assert(Math.abs(fromRight.body.x - fellRight) < 1, 'a fall on the right relaunches from the right');
const introSpeed = Math.hypot(intro.body.vx, intro.body.vy);
const fullLaunch = feel.armOmega * Math.max(0, armMax() - armSlack());
assert(Math.abs(introSpeed - fullLaunch * 0.8) < 1, 'respawn speed is 0.8 of a full-pull launch');
assert(intro.body.spinVel > 0, 'respawn rolls on the way in');
assert(tryBeginDrag(intro, intro.body.x, intro.body.y) === false, 'a flight cannot be grabbed by a press');
const spinBefore = intro.body.spin;
stepWorld(intro, 1 / 60);
assert(intro.body.spin > spinBefore, 'the roll advances during the flight');
for (let i = 0; i < 180 && intro.phase === 'fly'; i += 1) stepWorld(intro, 1 / 60);
assert(intro.phase === 'hang', 'the flight grabs the spawn peg');
assert(intro.catch !== null, 'the grab uses the catch');
for (let i = 0; i < 240 && intro.catch; i += 1) stepWorld(intro, 1 / 60);
assert(intro.catch === null, 'the arm and gravity settle the catch');
assert(
  Math.abs(intro.body.y - (intro.pegs[0].y + feel.restDrop)) < 8,
  'the entrance settles near the hang length',
);

const cooled = createWorld(mulberry32(9));
const bluePeg = cooled.pegs[2];
cooled.heldId = bluePeg.id;
cooled.body.x = bluePeg.x;
cooled.body.y = bluePeg.y + feel.restDrop;
for (let i = 0; i < 30; i += 1) stepWorld(cooled, 1 / 60);
assert(bluePeg.age > 0.4, 'hanging on a blue peg counts down');
assert(tryBeginDrag(cooled, cooled.body.x, cooled.body.y), 'press to leave the blue peg');
dragTo(cooled, bluePeg.x, bluePeg.y + feel.restDrop + feel.minPull + 5);
endDrag(cooled);
assert(bluePeg.age === BLUE_PEG_LIFE && bluePeg.cool === 0, 'letting go starts the peg cooldown');
for (let i = 0; i < 29; i += 1) stepWorld(cooled, 1 / 60);
assert(bluePeg.age === BLUE_PEG_LIFE, 'the cooldown is still running');
stepWorld(cooled, 1 / 60);
stepWorld(cooled, 1 / 60);
assert(bluePeg.age === 0 && bluePeg.cool === 0, 'the cooldown resets the hang timer');

console.log('sling self-test ok');
