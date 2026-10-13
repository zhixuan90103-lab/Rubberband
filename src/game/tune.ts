/** Design-pixel feel constants. Not measured from the original game. */

import { DESIGN_WIDTH } from '../adapt/design';

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
  grabRadius: 36,
  grabStartRadius: 120,
  oldPegLock: 0.18,
  wallRestitution: 0.3,
  cameraDamp: 0.36,
  cameraOvershoot: 6,
  pegAnchor: 0.7,
  hitSpin: 0.015,
  aimSpin: 14,
  catchSpin: 10,
  settleSpin: 8,
};

export const feel: Feel = { ...feelDefaults };

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
/** Side pegs sit this far left and right, so the row splits the shaft in four. */
export const PEG_X_SPREAD = SHAFT_CENTER / 2;
/**
 * A held peg inside this distance of the shaft center never shifts the camera
 * sideways. Pegs are not assumed to sit on the center line.
 */
export const CAMERA_HOLD_HALF = 70;
/** Sideways camera follow while pulling from an outer peg toward the wall. */
export const CAMERA_X_GAIN = 0.55;
export const CAMERA_X_MAX = 36;
/** Unused while the layout is two centered pegs. */
export const PEG_GAP_MIN = 100;
export const PEG_GAP_MAX = 130;
/** How many pegs to keep above the one you hold. This layout stops at two total. */
export const PEGS_AHEAD = 1;
/** Peg art is 129×123, drawn at this width. Same size as the on-screen rivet. */
export const PEG_DRAW_W = 52;
export const PEG_DRAW_H = PEG_DRAW_W * (123 / 129);
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
/**
 * Upper rivet keeps the old spacing above a peg at y = 0, then moves
 * up by three rivet heights. +y is down, so the upper peg has the smaller y.
 */
export const PEG_UPPER_GAP = PEG_LOWER_Y + 294 + PEG_DRAW_H * 3;
/** How often a new peg is red. No dissolve yet. */
export const RED_PEG_CHANCE = 0.18;
