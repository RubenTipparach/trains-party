/**
 * Local sandbox game. Holds the full ordered action log (the engine derives state
 * by replaying it) plus:
 *  - a REVIEW cursor: step through past states to review the game without
 *    changing it (history |< << < > >|),
 *  - UNDO / REDO: actually remove or re-apply the last action(s).
 *
 * Multiplayer (Stage 4) will route the same actions through the server.
 */

import {
  initialState,
  apply,
  replay,
  activePlayer,
  RULES_VERSION,
  type GameAction,
  type GameState
} from '$lib/engine';
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

const seatIds = (seats: SeatConfig[]) => seats.map((s) => ({ id: s.id, name: s.name }));

class Sandbox {
  seats = $state<SeatConfig[]>(DEFAULT_SEATS);
  /** The committed action log; replaying it yields the live game. */
  actions = $state<GameAction[]>([]);
  /** Undone actions available to redo. */
  private redoStack = $state<GameAction[]>([]);
  /** Review position: number of actions applied for display (= actions.length when live). */
  cursor = $state(0);
  error = $state<string | null>(null);

  private base = $derived(initialState(seatIds(this.seats)));

  /** The live (latest) game state. */
  get live(): GameState {
    return replay(this.base, this.actions);
  }
  /** The state shown to the user (live, or an earlier point while reviewing). */
  state = $derived(replay(initialState(seatIds(this.seats)), this.actions.slice(0, this.cursor)));

  get reviewing(): boolean {
    return this.cursor < this.actions.length;
  }
  get canBack(): boolean {
    return this.cursor > 0;
  }
  get canForward(): boolean {
    return this.cursor < this.actions.length;
  }
  get canUndo(): boolean {
    return this.actions.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

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
    this.actions = [];
    this.redoStack = [];
    this.cursor = 0;
    this.error = null;
    this.persist();
  }
  reset() {
    this.newGame(this.seats);
  }

  act(action: GameAction) {
    // Acting while reviewing the past first returns to the live head.
    if (this.reviewing) this.cursor = this.actions.length;
    try {
      const next = apply(replay(initialState(seatIds(this.seats)), this.actions), action); // validate
      void next;
      this.actions = [...this.actions, action];
      this.redoStack = [];
      this.cursor = this.actions.length;
      this.error = null;
      this.persist();
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  /** Bot plays one move if it's a bot's turn (only when live, not reviewing). */
  botStep(): boolean {
    if (this.reviewing) return false;
    const a = this.active;
    if (!a || !this.isBot(a)) return false;
    const action = botAction(this.live, this.level(a));
    if (!action) return false;
    this.act(action);
    return true;
  }

  // --- review (non-destructive) --------------------------------------------
  first() {
    this.cursor = 0;
  }
  back() {
    if (this.canBack) this.cursor -= 1;
  }
  forward() {
    if (this.canForward) this.cursor += 1;
  }
  last() {
    this.cursor = this.actions.length;
  }

  // --- undo / redo (destructive) -------------------------------------------
  undo() {
    if (!this.canUndo) return;
    const undone = this.actions[this.actions.length - 1];
    this.actions = this.actions.slice(0, -1);
    this.redoStack = [...this.redoStack, undone];
    this.cursor = this.actions.length;
    this.error = null;
    this.persist();
  }
  redo() {
    if (!this.canRedo) return;
    const action = this.redoStack[this.redoStack.length - 1];
    this.redoStack = this.redoStack.slice(0, -1);
    this.actions = [...this.actions, action];
    this.cursor = this.actions.length;
    this.persist();
  }

  private persist() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({
          v: RULES_VERSION,
          seats: $state.snapshot(this.seats),
          actions: $state.snapshot(this.actions)
        })
      );
    } catch {
      /* ignore */
    }
  }

  load() {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data?.v !== RULES_VERSION || !Array.isArray(data.actions) || !Array.isArray(data.seats)) return;
      // Validate the log replays cleanly before adopting it.
      replay(initialState(seatIds(data.seats)), data.actions);
      this.seats = data.seats;
      this.actions = data.actions;
      this.redoStack = [];
      this.cursor = data.actions.length;
      this.error = null;
    } catch {
      /* ignore corrupt/incompatible save */
    }
  }
}

export const game = new Sandbox();
