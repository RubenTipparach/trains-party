/**
 * Operating round (1889) - financial core.
 *
 * Corporations operate in share-price order (highest first). Each corporation's
 * president, on its turn: lays track, places a token, runs trains for revenue and
 * pays or withholds it (moving the share price), then buys trains from the depot
 * (advancing the phase and rusting old trains on the first train of a new type).
 *
 * Phase, train, and market data come from the title config (by `state.title`).
 */

import { configFor, rolaAbility } from './registry';
import { GameError, type CorporationState, type GameAction, type GameState } from './types';
import { applyLayTile, legalLays, applyToken, legalTokens, applySpecialLay } from './track';
import { routeRevenue, canRunRoute, revenueForChosenRoutes } from './routes';
import { playerValue } from './metrics';
import { sellSharesToPool, currentPrice, canSell, maxSellCount, stampPrice } from './stock';
import { applyDividend, issueShare, redeemShare } from './rolaStock';
import { maybeStartMergerRound } from './rolaMerger';
import { network } from './track';
import { hexesFor as hexesOf } from './board';
import { hexesFor } from './board';

function corp(s: GameState, sym: string): CorporationState {
  const c = s.corporations.find((x) => x.sym === sym);
  if (!c) throw new GameError(`unknown corporation ${sym}`);
  return c;
}
function priceOf(s: GameState, c: CorporationState): number {
  if (c.priceRow === null || c.priceCol === null) return 0;
  return configFor(s.title).market[c.priceRow][c.priceCol].price;
}
function cellExists(s: GameState, row: number, col: number): boolean {
  const m = configFor(s.title).market;
  return !!m[row] && col < m[row].length;
}
function moveRight(s: GameState, c: CorporationState): void {
  if (c.priceRow === null || c.priceCol === null) return;
  if (cellExists(s, c.priceRow, c.priceCol + 1)) {
    c.priceCol += 1;
    stampPrice(s, c);
  } else if (c.priceRow > 0) {
    c.priceRow -= 1; // top of a column: nudge up
    stampPrice(s, c);
  }
}
function moveLeft(s: GameState, c: CorporationState): void {
  if (c.priceRow === null || c.priceCol === null) return;
  if (c.priceCol > 0 && cellExists(s, c.priceRow, c.priceCol - 1)) {
    c.priceCol -= 1;
    stampPrice(s, c);
  } else if (cellExists(s, c.priceRow + 1, c.priceCol)) {
    c.priceRow += 1; // left edge: drop down
    stampPrice(s, c);
  }
}

function orsForPhase(s: GameState): number {
  return configFor(s.title).phases.find((p) => p.name === s.phase)?.operatingRounds ?? 1;
}

/** Begin an operating round (or the next one in the set). */
export function startOperatingRound(s: GameState, orNumber = 1): void {
  // Operating order: highest share price first; ties broken by which corporation
  // reached that market cell earliest (lowest stackSeq), i.e. the bottom of the
  // stack operates first (reference engine). sym is a final, deterministic tiebreak.
  const order = s.corporations
    .filter((c) => c.floated)
    .sort((a, b) => priceOf(s, b) - priceOf(s, a) || a.stackSeq - b.stackSeq || a.sym.localeCompare(b.sym))
    .map((c) => c.sym);

  // The OR set that follows stock round N is "OR N", so keep them aligned
  // (independent counting drifts when an empty OR set is skipped early on).
  if (orNumber === 1) s.orSet = s.srCount;
  if (order.length === 0) {
    finishOperatingSet(s);
    return;
  }
  s.round = 'operating';
  s.or = { order, index: 0, step: 'track', orNumber, orsThisSet: orsForPhase(s), yellowLaid: 0 };
  s.log.push(`Operating round ${s.orSet}.${orNumber} begins`);
  payPrivateIncome(s);
  ensureHomeToken(s, activeCorp(s));
  s.or.step = entryStep(s, activeCorp(s));
}

/** First step of a company's OR turn: RoLA minors that have never operated may
 * buy a leadoff train before anything else (rulebook OR step 1). */
function entryStep(s: GameState, c: CorporationState): 'leadoff' | 'track' {
  const cfg = configFor(s.title);
  return cfg.leadoffTrain && c.kind === 'minor' && !c.operated ? 'leadoff' : 'track';
}

/**
 * Place a corporation's home token when it first operates (HOME_TOKEN_TIMING
 * :operating_round). A home token is placed directly and ignores hex blocking.
 */
function ensureHomeToken(s: GameState, c: CorporationState): void {
  if (c.tokenHexes.length === 0) {
    c.tokenHexes.push(c.coordinates);
    s.log.push(`${c.sym} places its home token on ${c.coordinates}`);
  }
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
  // RoLA: after both ORs, minors may merge into majors (once green has begun).
  // The merger round resumes the cycle (export + new SR) when it completes.
  if (maybeStartMergerRound(s)) return;
  advanceCycleAfterOrs(s);
}

/** Advance past the end of an OR set: count the cycle / export / start the SR. */
export function advanceCycleAfterOrs(s: GameState): void {
  // Fixed-cycle titles (RoLA): a cycle = SR + the ORs (+ the merger round when
  // it lands). After the final cycle the game ends; otherwise export the top
  // train (which may rust trains / advance the phase) and start the next SR.
  const cfg = configFor(s.title);
  const cycles = cfg.cyclesByPlayers?.[s.players.length];
  if (cycles) {
    const cur = s.cycle ?? 1;
    if (cur >= cycles) {
      s.log.push(`Cycle ${cur} was the last; the game ends.`);
      endGame(s);
      return;
    }
    if (cfg.exportTrains) exportTopTrain(s);
    s.cycle = cur + 1;
    s.log.push(`Cycle ${s.cycle} of ${cycles} begins`);
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
  or.yellowLaid = 0;
  or.upgraded = false;
  or.issued = false;
  if (or.index >= or.order.length) {
    if (or.orNumber < or.orsThisSet) startOperatingRound(s, or.orNumber + 1);
    else finishOperatingSet(s);
  } else {
    ensureHomeToken(s, activeCorp(s));
    or.step = entryStep(s, activeCorp(s));
  }
}

/** The phase train limit (max trains a corporation may own). */
function trainLimit(s: GameState, c?: CorporationState): number {
  const ph = configFor(s.title).phases.find((p) => p.name === s.phase);
  if (!ph) return 99;
  // RoLA minors have a lower limit than majors; 1889 uses the single limit.
  // Spacious Company (and a major merged from it) always has one extra slot.
  const extra = c && rolaAbility(s.title, c, 'extra_train_slot') ? 1 : 0;
  if (c?.kind === 'minor') return (ph.minorTrainLimit ?? ph.trainLimit) + extra;
  if (extra && c?.kind === 'major') return ph.trainLimit + extra;
  return ph.trainLimit;
}

/** Has the game reached `phaseName` (current phase index >= its index)? */
function phaseReached(s: GameState, phaseName: string): boolean {
  const phases = configFor(s.title).phases;
  return phases.findIndex((p) => p.name === s.phase) >= phases.findIndex((p) => p.name === phaseName);
}

function doRun(s: GameState, c: CorporationState, revenue: number, mode: 'pay' | 'withhold'): void {
  if (revenue < 0) throw new GameError('revenue cannot be negative');
  // Resourceful: rusted trains are spent after their one extra run.
  if (c.rustedTrains?.length) {
    s.log.push(`${c.sym}'s rusted ${c.rustedTrains.join(', ')}-train(s) are discarded after their final run`);
    c.rustedTrains = [];
  }
  // Record this run for the company card (gross revenue + dividend handling).
  c.lastRun = { revenue, mode };
  const linear = configFor(s.title).marketKind === 'linear';
  if (mode === 'pay' && revenue > 0) {
    // Each holder is paid in proportion to the percent they hold (so this works
    // for any share denomination); pooled shares pay the corporation treasury,
    // IPO shares pay nobody.
    let paidOut = 0;
    for (const p of s.players) {
      const pct = p.shares[c.sym] ?? 0;
      if (pct > 0) {
        const amt = (revenue * pct) / 100;
        p.cash += amt;
        paidOut += amt;
      }
    }
    // 1889: pooled shares pay the corporation, IPO shares pay nobody. RoLA
    // (incremental cap): unsold shares sit in the company TREASURY and pay the
    // company itself; bank-pool shares pay nobody (the bank keeps it).
    const treasuryPct = linear ? c.ipoShares : c.poolShares;
    const toTreasury = (revenue * treasuryPct) / 100;
    c.cash += toTreasury;
    paidOut += toTreasury;
    if (linear && toTreasury > 0) s.log.push(`${c.sym} pays itself ${toTreasury} on treasury shares`);
    s.bank -= paidOut;
    if (linear) applyDividend(s, c, 'pay', revenue);
    else moveRight(s, c);
    s.log.push(`${c.sym} runs for ${revenue} and pays a dividend`);
  } else {
    c.cash += revenue;
    s.bank -= revenue;
    if (linear) applyDividend(s, c, 'withhold', 0);
    else moveLeft(s, c);
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

/** RoLA: before each new SR the top of the train stack is exported out of the
 * game. Exporting a 2 takes ALL remaining 2s; a first-of-type export rusts and
 * advances the phase exactly as a purchase would. */
function exportTopTrain(s: GameState): void {
  const d = s.depot.find((x) => x.remaining !== 0);
  if (!d) return;
  if (d.remaining < 0) return; // unlimited pile (∞): nothing meaningful to export
  if (d.name === '2') {
    s.log.push(`The remaining ${d.remaining} 2-train(s) are exported`);
    d.remaining = 0;
  } else {
    d.remaining -= 1;
    s.log.push(`A ${d.name}-train is exported`);
  }
  advancePhaseAndRust(s, d.name);
}

function advancePhaseAndRust(s: GameState, train: string): void {
  const cfg = configFor(s.title);
  const phaseIdx = cfg.phases.findIndex((p) => p.name === s.phase);
  const newIdx = cfg.phases.findIndex((p) => p.on === train);
  if (newIdx > phaseIdx) {
    s.phase = cfg.phases[newIdx].name;
    s.log.push(`Phase ${s.phase} begins`);
    // Revenue changes that trigger on this phase (Uno-Takamatsu Ferry -> 50 at 5).
    for (const co of s.companies) {
      if (co.closed) continue;
      for (const ab of co.abilities) {
        if (ab.type === 'revenue_change' && ab.onPhase === s.phase) {
          co.revenue = ab.revenue;
          s.log.push(`${co.name} revenue rises to ${co.revenue}`);
        }
      }
    }
  }
  // The 5-train closes private companies, except any flagged never_closes (UTF).
  const def = cfg.trains.find((t) => t.name === train);
  if (def?.closesCompanies) {
    const closed = new Set<string>();
    for (const co of s.companies) {
      if (co.closed || co.abilities.some((a) => a.type === 'never_closes')) continue;
      co.closed = true;
      co.owner = null;
      closed.add(co.sym);
    }
    if (closed.size) {
      for (const p of s.players) p.companies = p.companies.filter((sym) => !closed.has(sym));
      for (const co of s.corporations) co.companies = co.companies.filter((sym) => !closed.has(sym));
      s.log.push('Private companies close');
    }
  }
  // Rust: any train that rusts when this train (or its rust-group alias, e.g.
  // RoLA's ∞ standing in for the 7) is bought or exported.
  const group = def?.rustGroup;
  const rusts = cfg.trains
    .filter((t) => t.rustsOn === train || (group && t.rustsOn === group))
    .map((t) => t.name);
  if (rusts.length) {
    for (const co of s.corporations) {
      const dead = co.trains.filter((t) => rusts.includes(t));
      if (!dead.length) continue;
      co.trains = co.trains.filter((t) => !rusts.includes(t));
      // Resourceful: rusted trains run one more time before discarding. They no
      // longer count against the limit and cannot be sold or traded in.
      if (rolaAbility(s.title, co, 'run_rusted_once')) {
        co.rustedTrains = [...(co.rustedTrains ?? []), ...dead];
        s.log.push(`${co.sym} keeps its rusted ${dead.join(', ')}-train(s) for one last run`);
      }
    }
    s.trainPool = (s.trainPool ?? []).filter((t) => !rusts.includes(t));
    s.log.push(`${rusts.join(', ')}-trains rust`);
  }
  // New (lower) train limits apply immediately: over-limit companies discard.
  for (const co of s.corporations) discardOverLimit(s, co);
}

/** Discard trains to the bank pool until the company is within its limit
 * (auto-pick the oldest; pool trains stay buyable at printed price). */
export function discardOverLimit(s: GameState, co: CorporationState): void {
  const cfg = configFor(s.title);
  while (co.trains.length > trainLimit(s, co)) {
    const oldest = [...co.trains].sort(
      (a, b) =>
        cfg.trains.findIndex((t) => t.name === a) - cfg.trains.findIndex((t) => t.name === b)
    )[0];
    co.trains.splice(co.trains.indexOf(oldest), 1);
    (s.trainPool ??= []).push(oldest);
    s.log.push(`${co.sym} is over the train limit and discards a ${oldest}-train to the pool`);
  }
}

function doBuyTrain(s: GameState, c: CorporationState, train: string, tradeIn?: string): void {
  const fromPool = (s.trainPool ?? []).includes(train);
  const d = s.depot.find((x) => x.name === train);
  if (!d && !fromPool) throw new GameError(`no such train ${train}`);
  if (!fromPool && d!.remaining === 0) throw new GameError(`no ${train}-trains left in the bank`);
  const def = configFor(s.title).trains.find((t) => t.name === train)!;
  // Depot trains are bought cheapest-first (top of the stack), except a train
  // flagged available_on the current phase (the diesel/∞) once that phase is in.
  // Pool trains (discards) are bought at printed price in any order.
  if (!fromPool) {
    const cheapest = s.depot.find((x) => x.remaining !== 0)!;
    const availableNow = !!def.availableOn && phaseReached(s, def.availableOn);
    if (cheapest.name !== train && !availableNow) {
      throw new GameError(`must buy the ${cheapest.name}-train next from the depot`);
    }
  }

  // Diesel trade-in: swap an older train for part of the price.
  let price = def.price;
  let tradeIdx = -1;
  if (tradeIn) {
    const disc = def.discount?.[tradeIn];
    if (!disc) throw new GameError(`cannot trade a ${tradeIn}-train toward a ${train}-train`);
    tradeIdx = c.trains.indexOf(tradeIn);
    if (tradeIdx === -1) throw new GameError(`${c.sym} has no ${tradeIn}-train to trade in`);
    price = Math.max(0, def.price - disc);
  }

  // Train limit: may not exceed the phase limit. A trade-in keeps the count flat.
  if (c.trains.length + 1 - (tradeIn ? 1 : 0) > trainLimit(s, c)) {
    throw new GameError(`${c.sym} is at the ${trainLimit(s, c)}-train limit`);
  }

  if (c.cash < price) {
    if (tradeIn) throw new GameError(`${c.sym} cannot afford the ${train}-train even with a trade-in`);
    // Short treasuries: under a forced (emergency) purchase - or any face-value
    // buy when the title allows president funding - the president covers the
    // shortfall from personal cash (raising money by selling shares first).
    const emg = emergencyFor(s, c);
    const mayFund = !!configFor(s.title).presidentMayFund || (emg && emg.train === train);
    if (!mayFund) throw new GameError(`${c.sym} cannot afford a ${train}-train`);
    const pres = s.players.find((p) => p.id === c.president);
    const shortfall = price - c.cash;
    if (!pres || pres.cash < shortfall) {
      throw new GameError(`${c.sym} must raise ${shortfall} more before buying the ${train}-train`);
    }
    pres.cash -= shortfall;
    c.cash += shortfall;
    s.log.push(`${pname(s, pres.id)} contributes ${shortfall} to ${c.sym}`);
  }

  if (tradeIdx !== -1) {
    c.trains.splice(tradeIdx, 1);
    s.log.push(`${c.sym} trades in a ${tradeIn}-train`);
  }
  c.cash -= price;
  s.bank += price;
  c.trains.push(train);
  if (fromPool) s.trainPool!.splice(s.trainPool!.indexOf(train), 1);
  else if (d!.remaining > 0) d!.remaining -= 1;
  s.log.push(`${c.sym} buys a ${train}-train for ${price}${fromPool ? ' (from the pool)' : ''}`);
  if (!fromPool) advancePhaseAndRust(s, train);
}

/** Cheapest train a corp may buy next: top of the depot stack, or any cheaper
 * discard sitting in the bank pool (forced purchases pick the lowest price). */
function cheapestDepotTrain(s: GameState): { name: string; price: number } | null {
  const cfg = configFor(s.title);
  const d = s.depot.find((x) => x.remaining !== 0);
  let best: { name: string; price: number } | null = null;
  if (d) best = { name: d.name, price: cfg.trains.find((t) => t.name === d.name)!.price };
  for (const t of s.trainPool ?? []) {
    const price = cfg.trains.find((x) => x.name === t)!.price;
    if (!best || price < best.price) best = { name: t, price };
  }
  return best;
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
    if (n > 0 && canSell(s, presId, c.sym)) out.push({ corp: c.sym, count: n, price: currentPrice(s, c) });
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
  if (buyer.trains.length + 1 > trainLimit(s, buyer)) throw new GameError(`${buyer.sym} is at the ${trainLimit(s, buyer)}-train limit`);
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
  return phaseReached(s, COMPANY_BUY_PHASE);
}

/**
 * A corporation buys a private company owned by its OWN president. The price is
 * negotiable, from 1 up to twice the company's face value (and within the buyer's
 * treasury). The selling player is paid; income afterwards flows to the corporation.
 */
function doBuyCompany(s: GameState, buyer: CorporationState, companySym: string, price: number): void {
  if (!corporationsCanBuyPrivates(s)) {
    throw new GameError(`corporations cannot buy private companies until phase ${COMPANY_BUY_PHASE}`);
  }
  const co = s.companies.find((x) => x.sym === companySym);
  if (!co) throw new GameError(`no such company ${companySym}`);
  if (co.closed) throw new GameError(`${companySym} has closed`);
  if (!co.owner) throw new GameError(`${companySym} is not owned by a player`);
  // Permission: a corporation may only absorb a private owned by its OWN
  // president. Buying another player's private needs their consent, which bots
  // decline in single-player.
  if (co.owner !== buyer.president) {
    throw new GameError(`${buyer.sym} needs ${pname(s, co.owner)}'s consent to buy ${companySym}`);
  }
  // Some privates can no longer be sold to a corporation past a phase (UTF at 5).
  for (const ab of co.abilities) {
    if (ab.type === 'revenue_change' && ab.noCorpSale && phaseReached(s, ab.onPhase)) {
      throw new GameError(`${companySym} can no longer be sold to a corporation`);
    }
  }
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
  // A "sold" tile-lay ability (Ehime Railway -> green tile on Ohzu) becomes
  // available to the buying corporation.
  if (co.abilities.some((a) => a.type === 'tile_lay' && a.when === 'sold')) co.pendingLay = true;
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
    case 'lay_tile': {
      if (s.or.step !== 'leadoff' && s.or.step !== 'track') {
        throw new GameError(`${c.sym} is not laying track`);
      }
      // RoLA: up to two yellow tiles OR one upgrade per turn (rulebook OR step 3).
      // Agricultural: an upgrade additionally earns one bonus yellow lay.
      const dbl = !!configFor(s.title).doubleYellowOrSingleUpgrade;
      const wasUpgrade =
        !!s.tiles[action.hex] || (hexesFor(s)[action.hex]?.color ?? 'white') !== 'white';
      if (dbl && wasUpgrade && ((s.or.yellowLaid ?? 0) > 0 || s.or.upgraded)) {
        throw new GameError(`${c.sym} may lay up to two yellow tiles OR one upgrade per turn`);
      }
      applyLayTile(s, c, action.hex, action.tile, action.rotation);
      if (dbl && wasUpgrade) {
        if (rolaAbility(s.title, c, 'extra_yellow_after_upgrade')) {
          s.or.upgraded = true; // one bonus yellow remains available
          s.or.step = 'track';
        } else {
          s.or.step = 'token';
        }
      } else if (dbl) {
        s.or.yellowLaid = (s.or.yellowLaid ?? 0) + 1;
        // after an upgrade the bonus is a single yellow; otherwise two yellows
        s.or.step = s.or.upgraded || s.or.yellowLaid >= 2 ? 'token' : 'track';
      } else {
        s.or.step = 'token'; // 1889's single lay, then the token step
      }
      break;
    }
    case 'place_token':
      if (s.or.step !== 'token' && s.or.step !== 'track' && s.or.step !== 'leadoff') {
        throw new GameError(`${c.sym} cannot place a token now`);
      }
      applyToken(s, c, action.hex);
      s.or.step = 'run'; // one token per OR
      break;
    case 'run': {
      if (s.or.step === 'trains') throw new GameError(`${c.sym} has already run`);
      // Revenue is computed authoritatively from the corporation's routes, never
      // trusted from the action. If the player supplied explicit routes, validate
      // and score those; otherwise run the best routes the engine can find.
      const revenue =
        action.routes && action.routes.length
          ? revenueForChosenRoutes(s, c, action.routes)
          : routeRevenue(s, c);
      doRun(s, c, revenue, action.dividend);
      break;
    }
    case 'buy_train':
      if (s.or.step === 'leadoff') {
        // Leadoff: one train at face value from the depot stack/pool only
        // (never from another company), paid fully from the treasury.
        if (action.from !== undefined) {
          throw new GameError('a leadoff train cannot be bought from another company');
        }
        doBuyTrain(s, c, action.train, action.tradeIn);
        s.or.step = 'track';
        break;
      }
      if (s.or.step !== 'trains') throw new GameError(`${c.sym} must run before buying trains`);
      if (action.from !== undefined) {
        doBuyTrainFromCorp(s, c, action.from, action.train, action.price ?? 1);
      } else {
        doBuyTrain(s, c, action.train, action.tradeIn);
      }
      break;
    case 'place_suburb': {
      if (s.or.step === 'run' || s.or.step === 'trains') {
        throw new GameError('suburb tokens go down before running');
      }
      const opts = suburbOptions(s, c);
      if (!opts.includes(action.hex)) throw new GameError(`cannot place a suburb token on ${action.hex}`);
      (s.suburbs ??= {})[action.hex] = c.sym;
      s.log.push(`${c.sym} places a suburb token on ${action.hex}`);
      break;
    }
    case 'issue':
    case 'redeem': {
      if (!configFor(s.title).issueRedeem) throw new GameError('issuing is not part of this game');
      if (s.or.step !== 'leadoff' && s.or.step !== 'track') {
        throw new GameError(`${c.sym} may only issue/redeem at the start of its turn`);
      }
      if ((s.or.yellowLaid ?? 0) > 0) throw new GameError('issue/redeem must come before laying track');
      if (s.or.issued) throw new GameError(`${c.sym} has already issued or redeemed this turn`);
      if (action.type === 'issue') issueShare(s, c);
      else redeemShare(s, c);
      s.or.issued = true;
      break;
    }
    case 'special_lay':
      applySpecialLay(s, action.player, action.company, action.hex, action.tile, action.rotation);
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
      if (s.or.step === 'leadoff') {
        s.or.step = 'track'; // skip the leadoff train
      } else if (s.or.step === 'track') {
        s.or.step = 'token'; // skip laying track -> optional token
      } else if (s.or.step === 'token') {
        s.or.step = 'run'; // skip the token
      } else if (s.or.step === 'trains') {
        // A corporation that can run but owns no train must buy one; it cannot
        // finish its turn train-less.
        if (mustBuyTrain(s, c)) throw new GameError(`${c.sym} must own a train (buy one before finishing)`);
        c.operated = true;
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
  const lays = legalLays(s, activeCorp(s));
  return (s.or.yellowLaid ?? 0) > 0 || s.or.upgraded ? lays.filter((l) => !l.upgrade) : lays;
}

/** Legal token placements for the operating corporation (token step). */
export function tokenPlays(s: GameState) {
  if (!s.or || (s.or.step !== 'token' && s.or.step !== 'track' && s.or.step !== 'leadoff')) return [];
  return legalTokens(s, activeCorp(s));
}

export interface OperatingView {
  corp: string;
  president: string | null;
  step: 'leadoff' | 'track' | 'token' | 'run' | 'trains';
  order: string[];
  /** Yellow tiles already laid this turn (RoLA may lay a second). */
  yellowLaid: number;
  /** The company may issue a share right now (RoLA OR step 2). */
  canIssue: boolean;
  /** The company may redeem a pooled share right now (RoLA OR step 2). */
  canRedeem: boolean;
  index: number;
  orNumber: number;
  orsThisSet: number;
  canBuyTrain: string | null; // cheapest depot train name, or null
  /** Name of the unlimited "diesel" train for this title (1889 D / RoLA ∞), or null. */
  dieselName: string | null;
  /** The diesel may be bought now (phase reached and depot has one). */
  dieselAvailable: boolean;
  dieselPrice: number;
  /** Owned trains that can be traded toward a diesel, with the discounted price. */
  dieselTradeIns: { train: string; price: number }[];
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
  // The "diesel" (unlimited) train is the one gated by availableOn: 1889 'D', RoLA '∞'.
  const diesel = configFor(s.title).trains.find((t) => t.availableOn);
  const dDepot = diesel ? s.depot.find((d) => d.name === diesel.name) : undefined;
  const dieselAvailable =
    !!diesel?.availableOn && phaseReached(s, diesel.availableOn) && !!dDepot && dDepot.remaining !== 0;
  const owned = new Set(c.trains);
  const dieselTradeIns =
    dieselAvailable && diesel?.discount
      ? Object.keys(diesel.discount)
          .filter((t) => owned.has(t))
          .map((t) => ({ train: t, price: Math.max(0, diesel.price - diesel.discount![t]) }))
      : [];
  return {
    corp: c.sym,
    president: c.president,
    step: s.or.step,
    yellowLaid: s.or.yellowLaid ?? 0,
    canIssue:
      !!configFor(s.title).issueRedeem &&
      (s.or.step === 'leadoff' || s.or.step === 'track') &&
      !(s.or.yellowLaid ?? 0) &&
      !s.or.issued &&
      c.ipoShares >= (c.shareUnit ?? 10) &&
      c.poolShares + (c.shareUnit ?? 10) <= 50,
    canRedeem:
      !!configFor(s.title).issueRedeem &&
      (s.or.step === 'leadoff' || s.or.step === 'track') &&
      !(s.or.yellowLaid ?? 0) &&
      !s.or.issued &&
      c.poolShares >= (c.shareUnit ?? 10) &&
      c.cash >= currentPrice(s, c),
    order: s.or.order,
    index: s.or.index,
    orNumber: s.or.orNumber,
    orsThisSet: s.or.orsThisSet,
    // Only offer a plain buy when below the train limit (a company at its limit
    // can still take a new train via a trade-in - that is surfaced separately).
    canBuyTrain: cheapest && c.trains.length < trainLimit(s, c) ? cheapest.name : null,
    dieselName: diesel?.name ?? null,
    dieselAvailable,
    dieselPrice: diesel?.price ?? 0,
    dieselTradeIns,
    revenue: c.trains.length ? routeRevenue(s, c) : 0,
    hasTrains: c.trains.length + (c.rustedTrains?.length ?? 0) > 0,
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

/** Suburban: basic cities the company can reach that may take a suburb token
 * (no own hub there, one suburb per tile, and the company has tokens left). */
export function suburbOptions(s: GameState, c: CorporationState): string[] {
  const ab = rolaAbility(s.title, c, 'suburb_tokens') as { count?: number } | null;
  if (!ab) return [];
  const placed = Object.values(s.suburbs ?? {}).filter((sym) => sym === c.sym).length;
  if (placed >= (ab.count ?? 2)) return [];
  const hexes = hexesOf(s);
  const out: string[] = [];
  for (const hex of network(s, c)) {
    const h = hexes[hex];
    if (!h || !(h.cities?.length ?? 0) || h.label) continue;
    if (c.tokenHexes.includes(hex)) continue;
    if (s.suburbs?.[hex]) continue;
    out.push(hex);
  }
  return out.sort();
}
