import type { FastifyInstance } from 'fastify';
import { CFG } from './config';

/**
 * Idle self-shutdown for Fly.io scale-to-zero.
 *
 * Doctrine (CLAUDE.md deploy): the Fly machine should sleep when nobody is using
 * it, to save resources. We let the *app* own the stop decision: fly.toml sets
 * `auto_stop_machines = "off"`, `auto_start_machines = true`,
 * `min_machines_running = 0` (the documented "stop from within your app, start on
 * request" pattern). After `idleShutdownMs` with no real traffic the process
 * exits cleanly (code 0); Fly's default on-failure restart policy leaves a clean
 * exit stopped, and Fly Proxy auto-starts the machine again on the next incoming
 * request (a brief cold start). This is also exactly how Fly's own native
 * auto-stop works under the hood, so the mechanism is well-trodden.
 *
 * Why a custom timer instead of Fly's native `auto_stop_machines`: the native
 * stop fires after only a few minutes of no traffic, not an hour. The frontend
 * polls room state every ~5s while a room is open, so an active session keeps the
 * machine warm regardless; this timer adds the requested ~1-hour grace so a short
 * break doesn't cost a cold start.
 *
 * Health checks (GET /health, Fly's 15s probe) are excluded so they don't count
 * as activity and keep the machine awake forever. Set IDLE_SHUTDOWN_MS=0 to
 * disable (local dev, or a pinned always-on deploy).
 */
export function registerIdleShutdown(app: FastifyInstance) {
  const idleMs = CFG.idleShutdownMs;
  if (idleMs <= 0) {
    app.log.info('idle shutdown disabled (IDLE_SHUTDOWN_MS<=0)');
    return;
  }

  let lastActivity = Date.now();

  app.addHook('onRequest', async (req) => {
    // Fly's health probe hits /health every 15s; don't let it look like a user.
    if (req.url === '/health' || req.url.startsWith('/health?')) return;
    lastActivity = Date.now();
  });

  // Check often enough to be responsive, but no more than every 5 minutes.
  const checkMs = Math.max(30_000, Math.min(idleMs, 5 * 60_000));
  const timer = setInterval(() => {
    const idleFor = Date.now() - lastActivity;
    if (idleFor < idleMs) return;
    clearInterval(timer);
    app.log.info(
      `idle for ${Math.round(idleFor / 1000)}s (>= ${Math.round(idleMs / 1000)}s); sleeping (clean exit, Fly auto-starts on next request)`
    );
    // Best-effort graceful close, then exit 0. Force-exit if close hangs (e.g. a
    // lingering WS) so a stuck connection can't keep the machine billable.
    const force = setTimeout(() => process.exit(0), 3000);
    force.unref?.();
    app.close().finally(() => process.exit(0));
  }, checkMs);
  timer.unref?.(); // the Fastify listener keeps the loop alive; don't double-hold it

  app.log.info(`idle shutdown armed: sleep after ${Math.round(idleMs / 1000)}s of no traffic`);
}
