/**
 * Discord DM notifications: the bot messages a player when it becomes their turn,
 * and messages everyone when an auction opens. Per-player opt-in via notify_prefs.
 * Mirrors the High Frontier dispatchTurnNotifications flow.
 */

import type { GameState } from '$lib/engine';
import { db } from './db';
import { CFG, now } from './config';
import { sendDM, discordEnabled } from './discord';
import { activePlayer, getSeats, type RoomRow } from './engine';

export interface NotifyPrefs {
  notifyTurn: boolean;
  notifyAuction: boolean;
}

export function getNotifyPrefs(discordId: string): NotifyPrefs {
  const row = db.prepare('SELECT notify_turn, notify_auction FROM notify_prefs WHERE discord_id = ?').get(discordId) as
    | { notify_turn: number; notify_auction: number }
    | undefined;
  // Default opt-in (a linked player gets pings until they turn them off).
  return { notifyTurn: row ? !!row.notify_turn : true, notifyAuction: row ? !!row.notify_auction : true };
}

export function setNotifyPrefs(discordId: string, prefs: NotifyPrefs): void {
  db.prepare(
    `INSERT INTO notify_prefs (discord_id, notify_turn, notify_auction, updated_at)
     VALUES (?,?,?,?)
     ON CONFLICT(discord_id) DO UPDATE SET
       notify_turn = excluded.notify_turn, notify_auction = excluded.notify_auction, updated_at = excluded.updated_at`
  ).run(discordId, prefs.notifyTurn ? 1 : 0, prefs.notifyAuction ? 1 : 0, now());
}

export function roomLink(room: RoomRow): string {
  return CFG.appBaseUrl ? `${CFG.appBaseUrl}/${room.title}/room/${room.code}` : `room ${room.code}`;
}

/** DM the right players after a move advances the game. Fire-and-forget. */
export function dispatchNotifications(room: RoomRow, before: GameState, after: GameState): void {
  if (!discordEnabled()) return;
  const seats = getSeats(room.code);
  const link = roomLink(room);
  const a0 = activePlayer(before);
  const a1 = activePlayer(after);

  // Turn advanced to a (different) linked human who opted in.
  if (a1 && a1 !== a0) {
    const seat = seats.find((s) => s.seat_id === a1);
    if (seat && !seat.bot && seat.discord_id && getNotifyPrefs(seat.discord_id).notifyTurn) {
      void sendDM(seat.discord_id, `🚂 It's your turn in Trains Party (${room.title}).\n▶ Play now: ${link}`);
    }
  }

  // An auction just opened: ping every other linked human.
  if (after.round === 'auction' && before.round !== 'auction') {
    for (const seat of seats) {
      if (seat.bot || !seat.discord_id || seat.seat_id === a1) continue;
      if (!getNotifyPrefs(seat.discord_id).notifyAuction) continue;
      void sendDM(seat.discord_id, `🔨 An auction just opened in Trains Party (${room.title}).\n▶ Play now: ${link}`);
    }
  }
}
