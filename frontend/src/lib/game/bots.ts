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
  maxRolaSell,
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
  corporationsCanBuyPrivates,
  currentPrice,
  maxSellCount,
  routeRevenue,
  connectedRevenue,
  playerValue,
  apply,
  TILES,
  type CorporationState,
  type GameAction,
  type GameState
} from '$lib/engine';
import { PAR_PRICES } from '$lib/data/g1889';

export type BotLevel = 'testing' | 'easy' | 'normal' | 'hard';

// --- Testing-bot profile (the original heuristics, single fixed setting) -----
const TESTING_OVERPAY = 25; // tolerance over a private's face value in a sub-auction
const TESTING_LAUNCH = { frac: 0.45, cap: 200 }; // RoLA launch aggressiveness

// --- Strategic ("easy") bot tuning -------------------------------------------
const PRIVATE_OVERBID = 1.4; // never bid above 140% of a private's face value
const DR_RESERVE = 260; // Dougo lowers IR's float cost, so dip the reserve for it
const STEAL_TREASURY = 100; // a corporation this cash-rich is worth stealing
const SPEC_CASH_FLOOR = 200; // only speculate on shares with comfortable spare cash
const STRONG_PRICE = 90; // a rival at/above this share price is worth denting
const MAX_OWN_CORPS = 3; // a cash-rich bot keeps founding presidencies up to this many
const FOUND_BUFFER = 150; // cash to keep in reserve before founding an ADDITIONAL corp
const RUST_CUSHION = 100; // treasury to keep after a train bought purely to rust rivals

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

  // Buy the cheapest private whenever affordable: a unanimous pass no longer ends
  // the 1889 auction, so a bot that only passes would stall it - keep it moving.
  const cheapest = av.companies[0];
  const cash = cashOf(s, me);
  if (cheapest.minBid <= cash) {
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

  // Otherwise buy the cheapest at face whenever affordable. Every 1889 private is
  // worth owning, and since a unanimous pass no longer ends the round, an eager
  // buyer keeps the auction moving instead of stalling it on the float reserve.
  const cheapest = av.companies[0];
  if (cheapest.minBid <= cash) {
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

  // 2. Steal an undervalued / cash-rich company from a weak president - grabbing an
  //    established corp (treasury + trains) beats founding one from scratch.
  const steal = pickStealBuy(s, me, sl);
  if (steal) return steal;

  // 3. Found a corporation, and keep founding more while flush: each presidency is
  //    another income stream and another engine for rusting rivals. Par at the
  //    highest price we can self-float (~5x par); for a 2nd+ corp also keep a cash
  //    buffer so we don't over-extend. (sl.par already respects the cert limit.)
  if (sl.par.length > 0 && myCorps.length < MAX_OWN_CORPS) {
    const buffer = myCorps.length > 0 ? FOUND_BUFFER : 0;
    const par = PAR_PRICES.filter((p) => 5 * p + buffer <= cash).sort((a, b) => b - a)[0];
    if (par && cash >= 2 * par) return { type: 'par', player: me, corp: sl.par[0], price: par };
  }

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

// =============================================================================
//  "Hard" bot - the strategic bot plus signature 1830 tactics
// =============================================================================

/** The front-runner (highest-value rival) - the player a hard bot ganks. */
function leaderId(s: GameState, exclude: string): string | null {
  let best: string | null = null;
  let bestV = -Infinity;
  for (const p of s.players) {
    if (p.out || p.id === exclude) continue;
    const v = playerValue(s, p.id);
    if (v > bestV) {
      bestV = v;
      best = p.id;
    }
  }
  return best;
}

/** Largest holding of `sym` among players other than `me`. */
function topOtherHold(s: GameState, me: string, sym: string): number {
  let m = 0;
  for (const p of s.players) if (p.id !== me) m = Math.max(m, holdsOf(s, p.id, sym));
  return m;
}

/**
 * A sinking ship: no permanent train, a treasury that cannot afford the next train,
 * and about to be train-less (it has none, or all of its trains rust soon). Its
 * president faces a forced train buy out of pocket - the classic thing to dump.
 */
function corpInTrainTrouble(s: GameState, c: CorporationState): boolean {
  if (hasPermanentTrain(s, c)) return false;
  const cheap = cheapestBuyableTrain(s);
  if (!cheap || c.cash >= cheap.price) return false; // can still self-fund a train
  const trainless = c.trains.length === 0;
  const allRustSoon = c.trains.length > 0 && c.trains.every((t) => rustsSoon(s, t));
  return trainless || allRustSoon;
}

/**
 * The signature 1830 "dump": offload a doomed presidency onto a rival so THEY are
 * stuck funding its forced train buy. Sell the most allowed, which hands the
 * presidency to the largest remaining holder (the engine requires one holding >=20%).
 */
function pickDump(s: GameState, me: string, sl: { sell: string[] }): { corp: string; count: number } | null {
  for (const sym of sl.sell) {
    const c = corpOf(s, sym);
    if (c.president !== me || !c.floated) continue;
    if (!corpInTrainTrouble(s, c)) continue;
    const top = topOtherHold(s, me, sym);
    if (top < 20) continue; // no eligible successor: the dump cannot transfer the cert
    const n = maxSellCount(s, me, sym);
    if (n >= 1 && holdsOf(s, me, sym) - 10 * n < top) return { corp: sym, count: n };
  }
  return null;
}

/**
 * Collude against the front-runner: dump a non-controlling stake in the leader's
 * strong, locked-in (can't-be-stolen) corporation to knock its share price down.
 */
function pickLeaderSpiteSell(
  s: GameState,
  me: string,
  sl: { sell: string[] },
  leader: string
): { corp: string; count: number } | null {
  for (const sym of sl.sell) {
    const c = corpOf(s, sym);
    if (c.president !== leader) continue; // target the leader's corporations only
    if (holdsOf(s, me, sym) < 10) continue;
    if (holdsOf(s, leader, sym) < 50) continue; // not locked in -> a steal is better than spite
    if (currentPrice(s, c) < STRONG_PRICE) continue; // only worth knocking a strong price down
    const n = Math.min(Math.floor(holdsOf(s, me, sym) / 10), maxSellCount(s, me, sym));
    if (n >= 1) return { corp: sym, count: n };
  }
  return null;
}

function botStockHard(s: GameState): GameAction {
  const sl = stockLegalActions(s);
  const me = sl.player;
  const st = s.stock!;
  if (!st.bought) {
    // 1. Dump a doomed presidency onto a rival before its forced train buy.
    const dump = pickDump(s, me, sl);
    if (dump) return { type: 'sell', player: me, corp: dump.corp, count: dump.count };
    // 2. Gang up on the leader: spite-sell their strong, unstealable corporation.
    const leader = leaderId(s, me);
    if (leader) {
      const hit = pickLeaderSpiteSell(s, me, sl, leader);
      if (hit) return { type: 'sell', player: me, corp: hit.corp, count: hit.count };
    }
  }
  // 3. Everything else is the proven strategic policy (sell risk / steal / found / spec).
  return botStockEasy(s);
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

/**
 * Total revenue of every centre this corp's network is wired to after `action`,
 * regardless of train reach (a cheap connectivity flood, no route DFS). This is the
 * primary track-lay signal: it rewards laying track that CONNECTS to another city far
 * more than re-upgrading a tile the network already touches. Trains on big maps (RoLA)
 * reach much farther than a bounded probe, so a probe alone made bots short-sighted -
 * they would fatten their home tile instead of running a line out to a neighbouring
 * city. Returns -1 if the lay is illegal (so it sorts last). */
function connPotential(s: GameState, sym: string, action: GameAction): number {
  try {
    const ns = apply(s, action);
    return connectedRevenue(ns, corpOf(ns, sym));
  } catch {
    return -1;
  }
}

/** Lay the tile that wires the network to the most city/town revenue (connectivity
 *  first), breaking ties by near-term route potential, then new revenue centres on the
 *  tile itself, then cheaper cost, then the home hex. */
function strategicTrack(s: GameState, sym: string, c: CorporationState): GameAction | null {
  const lays = trackLays(s).filter((l) => l.cost <= c.cash);
  if (!lays.length) return null;
  const me = c.president!;
  const probe = probeTrain(s);

  type Scored = {
    l: (typeof lays)[number];
    connected: number;
    potential: number;
    centres: number;
    cost: number;
    home: number;
  };
  const scored: Scored[] = lays.map((l) => {
    const act: GameAction = { type: 'lay_tile', player: me, corp: sym, hex: l.hex, tile: l.tile, rotation: l.rotation };
    const def = TILES[l.tile];
    return {
      l,
      connected: connPotential(s, sym, act),
      potential: layPotential(s, sym, act, probe),
      centres: (def?.cities ?? 0) + (def?.towns ?? 0),
      cost: l.cost,
      home: l.hex === c.coordinates ? 1 : 0
    };
  });
  scored.sort(
    (a, b) =>
      b.connected - a.connected ||
      b.potential - a.potential ||
      b.centres - a.centres ||
      a.cost - b.cost ||
      b.home - a.home
  );
  // connected === -1 means the lay failed to apply (e.g. an unaffordable build the
  // legal list mispriced); since -1 sorts last, a negative top means none apply.
  if (scored[0].connected < 0) return null;
  const best = scored[0].l;
  return { type: 'lay_tile', player: me, corp: sym, hex: best.hex, tile: best.tile, rotation: best.rotation };
}

/** Place the (optional) station token only when it increases route revenue;
 *  otherwise save it. Returns a definitive action (place or skip). */
function strategicToken(s: GameState, sym: string, c: CorporationState): GameAction {
  const tokens = tokenPlays(s);
  const me = c.president!;
  // A diesel runs every reachable stop, so scoring each token placement means a
  // full diesel-route simulation per option (very expensive on a built network).
  // Such a corp is already maxed, so just keep the token rather than evaluate it.
  if (corpOwnsDiesel(s, c)) return { type: 'pass', player: me };
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

/** Would buying `train` rust trains that RIVAL corporations own (financial damage)?
 *  The bought train never rusts on itself, so our corp always keeps it to run. */
function rustsRivals(s: GameState, c: CorporationState, train: string): boolean {
  const rusts = configFor(s.title).trains.filter((t) => t.rustsOn === train).map((t) => t.name);
  if (!rusts.length) return false;
  let rivalHit = 0;
  for (const corp of s.corporations) {
    if (!corp.floated || corp.president === c.president) continue; // ignore our own losses
    rivalHit += corp.trains.filter((t) => rusts.includes(t)).length;
  }
  return rivalHit > 0;
}

/** A permanent train never rusts (nothing lists it as the train it rusts on). */
function isPermanentTrain(s: GameState, name: string): boolean {
  const def = configFor(s.title).trains.find((t) => t.name === name);
  return !!def && !def.rustsOn;
}

/** Does this corporation already own a train that will never rust? */
function hasPermanentTrain(s: GameState, c: CorporationState): boolean {
  return c.trains.some((t) => isPermanentTrain(s, t));
}

/** How many of a corporation's trains never rust (permanent: 1889's 5/6/D). */
function permCount(s: GameState, c: CorporationState): number {
  return c.trains.filter((t) => isPermanentTrain(s, t)).length;
}

/** Does the corporation already own the unlimited diesel (1889 'D')? */
function corpOwnsDiesel(s: GameState, c: CorporationState): boolean {
  const d = configFor(s.title).trains.find((t) => t.availableOn);
  return !!d && c.trains.includes(d.name);
}

/**
 * Cheapest way to acquire the diesel right now: its printed price, or the best
 * trade-in (a trade-in keeps the train count flat, so it works even at the limit).
 * Null when the diesel is not yet buyable (its phase has not been reached).
 */
function dieselAcquisition(
  v: NonNullable<ReturnType<typeof operatingView>>
): { train: string; tradeIn?: string; price: number } | null {
  if (!v.dieselAvailable || !v.dieselName) return null;
  let best: { train: string; tradeIn?: string; price: number } = { train: v.dieselName, price: v.dieselPrice };
  for (const ti of v.dieselTradeIns) if (ti.price < best.price) best = { train: v.dieselName, tradeIn: ti.train, price: ti.price };
  return best;
}

/**
 * Price of the next permanent train this corporation would buy (the diesel if it is
 * available, else the cheapest buyable permanent), or null when it already owns two
 * permanent trains or none is buyable yet (it must advance a phase first).
 */
function nextPermPrice(s: GameState, v: NonNullable<ReturnType<typeof operatingView>>, c: CorporationState): number | null {
  if (permCount(s, c) >= 2) return null;
  const d = dieselAcquisition(v);
  if (d && !corpOwnsDiesel(s, c)) return d.price; // buyable even at the limit (via trade-in)
  if (v.canBuyTrain) {
    const cheap = cheapestBuyableTrain(s);
    if (cheap && isPermanentTrain(s, cheap.name)) return cheap.price;
  }
  return null;
}

/**
 * Dividend decision. Paying out is preferred - it climbs the share price, which is
 * most of a player's value. But the bot chases TWO permanent trains (ideally the
 * diesel), and a treasury only grows by withholding, so when a short burst of
 * withholds (about one operating set) would secure the next permanent train, it banks
 * the cash instead. A 0-revenue run always withholds.
 */
function strategicRun(s: GameState, v: NonNullable<ReturnType<typeof operatingView>>, c: CorporationState): GameAction {
  const me = c.president!;
  let dividend: 'pay' | 'withhold' = v.revenue > 0 ? 'pay' : 'withhold';
  if (v.revenue > 0) {
    const price = nextPermPrice(s, v, c);
    // Withhold only when the perm is close: buyable, unaffordable now, but within a
    // few withholds. Otherwise keep paying (a far-off train is not worth a long slump).
    if (price !== null && price > c.cash && price - c.cash <= 3 * v.revenue) dividend = 'withhold';
  }
  return { type: 'run', player: me, corp: v.corp, revenue: v.revenue, dividend };
}

/**
 * Train buying, aiming for TWO permanent trains as fast as possible:
 *  1. grab the diesel (never rusts, runs every stop) the moment it is affordable -
 *     directly or via the cheapest trade-in; cheapestBuyableTrain hides it while
 *     cheaper trains remain, so it is handled explicitly here and works at the limit;
 *  2. buy any buyable permanent train while the corp owns fewer than two;
 *  3. otherwise the earn / rust rush (a hard bot accepts a thinner cushion to rust).
 * Mandatory / emergency / first-train cases are left to the (robust) testing logic.
 */
function strategicTrains(
  s: GameState,
  v: NonNullable<ReturnType<typeof operatingView>>,
  c: CorporationState,
  aggressive = false
): GameAction | null {
  const pres = c.president!;
  // 1. Grab the diesel as soon as it is affordable (while still under two perms).
  const diesel = dieselAcquisition(v);
  if (diesel && !corpOwnsDiesel(s, c) && permCount(s, c) < 2 && c.cash >= diesel.price) {
    const buy: Extract<GameAction, { type: 'buy_train' }> = { type: 'buy_train', player: pres, corp: v.corp, train: diesel.train };
    if (diesel.tradeIn) buy.tradeIn = diesel.tradeIn;
    return buy;
  }
  if (v.emergency || v.mustBuy || c.trains.length === 0) return null; // forced cases -> testing
  if (!v.canBuyTrain) return null; // at the train limit and no diesel buy available
  const cheap = cheapestBuyableTrain(s);
  if (!cheap || c.cash < cheap.price) return null; // can't afford an optional buy
  // 2. Pursue a second permanent train (below the limit here).
  if (permCount(s, c) < 2 && isPermanentTrain(s, cheap.name)) {
    return { type: 'buy_train', player: pres, corp: v.corp, train: cheap.name };
  }
  // A corp that owns the diesel or already has two permanent trains is maxed - skip
  // the optional earn/rust evaluation (which would run an expensive diesel-route
  // simulation) and buy nothing more this turn.
  if (corpOwnsDiesel(s, c) || permCount(s, c) >= 2) return null;
  // 3. Earn / rust rush.
  const earns = extraTrainHelps(s, c, cheap.name);
  const cushion = aggressive ? Math.floor(RUST_CUSHION / 2) : RUST_CUSHION; // hard rusts on a thinner cushion
  const rusts = rustsRivals(s, c, cheap.name) && c.cash - cheap.price >= cushion;
  if (earns || rusts) {
    return { type: 'buy_train', player: pres, corp: v.corp, train: cheap.name };
  }
  return null;
}

/**
 * Sell the president's private companies into the operating corporation (phase 3+):
 * the corporation pays the player up to twice face value, banking that cash before
 * the 5-train closes privates for nothing. Keeps a train-buy reserve so it does not
 * starve the treasury, and only after the corporation's own trains are sorted.
 */
function pickBuyCompany(s: GameState, c: CorporationState, v: NonNullable<ReturnType<typeof operatingView>>): GameAction | null {
  if (!corporationsCanBuyPrivates(s)) return null;
  if (v.emergency || v.mustBuy || c.trains.length === 0) return null; // trains come first
  const me = c.president!;
  const cheap = cheapestBuyableTrain(s);
  const reserve = cheap ? cheap.price : 0; // keep enough to buy the next train
  const owned = s.companies
    .filter((co) => !co.closed && co.owner === me)
    // Some privates may not be sold to a corporation (Uno-Takamatsu Ferry past
    // phase 5); keeping that one is fine anyway as it never closes.
    .filter((co) => !co.abilities.some((a) => a.type === 'revenue_change' && a.noCorpSale))
    .sort((a, b) => b.value - a.value); // richest private first
  for (const co of owned) {
    const price = Math.min(2 * co.value, c.cash - reserve);
    if (price >= 1) return { type: 'buy_company', player: me, corp: v.corp, company: co.sym, price };
  }
  return null;
}

function botOperatingEasy(s: GameState, aggressive = false): GameAction | null {
  const v = operatingView(s);
  if (!v || !v.president) return null;
  const c = corpOf(s, v.corp);
  // RoLA: issue a treasury share to help fund a first train the company cannot
  // afford (reuse the testing rule); this must come before laying track. No-op for
  // 1889 (canIssue is always false there).
  if (v.canIssue && c.trains.length === 0 && v.canBuyTrain) {
    const def = configFor(s.title).trains.find((t) => t.name === v.canBuyTrain);
    if (def && c.cash < def.price) return { type: 'issue', player: v.president, corp: v.corp };
  }
  if (v.step === 'track') return strategicTrack(s, v.corp, c); // null only when no lays -> testing passes
  if (v.step === 'token') return strategicToken(s, v.corp, c);
  // Dividend: a trailing, permanent-train-less corp hoards toward a permanent train.
  if (v.step === 'run') return strategicRun(s, v, c);
  // Buy trains (secure / earn / rust) first, then bank the president's privates.
  if (v.step === 'trains') return strategicTrains(s, v, c, aggressive) ?? pickBuyCompany(s, c, v); // null -> testing
  return null; // leadoff / emergency -> testing
}

// --- Strategic RoLA stock round ----------------------------------------------

/** How much to commit to launching a minor: a chunk of cash above the minimum,
 *  capped, in legal increments, never over cash. A bigger bid buys a higher par
 *  price and a fuller treasury (the whole bid funds the minor). */
function rolaLaunchBid(s: GameState, me: string, minBid: number): number {
  const cash = cashOf(s, me);
  const reach = Math.min(250, Math.floor((cash * 0.45) / 5) * 5);
  return Math.min(Math.floor(cash / 5) * 5, Math.max(minBid, reach));
}

/** RoLA sell: shed an unsafe 2+ holding (by share unit) to the pool, except in a
 *  company we mean to steal. Mirrors the 1889 risk-shedding rule. */
function pickRolaSell(s: GameState, me: string, sl: { sell: string[] }): { corp: string; count: number } | null {
  if (s.srCount <= 1) return null;
  for (const sym of sl.sell) {
    const c = corpOf(s, sym);
    if (c.president === me) continue;
    if (c.floated && holdsOf(s, c.president, sym) < 50 && worthStealing(s, c)) continue; // steal target
    const unit = c.shareUnit ?? 10;
    const held = holdsOf(s, me, sym);
    if (held >= 2 * unit && !isSafeHold(s, c)) {
      const n = Math.min(Math.floor((held - unit) / unit), maxRolaSell(s, me, sym));
      if (n >= 1) return { corp: sym, count: n };
    }
  }
  return null;
}

/**
 * RoLA stock round: drive the launch auction (open one to get a base, raise a
 * contested bid to a ceiling, launch when won), then - like 1889 - steal a
 * beatable valuable company, shed risky holdings, or pick up an appreciating
 * share. Launches up to two minors so the merger round has something to merge.
 */
function botRolaStockEasy(s: GameState): GameAction | null {
  const sl = rolaStockLegalActions(s);
  const me = sl.player;

  if (sl.auction) {
    if (sl.auction.iWon) return botLaunchPick(s, me, sl.available);
    if (sl.auction.myTurn) {
      const ceiling = rolaLaunchBid(s, me, sl.minBid);
      if (sl.auction.minRaise <= ceiling) return { type: 'launch_bid', player: me, bid: sl.auction.minRaise };
      return { type: 'pass', player: me };
    }
    return null; // gated by activePlayer
  }

  // Launch a minor when we run fewer than two and can afford it (a second minor
  // gives the merger round a pairing to fold into a major). The second launch
  // waits for a comfortable cash buffer so we do not overextend.
  const mine = s.corporations.filter((c) => c.president === me && c.floated && !c.dissolved);
  if (mine.length < 2 && sl.canInitiate && (mine.length === 0 || cashOf(s, me) >= 2 * sl.minBid)) {
    return { type: 'initiate_auction', player: me, bid: rolaLaunchBid(s, me, sl.minBid) };
  }

  const st = s.stock!;
  if (!st.bought) {
    const sell = pickRolaSell(s, me, sl);
    if (sell) return { type: 'sell', player: me, corp: sell.corp, count: sell.count };
    const steal = pickStealBuy(s, me, sl);
    if (steal) return steal;
    const spec = pickAppreciateBuy(s, me, sl, cashOf(s, me));
    if (spec) return spec;
  }
  return { type: 'pass', player: me };
}

/**
 * The strategic-bot policy; delegates the merger round and forced cases. With
 * `hard`, the 1889 stock round adds the dump / collusion tactics and the train
 * rush accepts a thinner cushion. (RoLA's hard stock round currently reuses the
 * strategic policy; its dump is a follow-up.)
 */
function botActionEasy(s: GameState, hard = false): GameAction | null {
  if (s.finished) return null;
  if (s.round === 'mapbuild') return pickBuildPlacement(s);
  if (s.round === 'merger') return botActionTesting(s);
  const isRola = !!configFor(s.title).minors;
  if (s.round === 'auction' && s.auction) {
    if (auctionActivePlayer(s) !== s.players[s.current].id && !s.auction.auctioning) return null;
    return botAuctionEasy(s);
  }
  if (s.round === 'stock' && s.stock) {
    if (isRola) return botRolaStockEasy(s);
    return hard ? botStockHard(s) : botStockEasy(s);
  }
  if (s.round === 'operating' && s.or) {
    return botOperatingEasy(s, hard) ?? botActionTesting(s);
  }
  return null;
}

/** Choose a legal action for the active (bot) player, or null if none. */
export function botAction(s: GameState, level: BotLevel): GameAction | null {
  if (level === 'hard') return botActionEasy(s, true);
  // 'normal' is reserved for a future tier between easy and hard; for now it aliases 'easy'.
  if (level === 'easy' || level === 'normal') return botActionEasy(s);
  return botActionTesting(s);
}
