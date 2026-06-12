/**
 * Railways of the Lost Atlas (RoLA) static game data: the single source of truth
 * for cash, trains, the linear stock ladder, phases, the 12 minor companies, the
 * 6 major corporations, and the tile manifest.
 *
 * RoLA has no `tobymao/18xx` port, so values are transcribed from the rulebook
 * (09.12) and validated against the fwtwr.com inventory + the board photos /
 * tile-manifest PDF (see `references/` and `rules-rotla.md` §13). Where a number
 * is still pending the physical components it is marked TODO.
 *
 * The map is built procedurally at runtime (Stage 4), so `hexes` is empty here.
 */

import type {
  GameConfig,
  MajorDef,
  MarketCell,
  MinorDef,
  PhaseDef,
  TileManifestEntry,
  TrainDef
} from './types';
import { HEXES, HEX_BY_COORD, MINOR_HOMES } from './map_rola';

export const TITLE = 'rola';
// RoLA money is shown as plain numbers (the rulebook uses no currency symbol).
export const CURRENCY = '';
export const PUBLISHER = 'Asterisk Games';
export const DESIGNER = 'Jacob Schacht & Kevin Delger';
export const RULEBOOK_URL = 'https://www.asterisk-games.com/s/Railways-Rulebook-0912.pdf';

/** Static end-game triggers (RoLA). */
export const END_GAME: Array<{ reason: string; timing: string }> = [
  { reason: 'A player is bankrupt', timing: 'Immediately' },
  { reason: 'The final cycle ends (4 cycles Short / 6 Long)', timing: 'End of that cycle' }
];

/** Total money in the box (285 cards). The Bank-Break variant uses 8000 instead. */
export const BANK_CASH = 24500;

export const STARTING_CASH: Record<number, number> = {
  2: 450, // Short game only
  3: 300,
  4: 275,
  5: 220
};

/** RoLA has no certificate limit; -1 = unlimited. */
export const CERT_LIMIT: Record<number, number> = { 2: -1, 3: -1, 4: -1, 5: -1 };

// --- Stock market (board-validated linear ladder) --------------------------

/** The 27 ordered spaces, left to right; 0 = the CLOSED space. */
const LADDER = [
  0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 135, 150, 165, 180, 200, 220,
  245, 270, 300, 330, 360, 400, 450, 500
];

/** Par-eligible spaces (the coloured start-zones). */
const PAR_SET = new Set([60, 70, 80, 90, 100, 110, 120, 135]);

function zoneFor(price: number): MarketCell['zone'] {
  if (price >= 60 && price <= 90) return 'yellow';
  if (price >= 100 && price <= 110) return 'green';
  if (price >= 120 && price <= 135) return 'purple';
  return 'white';
}

/** Linear market: a single row of cells (RoLA stacks tokens within a cell). */
export const MARKET: MarketCell[][] = [
  LADDER.map((price) => ({ price, par: PAR_SET.has(price), zone: zoneFor(price) }))
];

/** Par prices available at launch (subset gated by phase, see PAR_BANDS). */
export const PAR_PRICES = [60, 70, 80, 90, 100, 110, 120, 135];

/** A launching minor may par within this inclusive band, by current phase colour. */
export const PAR_BANDS: Record<string, [number, number]> = {
  yellow: [60, 90],
  green: [60, 110],
  purple: [60, 135]
};

// --- Phases ----------------------------------------------------------------
// Era colour advances on the first green (3), purple (5), and grey (7) train.
// RoLA "purple" maps to the engine `brown` tile slot and "grey" to `gray`.
// Train limits differ for minors vs majors (rules-rotla.md §8).

export const PHASES: PhaseDef[] = [
  { name: '2', trainLimit: 2, minorTrainLimit: 2, tiles: ['yellow'], operatingRounds: 2 },
  { name: '3', on: '3', trainLimit: 4, minorTrainLimit: 2, tiles: ['yellow', 'green'], operatingRounds: 2 },
  { name: '4', on: '4', trainLimit: 3, minorTrainLimit: 2, tiles: ['yellow', 'green'], operatingRounds: 2 },
  { name: '5', on: '5', trainLimit: 2, minorTrainLimit: 1, tiles: ['yellow', 'green', 'brown'], operatingRounds: 2 },
  { name: '6', on: '6', trainLimit: 2, minorTrainLimit: 1, tiles: ['yellow', 'green', 'brown'], operatingRounds: 2 },
  { name: '7', on: '7', trainLimit: 2, minorTrainLimit: 1, tiles: ['yellow', 'green', 'brown', 'gray'], operatingRounds: 2 }
];

// --- Trains ----------------------------------------------------------------
// The 7 and the infinity train share one physical pile of 7 cards (7 on the
// front, infinity on the back). The infinity costs 1000, or 800 trading in a
// non-rusted 4/5/6 (modelled as a 200 discount). Shared-pile supply accounting
// is finished in the trains stage (Stage 5).

export const TRAINS: TrainDef[] = [
  { name: '2', distance: 2, price: 100, num: 7, rustsOn: '4' },
  { name: '3', distance: 3, price: 200, num: 5, rustsOn: '6' }, // +1 in the 5-player game
  { name: '4', distance: 4, price: 300, num: 4, rustsOn: '7' },
  { name: '5', distance: 5, price: 450, num: 3 },
  { name: '6', distance: 6, price: 550, num: 2 },
  { name: '7', distance: 7, price: 750, num: 7 },
  {
    name: '∞',
    distance: 999,
    price: 1000,
    num: -1, // same 7-card pile as the 7 (flipped); see note above
    availableOn: '7',
    discount: { '4': 200, '5': 200, '6': 200 }
  }
];

// --- Minor companies (12) --------------------------------------------------
// 5 shares each (president 40% + 3 x 20%), 1 station token (Expansive has 2).
// Home tri-hex tiles and abilities from the fwtwr inventory + rulebook.
// Colours are approximate; confirm against the physical charters.

const MINOR_BASE = { shares: 5, presidentPercent: 40, sharePercent: 20, tokens: 1 } as const;

export const MINORS: MinorDef[] = [
  { sym: 'AD', name: 'Adaptive', color: '#8e6fb0', ...MINOR_BASE, homeTriHex: null,
    ability: { type: 'choose_home' },
    desc: 'Chooses any empty basic-city home space at launch.' },
  { sym: 'AG', name: 'Agricultural', color: '#7ab648', ...MINOR_BASE, homeTriHex: 3,
    ability: { type: 'extra_yellow_after_upgrade' },
    desc: 'May lay an additional yellow tile after upgrading a tile.' },
  { sym: 'BR', name: 'Bridging', color: '#3b8ea5', ...MINOR_BASE, homeTriHex: 9,
    ability: { type: 'bridge_tiles' },
    desc: 'May lay a blue bridge tile over water instead of yellow track.' },
  { sym: 'EM', name: 'Eastern Mining', color: '#9c6b3f', ...MINOR_BASE, homeTriHex: 2,
    desc: 'Special mining home tile with its own upgrade set.' },
  { sym: 'EA', name: 'Expansive', color: '#d98b30', ...MINOR_BASE, tokens: 2, homeTriHex: 1,
    ability: { type: 'extra_token', placeCost: 40 },
    desc: 'Comes with an extra station token, placeable for 40.' },
  { sym: 'ER', name: 'Express', color: '#d6485f', ...MINOR_BASE, homeTriHex: 5,
    ability: { type: 'boost_stop_if_single_train' },
    desc: 'Boosts a train by one stop while it owns only one train.' },
  { sym: 'NP', name: 'Northern Port', color: '#4f86c6', ...MINOR_BASE, homeTriHex: 7,
    desc: 'Special port home tile with its own upgrade set.' },
  { sym: 'OV', name: 'Overnight', color: '#5a5aa0', ...MINOR_BASE, homeTriHex: 10,
    ability: { type: 'skip_blocked_cities' },
    desc: 'May skip blocked cities when tracing routes.' },
  { sym: 'RE', name: 'Resourceful', color: '#3fa39a', ...MINOR_BASE, homeTriHex: 4,
    ability: { type: 'run_rusted_once' },
    desc: 'May run rusted trains once before destroying them.' },
  { sym: 'SP', name: 'Spacious', color: '#c2a23a', ...MINOR_BASE, homeTriHex: 11,
    ability: { type: 'extra_train_slot' },
    desc: 'Train limit +1.' },
  { sym: 'SU', name: 'Suburban', color: '#cf6f9b', ...MINOR_BASE, homeTriHex: 6,
    ability: { type: 'suburb_tokens', count: 2, bonus: 10 },
    desc: 'Comes with 2 suburb tokens (+10 per train that runs through them).' },
  { sym: 'TU', name: 'Tunneling', color: '#c8772f', ...MINOR_BASE, homeTriHex: 8,
    ability: { type: 'mountain_treasury_gain', amount: 60 },
    desc: 'Gains 60 to treasury each time it pays a mountain terrain cost.' }
];

// Fixed starter-map home coordinates (until the procedural map build lands).
for (const m of MINORS) m.homeCoord = MINOR_HOMES[m.sym];

// --- Major corporations (6) ------------------------------------------------
// 10 shares each (president 20% + 8 x 10%), 4 station tokens. Home inherited at
// merger. Token/hub costs are printed on the charters (TODO - rules-rotla.md §13).

const MAJOR_BASE = { shares: 10, presidentPercent: 20, sharePercent: 10, tokens: 4 } as const;

export const MAJORS: MajorDef[] = [
  { sym: 'Con', name: 'Conglomerate', color: '#37383a', ...MAJOR_BASE },
  { sym: 'Exp', name: 'Experiment', color: '#d81e3e', ...MAJOR_BASE },
  { sym: 'Fed', name: 'Federation', color: '#0189d1', ...MAJOR_BASE },
  { sym: 'Int', name: 'International', color: '#76a042', ...MAJOR_BASE },
  { sym: 'Syn', name: 'Syndicate', color: '#f48221', ...MAJOR_BASE },
  { sym: 'Unl', name: 'Unlimited', color: '#6f533e', ...MAJOR_BASE }
];

// --- Tile manifest (base game, no Landmarks expansion) ----------------------
// 128 base tiles. RoLA colours: purple -> brown, grey -> gray, plus blue bridges.
// Counts validated against the fwtwr inventory + the tile-manifest PDF.

export const TILE_MANIFEST: TileManifestEntry[] = [
  // Yellow (55)
  { id: '5', count: 5, color: 'yellow' },
  { id: '6', count: 7, color: 'yellow' },
  { id: '7', count: 6, color: 'yellow' },
  { id: '8', count: 14, color: 'yellow' },
  { id: '9', count: 13, color: 'yellow' },
  { id: '57', count: 7, color: 'yellow' },
  { id: '291', count: 1, color: 'yellow' },
  { id: '292', count: 1, color: 'yellow' },
  { id: '293', count: 1, color: 'yellow' },
  // Green (41)
  { id: '14', count: 4, color: 'green' },
  { id: '15', count: 5, color: 'green' },
  { id: '16', count: 1, color: 'green' },
  { id: '17', count: 1, color: 'green' },
  { id: '19', count: 1, color: 'green' },
  { id: '20', count: 1, color: 'green' },
  { id: '21', count: 1, color: 'green' },
  { id: '22', count: 1, color: 'green' },
  { id: '23', count: 4, color: 'green' },
  { id: '24', count: 4, color: 'green' },
  { id: '25', count: 2, color: 'green' },
  { id: '26', count: 1, color: 'green' },
  { id: '27', count: 1, color: 'green' },
  { id: '28', count: 1, color: 'green' },
  { id: '29', count: 1, color: 'green' },
  { id: '30', count: 1, color: 'green' },
  { id: '31', count: 1, color: 'green' },
  { id: '294', count: 2, color: 'green' },
  { id: '295', count: 2, color: 'green' },
  { id: '296', count: 1, color: 'green' },
  { id: '619', count: 4, color: 'green' },
  { id: '624', count: 1, color: 'green' },
  // Purple / brown (24)
  { id: '39', count: 1, color: 'brown' },
  { id: '40', count: 1, color: 'brown' },
  { id: '41', count: 2, color: 'brown' },
  { id: '42', count: 2, color: 'brown' },
  { id: '43', count: 2, color: 'brown' },
  { id: '44', count: 1, color: 'brown' },
  { id: '45', count: 2, color: 'brown' },
  { id: '46', count: 2, color: 'brown' },
  { id: '47', count: 2, color: 'brown' },
  { id: '70', count: 1, color: 'brown' },
  { id: '125', count: 6, color: 'brown' },
  { id: '297', count: 2, color: 'brown' },
  // Grey (3)
  { id: '51', count: 3, color: 'gray' },
  // Blue bridge (5)
  { id: '721', count: 2 },
  { id: '722', count: 2 },
  { id: '723', count: 1 }
];

/** The RoLA title config the engine consumes (via the registry). */
export const configRola: GameConfig = {
  title: TITLE,
  currency: CURRENCY,
  endGame: END_GAME,
  bankCash: BANK_CASH,
  startingCash: STARTING_CASH,
  certLimit: CERT_LIMIT,
  market: MARKET,
  marketKind: 'linear',
  parPrices: PAR_PRICES,
  parCol: 0, // linear market: par cells live in the single row (see parBands)
  parBands: PAR_BANDS,
  doubleYellowOrSingleUpgrade: true, // rulebook OR step 3: 2 yellow or 1 upgrade
  leadoffTrain: true, // rulebook OR step 1: new minors may buy a train first
  issueRedeem: true, // rulebook OR step 2: issue or redeem one share
  cyclesByPlayers: { 2: 4, 3: 6, 4: 6, 5: 6 }, // Short (2p) = 4 cycles, Long = 6
  exportTrains: true, // rulebook: export the top train before each new SR
  phases: PHASES,
  trains: TRAINS,
  corporations: [], // RoLA uses minors/majors, not 1889-style corporations
  companies: [], // RoLA has no 1889-style private companies
  minors: MINORS,
  majors: MAJORS,
  hexes: HEXES,
  hexByCoord: HEX_BY_COORD,
  tileManifest: TILE_MANIFEST
};
