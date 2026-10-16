import { refreshCharge } from './feelHaptics';
import { armMax, armSlack, feel, guides, haptic, resetFeel, resetHaptic, type Feel, type HapticFeel } from './tune';

type Row = {
  key: keyof Feel;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Slider edits peg-to-body length, not the extra past the hang pose. */
  asArmLength?: boolean;
};

const groups: { title: string; rows: Row[] }[] = [
  {
    title: '手臂',
    rows: [
      { key: 'restDrop', label: '挂稳长度', min: 40, max: 220, step: 1 },
      { key: 'maxPull', label: '拉长上限', min: 70, max: 560, step: 1, asArmLength: true },
      { key: 'minPull', label: '最短发射', min: 0, max: 160, step: 1 },
      { key: 'armOmega', label: '劲度', min: 4, max: 120, step: 0.1 },
      { key: 'radialDamp', label: '径向阻尼', min: 0, max: 32, step: 0.1 },
      { key: 'tangentDamp', label: '切向阻尼', min: 0, max: 40, step: 0.1 },
    ],
  },
  {
    title: '世界',
    rows: [
      { key: 'gravity', label: '重力', min: 400, max: 5600, step: 10 },
      { key: 'grabRadius', label: '抓取半径', min: 16, max: 160, step: 1 },
      { key: 'grabStartRadius', label: '起手半径', min: 36, max: 240, step: 1 },
      { key: 'oldPegLock', label: '旧钉锁定', min: 0, max: 1.2, step: 0.01 },
      { key: 'wallRestitution', label: '墙弹性', min: 0, max: 2, step: 0.01 },
    ],
  },
  {
    title: '镜头与转头',
    rows: [
      { key: 'cameraDamp', label: '镜头跟随', min: 0.05, max: 2.4, step: 0.01 },
      { key: 'cameraOvershoot', label: '镜头冲出', min: 0, max: 80, step: 1 },
      { key: 'pegAnchor', label: '悬挂锚点', min: 0.45, max: 1.7, step: 0.01 },
      { key: 'hitSpin', label: '撞墙自转', min: 0, max: 0.16, step: 0.001 },
      { key: 'launchSpin', label: '发射自转', min: 0, max: 20, step: 0.5 },
      { key: 'aimSpin', label: '瞄准转头', min: 0, max: 60, step: 0.5 },
      { key: 'catchSpin', label: '抓住转头', min: 0, max: 60, step: 0.5 },
      { key: 'settleSpin', label: '挂稳转头', min: 0, max: 60, step: 0.5 },
    ],
  },
];

const hapticGroups: { title: string; rows: { key: keyof HapticFeel; label: string; min: number; max: number; step: number }[] }[] = [
  {
    title: '蓄力震动',
    rows: [
      { key: 'tensionMinI', label: '最小强度', min: 0, max: 1, step: 0.01 },
      { key: 'tensionMaxI', label: '最大强度', min: 0, max: 1, step: 0.01 },
      { key: 'tensionMinS', label: '最小锐度', min: 0, max: 1, step: 0.01 },
      { key: 'tensionMaxS', label: '最大锐度', min: 0, max: 1, step: 0.01 },
      { key: 'grainAt', label: '碎抖起点', min: 0, max: 1, step: 0.01 },
      { key: 'grainI', label: '碎抖强度', min: 0, max: 1, step: 0.01 },
      { key: 'grainS', label: '碎抖锐度', min: 0, max: 1, step: 0.01 },
      { key: 'grainHz', label: '碎抖频率', min: 4, max: 80, step: 1 },
    ],
  },
  {
    title: '抓住',
    rows: [
      { key: 'grabI', label: '瞬态强度', min: 0, max: 1, step: 0.01 },
      { key: 'grabS', label: '瞬态锐度', min: 0, max: 1, step: 0.01 },
      { key: 'grabTailI', label: '余韵强度', min: 0, max: 1, step: 0.01 },
      { key: 'grabTailS', label: '余韵锐度', min: 0, max: 1, step: 0.01 },
      { key: 'grabTailMs', label: '余韵时长', min: 0, max: 200, step: 1 },
    ],
  },
  {
    title: '回弹',
    rows: [
      { key: 'reboundGapMs', label: '间隙', min: 0, max: 200, step: 1 },
      { key: 'reboundBase', label: '基础次数', min: 0, max: 12, step: 1 },
      { key: 'reboundEnergy', label: '次数随力', min: 0, max: 8, step: 0.1 },
      { key: 'reboundDamp', label: '衰减指数', min: 0, max: 12, step: 0.1 },
      { key: 'reboundDampEnergy', label: '力减衰减', min: 0, max: 8, step: 0.1 },
      { key: 'reboundS', label: '瞬态锐度', min: 0, max: 1, step: 0.01 },
      { key: 'reboundSDrop', label: '锐度衰减', min: 0, max: 1, step: 0.01 },
      { key: 'reboundFloor', label: '底噪', min: 0, max: 1, step: 0.01 },
      { key: 'reboundTailMs', label: '余韵时长', min: 0, max: 200, step: 1 },
      { key: 'reboundTailI', label: '强度比例', min: 0, max: 1, step: 0.01 },
      { key: 'reboundTailS', label: '锐度比例', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: '撞墙震动',
    rows: [
      { key: 'wallMul', label: '强度倍数', min: 0, max: 1, step: 0.01 },
      { key: 'wallS', label: '锐度', min: 0, max: 1, step: 0.01 },
      { key: 'wallFloor', label: '最低强度', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: '死亡震动',
    rows: [
      { key: 'deathI', label: '强度', min: 0, max: 1, step: 0.01 },
      { key: 'deathS', label: '锐度', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: '金币震动',
    rows: [
      { key: 'coinI', label: '强度', min: 0, max: 1, step: 0.01 },
      { key: 'coinS', label: '锐度', min: 0, max: 1, step: 0.01 },
    ],
  },
];

function format(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 1000) / 1000);
}

export function mountTunePanel(root: HTMLElement): void {
  const panel = document.createElement('section');
  panel.id = 'tune-panel';
  panel.className = 'closed';

  const bar = document.createElement('div');
  bar.className = 'tune-bar';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.textContent = '参数';
  const derived = document.createElement('span');
  derived.className = 'tune-derived';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = '恢复';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = '复制';
  bar.append(toggle, derived, reset, copy);

  const body = document.createElement('div');
  body.className = 'tune-body';
  const inputs: HTMLInputElement[] = [];

  const guideLabel = document.createElement('label');
  guideLabel.className = 'tune-switch';
  const guideInput = document.createElement('input');
  guideInput.type = 'checkbox';
  guideInput.checked = guides.show;
  const guideName = document.createElement('span');
  guideName.textContent = '显示辅助';
  guideInput.addEventListener('change', () => {
    guides.show = guideInput.checked;
  });
  guideLabel.append(guideInput, guideName);
  body.append(guideLabel);

  const refresh = () => {
    const slack = armSlack();
    derived.textContent = `松弛 ${slack.toFixed(1)} · 最长 ${armMax().toFixed(0)}`;
    for (const input of inputs) {
      const shown = input.dataset.armLength === '1'
        ? armMax()
        : input.dataset.haptic === '1'
          ? haptic[input.dataset.key as keyof HapticFeel]
          : feel[input.dataset.key as keyof Feel];
      input.value = String(shown);
      const out = input.parentElement?.querySelector('output');
      if (out) out.textContent = format(shown);
    }
  };

  for (const group of groups) {
    const block = document.createElement('div');
    block.className = 'tune-group';
    const title = document.createElement('p');
    title.textContent = group.title;
    block.append(title);
    for (const row of group.rows) {
      const label = document.createElement('label');
      const name = document.createElement('span');
      name.textContent = row.label;
      const out = document.createElement('output');
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(row.min);
      input.max = String(row.max);
      input.step = String(row.step);
      input.dataset.key = row.key;
      if (row.asArmLength) input.dataset.armLength = '1';
      input.value = String(row.asArmLength ? armMax() : feel[row.key]);
      input.addEventListener('input', () => {
        const next = Number(input.value);
        if (row.asArmLength) feel.maxPull = Math.max(0, next - feel.restDrop);
        else feel[row.key] = next;
        refresh();
      });
      inputs.push(input);
      label.append(name, out, input);
      block.append(label);
    }
    body.append(block);
  }

  for (const group of hapticGroups) {
    const block = document.createElement('div');
    block.className = 'tune-group';
    const title = document.createElement('p');
    title.textContent = group.title;
    block.append(title);
    for (const row of group.rows) {
      const label = document.createElement('label');
      const name = document.createElement('span');
      name.textContent = row.label;
      const out = document.createElement('output');
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(row.min);
      input.max = String(row.max);
      input.step = String(row.step);
      input.dataset.key = row.key;
      input.dataset.haptic = '1';
      input.value = String(haptic[row.key]);
      input.addEventListener('input', () => {
        haptic[row.key] = Number(input.value);
        refresh();
        refreshCharge();
      });
      inputs.push(input);
      label.append(name, out, input);
      block.append(label);
    }
    body.append(block);
  }

  toggle.addEventListener('click', () => {
    panel.classList.toggle('closed');
  });
  reset.addEventListener('click', () => {
    resetFeel();
    resetHaptic();
    refresh();
    refreshCharge();
  });
  copy.addEventListener('click', () => {
    const text = JSON.stringify(
      { ...feel, armSlack: armSlack(), armMax: armMax(), haptic },
      null,
      2,
    );
    void navigator.clipboard?.writeText(text);
    copy.textContent = '已复制';
    window.setTimeout(() => {
      copy.textContent = '复制';
    }, 800);
  });

  panel.append(bar, body);
  panel.addEventListener('pointerdown', (event) => event.stopPropagation());
  root.append(panel);
  refresh();
}
