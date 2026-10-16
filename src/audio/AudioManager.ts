import { Capacitor } from '@capacitor/core';
import type { SfxId } from './AudioCatalog';
import { AudioBatcher } from './AudioBatcher';
import { WebBackend } from './WebBackend';

/**
 * Web preview plays decoded buffers. The iOS app does not use WebAudio;
 * a native player is not wired yet, so those calls stay silent.
 */
class AudioManager {
  private readonly web = Capacitor.getPlatform() === 'ios' ? null : new WebBackend();
  private readonly batcher = new AudioBatcher((events) => {
    this.web?.flushSfx(events);
  });
  private ready: Promise<void> | null = null;

  preload(): Promise<void> {
    if (!this.web) return Promise.resolve();
    this.ready ??= this.web.preload().catch((error: unknown) => {
      console.error('sfx preload failed', error);
    });
    return this.ready;
  }

  unlock(): void {
    this.web?.unlock();
  }

  playSfx(id: SfxId): void {
    if (!this.web) return;
    this.batcher.enqueue(id);
  }

  /** Plays in the current call, for the release that must line up with the finger. */
  playSfxNow(id: SfxId): void {
    if (!this.web) return;
    this.web.unlock();
    this.web.playNow(id);
  }

  beginStretch(id: SfxId): boolean {
    return this.web?.beginStretch(id) ?? false;
  }

  setStretch(amount: number): void {
    this.web?.setStretch(amount);
  }

  endStretch(): void {
    this.web?.endStretch();
  }
}

export const audio = new AudioManager();
