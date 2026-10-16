import type { LevelCard } from './levelModel';

/**
 * Connectors. Each upward step stays near 320px so the next peg is on screen
 * while hanging. Bottom pegs sit near y = 560–660, top pegs near y = 200–340.
 * Only three of these cards use a red peg, and that red peg shares its row
 * with a blue peg so it is not the only way up. x stays between 120 and 270.
 */
export const BRIDGE_CARDS: LevelCard[] = [
  card('bridge-1', '衔接左右', [
    peg('b1-in', 120, 620),
    peg('b1-out', 270, 300),
  ]),
  card('bridge-2', '衔接反向', [
    peg('b2-in', 270, 620),
    peg('b2-out', 120, 300),
  ]),
  card('bridge-3', '衔接直上', [
    peg('b3-in', 195, 630),
    peg('b3-out', 195, 300),
  ], [coin('b3-c', 230, 465)]),
  card('bridge-4', '衔接宽底', [
    peg('b4-l', 120, 620),
    peg('b4-r', 270, 620),
    peg('b4-out', 195, 300),
  ]),
  card('bridge-5', '衔接三步', [
    peg('b5-in', 120, 640),
    peg('b5-mid', 195, 420, 'red'),
    peg('b5-out', 260, 200),
  ]),
  card('bridge-6', '衔接金币', [
    peg('b6-in', 150, 620),
    peg('b6-out', 250, 300),
    peg('b6-red', 120, 300, 'red'),
  ], [coin('b6-c', 200, 460)]),
  card('bridge-7', '衔接红钉', [
    peg('b7-in', 195, 630),
    peg('b7-l', 120, 310),
    peg('b7-r', 270, 310, 'red'),
  ], [coin('b7-c', 195, 470)]),
  card('bridge-8', '衔接高口', [
    peg('b8-in', 180, 560),
    peg('b8-out', 220, 240),
  ]),
  card('bridge-9', '衔接低口', [
    peg('b9-in', 200, 660),
    peg('b9-out', 150, 340),
  ]),
  card('bridge-10', '衔接回中', [
    peg('b10-in', 250, 620),
    peg('b10-out', 140, 300),
  ], [coin('b10-c', 190, 460)]),
];

function card(id: string, name: string, pegs: LevelCard['pegs'], coins: LevelCard['coins'] = []): LevelCard {
  return { id, name, kind: 'normal', weight: 1, tags: [], pegs, coins };
}

function peg(id: string, x: number, y: number, color: 'blue' | 'red' = 'blue'): LevelCard['pegs'][number] {
  return { id, x, y, color };
}

function coin(id: string, x: number, y: number): LevelCard['coins'][number] {
  return { id, x, y };
}
