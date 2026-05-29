import Fastify from 'fastify';
import { db, migrate } from './db.js';

/**
 * Trains Party API (Stage 0).
 *
 * Doctrine (see CLAUDE.md): REST is authoritative. Clients poll GET state and
 * submit actions; the server appends to the per-room action log and re-validates
 * every operation through the shared engine. WebSocket acceleration is added later
 * as a best-effort optimisation only.
 *
 * Stage 0 ships a health check and the persistence layer; the room/action/state
 * endpoints below are stubs filled in during the multiplayer stage.
 */

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const RULES_VERSION = process.env.RULES_VERSION ?? 'dev';

migrate();

const app = Fastify({ logger: true });

app.get('/health', async () => ({
  ok: true,
  service: 'trains-party',
  rulesVersion: RULES_VERSION,
  rooms: (db.prepare('SELECT COUNT(*) AS n FROM rooms').get() as { n: number }).n
}));

// --- Stubs (Stage 4: multiplayer) ------------------------------------------
app.post('/rooms', async (_req, reply) => reply.code(501).send({ error: 'not implemented' }));
app.get('/rooms/:code', async (_req, reply) => reply.code(501).send({ error: 'not implemented' }));
app.get('/rooms/:code/state', async (_req, reply) => reply.code(501).send({ error: 'not implemented' }));
app.post('/rooms/:code/actions', async (_req, reply) => reply.code(501).send({ error: 'not implemented' }));

app
  .listen({ port: PORT, host: HOST })
  .then((addr) => app.log.info(`trains-party server listening on ${addr}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
