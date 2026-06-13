/**
 * Deterministic procedural map generator for Railways of the Lost Atlas.
 *
 * RoLA's board is assembled from TRI-HEX tiles (pieces covering three mutually
 * adjacent hexes), shared with Manual mode (engine/triHex.ts). Auto mode draws
 * the same deterministic tri-hex pool - including the three Capital Project tiles
 * and enough cities to seat every minor - and lays each tile at a rules-valid,
 * compact placement (>= 3 shared edges), then drops in off-board Distant
 * Destinations along the coast. Same seed -> same map (the seed is part of the
 * game's setup inputs).
 */

import type { HexDef } from '$lib/data/types';
import { generateTriHexPool, legalPlacements, parseCoord } from './triHex';

// edge index -> [dCol, dRow] (matches engine/track.ts EDGE_DELTA).
const EDGE: ReadonlyArray<readonly [number, number]> = [
  [0, 2],
  [-1, 1],
  [-1, -1],
  [0, -2],
  [1, -1],
  [1, 1]
];
const keyOf = (c: number, r: number) => String.fromCharCode(65 + c) + r;

/** Tiny deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GeneratedMap {
  hexByCoord: Record<string, HexDef>;
  /** Minor sym -> home hex coordinate. */
  minorHomes: Record<string, string>;
}

interface Cell {
  c: number;
  r: number;
}

/**
 * Generate a connected RoLA map. `minors` are the minor syms to seat homes for
 * (one home city each). `players` lightly scales the map size.
 */
export function generateRolaMap(seed: number, minors: string[], players = 4): GeneratedMap {
  const rnd = rng(seed || 1);
  const pool = generateTriHexPool(seed, players, minors.length);

  // Coord -> pixel-ish centre, for "compactness" scoring (keeps the map blobby).
  const px = (coord: string) => {
    const { col, row } = parseCoord(coord);
    return { x: col * 1.5, y: row };
  };
  const CENTRE = px('J11');
  const centroidDist = (coords: string[]) => {
    let sx = 0;
    let sy = 0;
    for (const c of coords) {
      const p = px(c);
      sx += p.x;
      sy += p.y;
    }
    const cx = sx / coords.length - CENTRE.x;
    const cy = sy / coords.length - CENTRE.y;
    return Math.hypot(cx, cy);
  };

  // 1. Lay every tri-hex tile at a legal placement, preferring compact spots
  //    (one of the few most-central legal placements, chosen by the seed).
  const map: Record<string, HexDef> = {};
  for (const tile of pool) {
    const places = legalPlacements(map);
    if (places.length === 0) break;
    const scored = places
      .map((p) => ({ p, d: centroidDist(p.coords) }))
      .sort((a, b) => a.d - b.d);
    const topK = scored.slice(0, Math.min(scored.length, 4));
    const choice = topK[Math.floor(rnd() * topK.length)].p;
    choice.coords.forEach((coord, i) => {
      map[coord] = { coord, ...structuredClone(tile.cells[i]) };
    });
  }

  const coords = Object.keys(map);
  const nbCount = (coord: string) => {
    const { col, row } = parseCoord(coord);
    return EDGE.reduce((n, [dc, dr]) => n + (map[keyOf(col + dc, row + dr)] ? 1 : 0), 0);
  };
  const edgeIndexToLand = (coord: string) => {
    const { col, row } = parseCoord(coord);
    return EDGE.findIndex(([dc, dr]) => map[keyOf(col + dc, row + dr)]);
  };

  // 2. Distant Destinations: turn a few blank coastal hexes (fewest neighbours)
  //    into off-board red areas with a path back toward the land.
  const ddTiers = [
    { yellow: 30, green: 40, brown: 50, gray: 60 },
    { yellow: 20, green: 30, brown: 40, gray: 50 },
    { yellow: 30, green: 50, brown: 70, gray: 90 }
  ];
  const blanks = coords.filter((c) => {
    const h = map[c];
    return h.cities.length === 0 && h.towns.length === 0 && !h.terrain && !h.offboard;
  });
  const perimeter = blanks
    .map((c) => ({ c, n: nbCount(c) }))
    .filter((x) => x.n > 0 && x.n <= 3)
    .sort((a, b) => a.n - b.n || (rnd() - 0.5));
  for (let i = 0; i < Math.min(3, perimeter.length); i++) {
    const coord = perimeter[i].c;
    const h = map[coord];
    h.color = 'red';
    h.offboard = { revenue: ddTiers[i % ddTiers.length] };
    const e = edgeIndexToLand(coord);
    if (e >= 0) h.paths.push({ a: e, b: 'center' });
  }

  // 3. Seat each minor on a (non-capital) city hex and name it.
  const homeCells = coords.filter((c) => map[c].cities.some((ci) => !ci.capital) && !map[c].offboard);
  // shuffle deterministically
  for (let i = homeCells.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [homeCells[i], homeCells[j]] = [homeCells[j], homeCells[i]];
  }
  const minorHomes: Record<string, string> = {};
  minors.forEach((sym, i) => {
    const coord = homeCells[i];
    if (coord) {
      minorHomes[sym] = coord;
      map[coord].name = sym;
    }
  });

  return { hexByCoord: map, minorHomes };
}