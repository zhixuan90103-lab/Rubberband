/**
 * Boot: safe-area → device preview → WebGPU design stage → sling loop.
 * Keep: adapt/*, create-renderer, utils/haptics, DOM contract.
 */

import * as THREE from 'three';
import { Capacitor } from '@capacitor/core';
import {
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  applyStageTransform,
  computeStageLayout,
  isInDesignBounds,
  watchStageLayout,
  type StageLayout,
} from './adapt/design';
import {
  mountDevicePreview,
  type DevicePreviewController,
} from './adapt/devicePreview';
import { applyNativeClass, applySafeAreaCssVars } from './adapt/safeArea';
import { createRenderer } from './create-renderer';
import { mulberry32, pegSpent, pegUrgency, pegWarn } from './game/pegs';
import { initPhysics } from './game/sim';
import {
  advance,
  beginEnter,
  cancelDrag,
  createWorld,
  dragTo,
  endDrag,
  pointerToWorld,
  readAim,
  pullLength,
  restart,
  tryBeginDrag,
  type SlingWorld,
} from './game/sling';
import { mountTunePanel } from './game/tunePanel';
import {
  BODY_RADIUS,
  DRAG_BLOCK_Y,
  guides,
  SHAFT_LEFT,
  SHAFT_RIGHT,
  armMax,
  feel,
} from './game/tune';
import bgUrl from './assets/bg-jungle.png';
import eyesUrl from './assets/art/04-two-slots.png';
import faceUrl from './assets/art/05-monkey-face.png';
import footUrl from './assets/art/07-dark-oval.png';
import armsUrl from './assets/art/08-pair-limbs.png';
import pegBackUrl from './assets/art/03-dark-disc.png';
import pegBlueUrl from './assets/art/02-blue-ring.png';
import pegRedUrl from './assets/art/01-pink-ring.png';
import pegGreenUrl from './assets/art/10-green-rivet.png';
import pegGrayUrl from './assets/art/11-gray-rivet.png';
import pegFlashUrl from './assets/art/12-peg-flash.png';
import wallUrl from './assets/art/09-wall-slice.png';

const stage = document.getElementById('stage')!;
const shell = document.getElementById('shell')!;
const viewportEl = document.getElementById('viewport')!;
const statusEl = document.getElementById('status');

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

function mountDeathScreen(root: HTMLElement, onRetry: () => void): { setOpen: (open: boolean) => void } {
  const screen = document.createElement('section');
  screen.id = 'death-screen';
  const card = document.createElement('div');
  card.className = 'death-card';
  const line = document.createElement('p');
  line.textContent = '掉出画面了';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = '再来一次';
  retry.addEventListener('click', (event) => {
    event.stopPropagation();
    onRetry();
  });
  card.append(line, retry);
  screen.append(card);
  root.append(screen);
  return {
    setOpen(open: boolean) {
      screen.classList.toggle('open', open);
    },
  };
}

function makeOrtho(): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(0, DESIGN_WIDTH, 0, DESIGN_HEIGHT, 0.1, 50);
  camera.position.set(0, 0, 10);
  return camera;
}

type PegView = {
  group: THREE.Group;
  back: THREE.Mesh;
  blue: THREE.Mesh;
  red: THREE.Mesh;
  green: THREE.Mesh;
  gray: THREE.Mesh;
  flash: THREE.Mesh;
  ring: THREE.Mesh;
  /** Grab radius. Scale is the live `grabRadius`. */
  grab: THREE.Mesh;
  blink: number;
  /** Seconds into the catch burst. Negative means idle. */
  burst: number;
};

/** Ring and back plate share a 129×123 canvas. One size keeps them aligned. */
const PEG_W = 52 * 0.8;
/** Additive core flash, slow at 2s left and fast as the peg is about to turn gray. */
const PEG_FLASH_HZ = { slow: 2, fast: 12 };
/** Sampled centers of the blue and red rivet art. */
const PEG_FLASH_COLOR = {
  blue: [39 / 255, 149 / 255, 233 / 255] as const,
  red: [233 / 255, 39 / 255, 91 / 255] as const,
};
/** Share of white in the flash. The rest stays the peg color, so the glint is light, not more saturated. */
const PEG_FLASH_WHITE = 0.85;
/** Extra energy on that light color. Above 1 so the bright frame reaches white before the 8-bit target clips. */
const PEG_FLASH_PEAK = 1.5;
const PEG_H = PEG_W * (123 / 129);
/** Catch ring expands and fades over this many seconds. */
const PEG_BURST = 0.36;

/** Face art is 242×223. Pupils and feet are placed in that pixel frame. */
const FACE_W = 242;
const FACE_H = 223;
/** 08-pair-limbs.png is one picture of both arms. Hands are the top of the file. */
const ARM_TEX_W = 143;
const ARM_TEX_H = 130;

function bootScene(): {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  actor: THREE.Group;
  eyes: THREE.Mesh;
  feet: [Foot, Foot];
  actorShadow: THREE.Mesh;
  arms: THREE.Mesh;
  flash: THREE.Mesh;
  /** Physics body center. Grab tests this point, not the drawn sprite. */
  center: THREE.Mesh;
  pegRoot: THREE.Group;
  backdrop: THREE.Group;
  jungle: THREE.Texture;
  aimLine: THREE.Line;
} {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9ed56a);
  const camera = makeOrtho();

  const backdrop = new THREE.Group();
  const jungle = mountJungle(backdrop);
  scene.add(backdrop);

  const pegRoot = new THREE.Group();
  scene.add(pegRoot);

  const arms = makeArms();
  scene.add(arms);

  const { group: actor, eyes } = makeMonkey();
  scene.add(actor);
  const feet = makeFeet();
  scene.add(feet[0].mesh, feet[1].mesh);

  const { headW } = monkeySize();
  const actorShadow = makeShadow(headW * 0.88, headW * 0.88, 0.8, 0.5);
  scene.add(actorShadow);

  const flash = new THREE.Mesh(
    new THREE.CircleGeometry(18, 20),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    }),
  );
  scene.add(flash);

  const center = new THREE.Mesh(
    new THREE.CircleGeometry(9, 20),
    new THREE.MeshBasicMaterial({
      color: 0xff1a1a,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  );
  // Sprites are transparent, so they paint after every opaque mesh.
  // This dot has to be transparent too, and later than the peg rings.
  center.renderOrder = 1000;
  center.position.z = 4;
  scene.add(center);

  const aimLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      color: 0xfff3a0,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      toneMapped: false,
    }),
  );
  aimLine.renderOrder = 8;
  aimLine.visible = false;
  aimLine.frustumCulled = false;
  scene.add(aimLine);

  return { scene, camera, actor, eyes, feet, actorShadow, arms, flash, center, pegRoot, backdrop, jungle, aimLine };
}

/**
 * Local +y is down the screen. The face art is the head only. Pupils sit in the
 * blank eyes. Feet hang from the chin on their own pendulums. Arms are a separate pair.
 */
function makeMonkey(): { group: THREE.Group; eyes: THREE.Mesh } {
  const { headW, headH } = monkeySize();
  // Slot art is 73×28. Its pupil centers are 48px apart; the face eyes are 58px apart.
  const eyeW = headW * ((58 / 48) * 73) / FACE_W;
  const eyeH = eyeW * (28 / 73);

  const group = new THREE.Group();
  const face = artSprite(faceUrl, headW, headH);
  const eyes = artSprite(eyesUrl, eyeW, eyeH);
  // Eye whites are centered near y=72 in the 223px face.
  eyes.position.set(0, (72 / FACE_H - 0.5) * headH, 0.05);
  eyes.userData.baseX = eyes.position.x;
  eyes.userData.baseY = eyes.position.y;
  group.add(face, eyes);
  for (const part of group.children) part.renderOrder = 2;
  return { group, eyes };
}

type Foot = {
  mesh: THREE.Mesh;
  /** Ankle, in the monkey's local frame. +x right, +y down. */
  lx: number;
  ly: number;
  length: number;
  /** Radians from world-down. Positive swings the toe to the right. */
  angle: number;
  vel: number;
  sx: number;
  sy: number;
  vx: number;
  vy: number;
  ready: boolean;
};

function makeFeet(): [Foot, Foot] {
  const { headW, headH } = monkeySize();
  const footW = headW * 0.22;
  const footH = footW * (52 / 48);
  const ankleY = (208 / FACE_H - 0.5) * headH - footH / 2;
  const left = makeFoot(-headW * 0.2, ankleY, footW, footH);
  const right = makeFoot(headW * 0.2, ankleY, footW, footH);
  return [left, right];
}

function makeFoot(lx: number, ly: number, width: number, height: number): Foot {
  const mesh = artSprite(footUrl, width, height);
  // Body parts are 2. The actor group must stay at 0, or its group order paints over these.
  mesh.renderOrder = 3;
  return {
    mesh,
    lx,
    ly,
    length: height,
    angle: 0,
    vel: 0,
    sx: 0,
    sy: 0,
    vx: 0,
    vy: 0,
    ready: false,
  };
}

/**
 * One-bone spring, the usual secondary-motion limb.
 * A free point on a stick can orbit the ankle, so the foot spins forever.
 * Here the foot is only an angle from world-down. Weight is the spring
 * pulling that angle back to 0. The ankle's acceleration lags the foot
 * the other way. The angle is clamped so it cannot flip over the top.
 */
let idleTime = 0;
let maxShake = 0;
/** 0 while swinging or airborne, 1 in a settled hang. Fades so the idle does not pop on. */
let idleBlend = 0;
let eyeClock = 0;
const eyeStarts = [0];

const EYE_LOOKS: Array<[number, number]> = [
  [0, 0],
  [0, 0],
  [3.4, 0.2],
  [-3.4, 0.15],
  [1.6, -2.4],
  [-1.4, -2.2],
  [0.3, 2.2],
  [2.7, -1.6],
  [-2.8, 1.4],
  [3.1, 1.5],
];

function eyeRand(n: number): number {
  const x = Math.sin(n * 91.7 + 19.2) * 24634.6345;
  return x - Math.floor(x);
}

function eyeLook(n: number): [number, number] {
  return EYE_LOOKS[Math.floor(eyeRand(n * 3) * EYE_LOOKS.length)];
}

function eyeCue(n: number): {
  x: number;
  y: number;
  out: number;
  hold: number;
  back: number;
  rest: number;
  blinks: number;
  blinkAt: number;
  length: number;
} {
  const look = eyeLook(n);
  const forward = look[0] === 0 && look[1] === 0;
  const out = forward ? 0 : 0.16 + eyeRand(n * 5 + 1) * 0.06;
  const hold = forward ? 0.2 + eyeRand(n * 5 + 2) * 0.4 : 0.7 + eyeRand(n * 5 + 2) * 0.65;
  const back = forward ? 0 : 0.16 + eyeRand(n * 5 + 3) * 0.06;
  const rest = 0.25 + eyeRand(n * 5 + 4) * 0.7;
  const roll = eyeRand(n * 5 + 6);
  const blinks = roll > 0.55 ? 1 : roll > 0.28 ? 2 : 0;
  const length = out + hold + back + rest;
  const blinkAt = 0.04 + eyeRand(n * 5 + 7) * Math.max(0.02, length - 0.22);
  return { x: look[0], y: look[1], out, hold, back, rest, blinks, blinkAt, length };
}

function smoothStep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Fast slide, then a small overshoot that settles onto the target. */
function eyeSnap(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  const slide = 1 - (1 - Math.min(1, u / 0.62)) ** 3;
  const settle = u < 0.62 ? 0 : smoothStep((u - 0.62) / 0.38);
  return slide * 1.12 + (1 - 1.12) * settle * (u < 0.62 ? 0 : 1);
}

function ensureEyes(time: number): void {
  while (eyeStarts[eyeStarts.length - 1] < time + 0.4) {
    const n = eyeStarts.length - 1;
    eyeStarts.push(eyeStarts[n] + eyeCue(n).length);
  }
}

function blinkAmount(t: number, duration: number): number {
  if (t < 0 || t > duration) return 0;
  const u = t / duration;
  if (u < 0.38) return smoothStep(u / 0.38);
  return 1 - smoothStep((u - 0.38) / 0.62);
}

function eyePose(time: number): { x: number; y: number; blink: number } {
  if (time <= 0) return { x: 0, y: 0, blink: 0 };
  ensureEyes(time);
  let i = eyeStarts.length - 2;
  while (i > 0 && eyeStarts[i] > time) i -= 1;
  const cue = eyeCue(i);
  let t = time - eyeStarts[i];
  let x = 0;
  let y = 0;
  if (t < cue.out) {
    const u = cue.out <= 0 ? 1 : eyeSnap(t / cue.out);
    x = cue.x * u;
    y = cue.y * u;
  } else if ((t -= cue.out) < cue.hold) {
    x = cue.x;
    y = cue.y;
  } else if ((t -= cue.hold) < cue.back) {
    const u = cue.back <= 0 ? 1 : eyeSnap(t / cue.back);
    x = cue.x * (1 - u);
    y = cue.y * (1 - u);
  }
  const elapsed = time - eyeStarts[i];
  let blink = 0;
  for (let k = 0; k < cue.blinks; k++) {
    blink = Math.max(blink, blinkAmount(elapsed - cue.blinkAt - k * 0.15, 0.11));
  }
  return { x, y, blink };
}

/** Screen-right glance, in face pixels, while a swing is coming or underway. */
function hangGaze(time: number): number | null {
  if (time <= 0 || idleBlend < 0.05) return null;
  ensureHang(time);
  let i = hangStarts.length - 2;
  while (i > 0 && hangStarts[i] > time) i -= 1;
  const g = hangGesture(i);
  const t = time - hangStarts[i];
  // +sign swings the body to screen left. Eyes look that way.
  const look = (sign: number) => -sign * 3.4;
  if (t < g.charge + g.swing) return look(g.sign);
  if (g.length - t <= 0.4) return look(hangGesture(i + 1).sign);
  return null;
}

function stepEyes(eyes: THREE.Mesh, dt: number): void {
  eyeClock += dt;
  const pose = eyePose(eyeClock);
  const gaze = hangGaze(idleTime);
  const baseX = eyes.userData.baseX as number;
  const baseY = eyes.userData.baseY as number;
  const x = gaze === null ? pose.x : pose.x * (1 - idleBlend) + gaze * idleBlend;
  const y = gaze === null ? pose.y : pose.y * (1 - idleBlend);
  eyes.position.set(baseX + x, baseY + y, 0.05);
  eyes.scale.y = 1 - pose.blink * 0.92;
}

/**
 * Peg hit, like a ball landing. Local +y is crown to feet.
 * Contact is flat, the rebound is long, then it settles. The two axes
 * multiply to 1 so the body keeps its area.
 */
function pegImpact(t: number): { along: number; cross: number } {
  if (t < 0) return { along: 1, cross: 1 };
  const squash = 0.78;
  const stretch = 1.16;
  let along = 1;
  if (t < 0.08) along = squash + (stretch - squash) * smoothStep(t / 0.08);
  else if (t < 0.34) along = stretch + (1 - stretch) * smoothStep((t - 0.08) / 0.26);
  return { along, cross: 1 / along };
}

/** Settled-hang breath, pixels. +y is down, so this only lifts the body. */
function hangBreath(time: number): number {
  if (time <= 0) return 0;
  const period = 1.25;
  const amp = 2;
  const phase = (time / period) * Math.PI * 2;
  return -amp * 0.5 * (1 - Math.cos(phase));
}

type HangGesture = {
  charge: number;
  /** Damped swings after the release. Ends on a zero crossing. */
  swing: number;
  /** Breath only, after this swing, before the next one. */
  rest: number;
  /** How far the body leans while gathering. The swing is a multiple of this. */
  wind: number;
  peak: number;
  sign: number;
  length: number;
};

type HangMotion = {
  /** Arc around the peg. The drawn arm follows this. */
  rock: number;
  /** Torso only, used while gathering. */
  lean: number;
  /** Extra body twist during the swing. It does not move the arms. */
  whip: number;
};

const hangStarts = [0];

function hangRand(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function hangSmooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function hangGesture(n: number): HangGesture {
  const wind = 0.14 + hangRand(n * 5) * 0.08;
  const peak = wind * (1.45 + hangRand(n * 5 + 1) * 0.7);
  const charge = 0.32 + hangRand(n * 5 + 2) * 0.18;
  const swing = 1.8;
  const rest = 2.8 + hangRand(n * 5 + 4) * 2.2;
  const sign = hangRand(n * 5 + 3) > 0.5 ? 1 : -1;
  return { charge, swing, rest, wind, peak, sign, length: charge + swing + rest };
}

function ensureHang(time: number): void {
  while (hangStarts[hangStarts.length - 1] < time + 1) {
    const n = hangStarts.length - 1;
    hangStarts.push(hangStarts[n] + hangGesture(n).length);
  }
}

function resetHang(): void {
  hangStarts.length = 0;
  hangStarts.push(0);
}

/** Occasional wind-up and a damped swing. View only; the body stays on the rope. */
function hangMotion(time: number): HangMotion {
  if (time <= 0) return { rock: 0, lean: 0, whip: 0 };
  ensureHang(time);
  let i = hangStarts.length - 2;
  while (i > 0 && hangStarts[i] > time) i -= 1;
  const g = hangGesture(i);
  let t = time - hangStarts[i];
  if (t < g.charge) {
    return { rock: 0, lean: -g.sign * g.wind * hangSmooth(t / g.charge), whip: 0 };
  }
  t -= g.charge;
  if (t >= g.swing) return { rock: 0, lean: 0, whip: 0 };
  const release = 0.2;
  const lean = t < release ? -g.sign * g.wind * (1 - hangSmooth(t / release)) : 0;
  const omega = (Math.PI * 2) / 0.72;
  const settle = 0.3;
  const env = t < g.swing - settle ? 1 : 1 - hangSmooth((t - (g.swing - settle)) / settle);
  const rock = g.sign * g.peak * Math.exp(-2.35 * t) * Math.sin(omega * t) * env;
  return { rock, lean, whip: rock * 1.65 };
}

const FOOT_HZ = 2.4;
const FOOT_ZETA = 0.85;
const FOOT_SWING = 0.65;

function stepFoot(foot: Foot, socketX: number, socketY: number, dt: number, rest = 0): void {
  const jumped = Math.hypot(socketX - foot.sx, socketY - foot.sy) > 100;
  if (!foot.ready || jumped || dt <= 0) {
    foot.angle = 0;
    foot.vel = 0;
    foot.sx = socketX;
    foot.sy = socketY;
    foot.vx = 0;
    foot.vy = 0;
    foot.ready = true;
    placeFoot(foot, socketX, socketY);
    return;
  }
  const vx = (socketX - foot.sx) / dt;
  const vy = (socketY - foot.sy) / dt;
  const ax = (vx - foot.vx) / dt;
  const ay = (vy - foot.vy) / dt;
  foot.sx = socketX;
  foot.sy = socketY;
  foot.vx = vx;
  foot.vy = vy;
  // Fictitious force of the moving ankle, tangent to the leg, in rad/s².
  // Opposite the ankle's acceleration, so a yank to the right leaves the toe behind.
  const lag = (Math.sin(foot.angle) * ay - Math.cos(foot.angle) * ax) / foot.length;
  const omega = FOOT_HZ * Math.PI * 2;
  const accel = -omega * omega * (foot.angle - rest) - 2 * FOOT_ZETA * omega * foot.vel + lag;
  foot.vel += accel * dt;
  foot.angle += foot.vel * dt;
  if (foot.angle > FOOT_SWING) {
    foot.angle = FOOT_SWING;
    foot.vel = Math.min(0, foot.vel);
  } else if (foot.angle < -FOOT_SWING) {
    foot.angle = -FOOT_SWING;
    foot.vel = Math.max(0, foot.vel);
  }
  placeFoot(foot, socketX, socketY);
}

function placeFoot(foot: Foot, socketX: number, socketY: number): void {
  const dx = Math.sin(foot.angle) * foot.length;
  const dy = Math.cos(foot.angle) * foot.length;
  foot.mesh.position.set(socketX + dx / 2, socketY + dy / 2, 0.47);
  foot.mesh.rotation.z = -foot.angle;
}

function monkeySize(): { headW: number; headH: number } {
  const headW = BODY_RADIUS * 2.2;
  return { headW, headH: headW * (FACE_H / FACE_W) };
}

/** Both arms, one sprite. Height is 1 design px so scale.y is the stretch. */
function makeArms(): THREE.Mesh {
  const width = monkeySize().headW * (ARM_TEX_W / ARM_TEX_H) * 0.55;
  const arms = artSprite(armsUrl, width, 1);
  arms.renderOrder = 0;
  arms.visible = false;
  return arms;
}

function artSprite(url: string, width: number, height: number): THREE.Mesh {
  const map = new THREE.TextureLoader().load(url);
  map.colorSpace = THREE.SRGBColorSpace;
  map.flipY = false;
  map.premultiplyAlpha = true;
  map.generateMipmaps = false;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearFilter;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      premultipliedAlpha: true,
      toneMapped: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
}

/**
 * One screen-sized plane. The art is 1179×1071 and tiles on the vertical seam.
 * Width fills the design stage; one copy is DESIGN_WIDTH * (h/w) world pixels tall.
 * Plane UV v=0 is the screen top (world y = cameraY). flipY stays false so the
 * file's top row stays at the top of the screen.
 */
/** Uniform scale so a sideways camera shift does not show a gap at the edge. */
const BG_SCALE = 1.24;

function mountJungle(backdrop: THREE.Group): THREE.Texture {
  const jungle = new THREE.TextureLoader().load(bgUrl, (tex) => {
    const image = tex.image as { width: number; height: number };
    const tileH = DESIGN_WIDTH * (image.height / image.width) * BG_SCALE;
    tex.repeat.set(1, (DESIGN_HEIGHT * BG_SCALE) / tileH);
    tex.userData.tileH = tileH;
    tex.needsUpdate = true;
  });
  jungle.colorSpace = THREE.SRGBColorSpace;
  jungle.flipY = false;
  jungle.wrapS = THREE.ClampToEdgeWrapping;
  jungle.wrapT = THREE.RepeatWrapping;
  jungle.magFilter = THREE.LinearFilter;
  jungle.minFilter = THREE.LinearFilter;
  const sheet = new THREE.Mesh(
    new THREE.PlaneGeometry(DESIGN_WIDTH * BG_SCALE, DESIGN_HEIGHT * BG_SCALE),
    new THREE.MeshBasicMaterial({ map: jungle, toneMapped: false, side: THREE.DoubleSide }),
  );
  sheet.position.set(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2, -1);
  // Opaque and full-screen. A higher renderOrder would paint over the shadows.
  sheet.renderOrder = -3;
  backdrop.add(sheet);
  mountWalls(backdrop);
  return jungle;
}

/** Side columns. The slice keeps the rounded frame; the middle stretches. */
const WALL_TEX_W = 328;
const WALL_TEX_H = 312;
const WALL_CAP_SRC = 36;
const WALL_W = 52;
const WALL_CAP = 18;
const WALL_SHADOW = 36;
/** Pull the inner shadow toward the wall, partly behind it. */
const WALL_SHADOW_OUT = 24;

/** Extra length above the screen and again below it. */
const WALL_OVER = 480;

function wallTexture(): THREE.Texture {
  const map = new THREE.TextureLoader().load(wallUrl);
  map.colorSpace = THREE.SRGBColorSpace;
  map.flipY = false;
  map.premultiplyAlpha = true;
  map.generateMipmaps = false;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearFilter;
  map.wrapS = THREE.ClampToEdgeWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  return map;
}

/** +y is down. v=0 is the top of the art and the top of the screen. */
function nineSliceGeometry(
  width: number,
  height: number,
  cap: number,
  insetU: number,
  insetV: number,
  uMax = 1,
): THREE.BufferGeometry {
  const xs = [-width / 2, -width / 2 + cap, width / 2 - cap, width / 2];
  const ys = [-height / 2, -height / 2 + cap, height / 2 - cap, height / 2];
  const us = [0, insetU, uMax - insetU, uMax];
  const vs = [0, insetV, 1 - insetV, 1];
  const pos: number[] = [];
  const uv: number[] = [];
  for (let iy = 0; iy < 4; iy += 1) {
    for (let ix = 0; ix < 4; ix += 1) {
      pos.push(xs[ix], ys[iy], 0);
      uv.push(us[ix], vs[iy]);
    }
  }
  const idx: number[] = [];
  for (let iy = 0; iy < 3; iy += 1) {
    for (let ix = 0; ix < 3; ix += 1) {
      const a = iy * 4 + ix;
      idx.push(a, a + 4, a + 1, a + 1, a + 4, a + 5);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

function mountWalls(backdrop: THREE.Group): void {
  const map = wallTexture();
  // The file's last column is transparent white. Stop half a texel before it.
  const uMax = (WALL_TEX_W - 1.5) / WALL_TEX_W;
  const insetU = WALL_CAP_SRC / WALL_TEX_W;
  const geo = nineSliceGeometry(
    WALL_W,
    DESIGN_HEIGHT + WALL_OVER * 2,
    WALL_CAP,
    insetU,
    WALL_CAP_SRC / WALL_TEX_H,
    uMax,
  );
  const material = new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    premultipliedAlpha: true,
    toneMapped: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const left = new THREE.Mesh(geo, material);
  const right = new THREE.Mesh(geo, material);
  left.position.set(SHAFT_LEFT - WALL_W / 2, DESIGN_HEIGHT / 2, -0.5);
  right.position.set(SHAFT_RIGHT + WALL_W / 2, DESIGN_HEIGHT / 2, -0.5);
  right.scale.x = -1;
  left.renderOrder = -1;
  right.renderOrder = -1;

  const shade = document.createElement('canvas');
  shade.width = 64;
  shade.height = 4;
  const shadeCtx = shade.getContext('2d');
  if (shadeCtx) {
    const solid = shade.width * 0.8;
    shadeCtx.fillStyle = 'rgba(62, 42, 32, 0.7)';
    shadeCtx.fillRect(0, 0, solid, shade.height);
    const fade = shadeCtx.createLinearGradient(solid, 0, shade.width, 0);
    fade.addColorStop(0, 'rgba(62, 42, 32, 0.7)');
    fade.addColorStop(1, 'rgba(62, 42, 32, 0)');
    shadeCtx.fillStyle = fade;
    shadeCtx.fillRect(solid, 0, shade.width - solid, shade.height);
  }
  const shadowMap = new THREE.CanvasTexture(shade);
  shadowMap.colorSpace = THREE.SRGBColorSpace;
  shadowMap.flipY = false;
  shadowMap.magFilter = THREE.LinearFilter;
  shadowMap.minFilter = THREE.LinearFilter;
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowMap,
    transparent: true,
    toneMapped: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shadowGeo = new THREE.PlaneGeometry(WALL_SHADOW, DESIGN_HEIGHT + WALL_OVER * 2);
  const leftShadow = new THREE.Mesh(shadowGeo, shadowMat);
  const rightShadow = new THREE.Mesh(shadowGeo, shadowMat);
  leftShadow.position.set(WALL_SHADOW / 2 - WALL_SHADOW_OUT + SHAFT_LEFT, DESIGN_HEIGHT / 2, -0.7);
  rightShadow.position.set(DESIGN_WIDTH - WALL_SHADOW / 2 + WALL_SHADOW_OUT - SHAFT_LEFT, DESIGN_HEIGHT / 2, -0.7);
  rightShadow.scale.x = -1;
  leftShadow.renderOrder = -2;
  rightShadow.renderOrder = -2;

  backdrop.add(leftShadow, rightShadow, left, right);
}

/**
 * The whole arm picture runs from inside the head to the peg.
 * The shoulder end is buried behind the face so the cut never shows.
 * Hands are the top of the art (plane local -y).
 * Check: peg straight above the body → rotation.z = 0, local -y points to the peg.
 */
function placeArms(
  arms: THREE.Mesh,
  pegX: number,
  pegY: number,
  bodyX: number,
  bodyY: number,
  spin: number,
  scaleX: number,
  scaleY: number,
): void {
  const { headH } = monkeySize();
  const cos = Math.cos(spin);
  const sin = Math.sin(spin);
  // +y is down. This sits below the crown, inside the head silhouette.
  const socketY = -headH * 0.05;
  const ox = -sin * socketY * scaleX;
  const oy = cos * socketY * scaleY;
  const dx = pegX - (bodyX + ox);
  const dy = pegY - (bodyY + oy);
  const length = Math.hypot(dx, dy);
  arms.visible = length > 1;
  if (length <= 1) return;
  arms.position.set(bodyX + ox + dx / 2, bodyY + oy + dy / 2, 0.2);
  arms.rotation.z = Math.atan2(dx, -dy);
  arms.scale.set(1, length, 1);
}

/**
 * Contact shadow from the reference. +x is right, +y is down.
 * The oval hangs off the lower-right edge. The sprite quads are nearly
 * opaque, so a shadow centered on the body is covered and never shows.
 */
const shadowMaps = new Map<string, THREE.DataTexture>();

/** `solid` is how far across the radius the oval stays dark before it fades. */
function shadowTexture(solid: number, opacity = 1): THREE.DataTexture {
  const key = `${solid}:${opacity}`;
  const cached = shadowMaps.get(key);
  if (cached) return cached;
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      const dist = Math.hypot(dx, dy) / 0.5;
      let falloff = 0;
      if (solid <= 0) falloff = dist >= 1 ? 0 : (1 - dist) ** 1.15;
      else if (dist < solid) falloff = 1;
      else if (dist < 1) falloff = 1 - (dist - solid) / (1 - solid);
      const i = (y * n + x) * 4;
      data[i] = 20;
      data[i + 1] = 36;
      data[i + 2] = 14;
      data[i + 3] = Math.round(falloff * opacity * 255);
    }
  }
  const map = new THREE.DataTexture(data, n, n);
  map.colorSpace = THREE.SRGBColorSpace;
  map.premultiplyAlpha = true;
  map.generateMipmaps = false;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  shadowMaps.set(key, map);
  return map;
}

function makeShadow(width: number, height: number, solid = 0, opacity = 1): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      map: shadowTexture(solid, opacity),
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.renderOrder = -2;
  return mesh;
}

/** Hollow ring: the hole fades out, the outer rim stays a hard edge. */
function pegRingMap(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const mid = size / 2;
    const image = ctx.createImageData(size, size);
    const data = image.data;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const r = Math.hypot(x - mid + 0.5, y - mid + 0.5) / mid;
        const inner = Math.min(1, Math.max(0, (r - 0.42) / 0.4));
        const alpha = r <= 0.96 ? inner : 0;
        const i = (y * size + x) * 4;
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = Math.round(alpha * 255);
      }
    }
    ctx.putImageData(image, 0, 0);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.premultiplyAlpha = true;
  map.needsUpdate = true;
  return map;
}

const pegRing = pegRingMap();

function burstMaterial(map: THREE.Texture | null): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map: map ?? undefined,
    color: 0xffffff,
    transparent: true,
    premultipliedAlpha: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    side: THREE.DoubleSide,
    opacity: 0,
  });
}

function makePegView(): PegView {
  const group = new THREE.Group();
  const shadow = makeShadow(PEG_W * 1.25, PEG_W * 0.88, 0.3, 0.65);
  // Above the back plate (renderOrder -1), under the red and blue caps (renderOrder 3).
  // Local +x is the long axis. +y is down, so this aims down-right, away from the peg.
  shadow.renderOrder = 1;
  shadow.rotation.z = Math.atan2(PEG_H, PEG_W);
  shadow.position.set(PEG_W * 0.38, PEG_H * 0.38, 0.2);
  const back = artSprite(pegBackUrl, PEG_W, PEG_H);
  back.renderOrder = -1;
  back.position.z = -0.4;
  const blue = artSprite(pegBlueUrl, PEG_W, PEG_H);
  const red = artSprite(pegRedUrl, PEG_W, PEG_H);
  const green = artSprite(pegGreenUrl, PEG_W, PEG_H);
  const gray = artSprite(pegGrayUrl, PEG_W, PEG_H);
  blue.renderOrder = 3;
  red.renderOrder = 3;
  green.renderOrder = 3;
  gray.renderOrder = 3;
  blue.position.z = 0.8;
  red.position.z = 0.8;
  green.position.z = 0.8;
  gray.position.z = 0.8;
  red.visible = false;
  green.visible = false;
  gray.visible = false;
  // Same 129×123 frame as the rivet. WebGPU adds when premultipliedAlpha is on.
  const flashMap = new THREE.TextureLoader().load(pegFlashUrl);
  flashMap.colorSpace = THREE.SRGBColorSpace;
  flashMap.flipY = false;
  flashMap.premultiplyAlpha = true;
  flashMap.generateMipmaps = false;
  flashMap.magFilter = THREE.LinearFilter;
  flashMap.minFilter = THREE.LinearFilter;
  const flashMat = new THREE.MeshBasicMaterial({
    map: flashMap,
    transparent: true,
    premultipliedAlpha: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    side: THREE.DoubleSide,
    opacity: 1,
  });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(PEG_W, PEG_H), flashMat);
  flash.renderOrder = 8;
  flash.position.z = 1.2;
  flash.scale.setScalar(1);
  flash.visible = false;
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(PEG_W * 1.15, PEG_W * 1.15), burstMaterial(pegRing));
  ring.renderOrder = 9;
  ring.position.z = 1.4;
  ring.visible = false;
  const grab = new THREE.Mesh(
    new THREE.RingGeometry(0.94, 1, 64),
    new THREE.MeshBasicMaterial({
      color: 0xffe28a,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  );
  grab.renderOrder = 6;
  grab.position.z = 0.6;
  group.add(shadow, back, blue, red, green, gray, flash, ring, grab);
  return { group, back, blue, red, green, gray, flash, ring, grab, blink: 0, burst: -1 };
}

function syncView(
  dt: number,
  world: SlingWorld,
  camera: THREE.OrthographicCamera,
  actor: THREE.Group,
  eyes: THREE.Mesh,
  feet: [Foot, Foot],
  actorShadow: THREE.Mesh,
  arms: THREE.Mesh,
  flash: THREE.Mesh,
  center: THREE.Mesh,
  pegRoot: THREE.Group,
  pegViews: Map<number, PegView>,
  backdrop: THREE.Group,
  jungle: THREE.Texture,
  grabSeen: { n: number },
  aimLine: THREE.Line,
): void {
  camera.position.x = world.cameraX;
  camera.position.y = world.cameraY;
  camera.updateMatrixWorld();
  backdrop.position.y = world.cameraY;
  const tileH = jungle.userData.tileH as number | undefined;
  if (tileH) jungle.offset.y = world.cameraY / tileH;

  const impact = pegImpact(world.squash);
  const heldNow = world.pegs.find((peg) => peg.id === world.heldId);
  const attached =
    heldNow !== undefined &&
    (world.phase === 'hang' ||
      world.phase === 'drag' ||
      world.phase === 'return' ||
      world.phase === 'launch');
  // Local -y is the crown. atan2(dx, -dy) is 0 when the peg is straight above.
  const aim = heldNow
    ? Math.atan2(heldNow.x - world.body.x, -(heldNow.y - world.body.y))
    : world.body.spin;
  // The drawn angle is always body.spin. Drag and flight ease that value,
  // so the sprite does not swap targets when the phase changes.
  const swingSpeed = Math.hypot(world.body.vx, world.body.vy);
  // Both idles start only after the rope has stopped, so they do not
  // stack on a catch that is still turning or swinging.
  const calm = world.phase === 'hang' && world.catch === null && swingSpeed <= 8;
  idleBlend += ((calm ? 1 : 0) - idleBlend) * (1 - Math.exp(-dt / 0.16));
  if (calm || idleBlend > 0.03) idleTime += dt;
  else {
    idleTime = 0;
    resetHang();
  }
  const bob = hangBreath(idleTime) * idleBlend;
  const motion = hangMotion(idleTime);
  stepEyes(eyes, dt);
  const rock = motion.rock * idleBlend;
  let poseX = world.body.x;
  let poseY = world.body.y + bob;
  if (attached && heldNow && rock !== 0) {
    const dx = world.body.x - heldNow.x;
    const dy = world.body.y - heldNow.y;
    const rc = Math.cos(rock);
    const rs = Math.sin(rock);
    poseX = heldNow.x + rc * dx - rs * dy;
    poseY = heldNow.y + rs * dx + rc * dy + bob;
  }
  // Full pull only. The shake stays on the pull line and does not move the body.
  if (world.phase === 'drag' && world.fullPull && heldNow) {
    const dx = world.body.x - heldNow.x;
    const dy = world.body.y - heldNow.y;
    const reach = Math.hypot(dx, dy);
    if (reach > 1) {
      maxShake += dt;
      const alongPull = Math.sin(maxShake * 62) * 1.5;
      poseX += (dx / reach) * alongPull;
      poseY += (dy / reach) * alongPull;
    }
  } else maxShake = 0;
  const handX = poseX;
  const handY = poseY;
  const armFacing = (attached ? aim : world.body.spin) + rock;
  const poseFacing = world.body.spin + (motion.lean + motion.whip) * idleBlend;
  actor.position.set(poseX, poseY, 0.4);
  actor.rotation.z = poseFacing;
  center.position.set(world.body.x, world.body.y, 2);
  center.visible = guides.show;
  const stretch = Math.min(0.07, Math.abs(rock) * 0.28 + Math.abs(bob) * 0.008);
  // Local +y runs crown to feet. A full pull lengthens that axis to 1.2.
  let along = 1;
  if (attached && heldNow) {
    const reach = Math.hypot(world.body.x - heldNow.x, world.body.y - heldNow.y);
    const span = Math.max(1, armMax() - feel.restDrop);
    const pull = Math.min(1, Math.max(0, reach - feel.restDrop) / span);
    along = 1 + pull * 0.2;
  }
  actor.scale.set(
    impact.cross * (1 - stretch * 0.65),
    impact.along * (1 + stretch) * along,
    1,
  );
  const step = Math.min(Math.max(dt, 0), 1 / 30);
  const cos = Math.cos(poseFacing);
  const sin = Math.sin(poseFacing);
  const footMotion = hangMotion(Math.max(0, idleTime - 0.12));
  const footRest = -(footMotion.rock + footMotion.lean + footMotion.whip) * 1.25 * idleBlend;
  for (const foot of feet) {
    const ox = (cos * foot.lx - sin * foot.ly) * actor.scale.x;
    const oy = (sin * foot.lx + cos * foot.ly) * actor.scale.y;
    stepFoot(foot, poseX + ox, poseY + oy, step, footRest);
  }
  const { headW, headH } = monkeySize();
  actorShadow.position.set(poseX + headW * 0.12, poseY + headH * 0.17, 0);
  actorShadow.rotation.z = 0;
  actorShadow.scale.set(actor.scale.x, 1, 1);
  const alive = world.phase !== 'fall';
  actor.visible = alive;
  actorShadow.visible = alive;
  for (const foot of feet) foot.mesh.visible = alive;

  if (!attached || !heldNow) {
    arms.visible = false;
  } else {
    placeArms(
      arms,
      heldNow.x,
      heldNow.y,
      handX,
      handY,
      armFacing,
      actor.scale.x,
      actor.scale.y,
    );
  }

  if (world.flash > 0 && world.leftId >= 0) {
    const from = world.pegs.find((peg) => peg.id === world.leftId);
    flash.visible = !!from;
    if (from) {
      const t = world.flash / 0.12;
      flash.position.set(from.x, from.y, 0.5);
      flash.scale.setScalar(1.4 - t);
      (flash.material as THREE.MeshBasicMaterial).opacity = t;
    }
  } else {
    flash.visible = false;
  }
  if (!alive) {
    arms.visible = false;
    flash.visible = false;
  }

  const dragAim = guides.show && world.phase === 'drag' ? readAim(world) : null;
  if (!dragAim || dragAim.points.length < 2) {
    aimLine.visible = false;
  } else {
    aimLine.visible = true;
    aimLine.geometry.setFromPoints(dragAim.points.map((point) => new THREE.Vector3(point.x, point.y, 1)));
  }

  for (const peg of world.pegs) {
    let view = pegViews.get(peg.id);
    if (!view) {
      view = makePegView();
      pegRoot.add(view.group);
      pegViews.set(peg.id, view);
    }
    view.group.visible = peg.live;
    if (!peg.live) continue;
    view.group.position.set(peg.x, peg.y, 0);
    const assisted =
      (dragAim && peg.id === dragAim.pegId) ||
      (!dragAim && peg.id === world.aimId);
    const catchRadius = assisted
      ? dragAim && peg.id === dragAim.pegId
        ? dragAim.radius
        : world.aimRadius
      : feel.grabRadius;
    view.grab.visible = guides.show;
    view.grab.scale.setScalar(catchRadius);
    if (world.grabPulse !== grabSeen.n && peg.id === world.heldId && world.grabPulse > 0) {
      view.burst = 0;
    }
    const spent = pegSpent(peg);
    const green = peg.kind === 'green';
    view.back.visible = true;
    view.gray.visible = spent;
    view.green.visible = !spent && green;
    view.red.visible = !spent && peg.kind === 'red';
    view.blue.visible = !spent && peg.kind === 'blue';
    const hanging =
      peg.id === world.heldId &&
      (world.phase === 'hang' || world.phase === 'drag' || world.phase === 'return');
    const flashMat = view.flash.material as THREE.MeshBasicMaterial;
    if (hanging && pegWarn(peg)) {
      const urgency = pegUrgency(peg);
      const hz = PEG_FLASH_HZ.slow + urgency * (PEG_FLASH_HZ.fast - PEG_FLASH_HZ.slow);
      view.blink += dt * hz;
      const wave = 0.5 + 0.5 * Math.sin(view.blink * Math.PI * 2);
      const tint = peg.kind === 'red' ? PEG_FLASH_COLOR.red : PEG_FLASH_COLOR.blue;
      const keep = 1 - PEG_FLASH_WHITE;
      flashMat.color.setRGB(
        PEG_FLASH_WHITE + tint[0] * keep,
        PEG_FLASH_WHITE + tint[1] * keep,
        PEG_FLASH_WHITE + tint[2] * keep,
        THREE.SRGBColorSpace,
      );
      flashMat.color.multiplyScalar(PEG_FLASH_PEAK);
      flashMat.opacity = wave;
      view.flash.visible = true;
    } else {
      view.flash.visible = false;
      flashMat.opacity = 0;
    }
    const cap = view.red.visible ? view.red : view.blue.visible ? view.blue : view.green.visible ? view.green : view.gray;
    const capMat = cap.material as THREE.MeshBasicMaterial;
    if (view.burst < 0) {
      capMat.color.setRGB(1, 1, 1);
      view.ring.visible = false;
      continue;
    }
    view.burst += dt;
    const u = view.burst / PEG_BURST;
    if (u >= 1) {
      view.burst = -1;
      capMat.color.setRGB(1, 1, 1);
      view.ring.visible = false;
      continue;
    }
    const fade = (1 - u) * (1 - u);
    capMat.color.setRGB(1, 1, 1);
    capMat.color.multiplyScalar(1 + 2.4 * fade);
    const ringMat = view.ring.material as THREE.MeshBasicMaterial;
    const tint = peg.kind === 'red' ? PEG_FLASH_COLOR.red : peg.kind === 'green' ? [0.45, 0.9, 0.4] : PEG_FLASH_COLOR.blue;
    ringMat.color.setRGB(
      0.55 + tint[0] * 0.45,
      0.55 + tint[1] * 0.45,
      0.55 + tint[2] * 0.45,
      THREE.SRGBColorSpace,
    );
    ringMat.opacity = fade;
    view.ring.visible = true;
    view.ring.scale.setScalar(0.72 + u * 1.9);
  }
  grabSeen.n = world.grabPulse;
}

async function boot(): Promise<void> {
  const ui = document.getElementById('ui-root');
  let world: SlingWorld;
  let seed = 1;
  const grabSeen = { n: 0 };
  const retry = () => {
    const fromX = world.body.x;
    seed += 1;
    world = createWorld(mulberry32(seed));
    beginEnter(world, fromX);
    grabSeen.n = 0;
    idleTime = 0;
    idleBlend = 0;
    death.setOpen(false);
  };
  const death = ui ? mountDeathScreen(ui, retry) : { setOpen: () => {} };
  if (ui) mountTunePanel(ui);
  applyNativeClass();
  const native = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();

  await initPhysics();
  world = createWorld(mulberry32(seed));
  const renderer = await createRenderer({ container: stage });
  renderer.domElement.style.pointerEvents = 'auto';

  const { scene, camera, actor, eyes, feet, actorShadow, arms, flash, center, pegRoot, backdrop, jungle, aimLine } = bootScene();
  const pegViews = new Map<number, PegView>();

  let layout: StageLayout | null = null;

  const onLayout = (next: StageLayout) => {
    layout = next;
    applyStageTransform(stage, next);
    applySafeAreaCssVars(native);
    renderer.setSize(DESIGN_WIDTH, DESIGN_HEIGHT, false);
  };

  const preview: DevicePreviewController = mountDevicePreview(shell, viewportEl, () => {
    const size = preview.getViewSize();
    onLayout(computeStageLayout(size.width, size.height, 'contain'));
  });

  const unwatch = watchStageLayout(onLayout, {
    mode: 'contain',
    getViewSize: () => preview.getViewSize(),
  });

  // #viewport is CSS-scaled and centered on desktop. Read the stage box so the
  // pointer survives that transform; then add the scrolling camera.
  const designPoint = (event: PointerEvent): { x: number; y: number } | null => {
    if (!layout) return null;
    const rect = stage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = ((event.clientX - rect.left) / rect.width) * DESIGN_WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * DESIGN_HEIGHT;
    if (!isInDesignBounds(x, y) && world.phase !== 'drag') return null;
    return { x, y };
  };

  let dragPointer: number | null = null;

  const applyPointer = (event: PointerEvent): void => {
    const design = designPoint(event);
    if (!design) return;
    const point = pointerToWorld(world, design.x, design.y);
    dragTo(world, point.x, point.y);
  };

  const forgetPointer = (event: PointerEvent): void => {
    dragPointer = null;
    if (renderer.domElement.hasPointerCapture(event.pointerId)) {
      renderer.domElement.releasePointerCapture(event.pointerId);
    }
  };

  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (dragPointer !== null) return;
    const design = designPoint(event);
    if (!design) return;
    if (world.phase === 'fall') return;
    if (design.y > DRAG_BLOCK_Y) return;
    const point = pointerToWorld(world, design.x, design.y);
    if (!tryBeginDrag(world, point.x, point.y)) return;
    dragPointer = event.pointerId;
    dragTo(world, point.x, point.y);
    renderer.domElement.setPointerCapture(event.pointerId);
  });

  renderer.domElement.addEventListener('pointermove', (event) => {
    if (event.pointerId !== dragPointer) return;
    applyPointer(event);
  });

  renderer.domElement.addEventListener('pointerup', (event) => {
    if (event.pointerId !== dragPointer) return;
    applyPointer(event);
    endDrag(world);
    forgetPointer(event);
  });

  renderer.domElement.addEventListener('pointercancel', (event) => {
    if (event.pointerId !== dragPointer) return;
    cancelDrag(world);
    forgetPointer(event);
  });

  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const frameDt = (now - last) / 1000;
    last = now;
    advance(world, frameDt);
    death.setOpen(world.phase === 'fall');
    syncView(
      frameDt,
      world,
      camera,
      actor,
      eyes,
      feet,
      actorShadow,
      arms,
      flash,
      center,
      pegRoot,
      pegViews,
      backdrop,
      jungle,
      grabSeen,
      aimLine,
    );
    const pull = Math.round(pullLength(world));
    setStatus(
      `${platform}${native ? ' · native' : ''}\n` +
        `${world.phase} · height ${Math.round(world.height)} · pull ${pull}` +
        (world.phase === 'drag'
          ? pull < feel.minPull
            ? ` · under ${feel.minPull}`
            : ` · shot ${Math.min(pull, feel.maxPull)}`
          : ''),
    );
    renderer.render(scene, camera);
  });

  window.addEventListener(
    'pagehide',
    () => {
      unwatch();
      preview.dispose();
      renderer.setAnimationLoop(null);
      renderer.dispose();
      restart(world);
    },
    { once: true },
  );
}

boot().catch((err) => {
  console.error(err);
  setStatus(`boot failed: ${err instanceof Error ? err.message : String(err)}`);
});
