/**
 * Rapier 2D owns the step, gravity, and the shaft walls.
 * The arm is a force added before each step. Design pixels, +y down.
 */

import RAPIER from '@dimforge/rapier2d-compat';
import {
  armSlack,
  BODY_RADIUS,
  feel,
  SHAFT_LEFT,
  SHAFT_RIGHT,
} from './tune';

export type Sim = {
  world: RAPIER.World;
  body: RAPIER.RigidBody;
  colliders: RAPIER.Collider[];
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

function wall(world: RAPIER.World, x: number, colliders: RAPIER.Collider[]): void {
  const thickness = 40;
  const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, 0));
  const shape = RAPIER.ColliderDesc.cuboid(thickness / 2, 20_000)
    .setRestitution(feel.wallRestitution)
    .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
    .setFriction(0);
  colliders.push(world.createCollider(shape, fixed));
}

export function createSim(x: number, y: number): Sim {
  requireReady();
  const world = new RAPIER.World({ x: 0, y: feel.gravity });
  world.timestep = 1 / 60;
  world.integrationParameters.lengthUnit = 20;
  world.integrationParameters.maxCcdSubsteps = 4;
  const colliders: RAPIER.Collider[] = [];
  wall(world, SHAFT_LEFT - 20, colliders);
  wall(world, SHAFT_RIGHT + 20, colliders);

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y).setCcdEnabled(true).setLinearDamping(0),
  );
  world.createCollider(
    RAPIER.ColliderDesc.ball(BODY_RADIUS)
      .setRestitution(feel.wallRestitution)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setFriction(0)
      .setDensity(1),
    body,
  );
  colliders.push(body.collider(0));
  return { world, body, colliders };
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

/**
 * One arm. Past ARM_SLACK it pulls toward the peg and damps radial speed.
 * Shorter than that, the pull is zero. Tangential damping always acts, so a
 * swing can stop. Gravity is the world gravity, not part of this force.
 */
export function simApplyArm(sim: Sim, pegX: number, pegY: number, dt: number): void {
  const t = sim.body.translation();
  const v = sim.body.linvel();
  const dx = t.x - pegX;
  const dy = t.y - pegY;
  const reach = Math.hypot(dx, dy);
  if (reach < 1e-4) return;
  const nx = dx / reach;
  const ny = dy / reach;
  const radial = v.x * nx + v.y * ny;
  const slack = armSlack();
  const keep = Math.exp(-feel.tangentDamp * dt);
  const vx = (v.x - radial * nx) * keep + radial * nx;
  const vy = (v.y - radial * ny) * keep + radial * ny;
  sim.body.setLinvel({ x: vx, y: vy }, true);
  if (reach <= slack) return;
  const accel = feel.armOmega * feel.armOmega * (reach - slack) + feel.radialDamp * radial;
  const mass = sim.body.mass();
  sim.body.addForce({ x: -nx * accel * mass, y: -ny * accel * mass }, true);
}

export function simStep(sim: Sim, dt: number): void {
  // A pixel-scale world only notices a fast wall hit on the step after the
  // overlap. Two substeps resolve the bounce inside one game frame.
  sim.world.gravity = { x: 0, y: feel.gravity };
  for (const collider of sim.colliders) collider.setRestitution(feel.wallRestitution);
  const sub = dt / 2;
  sim.world.timestep = sub;
  sim.world.step();
  sim.world.step();
  // This Rapier build keeps user forces across steps. Drop them so the
  // launch spring does not keep accelerating after the arm goes slack.
  sim.body.resetForces(true);
}
