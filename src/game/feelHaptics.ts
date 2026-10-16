/**
 * Gameplay haptics. Patterns follow the SpringBall lab:
 * a live continuous tension while pulling, grain near full stretch,
 * a grab hit plus a short tail, then a dull tap at each swing extreme.
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
 * The grab is one pattern: a transient, then a continuous tail 10 ms later.
 * Swing taps follow the rope. A sign change of offset·velocity is an extreme.
 */
const FULL_CATCH = 2338;
const SWING_GAP_S = 0.12;

let swingOn = false;
let swingDot = 0;
let swingAt = 0;

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

/** Stop swing taps. A press, a fall, or the catch ending calls this. */
export function endSwing(): void {
  swingOn = false;
}

/**
 * Grab hit plus the Bounce tail. `speed` is arrival speed. A full pull is
 * about 2338 px/s. Light catches stay quieter, but still read as a catch.
 */
export function playGrab(speed: number): void {
  swingOn = true;
  swingDot = 0;
  swingAt = 0;
  const energy = clamp01(speed / FULL_CATCH);
  const scale = 0.75 + 0.25 * energy;
  const events: HapticEvent[] = [];
  pulse(
    events,
    0,
    haptic.grabI * scale,
    haptic.grabS,
    haptic.grabTailI * scale,
    haptic.grabTailS,
    haptic.grabTailMs,
  );
  if (events.length > 0) void haptics.playPattern(events);
}

/**
 * One dull tap at a swing extreme. Offset is the body relative to the hang
 * pose. `now` is seconds. Nothing fires until the offset·velocity sign flips,
 * and nothing under the amplitude floor.
 */
export function noteSwing(offsetX: number, offsetY: number, vx: number, vy: number, now: number): void {
  if (!swingOn) return;
  const dot = offsetX * vx + offsetY * vy;
  const prev = swingDot;
  swingDot = dot;
  if (prev === 0 || dot === 0 || (prev > 0) === (dot > 0)) return;
  const amp = Math.hypot(offsetX, offsetY);
  if (amp < haptic.swingMinPx || now - swingAt < SWING_GAP_S) return;
  const intensity = haptic.swingI * clamp01(amp / haptic.swingFullPx);
  if (intensity < haptic.swingFloor) return;
  swingAt = now;
  void haptics.playTransient(clamp01(intensity), clamp01(haptic.swingS));
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

/** One transient per coin collected. */
export function playCoin(): void {
  void haptics.playTransient(clamp01(haptic.coinI), clamp01(haptic.coinS));
}
