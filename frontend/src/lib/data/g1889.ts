/**
 * 1889 static game data: the single source of truth for cash, trains, the stock
 * market, the map, and companies. Transcribe values from the reference engine at
 * https://github.com/tobymao/18xx/tree/master/lib/engine/game/g_1889 as Stage 1
 * fills this out. If a number is not here, it does not exist yet.
 */

export const TITLE = '1889';

export const STARTING_CASH: Record<number, number> = {
  2: 420,
  3: 420,
  4: 420,
  5: 390,
  6: 390
};

export const BANK_CASH = 7000;

export const CERT_LIMIT: Record<number, number> = {
  2: 25,
  3: 19,
  4: 14,
  5: 12,
  6: 11
};

export interface TrainDef {
  name: string;
  cost: number;
  quantity: number; // -1 = unlimited
  rustsOn?: string;
}

export const TRAINS: TrainDef[] = [
  { name: '2', cost: 80, quantity: 6, rustsOn: '4' },
  { name: '3', cost: 180, quantity: 5, rustsOn: '6' },
  { name: '4', cost: 300, quantity: 4, rustsOn: 'D' },
  { name: '5', cost: 450, quantity: 3 },
  { name: '6', cost: 630, quantity: 2 },
  { name: 'D', cost: 1100, quantity: -1 }
];

// Corporations, private companies, hex map, and the stock-market grid are
// transcribed in Stage 1.
