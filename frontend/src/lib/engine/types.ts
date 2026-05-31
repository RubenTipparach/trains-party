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
  /** Private company syms this corporation has bought (pay income to its treasury). */
  companies: string[];
  /** Hex coordinates where this corporation has a station token. */
  tokenHexes: string[];
  /** Cost of each station token, in placement order (0 = free home token). */
  tokens: number[];
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
  step: 'track' | 'token' | 'run' | 'trains';
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
  /**
   * Corporations each player has sold during THIS stock round. A player may not
   * buy a corporation they have sold this round (standard 18xx). Keyed by player
   * id -> set of corp syms.
   */
  soldThisRound: Record<string, string[]>;
}

export interface GameState {
  rulesVersion: string;
  /** Number of actions applied. */
  seq: number;
  round: RoundType;
  phase: string;
  /** How many stock rounds have started (SR 1, SR 2, ...). */
  srCount: number;
  /** How many OR sets have started (the N in OR N.x). */
  orSet: number;
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
  /** Set when the bank breaks; the current OR set finishes, then the game ends. */
  endTriggered: boolean;
  finished: boolean;
  /** Player id of the winner once finished (highest value). */
  winner: string | null;
  /** Player id who went bankrupt and ended the game, if any. */
  bankrupt: string | null;
}

export type GameAction =
  | { type: 'bid'; player: string; company: string; price: number }
  | { type: 'par'; player: string; corp: string; price: number }
  | { type: 'buy'; player: string; corp: string; from: 'ipo' | 'pool' }
  | { type: 'sell'; player: string; corp: string; count: number }
  | { type: 'lay_tile'; player: string; corp: string; hex: string; tile: string; rotation: number }
  | { type: 'place_token'; player: string; corp: string; hex: string }
  | { type: 'run'; player: string; corp: string; revenue: number; dividend: 'pay' | 'withhold' }
  // Depot buy: `from`/`price` omitted (fixed depot price). Inter-corporation
  // buy: `from` is the selling corporation and `price` the negotiated amount
  // (>= 1, up to the buyer's treasury), allowed between corporations the acting
  // player controls (presidents both that player).
  | { type: 'buy_train'; player: string; corp: string; train: string; from?: string; price?: number }
  // A corporation buys a player-owned private company for `price` (>= 1, up to
  // twice the company's face value, and within the buyer's treasury). Income
  // then flows to the corporation instead of the player.
  | { type: 'buy_company'; player: string; corp: string; company: string; price: number }
  // Emergency money raising: a president forced to fund a mandatory train sells
  // shares to the pool (emr_sell), or declares bankruptcy when nothing can cover it.
  | { type: 'emr_sell'; player: string; corp: string; count: number }
  | { type: 'declare_bankruptcy'; player: string }
  | { type: 'pass'; player: string };

/** Raised when an action is illegal for the current state. */
export class GameError extends Error {}

export const MIN_BID_INCREMENT = 5;
export const RULES_VERSION = '1889-0.5';
