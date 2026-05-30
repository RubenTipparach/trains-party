/**
 * Stock round (1889).
 *
 * On their turn a player may sell any number of shares (each sale drops the
 * price), then make at most one purchase - par (start) a corporation by buying
 * its 20% president's certificate, or buy a single 10% share from the IPO (at
 * par) or the bank pool (at the current price) - or pass. A pure pass by every
 * player in a row ends the round.
 *
 * Simplifications noted inline (presidency cert-swap, some zone edge rules) will
 * be refined alongside the operating round.
 */

import { MARKET, PAR_PRICES, CERT_LIMIT } from '$lib/data/g1889';
import {
  GameError,
  type CorporationState,
  type GameAction,
  type GameState,
  type PlayerState
} from './types';
import { startOperatingRound } from './operating';

const PAR_COL = 3; // par cells live in market column 3 (rows 0..5)

function corp(s: GameState, sym: string): CorporationState {
  const c = s.corporations.find((x) => x.sym === sym);
  if (!c) throw new GameError(`unknown corporation ${sym}`);
  return c;
}
function player(s: GameState, id: string): PlayerState {
  return s.players.find((p) => p.id === id)!;
}
function pname(s: GameState, id: string): string {
  return s.players.find((p) => p.id === id)?.name ?? id;
}

function cellExists(row: number, col: number): boolean {
  return !!MARKET[row] && col < MARKET[row].length;
}
function currentPrice(c: CorporationState): number {
  if (c.priceRow === null || c.priceCol === null) return c.parPrice ?? 0;
  return MARKET[c.priceRow][c.priceCol].price;
}
function corpZone(c: CorporationState): string {
  if (c.priceRow === null || c.priceCol === null) return 'white';
  return MARKET[c.priceRow][c.priceCol].zone;
}
function moveDown(c: CorporationState): void {
  if (c.priceRow === null || c.priceCol === null) return;
  if (cellExists(c.priceRow + 1, c.priceCol)) c.priceRow += 1;
}
function moveUp(c: CorporationState): void {
  if (c.priceRow === null || c.priceCol === null) return;
  if (c.priceRow > 0) c.priceRow -= 1;
}

function holds(p: PlayerState, sym: string): number {
  return p.shares[sym] ?? 0;
}

/** Certificates a player holds (president cert = 1; yellow-zone shares ignored). */
function certCount(s: GameState, id: string): number {
  const p = player(s, id);
  let n = 0;
  for (const c of s.corporations) {
    const pct = holds(p, c.sym);
    if (pct <= 0) continue;
    if (corpZone(c) === 'yellow') continue; // shares do not count toward the limit
    const isPres = c.president === id;
    n += (pct - (isPres ? 20 : 0)) / 10 + (isPres ? 1 : 0);
  }
  return n;
}
function certLimit(s: GameState): number {
  return CERT_LIMIT[s.players.length];
}
function holdLimitOk(c: CorporationState, p: PlayerState, addPct: number): boolean {
  if (corpZone(c) === 'orange') return true; // may hold above 60%
  return holds(p, c.sym) + addPct <= 60;
}

/** Largest holding of `sym` among players other than `id`. */
function topOtherPct(s: GameState, id: string, sym: string): number {
  let m = 0;
  for (const x of s.players) if (x.id !== id) m = Math.max(m, holds(x, sym));
  return m;
}

/**
 * Can `id` sell at least one share of `sym`? Per 1889/18xx:
 * - the corporation must have a share price (have operated/floated context),
 * - the player must hold at least 10%,
 * - the pool may not exceed 50% (so there must be room for the shares),
 * - the president may sell their regular shares, but may only give up the 20%
 *   president certificate (drop below 20%) if another player holds at least 20%
 *   to take over the presidency.
 */
function canSell(s: GameState, id: string, sym: string): boolean {
  const c = corp(s, sym);
  const p = player(s, id);
  if (c.priceRow === null) return false;
  const have = holds(p, sym);
  if (have < 10) return false;
  if (c.poolShares >= 50) return false; // no room in the pool
  if (c.president === id) {
    // regular (non-president-cert) shares are freely sellable
    if (have - 20 >= 10) return true;
    // otherwise selling means giving up the cert: need a >=20% successor
    return topOtherPct(s, id, sym) >= 20;
  }
  return true;
}

function endTurn(s: GameState, acted: boolean): void {
  const st = s.stock!;
  if (acted) {
    s.priority = (s.current + 1) % s.players.length;
    st.passes = 0; // any purchase breaks the consecutive-pass streak
  }
  s.current = (s.current + 1) % s.players.length;
  st.acted = false;
  st.bought = false;
  st.soldThisTurn = [];
}

function endStockRound(s: GameState): void {
  // Sold-out corporations (no shares in the pool) move up one at round end.
  for (const c of s.corporations) {
    if (c.floated && c.poolShares === 0 && c.priceRow !== null) moveUp(c);
  }
  s.stock = null;
  s.players.forEach((p) => (p.passed = false));
  s.log.push('Stock round complete');
  startOperatingRound(s);
}

function maybeFloat(s: GameState, c: CorporationState): void {
  if (c.floated) return;
  const soldFromIpo = 100 - c.ipoShares;
  if (soldFromIpo >= 50) {
    c.floated = true;
    c.cash = 10 * (c.parPrice ?? 0); // full capitalization
    if (c.tokenHexes.length === 0) c.tokenHexes.push(c.coordinates); // place the home token
    s.log.push(`${c.sym} floats; treasury ${c.cash}`);
  }
}

function doPar(s: GameState, id: string, sym: string, price: number): void {
  const st = s.stock!;
  if (st.bought) throw new GameError('only one purchase per turn');
  const c = corp(s, sym);
  if (c.parPrice !== null) throw new GameError(`${sym} has already started`);
  const row = PAR_PRICES.indexOf(price);
  if (row < 0) throw new GameError(`invalid par price ${price}`);
  const p = player(s, id);
  const cost = 2 * price;
  if (p.cash < cost) throw new GameError(`${id} cannot afford to par ${sym} (${cost})`);
  if (certCount(s, id) + 1 > certLimit(s)) throw new GameError('certificate limit reached');

  c.parPrice = price;
  c.priceRow = row;
  c.priceCol = PAR_COL;
  c.ipoShares -= 20;
  c.president = id;
  p.shares[sym] = holds(p, sym) + 20;
  p.cash -= cost;
  s.bank += cost;
  s.log.push(`${pname(s, id)} pars ${sym} at ${price} and becomes president`);

  st.bought = true;
  endTurn(s, true);
}

function doBuy(s: GameState, id: string, sym: string, from: 'ipo' | 'pool'): void {
  const st = s.stock!;
  if (st.bought) throw new GameError('only one purchase per turn');
  if (st.soldThisTurn.includes(sym)) throw new GameError(`cannot buy ${sym}: you sold it this turn`);
  const c = corp(s, sym);
  const p = player(s, id);
  if (c.parPrice === null) throw new GameError(`${sym} has not started; par it first`);

  let cost: number;
  if (from === 'ipo') {
    if (c.ipoShares < 10) throw new GameError(`no IPO shares of ${sym}`);
    cost = c.parPrice;
  } else {
    if (c.poolShares < 10) throw new GameError(`no pool shares of ${sym}`);
    cost = currentPrice(c);
  }
  if (!holdLimitOk(c, p, 10)) throw new GameError(`hold limit reached for ${sym}`);
  if (corpZone(c) !== 'yellow' && certCount(s, id) + 1 > certLimit(s)) {
    throw new GameError('certificate limit reached');
  }
  if (p.cash < cost) throw new GameError(`${id} cannot afford a share of ${sym} (${cost})`);

  if (from === 'ipo') c.ipoShares -= 10;
  else c.poolShares -= 10;
  p.shares[sym] = holds(p, sym) + 10;
  p.cash -= cost;
  s.bank += cost;
  s.log.push(`${pname(s, id)} buys 10% of ${sym} from ${from} for ${cost}`);
  if (from === 'ipo') maybeFloat(s, c);

  st.bought = true;
  endTurn(s, true);
}

function doSell(s: GameState, id: string, sym: string, count: number): void {
  const st = s.stock!;
  if (count < 1) throw new GameError('must sell at least one share');
  const c = corp(s, sym);
  const p = player(s, id);
  if (c.priceRow === null) throw new GameError(`${sym} has no share price yet`);
  const pct = count * 10;
  if (holds(p, sym) < pct) throw new GameError(`${id} does not hold ${pct}% of ${sym}`);
  if (c.poolShares + pct > 50) throw new GameError(`pool cannot exceed 50% of ${sym}`);

  // Presidency: the president keeps the 20% certificate. They may sell regular
  // shares (staying >= 20%); they may only drop below 20% - giving up the cert -
  // if another player holds at least 20% to take over the presidency.
  let newPresident = c.president;
  if (c.president === id) {
    const remaining = holds(p, sym) - pct;
    const others = s.players.filter((x) => x.id !== id);
    const top = others.reduce<PlayerState | null>(
      (m, x) => (holds(x, sym) > (m ? holds(m, sym) : -1) ? x : m),
      null
    );
    const topPct = top ? holds(top, sym) : 0;
    if (remaining >= 20) {
      // keeps the certificate; presidency only moves if someone now holds more
      newPresident = top && topPct > remaining && topPct >= 20 ? top.id : id;
    } else if (top && topPct >= 20) {
      newPresident = top.id; // gives up the cert to an eligible successor
    } else {
      throw new GameError('cannot sell the president certificate: no other player holds 20%');
    }
  }

  const price = currentPrice(c);
  const proceeds = count * price;
  p.shares[sym] = holds(p, sym) - pct;
  c.poolShares += pct;
  p.cash += proceeds;
  s.bank -= proceeds;
  c.president = newPresident;
  for (let i = 0; i < count; i++) moveDown(c);
  s.log.push(`${pname(s, id)} sells ${count} share(s) of ${sym} for ${proceeds}`);

  if (!st.soldThisTurn.includes(sym)) st.soldThisTurn.push(sym);
  st.acted = true;
  st.passes = 0;
  s.priority = (s.current + 1) % s.players.length;
}

export function applyStock(s: GameState, action: GameAction): void {
  const st = s.stock;
  if (!st) throw new GameError('no stock round in progress');
  const active = s.players[s.current].id;
  if (action.player !== active) throw new GameError(`it is ${active}'s turn, not ${action.player}`);

  switch (action.type) {
    case 'par':
      doPar(s, action.player, action.corp, action.price);
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
        endTurn(s, false);
      } else {
        st.passes += 1;
        s.log.push(`${pname(s, action.player)} passes`);
        if (st.passes >= s.players.length) endStockRound(s);
        else endTurn(s, false);
      }
      break;
    default:
      throw new GameError('unsupported stock-round action');
  }
}

export interface StockLegalActions {
  player: string;
  canPass: boolean;
  par: string[]; // corps that can be pared
  buyIpo: string[];
  buyPool: string[];
  sell: string[];
}

export function stockLegalActions(s: GameState): StockLegalActions {
  const id = s.players[s.current].id;
  const st = s.stock!;
  const p = player(s, id);
  const par: string[] = [];
  const buyIpo: string[] = [];
  const buyPool: string[] = [];
  const sell: string[] = [];
  for (const c of s.corporations) {
    // Cannot buy a corporation you sold this turn.
    const soldHere = st.soldThisTurn.includes(c.sym);
    if (!st.bought && !soldHere) {
      if (c.parPrice === null) {
        if (p.cash >= 2 * PAR_PRICES[PAR_PRICES.length - 1]) par.push(c.sym);
      } else {
        if (c.ipoShares >= 10 && holdLimitOk(c, p, 10) && p.cash >= c.parPrice) buyIpo.push(c.sym);
        if (c.poolShares >= 10 && holdLimitOk(c, p, 10) && p.cash >= currentPrice(c)) buyPool.push(c.sym);
      }
    }
    if (canSell(s, id, c.sym)) sell.push(c.sym);
  }
  return { player: id, canPass: true, par, buyIpo, buyPool, sell };
}
