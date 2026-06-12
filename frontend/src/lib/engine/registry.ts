/**
 * Title registry: maps a game title id to its static GameConfig. The engine reads
 * config by `state.title`, so the engine core stays title-agnostic - adding a game
 * is a new config object plus an entry here, with no changes to the reducers.
 */
import type { GameConfig } from '$lib/data/types';
import { config1889 } from '$lib/data/g1889';
import { configRola } from '$lib/data/grola';
import { GameError } from './types';

const CONFIGS: Record<string, GameConfig> = {
  [config1889.title]: config1889,
  [configRola.title]: configRola
};

/** The config for a title; throws if the title is unknown. */
export function configFor(title: string): GameConfig {
  const c = CONFIGS[title];
  if (!c) throw new GameError(`unknown game title: ${title}`);
  return c;
}

/** Currency symbol for a title's money displays ('' if the game uses none). */
export function currencyFor(title: string): string {
  return CONFIGS[title]?.currency ?? '';
}

/** Default title for a new game until the menu selects otherwise. */
export const DEFAULT_TITLE = config1889.title;

/** All registered title ids. */
export function gameTitles(): string[] {
  return Object.keys(CONFIGS);
}

/** RoLA: does this company carry the given minor ability? Minors carry their
 * own; majors inherit every ability of the minors they merged from. */
export function rolaAbility(
  title: string,
  c: { kind?: 'minor' | 'major'; sym: string; mergedFrom?: string[] },
  type: string
): { type: string; amount?: number } | null {
  const minors = configFor(title).minors;
  if (!minors || !c.kind) return null;
  const syms = c.kind === 'minor' ? [c.sym] : (c.mergedFrom ?? []);
  for (const sym of syms) {
    const ab = minors.find((m) => m.sym === sym)?.ability;
    if (ab && ab.type === type) return ab as { type: string; amount?: number };
  }
  return null;
}
