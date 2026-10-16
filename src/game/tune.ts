/** Design-pixel feel constants. Not measured from the original game. */

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../adapt/design';

/** Live monkey feel. The panel writes this. Derived lengths are functions. */
export type Feel = {
  /** Hang length. The arm and gravity balance here. */
  restDrop: number;
  /** Extra stretch past the hang pose. The arm cannot go farther. */
  maxPull: number;
  /** Extra stretch past the hang pose that is still too short to launch. */
  minPull: number;
  /** sqrt(k/m), 1/s. One rate for launch, catch, and hang. */
  armOmega: number;
  /** Along-arm damping, 1/s. Only while the arm is past the slack length. */
  radialDamp: number;
  /** Across-arm damping, 1/s. This is what lets a swing stop. */
  tangentDamp: number;
  /** Design +y, down the screen. */
  gravity: number;
  grabRadius: number;
  grabStartRadius: number;
  /** Seconds before the peg just left can be caught again. */
  oldPegLock: number;
  /** Horizontal speed kept after a wall hit. 1 is a perfect bounce. */
  wallRestitution: number;
  cameraDamp: number;
  cameraOvershoot: number;
  /** Hanging body rests at this fraction of the design height. */
  pegAnchor: number;
  /** Radians per second added for each px/s of velocity change in a wall hit. */
  hitSpin: number;
  /** Spin rate at a full-length release, rad/s. Shorter pulls scale down with the stretch. */
  launchSpin: number;
  /** Crown turn while aiming and launching, 1/s. */
  aimSpin: number;
  /** Crown turn during a catch, 1/s. */
  catchSpin: number;
  /** Crown turn once the catch has settled, 1/s. */
  settleSpin: number;
};

export const feelDefaults: Feel = {
  restDrop: 60,
  maxPull: 84,
  minPull: 25,
  armOmega: 26,
  radialDamp: 17,
  tangentDamp: 9,
  gravity: 4000,
  grabRadius: 45,
  grabStartRadius: 120,
  oldPegLock: 0.18,
  wallRestitution: 0.3,
  cameraDamp: 0.3,
  cameraOvershoot: 6,
  pegAnchor: 0.7,
  hitSpin: 0.002,
  launchSpin: 2,
  aimSpin: 14,
  catchSpin: 10,
  settleSpin: 10,
};

export const feel: Feel = { ...feelDefaults };

/** Live haptic knobs. SpringBall stretch / snap / decay / echo defaults. */
export type HapticFeel = {
  tensionMinI: number;
  tensionMaxI: number;
  tensionMinS: number;
  tensionMaxS: number;
  grainAt: number;
  grainI: number;
  grainS: number;
  grainHz: number;
  /** Grab hit. Fixed, not scaled by arrival speed. */
  grabI: number;
  grabS: number;
  /** Continuous tail 10 ms after the grab hit. Intensity scales with the hit. */
  grabTailI: number;
  grabTailS: number;
  grabTailMs: number;
  /** Dull tap when the rope reaches a swing extreme. */
  swingI: number;
  swingS: number;
  swingFloor: number;
  /** Offset from the hang pose, in design pixels. */
  swingMinPx: number;
  swingFullPx: number;
  wallMul: number;
  wallS: number;
  wallFloor: number;
  deathI: number;
  deathS: number;
  /** One transient when a coin is collected. */
  coinI: number;
  coinS: number;
};

export const hapticDefaults: HapticFeel = {
  tensionMinI: 0.1,
  tensionMaxI: 0.4,
  tensionMinS: 0.1,
  tensionMaxS: 0.2,
  grainAt: 0.6,
  grainI: 0.3,
  grainS: 0,
  grainHz: 25,
  grabI: 0.48,
  grabS: 0.5,
  grabTailI: 0.17,
  grabTailS: 0.2,
  grabTailMs: 40,
  swingI: 0.4,
  swingS: 0,
  swingFloor: 0.19,
  swingMinPx: 18,
  swingFullPx: 90,
  wallMul: 0.8,
  wallS: 0.1,
  wallFloor: 0.2,
  deathI: 1,
  deathS: 0.23,
  coinI: 0.3,
  coinS: 0.3,
};

export const haptic: HapticFeel = { ...hapticDefaults };

export function resetHaptic(): void {
  Object.assign(haptic, hapticDefaults);
}

/** Catch radius added for the one peg a shot is clearly aimed at. 45 grows to 70. */
export const AIM_EXTRA = 25;

/** Grab rings, the body center, and the aim curve. */
export const guides = { show: false };

export function resetFeel(): void {
  Object.assign(feel, feelDefaults);
}

/** Zero-force length. restDrop = armSlack + gravity / armOmega². */
export function armSlack(): number {
  const omega = feel.armOmega;
  return feel.restDrop - feel.gravity / (omega * omega);
}

/** Longest arm, drag and catch. */
export function armMax(): number {
  return feel.restDrop + feel.maxPull;
}
export const FIXED_DT = 1 / 60;
/** Hands sit this far apart on the body. Not read by the current actor. */
export const SHOULDER = 16;
/** How far a slack band bows sideways, in px. Not read by the current actor. */
export const ARM_SAG = 26;
/** No new drag starts below this design y (home indicator). */
export const DRAG_BLOCK_Y = 844 - 34;

/**
 * Inner face of the side walls. Matches the stone art, which sits this far
 * outside each design-screen edge.
 */
export const WALL_FACE_OUT = 12;
export const SHAFT_LEFT = -WALL_FACE_OUT;
export const SHAFT_RIGHT = DESIGN_WIDTH + WALL_FACE_OUT;
/** Body circle. Matches the actor mesh. Walls stop this radius short of the shaft edge. */
export const BODY_RADIUS = 36;
export const SHAFT_CENTER = (SHAFT_LEFT + SHAFT_RIGHT) / 2;
/**
 * A held peg inside this distance of the shaft center never shifts the camera
 * sideways. Pegs are not assumed to sit on the center line.
 */
export const CAMERA_HOLD_HALF = 70;
/** Sideways camera follow while pulling from an outer peg toward the wall. */
export const CAMERA_X_GAIN = 0.55;
export const CAMERA_X_MAX = 36;
/**
 * Pair lanes, measured in from each design edge.
 * The body stops 24px inside the screen, and a launch needs 85px of pull,
 * so a peg at 48 cannot be dragged toward the wall. These stay at least that
 * far in, and the two pegs of a row stay 146 to 170 apart.
 */
export const PEG_LANES = [110, 124] as const;
/** Jump from one row to the next stays inside this distance. */
export const PEG_JUMP_MIN = 200;
export const PEG_JUMP_MAX = 600;
/**
 * Top leaves cover about this many design pixels. A peg center above this
 * line is on the canvas and still hidden. While hanging, the next peg stays
 * below it: body at pegAnchor, peg restDrop above the body.
 */
export const HANG_LEAF = 200;
export function hangRise(): number {
  return DESIGN_HEIGHT * feel.pegAnchor - feel.restDrop - HANG_LEAF;
}
/** How far the two pegs of one row sit apart in height. */
export const PEG_ROW_STAGGER = 22;
/** First peg above the birth cluster. Short enough to sit below the top leaves. */
export const PEG_OPEN_SINGLE_GAP = 300;
/** Later rows pick a gap in this range. The whole step stays below the top leaves. */
export const PEG_GAP_MIN = 240;
export const PEG_GAP_MAX = 320;
/**
 * Climb height above the foot peg. Early stays a short single peg.
 * Mid adds pairs and an occasional long single. After that every step is a
 * two-peg choice, and the coin sits only on the way to one of them.
 */
export const CLIMB_EARLY = 2800;
export const CLIMB_MID = 7200;
/** A single sits somewhere in this band, not on a fixed center step. */
export const PEG_SINGLE_X0 = 120;
export const PEG_SINGLE_X1 = 270;
/**
 * Live pegs are the camera window plus one jump above the fill line
 * and one jump below the screen. Worst case is a pair every
 * PEG_JUMP_MIN, so the pool is that count plus spare slots.
 */
/**
 * Fill this far above the view. Half a max jump plus a coin,
 * so the coin in that new gap is already above the screen.
 */
export const PEG_FILL_LEAD = PEG_JUMP_MAX / 2 + 80;
/** One max jump below the screen, so a downward shot still has its target. */
export const PEG_KEEP_BELOW = PEG_JUMP_MAX;
export const PEG_POOL = 24;
/**
 * Foot-sprite center below the body center when the legs hang straight.
 * Face art is 242×223. The ankles sit on face pixel row 208.
 */
const FACE_W = 242;
const FACE_H = 223;
const HEAD_W = BODY_RADIUS * 2.2;
const HEAD_H = HEAD_W * (FACE_H / FACE_W);
export const LEG_DROP = (208 / FACE_H - 0.5) * HEAD_H;
/** Start rivet sits on the hanging monkey's feet. */
export const PEG_LOWER_Y = feelDefaults.restDrop + LEG_DROP;
/** How often a single peg after the opening is red. Pairs stay blue. */
export const RED_PEG_CHANCE = 0.18;
/**
 * 红点金币 zigzag from the saved cards 红点金币1/2/3.
 * Three red pegs, alternating the left spot near x=120 and the right spot
 * near x=275. Each rise stays on screen. A coin sits on the midpoint.
 */
export const RED_COIN_STEPS = 3;
export const RED_COIN_X = [120, 275] as const;
export const RED_COIN_DY_MIN = 220;
export const RED_COIN_DY_MAX = 280;
/** 红点金币 is one sampled pattern, not a side chance on ordinary rows. */
/** Seconds before a blue or red peg turns gray and cannot be grabbed. */
export const BLUE_PEG_LIFE = 5;
export const RED_PEG_LIFE = 3;
/** How long a spent peg stays gray before its original color returns. */
export const PEG_INVALID = 0.5;
/** A hung blue or red peg starts flashing when this many seconds remain. */
export const PEG_WARN = 2;
