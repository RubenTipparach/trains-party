/**
 * Board-hex access. The engine reads hexes through here so a RoLA game can use a
 * procedurally-built runtime map (`state.map`) while 1889 (and an un-generated
 * RoLA game) falls back to the static config map.
 */
import { configFor } from './registry';
import type { GameState } from './types';
import type { HexDef } from '$lib/data/types';

/** The active hex map: the runtime map if one was built, else the config's. */
export function hexesFor(s: GameState): Record<string, HexDef> {
  return s.map ?? configFor(s.title).hexByCoord;
}
