/**
 * Local sandbox game: holds a single GameState and applies actions through the
 * engine. This is the solo / shared surface; multiplayer (Stage 4) will route the
 * same actions through the server instead of mutating locally.
 */

import { initialState, apply, activePlayer, type GameAction, type GameState } from '$lib/engine';
import { botAction, type BotLevel } from './bots';

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
    } catch (e) {
      this.error = (e as Error).message;
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
