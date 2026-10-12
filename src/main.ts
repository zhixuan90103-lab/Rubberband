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
  clientToDesign,
  computeStageLayout,
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
import {
  advance,
  createWorld,
  dragTo,
  endDrag,
  pullLength,
  restart,
  tryBeginDrag,
  type SlingWorld,
} from './game/sling';
import {
  MAX_PULL,
  MIN_PULL,
  SHAFT_LEFT,
  SHAFT_RIGHT,
  SHOULDER,
} from './game/tune';
import type { Peg } from './game/pegs';

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

function makeArm(): THREE.Mesh {
  const arm = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 5),
    new THREE.MeshBasicMaterial({ color: 0xf4efe4, side: THREE.DoubleSide }),
  );
  arm.geometry.translate(0.5, 0, 0);
  return arm;
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
} {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x16361f);
  const camera = makeOrtho();

  const backdrop = new THREE.Group();
  const walls = new THREE.Mesh(
    new THREE.PlaneGeometry(DESIGN_WIDTH, DESIGN_HEIGHT),
    new THREE.MeshBasicMaterial({ color: 0x1d6a34, side: THREE.DoubleSide }),
  );
  walls.position.set(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2, -1);
  backdrop.add(walls);

  const shaft = new THREE.Mesh(
    new THREE.PlaneGeometry(SHAFT_RIGHT - SHAFT_LEFT, DESIGN_HEIGHT),
    new THREE.MeshBasicMaterial({ color: 0xb7e38a, side: THREE.DoubleSide }),
  );
  shaft.position.set((SHAFT_LEFT + SHAFT_RIGHT) / 2, DESIGN_HEIGHT / 2, -0.5);
  backdrop.add(shaft);
  scene.add(backdrop);

  const pegRoot = new THREE.Group();
  scene.add(pegRoot);

  const armL = makeArm();
  const armR = makeArm();
  scene.add(armL, armR);

  const actor = new THREE.Mesh(
    new THREE.CircleGeometry(20, 28),
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

  return { scene, camera, actor, armL, armR, flash, pegRoot, backdrop };
}

function placeArm(arm: THREE.Mesh, x0: number, y0: number, x1: number, y1: number): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  arm.visible = length > 1;
  arm.position.set(x0, y0, 0.2);
  arm.scale.set(Math.max(length, 0.001), 1, 1);
  arm.rotation.z = Math.atan2(dy, dx);
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
): void {
  camera.position.x = 0;
  camera.position.y = world.cameraY;
  camera.updateMatrixWorld();
  backdrop.position.y = world.cameraY;

  const squash = world.squash > 0 ? world.squash / 0.12 : 0;
  actor.position.set(world.body.x, world.body.y, 0.4);
  actor.rotation.z = world.body.spin;
  actor.scale.set(1 + squash * 0.35, 1 - squash * 0.4, 1);

  const held = world.pegs.find((peg) => peg.id === world.heldId);
  const showArms = (world.phase === 'hang' || world.phase === 'drag') && held;
  if (!showArms || !held) {
    armL.visible = false;
    armR.visible = false;
  } else {
    const [left, right] = shoulders(held, world.body.x, world.body.y);
    placeArm(armL, held.x, held.y, left.x, left.y);
    placeArm(armR, held.x, held.y, right.x, right.y);
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
    const isHeld = peg.id === world.heldId && world.phase !== 'fly';
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

  const renderer = await createRenderer({ container: stage });
  renderer.domElement.style.pointerEvents = 'auto';

  const { scene, camera, actor, armL, armR, flash, pegRoot, backdrop } = bootScene();
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

  const designPoint = (event: PointerEvent): { x: number; y: number } | null => {
    if (!layout) return null;
    return clientToDesign(event.clientX, event.clientY, layout);
  };

  renderer.domElement.addEventListener('pointerdown', (event) => {
    const point = designPoint(event);
    if (!point) return;
    if (world.phase === 'fall') {
      seed += 1;
      world = createWorld(mulberry32(seed));
      return;
    }
    if (!tryBeginDrag(world, point.x, point.y)) return;
    renderer.domElement.setPointerCapture(event.pointerId);
  });

  renderer.domElement.addEventListener('pointermove', (event) => {
    if (world.phase !== 'drag') return;
    const point = designPoint(event);
    if (!point) return;
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
    syncView(world, camera, actor, armL, armR, flash, pegRoot, pegViews, backdrop);
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
