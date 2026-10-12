/** Design-pixel feel constants. Not measured from the original game. */

export const MAX_PULL = 160;
/** Pulls shorter than this cancel on release. */
export const MIN_PULL = 28;
export const LAUNCH_SCALE = 3.8;
/** Design +y, which is down the screen. */
export const GRAVITY = 900;
export const GRAB_RADIUS = 36;
export const GRAB_START_RADIUS = 48;
export const OLD_PEG_LOCK = 0.18;
export const FIXED_DT = 1 / 60;
export const CAMERA_LAG = 0.12;
/** Body hangs this far below the peg. Design +y is down. */
export const HANG_DROP = 78;
/** Hands sit this far apart on the body. */
export const SHOULDER = 14;
/**
 * Hanging body rests at this fraction of the design height.
 * Four gaps of about 120px fit above it, and a 160px pull stays on screen.
 */
export const PEG_SCREEN_ANCHOR = 0.7;
/** No new drag starts below this design y (home indicator). */
export const DRAG_BLOCK_Y = 844 - 34;

export const SHAFT_LEFT = 78;
export const SHAFT_RIGHT = 312;
export const SHAFT_CENTER = (SHAFT_LEFT + SHAFT_RIGHT) / 2;
/** Wider left/right scatter. Still clamped inside the shaft. */
export const PEG_X_SPREAD = 90;
/** Closer than the old 160–220 so four pegs stay on screen. */
export const PEG_GAP_MIN = 100;
export const PEG_GAP_MAX = 130;
/** Pegs kept ahead of the one you hold. */
export const PEGS_AHEAD = 4;
/** How often a new peg is red. No dissolve yet. */
export const RED_PEG_CHANCE = 0.18;
