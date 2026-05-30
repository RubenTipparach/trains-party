/** Shared types for 1889 static data. */

export type TileColor = 'white' | 'yellow' | 'green' | 'brown' | 'gray' | 'red';

export interface TrainDef {
  name: string;
  distance: number;
  price: number;
  /** -1 = unlimited. */
  num: number;
  rustsOn?: string;
  availableOn?: string;
  /** e.g. closes private companies. */
  closesCompanies?: boolean;
}

export interface PhaseDef {
  name: string;
  /** Train name whose purchase triggers this phase (undefined for the first). */
  on?: string;
  trainLimit: number;
  tiles: TileColor[];
  operatingRounds: number;
  canBuyCompanies?: boolean;
}

export interface CorporationDef {
  sym: string;
  name: string;
  color: string;
  /** Home hex coordinate. */
  coordinates: string;
  /** Token costs; length = number of station tokens. */
  tokens: number[];
  floatPercent: number;
}

export interface CompanyDef {
  sym: string;
  name: string;
  value: number;
  revenue: number;
  desc: string;
  /** Minimum player count for this private to be in the game. */
  minPlayers?: number;
}

/** A parsed stock-market cell. */
export interface MarketCell {
  price: number;
  /** Par-eligible cell. */
  par: boolean;
  /** Zone colour for end-game / movement rules. */
  zone: 'white' | 'yellow' | 'orange' | 'brown';
}

// --- Map -------------------------------------------------------------------

export interface CityPart {
  revenue: number;
  slots: number;
}

export interface TownPart {
  revenue: number;
}

export interface PathPart {
  /** Edge index 0..5, or 'center' for a stop. */
  a: number | 'center';
  /** Edge index 0..5, or 'center' for a stop. */
  b: number | 'center';
}

export interface OffboardPart {
  /** Revenue keyed by phase tier, e.g. { yellow: 30, brown: 60, diesel: 100 }. */
  revenue: Record<string, number>;
}

export interface HexDef {
  coord: string;
  color: TileColor;
  name?: string;
  cities: CityPart[];
  towns: TownPart[];
  paths: PathPart[];
  offboard?: OffboardPart;
  label?: string;
  /** Upgrade / build cost (mountains, water). */
  upgradeCost?: number;
  /** Terrain types contributing to the cost. */
  terrain?: string[];
  /** Icon ids printed on the hex (e.g. "port"). */
  icons: string[];
}
