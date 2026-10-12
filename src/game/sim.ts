/**
 * Rapier 2D owns the step, gravity, the shaft walls, and the hang joint.
 * Design pixels, +y down. Game rules stay in sling.ts.
 */

import RAPIER from '@dimforge/rapier2d-compat';
import {
  BODY_RADIUS,
  GRAVITY,
  HANG_DROP,
  SHAFT_LEFT,
  SHAFT_RIGHT,
  WALL_RESTITUTION,
} from './tune';

export type Sim = {
  world: RAPIER.World;
  body: RAPIER.RigidBody;
  joint: RAPIER.ImpulseJoint | null;
};

let ready = false;

export async function initPhysics(): Promise<void> {
  if (ready) return;
  await RAPIER.init();
  ready = true;
}

function requireReady(): void {
  if (!ready) throw new Error('call initPhysics() before creating a sling world');
}

function wall(world: RAPIER.World, x: number): void {
  const thickness = 40;
  const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, 0));
  const shape = RAPIER.ColliderDesc.cuboid(thickness / 2, 20_000)
    .setRestitution(WALL_RESTITUTION)
    .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
    .setFriction(0);
  world.createCollider(shape, fixed);
}

export function createSim(x: number, y: number): Sim {
  requireReady();
  const world = new RAPIER.World({ x: 0, y: GRAVITY });
  world.timestep = 1 / 60;
  world.integrationParameters.lengthUnit = 20;
  world.integrationParameters.maxCcdSubsteps = 4;
  wall(world, SHAFT_LEFT - 20);
  wall(world, SHAFT_RIGHT + 20);

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y).setCcdEnabled(true).setLinearDamping(0),
  );
  world.createCollider(
    RAPIER.ColliderDesc.ball(BODY_RADIUS)
      .setRestitution(WALL_RESTITUTION)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setFriction(0)
      .setDensity(1),
    body,
  );
  return { world, body, joint: null };
}

export function simFree(sim: Sim): void {
  sim.world.free();
}

export function simWrite(sim: Sim, x: number, y: number, vx: number, vy: number): void {
  sim.body.setTranslation({ x, y }, true);
  sim.body.setLinvel({ x: vx, y: vy }, true);
}

export function simRead(sim: Sim): { x: number; y: number; vx: number; vy: number } {
  const t = sim.body.translation();
  const v = sim.body.linvel();
  return { x: t.x, y: t.y, vx: v.x, vy: v.y };
}

/** Acceleration toward the peg, scaled by mass so the rate matches LAUNCH_SCALE. */
export function simSpring(sim: Sim, pegX: number, pegY: number, rate: number): void {
  const t = sim.body.translation();
  const dx = t.x - pegX;
  const dy = t.y - pegY;
  const reach = Math.hypot(dx, dy);
  const extension = reach - HANG_DROP;
  if (extension <= 0 || reach < 1e-4) return;
  const accel = rate * rate * extension;
  const mass = sim.body.mass();
  const inv = 1 / reach;
  sim.body.addForce({ x: -dx * inv * accel * mass, y: -dy * inv * accel * mass }, true);
}

export function simClearJoint(sim: Sim): void {
  if (!sim.joint) return;
  sim.world.removeImpulseJoint(sim.joint, true);
  sim.joint = null;
}

export function simStep(sim: Sim, dt: number): void {
  // A pixel-scale world only notices a fast wall hit on the step after the
  // overlap. Two substeps resolve the bounce inside one game frame.
  const sub = dt / 2;
  sim.world.timestep = sub;
  sim.world.step();
  sim.world.step();
  // This Rapier build keeps user forces across steps. Drop them so the
  // launch spring does not keep accelerating after the arm goes slack.
  sim.body.resetForces(true);
}
