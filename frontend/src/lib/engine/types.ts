/**
 * Engine state and action types (1889).
 *
 * The engine is pure and deterministic: state is a function of static config plus
 * an ordered action list. No DOM, network, or framework imports.
 */

import type { CompanyAbility, HexDef } from '$lib/data/types';
import type { TriHex } from './triHex';
export type { CompanyAbility };

export type RoundType = 'auction' | 'mapbuild' | 'stock' | 'operating';

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
  /** Player id, or null while in the initial offering (or owned by a corp). */
  owner: string | null;
  closed: boolean;
  /** Special abilities (copied from static config at setup). */
  abilities: CompanyAbility[];
  /** A one-shot `tile_lay` ability has been used (e.g. Mitsubishi Ferry port). */
  usedAbility?: boolean;
  /** Set when sold to a corporation: a `when:'sold'` tile lay is pending (Ehime). */
  pendingLay?: boolean;
}

export interface CorporationState {
  sym: string;
  name: string;
  color: string;
  coordinates: string;
  /** RoLA: minor vs major (undefined for 1889 corporations). */
  kind?: 'minor' | 'major';
  /** RoLA share denomination / dividend percent per share (minor 20, major 10). */
  shareUnit?: number;
  /** RoLA: set when the price reached 0 and the company dissolved. */
  dissolved?: boolean;
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
  /**
   * Monotonic stamp set each time the share price enters its current market
   * cell. Operating-order ties at the same price break by lowest stamp first
   * (the corporation that reached the cell earliest operates first), mirroring
   * the reference engine's bottom-of-stack-first rule.
   */
  stackSeq: number;
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
  /** Which title's config this state runs under (registry key, e.g. "1889"). */
  title: string;
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
  /** Monotonic counter stamped onto a corporation's `stackSeq` on each price move. */
  priceStack: number;
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
  /** Procedurally-built runtime map (RoLA). When set, overrides config.hexByCoord. */
  map?: Record<string, HexDef>;
  /** How the map was made: 'auto' (algorithm) or 'manual' (player-placed). */
  mapMode?: 'auto' | 'manual';
  /** Active map-build round (RoLA Manual): remaining tile pool + turn order. */
  mapBuild?: { pool: TriHex[]; turn: number; order: string[] };
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
  // RoLA: launch a minor at `price` (a par space) paying `bid` into its treasury.
  | { type: 'launch'; player: string; corp: string; bid: number; price?: number }
  | { type: 'buy'; player: string; corp: string; from: 'ipo' | 'pool' }
  | { type: 'sell'; player: string; corp: string; count: number }
  | { type: 'lay_tile'; player: string; corp: string; hex: string; tile: string; rotation: number }
  | { type: 'place_token'; player: string; corp: string; hex: string }
  | { type: 'place_tri'; player: string; anchor: string; shape: 'A' | 'B' }
  // Run trains. `routes` (optional) is the player's chosen stops per train
  // (ordered revenue-centre hexes); when omitted the engine runs the best routes
  // it can find. `revenue` is advisory only - the engine recomputes it.
  | { type: 'run'; player: string; corp: string; revenue: number; dividend: 'pay' | 'withhold'; routes?: string[][] }
  // Depot buy: `from`/`price` omitted (fixed depot price). Inter-corporation
  // buy: `from` is the selling corporation and `price` the negotiated amount
  // (>= 1, up to the buyer's treasury), allowed between corporations the acting
  // player controls (president of both) - buying from another player's
  // corporation needs their consent, which bots decline. `tradeIn` (optional) is
  // an older train traded toward a diesel for the configured discount.
  | { type: 'buy_train'; player: string; corp: string; train: string; from?: string; price?: number; tradeIn?: string }
  // A corporation buys a private company owned by its OWN president for `price`
  // (>= 1, up to twice the company's face value, and within the buyer's
  // treasury). Income then flows to the corporation. Buying another player's
  // private needs their consent, which bots decline.
  | { type: 'buy_company'; player: string; corp: string; company: string; price: number }
  // Use a private company's special tile-lay ability (Mitsubishi Ferry port tile,
  // or Ehime Railway's green tile on Ohzu after sale to a corporation).
  | { type: 'special_lay'; player: string; company: string; hex: string; tile: string; rotation: number }
  // Exchange a private company for a share of a corporation (Dougo Railway -> IR).
  | { type: 'exchange'; player: string; company: string }
  // Emergency money raising: a president forced to fund a mandatory train sells
  // shares to the pool (emr_sell), or declares bankruptcy when nothing can cover it.
  | { type: 'emr_sell'; player: string; corp: string; count: number }
  | { type: 'declare_bankruptcy'; player: string }
  | { type: 'pass'; player: string };

/** Raised when an action is illegal for the current state. */
export class GameError extends Error {}

export const MIN_BID_INCREMENT = 5;
export const RULES_VERSION = '1889-0.5';
