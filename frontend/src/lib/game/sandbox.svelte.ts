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
import { newCode, normCode, readSession, writeSession } from './sessions';

/** A compact round label cached on each saved session for the lobby. */
function statusOf(s: GameState): string {
  if (s.finished) return 'Finished';
  switch (s.round) {
    case 'mapbuild':
      return 'Building map';
    case 'auction':
      return 'Auction';
    case 'stock':
      return `SR ${Math.max(1, s.srCount)}`;
    case 'operating':
      return `OR ${s.orSet}.${s.or?.orNumber ?? 1}`;
    default:
      return s.round;
  }
}

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
  /** Active title (registry key, e.g. "1889" or "rola"). */
  title = $state('1889');
  /** Procedural-map seed (RoLA) and how the map is built. */
  seed = $state(1);
  mapMode = $state<'auto' | 'manual'>('auto');
  /** Active room code: the game is saved under it; the URL is /<title>/room/<code>. */
  code = $state('');
  /** When this room was created (for the lobby). */
  createdAt = $state(0);
  /** The committed action log; replaying it yields the live game. */
  actions = $state<GameAction[]>([]);
  /** Undone actions available to redo. */
  private redoStack = $state<GameAction[]>([]);
  /** Review position: number of actions applied for display (= actions.length when live). */
  cursor = $state(0);
  error = $state<string | null>(null);

  private base = $derived(
    initialState(seatIds(this.seats), this.title, RULES_VERSION, { seed: this.seed, mapMode: this.mapMode })
  );

  /** The live (latest) game state. */
  get live(): GameState {
    return replay(this.base, this.actions);
  }
  /** The state shown to the user (live, or an earlier point while reviewing). */
  state = $derived(
    replay(
      initialState(seatIds(this.seats), this.title, RULES_VERSION, { seed: this.seed, mapMode: this.mapMode }),
      this.actions.slice(0, this.cursor)
    )
  );

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
  /**
   * Whether the local human may act right now: there is an active player, that
   * player is not a bot, and we are not reviewing a past position. Action buttons
   * are gated on this so you cannot act on a bot's (or another player's) turn.
   */
  get canAct(): boolean {
    return !this.reviewing && !!this.active && !this.isBot(this.active);
  }
  level(id: string): BotLevel {
    return this.seats.find((s) => s.id === id)?.level ?? 'normal';
  }

  /** Start a fresh game in a new (or given) room. Returns the room code. */
  newGame(
    seats: SeatConfig[],
    title = '1889',
    opts: { seed?: number; mapMode?: 'auto' | 'manual'; code?: string } = {}
  ): string {
    this.seats = seats;
    this.title = title;
    this.seed = opts.seed ?? Math.floor(Math.random() * 1_000_000_000);
    this.mapMode = opts.mapMode ?? 'auto';
    this.code = opts.code ? normCode(opts.code) : newCode();
    this.createdAt = Date.now();
    this.actions = [];
    this.redoStack = [];
    this.cursor = 0;
    this.error = null;
    this.persist();
    return this.code;
  }
  /** Restart the current room from scratch (same code). */
  reset() {
    this.newGame(this.seats, this.title, { code: this.code, mapMode: this.mapMode });
  }

  act(action: GameAction) {
    // Acting while reviewing the past first returns to the live head.
    if (this.reviewing) this.cursor = this.actions.length;
    try {
      const next = apply(
        replay(
          initialState(seatIds(this.seats), this.title, RULES_VERSION, { seed: this.seed, mapMode: this.mapMode }),
          this.actions
        ),
        action
      ); // validate
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
    if (!this.code) return;
    writeSession({
      v: RULES_VERSION,
      code: this.code,
      title: this.title,
      seed: this.seed,
      mapMode: this.mapMode,
      seats: $state.snapshot(this.seats) as SeatConfig[],
      actions: $state.snapshot(this.actions) as GameAction[],
      status: statusOf(this.live),
      createdAt: this.createdAt || Date.now(),
      updatedAt: Date.now()
    });
  }

  /**
   * Load a room by code. If the code is unknown locally, claim it with a fresh
   * default game (so a shared/typed room link is never a dead end).
   *
   * The save is the action LOG, replayed DEFENSIVELY: apply actions one by one
   * and keep the longest prefix that still applies under the current engine, so a
   * rules change that invalidates a late action only rewinds the game slightly.
   */
  loadRoom(code: string, title?: string) {
    const sess = readSession(code);
    if (!sess || !Array.isArray(sess.actions) || !Array.isArray(sess.seats)) {
      this.newGame(DEFAULT_SEATS, title ?? this.title, { code });
      return;
    }
    const base = initialState(seatIds(sess.seats), sess.title, RULES_VERSION, {
      seed: sess.seed,
      mapMode: sess.mapMode
    });
    const valid: GameAction[] = [];
    let s = base;
    for (const action of sess.actions) {
      try {
        s = apply(s, action);
        valid.push(action);
      } catch {
        break;
      }
    }
    this.seats = sess.seats;
    this.title = sess.title;
    this.seed = sess.seed;
    this.mapMode = sess.mapMode;
    this.code = normCode(code);
    this.createdAt = sess.createdAt ?? Date.now();
    this.actions = valid;
    this.redoStack = [];
    this.cursor = valid.length;
    this.error = null;
    if (valid.length < sess.actions.length) this.persist();
  }
}

export const game = new Sandbox();
