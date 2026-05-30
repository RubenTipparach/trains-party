/**
 * 1889 static game data: the single source of truth for cash, trains, the stock
 * market, phases, corporations, and private companies.
 *
 * Transcribed faithfully from the reference engine:
 *   https://github.com/tobymao/18xx/tree/master/lib/engine/game/g_1889
 * If a number is not here, it does not exist yet. The Shikoku map lives in
 * ./map1889.ts.
 */

import type {
  CompanyDef,
  CorporationDef,
  MarketCell,
  PhaseDef,
  TrainDef
} from './types';

export const TITLE = '1889';
export const CURRENCY = '¥';

export const BANK_CASH = 7000;

export const STARTING_CASH: Record<number, number> = {
  2: 420,
  3: 420,
  4: 420,
  5: 390,
  6: 390
};

export const CERT_LIMIT: Record<number, number> = {
  2: 25,
  3: 19,
  4: 14,
  5: 12,
  6: 11
};

// --- Stock market ----------------------------------------------------------

const MARKET_RAW: string[][] = [
  ['75', '80', '90', '100p', '110', '125', '140', '155', '175', '200', '225', '255', '285', '315', '350'],
  ['70', '75', '80', '90p', '100', '110', '125', '140', '155', '175', '200', '225', '255', '285', '315'],
  ['65', '70', '75', '80p', '90', '100', '110', '125', '140', '155', '175', '200'],
  ['60', '65', '70', '75p', '80', '90', '100', '110', '125', '140'],
  ['55', '60', '65', '70p', '75', '80', '90', '100'],
  ['50y', '55', '60', '65p', '70', '75', '80'],
  ['45y', '50y', '55', '60', '65', '70'],
  ['40y', '45y', '50y', '55', '60'],
  ['30o', '40y', '45y', '50y'],
  ['20o', '30o', '40y', '45y'],
  ['10o', '20o', '30o', '40y']
];

function parseCell(raw: string): MarketCell {
  let zone: MarketCell['zone'] = 'white';
  let par = false;
  let s = raw;
  if (s.endsWith('p')) {
    par = true;
    s = s.slice(0, -1);
  } else if (s.endsWith('y')) {
    zone = 'yellow';
    s = s.slice(0, -1);
  } else if (s.endsWith('o')) {
    zone = 'orange';
    s = s.slice(0, -1);
  } else if (s.endsWith('b')) {
    zone = 'brown';
    s = s.slice(0, -1);
  }
  return { price: parseInt(s, 10), par, zone };
}

export const MARKET: MarketCell[][] = MARKET_RAW.map((row) => row.map(parseCell));

/** Par prices available at game start (the 'p' cells along the diagonal). */
export const PAR_PRICES = [100, 90, 80, 75, 70, 65];

// --- Phases ----------------------------------------------------------------

export const PHASES: PhaseDef[] = [
  { name: '2', trainLimit: 4, tiles: ['yellow'], operatingRounds: 1 },
  { name: '3', on: '3', trainLimit: 4, tiles: ['yellow', 'green'], operatingRounds: 2, canBuyCompanies: true },
  { name: '4', on: '4', trainLimit: 3, tiles: ['yellow', 'green'], operatingRounds: 2, canBuyCompanies: true },
  { name: '5', on: '5', trainLimit: 2, tiles: ['yellow', 'green', 'brown'], operatingRounds: 3 },
  { name: '6', on: '6', trainLimit: 2, tiles: ['yellow', 'green', 'brown'], operatingRounds: 3 },
  { name: 'D', on: 'D', trainLimit: 2, tiles: ['yellow', 'green', 'brown'], operatingRounds: 3 }
];

// --- Trains ----------------------------------------------------------------

export const TRAINS: TrainDef[] = [
  { name: '2', distance: 2, price: 80, num: 6, rustsOn: '4' },
  { name: '3', distance: 3, price: 180, num: 5, rustsOn: '6' },
  { name: '4', distance: 4, price: 300, num: 4, rustsOn: 'D' },
  { name: '5', distance: 5, price: 450, num: 3, closesCompanies: true },
  { name: '6', distance: 6, price: 630, num: 2 },
  { name: 'D', distance: 999, price: 1100, num: -1, availableOn: '6' }
];

// --- Corporations ----------------------------------------------------------

export const CORPORATIONS: CorporationDef[] = [
  { sym: 'AR', name: 'Awa Railroad', color: '#37383a', coordinates: 'K8', tokens: [0, 40], floatPercent: 50 },
  { sym: 'IR', name: 'Iyo Railway', color: '#f48221', coordinates: 'E2', tokens: [0, 40], floatPercent: 50 },
  { sym: 'SR', name: 'Sanuki Railway', color: '#76a042', coordinates: 'I2', tokens: [0, 40], floatPercent: 50 },
  { sym: 'KO', name: 'Takamatsu & Kotohira Electric Railway', color: '#d81e3e', coordinates: 'K4', tokens: [0, 40], floatPercent: 50 },
  { sym: 'TR', name: 'Tosa Electric Railway', color: '#00a993', coordinates: 'F9', tokens: [0, 40, 40], floatPercent: 50 },
  { sym: 'KU', name: 'Tosa Kuroshio Railway', color: '#0189d1', coordinates: 'C10', tokens: [0], floatPercent: 50 },
  { sym: 'UR', name: 'Uwajima Railway', color: '#6f533e', coordinates: 'B7', tokens: [0, 40, 40], floatPercent: 50 }
];

// --- Private companies ------------------------------------------------------

export const COMPANIES: CompanyDef[] = [
  { sym: 'TR', name: 'Takamatsu E-Railroad', value: 20, revenue: 5, desc: 'Blocks Takamatsu (K4) while owned by a player.' },
  {
    sym: 'MF',
    name: 'Mitsubishi Ferry',
    value: 30,
    revenue: 5,
    desc: 'Player owner may place the port tile on a coastal town (B11, G10, I12, or J9) without a tile on it already. Does not close the company.'
  },
  {
    sym: 'ER',
    name: 'Ehime Railway',
    value: 40,
    revenue: 10,
    desc: 'When sold to a corporation, the selling player may immediately place a green tile on Ohzu (C4). Blocks C4 while owned by a player.'
  },
  {
    sym: 'SMR',
    name: 'Sumitomo Mines Railway',
    value: 50,
    revenue: 15,
    desc: 'Owning corporation may ignore the building cost for mountain hexes which do not also contain rivers.'
  },
  {
    sym: 'DR',
    name: 'Dougo Railway',
    value: 60,
    revenue: 15,
    desc: 'Owning player may exchange this private for a 10% share of Iyo Railway (IR) from the initial offering.'
  },
  { sym: 'SIR', name: 'South Iyo Railway', value: 80, revenue: 20, desc: 'No special abilities.' },
  {
    sym: 'UTF',
    name: 'Uno-Takamatsu Ferry',
    value: 150,
    revenue: 30,
    minPlayers: 4,
    desc: 'Does not close while owned by a player. If still owned when the first 5-train is bought, it can no longer be sold to a corporation and its revenue rises to 50.'
  }
];

/** Private companies in play for a given player count (full game). */
export function companiesForPlayers(players: number): CompanyDef[] {
  return COMPANIES.filter((c) => !c.minPlayers || players >= c.minPlayers);
}
