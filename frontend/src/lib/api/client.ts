/**
 * REST client for the authoritative server (Fly.io). The base URL is injected at
 * build time via PUBLIC_API_BASE; when it is unset the app stays fully local
 * (sandbox only) and the online lobby hides itself.
 *
 * Auth is a server-minted bearer token kept in localStorage (adopted by the
 * /auth route after Discord sign-in). Every call attaches it when present.
 */

import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import type { GameAction } from '$lib/engine';

/**
 * Where the API lives. An explicit PUBLIC_API_BASE wins (override / preview
 * builds); otherwise it is derived at runtime like the High Frontier client:
 * localhost in dev, else the known Fly app URL. So a normal GitHub Pages build
 * needs no build-time env var.
 */
function resolveBase(): string {
  const explicit = (env.PUBLIC_API_BASE ?? '').trim();
  if (explicit) return explicit;
  if (!browser) return '';
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:8080';
  return 'https://trains-party.fly.dev'; // app name in server/fly.toml
}

export const API_BASE = resolveBase().replace(/\/$/, '');
export const apiConfigured = () => !!API_BASE;

const TOKEN_KEY = 'tp.session.token';
export const getToken = (): string | null => (browser ? localStorage.getItem(TOKEN_KEY) : null);
export function setToken(t: string | null): void {
  if (!browser) return;
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export interface ApiError extends Error {
  status: number;
  data: unknown;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(API_BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (r.status === 401) setToken(null);
  const data = (await r.json().catch(() => null)) as unknown;
  if (!r.ok) {
    const err = new Error((data as { error?: string })?.error ?? `http_${r.status}`) as ApiError;
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data as T;
}

// --- types -----------------------------------------------------------------

export interface Profile {
  discordId: string;
  name: string;
  avatar: string | null;
  notify: { notifyTurn: boolean; notifyAuction: boolean };
}
export interface SeatView {
  seatId: string;
  name: string;
  bot: boolean;
  level: string;
  discordId: string | null;
  taken: boolean;
}
export interface RoomView {
  code: string;
  title: string;
  status: string;
  seq: number;
  label: string;
  finished: boolean;
  activePlayer: string | null;
  seats: SeatView[];
  options: { seed: number; mapMode: string; hostileMergers: boolean; localRoutes: boolean };
  maxPlayers: number;
  creatorDiscordId: string | null;
  updatedAt: number;
}
export interface ChatMsg {
  id: number;
  discordId: string | null;
  name: string;
  body: string;
  at: number;
}
export interface StateResp {
  code: string;
  seq: number;
  upToDate?: boolean;
  state?: unknown;
  room?: RoomView;
}

export interface CreateOpts {
  title: string;
  seed?: number;
  mapMode?: 'auto' | 'manual';
  hostileMergers?: boolean;
  localRoutes?: boolean;
  seats?: { id: string; name: string; bot: boolean; level?: string }[];
}

// --- auth / identity -------------------------------------------------------

export const authEnabled = () =>
  call<{ signIn: boolean; autoJoin: boolean; anon: boolean }>('GET', '/auth/discord/enabled');
export const me = () => call<Profile>('GET', '/me');
/** Guest sign-in (no Discord): returns a token + profile. */
export const anonLogin = (name: string) => call<{ token: string; profile: Profile }>('POST', '/auth/anon', { name });
export const logout = () => call<{ ok: boolean }>('POST', '/auth/logout');
export const setNotify = (p: { notifyTurn?: boolean; notifyAuction?: boolean }) =>
  call<Profile['notify']>('PUT', '/me/notify', p);
export const testNotify = () => call<{ ok: boolean; error?: string }>('POST', '/me/notify/test');

/** Full URL the user opens to sign in (the server redirects back to `redirect`). */
export const loginUrl = (redirect: string) =>
  `${API_BASE}/auth/discord/login?redirect=${encodeURIComponent(redirect)}`;

// --- lobby / rooms ---------------------------------------------------------

export const getAnnouncement = () => call<{ message: string; updatedAt: number }>('GET', '/announcement');
export const listOpenRooms = () => call<RoomView[]>('GET', '/rooms');
export const listLiveRooms = () => call<RoomView[]>('GET', '/rooms/live');
export const listMyRooms = () => call<RoomView[]>('GET', '/me/rooms');
export const getRoom = (code: string) => call<RoomView>('GET', `/rooms/${code}`);
export const createRoom = (opts: CreateOpts) => call<RoomView>('POST', '/rooms', opts);
export const claimSeat = (code: string, seatId: string) =>
  call<RoomView>('POST', `/rooms/${code}/seats/${seatId}/claim`);
export const releaseSeat = (code: string, seatId: string) =>
  call<RoomView>('POST', `/rooms/${code}/seats/${seatId}/release`);
export const seatBot = (code: string, seatId: string) =>
  call<RoomView>('POST', `/rooms/${code}/seats/${seatId}/bot`);
export const openSeat = (code: string, seatId: string) =>
  call<RoomView>('POST', `/rooms/${code}/seats/${seatId}/open`);
export const startRoom = (code: string) => call<StateResp>('POST', `/rooms/${code}/start`);
export const fetchState = (code: string, since = -1) =>
  call<StateResp>('GET', `/rooms/${code}/state?since=${since}`);
/** The action-log delta after `since` (so a client can replay incrementally). */
export const fetchActions = (code: string, since = 0) =>
  call<{ code: string; seq: number; actions: GameAction[] }>('GET', `/rooms/${code}/actions?since=${since}`);
export const submitAction = (code: string, action: GameAction) =>
  call<StateResp>('POST', `/rooms/${code}/actions`, { action });
export const updateOptions = (
  code: string,
  opts: { seed?: number; mapMode?: 'auto' | 'manual'; hostileMergers?: boolean; localRoutes?: boolean }
) => call<RoomView>('POST', `/rooms/${code}/options`, opts);
export const invite = (code: string, discordId: string) =>
  call<{ ok: boolean; dm: { ok: boolean; error?: string } }>('POST', `/rooms/${code}/invite`, { discordId });

// --- chat ------------------------------------------------------------------

export const roomChat = (code: string, since = 0) => call<ChatMsg[]>('GET', `/rooms/${code}/chat?since=${since}`);
export const postRoomChat = (code: string, body: string) => call<ChatMsg>('POST', `/rooms/${code}/chat`, { body });
export const lobbyChat = (since = 0) => call<ChatMsg[]>('GET', `/lobby/chat?since=${since}`);
export const postLobbyChat = (body: string) => call<ChatMsg>('POST', '/lobby/chat', { body });
