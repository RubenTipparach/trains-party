/**
 * Deterministic initial state for a game from its title config + seats.
 */

import { configFor, DEFAULT_TITLE } from './registry';
import { GameError, RULES_VERSION, type CompanyState, type CorporationState, type GameState } from './types';

export interface Seat {
  id: string;
  name: string;
}

export function initialState(
  seats: Seat[],
  title: string = DEFAULT_TITLE,
  rulesVersion: string = RULES_VERSION
): GameState {
  const cfg = configFor(title);
  const n = seats.length;
  const cash = cfg.startingCash[n];
  if (!cash) throw new GameError(`unsupported player count: ${n}`);

  const players = seats.map((s) => ({ id: s.id, name: s.name, cash, companies: [], shares: {}, passed: false }));

  // Private companies in play: filter by minPlayers (UTF needs 4+), and in a
  // 2-player game South Iyo Railway (SIR) is removed.
  const companies: CompanyState[] = cfg.companies
    .filter((c) => !c.minPlayers || n >= c.minPlayers)
    .filter((c) => !(n === 2 && c.sym === 'SIR'))
    .map((c) => ({
      sym: c.sym,
      name: c.name,
      value: c.value,
      revenue: c.revenue,
      discount: 0,
      owner: null,
      closed: false,
      abilities: c.abilities ? structuredClone(c.abilities) : [],
      usedAbility: false,
      pendingLay: false
    }));

  const available = [...companies].sort((a, b) => a.value - b.value).map((c) => c.sym);

  const corporations: CorporationState[] = cfg.corporations.map((c) => ({
    sym: c.sym,
    name: c.name,
    color: c.color,
    coordinates: c.coordinates,
    floated: false,
    cash: 0,
    ipoShares: 100,
    poolShares: 0,
    president: null,
    parPrice: null,
    priceRow: null,
    priceCol: null,
    trains: [],
    companies: [],
    tokenHexes: [],
    tokens: [...c.tokens],
    stackSeq: 0
  }));

  const depot = cfg.trains.map((t) => ({ name: t.name, remaining: t.num }));

  return {
    title,
    rulesVersion,
    seq: 0,
    round: 'auction',
    phase: '2',
    srCount: 0,
    orSet: 0,
    priority: 0,
    current: 0,
    priceStack: 0,
    bank: cfg.bankCash - n * cash,
    players,
    companies,
    corporations,
    auction: { available, bids: {}, auctioning: null, cheapest: available[0] },
    stock: null,
    or: null,
    depot,
    tiles: {},
    log: [`Initial auction begins with ${available.length} private companies`],
    endTriggered: false,
    finished: false,
    winner: null,
    bankrupt: null
  };
}
