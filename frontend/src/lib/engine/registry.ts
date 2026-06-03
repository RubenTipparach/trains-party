/**
 * Title registry: maps a game title id to its static GameConfig. The engine reads
 * config by `state.title`, so the engine core stays title-agnostic - adding a game
 * is a new config object plus an entry here, with no changes to the reducers.
 */
import type { GameConfig } from '$lib/data/types';
import { config1889 } from '$lib/data/g1889';
import { GameError } from './types';

const CONFIGS: Record<string, GameConfig> = {
  [config1889.title]: config1889
};

/** The config for a title; throws if the title is unknown. */
export function configFor(title: string): GameConfig {
  const c = CONFIGS[title];
  if (!c) throw new GameError(`unknown game title: ${title}`);
  return c;
}

/** Default title for a new game until the menu selects otherwise. */
export const DEFAULT_TITLE = config1889.title;

/** All registered title ids. */
export function gameTitles(): string[] {
  return Object.keys(CONFIGS);
}
