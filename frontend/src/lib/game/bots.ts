/**
 * 1889 bots. Pure heuristics: given a game state, return one legal action for the
 * active player (or null if there is nothing to do). See BOTS.md for the strategy.
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
  type GameAction,
  type GameState
} from '$lib/engine';
import { PAR_PRICES, TRAINS } from '$lib/data/g1889';

export type BotLevel = 'easy' | 'normal';

const FLOAT_RESERVE: Record<BotLevel, number> = { easy: 180, normal: 325 };
const OVERPAY: Record<BotLevel, number> = { easy: 0, normal: 25 };

/**
 * RoLA launch aggressiveness. A minor floats only by bidding, and the whole bid
 * funds its treasury, so a bigger bid is a better-capitalized company at the cost
 * of the president's cash. `frac` is the share of cash a bot sinks into the bid
 * above the minimum; `cap` is the hard ceiling. Easy bots bid the minimum and
 * hoard cash; Normal bots capitalize the minor harder.
 */
const LAUNCH_AGGRO: Record<BotLevel, { frac: number; cap: number }> = {
  easy: { frac: 0, cap: 0 },
  normal: { frac: 0.45, cap: 200 }
};

function cashOf(s: GameState, id: string): number {
  return s.players.find((p) => p.id === id)?.cash ?? 0;
}

function botAuction(s: GameState, level: BotLevel): GameAction | null {
  const av = auctionView(s);
  if (!av) return null;
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

/** The most a bot will commit to a launch bid: a difficulty-scaled chunk of its
 *  cash above the minimum, capped, never over its cash and in legal increments. */
function botMaxLaunchBid(s: GameState, me: string, level: BotLevel, minBid: number): number {
  const cash = cashOf(s, me);
  const { frac, cap } = LAUNCH_AGGRO[level];
  const reach = Math.min(cap, Math.floor((cash * frac) / 5) * 5);
  return Math.min(Math.floor(cash / 5) * 5, Math.max(minBid, reach));
}

/** Pick a minor to launch after winning the auction (available is pre-filtered
 *  to launchable minors, so an Adaptive entry already has an open home). */
function botLaunchPick(s: GameState, me: string, available: string[]): GameAction {
  if (available.length === 0) return { type: 'pass', player: me };
  const sym = available[0];
  const isAd = configFor(s.title).minors?.find((m) => m.sym === sym)?.ability?.type === 'choose_home';
  return { type: 'launch', player: me, corp: sym, ...(isAd ? { home: adaptiveHomes(s)[0] } : {}) };
}

/** RoLA stock round: drive the launch auction (open / raise / pass / launch when
 *  won), else pick up a cheap share. Bidding aggressiveness scales with difficulty. */
function botRolaStock(s: GameState, level: BotLevel): GameAction | null {
  const sl = rolaStockLegalActions(s);
  const me = sl.player;

  if (sl.auction) {
    if (sl.auction.iWon) return botLaunchPick(s, me, sl.available);
    if (sl.auction.myTurn) {
      const max = botMaxLaunchBid(s, me, level, sl.minBid);
      if (sl.auction.minRaise <= max) return { type: 'launch_bid', player: me, bid: sl.auction.minRaise };
      return { type: 'pass', player: me };
    }
    return null; // gated by activePlayer; should not be reached
  }

  // Start an auction when running no minor and able to: open at our ceiling so an
  // unopposed launch still capitalizes the minor (higher difficulty bids harder).
  const myMinors = s.corporations.filter((c) => c.kind === 'minor' && c.president === me && c.floated);
  if (myMinors.length === 0 && sl.canInitiate) {
    return { type: 'initiate_auction', player: me, bid: botMaxLaunchBid(s, me, level, sl.minBid) };
  }
  if (level === 'normal') {
    if (sl.buyIpo.length) return { type: 'buy', player: me, corp: sl.buyIpo[0], from: 'ipo' };
    if (sl.buyPool.length) return { type: 'buy', player: me, corp: sl.buyPool[0], from: 'pool' };
  }
  return { type: 'pass', player: me };
}

function botOperating(s: GameState): GameAction | null {
  const v = operatingView(s);
  if (!v || !v.president) return null;
  const me = v.president;
  const c = s.corporations.find((x) => x.sym === v.corp)!;
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
    // Revenue is computed by the engine; pay it out when the corporation earns,
    // otherwise withhold. (A smarter bot may withhold to build treasury for a
    // train; keep it simple: pay when there is income.)
    return { type: 'run', player: me, corp: v.corp, revenue: v.revenue, dividend: v.revenue > 0 ? 'pay' : 'withhold' };
  }
  // Emergency money raising: the corporation must buy a train it cannot afford.
  if (v.emergency) {
    const e = v.emergency;
    if (e.canAfford) return { type: 'buy_train', player: me, corp: v.corp, train: e.train };
    if (e.sellable.length) {
      // Sell just enough shares of the first option to cover the shortfall.
      const opt = e.sellable[0];
      const need = e.shortfall - e.presidentCash;
      const count = Math.min(opt.count, Math.max(1, Math.ceil(need / opt.price)));
      return { type: 'emr_sell', player: me, corp: opt.corp, count };
    }
    if (e.canDeclareBankruptcy) return { type: 'declare_bankruptcy', player: me };
  }
  // Buy the cheapest train if the corporation has none and can afford it (forced
  // when it can run a route, optional otherwise).
  if (v.canBuyTrain && c.trains.length === 0) {
    const def = configFor(s.title).trains.find((t) => t.name === v.canBuyTrain)!;
    if (c.cash >= def.price) return { type: 'buy_train', player: me, corp: v.corp, train: v.canBuyTrain };
  }
  return { type: 'pass', player: me };
}

/** Choose a legal action for the active (bot) player, or null if none. */
export function botAction(s: GameState, level: BotLevel): GameAction | null {
  if (s.finished) return null;
  if (s.round === 'mapbuild') return pickBuildPlacement(s);
  if (s.round === 'merger' && s.merger) {
    const me = mergerActivePlayer(s);
    if (!me) return null;
    // Hostile-mergers variant: a bot always votes its shares against the bid.
    if (s.merger.vote) return { type: 'cast_merge_vote', player: me, vote: 'against' };
    // A bot never lets another player merge one of its minors: deny every proposal.
    if (s.merger.pending) return { type: 'decline_merge', player: me };
    // On its own turn a bot always merges two minors it solely controls (it is
    // president of both): the front minor with any partner it can trace a route to
    // whose president is also this bot, into the first free major. No permission
    // from another player is needed, so the merge resolves immediately.
    const sym = s.merger.queue[s.merger.index];
    const majors = availableMajors(s);
    if (sym && majors.length) {
      const partner = mergePartners(s, sym).find(
        (p) => s.corporations.find((c) => c.sym === p)?.president === me
      );
      if (partner) {
        return { type: 'propose_merge', player: me, from: sym, to: partner, major: majors[0] };
      }
    }
    return { type: 'pass', player: me };
  }
  if (s.round === 'auction' && s.auction) {
    // guard: only act if we are actually the active player
    if (auctionActivePlayer(s) !== s.players[s.current].id && !s.auction.auctioning) return null;
    return botAuction(s, level);
  }
  if (s.round === 'stock' && s.stock) {
    return configFor(s.title).minors ? botRolaStock(s, level) : botStock(s, level);
  }
  if (s.round === 'operating' && s.or) return botOperating(s);
  return null;
}
