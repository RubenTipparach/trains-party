/**
 * Tile definitions (track tiles laid during operating rounds).
 *
 * Codes are transcribed from the reference catalog
 * (lib/engine/config/tile.rb). A path endpoint is an edge index (0-5) or 'c'
 * (the tile's city/town centre). This first track-laying pass covers the yellow
 * tiles; green/brown upgrades follow.
 */

import type { TileColor } from '$lib/data/types';

export type TileEnd = number | 'c';
export interface TilePath {
  a: TileEnd;
  b: TileEnd;
}
export interface TileDef {
  id: string;
  color: TileColor;
  /** 1 if the tile has a city, else 0. */
  cities: number;
  /** 1 if the tile has a town, else 0. */
  towns: number;
  revenue: number;
  paths: TilePath[];
  label?: string;
}

const YELLOW_CODES: Record<string, string> = {
  '3': 'town=revenue:10;path=a:0,b:_0;path=a:_0,b:1',
  '4': 'town=revenue:10;path=a:0,b:_0;path=a:_0,b:3',
  '5': 'city=revenue:20;path=a:0,b:_0;path=a:1,b:_0',
  '6': 'city=revenue:20;path=a:0,b:_0;path=a:2,b:_0',
  '7': 'path=a:0,b:1',
  '8': 'path=a:0,b:2',
  '9': 'path=a:0,b:3',
  '57': 'city=revenue:20;path=a:0,b:_0;path=a:_0,b:3',
  '58': 'town=revenue:10;path=a:0,b:_0;path=a:_0,b:2'
};

function end(v: string): TileEnd {
  return v === '_0' ? 'c' : parseInt(v, 10);
}

function parseTile(id: string, color: TileColor, code: string): TileDef {
  const def: TileDef = { id, color, cities: 0, towns: 0, revenue: 0, paths: [] };
  for (const token of code.split(';').filter(Boolean)) {
    const eq = token.indexOf('=');
    const key = token.slice(0, eq);
    const body = token.slice(eq + 1);
    const attrs: Record<string, string> = {};
    for (const pair of body.split(',')) {
      const c = pair.indexOf(':');
      if (c !== -1) attrs[pair.slice(0, c)] = pair.slice(c + 1);
    }
    if (key === 'city') {
      def.cities = 1;
      def.revenue = parseInt(attrs.revenue, 10) || 0;
    } else if (key === 'town') {
      def.towns = 1;
      def.revenue = parseInt(attrs.revenue, 10) || 0;
    } else if (key === 'path') {
      def.paths.push({ a: end(attrs.a), b: end(attrs.b) });
    } else if (key === 'label') {
      def.label = body;
    }
  }
  return def;
}

export const TILES: Record<string, TileDef> = Object.fromEntries(
  Object.entries(YELLOW_CODES).map(([id, code]) => [id, parseTile(id, 'yellow', code)])
);

/** Rotate a path endpoint by r * 60 degrees (the centre is unaffected). */
function rotateEnd(e: TileEnd, r: number): TileEnd {
  return e === 'c' ? 'c' : (((e + r) % 6) + 6) % 6;
}
export function rotatePaths(def: TileDef, r: number): TilePath[] {
  return def.paths.map((p) => ({ a: rotateEnd(p.a, r), b: rotateEnd(p.b, r) }));
}

/** Yellow tiles a hex of a given base kind can receive. */
export function yellowTilesFor(kind: 'plain' | 'city' | 'town'): string[] {
  if (kind === 'city') return ['5', '6', '57'];
  if (kind === 'town') return ['3', '4', '58'];
  return ['7', '8', '9'];
}
