/**
 * Trains Party bots. Pure heuristics: given a game state, return one legal action
 * for the active player (or null if there is nothing to do). See BOTS.md.
 *
 * Two families, selected by `BotLevel`:
 *   - 'testing'  - the original keep-the-game-moving heuristics. They make legal,
 *                  unsurprising moves so a game always advances; they are not
 *                  trying to win. Used for development / filling empty seats.
 *   - 'easy'     - the first draft of a strategically-thinking bot (1889): it bids
 *                  privates up to a value cap, founds and floats corporations,
 *                  steals undervalued/cash-rich companies by out-buying a weak
 *                  president, sheds risky holdings, and lays track / buys trains
 *                  only when doing so increases profit.
 *   - 'normal'   - reserved for a future, stronger tier; currently an alias for
 *                  'easy' (the strongest bot available).
 *
 * The strategic layer focuses on 1889; for RoLA (and the merger round) it reuses
 * the proven testing logic, so a strategic bot still drives those games legally.
 * Every action a bot returns comes from an engine `*LegalActions` / `*View`
 * helper, so a bot never proposes an illegal move (which would stall auto-play).
 */

import {
  auctionActivePlayer,
  auctionView,
  maxBidFor,
  stockLegalActions,
  rolaStockLegalActions,
  operatingView,
  trackLays,
  tokenPlays,
  configFor,
  pickBuildPlacement,
  mergerActivePlayer,
  mergePartners,
  availableMajors,
  adaptiveHomes,
  cheapestBuyableTrain,
  currentPrice,
  maxSellCount,
  routeRevenue,
  apply,
  TILES,
  type CorporationState,
  type GameAction,
  type GameState
} from '$lib/engine';
import { PAR_PRICES } from '$lib/data/g1889';

export type BotLevel = 'testing' | 'easy' | 'normal';

// --- Testing-bot profile (the original heuristics, single fixed setting) -----
const TESTING_RESERVE = 325; // keep ~5x the minimum par to be able to float a corp
const TESTING_OVERPAY = 25; // tolerance over a private's face value in a sub-auction
const TESTING_LAUNCH = { frac: 0.45, cap: 200 }; // RoLA launch aggressiveness

// --- Strategic ("easy") bot tuning -------------------------------------------
const PRIVATE_OVERBID = 1.4; // never bid above 140% of a private's face value
const EASY_RESERVE = 325; // keep enough to float a corporation
const DR_RESERVE = 260; // Dougo lowers IR's float cost, so dip the reserve for it
const STEAL_TREASURY = 100; // a corporation this cash-rich is worth stealing
const SPEC_CASH_FLOOR = 200; // only speculate on shares with comfortable spare cash
const STRONG_PRICE = 90; // a rival at/above this share price is worth denting

function cashOf(s: GameState, id: string): number {
  return s.players.find((p) => p.id === id)?.cash ?? 0;
}
function corpOf(s: GameState, sym: string): CorporationState {
  return s.corporations.find((c) => c.sym === sym)!;
}
function holdsOf(s: GameState, id: string | null, sym: string): number {
  if (!id) return 0;
  return s.players.find((p) => p.id === id)?.shares[sym] ?? 0;
}

// =============================================================================
//  Testing bots (the original, deliberately simple, keep-it-moving heuristics)
// =============================================================================

function botAuctionTesting(s: GameState): GameAction | null {
  const av = auctionView(s);
  if (!av) return null;
  const me = av.active;

  if (s.auction!.auctioning) {
    // The bot is the current low bidder in a sub-auction.
    const sym = s.auction!.auctioning;
    const c = av.companies.find((x) => x.sym === sym)!;
    const max = maxBidFor(s, me, sym);
    if (c.minBid <= max && c.minBid <= c.value + TESTING_OVERPAY) {
      return { type: 'bid', player: me, company: sym, price: c.minBid };
    }
    return { type: 'pass', player: me };
  }

  const cheapest = av.companies[0];
  const cash = cashOf(s, me);
  const onlyOneLeft = av.companies.length === 1;
  const fitsReserve = cheapest.minBid <= cash - TESTING_RESERVE;
  if ((fitsReserve || (onlyOneLeft && cheapest.minBid <= cash)) && cheapest.minBid <= cash) {
    return { type: 'bid', player: me, company: cheapest.sym, price: cheapest.minBid };
  }
  return { type: 'pass', player: me };
}

function botStockTesting(s: GameState): GameAction {
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

  // 3. Pick up a cheap floated share if able.
  const pickIpo = sl.buyIpo.find((sym) => corpOf(s, sym).floated);
  if (pickIpo) return { type: 'buy', player: me, corp: pickIpo, from: 'ipo' };
  if (sl.buyPool.length) return { type: 'buy', player: me, corp: sl.buyPool[0], from: 'pool' };

  return { type: 'pass', player: me };
}

/** The most a testing bot will commit to a RoLA launch bid. */
function botMaxLaunchBidTesting(s: GameState, me: string, minBid: number): number {
  const cash = cashOf(s, me);
  const { frac, cap } = TESTING_LAUNCH;
  const reach = Math.min(cap, Math.floor((cash * frac) / 5) * 5);
  return Math.min(Math.floor(cash / 5) * 5, Math.max(minBid, reach));
}

/** Pick a minor to launch after winning the auction (pre-filtered to launchable). */
function botLaunchPick(s: GameState, me: string, available: string[]): GameAction {
  if (available.length === 0) return { type: 'pass', player: me };
  const sym = available[0];
  const isAd = configFor(s.title).minors?.find((m) => m.sym === sym)?.ability?.type === 'choose_home';
  return { type: 'launch', player: me, corp: sym, ...(isAd ? { home: adaptiveHomes(s)[0] } : {}) };
}

/** RoLA stock round (testing): drive the launch auction, else pick up a cheap share. */
function botRolaStockTesting(s: GameState): GameAction | null {
  const sl = rolaStockLegalActions(s);
  const me = sl.player;

  if (sl.auction) {
    if (sl.auction.iWon) return botLaunchPick(s, me, sl.available);
    if (sl.auction.myTurn) {
      const max = botMaxLaunchBidTesting(s, me, sl.minBid);
      if (sl.auction.minRaise <= max) return { type: 'launch_bid', player: me, bid: sl.auction.minRaise };
      return { type: 'pass', player: me };
    }
    return null; // gated by activePlayer; should not be reached
  }

  const myMinors = s.corporations.filter((c) => c.kind === 'minor' && c.president === me && c.floated);
  if (myMinors.length === 0 && sl.canInitiate) {
    return { type: 'initiate_auction', player: me, bid: botMaxLaunchBidTesting(s, me, sl.minBid) };
  }
  if (sl.buyIpo.length) return { type: 'buy', player: me, corp: sl.buyIpo[0], from: 'ipo' };
  if (sl.buyPool.length) return { type: 'buy', player: me, corp: sl.buyPool[0], from: 'pool' };
  return { type: 'pass', player: me };
}

function botOperatingTesting(s: GameState): GameAction | null {
  const v = operatingView(s);
  if (!v || !v.president) return null;
  const me = v.president;
  const c = corpOf(s, v.corp);
  // OR step 2 (before laying track): issue one treasury share to the pool to help
  // fund a train the corporation has no money for and currently no train to run.
  if (v.canIssue && c.trains.length === 0 && v.canBuyTrain) {
    const def = configFor(s.title).trains.find((t) => t.name === v.canBuyTrain)!;
    if (c.cash < def.price) return { type: 'issue', player: me, corp: v.corp };
  }
  if (v.step === 'leadoff') {
    // Buy the leadoff train when the treasury affords it (a minor's first OR).
    if (v.canBuyTrain && c.trains.length === 0) {
      const def = configFor(s.title).trains.find((t) => t.name === v.canBuyTrain)!;
      if (c.cash >= def.price) return { type: 'buy_train', player: me, corp: v.corp, train: v.canBuyTrain };
    }
    return { type: 'pass', player: me };
  }
  if (v.step === 'track') {
    // Lay an affordable tile (prefer the home hex, else the cheapest), else skip.
    const lays = trackLays(s).filter((l) => l.cost <= c.cash);
    if (lays.length) {
      const pick = lays.find((l) => l.hex === c.coordinates) ?? [...lays].sort((a, b) => a.cost - b.cost)[0];
      return { type: 'lay_tile', player: me, corp: v.corp, hex: pick.hex, tile: pick.tile, rotation: pick.rotation };
    }
    return { type: 'pass', player: me };
  }
  if (v.step === 'token') {
    // Place a second token in a reachable city if affordable; else skip.
    const tokens = tokenPlays(s);
    if (tokens.length) {
      const t = tokens[0];
      return { type: 'place_token', player: me, corp: v.corp, hex: t.hex };
    }
    return { type: 'pass', player: me };
  }
  if (v.step === 'run') {
    // Pay the dividend when the corporation earns, otherwise withhold.
    return { type: 'run', player: me, corp: v.corp, revenue: v.revenue, dividend: v.revenue > 0 ? 'pay' : 'withhold' };
  }
  // Emergency money raising: the corporation must buy a train it cannot afford.
  if (v.emergency) {
    const e = v.emergency;
    if (e.canAfford) return { type: 'buy_train', player: me, corp: v.corp, train: e.train };
    if (e.sellable.length) {
      const opt = e.sellable[0];
      const need = e.shortfall - e.presidentCash;
      const count = Math.min(opt.count, Math.max(1, Math.ceil(need / opt.price)));
      return { type: 'emr_sell', player: me, corp: opt.corp, count };
    }
    if (e.canDeclareBankruptcy) return { type: 'declare_bankruptcy', player: me };
  }
  // Buy the cheapest buyable train if the corporation has none and can afford it
  // (mandatory when it can run a route; the emergency block above covers the case
  // where even the cheapest is unaffordable).
  if (c.trains.length === 0) {
    const cheap = cheapestBuyableTrain(s);
    if (cheap && c.cash >= cheap.price) {
      return { type: 'buy_train', player: me, corp: v.corp, train: cheap.name };
    }
  }
  return { type: 'pass', player: me };
}

/** The full testing-bot policy (round dispatch). */
function botActionTesting(s: GameState): GameAction | null {
  if (s.finished) return null;
  if (s.round === 'mapbuild') return pickBuildPlacement(s);
  if (s.round === 'merger' && s.merger) {
    const me = mergerActivePlayer(s);
    if (!me) return null;
    // Hostile-mergers variant: a bot always votes its shares against the bid.
    if (s.merger.vote) return { type: 'cast_merge_vote', player: me, vote: 'against' };
    // A bot never lets another player merge one of its minors: deny every proposal.
    if (s.merger.pending) return { type: 'decline_merge', player: me };
    // On its own turn a bot merges two minors it solely controls into the first
    // free major (no other player's permission is needed, so it resolves at once).
    const sym = s.merger.queue[s.merger.index];
    const majors = availableMajors(s);
    if (sym && majors.length) {
      const partner = mergePartners(s, sym).find((p) => corpOf(s, p).president === me);
      if (partner) {
        return { type: 'propose_merge', player: me, from: sym, to: partner, major: majors[0] };
      }
    }
    return { type: 'pass', player: me };
  }
  if (s.round === 'auction' && s.auction) {
    if (auctionActivePlayer(s) !== s.players[s.current].id && !s.auction.auctioning) return null;
    return botAuctionTesting(s);
  }
  if (s.round === 'stock' && s.stock) {
    return configFor(s.title).minors ? botRolaStockTesting(s) : botStockTesting(s);
  }
  if (s.round === 'operating' && s.or) return botOperatingTesting(s);
  return null;
}

// =============================================================================
//  Strategic ("easy") bot - first draft of logical 1889 play
// =============================================================================

// --- Shared strategic predicates ---------------------------------------------

/** A train rusts "soon" if its rust trigger is the depot's next train or the one
 *  after (i.e. the trigger could be bought within roughly one phase). */
function rustsSoon(s: GameState, train: string): boolean {
  const trains = configFor(s.title).trains;
  const def = trains.find((t) => t.name === train);
  if (!def?.rustsOn) return false;
  const cheapest = s.depot.find((d) => d.remaining !== 0);
  if (!cheapest) return false;
  const trigIdx = trains.findIndex((t) => t.name === def.rustsOn);
  const cheapIdx = trains.findIndex((t) => t.name === cheapest.name);
  return trigIdx >= 0 && cheapIdx >= 0 && trigIdx <= cheapIdx + 1;
}
function trainDistance(s: GameState, train: string): number {
  return configFor(s.title).trains.find((t) => t.name === train)?.distance ?? 0;
}
function trainPrice(s: GameState, train: string): number {
  return configFor(s.title).trains.find((t) => t.name === train)?.price ?? 0;
}

/**
 * Is a non-presidential holding "safe" - i.e. unlikely to be dumped on us by a
 * president bailing out before a rusting train cripples the company? Safe when
 * the president is locked in (>=50%, can't give up the cert) or the company is
 * not train-fragile (2+ trains, or a single train that won't rust soon).
 */
function isSafeHold(s: GameState, c: CorporationState): boolean {
  if (!c.president) return false;
  if (holdsOf(s, c.president, c.sym) >= 50) return true;
  if (c.trains.length === 0) return false;
  if (c.trains.length >= 2) return true;
  return !rustsSoon(s, c.trains[0]);
}

/** A company is worth stealing when it is cash-rich or holds good non-rusting trains. */
function worthStealing(s: GameState, c: CorporationState): boolean {
  if (c.cash >= STEAL_TREASURY) return true;
  return c.trains.some((t) => !rustsSoon(s, t) && trainDistance(s, t) >= 3);
}
function stealValue(s: GameState, c: CorporationState): number {
  let v = c.cash;
  for (const t of c.trains) if (!rustsSoon(s, t)) v += trainPrice(s, t);
  return v;
}

/** A floated, earning company whose share price tends to rise (it can pay out). */
function willAppreciate(s: GameState, c: CorporationState): boolean {
  return c.floated && c.trains.length >= 1 && routeRevenue(s, c) > 0;
}

/** The cheaper legal source to buy a share of `c` from, or null if neither is legal. */
function chooseSource(
  s: GameState,
  c: CorporationState,
  sl: { buyIpo: string[]; buyPool: string[] }
): 'ipo' | 'pool' | null {
  const ipoOk = sl.buyIpo.includes(c.sym);
  const poolOk = sl.buyPool.includes(c.sym);
  if (ipoOk && poolOk) return (c.parPrice ?? Infinity) <= currentPrice(s, c) ? 'ipo' : 'pool';
  if (ipoOk) return 'ipo';
  if (poolOk) return 'pool';
  return null;
}

// --- Strategic auction -------------------------------------------------------

function botAuctionEasy(s: GameState): GameAction {
  const me = s.players[s.current].id;
  const av = auctionView(s);
  if (!av) return { type: 'pass', player: me };
  const cash = cashOf(s, av.active);

  if (s.auction!.auctioning) {
    // In a sub-auction: keep raising while it stays at or below 140% of face value
    // (and we can pay), else drop out.
    const sym = s.auction!.auctioning;
    const c = av.companies.find((x) => x.sym === sym)!;
    const max = maxBidFor(s, av.active, sym);
    const cap = Math.floor(c.value * PRIVATE_OVERBID);
    if (c.minBid <= max && c.minBid <= cap) return { type: 'bid', player: av.active, company: sym, price: c.minBid };
    return { type: 'pass', player: av.active };
  }

  // Chase Dougo Railway: the premium private (its free IR share lowers IR's float
  // cost). Bid it up to 140% of face, dipping the reserve since it pays for itself.
  const dr = av.companies.find((x) => x.sym === 'DR');
  if (dr) {
    const topBid = dr.bids.reduce((m, b) => (b.price > m ? b.price : m), 0);
    const iAmHigh = topBid > 0 && dr.bids.some((b) => b.player === av.active && b.price === topBid);
    const cap = Math.floor(dr.value * PRIVATE_OVERBID);
    if (!iAmHigh && dr.minBid <= cap && dr.minBid <= cash - DR_RESERVE) {
      return { type: 'bid', player: av.active, company: 'DR', price: dr.minBid };
    }
  }

  // Otherwise be the disciplined buyer: take the cheapest at face within the float
  // reserve, or the last company outright to keep the auction moving.
  const cheapest = av.companies[0];
  const onlyOneLeft = av.companies.length === 1;
  const fitsReserve = cheapest.minBid <= cash - EASY_RESERVE;
  if ((fitsReserve || (onlyOneLeft && cheapest.minBid <= cash)) && cheapest.minBid <= cash) {
    return { type: 'bid', player: av.active, company: cheapest.sym, price: cheapest.minBid };
  }
  return { type: 'pass', player: av.active };
}

// --- Strategic stock round ---------------------------------------------------

/** Shed a risky/excess holding, or dent a strong rival we cannot take over. */
function pickStrategicSell(
  s: GameState,
  me: string,
  sl: { sell: string[] }
): { corp: string; count: number } | null {
  if (s.srCount <= 1) return null; // don't dump in the opening stock round
  for (const sym of sl.sell) {
    const c = corpOf(s, sym);
    if (c.president === me) continue; // never dump our own presidency (first draft)
    // Don't shed a company we intend to steal: there we want to accumulate, not sell.
    if (c.floated && holdsOf(s, c.president, sym) < 50 && worthStealing(s, c)) continue;
    const held = holdsOf(s, me, sym);

    // "Avoid owning 2+ shares unless it is a safe buy": shed the excess above 10%
    // of an unsafe company (a president who might bail before a train rusts).
    if (held >= 20 && !isSafeHold(s, c)) {
      const n = Math.min(Math.floor((held - 10) / 10), maxSellCount(s, me, sym));
      if (n >= 1) return { corp: sym, count: n };
    }

    // "Trash other company stocks": cash out a non-controlling stake in a strong
    // rival whose president is locked in (we could never take it over anyway),
    // banking cash and knocking their share price down. Only once established.
    const presPct = holdsOf(s, c.president, sym);
    const established = s.corporations.some((x) => x.president === me && x.floated);
    if (held >= 10 && c.president !== me && established && presPct >= 50 && currentPrice(s, c) >= STRONG_PRICE) {
      const n = Math.min(Math.floor(held / 10), maxSellCount(s, me, sym));
      if (n >= 1) return { corp: sym, count: n };
    }
  }
  return null;
}

/** Buy a share to seize a beatable, valuable company by out-holding its president. */
function pickStealBuy(
  s: GameState,
  me: string,
  sl: { buyIpo: string[]; buyPool: string[] }
): GameAction | null {
  let best: { sym: string; from: 'ipo' | 'pool' } | null = null;
  let bestVal = -1;
  for (const sym of new Set([...sl.buyIpo, ...sl.buyPool])) {
    const c = corpOf(s, sym);
    if (!c.floated || !c.president || c.president === me) continue;
    const presPct = holdsOf(s, c.president, sym);
    if (presPct >= 50) continue; // can't out-hold within the 60% cap
    if (!worthStealing(s, c)) continue;
    const from = chooseSource(s, c, sl);
    if (!from) continue;
    const val = stealValue(s, c);
    if (val > bestVal) {
      best = { sym, from };
      bestVal = val;
    }
  }
  return best ? { type: 'buy', player: me, corp: best.sym, from: best.from } : null;
}

/** With spare cash, take a single share of the strongest appreciating company. */
function pickAppreciateBuy(
  s: GameState,
  me: string,
  sl: { buyIpo: string[]; buyPool: string[] },
  cash: number
): GameAction | null {
  if (cash < SPEC_CASH_FLOOR) return null;
  let bestSym: string | null = null;
  let bestPrice = -1;
  let bestFrom: 'ipo' | 'pool' = 'pool';
  for (const sym of new Set([...sl.buyIpo, ...sl.buyPool])) {
    const c = corpOf(s, sym);
    if (!c.floated) continue;
    // "Avoid owning 2+ shares unless safe": only add past 10% to a safe company.
    if (holdsOf(s, me, sym) >= 10 && !isSafeHold(s, c)) continue;
    if (!willAppreciate(s, c)) continue;
    const from = chooseSource(s, c, sl);
    if (!from) continue;
    const price = currentPrice(s, c);
    if (price > bestPrice) {
      bestPrice = price;
      bestSym = sym;
      bestFrom = from;
    }
  }
  return bestSym ? { type: 'buy', player: me, corp: bestSym, from: bestFrom } : null;
}

function pickStrategicBuy(
  s: GameState,
  me: string,
  sl: { par: string[]; buyIpo: string[]; buyPool: string[] },
  cash: number
): GameAction | null {
  const myCorps = s.corporations.filter((c) => c.president === me);

  // 1. Float an owned, un-floated corporation (drive it to 50%).
  for (const c of myCorps) {
    if (!c.floated && sl.buyIpo.includes(c.sym)) return { type: 'buy', player: me, corp: c.sym, from: 'ipo' };
  }

  // 2. Found a corporation if we run none: par at the highest price we can sustain
  //    to float, so it is well capitalized and has room to appreciate.
  if (myCorps.length === 0 && sl.par.length > 0) {
    const par = PAR_PRICES.filter((p) => 5 * p <= cash).sort((a, b) => b - a)[0];
    if (par && cash >= 2 * par) return { type: 'par', player: me, corp: sl.par[0], price: par };
  }

  // 3. Steal an undervalued / cash-rich company from a weak president.
  const steal = pickStealBuy(s, me, sl);
  if (steal) return steal;

  // 4. Speculate on an appreciating share with surplus cash.
  return pickAppreciateBuy(s, me, sl, cash);
}

function botStockEasy(s: GameState): GameAction {
  const sl = stockLegalActions(s);
  const me = sl.player;
  const st = s.stock!;

  // Sells happen before the one purchase (you cannot buy a corporation you sold
  // this round). The turn stays open after a sell, so the bot is called again.
  if (!st.bought) {
    const sell = pickStrategicSell(s, me, sl);
    if (sell) return { type: 'sell', player: me, corp: sell.corp, count: sell.count };
    const buy = pickStrategicBuy(s, me, sl, cashOf(s, me));
    if (buy) return buy;
  }
  return { type: 'pass', player: me };
}

// --- Strategic operating round (1889) ----------------------------------------

/** Route revenue for the operating corp after applying `action` (or -1 if illegal). */
function revenueAfter(s: GameState, sym: string, action: GameAction): number {
  try {
    const ns = apply(s, action);
    return routeRevenue(ns, corpOf(ns, sym));
  } catch {
    return -1;
  }
}

/**
 * A bounded "probe" train used to estimate a network's revenue potential. We cap
 * the reach (distance <= PROBE_REACH) rather than use the biggest train: a probe
 * long enough to reward expansion past a starter line, but short enough that the
 * route DFS stays cheap on large late-game networks. (1889: the 4-train.)
 */
const PROBE_REACH = 4;
function probeTrain(s: GameState): string | null {
  const finite = configFor(s.title).trains.filter((t) => t.distance <= 90 && t.distance <= PROBE_REACH);
  if (!finite.length) return null;
  return finite.reduce((m, t) => (t.distance > m.distance ? t : m)).name;
}

/**
 * A network's revenue "potential" after applying `action`: the revenue TWO bounded
 * probe trains could run on the resulting network. Two probes (rather than the real
 * roster) reward laying toward both more reach AND a second non-overlapping route -
 * which is what justifies buying more/bigger trains and advancing phases - while
 * keeping the cost fixed and cheap (no full-roster permutation blow-up per candidate
 * lay, which is brutal on large late-game networks).
 */
function layPotential(s: GameState, sym: string, action: GameAction, probe: string | null): number {
  try {
    const ns = apply(s, action);
    const cc = corpOf(ns, sym);
    if (probe) cc.trains = [probe, probe];
    return routeRevenue(ns, cc);
  } catch {
    return -1;
  }
}

/** Lay the tile that grows the most profitable network: by network potential first
 *  (laying toward more reachable revenue), then new revenue centres (cities/towns),
 *  then cheaper cost, then the home hex. */
function strategicTrack(s: GameState, sym: string, c: CorporationState): GameAction | null {
  const lays = trackLays(s).filter((l) => l.cost <= c.cash);
  if (!lays.length) return null;
  const me = c.president!;
  const probe = probeTrain(s);

  type Scored = { l: (typeof lays)[number]; potential: number; centres: number; cost: number; home: number };
  const scored: Scored[] = lays.map((l) => {
    const act: GameAction = { type: 'lay_tile', player: me, corp: sym, hex: l.hex, tile: l.tile, rotation: l.rotation };
    const def = TILES[l.tile];
    return {
      l,
      potential: layPotential(s, sym, act, probe),
      centres: (def?.cities ?? 0) + (def?.towns ?? 0),
      cost: l.cost,
      home: l.hex === c.coordinates ? 1 : 0
    };
  });
  scored.sort(
    (a, b) => b.potential - a.potential || b.centres - a.centres || a.cost - b.cost || b.home - a.home
  );
  const best = scored[0].l;
  return { type: 'lay_tile', player: me, corp: sym, hex: best.hex, tile: best.tile, rotation: best.rotation };
}

/** Place the (optional) station token only when it increases route revenue;
 *  otherwise save it. Returns a definitive action (place or skip). */
function strategicToken(s: GameState, sym: string, c: CorporationState): GameAction {
  const tokens = tokenPlays(s);
  const me = c.president!;
  if (tokens.length && c.trains.length > 0) {
    const base = routeRevenue(s, c);
    let best: string | null = null;
    let bestRev = base;
    for (const t of tokens) {
      const rev = revenueAfter(s, sym, { type: 'place_token', player: me, corp: sym, hex: t.hex });
      if (rev > bestRev) {
        bestRev = rev;
        best = t.hex;
      }
    }
    if (best) return { type: 'place_token', player: me, corp: sym, hex: best };
  }
  return { type: 'pass', player: me };
}

/** Would owning one more `train` raise total route revenue (more profitable
 *  routes than trains to run them)? */
function extraTrainHelps(s: GameState, c: CorporationState, train: string): boolean {
  const r0 = routeRevenue(s, c);
  const clone = structuredClone(s);
  const cc = corpOf(clone, c.sym);
  cc.trains = [...cc.trains, train];
  return routeRevenue(clone, cc) > r0;
}

/** Optional train buying: buy only when an extra train would increase profit.
 *  Mandatory / emergency / first-train cases are left to the testing logic. */
function strategicTrains(s: GameState, v: NonNullable<ReturnType<typeof operatingView>>, c: CorporationState): GameAction | null {
  if (v.emergency || v.mustBuy || c.trains.length === 0) return null; // forced cases -> testing
  if (!v.canBuyTrain) return null; // at the train limit (no plain buy offered)
  const cheap = cheapestBuyableTrain(s);
  if (!cheap || c.cash < cheap.price) return null; // can't afford an optional buy
  if (extraTrainHelps(s, c, cheap.name)) {
    return { type: 'buy_train', player: c.president!, corp: v.corp, train: cheap.name };
  }
  return null;
}

function botOperatingEasy(s: GameState): GameAction | null {
  const v = operatingView(s);
  if (!v || !v.president) return null;
  const c = corpOf(s, v.corp);
  if (v.step === 'track') return strategicTrack(s, v.corp, c); // null only when no lays -> testing passes
  if (v.step === 'token') return strategicToken(s, v.corp, c);
  if (v.step === 'trains') return strategicTrains(s, v, c); // null -> testing (mandatory/none)
  return null; // leadoff / run / emergency -> testing
}

/** The strategic-bot policy (1889); delegates RoLA, mergers, and edge cases. */
function botActionEasy(s: GameState): GameAction | null {
  if (s.finished) return null;
  if (s.round === 'mapbuild') return pickBuildPlacement(s);
  if (s.round === 'merger') return botActionTesting(s);
  const isRola = !!configFor(s.title).minors;
  if (s.round === 'auction' && s.auction) {
    if (auctionActivePlayer(s) !== s.players[s.current].id && !s.auction.auctioning) return null;
    return botAuctionEasy(s);
  }
  if (s.round === 'stock' && s.stock) {
    return isRola ? botActionTesting(s) : botStockEasy(s);
  }
  if (s.round === 'operating' && s.or) {
    if (isRola) return botActionTesting(s);
    return botOperatingEasy(s) ?? botActionTesting(s);
  }
  return null;
}

/** Choose a legal action for the active (bot) player, or null if none. */
export function botAction(s: GameState, level: BotLevel): GameAction | null {
  // 'normal' is reserved for a future stronger tier; for now it aliases 'easy'.
  if (level === 'easy' || level === 'normal') return botActionEasy(s);
  return botActionTesting(s);
}
