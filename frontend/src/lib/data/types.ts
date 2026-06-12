/** Shared types for 1889 static data. */

export type TileColor = 'white' | 'yellow' | 'green' | 'brown' | 'gray' | 'red' | 'blue';

export interface TrainDef {
  /** Rusts-trigger alias: this train counts as `rustGroup` for rust events
   * (RoLA's ∞ shares the 7's pile, so the first ∞ also rusts the 4s). */
  rustGroup?: string;
  /** This roster includes one extra card only at or above this player count. */
  extraForPlayers?: number;
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
  /** RoLA: minor companies have a lower train limit than majors (`trainLimit`). */
  minorTrainLimit?: number;
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
  /** Zone colour for end-game / movement rules (RoLA adds green/purple par bands). */
  zone: 'white' | 'yellow' | 'orange' | 'brown' | 'green' | 'purple';
}

// --- RoLA minors & majors --------------------------------------------------

/** RoLA minor-company abilities (rulebook; see rules-rotla.md §12). */
export type MinorAbility =
  | { type: 'choose_home' } // Adaptive: pick any empty basic-city home at launch
  | { type: 'extra_yellow_after_upgrade' } // Agricultural
  | { type: 'bridge_tiles' } // Bridging: lay a blue bridge tile over water
  | { type: 'skip_blocked_cities' } // Overnight
  | { type: 'boost_stop_if_single_train' } // Express: +1 stop while owning one train
  | { type: 'run_rusted_once' } // Resourceful
  | { type: 'extra_train_slot' } // Spacious: +1 train limit
  | { type: 'extra_token'; placeCost: number } // Expansive
  | { type: 'suburb_tokens'; count: number; bonus: number } // Suburban
  | { type: 'mountain_treasury_gain'; amount: number }; // Tunneling

/** A RoLA minor company (launches, operates, then merges into a major). */
export interface MinorDef {
  sym: string;
  name: string;
  color: string;
  /** Total shares: president (2 shares / 40%) + 3 singles (20%) = 5. */
  shares: number;
  presidentPercent: number;
  /** Dividend paid per share (RoLA minor = 20%). */
  sharePercent: number;
  /** Station tokens (1, or 2 for Expansive). */
  tokens: number;
  /** Tri-hex home tile (1-11), or null when owner's choice (Adaptive). */
  homeTriHex: number | null;
  /** Home hex coordinate on the fixed starter map (until procedural build lands). */
  homeCoord?: string;
  ability?: MinorAbility;
  desc: string;
}

/** A RoLA major corporation (formed by merging minors). */
export interface MajorDef {
  sym: string;
  name: string;
  color: string;
  /** Total shares: president (2 shares / 20%) + 8 singles (10%) = 10. */
  shares: number;
  presidentPercent: number;
  /** Dividend paid per share (RoLA major = 10%). */
  sharePercent: number;
  /** Station tokens (RoLA major = 4). */
  tokens: number;
  /** Hub/token placement costs (printed on the charter); TBD - rules-rotla.md §13. */
  tokenCosts?: number[];
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
  /** Currency symbol for money displays (e.g. "¥"; RoLA uses plain numbers). */
  currency?: string;
  /** End-game triggers (reason + timing), for the info panel. */
  endGame?: Array<{ reason: string; timing: string }>;
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
  /** Stock-market layout: 1889 = 2D 'grid' (default); RoLA = 1-D 'linear' ladder. */
  marketKind?: 'grid' | 'linear';
  /** RoLA: inclusive par-price band [min, max] by phase colour. */
  parBands?: Record<string, [number, number]>;
  /** RoLA tile-lay rule: up to two yellow tiles OR one upgrade per OR turn. */
  doubleYellowOrSingleUpgrade?: boolean;
  /** RoLA: a minor's first OR opens with an optional leadoff train purchase. */
  leadoffTrain?: boolean;
  /** RoLA: companies may issue/redeem one share at the start of their OR turn. */
  issueRedeem?: boolean;
  /** Fixed game length in cycles (RoLA: SR + 2 OR + merger; 2p Short 4 / else 6). */
  cyclesByPlayers?: Record<number, number>;
  /** Export the top depot train before each new SR (RoLA). */
  exportTrains?: boolean;
  /** RoLA: trains may run a single-stop local route inside a hub city. */
  localRoutes?: boolean;
  /** RoLA minor companies (launch, operate, merge). */
  minors?: MinorDef[];
  /** RoLA major corporations (formed by merger). */
  majors?: MajorDef[];
}
