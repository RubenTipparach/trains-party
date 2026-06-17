/**
 * Room lifecycle, seats, the authoritative action endpoint, chat, and invites.
 * Every action is validated by replaying the log through the shared engine; bot
 * seats are advanced server-side after each human move.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { GameError, type GameAction } from '$lib/engine';
import { db } from './db';
import { CFG, now } from './config';
import { sessionDiscordId, profileName } from './auth';
import { sendDM, discordEnabled } from './discord';
import {
  newCode,
  normCode,
  getRoom,
  getSeats,
  deriveState,
  appendAction,
  runBots,
  roomView,
  activePlayer,
  type RoomRow
} from './engine';
import { dispatchNotifications, roomLink } from './notify';
import { bus } from './ws';

interface SeatInput {
  id: string;
  name: string;
  bot?: boolean;
  level?: string;
}

const DEFAULT_SEATS: SeatInput[] = [
  { id: 'p1', name: 'Player 1', bot: false, level: 'normal' },
  { id: 'p2', name: 'Bot 2', bot: true, level: 'normal' },
  { id: 'p3', name: 'Bot 3', bot: true, level: 'normal' },
  { id: 'p4', name: 'Bot 4', bot: true, level: 'normal' }
];

/** Require a signed-in player; sends 401 and returns null when absent. */
function requireAuth(req: FastifyRequest, reply: FastifyReply): string | null {
  const me = sessionDiscordId(req);
  if (!me) {
    reply.code(401).send({ error: 'auth_required' });
    return null;
  }
  return me;
}

/** Map a GameError to 400, anything else to 500. */
function fail(reply: FastifyReply, e: unknown): void {
  if (e instanceof GameError) reply.code(400).send({ error: 'illegal', message: e.message });
  else {
    reply.code(500).send({ error: 'server_error', message: String((e as Error).message).slice(0, 200) });
  }
}

export function registerRooms(app: FastifyInstance): void {
  // --- create -------------------------------------------------------------
  app.post('/rooms', async (req, reply) => {
    const me = requireAuth(req, reply);
    if (!me) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rulesVersion = CFG.rulesVersion;
    try {
      const title = typeof body.title === 'string' ? body.title : '1889';
      const seed = Number.isFinite(body.seed) ? Number(body.seed) : Math.floor(Math.random() * 1_000_000_000);
      const mapMode = body.mapMode === 'manual' ? 'manual' : 'auto';
      const hostileMergers = body.hostileMergers ? 1 : 0;
      const localRoutes = body.localRoutes === false ? 0 : 1;
      const seatsIn = Array.isArray(body.seats) && body.seats.length ? (body.seats as SeatInput[]) : DEFAULT_SEATS;
      const code = newCode();

      db.prepare(
        `INSERT INTO rooms (code, title, rules_version, seed, map_mode, hostile_mergers, local_routes,
           status, creator_discord_id, max_players, seq, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?, 'lobby', ?, ?, 0, ?, ?)`
      ).run(code, title, rulesVersion, seed, mapMode, hostileMergers, localRoutes, me, seatsIn.length, now(), now());

      let creatorClaimed = false;
      const ins = db.prepare(
        'INSERT INTO room_seats (room_code, seat_id, discord_id, name, bot, level, joined_at) VALUES (?,?,?,?,?,?,?)'
      );
      for (const s of seatsIn) {
        const isBot = !!s.bot;
        const human = !isBot && !creatorClaimed;
        if (human) creatorClaimed = true;
        ins.run(
          code,
          String(s.id),
          human ? me : null,
          human ? profileName(me) : String(s.name ?? s.id),
          isBot ? 1 : 0,
          String(s.level ?? 'normal'),
          now()
        );
      }

      const room = getRoom(code)!;
      reply.send(roomView(room));
    } catch (e) {
      fail(reply, e);
    }
  });

  // --- lobby list ---------------------------------------------------------
  app.get('/rooms', async () => {
    const rooms = db
      .prepare("SELECT * FROM rooms WHERE status = 'lobby' ORDER BY created_at DESC LIMIT 50")
      .all() as RoomRow[];
    return rooms.map((r) => roomView(r));
  });

  // --- my games (any status I hold a seat in) -----------------------------
  app.get('/me/rooms', async (req, reply) => {
    const me = requireAuth(req, reply);
    if (!me) return;
    const codes = db
      .prepare('SELECT DISTINCT room_code FROM room_seats WHERE discord_id = ?')
      .all(me) as { room_code: string }[];
    const out = [];
    for (const { room_code } of codes) {
      const room = getRoom(room_code);
      if (room) {
        try {
          out.push(roomView(room));
        } catch {
          /* skip a room whose state cannot be derived */
        }
      }
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    return out;
  });

  // --- global lobby chat --------------------------------------------------
  app.get('/lobby/chat', async (req) => {
    const since = Number((req.query as { since?: string }).since ?? 0);
    const rows = db
      .prepare('SELECT id, discord_id, name, body, created_at FROM lobby_chat WHERE id > ? ORDER BY id DESC LIMIT 50')
      .all(since) as { id: number; discord_id: string | null; name: string; body: string; created_at: number }[];
    return rows
      .reverse()
      .map((r) => ({ id: r.id, discordId: r.discord_id, name: r.name, body: r.body, at: r.created_at }));
  });

  app.post('/lobby/chat', async (req, reply) => {
    const me = requireAuth(req, reply);
    if (!me) return;
    const body = String((req.body as { body?: string })?.body ?? '').trim().slice(0, 500);
    if (!body) return reply.code(400).send({ error: 'empty' });
    const info = db
      .prepare('INSERT INTO lobby_chat (discord_id, name, body, created_at) VALUES (?,?,?,?)')
      .run(me, profileName(me), body, now());
    return { id: Number(info.lastInsertRowid), discordId: me, name: profileName(me), body, at: now() };
  });

  // --- room meta ----------------------------------------------------------
  app.get('/rooms/:code', async (req, reply) => {
    const room = getRoom((req.params as { code: string }).code);
    if (!room) return reply.code(404).send({ error: 'not_found' });
    try {
      return roomView(room);
    } catch (e) {
      return fail(reply, e);
    }
  });

  // --- polled state -------------------------------------------------------
  app.get('/rooms/:code/state', async (req, reply) => {
    const room = getRoom((req.params as { code: string }).code);
    if (!room) return reply.code(404).send({ error: 'not_found' });
    const since = Number((req.query as { since?: string }).since ?? -1);
    if (since >= room.seq) return { code: room.code, seq: room.seq, upToDate: true };
    try {
      const state = deriveState(room);
      return { code: room.code, seq: room.seq, state, room: roomView(room, state) };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // The action-log delta (seq > since), so a client can replay incrementally.
  app.get('/rooms/:code/actions', async (req, reply) => {
    const room = getRoom((req.params as { code: string }).code);
    if (!room) return reply.code(404).send({ error: 'not_found' });
    const since = Number((req.query as { since?: string }).since ?? 0);
    const rows = db
      .prepare('SELECT payload FROM actions WHERE room_code = ? AND seq > ? ORDER BY seq')
      .all(room.code, since) as { payload: string }[];
    return { code: room.code, seq: room.seq, actions: rows.map((r) => JSON.parse(r.payload)) };
  });

  // Host edits game options while the room is still gathering (lobby only).
  app.post('/rooms/:code/options', async (req, reply) => {
    const me = requireAuth(req, reply);
    if (!me) return;
    const room = getRoom((req.params as { code: string }).code);
    if (!room) return reply.code(404).send({ error: 'not_found' });
    if (room.creator_discord_id !== me) return reply.code(403).send({ error: 'not_host' });
    if (room.status !== 'lobby') return reply.code(409).send({ error: 'not_joinable' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (typeof b.seed === 'number' && Number.isFinite(b.seed)) {
      sets.push('seed = ?');
      vals.push(Math.floor(b.seed as number));
    }
    if (b.mapMode === 'auto' || b.mapMode === 'manual') {
      sets.push('map_mode = ?');
      vals.push(b.mapMode);
    }
    if (typeof b.hostileMergers === 'boolean') {
      sets.push('hostile_mergers = ?');
      vals.push(b.hostileMergers ? 1 : 0);
    }
    if (typeof b.localRoutes === 'boolean') {
      sets.push('local_routes = ?');
      vals.push(b.localRoutes ? 1 : 0);
    }
    if (sets.length) {
      sets.push('updated_at = ?');
      vals.push(now(), room.code);
      db.prepare(`UPDATE rooms SET ${sets.join(', ')} WHERE code = ?`).run(...(vals as never[]));
    }
    return roomView(getRoom(room.code)!);
  });

  // --- submit an action ---------------------------------------------------
  app.post('/rooms/:code/actions', async (req, reply) => {
    const me = requireAuth(req, reply);
    if (!me) return;
    const room = getRoom((req.params as { code: string }).code);
    if (!room) return reply.code(404).send({ error: 'not_found' });
    if (room.status !== 'active') return reply.code(409).send({ error: 'not_active' });
    const action = (req.body as { action?: GameAction })?.action;
    if (!action || typeof action !== 'object') return reply.code(400).send({ error: 'bad_action' });

    const player = (action as { player?: string }).player;
    const seat = getSeats(room.code).find((s) => s.seat_id === player);
    if (!seat || seat.bot || seat.discord_id !== me) {
      return reply.code(403).send({ error: 'not_your_seat' });
    }
    try {
      const before = deriveState(room);
      if (activePlayer(before) !== player) return reply.code(409).send({ error: 'not_your_turn' });
      appendAction(room, action); // validates via engine, persists
      const after = runBots(room); // advance consecutive bot turns
      dispatchNotifications(room, before, after);
      bus.broadcast(room.code, room.seq); // realtime ping (best-effort; clients pull via REST)
      return { code: room.code, seq: room.seq, state: after, room: roomView(room, after) };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // --- seats --------------------------------------------------------------
  app.post('/rooms/:code/seats/:seatId/claim', async (req, reply) => {
    const me = requireAuth(req, reply);
    if (!me) return;
    const { code, seatId } = req.params as { code: string; seatId: string };
    const room = getRoom(code);
    if (!room) return reply.code(404).send({ error: 'not_found' });
    if (room.status !== 'lobby') return reply.code(409).send({ error: 'not_joinable' });
    const seats = getSeats(room.code);
    if (seats.some((s) => s.discord_id === me)) return reply.code(409).send({ error: 'already_seated' });
    const seat = seats.find((s) => s.seat_id === seatId);
    if (!seat) return reply.code(404).send({ error: 'no_such_seat' });
    if (seat.bot || seat.discord_id) return reply.code(409).send({ error: 'seat_taken' });
    db.prepare('UPDATE room_seats SET discord_id = ?, name = ? WHERE room_code = ? AND seat_id = ?').run(
      me,
      profileName(me),
      room.code,
      seatId
    );
    return roomView(room);
  });

  app.post('/rooms/:code/seats/:seatId/release', async (req, reply) => {
    const me = requireAuth(req, reply);
    if (!me) return;
    const { code, seatId } = req.params as { code: string; seatId: string };
    const room = getRoom(code);
    if (!room) return reply.code(404).send({ error: 'not_found' });
    const seat = getSeats(room.code).find((s) => s.seat_id === seatId);
    if (!seat || seat.discord_id !== me) return reply.code(403).send({ error: 'not_your_seat' });
    db.prepare("UPDATE room_seats SET discord_id = NULL, name = 'Open' WHERE room_code = ? AND seat_id = ?").run(
      room.code,
      seatId
    );
    return roomView(room);
  });

  // Host fills a seat with a bot (waiting room only).
  app.post('/rooms/:code/seats/:seatId/bot', async (req, reply) => {
    const me = requireAuth(req, reply);
    if (!me) return;
    const { code, seatId } = req.params as { code: string; seatId: string };
    const room = getRoom(code);
    if (!room) return reply.code(404).send({ error: 'not_found' });
    if (room.creator_discord_id !== me) return reply.code(403).send({ error: 'not_host' });
    if (room.status !== 'lobby') return reply.code(409).send({ error: 'not_joinable' });
    if (!getSeats(room.code).some((s) => s.seat_id === seatId)) return reply.code(404).send({ error: 'no_such_seat' });
    db.prepare("UPDATE room_seats SET bot = 1, discord_id = NULL, name = ? WHERE room_code = ? AND seat_id = ?").run(
      `Bot ${seatId.replace(/^p/, '')}`,
      room.code,
      seatId
    );
    return roomView(room);
  });

  // Host clears a seat back to open (waiting room only).
  app.post('/rooms/:code/seats/:seatId/open', async (req, reply) => {
    const me = requireAuth(req, reply);
    if (!me) return;
    const { code, seatId } = req.params as { code: string; seatId: string };
    const room = getRoom(code);
    if (!room) return reply.code(404).send({ error: 'not_found' });
    if (room.creator_discord_id !== me) return reply.code(403).send({ error: 'not_host' });
    if (room.status !== 'lobby') return reply.code(409).send({ error: 'not_joinable' });
    db.prepare("UPDATE room_seats SET bot = 0, discord_id = NULL, name = 'Open' WHERE room_code = ? AND seat_id = ?").run(
      room.code,
      seatId
    );
    return roomView(room);
  });

  // Host changes the table size (number of seats) while gathering. Existing
  // seats p1..pN are preserved; new ones are added open, extras removed.
  app.post('/rooms/:code/players', async (req, reply) => {
    const me = requireAuth(req, reply);
    if (!me) return;
    const room = getRoom((req.params as { code: string }).code);
    if (!room) return reply.code(404).send({ error: 'not_found' });
    if (room.creator_discord_id !== me) return reply.code(403).send({ error: 'not_host' });
    if (room.status !== 'lobby') return reply.code(409).send({ error: 'not_joinable' });
    const count = Math.max(2, Math.min(6, Math.floor(Number((req.body as { count?: number })?.count) || 0)));
    const existing = getSeats(room.code);
    const ins = db.prepare(
      'INSERT INTO room_seats (room_code, seat_id, discord_id, name, bot, level, joined_at) VALUES (?,?,?,?,?,?,?)'
    );
    db.transaction(() => {
      db.prepare('DELETE FROM room_seats WHERE room_code = ?').run(room.code);
      for (let i = 1; i <= count; i++) {
        const prev = existing.find((s) => s.seat_id === `p${i}`);
        if (prev) ins.run(room.code, prev.seat_id, prev.discord_id, prev.name, prev.bot, prev.level, now());
        else ins.run(room.code, `p${i}`, null, 'Open', 0, 'normal', now());
      }
    })();
    db.prepare('UPDATE rooms SET max_players = ?, updated_at = ? WHERE code = ?').run(count, now(), room.code);
    return roomView(getRoom(room.code)!);
  });

  // Live (in-progress) games anyone can see.
  app.get('/rooms/live', async () => {
    const rooms = db
      .prepare("SELECT * FROM rooms WHERE status = 'active' ORDER BY updated_at DESC LIMIT 50")
      .all() as RoomRow[];
    return rooms.map((r) => roomView(r)).filter((v) => !v.finished);
  });

  // --- start --------------------------------------------------------------
  app.post('/rooms/:code/start', async (req, reply) => {
    const me = requireAuth(req, reply);
    if (!me) return;
    const room = getRoom((req.params as { code: string }).code);
    if (!room) return reply.code(404).send({ error: 'not_found' });
    if (room.creator_discord_id !== me) return reply.code(403).send({ error: 'not_creator' });
    if (room.status !== 'lobby') return reply.code(409).send({ error: 'already_started' });
    try {
      const before = deriveState(room);
      // Any seat still open (human, unclaimed) is filled by a bot.
      db.prepare("UPDATE room_seats SET bot = 1 WHERE room_code = ? AND bot = 0 AND discord_id IS NULL").run(room.code);

      // Randomize turn order. The engine derives player order from the seat id
      // (p1 acts first), so we shuffle the OCCUPANTS across the seat slots. No
      // actions exist yet, so this is replay-safe once persisted: the action log
      // references p1..pN, which now map to a randomized seating.
      const seats = getSeats(room.code);
      const occ = seats.map((s) => ({ discordId: s.discord_id, name: s.name, bot: s.bot, level: s.level }));
      for (let i = occ.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [occ[i], occ[j]] = [occ[j], occ[i]];
      }
      const assign = db.prepare(
        'UPDATE room_seats SET discord_id = ?, name = ?, bot = ?, level = ? WHERE room_code = ? AND seat_id = ?'
      );
      db.transaction(() => {
        seats.forEach((s, i) => assign.run(occ[i].discordId, occ[i].name, occ[i].bot, occ[i].level, room.code, s.seat_id));
      })();

      db.prepare("UPDATE rooms SET status = 'active', updated_at = ? WHERE code = ?").run(now(), room.code);
      room.status = 'active';
      const after = runBots(room);
      dispatchNotifications(room, before, after);
      bus.broadcast(room.code, room.seq); // realtime: opening bot moves land on the board live
      return { code: room.code, seq: room.seq, state: after, room: roomView(room, after) };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // --- chat ---------------------------------------------------------------
  app.get('/rooms/:code/chat', async (req, reply) => {
    const room = getRoom((req.params as { code: string }).code);
    if (!room) return reply.code(404).send({ error: 'not_found' });
    const since = Number((req.query as { since?: string }).since ?? 0);
    const rows = db
      .prepare('SELECT id, discord_id, name, body, created_at FROM chat WHERE room_code = ? AND id > ? ORDER BY id LIMIT 200')
      .all(room.code, since) as { id: number; discord_id: string | null; name: string; body: string; created_at: number }[];
    return rows.map((r) => ({ id: r.id, discordId: r.discord_id, name: r.name, body: r.body, at: r.created_at }));
  });

  app.post('/rooms/:code/chat', async (req, reply) => {
    const me = requireAuth(req, reply);
    if (!me) return;
    const room = getRoom((req.params as { code: string }).code);
    if (!room) return reply.code(404).send({ error: 'not_found' });
    const body = String((req.body as { body?: string })?.body ?? '').trim().slice(0, 500);
    if (!body) return reply.code(400).send({ error: 'empty' });
    const info = db
      .prepare('INSERT INTO chat (room_code, discord_id, name, body, created_at) VALUES (?,?,?,?,?)')
      .run(room.code, me, profileName(me), body, now());
    return { id: Number(info.lastInsertRowid), discordId: me, name: profileName(me), body, at: now() };
  });

  // --- invite (bot DMs a room link) ---------------------------------------
  app.post('/rooms/:code/invite', async (req, reply) => {
    const me = requireAuth(req, reply);
    if (!me) return;
    const room = getRoom((req.params as { code: string }).code);
    if (!room) return reply.code(404).send({ error: 'not_found' });
    const invitee = String((req.body as { discordId?: string })?.discordId ?? '').trim();
    if (!/^\d{5,25}$/.test(invitee)) return reply.code(400).send({ error: 'bad_discord_id' });
    db.prepare(
      'INSERT INTO invites (room_code, inviter_discord_id, invitee_discord_id, created_at, accepted) VALUES (?,?,?,?,0)'
    ).run(room.code, me, invitee, now());
    let dm: { ok: boolean; error?: string } = { ok: false, error: 'discord_disabled' };
    if (discordEnabled()) {
      dm = await sendDM(
        invitee,
        `🎉 ${profileName(me)} invited you to a Trains Party game.\n▶ Join: ${roomLink(room)}`
      );
    }
    return { ok: true, dm };
  });
}
