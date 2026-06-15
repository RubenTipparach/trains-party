/**
 * Bridge to the shared, isomorphic game engine. The server replays the per-room
 * action log through the SAME engine the browser uses, so it is the authoritative
 * validator (CLAUDE.md "one engine, two runtimes"). It also drives bot seats here
 * so a game advances even when no client is watching the room.
 */

import {
  initialState,
  apply,
  replay,
  activePlayer,
  type GameAction,
  type GameState
} from '$lib/engine';
import { botAction, type BotLevel } from '$lib/game/bots';
import { db } from './db';
import { now } from './config';

export interface RoomRow {
  code: string;
  title: string;
  rules_version: string;
  seed: number;
  map_mode: string;
  hostile_mergers: number;
  local_routes: number;
  status: string;
  creator_discord_id: string | null;
  max_players: number;
  seq: number;
  created_at: number;
  updated_at: number;
}

export interface SeatRow {
  room_code: string;
  seat_id: string;
  discord_id: string | null;
  name: string;
  bot: number;
  level: string;
  joined_at: number;
}

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // Crockford base32, minus i/l/o/u
export const normCode = (c: string) => c.toLowerCase().trim();

export function newCode(len = 6): string {
  let code = '';
  for (let i = 0; i < len; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  if (db.prepare('SELECT 1 FROM rooms WHERE code = ?').get(code)) return newCode(len);
  return code;
}

export function getRoom(code: string): RoomRow | null {
  return (db.prepare('SELECT * FROM rooms WHERE code = ?').get(normCode(code)) as RoomRow) ?? null;
}

export function getSeats(code: string): SeatRow[] {
  return db
    .prepare('SELECT * FROM room_seats WHERE room_code = ? ORDER BY seat_id')
    .all(normCode(code)) as SeatRow[];
}

export function getActions(code: string): GameAction[] {
  const rows = db
    .prepare('SELECT payload FROM actions WHERE room_code = ? ORDER BY seq')
    .all(normCode(code)) as { payload: string }[];
  return rows.map((r) => JSON.parse(r.payload) as GameAction);
}

function buildBase(room: RoomRow, seats: SeatRow[]): GameState {
  const seatList = seats.map((s) => ({ id: s.seat_id, name: s.name }));
  return initialState(seatList, room.title, room.rules_version, {
    seed: room.seed,
    mapMode: room.map_mode as 'auto' | 'manual',
    hostileMergers: !!room.hostile_mergers,
    localRoutes: !!room.local_routes
  });
}

/** Derive the live game state by replaying the room's action log. */
export function deriveState(room: RoomRow): GameState {
  const seats = getSeats(room.code);
  return replay(buildBase(room, seats), getActions(room.code));
}

/**
 * Validate and persist one action. `apply` throws a GameError on an illegal move
 * (the caller has already checked turn ownership), so a thrown error means the
 * action was rejected and nothing is written. Returns the resulting state.
 */
export function appendAction(room: RoomRow, action: GameAction): GameState {
  const seats = getSeats(room.code);
  const state = replay(buildBase(room, seats), getActions(room.code));
  const next = apply(state, action); // throws if illegal -> nothing persisted
  const seq = room.seq + 1;
  db.prepare(
    'INSERT INTO actions (room_code, seq, payload, actor_discord_id, created_at) VALUES (?,?,?,?,?)'
  ).run(room.code, seq, JSON.stringify(action), (action as { player?: string }).player ?? null, now());
  db.prepare('UPDATE rooms SET seq = ?, updated_at = ? WHERE code = ?').run(seq, now(), room.code);
  room.seq = seq;
  return next;
}

/** Advance every consecutive bot turn, persisting each move. Returns final state. */
export function runBots(room: RoomRow, max = 500): GameState {
  let state = deriveState(room);
  const seatById = new Map(getSeats(room.code).map((s) => [s.seat_id, s]));
  for (let i = 0; i < max; i++) {
    if (state.finished) break;
    const active = activePlayer(state);
    if (!active) break;
    const seat = seatById.get(active);
    if (!seat || !seat.bot) break; // a human must act
    const action = botAction(state, (seat.level as BotLevel) ?? 'normal');
    if (!action) break;
    state = appendAction(room, action);
  }
  return state;
}

export { activePlayer };

/** Compact round label for lobby rows (mirrors the sandbox's statusOf). */
export function statusLabel(s: GameState): string {
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

export function seatView(s: SeatRow) {
  return {
    seatId: s.seat_id,
    name: s.name,
    bot: !!s.bot,
    level: s.level,
    discordId: s.discord_id,
    taken: !!s.discord_id || !!s.bot
  };
}

/** Public room summary (no action log). */
export function roomView(room: RoomRow, state?: GameState) {
  const st = state ?? deriveState(room);
  return {
    code: room.code,
    title: room.title,
    status: room.status,
    seq: room.seq,
    label: statusLabel(st),
    finished: st.finished,
    activePlayer: activePlayer(st),
    seats: getSeats(room.code).map(seatView),
    options: {
      seed: room.seed,
      mapMode: room.map_mode,
      hostileMergers: !!room.hostile_mergers,
      localRoutes: !!room.local_routes
    },
    maxPlayers: room.max_players,
    creatorDiscordId: room.creator_discord_id,
    updatedAt: room.updated_at
  };
}
