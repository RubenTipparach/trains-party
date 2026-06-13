/**
 * Test-only helper. A RoLA minor is started only by winning a launch auction, so
 * tests use this to launch one through an *unopposed* auction: the initiator
 * opens, every other player drops out, and the initiator launches the minor at
 * the opening bid. Adaptive picks an open home automatically unless one is given.
 */
import { apply, adaptiveHomes } from './index';
import { configFor } from './registry';
import type { GameState } from './types';

export function launchViaAuction(
  s: GameState,
  player: string,
  corp: string,
  bid = 120,
  home?: string
): GameState {
  s = apply(s, { type: 'initiate_auction', player, bid });
  for (const id of s.stock!.launchAuction!.order) {
    if (id !== player) s = apply(s, { type: 'pass', player: id });
  }
  const isAdaptive = configFor(s.title).minors?.find((m) => m.sym === corp)?.ability?.type === 'choose_home';
  const h = home ?? (isAdaptive ? adaptiveHomes(s)[0] : undefined);
  return apply(s, { type: 'launch', player, corp, ...(h ? { home: h } : {}) });
}
