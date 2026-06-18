/**
 * Trains Party rules engine (TypeScript port of the 18xx engine model).
 *
 * Pure, deterministic, isomorphic: runs in the browser (sandbox / optimistic UI)
 * and on the server (authoritative validation). State is a function of static
 * config plus an ordered action list:
 *
 *     state = actions.reduce(apply, initialState(seats))
 *
 * Stage 2: setup + the private-company waterfall auction. The stock and operating
 * rounds follow.
 */

import { GameError, type GameAction, type GameState } from './types';
import { configFor } from './registry';
import { applyMerger, mergerActivePlayer } from './rolaMerger';
import { applyAuction, auctionActivePlayer, minBid } from './auction';
import { applyStock, applyExchange } from './stock';
import { applyRolaStock } from './rolaRound';
import { applyOperating, operatingActivePlayer, operatingView } from './operating';
import { applyMapBuild, mapBuildActivePlayer } from './mapbuild';

export { initialState } from './setup';
export type { Seat } from './setup';
export { configFor, currencyFor, gameTitles, DEFAULT_TITLE } from './registry';
export * from './types';
export { minBid, auctionActivePlayer, auctionView, maxBidFor } from './auction';
export type { AuctionView, AuctionCompanyView, AuctionPlayerView } from './auction';
export { stockLegalActions, exchangeOptions, currentPrice, canSell, maxSellCount } from './stock';
export { rolaStockLegalActions, maxRolaSell, availableMinors } from './rolaRound';
export { parForBid, launchablePars, MIN_LAUNCH_BID, BID_INCREMENT } from './rolaStock';
export type { RolaStockLegal } from './rolaRound';
export {
  operatingView,
  operatingActivePlayer,
  trackLays,
  tokenPlays,
  corporationsCanBuyPrivates,
  mustBuyTrain,
  emergencyFor,
  cheapestBuyableTrain
} from './operating';
export type { OperatingView } from './operating';
export { legalLays, neighbor, tileSupply, exhaustedTilesOnHex, blockedHexes, specialLayOptions } from './track';
export type { TileLay } from './track';
export { TILES, rotatePaths } from './tiles';
export type { TileDef } from './tiles';
export { playerValue, playerLiquidity } from './metrics';
export { corpRoutes, routeRevenue, connectedRevenue, routeThroughStops, trainReach, TRAIN_ROUTE_COLORS } from './routes';
export type { Route } from './routes';
export { hexesFor } from './board';
export { legalPlacements, placementCoords, isLegalPlacement, generateTriHexPool, BUILD_CENTER } from './triHex';
export type { Placement, TriHex } from './triHex';
export { mapBuildActivePlayer, pickBuildPlacement } from './mapbuild';
export { mergePartners, availableMajors } from './rolaMerger';
export { adaptiveHomes } from './rolaRound';
export { suburbOptions } from './operating';
export { mergerActivePlayer };

/** Apply one action, returning the next state. Pure: the input is not mutated. */
export function apply(state: GameState, action: GameAction): GameState {
  const s: GameState = structuredClone(state);
  if (s.finished) throw new GameError('game is finished');
  // Exchange abilities (e.g. Dougo Railway -> IR) may be used on the owner's turn
  // in any round, so they are handled here rather than inside one round's reducer.
  if (action.type === 'exchange') {
    const active = activePlayer(s);
    if (active !== action.player) throw new GameError(`it is ${active ?? 'nobody'}'s turn, not ${action.player}`);
    if (s.round !== 'stock' && s.round !== 'operating') throw new GameError('cannot exchange a private now');
    applyExchange(s, action);
    s.seq += 1;
    return s;
  }
  switch (s.round) {
    case 'auction':
      applyAuction(s, action);
      break;
    case 'mapbuild':
      applyMapBuild(s, action);
      break;
    case 'stock':
      if (configFor(s.title).minors) applyRolaStock(s, action);
      else applyStock(s, action);
      break;
    case 'operating':
      applyOperating(s, action);
      break;
    case 'merger':
      applyMerger(s, action);
      break;
    default:
      throw new GameError(`round '${s.round}' is not implemented yet`);
  }
  s.seq += 1;
  return s;
}

/** Replay an ordered action list from an initial state. */
export function replay(initial: GameState, actions: readonly GameAction[]): GameState {
  return actions.reduce(apply, initial);
}

/** The id of the player who must act next, or null if none. */
export function activePlayer(state: GameState): string | null {
  if (state.finished) return null;
  if (state.round === 'auction') return auctionActivePlayer(state);
  if (state.round === 'stock' && state.stock) {
    const la = state.stock.launchAuction;
    if (la) return la.turn ?? la.winner;
    return state.players[state.current].id;
  }
  if (state.round === 'operating') return operatingActivePlayer(state);
  if (state.round === 'mapbuild') return mapBuildActivePlayer(state);
  if (state.round === 'merger') return mergerActivePlayer(state);
  return null;
}

export interface LegalAction {
  type: 'bid' | 'pass';
  player: string;
  company?: string;
  /** Minimum legal price for a bid. */
  min?: number;
  /** True when this bid buys the company outright (cheapest at face). */
  buy?: boolean;
}

/** Legal actions available to the active player. */
export function legalActions(state: GameState): LegalAction[] {
  if (state.round !== 'auction' || !state.auction) return [];
  const a = state.auction;
  const player = auctionActivePlayer(state);
  if (a.auctioning) {
    return [
      { type: 'bid', player, company: a.auctioning, min: minBid(state, a.auctioning) },
      { type: 'pass', player }
    ];
  }
  const acts: LegalAction[] = [{ type: 'pass', player }];
  const [cheapest, ...rest] = a.available;
  acts.push({ type: 'bid', player, company: cheapest, min: minBid(state, cheapest), buy: true });
  for (const sym of rest) acts.push({ type: 'bid', player, company: sym, min: minBid(state, sym) });
  return acts;
}
