/**
 * Private-company waterfall auction (1889 initial sale round).
 *
 * Ported from the reference engine (lib/engine/step/waterfall_auction.rb):
 * - On your turn you may buy the cheapest unsold company at face, place a bid on
 *   a more expensive one, or pass.
 * - Buying the cheapest resolves the chain: each following company with exactly
 *   one standing bid is sold to that bidder; the first with multiple bids goes to
 *   a sub-auction among its bidders (lowest current bid acts next).
 * - When every player passes consecutively while the originally-cheapest company
 *   is still unsold, its minimum bid drops by 5 (becoming free, and forced, at 0).
 *   Once the originally-cheapest is sold, an all-pass ends the auction.
 *
 * Functions mutate the passed-in (already-cloned) state.
 */

import {
  GameError,
  MIN_BID_INCREMENT as INC,
  type AuctionState,
  type Bid,
  type CompanyState,
  type GameAction,
  type GameState
} from './types';

function company(s: GameState, sym: string): CompanyState {
  const c = s.companies.find((x) => x.sym === sym);
  if (!c) throw new GameError(`unknown company ${sym}`);
  return c;
}

function pname(s: GameState, id: string): string {
  return s.players.find((p) => p.id === id)?.name ?? id;
}

function minBidValue(s: GameState, sym: string): number {
  const c = company(s, sym);
  return c.value - c.discount;
}

function highestBid(a: AuctionState, sym: string): Bid | undefined {
  const b = a.bids[sym];
  return b && b.length ? b.reduce((m, x) => (x.price > m.price ? x : m)) : undefined;
}

function mayPurchase(a: AuctionState, sym: string): boolean {
  return a.auctioning === null && a.available[0] === sym;
}

/** Minimum legal bid for a company in the current state. */
export function minBid(s: GameState, sym: string): number {
  const a = s.auction!;
  if (mayPurchase(a, sym)) return minBidValue(s, sym);
  const h = highestBid(a, sym);
  return (h ? h.price : minBidValue(s, sym)) + INC;
}

function committed(s: GameState, player: string): number {
  const a = s.auction!;
  let total = 0;
  for (const sym of Object.keys(a.bids)) {
    const b = a.bids[sym].find((x) => x.player === player);
    if (b) total += b.price;
  }
  return total;
}

function currentBidOn(a: AuctionState, player: string, sym: string): number {
  return a.bids[sym]?.find((x) => x.player === player)?.price ?? 0;
}

function maxBid(s: GameState, player: string, sym: string): number {
  const p = s.players.find((x) => x.id === player)!;
  return p.cash - committed(s, player) + currentBidOn(s.auction!, player, sym);
}

/** The player who must act next in the auction. */
export function auctionActivePlayer(s: GameState): string {
  const a = s.auction!;
  if (a.auctioning) {
    return a.bids[a.auctioning].reduce((m, x) => (x.price < m.price ? x : m)).player;
  }
  return s.players[s.current].id;
}

function advance(s: GameState): void {
  if (s.round !== 'auction') return;
  s.current = (s.current + 1) % s.players.length;
}

function addBid(s: GameState, sym: string, player: string, price: number): void {
  const a = s.auction!;
  const min = minBid(s, sym);
  if (price < min) throw new GameError(`minimum bid for ${sym} is ${min}`);
  if ((price - min) % INC !== 0) throw new GameError(`bids must be in increments of ${INC}`);
  if (price > maxBid(s, player, sym)) throw new GameError(`${player} cannot afford a bid of ${price}`);
  a.bids[sym] = (a.bids[sym] ?? []).filter((b) => b.player !== player);
  a.bids[sym].push({ player, price });
  s.log.push(`${pname(s, player)} bids ${price} for ${sym}`);
}

function buyCompany(s: GameState, player: string, sym: string, price: number): void {
  const a = s.auction!;
  if (price > maxBid(s, player, sym)) throw new GameError(`${player} cannot afford ${sym} at ${price}`);
  const p = s.players.find((x) => x.id === player)!;
  const c = company(s, sym);
  c.owner = player;
  p.companies.push(sym);
  if (price > 0) {
    p.cash -= price;
    s.bank += price;
  }
  a.available = a.available.filter((x) => x !== sym);
  delete a.bids[sym];
  s.log.push(`${pname(s, player)} buys ${sym} for ${price}`);
  if (a.available.length === 0) endAuction(s);
}

/** Resolve the chain of standing bids from the cheapest company upward. */
function resolveBids(s: GameState): void {
  while (s.round === 'auction' && s.auction!.available.length) {
    const a = s.auction!;
    const sym = a.available[0];
    const bids = a.bids[sym] ?? [];
    if (bids.length === 1) {
      a.auctioning = null;
      buyCompany(s, bids[0].player, sym, bids[0].price);
    } else if (bids.length > 1) {
      a.auctioning = sym;
      s.log.push(`${sym} goes up for auction`);
      break;
    } else {
      break;
    }
  }
}

function allPassed(s: GameState): void {
  const a = s.auction!;
  if (a.available.includes(a.cheapest)) {
    const c = company(s, a.cheapest);
    c.discount += INC;
    s.players.forEach((p) => (p.passed = false));
    s.log.push(`All players pass; ${a.cheapest} minimum bid drops to ${minBidValue(s, a.cheapest)}`);
    if (minBidValue(s, a.cheapest) <= 0) {
      advance(s); // the next player is forced to take it for free
      buyCompany(s, s.players[s.current].id, a.cheapest, 0);
      resolveBids(s);
    } else {
      advance(s);
    }
  } else {
    // Originally-cheapest already sold: the auction ends.
    endAuction(s);
  }
}

function endAuction(s: GameState): void {
  s.round = 'stock';
  s.auction = null;
  s.stock = { acted: false, bought: false, passes: 0 };
  s.current = s.priority;
  s.players.forEach((p) => (p.passed = false));
  s.log.push('Initial auction complete; stock round begins');
}

export function applyAuction(s: GameState, action: GameAction): void {
  const a = s.auction;
  if (!a) throw new GameError('no auction in progress');
  const active = auctionActivePlayer(s);
  if (action.player !== active) throw new GameError(`it is ${active}'s turn, not ${action.player}`);

  if (action.type === 'bid') {
    const p = s.players.find((x) => x.id === action.player)!;
    p.passed = false;
    if (a.auctioning) {
      if (action.company !== a.auctioning) throw new GameError(`must bid on ${a.auctioning}`);
      addBid(s, a.auctioning, action.player, action.price);
    } else if (mayPurchase(a, action.company)) {
      if (action.price < minBid(s, action.company)) {
        throw new GameError(`minimum price for ${action.company} is ${minBid(s, action.company)}`);
      }
      buyCompany(s, action.player, action.company, action.price);
      resolveBids(s);
      advance(s);
    } else {
      if (!a.available.includes(action.company)) throw new GameError(`${action.company} is not available`);
      addBid(s, action.company, action.player, action.price);
      advance(s);
    }
  } else if (action.type === 'pass') {
    if (a.auctioning) {
      a.bids[a.auctioning] = a.bids[a.auctioning].filter((b) => b.player !== action.player);
      s.log.push(`${pname(s, action.player)} passes on ${a.auctioning}`);
      a.auctioning = null;
      resolveBids(s);
    } else {
      const p = s.players.find((x) => x.id === action.player)!;
      p.passed = true;
      s.log.push(`${pname(s, action.player)} passes`);
      if (s.players.every((x) => x.passed)) allPassed(s);
      else advance(s);
    }
  } else {
    throw new GameError(`unsupported auction action`);
  }
}

export interface AuctionBidView {
  player: string;
  price: number;
}
export interface AuctionCompanyView {
  sym: string;
  value: number;
  revenue: number;
  discount: number;
  minBid: number;
  buyable: boolean;
  inAuction: boolean;
  bids: AuctionBidView[];
}
export interface AuctionPlayerView {
  id: string;
  name: string;
  cash: number;
  committed: number;
  available: number;
}
export interface AuctionView {
  active: string;
  auctioning: string | null;
  companies: AuctionCompanyView[];
  players: AuctionPlayerView[];
}

/** Structured, display-ready snapshot of the auction (bids, committed cash, etc.). */
export function auctionView(s: GameState): AuctionView {
  const a = s.auction!;
  const players = s.players.map((p) => {
    const com = committed(s, p.id);
    return { id: p.id, name: p.name, cash: p.cash, committed: com, available: p.cash - com };
  });
  const companies = a.available.map((sym) => {
    const c = company(s, sym);
    return {
      sym,
      value: c.value,
      revenue: c.revenue,
      discount: c.discount,
      minBid: minBid(s, sym),
      buyable: mayPurchase(a, sym),
      inAuction: a.auctioning === sym,
      bids: (a.bids[sym] ?? []).map((b) => ({ player: b.player, price: b.price }))
    };
  });
  return { active: auctionActivePlayer(s), auctioning: a.auctioning, companies, players };
}

/** Max a player could bid on a company (cash minus other commitments). */
export function maxBidFor(s: GameState, player: string, sym: string): number {
  return maxBid(s, player, sym);
}
