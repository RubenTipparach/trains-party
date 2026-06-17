import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { normCode } from './engine';

/**
 * Realtime room updates over WebSocket.
 *
 * Doctrine (CLAUDE.md 3.1): REST is authoritative; WebSocket is a best-effort
 * optimisation, NOT a reliable transport. So a broadcast carries only a tiny
 * "this room advanced to seq N" ping - it never carries state. Clients react by
 * pulling the authoritative action-log delta over REST (the same path polling
 * uses), which keeps a dropped/duplicated frame from ever causing desync. If the
 * socket never connects (proxy/mobile drops), the client's 2.5s poll still wins.
 */

interface Sock {
  send: (data: string) => void;
  readyState: number;
  on: (ev: string, cb: () => void) => void;
}

const OPEN = 1;
const rooms = new Map<string, Set<Sock>>();

export const bus = {
  /** Notify every client watching `code` that the room advanced to `seq`. */
  broadcast(code: string, seq: number): void {
    const set = rooms.get(normCode(code));
    if (!set || set.size === 0) return;
    const msg = JSON.stringify({ type: 'sync', code: normCode(code), seq });
    for (const s of set) {
      try {
        if (s.readyState === OPEN) s.send(msg);
      } catch {
        /* a broken socket is dropped on its own close/error handler */
      }
    }
  }
};

export async function registerWs(app: FastifyInstance): Promise<void> {
  await app.register(websocket);
  // GET /rooms/:code/ws - subscribe to realtime pings for one room.
  app.get('/rooms/:code/ws', { websocket: true }, (socket, req) => {
    const code = normCode((req.params as { code: string }).code);
    let set = rooms.get(code);
    if (!set) {
      set = new Set();
      rooms.set(code, set);
    }
    set.add(socket as unknown as Sock);
    const drop = () => {
      set?.delete(socket as unknown as Sock);
      if (set && set.size === 0) rooms.delete(code);
    };
    socket.on('close', drop);
    socket.on('error', drop);
  });
}
