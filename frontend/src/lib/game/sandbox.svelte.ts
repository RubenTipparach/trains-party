/**
 * Local sandbox game: holds a single GameState and applies actions through the
 * engine. This is the solo / shared surface; multiplayer (Stage 4) will route the
 * same actions through the server instead of mutating locally.
 */

import { initialState, apply, activePlayer, type GameAction, type GameState } from '$lib/engine';

export const DEFAULT_SEATS = [
  { id: 'p1', name: 'Player 1' },
  { id: 'p2', name: 'Player 2' },
  { id: 'p3', name: 'Player 3' },
  { id: 'p4', name: 'Player 4' }
];

class Sandbox {
  state = $state<GameState>(initialState(DEFAULT_SEATS));
  error = $state<string | null>(null);

  get active(): string | null {
    return activePlayer(this.state);
  }

  reset(seats = DEFAULT_SEATS) {
    this.state = initialState(seats);
    this.error = null;
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
}

export const game = new Sandbox();
