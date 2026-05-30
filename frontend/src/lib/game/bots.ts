/**
 * 1889 bots. Pure heuristics: given a game state, return one legal action for the
 * active player (or null if there is nothing to do). See BOTS.md for the strategy.
 */

import {
  auctionActivePlayer,
  auctionView,
  maxBidFor,
  stockLegalActions,
  type GameAction,
  type GameState
} from '$lib/engine';
import { PAR_PRICES } from '$lib/data/g1889';

export type BotLevel = 'easy' | 'normal';

const FLOAT_RESERVE: Record<BotLevel, number> = { easy: 180, normal: 325 };
const OVERPAY: Record<BotLevel, number> = { easy: 0, normal: 25 };

function cashOf(s: GameState, id: string): number {
  return s.players.find((p) => p.id === id)?.cash ?? 0;
}

function botAuction(s: GameState, level: BotLevel): GameAction {
  const av = auctionView(s);
  const me = av.active;

  if (s.auction!.auctioning) {
    // The bot is the current low bidder in a sub-auction.
    const sym = s.auction!.auctioning;
    const c = av.companies.find((x) => x.sym === sym)!;
    const max = maxBidFor(s, me, sym);
    if (c.minBid <= max && c.minBid <= c.value + OVERPAY[level]) {
      return { type: 'bid', player: me, company: sym, price: c.minBid };
    }
    return { type: 'pass', player: me };
  }

  const cheapest = av.companies[0];
  const cash = cashOf(s, me);
  const onlyOneLeft = av.companies.length === 1;
  const fitsReserve = cheapest.minBid <= cash - FLOAT_RESERVE[level];
  if ((fitsReserve || (onlyOneLeft && cheapest.minBid <= cash)) && cheapest.minBid <= cash) {
    return { type: 'bid', player: me, company: cheapest.sym, price: cheapest.minBid };
  }
  return { type: 'pass', player: me };
}

function botStock(s: GameState, level: BotLevel): GameAction {
  const sl = stockLegalActions(s);
  const me = sl.player;
  const cash = cashOf(s, me);
  const myCorps = s.corporations.filter((c) => c.president === me);

  // 1. Drive an owned, un-floated corporation toward its float.
  for (const c of myCorps) {
    if (!c.floated && sl.buyIpo.includes(c.sym)) {
      return { type: 'buy', player: me, corp: c.sym, from: 'ipo' };
    }
  }

  // 2. Par a corporation if we run none and can afford to float one.
  if (myCorps.length === 0 && sl.par.length > 0) {
    const par = PAR_PRICES.filter((p) => 5 * p <= cash).sort((a, b) => b - a)[0];
    if (par && cash >= 2 * par) {
      return { type: 'par', player: me, corp: sl.par[0], price: par };
    }
  }

  // 3. Easy bots stop here; Normal bots pick up a cheap floated share if able.
  if (level === 'normal') {
    const pickIpo = sl.buyIpo.find((sym) => s.corporations.find((c) => c.sym === sym)!.floated);
    if (pickIpo) return { type: 'buy', player: me, corp: pickIpo, from: 'ipo' };
    if (sl.buyPool.length) return { type: 'buy', player: me, corp: sl.buyPool[0], from: 'pool' };
  }

  return { type: 'pass', player: me };
}

/** Choose a legal action for the active (bot) player, or null if none. */
export function botAction(s: GameState, level: BotLevel): GameAction | null {
  if (s.finished) return null;
  if (s.round === 'auction' && s.auction) {
    // guard: only act if we are actually the active player
    if (auctionActivePlayer(s) !== s.players[s.current].id && !s.auction.auctioning) return null;
    return botAuction(s, level);
  }
  if (s.round === 'stock' && s.stock) return botStock(s, level);
  return null; // operating round: Stage 3
}
