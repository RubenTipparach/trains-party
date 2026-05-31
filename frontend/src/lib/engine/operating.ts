/**
 * Operating round (1889) - financial core.
 *
 * Corporations operate in share-price order (highest first). Each corporation's
 * president, on its turn: runs trains for revenue and pays or withholds it
 * (moving the share price right or left), then buys trains from the depot
 * (advancing the phase and rusting old trains on the first train of a new type).
 * After every corporation operates, the next operating round of the set runs, or
 * play returns to a stock round.
 *
 * Routes are not yet modelled: the `run` action carries the route revenue (the
 * route layer in Stage 3b will compute it). Track laying and token placement also
 * arrive in Stage 3b.
 */

import { MARKET, TRAINS, PHASES } from '$lib/data/g1889';
import { GameError, type CorporationState, type GameAction, type GameState } from './types';
import { applyLayTile, legalLays, applyToken, legalTokens } from './track';
import { routeRevenue, canRunRoute } from './routes';
import { playerValue } from './metrics';
import { sellSharesToPool, currentPrice, canSell, maxSellCount } from './stock';

function corp(s: GameState, sym: string): CorporationState {
  const c = s.corporations.find((x) => x.sym === sym);
  if (!c) throw new GameError(`unknown corporation ${sym}`);
  return c;
}
function priceOf(c: CorporationState): number {
  if (c.priceRow === null || c.priceCol === null) return 0;
  return MARKET[c.priceRow][c.priceCol].price;
}
function cellExists(row: number, col: number): boolean {
  return !!MARKET[row] && col < MARKET[row].length;
}
function moveRight(c: CorporationState): void {
  if (c.priceRow === null || c.priceCol === null) return;
  if (cellExists(c.priceRow, c.priceCol + 1)) c.priceCol += 1;
  else if (c.priceRow > 0) c.priceRow -= 1; // top of a column: nudge up
}
function moveLeft(c: CorporationState): void {
  if (c.priceRow === null || c.priceCol === null) return;
  if (c.priceCol > 0 && cellExists(c.priceRow, c.priceCol - 1)) c.priceCol -= 1;
  else if (cellExists(c.priceRow + 1, c.priceCol)) c.priceRow += 1; // left edge: drop down
}

function orsForPhase(s: GameState): number {
  return PHASES.find((p) => p.name === s.phase)?.operatingRounds ?? 1;
}

/** Begin an operating round (or the next one in the set). */
export function startOperatingRound(s: GameState, orNumber = 1): void {
  const order = s.corporations
    .filter((c) => c.floated)
    .sort((a, b) => priceOf(b) - priceOf(a) || a.sym.localeCompare(b.sym))
    .map((c) => c.sym);

  // The OR set that follows stock round N is "OR N", so keep them aligned
  // (independent counting drifts when an empty OR set is skipped early on).
  if (orNumber === 1) s.orSet = s.srCount;
  if (order.length === 0) {
    finishOperatingSet(s);
    return;
  }
  s.round = 'operating';
  s.or = { order, index: 0, step: 'track', orNumber, orsThisSet: orsForPhase(s) };
  s.log.push(`Operating round ${s.orSet}.${orNumber} begins`);
  payPrivateIncome(s);
}

/** Private companies pay their revenue to their owners at the start of each OR. */
function payPrivateIncome(s: GameState): void {
  for (const p of s.players) {
    let income = 0;
    for (const sym of p.companies) {
      const co = s.companies.find((c) => c.sym === sym);
      if (co && !co.closed) income += co.revenue;
    }
    if (income > 0) {
      p.cash += income;
      s.bank -= income;
      s.log.push(`${p.name} collects ${income} in private income`);
    }
  }
  // Privates a corporation has bought pay their revenue into its treasury.
  for (const c of s.corporations) {
    let income = 0;
    for (const sym of c.companies) {
      const co = s.companies.find((x) => x.sym === sym);
      if (co && !co.closed) income += co.revenue;
    }
    if (income > 0) {
      c.cash += income;
      s.bank -= income;
      s.log.push(`${c.sym} collects ${income} in private income`);
    }
  }
}

function finishOperatingSet(s: GameState): void {
  s.or = null;
  // If the bank broke during this set, the game ends now (after the full set).
  if (s.endTriggered) {
    endGame(s);
    return;
  }
  s.round = 'stock';
  s.srCount += 1;
  s.stock = { acted: false, bought: false, passes: 0, soldThisRound: {} };
  s.current = s.priority;
  s.players.forEach((p) => (p.passed = false));
  s.log.push('Operating rounds complete; stock round begins');
}

/** End the game: the player with the highest value wins. */
function endGame(s: GameState): void {
  s.finished = true;
  let best: { id: string; value: number } | null = null;
  for (const p of s.players) {
    const v = playerValue(s, p.id);
    if (!best || v > best.value) best = { id: p.id, value: v };
  }
  s.winner = best?.id ?? null;
  const name = s.players.find((p) => p.id === s.winner)?.name ?? s.winner;
  s.log.push(`Game over. ${name} wins with a value of ${best?.value ?? 0}.`);
}

function activeCorp(s: GameState): CorporationState {
  return corp(s, s.or!.order[s.or!.index]);
}

function pname(s: GameState, id: string): string {
  return s.players.find((p) => p.id === id)?.name ?? id;
}

/** The player who must act in the operating round (the operating corp's president). */
export function operatingActivePlayer(s: GameState): string | null {
  if (!s.or) return null;
  return activeCorp(s).president;
}

function nextCorp(s: GameState): void {
  const or = s.or!;
  or.index += 1;
  or.step = 'track';
  if (or.index >= or.order.length) {
    if (or.orNumber < or.orsThisSet) startOperatingRound(s, or.orNumber + 1);
    else finishOperatingSet(s);
  }
}

function doRun(s: GameState, c: CorporationState, revenue: number, mode: 'pay' | 'withhold'): void {
  if (revenue < 0) throw new GameError('revenue cannot be negative');
  if (mode === 'pay' && revenue > 0) {
    const perShare = revenue / 10; // 10 shares of 10%
    let paidOut = 0;
    for (const p of s.players) {
      const pct = p.shares[c.sym] ?? 0;
      if (pct > 0) {
        const amt = perShare * (pct / 10);
        p.cash += amt;
        paidOut += amt;
      }
    }
    // Market (pool) shares pay their dividend to the corporation treasury.
    // IPO shares pay NOBODY (that portion is simply not paid out) in 1889.
    const toTreasury = perShare * (c.poolShares / 10);
    c.cash += toTreasury;
    paidOut += toTreasury;
    s.bank -= paidOut;
    moveRight(c);
    s.log.push(`${c.sym} runs for ${revenue} and pays a dividend`);
  } else {
    c.cash += revenue;
    s.bank -= revenue;
    moveLeft(c);
    s.log.push(`${c.sym} runs for ${revenue} and withholds`);
  }
  // End-game trigger: when the bank breaks (runs out of money), the current OR
  // set is completed and then the game ends.
  if (s.bank < 0 && !s.endTriggered) {
    s.endTriggered = true;
    s.log.push('The bank has broken. The game will end after this set of operating rounds.');
  }
  s.or!.step = 'trains';
}

function advancePhaseAndRust(s: GameState, train: string): void {
  const phaseIdx = PHASES.findIndex((p) => p.name === s.phase);
  const newIdx = PHASES.findIndex((p) => p.on === train);
  if (newIdx > phaseIdx) {
    s.phase = PHASES[newIdx].name;
    s.log.push(`Phase ${s.phase} begins`);
    if (PHASES[newIdx].name === '5') {
      // The 5-train closes all private companies.
      for (const co of s.companies) {
        if (!co.closed) {
          co.closed = true;
          co.owner = null;
        }
      }
      for (const p of s.players) p.companies = [];
      for (const co of s.corporations) co.companies = [];
      s.log.push('Private companies close');
    }
  }
  // Rust: any train that rusts when this train is bought.
  const rusts = TRAINS.filter((t) => t.rustsOn === train).map((t) => t.name);
  if (rusts.length) {
    for (const co of s.corporations) co.trains = co.trains.filter((t) => !rusts.includes(t));
    s.log.push(`${rusts.join(', ')}-trains rust`);
  }
}

function doBuyTrain(s: GameState, c: CorporationState, train: string): void {
  const d = s.depot.find((x) => x.name === train);
  if (!d) throw new GameError(`no such train ${train}`);
  if (d.remaining === 0) throw new GameError(`no ${train}-trains left in the bank`);
  const def = TRAINS.find((t) => t.name === train)!;
  // Only the cheapest available train type can be bought from the depot
  // (depot trains must be bought in order).
  const cheapest = s.depot.find((x) => x.remaining !== 0)!;
  if (cheapest.name !== train) throw new GameError(`must buy the ${cheapest.name}-train next from the depot`);

  if (c.cash < def.price) {
    // The corporation cannot pay outright. This is only allowed under a forced
    // (emergency) purchase, where the president must cover the shortfall from
    // personal cash (after raising money by selling shares if needed).
    const emg = emergencyFor(s, c);
    if (!emg || emg.train !== train) throw new GameError(`${c.sym} cannot afford a ${train}-train`);
    const pres = s.players.find((p) => p.id === c.president);
    const shortfall = def.price - c.cash;
    if (!pres || pres.cash < shortfall) {
      throw new GameError(`${c.sym} must raise ${shortfall} more before buying the ${train}-train`);
    }
    pres.cash -= shortfall;
    c.cash += shortfall;
    s.log.push(`${pname(s, pres.id)} contributes ${shortfall} to ${c.sym} (emergency)`);
  }

  c.cash -= def.price;
  s.bank += def.price;
  c.trains.push(train);
  if (d.remaining > 0) d.remaining -= 1;
  s.log.push(`${c.sym} buys a ${train}-train for ${def.price}`);
  advancePhaseAndRust(s, train);
}

/** Cheapest depot train still available (the only new train a corp may buy next). */
function cheapestDepotTrain(s: GameState): { name: string; price: number } | null {
  const d = s.depot.find((x) => x.remaining !== 0);
  if (!d) return null;
  const def = TRAINS.find((t) => t.name === d.name)!;
  return { name: d.name, price: def.price };
}

/** A corporation must own a train when it has none and could actually run a route. */
export function mustBuyTrain(s: GameState, c: CorporationState): boolean {
  return c.trains.length === 0 && canRunRoute(s, c);
}

/**
 * If the operating corporation is forced to buy a train it cannot pay for outright,
 * returns the emergency target (cheapest depot train + price); otherwise null. The
 * president must cover the shortfall, raising money by selling shares first.
 */
export function emergencyFor(s: GameState, c: CorporationState): { train: string; price: number } | null {
  if (!s.or || s.or.step !== 'trains') return null;
  if (!mustBuyTrain(s, c)) return null;
  const cheapest = cheapestDepotTrain(s);
  if (!cheapest) return null;
  if (c.cash >= cheapest.price) return null; // affordable: mandatory but not an emergency
  return { train: cheapest.name, price: cheapest.price };
}

/** Shares the president may sell to raise emergency cash (corp sym + count + price). */
export function emrSellable(s: GameState, presId: string): { corp: string; count: number; price: number }[] {
  const out: { corp: string; count: number; price: number }[] = [];
  for (const c of s.corporations) {
    const n = maxSellCount(s, presId, c.sym);
    if (n > 0 && canSell(s, presId, c.sym)) out.push({ corp: c.sym, count: n, price: currentPrice(c) });
  }
  return out;
}

/** President sells shares mid-OR to fund a forced train purchase. */
function doEmrSell(s: GameState, c: CorporationState, sym: string, count: number): void {
  if (!emergencyFor(s, c)) throw new GameError(`${c.sym} is not in emergency money raising`);
  sellSharesToPool(s, c.president!, sym, count);
}

/**
 * The president cannot fund the mandatory train even after selling everything:
 * they go bankrupt and the game ends immediately.
 */
function doDeclareBankruptcy(s: GameState, c: CorporationState): void {
  const emg = emergencyFor(s, c);
  if (!emg) throw new GameError('no emergency purchase is pending');
  const pres = s.players.find((p) => p.id === c.president)!;
  const shortfall = emg.price - c.cash;
  // Only valid when the president truly cannot pay and has nothing left to sell.
  if (pres.cash >= shortfall) throw new GameError('the president can still pay for the train');
  if (emrSellable(s, pres.id).length > 0) throw new GameError('the president must sell shares before declaring bankruptcy');
  s.bankrupt = pres.id;
  s.log.push(`${pname(s, pres.id)} cannot fund a train for ${c.sym} and goes bankrupt`);
  endGame(s);
}

/**
 * Buy a used train from another corporation. Allowed between two corporations
 * the acting player controls (president of both); the price is negotiated, from
 * 1 up to the buying corporation's treasury. Used-train transfers do not advance
 * the phase or rust anything.
 */
function doBuyTrainFromCorp(s: GameState, buyer: CorporationState, fromSym: string, train: string, price: number): void {
  const seller = s.corporations.find((x) => x.sym === fromSym);
  if (!seller) throw new GameError(`no such corporation ${fromSym}`);
  if (seller.sym === buyer.sym) throw new GameError('a corporation cannot buy a train from itself');
  if (seller.president !== buyer.president) {
    throw new GameError(`${buyer.sym} can only buy trains from corporations the same president controls`);
  }
  const idx = seller.trains.indexOf(train);
  if (idx === -1) throw new GameError(`${fromSym} has no ${train}-train to sell`);
  if (!Number.isInteger(price) || price < 1) throw new GameError('train price must be at least 1');
  if (price > buyer.cash) throw new GameError(`${buyer.sym} cannot pay ${price} (treasury ${buyer.cash})`);

  buyer.cash -= price;
  seller.cash += price;
  seller.trains.splice(idx, 1);
  buyer.trains.push(train);
  s.log.push(`${buyer.sym} buys a ${train}-train from ${fromSym} for ${price}`);
}

/** Corporations may buy private companies once the green (phase 3) trains arrive. */
const COMPANY_BUY_PHASE = '3';
export function corporationsCanBuyPrivates(s: GameState): boolean {
  const i = PHASES.findIndex((p) => p.name === s.phase);
  const j = PHASES.findIndex((p) => p.name === COMPANY_BUY_PHASE);
  return i >= j;
}

/**
 * A corporation buys a player-owned private company. The price is negotiable,
 * from 1 up to twice the company's face value (and within the buyer's treasury).
 * The selling player is paid; income afterwards flows to the corporation.
 */
function doBuyCompany(s: GameState, buyer: CorporationState, companySym: string, price: number): void {
  if (!corporationsCanBuyPrivates(s)) {
    throw new GameError(`corporations cannot buy private companies until phase ${COMPANY_BUY_PHASE}`);
  }
  const co = s.companies.find((x) => x.sym === companySym);
  if (!co) throw new GameError(`no such company ${companySym}`);
  if (co.closed) throw new GameError(`${companySym} has closed`);
  if (!co.owner) throw new GameError(`${companySym} is not owned by a player`);
  const seller = s.players.find((p) => p.id === co.owner);
  if (!seller) throw new GameError(`${companySym} has no owner to sell it`);
  if (!Number.isInteger(price) || price < 1) throw new GameError('company price must be at least 1');
  if (price > 2 * co.value) throw new GameError(`${companySym} costs at most ${2 * co.value} (twice its face value)`);
  if (price > buyer.cash) throw new GameError(`${buyer.sym} cannot pay ${price} (treasury ${buyer.cash})`);

  // Money moves between the corporation and the player, not the bank.
  buyer.cash -= price;
  seller.cash += price;
  seller.companies = seller.companies.filter((x) => x !== companySym);
  co.owner = null;
  buyer.companies.push(companySym);
  s.log.push(`${buyer.sym} buys the ${co.name} private from ${seller.name} for ${price}`);
}

export function applyOperating(s: GameState, action: GameAction): void {
  if (!s.or) throw new GameError('no operating round in progress');
  const c = activeCorp(s);
  const active = c.president;
  if (action.player !== active) throw new GameError(`it is ${active}'s turn (operating ${c.sym})`);

  if (
    (action.type === 'lay_tile' ||
      action.type === 'place_token' ||
      action.type === 'run' ||
      action.type === 'buy_train' ||
      action.type === 'buy_company') &&
    action.corp !== c.sym
  ) {
    throw new GameError(`${c.sym} is operating, not ${action.corp}`);
  }

  switch (action.type) {
    case 'lay_tile':
      if (s.or.step !== 'track') throw new GameError(`${c.sym} is not laying track`);
      applyLayTile(s, c, action.hex, action.tile, action.rotation);
      s.or.step = 'token'; // one tile per OR, then the optional token step
      break;
    case 'place_token':
      if (s.or.step !== 'token' && s.or.step !== 'track') throw new GameError(`${c.sym} cannot place a token now`);
      applyToken(s, c, action.hex);
      s.or.step = 'run'; // one token per OR
      break;
    case 'run': {
      if (s.or.step !== 'run' && s.or.step !== 'track' && s.or.step !== 'token') {
        throw new GameError(`${c.sym} has already run`);
      }
      // Revenue is computed authoritatively from the corporation's routes, not
      // taken from the action (which can't be trusted). The action only chooses
      // pay vs withhold.
      const revenue = routeRevenue(s, c);
      doRun(s, c, revenue, action.dividend);
      break;
    }
    case 'buy_train':
      if (s.or.step !== 'trains') throw new GameError(`${c.sym} must run before buying trains`);
      if (action.from !== undefined) {
        doBuyTrainFromCorp(s, c, action.from, action.train, action.price ?? 1);
      } else {
        doBuyTrain(s, c, action.train);
      }
      break;
    case 'buy_company':
      if (s.or.step !== 'trains') throw new GameError(`${c.sym} can only buy companies in its buy step`);
      doBuyCompany(s, c, action.company, action.price);
      break;
    case 'emr_sell':
      doEmrSell(s, c, action.corp, action.count);
      break;
    case 'declare_bankruptcy':
      doDeclareBankruptcy(s, c);
      break;
    case 'pass':
      if (s.or.step === 'track') {
        s.or.step = 'token'; // skip laying track -> optional token
      } else if (s.or.step === 'token') {
        s.or.step = 'run'; // skip the token
      } else if (s.or.step === 'trains') {
        // A corporation that can run but owns no train must buy one; it cannot
        // finish its turn train-less.
        if (mustBuyTrain(s, c)) throw new GameError(`${c.sym} must own a train (buy one before finishing)`);
        s.log.push(`${c.sym} finishes operating`);
        nextCorp(s);
      } else {
        throw new GameError(`${c.sym} must run its trains`);
      }
      break;
    default:
      throw new GameError('unsupported operating-round action');
  }
}

/** Legal tile plays for the operating corporation (track step). */
export function trackLays(s: GameState) {
  if (!s.or || s.or.step !== 'track') return [];
  return legalLays(s, activeCorp(s));
}

/** Legal token placements for the operating corporation (token step). */
export function tokenPlays(s: GameState) {
  if (!s.or || (s.or.step !== 'token' && s.or.step !== 'track')) return [];
  return legalTokens(s, activeCorp(s));
}

export interface OperatingView {
  corp: string;
  president: string | null;
  step: 'track' | 'token' | 'run' | 'trains';
  order: string[];
  index: number;
  orNumber: number;
  orsThisSet: number;
  canBuyTrain: string | null; // cheapest depot train name, or null
  /** Best route revenue the operating corporation can earn this OR. */
  revenue: number;
  /** Whether the corporation owns any train to run. */
  hasTrains: boolean;
  /** The corporation must buy a train before finishing (0 trains but can run). */
  mustBuy: boolean;
  /** Set when the forced buy is unaffordable: the president must raise money. */
  emergency: {
    train: string;
    price: number;
    shortfall: number; // still owed after the corporation's own treasury
    presidentCash: number;
    sellable: { corp: string; count: number; price: number }[];
    canAfford: boolean; // president cash now covers the shortfall -> may buy
    canDeclareBankruptcy: boolean;
  } | null;
}

export function operatingView(s: GameState): OperatingView | null {
  if (!s.or) return null;
  const c = activeCorp(s);
  const cheapest = s.depot.find((x) => x.remaining !== 0);
  return {
    corp: c.sym,
    president: c.president,
    step: s.or.step,
    order: s.or.order,
    index: s.or.index,
    orNumber: s.or.orNumber,
    orsThisSet: s.or.orsThisSet,
    canBuyTrain: cheapest ? cheapest.name : null,
    revenue: c.trains.length ? routeRevenue(s, c) : 0,
    hasTrains: c.trains.length > 0,
    mustBuy: mustBuyTrain(s, c),
    emergency: emergencyView(s, c)
  };
}

function emergencyView(s: GameState, c: CorporationState): OperatingView['emergency'] {
  const emg = emergencyFor(s, c);
  if (!emg) return null;
  const pres = s.players.find((p) => p.id === c.president);
  const presidentCash = pres?.cash ?? 0;
  const shortfall = emg.price - c.cash;
  const sellable = pres ? emrSellable(s, pres.id) : [];
  return {
    train: emg.train,
    price: emg.price,
    shortfall,
    presidentCash,
    sellable,
    canAfford: presidentCash >= shortfall,
    canDeclareBankruptcy: presidentCash < shortfall && sellable.length === 0
  };
}
