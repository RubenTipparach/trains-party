/**
 * Deterministic initial state for an 1889 game from static config + seats.
 */

import { STARTING_CASH, BANK_CASH, COMPANIES, CORPORATIONS } from '$lib/data/g1889';
import { GameError, RULES_VERSION, type CompanyState, type CorporationState, type GameState } from './types';

export interface Seat {
  id: string;
  name: string;
}

export function initialState(seats: Seat[], rulesVersion: string = RULES_VERSION): GameState {
  const n = seats.length;
  const cash = STARTING_CASH[n];
  if (!cash) throw new GameError(`unsupported player count: ${n}`);

  const players = seats.map((s) => ({ id: s.id, name: s.name, cash, companies: [], shares: {}, passed: false }));

  // Private companies in play: filter by minPlayers (UTF needs 4+), and in a
  // 2-player game South Iyo Railway (SIR) is removed.
  const companies: CompanyState[] = COMPANIES.filter((c) => !c.minPlayers || n >= c.minPlayers)
    .filter((c) => !(n === 2 && c.sym === 'SIR'))
    .map((c) => ({ sym: c.sym, name: c.name, value: c.value, revenue: c.revenue, discount: 0, owner: null, closed: false }));

  const available = [...companies].sort((a, b) => a.value - b.value).map((c) => c.sym);

  const corporations: CorporationState[] = CORPORATIONS.map((c) => ({
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
    priceCol: null
  }));

  return {
    rulesVersion,
    seq: 0,
    round: 'auction',
    phase: '2',
    priority: 0,
    current: 0,
    bank: BANK_CASH - n * cash,
    players,
    companies,
    corporations,
    auction: { available, bids: {}, auctioning: null, cheapest: available[0] },
    stock: null,
    log: [`Initial auction begins with ${available.length} private companies`],
    finished: false
  };
}
