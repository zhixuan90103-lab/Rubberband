import { audio } from '../audio/AudioManager';

export function playCoinSfx(): void {
  audio.playSfx('coin');
}

export function playGrabSfx(): void {
  audio.playSfxNow('grab');
}

export function playLaunchSfx(): void {
  audio.playSfxNow('launch');
}

export function playDeathSfx(): void {
  audio.playSfx('death');
}

let pullLive = false;

/**
 * One squeak per pull. Pitch and loudness follow the stretch while that
 * single play is still going. A later pull in the same drag does not restart it.
 */
export function updatePullSfx(amount: number): void {
  if (!pullLive) {
    pullLive = audio.beginStretch('pull');
    if (!pullLive) return;
  }
  audio.setStretch(amount);
}

export function stopPullSfx(): void {
  if (!pullLive) return;
  pullLive = false;
  audio.endStretch();
}
