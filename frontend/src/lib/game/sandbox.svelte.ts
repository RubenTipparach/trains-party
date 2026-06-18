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
import * as api from '$lib/api/client';
import type { RoomView, ApiError } from '$lib/api/client';

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
  /** RoLA hostile-mergers variant: refused cross-player mergers go to a share vote. */
  hostileMergers = $state(false);
  /** RoLA local-routes rule (a hub-city-alone run): default on. */
  localRoutes = $state(true);
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

  // --- server-backed (async multiplayer) mode -----------------------------
  /** When true, the action log is authoritative on the server: act() submits and
   *  the room polls for other players' moves. Bots run server-side. */
  serverMode = $state(false);
  /** The signed-in player's Discord id (to know which seat is theirs). */
  myDiscordId = $state<string | null>(null);
  /** Per-seat occupancy from the server room (who holds each seat / is a bot). */
  private seatMeta = $state<{ id: string; discordId: string | null; bot: boolean }[]>([]);
  /** Watch rooms: ms the server paces bot moves at (0 = instaplay). */
  watchPaceMs = $state(0);
  /** The room creator (only they may change the watch pace). */
  private creatorDiscordId = $state<string | null>(null);
  private ticking = false;
  /** True while a move is in flight to the server. */
  serverBusy = $state(false);

  private base = $derived(
    initialState(seatIds(this.seats), this.title, RULES_VERSION, { seed: this.seed, mapMode: this.mapMode, hostileMergers: this.hostileMergers, localRoutes: this.localRoutes })
  );

  /** The live (latest) game state. */
  get live(): GameState {
    return replay(this.base, this.actions);
  }
  /** The state shown to the user (live, or an earlier point while reviewing). */
  state = $derived(
    replay(
      initialState(seatIds(this.seats), this.title, RULES_VERSION, { seed: this.seed, mapMode: this.mapMode, hostileMergers: this.hostileMergers, localRoutes: this.localRoutes }),
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
    return !this.serverMode && this.actions.length > 0;
  }
  get canRedo(): boolean {
    return !this.serverMode && this.redoStack.length > 0;
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
    if (this.reviewing || !this.active) return false;
    if (this.serverMode) {
      // It must be MY seat's turn (a human seat I hold) and no move in flight.
      const seat = this.seatMeta.find((s) => s.id === this.active);
      return !!seat && !seat.bot && seat.discordId === this.myDiscordId && !this.serverBusy;
    }
    return !this.isBot(this.active);
  }
  level(id: string): BotLevel {
    return this.seats.find((s) => s.id === id)?.level ?? 'normal';
  }

  /** Clear server-backed mode so a local game runs locally (bots auto-play, moves
   *  apply + persist locally). Without this, loading a local game after an online
   *  one would leave serverMode stuck on - bots stop advancing and moves route to
   *  a server room that doesn't exist, so the board only updates on a full reload. */
  private goLocal() {
    this.disconnectRealtime();
    this.serverMode = false;
    this.myDiscordId = null;
    this.seatMeta = [];
    this.serverBusy = false;
  }

  /** Start a fresh game in a new (or given) room. Returns the room code. */
  newGame(
    seats: SeatConfig[],
    title = '1889',
    opts: { seed?: number; mapMode?: 'auto' | 'manual'; hostileMergers?: boolean; localRoutes?: boolean; code?: string } = {}
  ): string {
    this.goLocal();
    this.seats = seats;
    this.title = title;
    this.seed = opts.seed ?? Math.floor(Math.random() * 1_000_000_000);
    this.mapMode = opts.mapMode ?? 'auto';
    this.hostileMergers = opts.hostileMergers ?? false;
    this.localRoutes = opts.localRoutes ?? true;
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
    this.newGame(this.seats, this.title, {
      code: this.code,
      mapMode: this.mapMode,
      hostileMergers: this.hostileMergers,
      localRoutes: this.localRoutes
    });
  }

  act(action: GameAction) {
    if (this.serverMode) {
      void this.actServer(action);
      return;
    }
    // Acting while reviewing the past first returns to the live head.
    if (this.reviewing) this.cursor = this.actions.length;
    try {
      const next = apply(
        replay(
          initialState(seatIds(this.seats), this.title, RULES_VERSION, { seed: this.seed, mapMode: this.mapMode, hostileMergers: this.hostileMergers, localRoutes: this.localRoutes }),
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

  /** Bot plays one move if it's a bot's turn (only when live, not reviewing).
   *  No-op in server mode: bots are advanced authoritatively on the server. */
  botStep(): boolean {
    if (this.serverMode || this.reviewing) return false;
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
    if (this.serverMode || !this.code) return; // server games live on the server
    writeSession({
      v: RULES_VERSION,
      code: this.code,
      title: this.title,
      seed: this.seed,
      mapMode: this.mapMode,
      hostileMergers: this.hostileMergers,
      localRoutes: this.localRoutes,
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
    this.goLocal();
    const sess = readSession(code);
    if (!sess || !Array.isArray(sess.actions) || !Array.isArray(sess.seats)) {
      this.newGame(DEFAULT_SEATS, title ?? this.title, { code });
      return;
    }
    const base = initialState(seatIds(sess.seats), sess.title, RULES_VERSION, {
      seed: sess.seed,
      mapMode: sess.mapMode,
      hostileMergers: sess.hostileMergers,
      localRoutes: sess.localRoutes
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
    this.hostileMergers = sess.hostileMergers ?? false;
    this.localRoutes = sess.localRoutes ?? true;
    this.code = normCode(code);
    this.createdAt = sess.createdAt ?? Date.now();
    this.actions = valid;
    this.redoStack = [];
    this.cursor = valid.length;
    this.error = null;
    if (valid.length < sess.actions.length) this.persist();
  }

  // --- server-backed mode ---------------------------------------------------

  /** Load a server room: seats, options, and the action log come from the server;
   *  the engine replays the log identically (same base + same actions). */
  loadServerRoom(code: string, room: RoomView, actions: GameAction[], myDiscordId: string | null) {
    this.serverMode = true;
    this.myDiscordId = myDiscordId;
    this.code = normCode(code);
    this.title = room.title;
    this.seed = room.options.seed;
    this.mapMode = room.options.mapMode as 'auto' | 'manual';
    this.hostileMergers = room.options.hostileMergers;
    this.localRoutes = room.options.localRoutes;
    this.seats = room.seats.map((s) => ({ id: s.seatId, name: s.name, bot: s.bot, level: (s.level as BotLevel) ?? 'normal' }));
    this.seatMeta = room.seats.map((s) => ({ id: s.seatId, discordId: s.discordId, bot: s.bot }));
    this.watchPaceMs = room.botPaceMs ?? 0;
    this.creatorDiscordId = room.creatorDiscordId;
    this.actions = actions;
    this.redoStack = [];
    this.cursor = actions.length;
    this.createdAt = Date.now();
    this.error = null;
    this.connectRealtime();
  }

  // --- realtime (best-effort WebSocket; REST polling stays the reliable path) ---
  private ws: WebSocket | null = null;
  private wsTimer: ReturnType<typeof setTimeout> | null = null;

  /** Open a WebSocket for live room pings. Each ping just says "the room advanced";
   *  we then pull the authoritative delta over REST (same path as polling), so a
   *  dropped or duplicated frame can never desync. Auto-reconnects; if it never
   *  connects, the 2.5s poll still delivers moves. */
  connectRealtime() {
    if (typeof WebSocket === 'undefined' || !this.serverMode || !this.code) return;
    this.disconnectRealtime();
    const code = this.code;
    let ws: WebSocket;
    try {
      ws = new WebSocket(api.wsUrl(code));
    } catch {
      return; // polling remains the fallback
    }
    this.ws = ws;
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data as string);
        if (m?.type === 'sync') void this.syncFromServer();
      } catch {
        /* ignore malformed frames */
      }
    };
    const retry = () => {
      if (this.ws !== ws) return; // superseded by a newer socket
      this.ws = null;
      if (this.serverMode && this.code === code) {
        this.wsTimer = setTimeout(() => this.connectRealtime(), 3000);
      }
    };
    ws.onclose = retry;
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* already closing */
      }
    };
  }

  disconnectRealtime() {
    if (this.wsTimer) {
      clearTimeout(this.wsTimer);
      this.wsTimer = null;
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onclose = null; // do not trigger the reconnect path on an intentional close
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    }
  }

  /** Submit a move to the server: optimistic locally, then reconcile with the log. */
  private async actServer(action: GameAction) {
    if (this.serverBusy) return;
    // Validate locally first so an obviously-illegal move never desyncs the log.
    try {
      apply(replay(this.base, this.actions), action);
    } catch (e) {
      this.error = (e as Error).message;
      return;
    }
    const prevLen = this.actions.length;
    this.actions = [...this.actions, action]; // optimistic: show it immediately
    this.cursor = this.actions.length;
    this.error = null;
    this.serverBusy = true;
    try {
      await api.submitAction(this.code, action);
      await this.syncFromServer(); // pull any bot moves the server played after mine
    } catch (e) {
      this.actions = this.actions.slice(0, prevLen); // roll back
      this.cursor = this.actions.length;
      const ae = e as ApiError;
      this.error = (ae.data as { message?: string })?.message ?? ae.message ?? 'move rejected';
    } finally {
      this.serverBusy = false;
    }
  }

  private syncing = false;
  private syncAgain = false;

  /** Pull new actions (other players, server-side bots) and append them.
   *  Serialized: a WS ping, the post-submit sync, and the 2.5s poll can all fire
   *  it, and two concurrent fetches with the same `since` would append the same
   *  delta twice and corrupt the log. So only one runs at a time; a request that
   *  arrives mid-fetch sets a flag to run once more after (no missed update). */
  /** Only the room's creator may retune the watch pace. */
  get isWatchCreator(): boolean {
    return !!this.myDiscordId && this.creatorDiscordId === this.myDiscordId;
  }

  /** Watch driver: ask the server to advance one paced bot move, then pull it in.
   *  The server gates by elapsed time, so calling this faster than the pace is
   *  harmless (it just no-ops until a move is due). Serialized to avoid overlap. */
  async tickWatch() {
    if (!this.serverMode || !this.code || this.ticking) return;
    this.ticking = true;
    try {
      const r = await api.tickRoom(this.code);
      if (r.advanced) await this.syncFromServer();
    } catch {
      /* transient: the next tick retries */
    } finally {
      this.ticking = false;
    }
  }

  /** Change the watch pace live (creator only). 0 = instaplay to the end. */
  async setWatchPace(ms: number) {
    if (!this.serverMode || !this.code) return;
    this.watchPaceMs = ms; // optimistic; the server clamps
    try {
      const room = await api.setPace(this.code, ms);
      this.watchPaceMs = room.botPaceMs ?? ms;
    } catch {
      /* ignore; keep the optimistic value */
    }
  }

  async syncFromServer() {
    if (!this.serverMode || !this.code) return;
    if (this.syncing) {
      this.syncAgain = true;
      return;
    }
    this.syncing = true;
    try {
      do {
        this.syncAgain = false;
        const wasLive = this.cursor === this.actions.length;
        const r = await api.fetchActions(this.code, this.actions.length);
        if (r.actions.length) {
          this.actions = [...this.actions, ...r.actions];
          if (wasLive) this.cursor = this.actions.length;
        }
      } while (this.syncAgain);
    } catch {
      /* transient: retry on the next ping / poll */
    } finally {
      this.syncing = false;
    }
  }
}

export const game = new Sandbox();
