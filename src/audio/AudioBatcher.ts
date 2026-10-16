import { MAX_SFX_PER_FRAME, type SfxId, sfxEntry } from './AudioCatalog';

export interface SfxEvent {
  id: SfxId;
  volume: number;
}

/**
 * One flush per frame. Same id in the same frame keeps the first request.
 */
export class AudioBatcher {
  private queued = new Map<SfxId, SfxEvent>();
  private lastPlayed = new Map<SfxId, number>();
  private scheduled = false;

  constructor(private readonly flushNow: (events: SfxEvent[]) => void) {}

  enqueue(id: SfxId, now = performance.now()): void {
    const entry = sfxEntry(id);
    if (!entry) return;
    if (this.queued.has(id)) return;
    const last = this.lastPlayed.get(id) ?? -Infinity;
    if (now - last < entry.cooldownMs) return;
    this.queued.set(id, { id, volume: entry.volume });
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => this.flush());
  }

  private flush(): void {
    this.scheduled = false;
    const now = performance.now();
    const events = [...this.queued.values()].sort(
      (a, b) => (sfxEntry(a.id)?.priority ?? 99) - (sfxEntry(b.id)?.priority ?? 99),
    );
    this.queued.clear();
    const kept = events.slice(0, MAX_SFX_PER_FRAME);
    for (const event of kept) this.lastPlayed.set(event.id, now);
    if (kept.length > 0) this.flushNow(kept);
  }
}
