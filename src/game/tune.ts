/** Design-pixel feel constants. Not measured from the original game. */

import { DESIGN_WIDTH } from '../adapt/design';

export const MAX_PULL = 115;
/**
 * Extra stretch past the still pose (REST_DROP) that is still too short to launch.
 * A shorter release eases back under the peg.
 */
export const MIN_PULL = 28;
/**
 * Spring rate of the arm as sqrt(k/m), in 1/s.
 * Extension x (px past HANG_DROP) would reach speed x * LAUNCH_SCALE at slack
 * with no gravity. With GRAVITY, a full downward pull leaves at about 1280 px/s
 * and reaches an apex about 580 px up, roughly 0.9 s after detach.
 */
export const LAUNCH_SCALE = 11.5;
/**
 * Fraction of speed kept when the body catches a peg.
 * 1 keeps the approach, so the body carries past the peg and the band pulls it back.
 */
export const CATCH_KEEP = 1;
/**
 * Unused by the current arm. Catch and hang rates live next to stepArm
 * in sling.ts (BAND_RATE, CATCH_SWING_DAMP, ROPE_DAMP).
 */
export const ARM_RATE = 7;
/** Unused by the current arm. See sling.ts BAND_DAMP. */
export const ARM_DAMP = 2.2;
/** Unused by the current arm. See sling.ts CATCH_SWING_DAMP and ROPE_DAMP. */
export const SWING_DAMP = 1.15;
/** How far a slack band bows sideways, in px. A taut band bows less. */
export const ARM_SAG = 26;
/** Ease-back time constant when a release stays inside the dead zone. */
export const RETURN_LAG = 0.08;
/** Design +y, which is down the screen. A full hop still crests in about 0.9 s. */
export const GRAVITY = 1400;
export const GRAB_RADIUS = 36;
/** Wider than the body so a press on the visible circle starts a pull. */
export const GRAB_START_RADIUS = 64;
export const OLD_PEG_LOCK = 0.18;
export const FIXED_DT = 1 / 60;
/**
 * Cinemachine-style damp time, in seconds. Same value for flight and for settling
 * onto a peg. About how long a start or a stop takes. Not a per-frame lerp.
 */
export const CAMERA_DAMP = 0.36;
/** How far the camera may coast past the goal, in design pixels. */
export const CAMERA_OVERSHOOT = 6;
/**
 * Slack length. Tension starts past this. Design +y is down.
 * Weight sags a still body to REST_DROP, which is the pose on screen.
 */
export const HANG_DROP = 32;
/** Peg center to body center when the arm is still. The catch band rests here. */
export const REST_DROP = 61;
/** Hands sit this far apart on the body. */
export const SHOULDER = 16;
/**
 * Hanging body rests at this fraction of the design height.
 * A full pull (hang plus MAX_PULL) still ends on screen.
 */
export const PEG_SCREEN_ANCHOR = 0.7;
/** No new drag starts below this design y (home indicator). */
export const DRAG_BLOCK_Y = 844 - 34;

/** Inner face of the side walls. They sit on the design-screen edges. */
export const SHAFT_LEFT = 0;
export const SHAFT_RIGHT = DESIGN_WIDTH;
/** Body circle. Matches the actor mesh. Walls stop this radius short of the shaft edge. */
export const BODY_RADIUS = 36;
/** Horizontal speed kept after a wall hit. 1 is a perfect bounce. */
export const WALL_RESTITUTION = 0.9;
export const SHAFT_CENTER = (SHAFT_LEFT + SHAFT_RIGHT) / 2;
/** Unused while the layout is two centered pegs. */
export const PEG_X_SPREAD = 90;
/** Unused while the layout is two centered pegs. */
export const PEG_GAP_MIN = 100;
export const PEG_GAP_MAX = 130;
/** How many pegs to keep above the one you hold. This layout stops at two total. */
export const PEGS_AHEAD = 1;
/** The second peg sits this far above the start peg. Design +y is down. */
export const PEG_UPPER_GAP = 294;
/** How often a new peg is red. No dissolve yet. */
export const RED_PEG_CHANCE = 0.18;
