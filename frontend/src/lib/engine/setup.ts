/**
 * Deterministic initial state for a game from its title config + seats.
 */

import { configFor, DEFAULT_TITLE } from './registry';
import { GameError, RULES_VERSION, type CompanyState, type CorporationState, type GameState } from './types';
import { generateRolaMap } from './genRolaMap';
import { generateTriHexPool, placementCoords, BUILD_CENTER } from './triHex';
import type { GameConfig, HexDef } from '$lib/data/types';

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
    (c: {
      sym: string;
      name: string;
      color: string;
      tokens: number;
      homeCoord?: string;
      ability?: { type: string; placeCost?: number };
    }): CorporationState => ({
      sym: c.sym,
      name: c.name,
      color: c.color,
      coordinates: c.homeCoord ?? '', // minor home hex; majors inherit at merger
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
      // The home token is free; extra tokens (Expansive) cost their printed price.
      tokens: Array.from({ length: c.tokens }, (_, i) => (i === 0 ? 0 : (c.ability?.placeCost ?? 0))),
      stackSeq: 0
    });
  return [
    ...(cfg.minors ?? []).map(make('minor', 20)),
    ...(cfg.majors ?? []).map(make('major', 10))
  ];
}

/** Deterministic Fisher-Yates shuffle from a seed (for the minor matrix). */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function initialState(
  seats: Seat[],
  title: string = DEFAULT_TITLE,
  rulesVersion: string = RULES_VERSION,
  opts: { seed?: number; mapMode?: 'auto' | 'manual'; hostileMergers?: boolean } = {}
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

  // Train supply: extras flagged extraForPlayers only ship with that many
  // players, and a Short (fixed-4-cycle) game removes one of each train except
  // the 7/∞ pile. Unlimited piles (num < 0) are never adjusted.
  const short = (cfg.cyclesByPlayers?.[seats.length] ?? 6) <= 4 && !!cfg.cyclesByPlayers;
  const depot = cfg.trains.map((t) => {
    let n = t.num;
    if (n > 0 && t.extraForPlayers && seats.length < t.extraForPlayers) n -= 1;
    if (n > 0 && short && t.name !== '7') n -= 1;
    return { name: t.name, remaining: n };
  });

  // RoLA: procedurally build the runtime map from the seed. Minors take their
  // generated home cities; without a seed the fixed starter map (config) is used.
  let map: Record<string, HexDef> | undefined;
  let mapMode: 'auto' | 'manual' | undefined;
  let mapBuild: GameState['mapBuild'];
  if (rola && opts.seed) {
    mapMode = opts.mapMode ?? 'auto';
    if (mapMode === 'auto') {
      // Auto: build the whole map procedurally from the seed.
      const gen = generateRolaMap(opts.seed, (cfg.minors ?? []).map((m) => m.sym), n);
      map = gen.hexByCoord;
      for (const c of corporations) {
        if (c.kind === 'minor' && gen.minorHomes[c.sym]) c.coordinates = gen.minorHomes[c.sym];
      }
    } else {
      // Manual: players grow the map. Seed the centre tile, queue the rest, and
      // clear minor homes (assigned when the build finishes).
      const pool = generateTriHexPool(opts.seed, n, (cfg.minors ?? []).length);
      map = {};
      const first = pool.shift()!;
      placementCoords(BUILD_CENTER, 0).forEach((coord, i) => {
        map![coord] = { coord, ...first.cells[i] };
      });
      for (const c of corporations) if (c.kind === 'minor') c.coordinates = '';
      mapBuild = { pool, turn: 0, order: seats.map((seat) => seat.id) };
    }
  }

  // RoLA minor matrix: shuffle the minors into 2 columns (rulebook). Only the
  // bottom (first unlaunched) of each column is launchable; launching reveals the
  // next up the column. Dealt round-robin so each column is ~half the minors.
  let minorMatrix: string[][] | undefined;
  if (rola && opts.seed) {
    const syms = corporations.filter((c) => c.kind === 'minor').map((c) => c.sym);
    const order = seededShuffle(syms, opts.seed ^ 0x5bd1e995);
    const cols = 2;
    minorMatrix = Array.from({ length: cols }, () => [] as string[]);
    order.forEach((sym, i) => minorMatrix![i % cols].push(sym));
  }

  return {
    title,
    rulesVersion,
    seq: 0,
    // RoLA has no initial private auction: it opens in the first stock round
    // (where minors launch). 1889 opens with the waterfall private auction.
    round: mapBuild ? 'mapbuild' : rola ? 'stock' : 'auction',
    phase: '2',
    srCount: rola ? 1 : 0,
    cycle: cfg.cyclesByPlayers ? 1 : undefined,
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
    map,
    mapMode,
    mapBuild,
    minorMatrix,
    hostileMergers: rola ? !!opts.hostileMergers : undefined,
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
