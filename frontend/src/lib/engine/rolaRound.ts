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

import { configFor } from './registry';
import { currentPrice } from './stock';
import { launchMinor, sellPriceMove, soldOutMove, parForBid, MIN_LAUNCH_BID } from './rolaStock';
import { startOperatingRound } from './operating';
import { GameError, type CorporationState, type GameAction, type GameState, type PlayerState } from './types';

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

function doLaunch(s: GameState, id: string, sym: string, bid: number): void {
  const st = s.stock!;
  if (st.bought) throw new GameError('only one launch/buy per turn');
  const c = corp(s, sym);
  launchMinor(s, c, id, bid); // validates kind/bid/affordability, derives par, sets treasury + 40% cert
  st.bought = true;
  st.acted = true;
  st.passes = 0;
  advancePriority(s);
}

function doBuy(s: GameState, id: string, sym: string, from: 'ipo' | 'pool'): void {
  const st = s.stock!;
  if (st.bought) throw new GameError('only one launch/buy per turn');
  if (st.soldThisRound[id]?.includes(sym)) throw new GameError(`cannot buy ${sym}: you sold it this round`);
  const c = corp(s, sym);
  if (c.parPrice === null) throw new GameError(`${sym} has not launched`);
  const p = player(s, id);
  const unit = unitOf(c);
  let cost: number;
  if (from === 'ipo') {
    if (c.ipoShares < unit) throw new GameError(`no IPO shares of ${sym}`);
    cost = c.parPrice;
  } else {
    if (c.poolShares < unit) throw new GameError(`no pool shares of ${sym}`);
    cost = currentPrice(s, c);
  }
  if (holds(p, sym) + unit > HOLD_CAP) throw new GameError(`hold limit (${HOLD_CAP}%) reached for ${sym}`);
  if (p.cash < cost) throw new GameError(`${id} cannot afford a share of ${sym} (${cost})`);

  if (from === 'ipo') c.ipoShares -= unit;
  else c.poolShares -= unit;
  p.shares[sym] = holds(p, sym) + unit;
  p.cash -= cost;
  s.bank += cost;
  maybeTakePresidency(s, c, id);
  s.log.push(`${pname(s, id)} buys ${unit}% of ${sym} from ${from} for ${cost}`);
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
  const active = s.players[s.current].id;
  if (action.player !== active) throw new GameError(`it is ${active}'s turn, not ${action.player}`);

  switch (action.type) {
    case 'launch':
      doLaunch(s, action.player, action.corp, action.bid);
      break;
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
  /** Unlaunched minors the player can launch (bid >= minBid; price is derived). */
  launch: { corp: string; minBid: number; par: number }[];
  buyIpo: string[];
  buyPool: string[];
  sell: string[];
}

export function rolaStockLegalActions(s: GameState): RolaStockLegal {
  const id = s.players[s.current].id;
  const st = s.stock;
  const empty: RolaStockLegal = { player: id, canPass: false, launch: [], buyIpo: [], buyPool: [], sell: [] };
  if (!st) return empty;
  const p = player(s, id);
  const launch: { corp: string; minBid: number; par: number }[] = [];
  const buyIpo: string[] = [];
  const buyPool: string[] = [];
  const sell: string[] = [];

  for (const c of s.corporations) {
    if (c.dissolved) continue;
    const soldThisRound = st.soldThisRound[id]?.includes(c.sym) ?? false;
    if (!st.bought && !soldThisRound) {
      if (c.kind === 'minor' && c.parPrice === null) {
        if (p.cash >= MIN_LAUNCH_BID) {
          launch.push({ corp: c.sym, minBid: MIN_LAUNCH_BID, par: parForBid(s, MIN_LAUNCH_BID) });
        }
      } else if (c.parPrice !== null) {
        const unit = unitOf(c);
        if (c.ipoShares >= unit && holds(p, c.sym) + unit <= HOLD_CAP && p.cash >= (c.parPrice ?? 0)) buyIpo.push(c.sym);
        if (c.poolShares >= unit && holds(p, c.sym) + unit <= HOLD_CAP && p.cash >= currentPrice(s, c)) buyPool.push(c.sym);
      }
    }
    if (maxRolaSell(s, id, c.sym) > 0) sell.push(c.sym);
  }
  return { player: id, canPass: true, launch, buyIpo, buyPool, sell };
}
