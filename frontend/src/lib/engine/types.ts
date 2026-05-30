/**
 * Engine state and action types (1889).
 *
 * The engine is pure and deterministic: state is a function of static config plus
 * an ordered action list. No DOM, network, or framework imports.
 */

export type RoundType = 'auction' | 'stock' | 'operating';

export interface PlayerState {
  id: string;
  name: string;
  cash: number;
  /** Private company syms owned. */
  companies: string[];
  /** Percent held per corporation sym (includes the president's 20%). */
  shares: Record<string, number>;
  /** Passed in the current pass-around (auction / stock round). */
  passed: boolean;
}

export interface CompanyState {
  sym: string;
  name: string;
  value: number;
  revenue: number;
  /** Auction price reduction (waterfall). Min bid = value - discount. */
  discount: number;
  /** Player id, or null while in the initial offering. */
  owner: string | null;
  closed: boolean;
}

export interface CorporationState {
  sym: string;
  name: string;
  color: string;
  coordinates: string;
  floated: boolean;
  cash: number;
  /** Percent of shares still in the IPO and the bank pool. */
  ipoShares: number;
  poolShares: number;
  president: string | null;
  parPrice: number | null;
  /** Share-price token position in the market grid (null until pared). */
  priceRow: number | null;
  priceCol: number | null;
  /** Train names owned. */
  trains: string[];
  /** Hex coordinates where this corporation has a station token. */
  tokenHexes: string[];
}

export interface DepotTrain {
  name: string;
  /** Remaining in the bank, -1 = unlimited. */
  remaining: number;
}

export interface ORState {
  /** Corporation syms in operating order (share price descending). */
  order: string[];
  /** Index of the corporation currently operating. */
  index: number;
  /** Step within the corporation's turn. */
  step: 'track' | 'run' | 'trains';
  /** Which operating round in the current set (1-based). */
  orNumber: number;
  /** Total operating rounds in this set (phase-dependent). */
  orsThisSet: number;
}

export interface Bid {
  player: string;
  price: number;
}

export interface AuctionState {
  /** Remaining company syms, sorted by value ascending. */
  available: string[];
  /** Standing bids per company sym. */
  bids: Record<string, Bid[]>;
  /** Company sym currently in a sub-auction, or null. */
  auctioning: string | null;
  /** The originally-cheapest company (drives the all-pass reduction). */
  cheapest: string;
}

export interface StockState {
  /** The active player has sold or bought during this turn. */
  acted: boolean;
  /** The active player has used their one purchase this turn. */
  bought: boolean;
  /** Consecutive pure passes; the round ends at one full lap of passes. */
  passes: number;
}

export interface GameState {
  rulesVersion: string;
  /** Number of actions applied. */
  seq: number;
  round: RoundType;
  phase: string;
  /** Index of the priority-deal player. */
  priority: number;
  /** Index of the active player in the turn rotation. */
  current: number;
  bank: number;
  players: PlayerState[];
  companies: CompanyState[];
  corporations: CorporationState[];
  auction: AuctionState | null;
  stock: StockState | null;
  or: ORState | null;
  /** Trains remaining in the bank by type. */
  depot: DepotTrain[];
  /** Laid tiles by hex coordinate. */
  tiles: Record<string, { id: string; rotation: number }>;
  log: string[];
  finished: boolean;
}

export type GameAction =
  | { type: 'bid'; player: string; company: string; price: number }
  | { type: 'par'; player: string; corp: string; price: number }
  | { type: 'buy'; player: string; corp: string; from: 'ipo' | 'pool' }
  | { type: 'sell'; player: string; corp: string; count: number }
  | { type: 'lay_tile'; player: string; corp: string; hex: string; tile: string; rotation: number }
  | { type: 'run'; player: string; corp: string; revenue: number; dividend: 'pay' | 'withhold' }
  | { type: 'buy_train'; player: string; corp: string; train: string }
  | { type: 'pass'; player: string };

/** Raised when an action is illegal for the current state. */
export class GameError extends Error {}

export const MIN_BID_INCREMENT = 5;
export const RULES_VERSION = '1889-0';
