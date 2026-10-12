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
import {
  BODY_RADIUS,
  DRAG_BLOCK_Y,
  MAX_PULL,
  MIN_PULL,
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

  const actor = makeMonkey();
  scene.add(actor);

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

  return { scene, camera, actor, actorShadow, arms, flash, pegRoot, backdrop, jungle };
}

/**
 * Local +y is down the screen. The face art is the head only. Pupils sit in the
 * blank eyes. Feet sit under the chin. Arms are a separate pair.
 */
function makeMonkey(): THREE.Group {
  const { headW, headH } = monkeySize();
  // Slot art is 73×28. Its pupil centers are 48px apart; the face eyes are 58px apart.
  const eyeW = headW * ((58 / 48) * 73) / FACE_W;
  const eyeH = eyeW * (28 / 73);
  const footW = headW * 0.22;
  const footH = footW * (52 / 48);

  const group = new THREE.Group();
  group.renderOrder = 2;
  const face = artSprite(faceUrl, headW, headH);
  const eyes = artSprite(eyesUrl, eyeW, eyeH);
  // Eye whites are centered near y=72 in the 223px face.
  eyes.position.set(0, (72 / FACE_H - 0.5) * headH, 0.05);
  const footL = artSprite(footUrl, footW, footH);
  const footR = artSprite(footUrl, footW, footH);
  const footY = (208 / FACE_H - 0.5) * headH;
  footL.position.set(-headW * 0.2, footY, 0.07);
  footR.position.set(headW * 0.2, footY, 0.07);
  group.add(face, eyes, footL, footR);
  for (const part of group.children) part.renderOrder = 2;
  return group;
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
  world: SlingWorld,
  camera: THREE.OrthographicCamera,
  actor: THREE.Group,
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
  camera.updateMatrixWorld();
  backdrop.position.y = world.cameraY;
  const tileH = jungle.userData.tileH as number | undefined;
  if (tileH) jungle.offset.y = world.cameraY / tileH;

  const squash = world.squash > 0 ? world.squash / 0.12 : 0;
  actor.position.set(world.body.x, world.body.y, 0.4);
  actor.rotation.z = world.body.spin;
  actor.scale.set(1 + squash * 0.35, 1 - squash * 0.4, 1);
  const { headW, headH } = monkeySize();
  actorShadow.position.set(world.body.x + headW * 0.12, world.body.y + headH * 0.17, 0);
  actorShadow.rotation.z = 0;
  actorShadow.scale.set(actor.scale.x, 1, 1);

  const held = world.pegs.find((peg) => peg.id === world.heldId);
  const showArms =
    (world.phase === 'hang' ||
      world.phase === 'drag' ||
      world.phase === 'return' ||
      world.phase === 'launch') &&
    held;
  if (!showArms || !held) {
    arms.visible = false;
  } else {
    placeArms(
      arms,
      held.x,
      held.y,
      world.body.x,
      world.body.y,
      world.body.spin,
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
  applyNativeClass();
  const native = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();

  await initPhysics();
  const renderer = await createRenderer({ container: stage });
  renderer.domElement.style.pointerEvents = 'auto';

  const { scene, camera, actor, actorShadow, arms, flash, pegRoot, backdrop, jungle } = bootScene();
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
    syncView(world, camera, actor, actorShadow, arms, flash, pegRoot, pegViews, backdrop, jungle);
    const pull = Math.round(pullLength(world));
    setStatus(
      `${platform}${native ? ' · native' : ''}\n` +
        `${world.phase} · height ${Math.round(world.height)} · pull ${pull}` +
        (world.phase === 'drag'
          ? pull < MIN_PULL
            ? ` · under ${MIN_PULL}`
            : ` · shot ${Math.min(pull, MAX_PULL)}`
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
