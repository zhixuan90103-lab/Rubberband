/** Ids the game can play. Paths are relative to the Vite base. */
export type SfxId = 'death' | 'pull' | 'coin' | 'grab' | 'launch';

export interface SfxEntry {
  id: SfxId;
  file: string;
  volume: number;
  cooldownMs: number;
  /** Lower plays first when a frame is over the cap. */
  priority: number;
  maxVoices: number;
}

export const SFX_CATALOG: readonly SfxEntry[] = [
  { id: 'death', file: 'sfx/death.wav', volume: 0.9, cooldownMs: 400, priority: 0, maxVoices: 1 },
  { id: 'pull', file: 'sfx/pull.wav', volume: 0.65, cooldownMs: 250, priority: 15, maxVoices: 1 },
  { id: 'coin', file: 'sfx/coin.wav', volume: 0.7, cooldownMs: 40, priority: 20, maxVoices: 2 },
  { id: 'grab', file: 'sfx/grab.wav', volume: 0.48, cooldownMs: 80, priority: 18, maxVoices: 1 },
  { id: 'launch', file: 'sfx/launch.wav', volume: 0.32, cooldownMs: 80, priority: 10, maxVoices: 1 },
];

export const MAX_SFX_PER_FRAME = 5;

export function sfxEntry(id: SfxId): SfxEntry | undefined {
  return SFX_CATALOG.find((entry) => entry.id === id);
}
