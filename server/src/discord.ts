/**
 * Direct Discord REST (v10), no discord.js / gateway. Three independent paths,
 * each inert without its env vars: bot DMs, OAuth sign-in (identify + optional
 * guilds.join), and authorize-URL building. Functions return { ok } shapes and
 * never throw. Ported from the High Frontier fan game's server/discord.js.
 */

import { CFG } from './config';

const API = 'https://discord.com/api/v10';

export function discordEnabled(): boolean {
  return !!CFG.discord.botToken;
}

// Cache one DM channel per recipient so we do not re-open it for every message.
const dmChannel = new Map<string, string>();

async function openDmChannel(userId: string): Promise<string | null> {
  const cached = dmChannel.get(userId);
  if (cached) return cached;
  const r = await fetch(`${API}/users/@me/channels`, {
    method: 'POST',
    headers: { Authorization: `Bot ${CFG.discord.botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient_id: userId })
  });
  if (!r.ok) return null;
  const ch = (await r.json()) as { id: string };
  dmChannel.set(userId, ch.id);
  return ch.id;
}

/** DM a user. Requires the bot to share a guild with them (see guilds.join). */
export async function sendDM(userId: string, content: string): Promise<{ ok: boolean; error?: string }> {
  if (!discordEnabled()) return { ok: false, error: 'discord_disabled' };
  const uid = String(userId || '').trim();
  if (!/^\d{5,25}$/.test(uid)) return { ok: false, error: 'bad_discord_id' };
  try {
    const channelId = await openDmChannel(uid);
    if (!channelId) return { ok: false, error: 'open_dm_failed' };
    const r = await fetch(`${API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${CFG.discord.botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: String(content).slice(0, 1800) })
    });
    if (!r.ok) {
      dmChannel.delete(uid); // stale channel: force a reopen next time
      return { ok: false, error: `http_${r.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error).message).slice(0, 200) };
  }
}

/** Build the OAuth authorize URL. `identify` always; `guilds.join` when enabled. */
export function buildAuthorizeUrl(state: string, redirectUri: string, scopes: string[]): string {
  const p = new URLSearchParams({
    client_id: CFG.discord.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    state,
    prompt: 'none'
  });
  return `https://discord.com/oauth2/authorize?${p.toString()}`;
}

/** Exchange an authorization code for an access token. */
export async function exchangeCode(code: string, redirectUri: string): Promise<string | null> {
  const r = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CFG.discord.clientId,
      client_secret: CFG.discord.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    }).toString()
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { access_token?: string };
  return j.access_token ?? null;
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

export async function fetchUser(accessToken: string): Promise<DiscordUser | null> {
  const r = await fetch(`${API}/users/@me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) return null;
  return (await r.json()) as DiscordUser;
}

/** Silently add the user to the bot's guild so DMs can reach them. */
export async function guildsJoin(userId: string, accessToken: string): Promise<boolean> {
  if (!CFG.discord.guildId || !CFG.discord.botToken) return false;
  const r = await fetch(`${API}/guilds/${CFG.discord.guildId}/members/${userId}`, {
    method: 'PUT',
    headers: { Authorization: `Bot ${CFG.discord.botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: accessToken })
  });
  return r.status === 201 || r.status === 204; // created, or already a member
}

/** Discord avatar CDN URL (or null). */
export function avatarUrl(id: string, hash: string | null): string | null {
  return hash ? `https://cdn.discordapp.com/avatars/${id}/${hash}.png` : null;
}
