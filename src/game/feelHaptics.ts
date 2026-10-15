/**
 * Gameplay haptics. Patterns follow the SpringBall lab:
 * a live continuous tension while pulling, grain near full stretch,
 * a grab hit, then rebound beats timed to the body's shake.
 * Wall and death are a single transient.
 */

import { haptic } from './tune';
import { haptics, type HapticEvent } from '../utils/haptics';

let charging = false;
let ready = false;
let grain = false;
let sent = -1;
let lastRatio = 0;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function tension(ratio: number): { intensity: number; sharpness: number } {
  const r = clamp01(ratio);
  return {
    intensity: haptic.tensionMinI + r * (haptic.tensionMaxI - haptic.tensionMinI),
    sharpness: haptic.tensionMinS + r * (haptic.tensionMaxS - haptic.tensionMinS),
  };
}

function pushTension(ratio: number): void {
  if (!ready) return;
  if (sent >= 0 && Math.abs(ratio - sent) < 0.02) return;
  sent = ratio;
  const level = tension(ratio);
  void haptics.updateContinuous(level.intensity, level.sharpness);
}

function setGrain(on: boolean): void {
  if (on === grain) return;
  grain = on;
  if (on) void haptics.startGrain({ intensity: haptic.grainI, sharpness: haptic.grainS, frequency: haptic.grainHz });
  else void haptics.stopGrain();
}

/** Re-send the pull bed and the grain after a slider move. */
export function refreshCharge(): void {
  sent = -1;
  if (charging && ready) pushTension(lastRatio);
  if (grain) {
    void haptics.startGrain({ intensity: haptic.grainI, sharpness: haptic.grainS, frequency: haptic.grainHz });
  }
}

/** Start the pull bed. `ratio` is stretch past rest over maxPull. */
export function beginCharge(ratio: number): void {
  charging = true;
  ready = false;
  sent = -1;
  grain = false;
  const level = tension(0);
  void haptics.startContinuous({ ...level, duration: 30 }).then((result) => {
    if (!charging) {
      void haptics.stopContinuous();
      return;
    }
    ready = result.ok;
    lastRatio = ratio;
    if (ready) pushTension(ratio);
    setGrain(ratio >= haptic.grainAt);
  });
}

/** Follow the finger. Skips the bridge until the pull fraction moves. */
export function updateCharge(ratio: number): void {
  if (!charging) return;
  const r = clamp01(ratio);
  lastRatio = r;
  pushTension(r);
  setGrain(r >= haptic.grainAt);
}

export function endCharge(): void {
  if (!charging && !grain) return;
  charging = false;
  ready = false;
  sent = -1;
  setGrain(false);
  void haptics.stopContinuous();
}

/**
 * Catch haptics.
 * 1. The grab is one transient plus an optional continuous tail. Fixed.
 * 2. The rebound is SpringBall's decay pattern. Count, envelope, sharpness
 *    and the tail ratio all follow that lab. Beats sit on one pattern at 6 Hz.
 */
const FULL_CATCH = 2338;
/** SpringBall's default bounce rate. One beat every 1/6 second. */
const REBOUND_HZ = 6;

function pulse(
  events: HapticEvent[],
  time: number,
  intensity: number,
  sharpness: number,
  tailI: number,
  tailS: number,
  tailMs: number,
): void {
  const hit = clamp01(intensity);
  const edge = clamp01(sharpness);
  if (hit >= 0.02) {
    events.push({ type: 'transient', relativeTime: time, intensity: hit, sharpness: edge });
  }
  const tail = clamp01(tailI);
  if (tail >= 0.02 && tailMs > 0) {
    events.push({
      type: 'continuous',
      relativeTime: time + 0.01,
      duration: tailMs / 1000,
      intensity: tail,
      sharpness: clamp01(tailS),
    });
  }
}

/**
 * Grab hit, then SpringBall's decay. `speed` is arrival speed. A full pull
 * is about 2338 px/s and counts as energy 1.
 */
export function playGrab(speed: number): void {
  const energy = clamp01(speed / FULL_CATCH);
  const events: HapticEvent[] = [];
  pulse(events, 0, haptic.grabI, haptic.grabS, haptic.grabTailI, haptic.grabTailS, haptic.grabTailMs);
  const total = Math.max(0, Math.round(haptic.reboundBase + energy * haptic.reboundEnergy));
  const dampingExp = haptic.reboundDamp - energy * haptic.reboundDampEnergy;
  const interval = 1 / REBOUND_HZ;
  let time = haptic.reboundGapMs / 1000;
  for (let i = 0; i < total; i += 1) {
    const progress = i / Math.max(1, total);
    const envelope = Math.max(0, 1 - progress) ** dampingExp;
    const intensity = envelope * energy;
    if (intensity < haptic.reboundFloor) continue;
    const sharpness = Math.max(0.1, haptic.reboundS - progress * haptic.reboundSDrop);
    const tailI = intensity * haptic.reboundTailI;
    const tailS = sharpness * haptic.reboundTailS * (1 - progress * 0.3);
    const tailMs = haptic.reboundTailMs * (1 - progress * 0.5);
    pulse(events, time, intensity, sharpness, tailI, tailS, tailMs);
    time += interval;
  }
  if (events.length > 0) void haptics.playPattern(events);
}

/**
 * One hit. Echo from SpringBall: 0.8 of the impact, sharpness 0.1,
 * and nothing under 0.2. `power` is 0 at the 80 px/s gate and 1 at 1080 px/s.
 */
export function playWall(power: number): void {
  const intensity = clamp01(power) * haptic.wallMul;
  if (intensity < haptic.wallFloor) return;
  void haptics.playTransient(clamp01(intensity), clamp01(haptic.wallS));
}

/** One dull hit, under SpringBall's echo. A fall calls this once. */
export function playDeath(): void {
  void haptics.playTransient(clamp01(haptic.deathI), clamp01(haptic.deathS));
}
