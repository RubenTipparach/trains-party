/**
 * Player sign-in with Discord (identify, plus guilds.join when enabled so bot
 * DMs can reach the player without them manually joining the server). The server
 * mints a bearer session and hands it back to the static frontend via redirect.
 * Also exposes /me and the notify-preferences endpoints.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import { db } from './db';
import { CFG, now } from './config';
import { buildAuthorizeUrl, exchangeCode, fetchUser, guildsJoin, avatarUrl } from './discord';
import {
  upsertProfile,
  getProfile,
  createSession,
  deleteSession,
  sessionDiscordId,
  isAdminId,
  createAdminSession,
  ADMIN_COOKIE
} from './auth';
import { getNotifyPrefs, setNotifyPrefs } from './notify';
import { sendDM, discordEnabled } from './discord';

const STATE_TTL = 10 * 60 * 1000;

function reqOrigin(req: FastifyRequest): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
  return `${proto}://${req.headers.host}`;
}
/** The single registered Discord redirect URI, used by BOTH player and admin
 *  sign-in (so only one URI needs registering in the Discord portal). */
export const discordCallback = (req: FastifyRequest) =>
  CFG.discord.redirectUri || `${reqOrigin(req)}/auth/discord/callback`;

export function makeState(kind: 'player' | 'admin', redirect: string): string {
  const state = randomBytes(16).toString('base64url');
  db.prepare('INSERT INTO oauth_state (state, kind, redirect, created_at) VALUES (?,?,?,?)').run(state, kind, redirect, now());
  return state;
}

/** Consume a one-time state token (validates TTL); returns its kind + redirect. */
export function takeState(state: string): { kind: 'player' | 'admin'; redirect: string } | null {
  const row = db.prepare('SELECT kind, redirect, created_at FROM oauth_state WHERE state = ?').get(state) as
    | { kind: string; redirect: string | null; created_at: number }
    | undefined;
  if (row) db.prepare('DELETE FROM oauth_state WHERE state = ?').run(state);
  if (!row || now() - row.created_at > STATE_TTL) return null;
  return { kind: row.kind as 'player' | 'admin', redirect: row.redirect ?? '' };
}

function requireAuth(req: FastifyRequest, reply: FastifyReply): string | null {
  const me = sessionDiscordId(req);
  if (!me) {
    reply.code(401).send({ error: 'auth_required' });
    return null;
  }
  return me;
}

export function registerAuth(app: FastifyInstance): void {
  app.get('/auth/discord/enabled', async () => ({
    signIn: CFG.discord.signIn,
    autoJoin: CFG.discord.autoJoin,
    anon: true
  }));

  // Guest login: no Discord. Mints a profile with a non-snowflake id (so the bot
  // never tries to DM it) and a session. Lets people play without an account.
  app.post('/auth/anon', async (req) => {
    const raw = String((req.body as { name?: string })?.name ?? '').trim().slice(0, 24);
    const name = raw || 'Guest';
    const id = 'g_' + randomBytes(9).toString('base64url');
    db.prepare(
      'INSERT INTO profiles (discord_id, username, display_name, avatar, created_at, updated_at) VALUES (?,?,?,?,?,?)'
    ).run(id, name, name, null, now(), now());
    const token = createSession(id);
    return { token, profile: meView(id) };
  });

  app.get('/auth/discord/login', async (req, reply) => {
    if (!CFG.discord.signIn) return reply.code(404).send({ error: 'discord_disabled' });
    const redirect = String((req.query as { redirect?: string }).redirect ?? CFG.appBaseUrl ?? '');
    const state = makeState('player', redirect);
    const scopes = CFG.discord.autoJoin ? ['identify', 'guilds.join'] : ['identify'];
    return reply.redirect(buildAuthorizeUrl(state, discordCallback(req), scopes));
  });

  // Shared callback for player AND admin sign-in (branch on the state's kind).
  app.get('/auth/discord/callback', async (req, reply) => {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state) return reply.code(400).send({ error: 'missing_code' });
    const st = takeState(state);
    if (!st) return reply.code(400).send({ error: 'bad_state' });
    const accessToken = await exchangeCode(code, discordCallback(req));
    if (!accessToken) return reply.code(502).send({ error: 'token_exchange_failed' });
    const user = await fetchUser(accessToken);
    if (!user) return reply.code(502).send({ error: 'identify_failed' });

    // Admin sign-in: only an allowlisted Discord id (ADMIN_DISCORD_ID) may in.
    if (st.kind === 'admin') {
      if (!isAdminId(user.id)) {
        return reply
          .code(403)
          .type('text/html')
          .send('<h1>Not authorized</h1><p>This Discord account is not on the admin allowlist.</p>');
      }
      upsertProfile(user);
      const raw = createAdminSession(user.id);
      reply.setCookie(ADMIN_COOKIE, raw, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/admin',
        maxAge: Math.floor(CFG.adminTtlMs / 1000)
      });
      return reply.redirect(`${reqOrigin(req)}/admin`);
    }

    // Player sign-in.
    if (CFG.discord.autoJoin) await guildsJoin(user.id, accessToken); // best-effort
    upsertProfile(user);
    const token = createSession(user.id);
    const base = st.redirect || CFG.appBaseUrl;
    if (base) return reply.redirect(`${base}/auth?token=${encodeURIComponent(token)}`);
    // No frontend configured (e.g. local API testing): return the token directly.
    return { token, profile: meView(user.id) };
  });

  app.get('/me', async (req, reply) => {
    const me = requireAuth(req, reply);
    if (!me) return;
    return meView(me);
  });

  app.post('/auth/logout', async (req) => {
    deleteSession(req);
    return { ok: true };
  });

  // notify preferences
  app.get('/me/notify', async (req, reply) => {
    const me = requireAuth(req, reply);
    if (!me) return;
    return getNotifyPrefs(me);
  });

  app.put('/me/notify', async (req, reply) => {
    const me = requireAuth(req, reply);
    if (!me) return;
    const b = (req.body ?? {}) as { notifyTurn?: boolean; notifyAuction?: boolean };
    const cur = getNotifyPrefs(me);
    setNotifyPrefs(me, {
      notifyTurn: b.notifyTurn ?? cur.notifyTurn,
      notifyAuction: b.notifyAuction ?? cur.notifyAuction
    });
    return getNotifyPrefs(me);
  });

  app.post('/me/notify/test', async (req, reply) => {
    const me = requireAuth(req, reply);
    if (!me) return;
    if (!discordEnabled()) return reply.code(409).send({ error: 'discord_disabled' });
    const r = await sendDM(me, '🚂 Test notification from Trains Party. You are all set!');
    return r;
  });
}

function meView(discordId: string) {
  const p = getProfile(discordId);
  return {
    discordId,
    name: p?.display_name || p?.username || 'Player',
    avatar: p?.avatar ?? null,
    notify: getNotifyPrefs(discordId)
  };
}

// re-export so index can compute avatar in views if needed
export { avatarUrl };
