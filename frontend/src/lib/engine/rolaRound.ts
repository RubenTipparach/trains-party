/**
 * Railways of the Lost Atlas stock round: launch a minor, buy or sell shares, or
 * pass. Mirrors the 1889 stock-round turn flow (sell any number, at most one
 * launch/buy, then pass to end the turn; a full lap of passes ends the round) but
 * uses the linear-ladder model (rolaStock.ts), 20%/10% minor/major share units,
 * the 60% hold cap and 50% pool cap, and no certificate limit.
 *
 * The competitive launch sub-auction and the 3-column minor matrix are later
 * refinements; for now any unlaunched minor is launchable by the active player.
 */

import { configFor, rolaAbility } from './registry';
import { hexesFor } from './board';
import { currentPrice } from './stock';
import { launchMinor, sellPriceMove, soldOutMove, MIN_LAUNCH_BID, BID_INCREMENT } from './rolaStock';
import { startOperatingRound } from './operating';
import {
  GameError,
  type CorporationState,
  type GameAction,
  type GameState,
  type LaunchAuctionState,
  type PlayerState
} from './types';

function corp(s: GameState, sym: string): CorporationState {
  const c = s.corporations.find((x) => x.sym === sym);
  if (!c) throw new GameError(`unknown corporation ${sym}`);
  return c;
}
function player(s: GameState, id: string): PlayerState {
  const p = s.players.find((x) => x.id === id);
  if (!p) throw new GameError(`unknown player ${id}`);
  return p;
}
const pname = (s: GameState, id: string) => s.players.find((p) => p.id === id)?.name ?? id;
const holds = (p: PlayerState, sym: string) => p.shares[sym] ?? 0;
const unitOf = (c: CorporationState) => c.shareUnit ?? 10;
const presCert = (c: CorporationState) => 2 * unitOf(c); // 40% minor / 20% major
const HOLD_CAP = 60;
const POOL_CAP = 50;

function topOther(s: GameState, id: string, sym: string): { id: string; pct: number } {
  let best = { id: '', pct: -1 };
  for (const p of s.players) if (p.id !== id && holds(p, sym) > best.pct) best = { id: p.id, pct: holds(p, sym) };
  return best;
}

/** A buyer who now out-holds the president takes the presidency. */
function maybeTakePresidency(s: GameState, c: CorporationState, buyerId: string): void {
  if (!c.president || c.president === buyerId) return;
  if (holds(player(s, buyerId), c.sym) > holds(player(s, c.president), c.sym)) {
    c.president = buyerId;
    s.log.push(`${pname(s, buyerId)} becomes president of ${c.sym}`);
  }
}

function advancePriority(s: GameState): void {
  s.priority = (s.current + 1) % s.players.length;
}
function endTurn(s: GameState): void {
  const st = s.stock!;
  s.current = (s.current + 1) % s.players.length;
  st.acted = false;
  st.bought = false;
}

/**
 * Hand the auction to the next eligible bidder clockwise from `from`, or declare
 * the high bidder the winner. A player who cannot afford the next legal bid
 * (highBid + increment) can't participate, so they are dropped out automatically
 * (rulebook: you must be able to pay to bid). The standing high bidder is never
 * asked to bid against themselves; when nobody else can act, they win.
 */
function advanceAuction(s: GameState, la: LaunchAuctionState, from: string): void {
  const need = la.highBid + BID_INCREMENT;
  const n = la.order.length;
  const start = la.order.indexOf(from);
  for (let k = 1; k <= n; k++) {
    const cand = la.order[(start + k) % n];
    if (la.passed.includes(cand) || cand === la.highBidder) continue;
    if (player(s, cand).cash < need) {
      la.passed.push(cand); // can't afford the next bid -> out of this auction
      s.log.push(`${pname(s, cand)} cannot afford to bid (${need}) and drops out`);
      continue;
    }
    la.turn = cand;
    return;
  }
  la.turn = null;
  la.winner = la.highBidder; // nobody else can bid: the high bidder takes it
}

/** Open a launch auction: the initiator sets the first bid; bidding then goes
 *  clockwise. This is the active player's whole turn (rulebook §7). */
function doInitiate(s: GameState, id: string, bid: number): void {
  const st = s.stock!;
  if (st.acted) throw new GameError('you have already acted this turn');
  if (availableMinors(s).length === 0) throw new GameError('no minor is available to launch');
  if (bid < MIN_LAUNCH_BID) throw new GameError(`opening bid must be at least ${MIN_LAUNCH_BID}`);
  if (bid % BID_INCREMENT !== 0) throw new GameError(`bid must be in increments of ${BID_INCREMENT}`);
  const p = player(s, id);
  if (p.cash < bid) throw new GameError(`${pname(s, id)} cannot afford the ${bid} bid`);

  const n = s.players.length;
  const startIdx = s.players.findIndex((pp) => pp.id === id);
  const order = Array.from({ length: n }, (_, k) => s.players[(startIdx + k) % n].id);
  const la: LaunchAuctionState = { initiator: id, order, passed: [], highBid: bid, highBidder: id, turn: null, winner: null };
  advanceAuction(s, la, id); // clockwise from the initiator, skipping who can't pay
  st.launchAuction = la;
  st.acted = true;
  st.passes = 0;
  s.log.push(`${pname(s, id)} starts a minor auction, opening at ${bid}`);
}

/** Resolve a won auction: the lone remaining bidder launches an available minor,
 *  paying the winning bid into its treasury. Turn passes clockwise from the
 *  initiator (rulebook §7). */
function doResolveLaunch(s: GameState, id: string, sym: string, home?: string): void {
  const st = s.stock!;
  const la = st.launchAuction!;
  if (la.winner !== id) throw new GameError('the auction is still bidding');
  const c = corp(s, sym);
  if (!availableMinors(s).includes(sym)) throw new GameError(`${sym} is not available to launch`);
  // Adaptive: chooses any empty basic-city home as it launches.
  if (rolaAbility(s.title, c, 'choose_home')) {
    if (!home || !adaptiveHomes(s).includes(home)) {
      throw new GameError(`${sym} must choose an empty basic-city home to launch`);
    }
    c.coordinates = home;
    s.log.push(`${sym} establishes its home at ${home}`);
  }
  launchMinor(s, c, id, la.highBid); // treasury = winning bid, 40% cert, price = 1/2 bid
  st.launchAuction = null;
  // Turn resumes with the player clockwise from the initiator.
  const initIdx = s.players.findIndex((pp) => pp.id === la.initiator);
  s.current = (initIdx + 1) % s.players.length;
  s.priority = s.current;
  st.acted = false;
  st.bought = false;
  st.passes = 0;
}

/** Apply a bid, pass, or launch within an open auction. */
function applyLaunchAuction(s: GameState, action: GameAction): void {
  const st = s.stock!;
  const la = st.launchAuction!;
  const actor = la.turn ?? la.winner;
  if (!('player' in action) || action.player !== actor) {
    throw new GameError(`it is ${pname(s, actor ?? '')}'s turn in the auction`);
  }
  switch (action.type) {
    case 'launch_bid': {
      if (la.turn !== action.player) throw new GameError('not your bid');
      if (action.bid <= la.highBid) throw new GameError(`bid must exceed ${la.highBid}`);
      if (action.bid % BID_INCREMENT !== 0) throw new GameError(`bid must be in increments of ${BID_INCREMENT}`);
      if (player(s, action.player).cash < action.bid) throw new GameError('cannot afford that bid');
      la.highBid = action.bid;
      la.highBidder = action.player;
      s.log.push(`${pname(s, action.player)} bids ${action.bid}`);
      advanceAuction(s, la, action.player);
      break;
    }
    case 'pass': {
      if (la.turn !== action.player) throw new GameError('not your turn to pass');
      la.passed.push(action.player);
      s.log.push(`${pname(s, action.player)} drops out of the auction`);
      advanceAuction(s, la, action.player);
      break;
    }
    case 'launch':
      doResolveLaunch(s, action.player, action.corp, action.home);
      break;
    default:
      throw new GameError('you must bid, pass, or launch in the auction');
  }
}

function doBuy(s: GameState, id: string, sym: string, from: 'ipo' | 'pool'): void {
  const st = s.stock!;
  if (st.bought) throw new GameError('only one launch/buy per turn');
  if (st.soldThisRound[id]?.includes(sym)) throw new GameError(`cannot buy ${sym}: you sold it this round`);
  const c = corp(s, sym);
  if (c.parPrice === null) throw new GameError(`${sym} has not launched`);
  const p = player(s, id);
  const unit = unitOf(c);
  // RoLA has no IPO: unsold shares ARE the treasury (partial cap). Both kinds
  // sell at the CURRENT price; a treasury share pays the company, a bank-pool
  // share pays the bank.
  const cost = currentPrice(s, c);
  if (from === 'ipo') {
    if (c.ipoShares < unit) throw new GameError(`no treasury shares of ${sym}`);
  } else {
    if (c.poolShares < unit) throw new GameError(`no pool shares of ${sym}`);
  }
  if (holds(p, sym) + unit > HOLD_CAP) throw new GameError(`hold limit (${HOLD_CAP}%) reached for ${sym}`);
  if (p.cash < cost) throw new GameError(`${id} cannot afford a share of ${sym} (${cost})`);

  if (from === 'ipo') c.ipoShares -= unit;
  else c.poolShares -= unit;
  p.shares[sym] = holds(p, sym) + unit;
  p.cash -= cost;
  if (from === 'ipo') c.cash += cost; // treasury share: the company gets the money
  else s.bank += cost;
  maybeTakePresidency(s, c, id);
  s.log.push(`${pname(s, id)} buys ${unit}% of ${sym} from ${from === 'ipo' ? 'the treasury' : 'the pool'} for ${cost}`);
  st.bought = true;
  st.acted = true;
  st.passes = 0;
  advancePriority(s);
}

/** Greatest number of shares of `sym` player `id` may sell to the pool now. */
export function maxRolaSell(s: GameState, id: string, sym: string): number {
  const c = corp(s, sym);
  const p = player(s, id);
  if (c.priceCol === null || !c.floated) return 0;
  if (!c.operated) return 0; // rulebook: cannot sell a company that has not operated
  const unit = unitOf(c);
  const have = holds(p, sym);
  const poolRoom = POOL_CAP - c.poolShares;
  let max = Math.min(Math.floor(have / unit), Math.floor(poolRoom / unit));
  if (max <= 0) return 0;
  if (c.president === id) {
    const top = topOther(s, id, sym);
    const minKeep = top.pct >= presCert(c) ? 0 : presCert(c);
    max = Math.min(max, Math.floor(Math.max(0, have - minKeep) / unit));
  }
  return max;
}

function doSell(s: GameState, id: string, sym: string, count: number): void {
  const st = s.stock!;
  if (count < 1) throw new GameError('must sell at least one share');
  if (count > maxRolaSell(s, id, sym)) throw new GameError(`cannot sell ${count} share(s) of ${sym}`);
  const c = corp(s, sym);
  const p = player(s, id);
  const unit = unitOf(c);
  const pct = count * unit;

  // Presidency: keep the president certificate unless a successor holds enough.
  if (c.president === id) {
    const remaining = holds(p, sym) - pct;
    const top = topOther(s, id, sym);
    if (remaining >= presCert(c)) {
      if (top.id && top.pct > remaining && top.pct >= presCert(c)) c.president = top.id;
    } else if (top.id && top.pct >= presCert(c)) {
      c.president = top.id;
    } else {
      throw new GameError('cannot sell the president certificate: no eligible successor');
    }
  }

  const proceeds = count * currentPrice(s, c);
  p.shares[sym] = holds(p, sym) - pct;
  c.poolShares += pct;
  p.cash += proceeds;
  s.bank -= proceeds;
  sellPriceMove(s, c); // one space down per sale (not per share)
  (st.soldThisRound[id] ??= []).push(sym);
  s.log.push(`${pname(s, id)} sells ${count} share(s) of ${sym} for ${proceeds}`);
  st.acted = true;
  st.passes = 0;
  advancePriority(s);
}

function endStockRound(s: GameState): void {
  for (const c of s.corporations) soldOutMove(s, c); // fully-held companies rise one
  s.stock = null;
  s.players.forEach((p) => (p.passed = false));
  s.log.push('Stock round complete');
  startOperatingRound(s);
}

export function applyRolaStock(s: GameState, action: GameAction): void {
  const st = s.stock;
  if (!st) throw new GameError('no stock round in progress');
  // A launch auction owns the turn until it resolves; route bids/passes/launch.
  if (st.launchAuction) {
    applyLaunchAuction(s, action);
    return;
  }
  const active = s.players[s.current].id;
  if (action.player !== active) throw new GameError(`it is ${active}'s turn, not ${action.player}`);

  switch (action.type) {
    case 'initiate_auction':
      doInitiate(s, action.player, action.bid);
      break;
    case 'launch':
      throw new GameError('a minor is launched by winning an auction, not directly');
    case 'buy':
      doBuy(s, action.player, action.corp, action.from);
      break;
    case 'sell':
      doSell(s, action.player, action.corp, action.count);
      break;
    case 'pass':
      if (st.acted) {
        s.log.push(`${pname(s, action.player)} ends their turn`);
        endTurn(s);
      } else {
        st.passes += 1;
        s.log.push(`${pname(s, action.player)} passes`);
        if (st.passes >= s.players.length) endStockRound(s);
        else endTurn(s);
      }
      break;
    default:
      throw new GameError(`unsupported RoLA stock action: ${(action as GameAction).type}`);
  }
}

export interface RolaStockLegal {
  player: string;
  canPass: boolean;
  /** Can open a launch auction now: own turn, not yet acted, a minor is free, afford the minimum. */
  canInitiate: boolean;
  /** Minimum opening / increment-floor bid (120). */
  minBid: number;
  /** Minors currently available to launch (bottom of each matrix column). */
  available: string[];
  buyIpo: string[];
  buyPool: string[];
  sell: string[];
  /** A live launch auction this player is involved in, with their legal moves. */
  auction: {
    initiator: string;
    highBid: number;
    highBidder: string;
    /** Smallest legal raise (highBid + 5). */
    minRaise: number;
    /** This player must bid or pass right now. */
    myTurn: boolean;
    /** This player is the lone survivor and must launch one of `available`. */
    iWon: boolean;
  } | null;
}

/**
 * Minors currently launchable: the bottom (first unlaunched) of each matrix
 * column. Without a matrix (e.g. an old save), every unlaunched minor qualifies.
 */
export function availableMinors(s: GameState): string[] {
  if (!s.minorMatrix) {
    return s.corporations.filter((c) => c.kind === 'minor' && c.parPrice === null).map((c) => c.sym);
  }
  const launched = new Set(s.corporations.filter((c) => c.parPrice !== null).map((c) => c.sym));
  const out: string[] = [];
  for (const col of s.minorMatrix) {
    const next = col.find((sym) => !launched.has(sym));
    if (next) out.push(next);
  }
  return out;
}

export function rolaStockLegalActions(s: GameState): RolaStockLegal {
  const st = s.stock;
  const la = st?.launchAuction ?? null;
  // The actor is the auction's current bidder/winner during an auction, else the
  // player whose stock turn it is.
  const id = (la ? (la.turn ?? la.winner) : null) ?? s.players[s.current].id;
  const empty: RolaStockLegal = {
    player: id, canPass: false, canInitiate: false, minBid: MIN_LAUNCH_BID,
    available: [], buyIpo: [], buyPool: [], sell: [], auction: null
  };
  if (!st) return empty;
  const p = player(s, id);
  const homesOpen = adaptiveHomes(s).length > 0;
  const available = availableMinors(s).filter((sym) => {
    const c = corp(s, sym);
    // Adaptive can only launch when an empty basic-city home exists for it.
    return !c.dissolved && !(rolaAbility(s.title, c, 'choose_home') && !homesOpen);
  });

  if (la) {
    // Mid-auction: the only legal moves are bid, pass, or (once won) launch.
    return {
      player: id, canPass: false, canInitiate: false, minBid: MIN_LAUNCH_BID, available,
      buyIpo: [], buyPool: [], sell: [],
      auction: {
        initiator: la.initiator,
        highBid: la.highBid,
        highBidder: la.highBidder,
        minRaise: la.highBid + BID_INCREMENT,
        myTurn: la.turn === id,
        iWon: la.winner === id
      }
    };
  }

  const buyIpo: string[] = [];
  const buyPool: string[] = [];
  const sell: string[] = [];
  for (const c of s.corporations) {
    if (c.dissolved) continue;
    const soldThisRound = st.soldThisRound[id]?.includes(c.sym) ?? false;
    if (!st.bought && !soldThisRound && c.parPrice !== null) {
      const unit = unitOf(c);
      if (c.ipoShares >= unit && holds(p, c.sym) + unit <= HOLD_CAP && p.cash >= currentPrice(s, c)) buyIpo.push(c.sym);
      if (c.poolShares >= unit && holds(p, c.sym) + unit <= HOLD_CAP && p.cash >= currentPrice(s, c)) buyPool.push(c.sym);
    }
    if (maxRolaSell(s, id, c.sym) > 0) sell.push(c.sym);
  }
  const canInitiate = !st.acted && available.length > 0 && p.cash >= MIN_LAUNCH_BID;
  return { player: id, canPass: true, canInitiate, minBid: MIN_LAUNCH_BID, available, buyIpo, buyPool, sell, auction: null };
}

/** Empty basic-city spots an Adaptive launch may choose as its home. */
export function adaptiveHomes(s: GameState): string[] {
  const hexes = hexesFor(s);
  const taken = new Set(s.corporations.filter((c) => !c.dissolved).map((c) => c.coordinates));
  return Object.entries(hexes)
    .filter(
      ([coord, h]) =>
        (h.cities?.length ?? 0) > 0 &&
        !h.label &&
        !taken.has(coord) &&
        !s.corporations.some((c) => c.tokenHexes.includes(coord))
    )
    .map(([coord]) => coord)
    .sort();
}
