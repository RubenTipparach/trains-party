import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { db, migrate } from './db';
import { CFG } from './config';
import { seedAdminAllowlist } from './auth';
import { registerAuth } from './oauth';
import { registerRooms } from './rooms';
import { registerAdmin } from './admin';
import { registerWs } from './ws';

/**
 * Trains Party API.
 *
 * Doctrine (CLAUDE.md): REST is authoritative. Clients poll GET state and submit
 * actions; the server appends to the per-room action log and re-validates every
 * operation through the shared engine. Discord layers on top: sign-in (identity),
 * bot DMs (turn/auction pings, invites), and an allowlisted admin portal.
 */

migrate();
seedAdminAllowlist();

const app = Fastify({ logger: true });

// Treat an empty JSON body as {} (bodiless POSTs like /start, /logout, /close).
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  const s = (body as string).trim();
  if (!s) return done(null, {});
  try {
    done(null, JSON.parse(s));
  } catch (e) {
    done(e as Error, undefined);
  }
});

await app.register(cors, {
  origin: CFG.corsOrigins.length ? CFG.corsOrigins : true, // reflect origin when unset
  credentials: true
});
await app.register(cookie);

app.get('/health', async () => ({
  ok: true,
  service: 'trains-party',
  rulesVersion: CFG.rulesVersion,
  discord: { signIn: CFG.discord.signIn, autoJoin: CFG.discord.autoJoin, bot: !!CFG.discord.botToken },
  rooms: (db.prepare('SELECT COUNT(*) AS n FROM rooms').get() as { n: number }).n
}));

await registerWs(app); // realtime room pings (best-effort; REST stays authoritative)
registerAuth(app);
registerRooms(app);
registerAdmin(app);

app
  .listen({ port: CFG.port, host: CFG.host })
  .then((addr) => app.log.info(`trains-party server listening on ${addr}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
