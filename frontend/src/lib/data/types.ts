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
  /** Trade-in discount when upgrading from older trains, keyed by train name. */
  discount?: Record<string, number>;
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

/**
 * Private-company special abilities, transcribed from the reference
 * (lib/engine/game/g_1889/entities.rb). The engine reads these directly so the
 * data stays the single source of truth.
 */
export type CompanyAbility =
  /** Blocks tile lays / token placement on `hexes` while owned by a player. */
  | { type: 'blocks_hexes'; hexes: string[] }
  /**
   * Lets the owner lay one of `tiles` on one of `hexes`, bypassing connectivity.
   * `when: 'track'` = the owning player, during a corporation they preside over
   * laying track. `when: 'sold'` = the corporation that bought the private, once.
   */
  | { type: 'tile_lay'; hexes: string[]; tiles: string[]; ownerType: 'player' | 'corporation'; when: 'track' | 'sold' }
  /** The owning corporation ignores `discount` of build cost on `terrain` hexes. */
  | { type: 'tile_discount'; terrain: string; discount: number }
  /** The owning player may exchange the private for a 10% share of `corp`. */
  | { type: 'exchange'; corp: string; from: 'ipo' }
  /** The private is not closed by the 5-train (or any phase). */
  | { type: 'never_closes' }
  /**
   * The private's revenue changes to `revenue` when `onPhase` begins. If
   * `noCorpSale`, it may no longer be sold to a corporation from that phase on.
   */
  | { type: 'revenue_change'; onPhase: string; revenue: number; noCorpSale?: boolean };

export interface CompanyDef {
  sym: string;
  name: string;
  value: number;
  revenue: number;
  desc: string;
  /** Minimum player count for this private to be in the game. */
  minPlayers?: number;
  /** Special abilities (see CompanyAbility). */
  abilities?: CompanyAbility[];
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

/** Available tile manifest entry (id -> count). */
export interface TileManifestEntry {
  id: string;
  count: number;
  /** Colour only where the source states it (the beginner tiles). */
  color?: TileColor;
}

// --- Per-title config ------------------------------------------------------

/**
 * Everything the engine needs to run one 18xx title. The engine reads this via
 * the title registry (by `GameState.title`) instead of importing a specific
 * game's data module, so the reducers stay title-agnostic.
 */
export interface GameConfig {
  /** Registry key / id, e.g. "1889". */
  title: string;
  bankCash: number;
  startingCash: Record<number, number>;
  certLimit: Record<number, number>;
  market: MarketCell[][];
  parPrices: number[];
  /** Market column the par cells live in. */
  parCol: number;
  phases: PhaseDef[];
  trains: TrainDef[];
  corporations: CorporationDef[];
  companies: CompanyDef[];
  hexes: HexDef[];
  hexByCoord: Record<string, HexDef>;
  tileManifest: TileManifestEntry[];
}
