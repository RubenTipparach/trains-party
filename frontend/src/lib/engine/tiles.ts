/**
 * Tile catalog for 1889. Codes transcribed from the reference
 * (lib/engine/config/tile.rb) and g_1889/map.rb (the Beg* beginner tiles).
 * A path endpoint is an edge index (0-5) or 'c' (the tile centre / city / town).
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
  cities: number;
  towns: number;
  /** City token slots. */
  slots: number;
  revenue: number;
  paths: TilePath[];
  label?: string;
  port?: boolean;
}

// [color, code] per tile id. Colours follow the published 1889 tile manifest.
const CODES: Record<string, [TileColor, string]> = {
  // yellow
  '3': ['yellow', 'town=revenue:10;path=a:0,b:_0;path=a:_0,b:1'],
  '4': ['yellow', 'town=revenue:10;path=a:0,b:_0;path=a:_0,b:3'],
  '5': ['yellow', 'city=revenue:20;path=a:0,b:_0;path=a:1,b:_0'],
  '6': ['yellow', 'city=revenue:20;path=a:0,b:_0;path=a:2,b:_0'],
  '7': ['yellow', 'path=a:0,b:1'],
  '8': ['yellow', 'path=a:0,b:2'],
  '9': ['yellow', 'path=a:0,b:3'],
  '57': ['yellow', 'city=revenue:20;path=a:0,b:_0;path=a:_0,b:3'],
  '58': ['yellow', 'town=revenue:10;path=a:0,b:_0;path=a:_0,b:2'],
  '437': ['yellow', 'town=revenue:30;path=a:0,b:_0;path=a:_0,b:2;icon=image:port'],
  '438': ['yellow', 'city=revenue:40;path=a:0,b:_0;path=a:2,b:_0;label=H'],
  // green
  '12': ['green', 'city=revenue:30;path=a:0,b:_0;path=a:1,b:_0;path=a:2,b:_0'],
  '13': ['green', 'city=revenue:30;path=a:0,b:_0;path=a:2,b:_0;path=a:4,b:_0'],
  '14': ['green', 'city=revenue:30,slots:2;path=a:0,b:_0;path=a:1,b:_0;path=a:3,b:_0;path=a:4,b:_0'],
  '15': ['green', 'city=revenue:30,slots:2;path=a:0,b:_0;path=a:1,b:_0;path=a:2,b:_0;path=a:3,b:_0'],
  '16': ['green', 'path=a:0,b:2;path=a:1,b:3'],
  '19': ['green', 'path=a:0,b:3;path=a:2,b:4'],
  '20': ['green', 'path=a:0,b:3;path=a:1,b:4'],
  '23': ['green', 'path=a:0,b:3;path=a:0,b:4'],
  '24': ['green', 'path=a:0,b:3;path=a:0,b:2'],
  '25': ['green', 'path=a:0,b:2;path=a:0,b:4'],
  '26': ['green', 'path=a:0,b:3;path=a:0,b:5'],
  '27': ['green', 'path=a:0,b:3;path=a:0,b:1'],
  '28': ['green', 'path=a:0,b:4;path=a:0,b:5'],
  '29': ['green', 'path=a:0,b:2;path=a:0,b:1'],
  '205': ['green', 'city=revenue:30;path=a:0,b:_0;path=a:1,b:_0;path=a:3,b:_0'],
  '206': ['green', 'city=revenue:30;path=a:0,b:_0;path=a:5,b:_0;path=a:3,b:_0'],
  '439': ['green', 'city=revenue:60,slots:2;path=a:0,b:_0;path=a:2,b:_0;path=a:4,b:_0;label=H'],
  '440': ['green', 'city=revenue:40,slots:2;path=a:0,b:_0;path=a:1,b:_0;path=a:2,b:_0;label=T'],
  // brown
  '39': ['brown', 'path=a:0,b:2;path=a:0,b:1;path=a:1,b:2'],
  '40': ['brown', 'path=a:0,b:2;path=a:2,b:4;path=a:0,b:4'],
  '41': ['brown', 'path=a:0,b:3;path=a:0,b:1;path=a:1,b:3'],
  '42': ['brown', 'path=a:0,b:3;path=a:3,b:5;path=a:0,b:5'],
  '45': ['brown', 'path=a:0,b:3;path=a:2,b:4;path=a:0,b:4;path=a:2,b:3'],
  '46': ['brown', 'path=a:0,b:3;path=a:2,b:4;path=a:3,b:4;path=a:0,b:2'],
  '47': ['brown', 'path=a:0,b:3;path=a:1,b:4;path=a:1,b:3;path=a:0,b:4'],
  '448': ['brown', 'city=revenue:40,slots:2;path=a:0,b:_0;path=a:1,b:_0;path=a:2,b:_0;path=a:3,b:_0'],
  '465': ['brown', 'city=revenue:60,slots:3;path=a:0,b:_0;path=a:1,b:_0;path=a:2,b:_0;path=a:3,b:_0;label=K'],
  '466': ['brown', 'city=revenue:60,slots:2;path=a:0,b:_0;path=a:1,b:_0;path=a:2,b:_0;label=T'],
  '492': ['brown', 'city=revenue:80,slots:3;path=a:0,b:_0;path=a:1,b:_0;path=a:2,b:_0;path=a:3,b:_0;path=a:4,b:_0;path=a:5,b:_0;label=H'],
  '611': ['brown', 'city=revenue:40,slots:2;path=a:0,b:_0;path=a:1,b:_0;path=a:2,b:_0;path=a:3,b:_0;path=a:4,b:_0'],
  // beginner-game tiles (g_1889/map.rb)
  Beg6: ['yellow', 'city=revenue:20;path=a:0,b:_0;path=a:2,b:_0'],
  Beg7: ['yellow', 'path=a:0,b:1'],
  Beg8: ['yellow', 'path=a:0,b:2'],
  Beg9: ['yellow', 'path=a:0,b:3'],
  Beg23: ['green', 'path=a:0,b:3;path=a:0,b:4'],
  Beg24: ['green', 'path=a:0,b:3;path=a:0,b:2'],
  // --- Railways of the Lost Atlas (RoLA) ---
  // Colours, revenues and slots from the tile-manifest PDF (references/). RoLA
  // "purple" = brown, "grey" = gray, plus blue bridges. Track orientations mirror
  // the standard tile of the same shape and are finalised against the art at the
  // map stage (Stage 4).
  '291': ['yellow', 'city=revenue:40;path=a:0,b:_0;path=a:1,b:_0;label=C'],
  '292': ['yellow', 'city=revenue:40;path=a:0,b:_0;path=a:2,b:_0;label=C'],
  '293': ['yellow', 'city=revenue:40;path=a:0,b:_0;path=a:_0,b:3;label=C'],
  '294': ['green', 'city=revenue:50,slots:2;path=a:0,b:_0;path=a:1,b:_0;path=a:3,b:_0;path=a:4,b:_0;label=C'],
  '295': ['green', 'city=revenue:50,slots:2;path=a:0,b:_0;path=a:1,b:_0;path=a:2,b:_0;path=a:3,b:_0;label=C'],
  '296': ['green', 'city=revenue:50,slots:2;path=a:0,b:_0;path=a:2,b:_0;path=a:3,b:_0;path=a:5,b:_0;label=C'],
  '297': ['brown', 'city=revenue:60,slots:2;path=a:0,b:_0;path=a:1,b:_0;path=a:2,b:_0;path=a:3,b:_0;label=C'],
  '125': ['brown', 'city=revenue:40,slots:2;path=a:0,b:_0;path=a:1,b:_0;path=a:2,b:_0;path=a:3,b:_0'],
  '51': ['gray', 'city=revenue:50,slots:2;path=a:0,b:_0;path=a:1,b:_0;path=a:2,b:_0;path=a:3,b:_0'],
  '721': ['blue', 'path=a:0,b:3'],
  '722': ['blue', 'path=a:0,b:2'],
  '723': ['blue', 'path=a:0,b:1']
};

function end(v: string): TileEnd {
  return v === '_0' ? 'c' : parseInt(v, 10);
}

function parseTile(id: string, color: TileColor, code: string): TileDef {
  const def: TileDef = { id, color, cities: 0, towns: 0, slots: 0, revenue: 0, paths: [] };
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
      def.slots = attrs.slots ? parseInt(attrs.slots, 10) : 1;
      def.revenue = parseInt(attrs.revenue, 10) || 0;
    } else if (key === 'town') {
      def.towns = 1;
      def.revenue = parseInt(attrs.revenue, 10) || 0;
    } else if (key === 'path') {
      def.paths.push({ a: end(attrs.a), b: end(attrs.b) });
    } else if (key === 'label') {
      def.label = body;
    } else if (key === 'icon' && attrs.image === 'port') {
      def.port = true;
    }
  }
  return def;
}

export const TILES: Record<string, TileDef> = Object.fromEntries(
  Object.entries(CODES).map(([id, [color, code]]) => [id, parseTile(id, color, code)])
);

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
