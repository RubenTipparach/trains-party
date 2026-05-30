/**
 * Local sandbox game: holds a single GameState and applies actions through the
 * engine. This is the solo / shared surface; multiplayer (Stage 4) will route the
 * same actions through the server instead of mutating locally.
 */

import { initialState, apply, activePlayer, RULES_VERSION, type GameAction, type GameState } from '$lib/engine';
import { botAction, type BotLevel } from './bots';

const SAVE_KEY = 'tp.1889.sandbox';

export interface SeatConfig {
  id: string;
  name: string;
  bot: boolean;
  level: BotLevel;
}

export const DEFAULT_SEATS: SeatConfig[] = [
  { id: 'p1', name: 'You', bot: false, level: 'normal' },
  { id: 'p2', name: 'Bot 2', bot: true, level: 'normal' },
  { id: 'p3', name: 'Bot 3', bot: true, level: 'normal' },
  { id: 'p4', name: 'Bot 4', bot: true, level: 'normal' }
];

class Sandbox {
  seats = $state<SeatConfig[]>(DEFAULT_SEATS);
  state = $state<GameState>(initialState(DEFAULT_SEATS.map((s) => ({ id: s.id, name: s.name }))));
  error = $state<string | null>(null);

  get active(): string | null {
    return activePlayer(this.state);
  }

  isBot(id: string | null): boolean {
    return !!this.seats.find((s) => s.id === id)?.bot;
  }
  level(id: string): BotLevel {
    return this.seats.find((s) => s.id === id)?.level ?? 'normal';
  }

  newGame(seats: SeatConfig[]) {
    this.seats = seats;
    this.state = initialState(seats.map((s) => ({ id: s.id, name: s.name })));
    this.error = null;
    this.persist();
  }

  reset() {
    this.newGame(this.seats);
  }

  act(action: GameAction) {
    try {
      // Pass a plain snapshot to the engine: its structuredClone can't clone a
      // Svelte reactive proxy.
      this.state = apply($state.snapshot(this.state) as GameState, action);
      this.error = null;
      this.persist();
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  /** Save the current game locally (bot/sandbox games survive reloads). */
  private persist() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({ v: RULES_VERSION, seats: $state.snapshot(this.seats), state: $state.snapshot(this.state) })
      );
    } catch {
      /* storage full / unavailable - ignore */
    }
  }

  /** Restore a saved game (call on the client after mount). */
  load() {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      // Discard saves from an incompatible engine (version pin) or missing the
      // current state shape.
      if (data?.v !== RULES_VERSION || !data.state || !data.state.depot || !data.state.tiles) return;
      this.seats = data.seats;
      this.state = data.state;
      this.error = null;
    } catch {
      /* ignore corrupt save */
    }
  }

  /** If the active player is a bot, play one of its moves. No-op otherwise. */
  botStep(): boolean {
    const a = this.active;
    if (!a || !this.isBot(a)) return false;
    const action = botAction($state.snapshot(this.state) as GameState, this.level(a));
    if (!action) return false;
    this.act(action);
    return true;
  }
}

export const game = new Sandbox();
