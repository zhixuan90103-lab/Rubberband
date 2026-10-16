import { SFX_CATALOG, type SfxId, sfxEntry } from './AudioCatalog';
import type { SfxEvent } from './AudioBatcher';

/** Desktop preview. Buffers are decoded once at preload. */
export class WebBackend {
  private context: AudioContext | null = null;
  private buffers = new Map<SfxId, AudioBuffer>();
  private playing = new Map<SfxId, number>();
  private stretch: { source: AudioBufferSourceNode; gain: GainNode } | null = null;

  async preload(): Promise<void> {
    const context = this.ensure();
    const base = import.meta.env.BASE_URL;
    await Promise.all(
      SFX_CATALOG.map(async (entry) => {
        const response = await fetch(`${base}${entry.file}`);
        const data = await response.arrayBuffer();
        this.buffers.set(entry.id, await context.decodeAudioData(data.slice(0)));
      }),
    );
  }

  unlock(): void {
    const context = this.ensure();
    if (context.state === 'suspended') void context.resume();
  }

  /**
   * Loop one clip and keep its pitch and loudness on the stretch amount.
   * `amount` is 0 at a slack pull and 1 at a full pull.
   */
  beginStretch(id: SfxId): boolean {
    if (this.stretch) return true;
    const context = this.context;
    const buffer = this.buffers.get(id);
    const entry = sfxEntry(id);
    if (!context || !buffer || !entry) return false;
    if (context.state === 'suspended') void context.resume();
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = false;
    source.playbackRate.value = 0.75;
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(context.destination);
    source.onended = () => {
      if (this.stretch?.source === source) this.stretch = null;
    };
    source.start();
    this.stretch = { source, gain };
    return true;
  }

  setStretch(amount: number): void {
    const voice = this.stretch;
    const context = this.context;
    if (!voice || !context) return;
    const stretch = Math.max(0, Math.min(1, amount));
    const when = context.currentTime;
    voice.source.playbackRate.setTargetAtTime(0.72 + stretch * 0.95, when, 0.04);
    voice.gain.gain.setTargetAtTime(0.05 + stretch * 0.5, when, 0.04);
  }

  endStretch(): void {
    const voice = this.stretch;
    const context = this.context;
    this.stretch = null;
    if (!voice || !context) return;
    const when = context.currentTime;
    voice.gain.gain.cancelScheduledValues(when);
    voice.gain.gain.setValueAtTime(0, when);
    voice.source.stop(when);
  }

  /** Start a buffer on this call. No frame queue. */
  playNow(id: SfxId): void {
    const entry = sfxEntry(id);
    if (!entry) return;
    this.flushSfx([{ id, volume: entry.volume }]);
  }

  flushSfx(events: readonly SfxEvent[]): void {
    const context = this.context;
    if (!context) return;
    if (context.state === 'suspended') void context.resume();
    const now = context.currentTime;
    for (const event of events) {
      const buffer = this.buffers.get(event.id);
      const entry = sfxEntry(event.id);
      if (!buffer || !entry) continue;
      const voices = this.playing.get(event.id) ?? 0;
      if (voices >= entry.maxVoices) continue;
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      gain.gain.value = event.volume;
      source.connect(gain);
      gain.connect(context.destination);
      this.playing.set(event.id, voices + 1);
      source.onended = () => {
        const left = (this.playing.get(event.id) ?? 1) - 1;
        this.playing.set(event.id, Math.max(0, left));
      };
      source.start(now);
    }
  }

  private ensure(): AudioContext {
    if (!this.context) {
      const Ctx = window.AudioContext;
      this.context = new Ctx();
    }
    return this.context;
  }
}
