import { DESIGN_HEIGHT } from '../src/adapt/design';
import { advance, createWorld, type SlingWorld } from '../src/game/sling';
import { mulberry32 } from '../src/game/pegs';
import { initPhysics } from '../src/game/sim';
import { PEG_JUMP_MAX, PEG_JUMP_MIN, feel } from '../src/game/tune';

await initPhysics();

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  },
});
function climb(world: SlingWorld, label: string): void {
  let topY = Number.POSITIVE_INFINITY;
  for (let step = 0; step < 40; step += 1) {
    const before = world.pegs.filter((peg) => peg.live);
    const top = before.reduce((best, peg) => (peg.y < best.y ? peg : best));
    world.phase = 'hang';
    world.heldId = top.id;
    world.body.x = top.x;
    world.body.y = top.y + feel.restDrop;
    world.body.vx = 0;
    world.body.vy = 0;
    world.cameraY = world.body.y - DESIGN_HEIGHT * feel.pegAnchor;
    world.cameraVel = 0;
    advance(world, 1 / 60);
    const live = world.pegs.filter((peg) => peg.live);
    const held = live.find((peg) => peg.id === top.id);
    if (!held) throw new Error(`${label}: held peg recycled at step ${step}`);
    const reachable = live.filter((peg) => {
      if (peg.id === held.id || peg.y >= held.y) return false;
      const rise = held.y - peg.y;
      const gap = Math.hypot(peg.x - held.x, rise);
      return rise > 0 && rise <= PEG_JUMP_MAX + 1 && gap >= PEG_JUMP_MIN && gap <= PEG_JUMP_MAX;
    });
    if (reachable.length === 0) {
      throw new Error(`${label}: no visible peg above y=${held.y.toFixed(0)} at step ${step}`);
    }
    if (held.y >= topY - 1) throw new Error(`${label}: tower stopped climbing`);
    const liveNow = world.pegs.filter((peg) => peg.live);
    for (const peg of liveNow) {
      const sides = liveNow.filter(
        (other) => Math.abs(peg.y - other.y - 244) < 8 && Math.abs(Math.abs(other.x - peg.x) - 97) < 16,
      );
      if (sides.length < 2) continue;
      const top = liveNow.some(
        (other) => Math.abs(other.x - peg.x) < 12 && Math.abs(peg.y - other.y - 569) < 16,
      );
      if (!top) throw new Error(`${label}: a card lost its top peg above y=${peg.y.toFixed(0)}`);
    }
    topY = held.y;
  }
  console.log(label, 'climbed', (-topY).toFixed(0), 'px');
}

const world = createWorld(mulberry32(1));
const green = world.pegs.find((peg) => peg.live && peg.kind === 'green');
if (!green || world.heldId !== green.id) throw new Error('not hanging on the generated green peg');
climb(world, 'generated tower');
console.log('pattern climb check passed');
