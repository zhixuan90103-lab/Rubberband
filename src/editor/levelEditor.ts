/**
 * Desktop level-card editor. Mounted beside the device switcher.
 * Konva draws the screen. Validation is levelModel.ts.
 */

import Konva from 'konva';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../adapt/design';
import { PEG_JUMP_MAX, PEG_JUMP_MIN } from '../game/tune';
import './levelEditor.css';
import {
  MAX_COINS,
  MAX_PEGS,
  blocksDeck,
  canAddCoin,
  alignRowAcross,
  spreadPicked,
  canAddPeg,
  cardHasDerived,
  checkSeam,
  clampPoint,
  climbEntries,
  climbExits,
  seamDistance,
  failingDeckSeams,
  issuesFor,
  loadDoc,
  nextId,
  openingSeamMisses,
  saveDoc,
  sharesRow,
  type CardTag,
  type LevelCard,
  type LevelDoc,
  type LevelIssue,
  type PegColor,
} from './levelModel';

type Tool = 'select' | 'blue' | 'red' | 'green' | 'coin';
type Filter = 'all' | 'left' | 'right' | 'red' | 'coin';

const PEG_FILL: Record<PegColor, string> = {
  green: '#3dba6a',
  blue: '#3aa0ff',
  red: '#e23b3b',
};

export function mountLevelEditor(switcher: HTMLElement): void {
  const open = document.createElement('button');
  open.type = 'button';
  open.id = 'level-editor-open';
  open.textContent = '关卡';
  switcher.appendChild(open);

  const root = document.createElement('div');
  root.id = 'level-editor';
  root.innerHTML = `
    <aside class="le-side le-list">
      <h2>卡</h2>
      <div class="le-row">
        <button type="button" data-act="add-card">新建</button>
        <button type="button" data-act="duplicate">复制</button>
        <button type="button" data-act="delete-card">删除</button>
      </div>
      <div class="le-row le-filters"></div>
      <div class="le-cards"></div>
      <p class="le-seam-count"></p>
    </aside>
    <div class="le-stage-wrap">
      <div class="le-toolbar">
        <button type="button" data-tool="select">选择</button>
        <button type="button" data-tool="blue">加蓝钉</button>
        <button type="button" data-tool="red">加红钉</button>
        <button type="button" data-tool="green">加绿钉</button>
        <button type="button" data-tool="coin">加金币</button>
        <button type="button" data-act="delete-item">删除选中</button>
        <button type="button" data-act="undo">撤销</button>
        <button type="button" data-act="redo">重做</button>
        <button type="button" data-act="seam">接缝</button>
        <button type="button" data-act="close">返回游戏</button>
      </div>
      <div class="le-coord">
        <label>横坐标 <input id="le-x" type="number" step="1" /></label>
        <label>纵坐标 <input id="le-y" type="number" step="1" /></label>
        <button type="button" data-act="align-row">这一排对齐并平分</button>
        <span class="le-coord-hint">在空白处拖出方框可以多选。方向键 1 px，Shift 为 10 px。</span>
      </div>
      <div class="le-canvas"></div>
      <p class="le-note"></p>
    </div>
    <aside class="le-side le-props">
      <h2>这一张</h2>
      <div class="le-props-body"></div>
      <h2>问题</h2>
      <div class="le-issues"></div>
    </aside>
  `;
  document.body.appendChild(root);

  const canvasHost = root.querySelector('.le-canvas') as HTMLDivElement;
  const note = root.querySelector('.le-note') as HTMLElement;
  const cardsEl = root.querySelector('.le-cards') as HTMLElement;
  const filtersEl = root.querySelector('.le-filters') as HTMLElement;
  const propsEl = root.querySelector('.le-props-body') as HTMLElement;
  const issuesEl = root.querySelector('.le-issues') as HTMLElement;
  const seamCountEl = root.querySelector('.le-seam-count') as HTMLElement;
  const xInput = root.querySelector('#le-x') as HTMLInputElement;
  const yInput = root.querySelector('#le-y') as HTMLInputElement;
  const alignButton = root.querySelector('[data-act="align-row"]') as HTMLButtonElement;
  const coordHint = root.querySelector('.le-coord-hint') as HTMLElement;

  let doc = loadDoc();
  let currentId = doc.openingId;
  let tool: Tool = 'select';
  let filter: Filter = 'all';
  let picked: { kind: 'peg' | 'coin'; id: string }[] = [];
  const selected = () => picked[picked.length - 1] ?? null;
  const isPicked = (kind: 'peg' | 'coin', id: string) => picked.some((item) => item.kind === kind && item.id === id);
  let seamMode = false;
  let seamLower = doc.openingId;
  let seamUpper = doc.deckIds[0] ?? doc.openingId;
  const past: LevelDoc[] = [];
  const future: LevelDoc[] = [];

  const stage = new Konva.Stage({ container: canvasHost, width: 390, height: 844 });
  const layer = new Konva.Layer();
  stage.add(layer);

  let band: Konva.Rect | null = null;
  let bandFrom = { x: 0, y: 0 };
  stage.on('mousedown.band', (event) => {
    if (tool !== 'select' || seamMode || event.target !== stage) return;
    const point = stage.getRelativePointerPosition();
    if (!point) return;
    bandFrom = point;
    band = new Konva.Rect({
      x: point.x,
      y: point.y,
      width: 0,
      height: 0,
      stroke: '#fff6df',
      dash: [4, 4],
      fill: 'rgba(255, 214, 140, 0.18)',
      listening: false,
    });
    layer.add(band);
    layer.batchDraw();
  });
  stage.on('mousemove.band', () => {
    if (!band) return;
    const point = stage.getRelativePointerPosition();
    if (!point) return;
    band.position({ x: Math.min(point.x, bandFrom.x), y: Math.min(point.y, bandFrom.y) });
    band.size({ width: Math.abs(point.x - bandFrom.x), height: Math.abs(point.y - bandFrom.y) });
    layer.batchDraw();
  });
  stage.on('mouseup.band', (event) => {
    if (!band) return;
    const x = band.x();
    const y = band.y();
    const width = band.width();
    const height = band.height();
    band.destroy();
    band = null;
    if (width < 4 && height < 4) {
      layer.batchDraw();
      return;
    }
    const card = current();
    if (!card) return;
    const hits: { kind: 'peg' | 'coin'; id: string }[] = [
      ...card.pegs
        .filter((peg) => peg.x >= x && peg.x <= x + width && peg.y >= y && peg.y <= y + height)
        .map((peg) => ({ kind: 'peg' as const, id: peg.id })),
      ...card.coins
        .filter((coin) => coin.x >= x && coin.x <= x + width && coin.y >= y && coin.y <= y + height)
        .map((coin) => ({ kind: 'coin' as const, id: coin.id })),
    ];
    if (event.evt.shiftKey) {
      for (const hit of hits) {
        if (!isPicked(hit.kind, hit.id)) picked.push(hit);
      }
    } else {
      picked = hits;
    }
    paint();
  });

  const commit = (next: LevelDoc) => {
    past.push(structuredClone(doc));
    if (past.length > 40) past.shift();
    future.length = 0;
    doc = next;
    saveDoc(doc);
    paint();
  };

  const patchCard = (cardId: string, edit: (card: LevelCard) => void) => {
    const next = structuredClone(doc);
    const card = next.cards.find((item) => item.id === cardId);
    if (!card) return;
    edit(card);
    commit(next);
  };

  const current = () => doc.cards.find((card) => card.id === currentId) ?? doc.cards[0];

  const setNote = (text: string) => {
    note.textContent = text;
  };

  const selectOnly = (kind: 'peg' | 'coin', id: string) => {
    picked = [{ kind, id }];
    tool = 'select';
    paint();
  };

  const togglePick = (kind: 'peg' | 'coin', id: string) => {
    picked = isPicked(kind, id)
      ? picked.filter((item) => !(item.kind === kind && item.id === id))
      : [...picked, { kind, id }];
    tool = 'select';
    paint();
  };

  const addPeg = (color: PegColor, x: number, y: number) => {
    const card = current();
    if (!card) return;
    const point = clampPoint(x, y);
    if (color === 'green' && card.kind !== 'opening') {
      setNote('绿钉只放在开局卡上');
      return;
    }
    if (color === 'green' && card.pegs.some((peg) => peg.color === 'green')) {
      setNote('开局卡只能有一颗绿钉');
      return;
    }
    if (!canAddPeg(card)) {
      setNote(card.kind === 'opening' ? '开局卡连绿钉最多 7 颗' : `一张卡最多 ${MAX_PEGS} 颗铆钉`);
      return;
    }
    const id = nextId('peg');
    picked = [{ kind: 'peg', id }];
    patchCard(card.id, (item) => {
      item.pegs.push({ id, x: point.x, y: point.y, color });
    });
  };

  const addCoin = (x: number, y: number) => {
    const card = current();
    if (!card) return;
    if (!canAddCoin(card)) {
      setNote(`一张卡最多 ${MAX_COINS} 枚金币`);
      return;
    }
    const point = clampPoint(x, y);
    const id = nextId('coin');
    picked = [{ kind: 'coin', id }];
    patchCard(card.id, (item) => {
      item.coins.push({ id, x: point.x, y: point.y });
    });
  };

  const removeSelected = () => {
    const card = current();
    if (!card || picked.length === 0) return;
    const gone = picked.slice();
    picked = [];
    patchCard(card.id, (item) => {
      item.pegs = item.pegs.filter((peg) => !gone.some((point) => point.kind === 'peg' && point.id === peg.id));
      item.coins = item.coins.filter((coin) => !gone.some((point) => point.kind === 'coin' && point.id === coin.id));
    });
  };

  const nudge = (dx: number, dy: number) => {
    const card = current();
    if (!card || picked.length === 0) return;
    const moving = picked.slice();
    patchCard(card.id, (item) => {
      for (const point of moving) {
        const target = point.kind === 'peg'
          ? item.pegs.find((peg) => peg.id === point.id)
          : item.coins.find((coin) => coin.id === point.id);
        if (!target) continue;
        const next = clampPoint(target.x + dx, target.y + dy);
        target.x = next.x;
        target.y = next.y;
      }
    });
  };

  const paintList = () => {
    filtersEl.replaceChildren();
    const filters: { id: Filter; label: string }[] = [
      { id: 'all', label: '全部' },
      { id: 'left', label: '左重' },
      { id: 'right', label: '右重' },
      { id: 'red', label: '含红钉' },
      { id: 'coin', label: '含金币' },
    ];
    for (const item of filters) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.label;
      button.setAttribute('aria-pressed', String(filter === item.id));
      button.addEventListener('click', () => {
        filter = item.id;
        paint();
      });
      filtersEl.appendChild(button);
    }

    cardsEl.replaceChildren();
    for (const card of doc.cards) {
      if (filter === 'left' && !card.tags.includes('left')) continue;
      if (filter === 'right' && !card.tags.includes('right')) continue;
      if (filter === 'red' && !cardHasDerived(card, 'red')) continue;
      if (filter === 'coin' && !cardHasDerived(card, 'coin')) continue;
      const issues = issuesFor(card);
      const blocked = card.kind === 'normal' && blocksDeck(issues);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `le-card${blocked ? ' bad' : ''}`;
      if (card.id === currentId) button.setAttribute('aria-pressed', 'true');
      const title = document.createElement('strong');
      title.textContent = card.kind === 'opening' ? `${card.name}（开局）` : card.name;
      const meta = document.createElement('small');
      const bits = [`${card.pegs.length} 钉`, `${card.coins.length} 金币`];
      if (card.series) bits.push(`${card.series}一组，顺序可打乱`);
      if (card.kind === 'normal') bits.push(doc.deckIds.includes(card.id) ? '在卡组' : '未入组');
      if (blocked) bits.push('不能入组');
      meta.textContent = bits.join(' · ');
      button.append(title, meta);
      button.addEventListener('click', () => {
        currentId = card.id;
        seamMode = false;
        picked = [];
        paint();
      });
      cardsEl.appendChild(button);
    }

    const failed = failingDeckSeams(doc);
    const missed = openingSeamMisses(doc);
    seamCountEl.textContent = `卡组里 ${failed.length} 对接不上。开局接不上 ${missed.length} 张。`;
  };

  const paintProps = () => {
    propsEl.replaceChildren();
    const card = current();
    if (!card) return;
    const name = document.createElement('label');
    name.className = 'le-field';
    name.textContent = '名字';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = card.name;
    nameInput.addEventListener('change', () => {
      const value = nameInput.value.trim() || card.name;
      patchCard(card.id, (item) => {
        item.name = value;
      });
    });
    name.appendChild(nameInput);
    propsEl.appendChild(name);

    if (card.kind === 'normal') {
      const weight = document.createElement('label');
      weight.className = 'le-field';
      weight.textContent = '权重';
      const weightInput = document.createElement('input');
      weightInput.type = 'number';
      weightInput.min = '1';
      weightInput.max = '20';
      weightInput.step = '1';
      weightInput.value = String(card.weight);
      weightInput.addEventListener('change', () => {
        const value = Math.min(20, Math.max(1, Math.round(Number(weightInput.value) || 1)));
        patchCard(card.id, (item) => {
          item.weight = value;
        });
      });
      weight.appendChild(weightInput);
      propsEl.appendChild(weight);

      const inDeck = document.createElement('button');
      inDeck.type = 'button';
      const issues = issuesFor(card);
      const blocked = blocksDeck(issues);
      const inside = doc.deckIds.includes(card.id);
      inDeck.textContent = inside ? '移出卡组' : '放进卡组';
      inDeck.disabled = !inside && blocked;
      inDeck.addEventListener('click', () => {
        const next = structuredClone(doc);
        if (next.deckIds.includes(card.id)) next.deckIds = next.deckIds.filter((id) => id !== card.id);
        else if (!blocksDeck(issuesFor(card))) next.deckIds.push(card.id);
        commit(next);
      });
      propsEl.appendChild(inDeck);

      const tagRow = document.createElement('div');
      tagRow.className = 'le-row';
      for (const tag of ['left', 'right'] as CardTag[]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = tag === 'left' ? '左重' : '右重';
        button.setAttribute('aria-pressed', String(card.tags.includes(tag)));
        button.addEventListener('click', () => {
          patchCard(card.id, (item) => {
            item.tags = item.tags.includes(tag) ? item.tags.filter((entry) => entry !== tag) : [...item.tags, tag];
          });
        });
        tagRow.appendChild(button);
      }
      propsEl.appendChild(tagRow);
    }

    if (selected()?.kind === 'peg') {
      const peg = card.pegs.find((item) => item.id === selected()?.id);
      if (peg) {
        const row = document.createElement('div');
        row.className = 'le-row';
        for (const color of ['blue', 'red', 'green'] as PegColor[]) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = color === 'blue' ? '蓝' : color === 'red' ? '红' : '绿';
          button.setAttribute('aria-pressed', String(peg.color === color));
          button.addEventListener('click', () => {
            if (color === 'green' && card.kind !== 'opening') {
              setNote('绿钉只放在开局卡上');
              return;
            }
            if (color === 'green' && card.pegs.some((item) => item.color === 'green' && item.id !== peg.id)) {
              setNote('开局卡只能有一颗绿钉');
              return;
            }
            patchCard(card.id, (item) => {
              const target = item.pegs.find((entry) => entry.id === peg.id);
              if (target) target.color = color;
            });
          });
          row.appendChild(button);
        }
        propsEl.appendChild(row);
      }
    }

    if (seamMode) {
      const lowerLabel = document.createElement('label');
      lowerLabel.className = 'le-field';
      lowerLabel.textContent = '下面这张';
      const upperLabel = document.createElement('label');
      upperLabel.className = 'le-field';
      upperLabel.textContent = '上面这张';
      const lowerSelect = document.createElement('select');
      const upperSelect = document.createElement('select');
      for (const item of doc.cards) {
        for (const select of [lowerSelect, upperSelect]) {
          const option = document.createElement('option');
          option.value = item.id;
          option.textContent = item.name;
          select.appendChild(option);
        }
      }
      lowerSelect.value = seamLower;
      upperSelect.value = seamUpper;
      lowerSelect.addEventListener('change', () => {
        seamLower = lowerSelect.value;
        paint();
      });
      upperSelect.addEventListener('change', () => {
        seamUpper = upperSelect.value;
        paint();
      });
      lowerLabel.appendChild(lowerSelect);
      upperLabel.appendChild(upperSelect);
      propsEl.append(lowerLabel, upperLabel);
    }
  };

  const paintIssues = () => {
    issuesEl.replaceChildren();
    const lines: { level: 'block' | 'warn'; text: string }[] = [];
    if (seamMode) {
      const lower = doc.cards.find((card) => card.id === seamLower);
      const upper = doc.cards.find((card) => card.id === seamUpper);
      if (lower && upper) {
        const seam = checkSeam(lower, upper);
        lines.push({
          level: seam.ok ? 'warn' : 'block',
          text: seam.ok
            ? '这两张接得上'
            : `接不上：下面 ${seam.lowerMisses.length} 颗出口没着落，上面 ${seam.upperMisses.length} 颗入口没人能跳到`,
        });
      }
    } else {
      const card = current();
      if (card) {
        const seen = new Set<string>();
        for (const issue of issuesFor(card)) {
          const key = `${issue.code}:${issue.targetId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          lines.push(issue);
        }
      }
    }
    if (lines.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'le-issue';
      empty.textContent = '没有要标的问题';
      issuesEl.appendChild(empty);
      return;
    }
    for (const line of lines) {
      const row = document.createElement('p');
      row.className = `le-issue ${line.level}`;
      row.textContent = line.text;
      issuesEl.appendChild(row);
    }
  };

  const ring = (x: number, y: number, selectedPeg: boolean) => {
    for (const radius of [PEG_JUMP_MIN, PEG_JUMP_MAX]) {
      layer.add(
        new Konva.Circle({
          x,
          y,
          radius,
          stroke: selectedPeg ? '#ffd36a' : '#c9843a',
          strokeWidth: selectedPeg ? 2 : 1,
          opacity: selectedPeg ? 0.95 : 0.28,
          dash: selectedPeg ? undefined : [8, 10],
          listening: false,
        }),
      );
    }
  };

  const badge = (x: number, y: number, issues: LevelIssue[]) => {
    if (issues.length === 0) return;
    const label = issues.some((issue) => issue.level === 'block') ? '要改' : '注意';
    const text = new Konva.Text({
      x: x + 16,
      y: y - 22,
      text: label,
      fontSize: 12,
      fill: issues.some((issue) => issue.level === 'block') ? '#ffb0a4' : '#ffe0a8',
      listening: false,
    });
    layer.add(text);
  };

  const paintBoard = () => {
    layer.destroyChildren();
    const scale = Math.min(1, (canvasHost.clientHeight - 16) / (seamMode ? 1200 : DESIGN_HEIGHT));
    const viewH = seamMode ? 1200 : DESIGN_HEIGHT;
    stage.scale({ x: scale, y: scale });
    stage.width(DESIGN_WIDTH * scale);
    stage.height(viewH * scale);

    const backdrop = new Konva.Rect({
      x: 0,
      y: 0,
      width: DESIGN_WIDTH,
      height: viewH,
      fill: '#2a1d12',
      listening: false,
    });
    layer.add(backdrop);
    layer.add(
      new Konva.Line({
        points: [24, 0, 24, viewH],
        stroke: '#ff8b6a',
        dash: [4, 6],
        listening: false,
      }),
    );
    layer.add(
      new Konva.Line({
        points: [366, 0, 366, viewH],
        stroke: '#ff8b6a',
        dash: [4, 6],
        listening: false,
      }),
    );

    if (!seamMode) {
      layer.add(
        new Konva.Line({
          points: [0, PEG_JUMP_MAX, DESIGN_WIDTH, PEG_JUMP_MAX],
          stroke: '#8fd0ff',
          dash: [6, 6],
          listening: false,
        }),
      );
      layer.add(
        new Konva.Line({
          points: [0, DESIGN_HEIGHT - PEG_JUMP_MAX, DESIGN_WIDTH, DESIGN_HEIGHT - PEG_JUMP_MAX],
          stroke: '#8fd0ff',
          dash: [6, 6],
          listening: false,
        }),
      );
      const card = current();
      if (!card) return;
      const issues = issuesFor(card);
      const selectedPeg = selected()?.kind === 'peg' ? card.pegs.find((peg) => peg.id === selected()?.id) : undefined;
      if (selectedPeg) {
        layer.add(
          new Konva.Line({
            points: [0, selectedPeg.y, DESIGN_WIDTH, selectedPeg.y],
            stroke: '#8fd0ff',
            dash: [6, 6],
            listening: false,
          }),
        );
      }
      for (const peg of card.pegs) {
        if (!isPicked('peg', peg.id)) continue;
        ring(peg.x, peg.y, true);
        for (const other of card.pegs) {
          if (other.id === peg.id || other.y >= peg.y || sharesRow(peg, other)) continue;
          const gap = Math.hypot(other.x - peg.x, other.y - peg.y);
          const canJump = gap >= PEG_JUMP_MIN && gap <= PEG_JUMP_MAX;
          const color = canJump ? '#7dffb2' : '#ff6b5a';
          const word = canJump ? '能跳' : gap < PEG_JUMP_MIN ? '太近' : '太远';
          layer.add(
            new Konva.Line({
              points: [peg.x, peg.y, other.x, other.y],
              stroke: color,
              strokeWidth: canJump ? 3 : 1.5,
              listening: false,
            }),
          );
          layer.add(
            new Konva.Text({
              x: (peg.x + other.x) / 2 - 32,
              y: (peg.y + other.y) / 2 - 10,
              width: 64,
              align: 'center',
              text: `${word} ${Math.round(gap)}`,
              fontSize: 13,
              fill: color,
              listening: false,
            }),
          );
        }
      }
      for (const coin of card.coins) {
        const hit = new Konva.Circle({
          x: coin.x,
          y: coin.y,
          radius: 14,
          fill: '#ffb000',
          stroke: isPicked('coin', coin.id) ? '#fff6df' : '#8a5a10',
          strokeWidth: 3,
          draggable: true,
        });
        hit.on('click tap', (event) => {
          event.cancelBubble = true;
          if (event.evt.shiftKey) togglePick('coin', coin.id);
          else selectOnly('coin', coin.id);
        });
        hit.on('dragend', () => {
          const point = clampPoint(hit.x(), hit.y());
          patchCard(card.id, (item) => {
            const target = item.coins.find((entry) => entry.id === coin.id);
            if (!target) return;
            target.x = point.x;
            target.y = point.y;
          });
        });
        layer.add(hit);
        badge(
          coin.x,
          coin.y,
          issues.filter((issue) => issue.targetId === coin.id),
        );
      }
      for (const peg of card.pegs) {
        const hit = new Konva.Circle({
          x: peg.x,
          y: peg.y,
          radius: 16,
          fill: PEG_FILL[peg.color],
          stroke: isPicked('peg', peg.id) ? '#fff6df' : '#1a120c',
          strokeWidth: 3,
          draggable: true,
        });
        hit.on('click tap', (event) => {
          event.cancelBubble = true;
          if (event.evt.shiftKey) togglePick('peg', peg.id);
          else selectOnly('peg', peg.id);
        });
        hit.on('dragend', () => {
          const point = clampPoint(hit.x(), hit.y());
          patchCard(card.id, (item) => {
            const target = item.pegs.find((entry) => entry.id === peg.id);
            if (!target) return;
            target.x = point.x;
            target.y = point.y;
          });
        });
        layer.add(hit);
        layer.add(
          new Konva.Text({
            x: peg.x - 28,
            y: peg.y + 18,
            width: 56,
            align: 'center',
            text: `${peg.x}, ${peg.y}`,
            fontSize: 11,
            fill: '#fff6df',
            listening: false,
          }),
        );
        badge(
          peg.x,
          peg.y,
          issues.filter((issue) => issue.targetId === peg.id),
        );
      }
      stage.off('click tap');
      stage.on('click tap', () => {
        const pointer = stage.getRelativePointerPosition();
        if (!pointer) return;
        if (tool === 'blue' || tool === 'red' || tool === 'green') addPeg(tool, pointer.x, pointer.y);
        else if (tool === 'coin') addCoin(pointer.x, pointer.y);
      });
    } else {
      layer.add(
        new Konva.Line({
          points: [0, PEG_JUMP_MAX, DESIGN_WIDTH, PEG_JUMP_MAX],
          stroke: '#fff6df',
          strokeWidth: 2,
          listening: false,
        }),
      );
      const lower = doc.cards.find((card) => card.id === seamLower);
      const upper = doc.cards.find((card) => card.id === seamUpper);
      layer.add(new Konva.Text({
        x: 8,
        y: PEG_JUMP_MAX - 22,
        text: '下一屏的底',
        fontSize: 13,
        fill: '#fff6df',
        listening: false,
      }));
      layer.add(new Konva.Text({
        x: 8,
        y: PEG_JUMP_MAX + 6,
        text: '这一屏的顶',
        fontSize: 13,
        fill: '#fff6df',
        listening: false,
      }));
      const lowerView = (peg: { x: number; y: number }) => ({ x: peg.x, y: PEG_JUMP_MAX + peg.y });
      const upperView = (peg: { x: number; y: number }) => ({
        x: peg.x,
        y: peg.y - (DESIGN_HEIGHT - PEG_JUMP_MAX),
      });
      const exits = lower ? climbExits(lower) : [];
      const entries = upper ? climbEntries(upper) : [];
      for (const exit of exits) {
        for (const entry of entries) {
          const gap = seamDistance(exit, entry);
          const canJump = gap >= PEG_JUMP_MIN && gap <= PEG_JUMP_MAX;
          const from = lowerView(exit);
          const to = upperView(entry);
          const color = canJump ? '#7dffb2' : '#ff6b5a';
          const word = canJump ? '能跳' : gap < PEG_JUMP_MIN ? '太近' : '太远';
          layer.add(new Konva.Line({
            points: [from.x, from.y, to.x, to.y],
            stroke: color,
            strokeWidth: canJump ? 3 : 1.5,
            listening: false,
          }));
          layer.add(new Konva.Text({
            x: (from.x + to.x) / 2 - 32,
            y: (from.y + to.y) / 2 - 10,
            width: 64,
            align: 'center',
            text: `${word} ${Math.round(gap)}`,
            fontSize: 13,
            fill: color,
            listening: false,
          }));
        }
      }
      const drawPeg = (x: number, y: number, color: PegColor) => {
        ring(x, y, true);
        layer.add(
          new Konva.Circle({
            x,
            y,
            radius: 16,
            fill: PEG_FILL[color],
            stroke: '#1a120c',
            strokeWidth: 3,
            listening: false,
          }),
        );
      };
      if (upper) {
        for (const peg of climbEntries(upper)) {
          drawPeg(peg.x, peg.y - (DESIGN_HEIGHT - PEG_JUMP_MAX), peg.color);
        }
      }
      if (lower) {
        for (const peg of climbExits(lower)) {
          drawPeg(peg.x, PEG_JUMP_MAX + peg.y, peg.color);
        }
      }
      stage.off('click tap');
    }
    layer.draw();
  };

  const paintPointer = () => {
    stage.off('mousemove.dist');
    stage.on('mousemove.dist', () => {
      if (seamMode || selected()?.kind !== 'peg') return;
      const card = current();
      const peg = card?.pegs.find((item) => item.id === selected()?.id);
      const pointer = stage.getRelativePointerPosition();
      if (!peg || !pointer) return;
      const d = Math.hypot(pointer.x - peg.x, pointer.y - peg.y);
      setNote(`到选中钉 ${Math.round(d)} px。往上 ${PEG_JUMP_MIN} 到 ${PEG_JUMP_MAX} 的绿线是能跳上去。`);
    });
  };

  const pickedSpots = () => {
    const card = current();
    if (!card) return [];
    const pegs = card.pegs.filter((peg) => isPicked('peg', peg.id));
    const coins = card.coins.filter((coin) => isPicked('coin', coin.id));
    return [...pegs, ...coins];
  };

  const paintCoords = () => {
    const spots = seamMode ? [] : pickedSpots();
    alignButton.disabled = seamMode || !spots.some((spot) => isPicked('peg', spot.id));
    const write = (input: HTMLInputElement, values: number[]) => {
      if (document.activeElement === input) return;
      input.value = values.length === 1 ? String(values[0]) : '';
      input.placeholder = values.length > 1 ? '多个' : '';
    };
    write(xInput, [...new Set(spots.map((spot) => spot.x))]);
    write(yInput, [...new Set(spots.map((spot) => spot.y))]);
    coordHint.textContent = spots.length
      ? `已选 ${spots.length} 个。改数字后按回车，框里的点会一起改。方向键 1 px，Shift 为 10 px。`
      : '在空白处拖出方框可以多选。方向键 1 px，Shift 为 10 px。';
  };

  const applyAxis = (axis: 'x' | 'y', raw: string) => {
    const card = current();
    const value = Number(raw);
    if (!card || picked.length === 0 || !Number.isFinite(value)) {
      setNote('先框选或点中要改的钉');
      return;
    }
    const moving = picked.slice();
    patchCard(card.id, (item) => {
      for (const point of moving) {
        const target = point.kind === 'peg'
          ? item.pegs.find((peg) => peg.id === point.id)
          : item.coins.find((coin) => coin.id === point.id);
        if (!target) continue;
        const next = axis === 'x' ? clampPoint(value, target.y) : clampPoint(target.x, value);
        target.x = next.x;
        target.y = next.y;
      }
    });
  };

  xInput.addEventListener('change', () => applyAxis('x', xInput.value));
  yInput.addEventListener('change', () => applyAxis('y', yInput.value));

  const paintTools = () => {
    root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
      button.disabled = seamMode;
    });
    const seamButton = root.querySelector<HTMLButtonElement>('[data-act="seam"]');
    if (seamButton) seamButton.setAttribute('aria-pressed', String(seamMode));
  };

  const paint = () => {
    if (!doc.cards.some((card) => card.id === currentId)) currentId = doc.openingId;
    paintList();
    paintProps();
    paintIssues();
    paintBoard();
    paintPointer();
    paintTools();
    paintCoords();
  };

  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
    const pickedTool = target.closest<HTMLElement>('[data-tool]')?.dataset.tool as Tool | undefined;
    if (pickedTool) {
      tool = pickedTool;
      seamMode = false;
      paintTools();
      return;
    }
    if (act === 'close') {
      root.classList.remove('open');
      return;
    }
    if (act === 'undo' && past.length) {
      future.push(structuredClone(doc));
      doc = past.pop() ?? doc;
      saveDoc(doc);
      paint();
      return;
    }
    if (act === 'redo' && future.length) {
      past.push(structuredClone(doc));
      doc = future.pop() ?? doc;
      saveDoc(doc);
      paint();
      return;
    }
    if (act === 'align-row') {
      const card = current();
      const ids = picked.filter((point) => point.kind === 'peg').map((point) => point.id);
      if (!card || ids.length === 0) {
        setNote('先框选或点中要排齐的钉');
        return;
      }
      patchCard(card.id, (item) => {
        item.pegs = ids.length > 1
          ? spreadPicked(item.pegs, ids, DESIGN_WIDTH)
          : alignRowAcross(item.pegs, ids[0] ?? '', DESIGN_WIDTH);
      });
      setNote('选中的钉已对齐到同一高度，并按屏幕宽度均分');
      return;
    }
    if (act === 'delete-item') removeSelected();
    if (act === 'seam') {
      seamMode = !seamMode;
      paint();
      return;
    }
    if (act === 'add-card') {
      const card: LevelCard = {
        id: nextId('card'),
        name: '新的一屏',
        kind: 'normal',
        weight: 1,
        tags: [],
        pegs: [
          { id: nextId('peg'), x: 120, y: 700, color: 'blue' },
          { id: nextId('peg'), x: 250, y: 180, color: 'blue' },
        ],
        coins: [],
      };
      const next = structuredClone(doc);
      next.cards.push(card);
      currentId = card.id;
      picked = [];
      seamMode = false;
      commit(next);
      return;
    }
    if (act === 'duplicate') {
      const card = current();
      if (!card) return;
      const copy = structuredClone(card);
      copy.id = nextId('card');
      copy.name = `${card.name} 副本`;
      copy.kind = 'normal';
      copy.pegs = copy.pegs.map((peg) => ({
        ...peg,
        id: nextId('peg'),
        color: peg.color === 'green' ? 'blue' : peg.color,
      }));
      copy.coins = copy.coins.map((coin) => ({ ...coin, id: nextId('coin') }));
      const next = structuredClone(doc);
      next.cards.push(copy);
      currentId = copy.id;
      commit(next);
      return;
    }
    if (act === 'delete-card') {
      const card = current();
      if (!card || card.kind === 'opening') {
        setNote('开局卡留着');
        return;
      }
      const next = structuredClone(doc);
      next.cards = next.cards.filter((item) => item.id !== card.id);
      next.deckIds = next.deckIds.filter((id) => id !== card.id);
      currentId = next.openingId;
      picked = [];
      commit(next);
    }
  });

  window.addEventListener('keydown', (event) => {
    if (!root.classList.contains('open')) return;
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement;
    if (typing) return;
    const step = event.shiftKey ? 10 : 1;
    if (event.key === 'ArrowLeft') nudge(-step, 0);
    else if (event.key === 'ArrowRight') nudge(step, 0);
    else if (event.key === 'ArrowUp') nudge(0, -step);
    else if (event.key === 'ArrowDown') nudge(0, step);
    else if (event.key === 'Backspace' || event.key === 'Delete') removeSelected();
    else if ((event.metaKey || event.ctrlKey) && event.key === 'z' && !event.shiftKey && past.length) {
      future.push(structuredClone(doc));
      doc = past.pop() ?? doc;
      saveDoc(doc);
      paint();
    } else return;
    event.preventDefault();
  });

  open.addEventListener('click', () => {
    root.classList.add('open');
    paint();
  });

  if (new URLSearchParams(window.location.search).get('editor') === '1') {
    root.classList.add('open');
  }

  saveDoc(doc);
  paint();
}
