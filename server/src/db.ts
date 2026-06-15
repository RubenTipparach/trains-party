import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * SQLite persistence. Single-machine, file-backed, stored on a Fly volume in
 * production (DATA_DIR=/data). We persist the per-game ACTION LOG, not snapshots:
 * game state is derived by replaying actions through the shared engine.
 */

const DATA_DIR = process.env.DATA_DIR ?? './data';
mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(join(DATA_DIR, 'trains.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/** Add a column if it is missing (no-op on a fresh schema). For evolving an
 *  already-deployed DB without a full migration framework. */
function addColumn(table: string, col: string, decl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${decl}`);
}

export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      code            TEXT PRIMARY KEY,
      title           TEXT NOT NULL DEFAULT '1889',
      rules_version   TEXT NOT NULL,
      seed            INTEGER NOT NULL DEFAULT 1,
      map_mode        TEXT NOT NULL DEFAULT 'auto',
      hostile_mergers INTEGER NOT NULL DEFAULT 0,
      local_routes    INTEGER NOT NULL DEFAULT 1,
      status          TEXT NOT NULL DEFAULT 'lobby',
      creator_discord_id TEXT,
      max_players     INTEGER NOT NULL DEFAULT 4,
      seq             INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS actions (
      room_code        TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
      seq              INTEGER NOT NULL,
      payload          TEXT NOT NULL,
      actor_discord_id TEXT,
      created_at       INTEGER NOT NULL,
      PRIMARY KEY (room_code, seq)
    );

    CREATE TABLE IF NOT EXISTS profiles (
      discord_id   TEXT PRIMARY KEY,
      username     TEXT NOT NULL,
      display_name TEXT,
      avatar       TEXT,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      discord_id TEXT NOT NULL REFERENCES profiles(discord_id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_state (
      state      TEXT PRIMARY KEY,
      kind       TEXT NOT NULL,
      redirect   TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_seats (
      room_code  TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
      seat_id    TEXT NOT NULL,
      discord_id TEXT,
      name       TEXT NOT NULL,
      bot        INTEGER NOT NULL DEFAULT 0,
      level      TEXT NOT NULL DEFAULT 'normal',
      joined_at  INTEGER NOT NULL,
      PRIMARY KEY (room_code, seat_id)
    );

    CREATE TABLE IF NOT EXISTS chat (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      room_code  TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
      discord_id TEXT,
      name       TEXT NOT NULL,
      body       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invites (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      room_code          TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
      inviter_discord_id TEXT NOT NULL,
      invitee_discord_id TEXT NOT NULL,
      created_at         INTEGER NOT NULL,
      accepted           INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS notify_prefs (
      discord_id     TEXT PRIMARY KEY,
      notify_turn    INTEGER NOT NULL DEFAULT 1,
      notify_auction INTEGER NOT NULL DEFAULT 1,
      updated_at     INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS server_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      discord_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);

  // Evolve an older rooms/actions schema (Stage 0 shipped a minimal one).
  addColumn('rooms', 'title', "title TEXT NOT NULL DEFAULT '1889'");
  addColumn('rooms', 'seed', 'seed INTEGER NOT NULL DEFAULT 1');
  addColumn('rooms', 'map_mode', "map_mode TEXT NOT NULL DEFAULT 'auto'");
  addColumn('rooms', 'hostile_mergers', 'hostile_mergers INTEGER NOT NULL DEFAULT 0');
  addColumn('rooms', 'local_routes', 'local_routes INTEGER NOT NULL DEFAULT 1');
  addColumn('rooms', 'status', "status TEXT NOT NULL DEFAULT 'lobby'");
  addColumn('rooms', 'creator_discord_id', 'creator_discord_id TEXT');
  addColumn('rooms', 'max_players', 'max_players INTEGER NOT NULL DEFAULT 4');
  addColumn('rooms', 'seq', 'seq INTEGER NOT NULL DEFAULT 0');
  addColumn('rooms', 'updated_at', 'updated_at INTEGER NOT NULL DEFAULT 0');
  addColumn('actions', 'actor_discord_id', 'actor_discord_id TEXT');
}

/** A server-wide setting (announcement banner, admin allowlist, ...). */
export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM server_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO server_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, Date.now());
}
