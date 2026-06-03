/**
 * Deterministic procedural map generator for Railways of the Lost Atlas.
 *
 * RoLA's board is assembled from tri-hex tiles; until we have the real tile art
 * this builds a rules-valid synthetic map from a seed: a connected blob of hexes
 * on the standard flat-top doubled-coordinate grid ((col+row) even), seeded with
 * the published feature mix (12 minor home cities, extra cities, towns, mountains,
 * water, and off-board Distant Destinations). Same seed -> same map, so it fits
 * the deterministic engine (the seed is part of the game's setup inputs).
 *
 * `Auto` mode uses this directly; `Manual` mode will let players place tri-hex
 * groups, but reuses the same hex content model.
 */

import type { HexDef } from '$lib/data/types';

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
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

  // 1. Grow a connected blob from a central hex.
  const target = 26 + players * 3 + minors.length; // ~50 hexes
  const start: Cell = { c: 7, r: 9 }; // col H, row 9 -> (7+9) even
  const set = new Map<string, Cell>([[keyOf(start.c, start.r), start]]);
  let guard = 0;
  while (set.size < target && guard++ < 20000) {
    const base = pick([...set.values()]);
    const [dc, dr] = pick(EDGE as unknown as Array<[number, number]>);
    const c = base.c + dc;
    const r = base.r + dr;
    if (c < 0 || r < 1) continue;
    const k = keyOf(c, r);
    if (!set.has(k)) set.set(k, { c, r });
  }

  const cells = [...set.values()];
  const neighbours = (cell: Cell): string[] =>
    EDGE.map(([dc, dr]) => keyOf(cell.c + dc, cell.r + dr)).filter((k) => set.has(k));
  const edgeIndexTo = (cell: Cell): number =>
    EDGE.findIndex(([dc, dr]) => set.has(keyOf(cell.c + dc, cell.r + dr)));

  // 2. Classify: perimeter cells (fewest neighbours) host off-board areas; the
  //    interior hosts homes/cities/towns/terrain.
  const interior = cells.filter((c) => neighbours(c).length >= 4);
  const perimeter = cells.filter((c) => neighbours(c).length < 4 && neighbours(c).length > 0);
  // Deterministic shuffle.
  const shuffle = <T>(a: T[]): T[] => {
    const out = [...a];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  const homeCells = shuffle(interior.length >= minors.length ? interior : cells).slice(0, minors.length);
  const homeKeys = new Set(homeCells.map((c) => keyOf(c.c, c.r)));
  const offCells = shuffle(perimeter).slice(0, 3);
  const offKeys = new Set(offCells.map((c) => keyOf(c.c, c.r)));

  const remaining = shuffle(cells.filter((c) => !homeKeys.has(keyOf(c.c, c.r)) && !offKeys.has(keyOf(c.c, c.r))));
  const take = (n: number) => remaining.splice(0, n);
  const cityCells = take(Math.round(cells.length * 0.12));
  const townCells = take(Math.round(cells.length * 0.1));
  const mountainCells = take(Math.round(cells.length * 0.18));
  const waterCells = take(Math.round(cells.length * 0.1));
  const cityKeys = new Set(cityCells.map((c) => keyOf(c.c, c.r)));
  const townKeys = new Set(townCells.map((c) => keyOf(c.c, c.r)));
  const mtnKeys = new Set(mountainCells.map((c) => keyOf(c.c, c.r)));
  const waterKeys = new Set(waterCells.map((c) => keyOf(c.c, c.r)));

  const ddTiers = [
    { yellow: 30, green: 40, brown: 50, gray: 60 },
    { yellow: 20, green: 30, brown: 40, gray: 50 },
    { yellow: 30, green: 50, brown: 70, gray: 90 }
  ];

  // 3. Build HexDef records.
  const hexByCoord: Record<string, HexDef> = {};
  const base = (coord: string, color: HexDef['color']): HexDef => ({
    coord,
    color,
    cities: [],
    towns: [],
    paths: [],
    icons: []
  });
  for (const cell of cells) {
    const coord = keyOf(cell.c, cell.r);
    if (offKeys.has(coord)) {
      const h = base(coord, 'red');
      const tier = ddTiers[offCells.findIndex((o) => keyOf(o.c, o.r) === coord) % ddTiers.length];
      h.offboard = { revenue: tier };
      const e = edgeIndexTo(cell);
      if (e >= 0) h.paths.push({ a: e, b: 'center' });
      hexByCoord[coord] = h;
    } else if (homeKeys.has(coord) || cityKeys.has(coord)) {
      const h = base(coord, 'white');
      h.cities.push({ revenue: 0, slots: 1 });
      hexByCoord[coord] = h;
    } else if (townKeys.has(coord)) {
      const h = base(coord, 'white');
      h.towns.push({ revenue: 0 });
      hexByCoord[coord] = h;
    } else if (mtnKeys.has(coord)) {
      const h = base(coord, 'white');
      h.terrain = ['mountain'];
      h.upgradeCost = 40;
      hexByCoord[coord] = h;
    } else if (waterKeys.has(coord)) {
      const h = base(coord, 'white');
      h.terrain = ['water'];
      h.upgradeCost = 40;
      hexByCoord[coord] = h;
    } else {
      hexByCoord[coord] = base(coord, 'white');
    }
  }

  // 4. Map each minor to a home coordinate + name the home hexes.
  const minorHomes: Record<string, string> = {};
  homeCells.forEach((cell, i) => {
    const coord = keyOf(cell.c, cell.r);
    if (minors[i]) {
      minorHomes[minors[i]] = coord;
      hexByCoord[coord].name = minors[i];
    }
  });

  return { hexByCoord, minorHomes };
}
