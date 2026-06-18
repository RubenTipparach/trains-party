/**
 * Autonomous watch loop. A paced all-bot ("watch") room advances on the server on
 * its own - like simulated players - so the game keeps progressing (and finishes,
 * ready to review) even when nobody has the page open. Each due room steps one bot
 * move at its pace; a finished room is marked so the scan skips it.
 *
 * (A normal multiplayer game with bots needs none of this: its bots are advanced
 * synchronously after each human move - see rooms.ts. This loop is only for the
 * spectator watch rooms, which have bot_pace_ms > 0.)
 */

import { db } from './db';
import { now } from './config';
import { stepBotsPaced, type RoomRow } from './engine';
import { bus } from './ws';

function tickWatchRooms(): void {
  let rows: RoomRow[];
  try {
    rows = db
      .prepare("SELECT * FROM rooms WHERE status = 'active' AND bot_pace_ms > 0")
      .all() as RoomRow[];
  } catch {
    return; // DB hiccup: try again next tick
  }
  for (const room of rows) {
    try {
      if (now() - room.updated_at < room.bot_pace_ms) continue; // not due yet
      const { state, advanced } = stepBotsPaced(room);
      if (advanced) {
        bus.broadcast(room.code, room.seq); // watchers (if any) pull the delta over REST
      } else if (state.finished) {
        // Done: mark it so the scan stops deriving this room every tick. It still
        // shows under the creator's "Ended games" (roomView reads finished state).
        db.prepare("UPDATE rooms SET status = 'finished' WHERE code = ?").run(room.code);
      }
    } catch {
      /* one bad room must not stop the loop */
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the autonomous watch loop (idempotent). Interval is small so a fast pace
 *  (down to 0.25s) is honoured; slow paces just no-op until a room is due. */
export function startWatchLoop(intervalMs = 250): void {
  if (timer) return;
  timer = setInterval(tickWatchRooms, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
}
