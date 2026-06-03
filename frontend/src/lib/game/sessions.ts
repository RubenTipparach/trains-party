/**
 * Local game sessions ("rooms"). Each room is a saved game keyed by a short
 * Crockford base32 code and lives at /<title>/room/<code>. This mirrors the High
 * Frontier room-routing doctrine (CLAUDE.md 3.4): the room lives in the URL so it
 * survives refreshes, reconnects, and deploy-time reloads.
 *
 * Storage is client-side for now (one entry per room in localStorage). The shape
 * is the action LOG plus its setup inputs, which is exactly what the server will
 * store when multiplayer sync lands, so this is the foundation for that, not a
 * throwaway.
 */
import type { GameAction } from '$lib/engine';
import type { SeatConfig } from './sandbox.svelte';

const PREFIX = 'tp.session.';
// Crockford base32, lowercase, minus i/l/o/u to avoid look-alikes.
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

export interface SavedSession {
  v: string;
  code: string;
  title: string;
  seed: number;
  mapMode: 'auto' | 'manual';
  seats: SeatConfig[];
  actions: GameAction[];
  /** Short human-readable round label cached for the lobby (e.g. "SR 2"). */
  status: string;
  createdAt: number;
  updatedAt: number;
}

/** Lobby row: a session without its (potentially large) action log. */
export type SessionMeta = Omit<SavedSession, 'actions'> & { moves: number };

export const normCode = (code: string) => code.toLowerCase().trim();

/** A fresh, locally-unique room code. */
export function newCode(len = 6): string {
  let code = '';
  for (let i = 0; i < len; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  if (typeof localStorage !== 'undefined' && localStorage.getItem(PREFIX + code)) return newCode(len);
  return code;
}

export function readSession(code: string): SavedSession | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(PREFIX + normCode(code));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SavedSession;
  } catch {
    return null;
  }
}

export function writeSession(s: SavedSession): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PREFIX + normCode(s.code), JSON.stringify(s));
  } catch {
    /* quota / private mode: ignore */
  }
}

export function deleteSession(code: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(PREFIX + normCode(code));
}

/** All saved rooms, most-recently-played first (action logs stripped). */
export function listSessions(): SessionMeta[] {
  if (typeof localStorage === 'undefined') return [];
  const out: SessionMeta[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    try {
      const s = JSON.parse(localStorage.getItem(key)!) as SavedSession;
      if (!s?.code) continue;
      const { actions, ...meta } = s;
      out.push({ ...meta, moves: actions?.length ?? 0 });
    } catch {
      /* skip corrupt entry */
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * One-time import of the previous single-save format (tp.<title>.sandbox) into a
 * room so existing games show up in the lobby. Safe to call repeatedly.
 */
export function migrateLegacySaves(): void {
  if (typeof localStorage === 'undefined') return;
  const legacy: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && /^tp\.[^.]+\.sandbox$/.test(key)) legacy.push(key);
  }
  for (const key of legacy) {
    try {
      const data = JSON.parse(localStorage.getItem(key)!);
      if (Array.isArray(data?.actions) && Array.isArray(data?.seats)) {
        const code = newCode();
        writeSession({
          v: data.v ?? '0',
          code,
          title: data.title ?? key.split('.')[1] ?? '1889',
          seed: data.seed ?? 1,
          mapMode: data.mapMode ?? 'auto',
          seats: data.seats,
          actions: data.actions,
          status: data.actions.length ? 'in progress' : 'new',
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      }
    } catch {
      /* ignore */
    }
    localStorage.removeItem(key);
  }
}
