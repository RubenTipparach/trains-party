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

export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      code          TEXT PRIMARY KEY,
      rules_version TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS actions (
      room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
      seq       INTEGER NOT NULL,
      payload   TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (room_code, seq)
    );
  `);
}
