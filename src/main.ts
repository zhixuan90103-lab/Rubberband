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
import { mulberry32 } from './game/pegs';
import { initPhysics } from './game/sim';
import {
  advance,
  createWorld,
  dragTo,
  endDrag,
  pointerToWorld,
  pullLength,
  restart,
  tryBeginDrag,
  type SlingWorld,
} from './game/sling';
import { mountTunePanel } from './game/tunePanel';
import {
  BODY_RADIUS,
  DRAG_BLOCK_Y,
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

const stage = document.getElementById('stage')!;
const shell = document.getElementById('shell')!;
const viewportEl = document.getElementById('viewport')!;
const statusEl = document.getElementById('status');

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

function makeOrtho(): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(0, DESIGN_WIDTH, 0, DESIGN_HEIGHT, 0.1, 50);
  camera.position.set(0, 0, 10);
  return camera;
}

type PegView = {
  group: THREE.Group;
  blue: THREE.Mesh;
  red: THREE.Mesh;
};

/** Ring and back plate share a 129×123 canvas. One size keeps them aligned. */
const PEG_W = 52;
const PEG_H = PEG_W * (123 / 129);

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
  pegRoot: THREE.Group;
  backdrop: THREE.Group;
  jungle: THREE.Texture;
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

  return { scene, camera, actor, eyes, feet, actorShadow, arms, flash, pegRoot, backdrop, jungle };
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

function stepEyes(eyes: THREE.Mesh, dt: number): void {
  eyeClock += dt;
  const pose = eyePose(eyeClock);
  const baseX = eyes.userData.baseX as number;
  const baseY = eyes.userData.baseY as number;
  eyes.position.set(baseX + pose.x, baseY + pose.y, 0.05);
  eyes.scale.y = 1 - pose.blink * 0.92;
}

/** Settled-hang breath, pixels. +y is down, so this only lifts the body. */
function hangBreath(time: number): number {
  if (time <= 0) return 0;
  const period = 1.25;
  const amp = 2;
  const phase = (time / period) * Math.PI * 2;
  return -amp * 0.5 * (1 - Math.cos(phase));
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
function mountJungle(backdrop: THREE.Group): THREE.Texture {
  const jungle = new THREE.TextureLoader().load(bgUrl, (tex) => {
    const image = tex.image as { width: number; height: number };
    const tileH = DESIGN_WIDTH * (image.height / image.width);
    tex.repeat.set(1, DESIGN_HEIGHT / tileH);
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
    new THREE.PlaneGeometry(DESIGN_WIDTH, DESIGN_HEIGHT),
    new THREE.MeshBasicMaterial({ map: jungle, toneMapped: false, side: THREE.DoubleSide }),
  );
  sheet.position.set(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2, -1);
  // Opaque and full-screen. A higher renderOrder would paint over the shadows.
  sheet.renderOrder = -3;
  backdrop.add(sheet);
  return jungle;
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
  blue.renderOrder = 3;
  red.renderOrder = 3;
  blue.position.z = 0.8;
  red.position.z = 0.8;
  red.visible = false;
  group.add(shadow, back, blue, red);
  return { group, blue, red };
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
  pegRoot: THREE.Group,
  pegViews: Map<number, PegView>,
  backdrop: THREE.Group,
  jungle: THREE.Texture,
): void {
  camera.position.x = 0;
  camera.position.y = world.cameraY;
  stepEyes(eyes, dt);
  camera.updateMatrixWorld();
  backdrop.position.y = world.cameraY;
  const tileH = jungle.userData.tileH as number | undefined;
  if (tileH) jungle.offset.y = world.cameraY / tileH;

  const squash = world.squash > 0 ? world.squash / 0.12 : 0;
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
  // Idle starts only after the rope has stopped. It never orbits the body:
  // that orbit was a second swing that did not decay.
  const calm = world.phase === 'hang' && world.catch === null && swingSpeed <= 8;
  idleBlend += ((calm ? 1 : 0) - idleBlend) * (1 - Math.exp(-dt / 0.16));
  if (calm || idleBlend > 0.03) idleTime += dt;
  else idleTime = 0;
  // Breath only. A second swing or a torso lean fights the rope and the squared angle.
  const bob = hangBreath(idleTime) * idleBlend;
  const poseX = world.body.x;
  const poseY = world.body.y + bob;
  const handX = poseX;
  const handY = poseY;
  const armFacing = attached ? aim : world.body.spin;
  const poseFacing = world.body.spin;
  actor.position.set(poseX, poseY, 0.4);
  actor.rotation.z = poseFacing;
  const stretch = Math.min(0.04, Math.abs(bob) * 0.008);
  actor.scale.set((1 + squash * 0.35) * (1 - stretch * 0.65), (1 - squash * 0.4) * (1 + stretch), 1);
  const step = Math.min(Math.max(dt, 0), 1 / 30);
  const cos = Math.cos(poseFacing);
  const sin = Math.sin(poseFacing);
  for (const foot of feet) {
    const ox = (cos * foot.lx - sin * foot.ly) * actor.scale.x;
    const oy = (sin * foot.lx + cos * foot.ly) * actor.scale.y;
    stepFoot(foot, poseX + ox, poseY + oy, step, 0);
  }
  const { headW, headH } = monkeySize();
  actorShadow.position.set(poseX + headW * 0.12, poseY + headH * 0.17, 0);
  actorShadow.rotation.z = 0;
  actorShadow.scale.set(actor.scale.x, 1, 1);

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

  const live = new Set(world.pegs.map((peg) => peg.id));
  for (const [id, view] of pegViews) {
    if (!live.has(id)) {
      pegRoot.remove(view.group);
      pegViews.delete(id);
    }
  }
  for (const peg of world.pegs) {
    let view = pegViews.get(peg.id);
    if (!view) {
      view = makePegView();
      pegRoot.add(view.group);
      pegViews.set(peg.id, view);
    }
    view.group.position.set(peg.x, peg.y, 0);
    const red = peg.kind === 'red';
    view.red.visible = red;
    view.blue.visible = !red;
  }
}

async function boot(): Promise<void> {
  const ui = document.getElementById('ui-root');
  if (ui) mountTunePanel(ui);
  applyNativeClass();
  const native = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();

  await initPhysics();
  const renderer = await createRenderer({ container: stage });
  renderer.domElement.style.pointerEvents = 'auto';

  const { scene, camera, actor, eyes, feet, actorShadow, arms, flash, pegRoot, backdrop, jungle } = bootScene();
  const pegViews = new Map<number, PegView>();

  let layout: StageLayout | null = null;
  let world = createWorld(mulberry32(1));
  let seed = 1;

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
    if (!isInDesignBounds(x, y)) return null;
    return { x, y };
  };

  renderer.domElement.addEventListener('pointerdown', (event) => {
    const design = designPoint(event);
    if (!design) return;
    if (world.phase === 'fall') {
      seed += 1;
      world = createWorld(mulberry32(seed));
      idleTime = 0;
      idleBlend = 0;
      return;
    }
    if (design.y > DRAG_BLOCK_Y) return;
    const point = pointerToWorld(world, design.x, design.y);
    if (!tryBeginDrag(world, point.x, point.y)) return;
    renderer.domElement.setPointerCapture(event.pointerId);
  });

  renderer.domElement.addEventListener('pointermove', (event) => {
    if (world.phase !== 'drag') return;
    const design = designPoint(event);
    if (!design) return;
    const point = pointerToWorld(world, design.x, design.y);
    dragTo(world, point.x, point.y);
  });

  const release = (event: PointerEvent) => {
    if (world.phase !== 'drag') return;
    endDrag(world);
    if (renderer.domElement.hasPointerCapture(event.pointerId)) {
      renderer.domElement.releasePointerCapture(event.pointerId);
    }
  };
  renderer.domElement.addEventListener('pointerup', release);
  renderer.domElement.addEventListener('pointercancel', release);

  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const frameDt = (now - last) / 1000;
    last = now;
    advance(world, frameDt);
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
      pegRoot,
      pegViews,
      backdrop,
      jungle,
    );
    const pull = Math.round(pullLength(world));
    setStatus(
      `${platform}${native ? ' · native' : ''}\n` +
        `${world.phase} · height ${Math.round(world.height)} · pull ${pull}` +
        (world.phase === 'drag'
          ? pull < feel.minPull
            ? ` · under ${feel.minPull}`
            : ` · shot ${Math.min(pull, feel.maxPull)}`
          : '') +
        (world.phase === 'fall' ? '\ntap to restart' : ''),
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
