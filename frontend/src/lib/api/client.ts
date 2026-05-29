/**
 * REST client for the authoritative server.
 *
 * Doctrine (see CLAUDE.md): REST is authoritative; WebSocket (added later) is a
 * best-effort accelerator only. Clients poll and cache the latest snapshot, and
 * use sequence gating so a polling tick never stomps in-progress local UI.
 *
 * Stage 0: minimal stubs. Polling loop, snapshot/diff applier, and room routing
 * arrive with the multiplayer stage.
 */

import type { GameAction, Sequence } from '$lib/engine';

/** Base URL of the Fly.io API. Configure per environment in a later stage. */
export const API_BASE = '';

export interface Snapshot {
  code: string;
  sequence: Sequence;
  state: unknown;
}

export async function createRoom(): Promise<{ code: string }> {
  throw new Error('api.createRoom not implemented yet (Stage 4)');
}

export async function fetchState(_code: string, _since: Sequence): Promise<Snapshot | null> {
  throw new Error('api.fetchState not implemented yet (Stage 4)');
}

export async function submitAction(_code: string, _action: GameAction): Promise<Snapshot> {
  throw new Error('api.submitAction not implemented yet (Stage 4)');
}
