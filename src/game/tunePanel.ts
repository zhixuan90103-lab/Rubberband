import { armMax, armSlack, feel, resetFeel, type Feel } from './tune';

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

  const refresh = () => {
    const slack = armSlack();
    derived.textContent = `松弛 ${slack.toFixed(1)} · 最长 ${armMax().toFixed(0)}`;
    for (const input of inputs) {
      const key = input.dataset.key as keyof Feel;
      const shown = input.dataset.armLength === '1' ? armMax() : feel[key];
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

  toggle.addEventListener('click', () => {
    panel.classList.toggle('closed');
  });
  reset.addEventListener('click', () => {
    resetFeel();
    refresh();
  });
  copy.addEventListener('click', () => {
    const text = JSON.stringify({ ...feel, armSlack: armSlack(), armMax: armMax() }, null, 2);
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
