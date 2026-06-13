/**
 * Tri-hex tiles for Railways of the Lost Atlas manual map building.
 *
 * RoLA's board is assembled from tri-hex tiles: pieces covering three mutually
 * adjacent hexes. In Manual mode players (and bots) place these one at a time to
 * grow a connected map. A tile here is just three hex contents; the player picks
 * where (an anchor coord) and which of two triangle orientations to lay it in.
 *
 * Geometry is the standard flat-top doubled-coordinate grid ((col+row) even),
 * matching engine/track.ts EDGE deltas.
 */
import type { HexDef } from '$lib/data/types';

/** edge index -> [dCol, dRow]. */
const EDGE: ReadonlyArray<readonly [number, number]> = [
  [0, 2],
  [-1, 1],
  [-1, -1],
  [0, -2],
  [1, -1],
  [1, 1]
];

/** A tri-hex tile: three hex contents (coords assigned on placement). */
export interface TriHex {
  cells: Omit<HexDef, 'coord'>[];
}

/** A concrete legal placement: an anchor (pivot hex) + rotation (0..5) + its coords. */
export interface Placement {
  anchor: string;
  rotation: number;
  coords: string[];
}

/** Central hex the first tile seeds from (even (col+row) parity, like the maps). */
export const BUILD_CENTER = 'J11';

export function parseCoord(coord: string): { col: number; row: number } {
  const m = coord.match(/^([A-Z])(\d+)$/);
  if (!m) return { col: -1, row: -1 };
  return { col: m[1].charCodeAt(0) - 65, row: parseInt(m[2], 10) };
}
export const fmtCoord = (col: number, row: number) => String.fromCharCode(65 + col) + row;
const onGrid = (col: number, row: number) => col >= 0 && col < 26 && row >= 1;
const norm6 = (r: number) => ((r % 6) + 6) % 6;

/**
 * The three coords a tri-hex covers at `anchor` rotated `rotation` 60-degree steps:
 * the anchor (pivot) hex plus the two adjacent hexes at edges r and r+1. Rotating
 * therefore pivots the whole tile around the anchor through 6 orientations.
 */
export function placementCoords(anchor: string, rotation: number): string[] {
  const { col, row } = parseCoord(anchor);
  const r = norm6(rotation);
  const a = EDGE[r];
  const b = EDGE[(r + 1) % 6];
  return [fmtCoord(col, row), fmtCoord(col + a[0], row + a[1]), fmtCoord(col + b[0], row + b[1])];
}

const neighbours = (coord: string): string[] => {
  const { col, row } = parseCoord(coord);
  return EDGE.map(([dc, dr]) => fmtCoord(col + dc, row + dr));
};
/** Does `coord` touch the existing map by an edge? */
export const touchesMap = (coord: string, map: Record<string, HexDef>) =>
  neighbours(coord).some((n) => map[n]);

/** Number of edges a placement's hexes share with already-placed (existing) hexes. */
function sharedEdges(coords: string[], map: Record<string, HexDef>): number {
  let n = 0;
  for (const c of coords) {
    const { col, row } = parseCoord(c);
    for (const [dc, dr] of EDGE) if (map[fmtCoord(col + dc, row + dr)]) n++;
  }
  return n;
}

/**
 * Whether laying a tile at (anchor, rotation) is legal: on-grid, no overlap, and
 * (rulebook) sharing AT LEAST THREE edges with already-placed map tiles.
 */
export function isLegalPlacement(map: Record<string, HexDef>, anchor: string, rotation: number): boolean {
  const coords = placementCoords(anchor, rotation);
  if (coords.some((c) => !onGrid(parseCoord(c).col, parseCoord(c).row))) return false;
  if (coords.some((c) => map[c])) return false; // no overlap
  if (Object.keys(map).length === 0) return true; // first tile
  return sharedEdges(coords, map) >= 3; // rulebook: >= 3 shared edges
}

/** All legal placements for the next tile against the current map. */
export function legalPlacements(map: Record<string, HexDef>): Placement[] {
  if (Object.keys(map).length === 0) {
    return [{ anchor: BUILD_CENTER, rotation: 0, coords: placementCoords(BUILD_CENTER, 0) }];
  }
  const cols = Object.keys(map).map((k) => parseCoord(k).col);
  const rows = Object.keys(map).map((k) => parseCoord(k).row);
  const minC = Math.min(...cols) - 2;
  const maxC = Math.max(...cols) + 2;
  const minR = Math.min(...rows) - 3;
  const maxR = Math.max(...rows) + 3;
  const out: Placement[] = [];
  const seen = new Set<string>();
  for (let col = Math.max(0, minC); col <= maxC; col++) {
    for (let row = Math.max(1, minR); row <= maxR; row++) {
      if ((col + row) % 2 !== 0) continue;
      const anchor = fmtCoord(col, row);
      if (map[anchor]) continue;
      for (let rotation = 0; rotation < 6; rotation++) {
        if (!isLegalPlacement(map, anchor, rotation)) continue;
        const coords = placementCoords(anchor, rotation);
        const key = [...coords].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ anchor, rotation, coords });
      }
    }
  }
  return out;
}

/** Tiny deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CONTENT: Record<string, () => Omit<HexDef, 'coord'>> = {
  city: () => ({ color: 'white', cities: [{ revenue: 0, slots: 1 }], towns: [], paths: [], icons: [] }),
  // Capital City (Capital Project tile): a starred city. Exactly three exist.
  // (slots/revenue are placeholders pending the physical overlay-tile numbers.)
  capital: () => ({ color: 'white', cities: [{ revenue: 0, slots: 2, capital: true }], towns: [], paths: [], icons: [] }),
  town: () => ({ color: 'white', cities: [], towns: [{ revenue: 0 }], paths: [], icons: [] }),
  mountain: () => ({ color: 'white', cities: [], towns: [], paths: [], icons: [], terrain: ['mountain'], upgradeCost: 40 }),
  water: () => ({ color: 'white', cities: [], towns: [], paths: [], icons: [], terrain: ['water'], upgradeCost: 40 }),
  blank: () => ({ color: 'white', cities: [], towns: [], paths: [], icons: [] })
};

/** The three Capital City Project tiles, per the rulebook. */
export const CAPITAL_COUNT = 3;

/**
 * A deterministic pool of tri-hex tiles. Guarantees at least `minorCount` city
 * hexes (so every minor can be seated a home after the map is built) and exactly
 * three Capital Cities (the Capital Project tiles).
 */
export function generateTriHexPool(seed: number, players: number, minorCount: number): TriHex[] {
  const rnd = rng(seed || 1);
  const poolSize = 11 + players; // ~14-16 tiles -> 42-48 hexes
  const total = poolSize * 3;
  const capitals = CAPITAL_COUNT;
  const cities = minorCount + 4;
  const towns = Math.round(total * 0.12);
  const mountains = Math.round(total * 0.16);
  const water = Math.round(total * 0.08);
  const blanks = Math.max(0, total - capitals - cities - towns - mountains - water);
  const flat: string[] = [
    ...Array(capitals).fill('capital'),
    ...Array(cities).fill('city'),
    ...Array(towns).fill('town'),
    ...Array(mountains).fill('mountain'),
    ...Array(water).fill('water'),
    ...Array(blanks).fill('blank')
  ];
  // seeded Fisher-Yates
  for (let i = flat.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [flat[i], flat[j]] = [flat[j], flat[i]];
  }
  const pool: TriHex[] = [];
  for (let i = 0; i < flat.length; i += 3) {
    pool.push({ cells: flat.slice(i, i + 3).map((k) => CONTENT[k]()) });
  }
  return pool;
}
