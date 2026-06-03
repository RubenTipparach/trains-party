/**
 * Player worth metrics, computed the way the reference engine does
 * (lib/engine/player.rb#value and lib/engine/game/base.rb#liquidity):
 *
 * - value     = cash + shares of started corporations at their current price
 *               + private company values.
 * - liquidity = cash + the maximum cash the player could raise by selling
 *               shares now: the largest dumpable bundle per corporation, keeping
 *               the 20% president certificate unless another holder (>=20%) can
 *               take over, and never overfilling the bank pool (<=50%).
 */

import { configFor } from './registry';
import type { CorporationState, GameState } from './types';

function priceOf(s: GameState, c: CorporationState): number | null {
  if (c.priceRow === null || c.priceCol === null) return null;
  return configFor(s.title).market[c.priceRow][c.priceCol].price;
}

export function playerValue(s: GameState, id: string): number {
  const p = s.players.find((x) => x.id === id);
  if (!p) return 0;
  let v = p.cash;
  for (const c of s.corporations) {
    const pct = p.shares[c.sym] ?? 0;
    const price = priceOf(s, c);
    if (pct > 0 && price !== null) v += (pct / 10) * price;
  }
  for (const sym of p.companies) {
    v += s.companies.find((c) => c.sym === sym)?.value ?? 0;
  }
  return Math.round(v);
}

export function playerLiquidity(s: GameState, id: string): number {
  const p = s.players.find((x) => x.id === id);
  if (!p) return 0;
  let v = p.cash;
  for (const c of s.corporations) {
    const pct = p.shares[c.sym] ?? 0;
    const price = priceOf(s, c);
    if (pct <= 0 || price === null) continue;
    const poolRoom = Math.max(0, 50 - c.poolShares);
    let maxPct = pct;
    if (c.president === id) {
      const successor = s.players.some((x) => x.id !== id && (x.shares[c.sym] ?? 0) >= 20);
      maxPct = successor ? pct : Math.max(0, pct - 20);
    }
    const sellPct = Math.min(maxPct, poolRoom);
    v += (sellPct / 10) * price;
  }
  return Math.round(v);
}
