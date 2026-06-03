/**
 * Deterministic initial state for a game from its title config + seats.
 */

import { configFor, DEFAULT_TITLE } from './registry';
import { GameError, RULES_VERSION, type CompanyState, type CorporationState, type GameState } from './types';
import type { GameConfig } from '$lib/data/types';

export interface Seat {
  id: string;
  name: string;
}

/**
 * RoLA companies: the 12 minors (5 shares: president 40% + 3x20%) and the 6
 * majors (10 shares: 20% + 8x10%), all unlaunched. Built from config.minors /
 * config.majors instead of the 1889-style `corporations`.
 */
function rolaCorporations(cfg: GameConfig): CorporationState[] {
  const make =
    (kind: 'minor' | 'major', shareUnit: number) =>
    (c: { sym: string; name: string; color: string; tokens: number }): CorporationState => ({
      sym: c.sym,
      name: c.name,
      color: c.color,
      coordinates: '', // minor home is a runtime map tile; major home is inherited
      kind,
      shareUnit,
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
      tokens: Array.from({ length: c.tokens }, () => 0),
      stackSeq: 0
    });
  return [
    ...(cfg.minors ?? []).map(make('minor', 20)),
    ...(cfg.majors ?? []).map(make('major', 10))
  ];
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

  // RoLA builds minors/majors; 1889 builds its public corporations.
  const rola = !!cfg.minors;
  const corporations: CorporationState[] = rola
    ? rolaCorporations(cfg)
    : cfg.corporations.map((c) => ({
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
    // RoLA has no initial private auction: it opens in the first stock round
    // (where minors launch). 1889 opens with the waterfall private auction.
    round: rola ? 'stock' : 'auction',
    phase: '2',
    srCount: rola ? 1 : 0,
    orSet: 0,
    priority: 0,
    current: 0,
    priceStack: 0,
    bank: cfg.bankCash - n * cash,
    players,
    companies,
    corporations,
    auction: rola ? null : { available, bids: {}, auctioning: null, cheapest: available[0] },
    stock: rola ? { acted: false, bought: false, passes: 0, soldThisRound: {} } : null,
    or: null,
    depot,
    tiles: {},
    log: [
      rola
        ? 'Stock round 1 begins; minors may launch'
        : `Initial auction begins with ${available.length} private companies`
    ],
    endTriggered: false,
    finished: false,
    winner: null,
    bankrupt: null
  };
}
