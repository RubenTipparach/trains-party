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

  if (order.length === 0) {
    finishOperatingSet(s);
    return;
  }
  s.round = 'operating';
  s.or = { order, index: 0, step: 'run', orNumber, orsThisSet: orsForPhase(s) };
  s.log.push(`Operating round ${orNumber} of ${s.or.orsThisSet} begins`);
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
}

function finishOperatingSet(s: GameState): void {
  s.or = null;
  s.round = 'stock';
  s.stock = { acted: false, bought: false, passes: 0 };
  s.current = s.priority;
  s.players.forEach((p) => (p.passed = false));
  s.log.push('Operating rounds complete; stock round begins');
}

function activeCorp(s: GameState): CorporationState {
  return corp(s, s.or!.order[s.or!.index]);
}

/** The player who must act in the operating round (the operating corp's president). */
export function operatingActivePlayer(s: GameState): string | null {
  if (!s.or) return null;
  return activeCorp(s).president;
}

function nextCorp(s: GameState): void {
  const or = s.or!;
  or.index += 1;
  or.step = 'run';
  if (or.index >= or.order.length) {
    if (or.orNumber < or.orsThisSet) startOperatingRound(s, or.orNumber + 1);
    else finishOperatingSet(s);
  }
}

function doRun(s: GameState, c: CorporationState, revenue: number, mode: 'pay' | 'withhold'): void {
  if (revenue < 0) throw new GameError('revenue cannot be negative');
  if (mode === 'pay' && revenue > 0) {
    const perShare = revenue / 10; // 10 shares of 10%
    for (const p of s.players) {
      const pct = p.shares[c.sym] ?? 0;
      if (pct > 0) p.cash += perShare * (pct / 10);
    }
    // Shares still in the IPO or pool pay their dividend to the corporation.
    c.cash += perShare * ((c.ipoShares + c.poolShares) / 10);
    s.bank -= revenue;
    moveRight(c);
    s.log.push(`${c.sym} runs for ${revenue} and pays a dividend`);
  } else {
    c.cash += revenue;
    s.bank -= revenue;
    moveLeft(c);
    s.log.push(`${c.sym} runs for ${revenue} and withholds`);
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
  if (c.cash < def.price) throw new GameError(`${c.sym} cannot afford a ${train}-train`);

  c.cash -= def.price;
  s.bank += def.price;
  c.trains.push(train);
  if (d.remaining > 0) d.remaining -= 1;
  s.log.push(`${c.sym} buys a ${train}-train for ${def.price}`);
  advancePhaseAndRust(s, train);
}

export function applyOperating(s: GameState, action: GameAction): void {
  if (!s.or) throw new GameError('no operating round in progress');
  const c = activeCorp(s);
  const active = c.president;
  if (action.player !== active) throw new GameError(`it is ${active}'s turn (operating ${c.sym})`);

  switch (action.type) {
    case 'run':
      if (s.or.step !== 'run') throw new GameError(`${c.sym} has already run`);
      if (action.corp !== c.sym) throw new GameError(`${c.sym} is operating, not ${action.corp}`);
      doRun(s, c, action.revenue, action.dividend);
      break;
    case 'buy_train':
      if (s.or.step !== 'trains') throw new GameError(`${c.sym} must run before buying trains`);
      if (action.corp !== c.sym) throw new GameError(`${c.sym} is operating, not ${action.corp}`);
      doBuyTrain(s, c, action.train);
      break;
    case 'pass':
      // End this corporation's turn (skip remaining run/train steps).
      s.log.push(`${c.sym} finishes operating`);
      nextCorp(s);
      break;
    default:
      throw new GameError('unsupported operating-round action');
  }
}

export interface OperatingView {
  corp: string;
  president: string | null;
  step: 'run' | 'trains';
  order: string[];
  index: number;
  orNumber: number;
  orsThisSet: number;
  canBuyTrain: string | null; // cheapest depot train name, or null
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
    canBuyTrain: cheapest ? cheapest.name : null
  };
}
