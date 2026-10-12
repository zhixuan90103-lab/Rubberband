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
  ARM_SAG,
  BODY_RADIUS,
  DRAG_BLOCK_Y,
  HANG_DROP,
  MAX_PULL,
  MIN_PULL,
  SHOULDER,
} from './game/tune';
import type { Peg } from './game/pegs';
import bgUrl from './assets/bg-jungle.png';

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

const ARM_SEGMENTS = 10;

function makeArm(): THREE.Mesh {
  const positions = new Float32Array((ARM_SEGMENTS + 1) * 2 * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const indices: number[] = [];
  for (let i = 0; i < ARM_SEGMENTS; i += 1) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geometry.setIndex(indices);
  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: 0xf4efe4, side: THREE.DoubleSide }),
  );
}

type PegView = {
  group: THREE.Group;
  rim: THREE.Mesh;
  core: THREE.Mesh;
};

function bootScene(): {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  actor: THREE.Mesh;
  armL: THREE.Mesh;
  armR: THREE.Mesh;
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

  const armL = makeArm();
  const armR = makeArm();
  scene.add(armL, armR);

  const actor = new THREE.Mesh(
    new THREE.CircleGeometry(BODY_RADIUS, 28),
    new THREE.MeshBasicMaterial({ color: 0xf2c14e, side: THREE.DoubleSide }),
  );
  scene.add(actor);

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

  return { scene, camera, actor, armL, armR, flash, pegRoot, backdrop, jungle };
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
  backdrop.add(sheet);
  return jungle;
}

/** Hands stay on the peg. The band bows between the peg and one shoulder. */
function placeArm(
  arm: THREE.Mesh,
  pegX: number,
  pegY: number,
  shoulderX: number,
  shoulderY: number,
  bow: number,
): void {
  const dx = shoulderX - pegX;
  const dy = shoulderY - pegY;
  const length = Math.hypot(dx, dy);
  arm.visible = length > 1;
  if (length <= 1) return;
  const slack = 1 - Math.min(1, Math.max(0, length - HANG_DROP) / MAX_PULL);
  const sag = ARM_SAG * (0.35 + 0.65 * slack);
  const nx = -dy / length;
  const ny = dx / length;
  const cx = (pegX + shoulderX) / 2 + nx * sag * bow;
  const cy = (pegY + shoulderY) / 2 + ny * sag * bow;
  const half = 2.6;
  const positions = arm.geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i <= ARM_SEGMENTS; i += 1) {
    const t = i / ARM_SEGMENTS;
    const omt = 1 - t;
    const x = omt * omt * pegX + 2 * omt * t * cx + t * t * shoulderX;
    const y = omt * omt * pegY + 2 * omt * t * cy + t * t * shoulderY;
    const tx = 2 * omt * (cx - pegX) + 2 * t * (shoulderX - cx);
    const ty = 2 * omt * (cy - pegY) + 2 * t * (shoulderY - cy);
    const tangent = Math.hypot(tx, ty) || 1;
    const px = (-ty / tangent) * half;
    const py = (tx / tangent) * half;
    positions.setXYZ(i * 2, x + px, y + py, 0.2);
    positions.setXYZ(i * 2 + 1, x - px, y - py, 0.2);
  }
  positions.needsUpdate = true;
  arm.geometry.computeBoundingSphere();
  arm.position.set(0, 0, 0);
  arm.rotation.z = 0;
  arm.scale.set(1, 1, 1);
}

function shoulders(peg: Peg, x: number, y: number): [{ x: number; y: number }, { x: number; y: number }] {
  const dx = x - peg.x;
  const dy = y - peg.y;
  const length = Math.hypot(dx, dy) || 1;
  const ox = (-dy / length) * SHOULDER;
  const oy = (dx / length) * SHOULDER;
  return [
    { x: x + ox, y: y + oy },
    { x: x - ox, y: y - oy },
  ];
}

function makePegView(): PegView {
  const group = new THREE.Group();
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(12, 16),
    new THREE.MeshBasicMaterial({
      color: 0x1a3a22,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
    }),
  );
  shadow.position.set(5, 8, -0.2);
  shadow.scale.set(1, 0.55, 1);
  const rim = new THREE.Mesh(
    new THREE.CircleGeometry(13, 22),
    new THREE.MeshBasicMaterial({ color: 0x6b4a32, side: THREE.DoubleSide }),
  );
  const core = new THREE.Mesh(
    new THREE.CircleGeometry(9, 22),
    new THREE.MeshBasicMaterial({ color: 0x7ec8f0, side: THREE.DoubleSide }),
  );
  core.position.z = 0.1;
  group.add(shadow, rim, core);
  return { group, rim, core };
}

function syncView(
  world: SlingWorld,
  camera: THREE.OrthographicCamera,
  actor: THREE.Mesh,
  armL: THREE.Mesh,
  armR: THREE.Mesh,
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

  const held = world.pegs.find((peg) => peg.id === world.heldId);
  const showArms =
    (world.phase === 'hang' ||
      world.phase === 'drag' ||
      world.phase === 'return' ||
      world.phase === 'launch') &&
    held;
  if (!showArms || !held) {
    armL.visible = false;
    armR.visible = false;
  } else {
    const [left, right] = shoulders(held, world.body.x, world.body.y);
    placeArm(armL, held.x, held.y, left.x, left.y, 1);
    placeArm(armR, held.x, held.y, right.x, right.y, -1);
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
    const isHeld =
      peg.id === world.heldId && world.phase !== 'fly' && world.phase !== 'fall';
    const red = peg.kind === 'red';
    (view.rim.material as THREE.MeshBasicMaterial).color.setHex(red ? 0x8a3030 : 0x6b4a32);
    (view.core.material as THREE.MeshBasicMaterial).color.setHex(
      red ? (isHeld ? 0xff8d7a : 0xe85d4c) : isHeld ? 0xd7f4ff : 0x7ec8f0,
    );
  }
}

async function boot(): Promise<void> {
  applyNativeClass();
  const native = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();

  await initPhysics();
  const renderer = await createRenderer({ container: stage });
  renderer.domElement.style.pointerEvents = 'auto';

  const { scene, camera, actor, armL, armR, flash, pegRoot, backdrop, jungle } = bootScene();
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
    syncView(world, camera, actor, armL, armR, flash, pegRoot, pegViews, backdrop, jungle);
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
