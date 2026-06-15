/**
 * Identity: Discord-linked player sessions (bearer tokens) and admin sessions
 * (hashed cookie). The admin allowlist is seeded from ADMIN_DISCORD_ID on boot
 * and re-checked on every request, so dropping an id + redeploy revokes access.
 */

import { randomBytes, createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { db, getSetting, setSetting } from './db';
import { CFG, now } from './config';
import { avatarUrl, type DiscordUser } from './discord';

const randToken = (bytes = 24) => randomBytes(bytes).toString('base64url');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface ProfileRow {
  discord_id: string;
  username: string;
  display_name: string | null;
  avatar: string | null;
}

export function upsertProfile(u: DiscordUser): string {
  const display = u.global_name ?? u.username;
  db.prepare(
    `INSERT INTO profiles (discord_id, username, display_name, avatar, created_at, updated_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(discord_id) DO UPDATE SET
       username = excluded.username, display_name = excluded.display_name,
       avatar = excluded.avatar, updated_at = excluded.updated_at`
  ).run(u.id, u.username, display, avatarUrl(u.id, u.avatar), now(), now());
  return u.id;
}

export function getProfile(discordId: string): ProfileRow | null {
  return (
    (db
      .prepare('SELECT discord_id, username, display_name, avatar FROM profiles WHERE discord_id = ?')
      .get(discordId) as ProfileRow) ?? null
  );
}

export function profileName(discordId: string | null): string {
  if (!discordId) return 'Player';
  const p = getProfile(discordId);
  return p?.display_name || p?.username || 'Player';
}

// --- player sessions (bearer) ----------------------------------------------

export function createSession(discordId: string): string {
  const token = randToken();
  db.prepare('INSERT INTO sessions (token, discord_id, created_at, expires_at) VALUES (?,?,?,?)').run(
    token,
    discordId,
    now(),
    now() + CFG.sessionTtlMs
  );
  return token;
}

/** The Discord id behind a request's bearer token, or null. */
export function sessionDiscordId(req: FastifyRequest): string | null {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  const row = db.prepare('SELECT discord_id, expires_at FROM sessions WHERE token = ?').get(token) as
    | { discord_id: string; expires_at: number }
    | undefined;
  if (!row) return null;
  if (row.expires_at < now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return row.discord_id;
}

export function deleteSession(req: FastifyRequest): void {
  const auth = req.headers['authorization'];
  if (auth?.startsWith('Bearer ')) db.prepare('DELETE FROM sessions WHERE token = ?').run(auth.slice(7).trim());
}

// --- admin sessions (allowlist + hashed cookie) ----------------------------

export const ADMIN_COOKIE = 'tp_admin';

/** Seed the allowlist from the ADMIN_DISCORD_ID secret on boot. */
export function seedAdminAllowlist(): void {
  if (CFG.adminDiscordIds.length) setSetting('admin_discord_ids', CFG.adminDiscordIds.join(','));
}

export function adminAllowlist(): string[] {
  return (getSetting('admin_discord_ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const isAdminId = (id: string) => adminAllowlist().includes(id);

export function createAdminSession(discordId: string): string {
  const raw = randToken(18);
  db.prepare('INSERT INTO admin_sessions (token_hash, discord_id, created_at, expires_at) VALUES (?,?,?,?)').run(
    sha256(raw),
    discordId,
    now(),
    now() + CFG.adminTtlMs
  );
  return raw;
}

/** Validate the admin cookie: unexpired, still on the allowlist; slides expiry. */
export function adminFromCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  const hash = sha256(raw);
  const row = db.prepare('SELECT discord_id, expires_at FROM admin_sessions WHERE token_hash = ?').get(hash) as
    | { discord_id: string; expires_at: number }
    | undefined;
  if (!row) return null;
  if (row.expires_at < now()) {
    db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(hash);
    return null;
  }
  if (!isAdminId(row.discord_id)) return null; // allowlist re-checked every request
  db.prepare('UPDATE admin_sessions SET expires_at = ? WHERE token_hash = ?').run(now() + CFG.adminTtlMs, hash);
  return row.discord_id;
}

export function deleteAdminSession(raw: string | undefined): void {
  if (raw) db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(sha256(raw));
}
