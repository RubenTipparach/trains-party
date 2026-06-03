/**
 * Railways of the Lost Atlas stock model: the linear price ladder plus launch,
 * issue/redeem, and the dividend / sell / sold-out / dissolve price movements
 * (incremental capitalization, no float). Pure and deterministic; it operates on
 * `CorporationState` through the shared (priceRow = 0, priceCol = ladder index)
 * + `stackSeq` representation, so the per-cell token stacking and operating-order
 * tie-break are reused directly from the 2D engine.
 *
 * Rules from rules-rotla.md §5-§6 (board-validated). Routing stock/OR actions
 * here when the title is RoLA is a later increment; these are the verified core.
 */

import { configFor } from './registry';
import { currentPrice, stampPrice } from './stock';
import { GameError, type CorporationState, type GameState, type PlayerState } from './types';

/** The single linear row of market cells (RoLA market is one row). */
function ladder(s: GameState) {
  return configFor(s.title).market[0];
}
function lastIndex(s: GameState): number {
  return ladder(s).length - 1;
}
function player(s: GameState, id: string): PlayerState {
  const p = s.players.find((x) => x.id === id);
  if (!p) throw new GameError(`unknown player ${id}`);
  return p;
}
function holds(p: PlayerState, sym: string): number {
  return p.shares[sym] ?? 0;
}

/** Current share price (the par price until a token sits on the ladder). */
export function priceOf(s: GameState, c: CorporationState): number {
  return currentPrice(s, c);
}

/**
 * Move the price token `steps` along the ladder (positive = toward 500), clamped
 * to [0, last]. Re-stamps the stack position on any move. Returns the new index
 * (so callers can detect a drop to 0 = the CLOSED space).
 */
export function moveLadder(s: GameState, c: CorporationState, steps: number): number {
  if (c.priceCol === null) return -1;
  const next = Math.max(0, Math.min(lastIndex(s), c.priceCol + steps));
  if (next !== c.priceCol) {
    c.priceCol = next;
    stampPrice(s, c);
  }
  return next;
}

/** Inclusive par band for the current phase colour (grey launches within purple). */
export function bandForPhase(s: GameState): [number, number] {
  const bands = configFor(s.title).parBands ?? {};
  const color = s.phase === '2' ? 'yellow' : s.phase === '3' || s.phase === '4' ? 'green' : 'purple';
  return bands[color] ?? [0, Number.POSITIVE_INFINITY];
}

/** Par spaces a minor may currently launch at (par cells inside the phase band). */
export function launchablePars(s: GameState): number[] {
  const [lo, hi] = bandForPhase(s);
  return ladder(s)
    .filter((cell) => cell.par && cell.price >= lo && cell.price <= hi)
    .map((cell) => cell.price);
}

/** Minimum opening launch bid; bids rise in increments of 5 (rulebook p.10). */
export const MIN_LAUNCH_BID = 120;
export const BID_INCREMENT = 5;

/**
 * Initial stock price for a winning `bid`: one-half the bid, rounded DOWN to the
 * nearest printed par space within the current phase band (rulebook p.10:
 * "one-half the winning bid rounded down"; bands 60-90 / 60-110 / 60-135).
 * e.g. bid 120 -> 60, bid 160 -> 80, bid 165 -> 80, bid 140 -> 70.
 */
export function parForBid(s: GameState, bid: number): number {
  const [lo, hi] = bandForPhase(s);
  const half = Math.min(Math.floor(bid / 2), hi);
  const pars = launchablePars(s).filter((p) => p <= half);
  return pars.length ? Math.max(...pars) : lo;
}

/**
 * Launch a minor (incremental capitalization, no float). The winning `bid` (min
 * 120, increments of 5) is paid by the president into the company treasury and
 * the president takes the 40% certificate (2 shares). The initial stock price is
 * derived from the bid (one-half, rounded down within the phase band).
 */
export function launchMinor(s: GameState, c: CorporationState, playerId: string, bid: number): void {
  if (c.kind !== 'minor') throw new GameError(`${c.sym} is not a minor`);
  if (c.parPrice !== null) throw new GameError(`${c.sym} has already launched`);
  if (bid < MIN_LAUNCH_BID) throw new GameError(`launch bid must be at least ${MIN_LAUNCH_BID}`);
  if (bid % BID_INCREMENT !== 0) throw new GameError(`launch bid must be in increments of ${BID_INCREMENT}`);
  const parPrice = parForBid(s, bid);
  const idx = ladder(s).findIndex((cell) => cell.price === parPrice && cell.par);
  if (idx < 0) throw new GameError(`invalid par price ${parPrice}`);
  const p = player(s, playerId);
  if (p.cash < bid) throw new GameError(`${playerId} cannot afford the ${bid} launch bid`);

  c.parPrice = parPrice;
  c.priceRow = 0;
  c.priceCol = idx;
  stampPrice(s, c);
  c.president = playerId;
  c.ipoShares -= 40; // president's certificate = 40% (2 shares)
  p.shares[c.sym] = holds(p, c.sym) + 40;
  p.cash -= bid;
  c.cash += bid; // treasury = the full winning bid (incremental capitalization)
  c.floated = true;
  s.log.push(`${p.name} launches ${c.sym} at ${parPrice} (bid ${bid}, treasury ${bid})`);
}

/**
 * Issue one share (OR step): the treasury gains the current price and the price
 * drops one space. The issued share goes to the pool (capped at 50%).
 */
export function issueShare(s: GameState, c: CorporationState): void {
  if (!c.floated) throw new GameError(`${c.sym} has not launched`);
  const unit = c.shareUnit ?? 10;
  if (c.ipoShares < unit) throw new GameError(`${c.sym} has no share to issue`);
  if (c.poolShares + unit > 50) throw new GameError(`pool cannot exceed 50% of ${c.sym}`);
  const price = currentPrice(s, c);
  c.ipoShares -= unit;
  c.poolShares += unit;
  c.cash += price;
  moveLadder(s, c, -1);
  s.log.push(`${c.sym} issues a ${unit}% share for ${price}; price drops`);
}

/**
 * Redeem one share (OR step): pay the current price from the treasury to buy a
 * share back from the pool. No price change.
 */
export function redeemShare(s: GameState, c: CorporationState): void {
  if (!c.floated) throw new GameError(`${c.sym} has not launched`);
  const unit = c.shareUnit ?? 10;
  if (c.poolShares < unit) throw new GameError(`${c.sym} has no pooled share to redeem`);
  const price = currentPrice(s, c);
  if (c.cash < price) throw new GameError(`${c.sym} cannot afford to redeem (${price})`);
  c.poolShares -= unit;
  c.ipoShares += unit;
  c.cash -= price;
  s.log.push(`${c.sym} redeems a ${unit}% share for ${price}`);
}

/**
 * Apply the end-of-OR dividend price movement:
 * - withhold, or no revenue: down one space;
 * - 0 < payout < price: no move, but the token re-enters at the bottom of its
 *   cell (operates last next time);
 * - price <= payout < 2x price: up one;
 * - payout >= 2x price: up two.
 */
export function applyDividend(s: GameState, c: CorporationState, mode: 'pay' | 'withhold', payout: number): void {
  if (mode === 'withhold' || payout <= 0) {
    moveLadder(s, c, -1);
    return;
  }
  const price = currentPrice(s, c);
  if (payout < price) {
    stampPrice(s, c); // same price, drop to the bottom of the stack
    return;
  }
  moveLadder(s, c, payout < 2 * price ? 1 : 2);
}

/** Per-sale price drop (RoLA moves one space per sale, not per share). */
export function sellPriceMove(s: GameState, c: CorporationState): void {
  moveLadder(s, c, -1);
}

/** End of stock round: a company fully owned by players (no IPO/pool) moves up one. */
export function soldOutMove(s: GameState, c: CorporationState): void {
  if (c.floated && !c.dissolved && c.ipoShares === 0 && c.poolShares === 0) {
    moveLadder(s, c, 1);
  }
}

/** A company sits on the CLOSED space (price 0). */
export function isClosed(s: GameState, c: CorporationState): boolean {
  return c.priceCol === 0;
}

/**
 * Dissolve a company that reached 0: shares are removed from play, the treasury
 * returns to the bank, and trains return to the depot. Station-token removal is
 * handled with the map (Stage 4).
 */
export function dissolve(s: GameState, c: CorporationState): void {
  s.bank += c.cash;
  c.cash = 0;
  for (const t of c.trains) {
    const d = s.depot.find((x) => x.name === t);
    if (d && d.remaining >= 0) d.remaining += 1;
  }
  c.trains = [];
  for (const p of s.players) delete p.shares[c.sym];
  c.president = null;
  c.floated = false;
  c.ipoShares = 100;
  c.poolShares = 0;
  c.dissolved = true;
  s.log.push(`${c.sym} dissolves (price reached 0)`);
}
