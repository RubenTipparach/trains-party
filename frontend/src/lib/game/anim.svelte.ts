/**
 * Animation control for single-player games. Holds the on/off preference
 * (persisted), honours prefers-reduced-motion, paces bot turns so animations are
 * watchable, and lets the player skip (Space / a Skip button) to fast-forward.
 *
 * The engine stays pure: animations are a presentation layer driven by state
 * diffs. This store only coordinates timing and the skip signal.
 */

const PREF_KEY = 'tp.anim';

class Anim {
  enabled = $state(true);
  /** True while a bot pause / animation is in progress (so UI can show Skip). */
  pacing = $state(false);
  /**
   * Speed multiplier for board animations (1 = normal; higher = faster/shorter).
   * The watch room raises this as the bot pace gets faster so a train run, tile
   * drop, etc. comfortably finishes before the next move lands.
   */
  speed = $state(1);
  /** Bumped to cancel any in-flight waits (skip). */
  private skipToken = $state(0);
  private reduced = false;

  init() {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem(PREF_KEY);
    if (saved !== null) this.enabled = saved === '1';
    this.reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  toggle() {
    this.enabled = !this.enabled;
    if (typeof localStorage !== 'undefined') localStorage.setItem(PREF_KEY, this.enabled ? '1' : '0');
    if (!this.enabled) this.skip();
  }

  get on(): boolean {
    return this.enabled && !this.reduced;
  }

  /** Scale a base animation duration by the current speed (shorter when faster). */
  scale(ms: number): number {
    return this.speed > 1 ? ms / this.speed : ms;
  }

  /** Set the animation speed multiplier (clamped to a sane range). */
  setSpeed(mult: number): void {
    this.speed = Math.max(1, Math.min(8, mult || 1));
  }

  /** Snapshot of the skip counter; compare later to detect a skip mid-animation. */
  get token(): number {
    return this.skipToken;
  }

  /** Mark a custom animation (e.g. the train run) as in progress so Skip shows. */
  begin(): void {
    this.pacing = true;
  }

  /** Clear the in-progress flag if this animation wasn't already skipped. */
  end(token: number): void {
    if (this.skipToken === token) this.pacing = false;
  }

  /** Fast-forward: cancels the current pause and any pending animation waits. */
  skip() {
    this.skipToken += 1;
    this.pacing = false;
  }

  /**
   * Wait `ms` (the bot pacing gap), resolving early if skipped or disabled.
   * Returns true if it waited the full time, false if skipped.
   */
  wait(ms: number): Promise<boolean> {
    if (!this.on || ms <= 0) return Promise.resolve(false);
    const token = this.skipToken;
    this.pacing = true;
    return new Promise<boolean>((resolve) => {
      const done = (full: boolean) => {
        clearInterval(iv);
        clearTimeout(to);
        if (this.skipToken === token) this.pacing = false;
        resolve(full);
      };
      const to = setTimeout(() => done(true), ms);
      // poll for a skip signal
      const iv = setInterval(() => {
        if (this.skipToken !== token) done(false);
      }, 30);
    });
  }
}

export const anim = new Anim();
