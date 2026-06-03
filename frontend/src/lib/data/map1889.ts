/**
 * 1889 Shikoku map, transcribed from the reference engine:
 *   https://github.com/tobymao/18xx/blob/master/lib/engine/game/g_1889/map.rb
 *
 * The raw tile-code strings are parsed into typed HexDef records consumed by the
 * read-only HexMap component. LAYOUT is :flat (flat-top hexes).
 */

import type { HexDef, PathPart, TileColor, TileManifestEntry } from './types';

export const LOCATION_NAMES: Record<string, string> = {
  F3: 'Saijou',
  G4: 'Niihama',
  H7: 'Ikeda',
  A10: 'Sukumo',
  J11: 'Anan',
  G12: 'Nahari',
  E2: 'Matsuyama',
  I2: 'Marugame',
  K8: 'Tokushima',
  C10: 'Kubokawa',
  J5: 'Ritsurin Kouen',
  G10: 'Nangoku',
  J9: 'Komatsujima',
  I12: 'Muki',
  B11: 'Nakamura',
  I4: 'Kotohira',
  C4: 'Ohzu',
  K4: 'Takamatsu',
  B7: 'Uwajima',
  B3: 'Yawatahama',
  G14: 'Muroto',
  F1: 'Imabari',
  J1: 'Sakaide & Okayama',
  L7: 'Naruto & Awaji',
  F9: 'Kouchi'
};

/** Raw HEXES grouped by colour, exactly as in the reference. */
const HEXES_RAW: Record<TileColor, Array<[string[], string]>> = {
  white: [
    [['D3', 'H3', 'J3', 'B5', 'C8', 'E8', 'I8', 'D9', 'I10'], ''],
    [['F3', 'G4', 'H7', 'A10', 'J11', 'G12', 'E2', 'I2', 'K8', 'C10'], 'city=revenue:0'],
    [['J5'], 'town=revenue:0'],
    [['B11', 'G10', 'I12', 'J9'], 'town=revenue:0;icon=image:port'],
    [['K6'], 'upgrade=cost:80,terrain:water'],
    [['H5', 'I6'], 'upgrade=cost:80,terrain:water|mountain'],
    [
      ['E4', 'D5', 'F5', 'C6', 'E6', 'G6', 'D7', 'F7', 'A8', 'G8', 'B9', 'H9', 'H11', 'H13'],
      'upgrade=cost:80,terrain:mountain'
    ],
    [['I4'], 'city=revenue:0;label=H;upgrade=cost:80']
  ],
  yellow: [
    [['C4'], 'city=revenue:20;path=a:2,b:_0'],
    [['K4'], 'city=revenue:30;path=a:0,b:_0;path=a:1,b:_0;path=a:2,b:_0;label=T']
  ],
  green: [
    [['F9'], 'city=revenue:30,slots:2;path=a:2,b:_0;path=a:3,b:_0;path=a:4,b:_0;path=a:5,b:_0;label=K;upgrade=cost:80']
  ],
  brown: [],
  gray: [
    [['B7'], 'city=revenue:40,slots:2;path=a:1,b:_0;path=a:3,b:_0;path=a:5,b:_0'],
    [['B3'], 'town=revenue:20;path=a:0,b:_0;path=a:_0,b:5'],
    [['G14'], 'town=revenue:20;path=a:3,b:_0;path=a:_0,b:4'],
    [['J7'], 'path=a:1,b:5']
  ],
  red: [
    [['F1'], 'offboard=revenue:yellow_30|brown_60|diesel_100;path=a:0,b:_0;path=a:1,b:_0'],
    [['J1'], 'offboard=revenue:yellow_20|brown_40|diesel_80;path=a:0,b:_0;path=a:1,b:_0'],
    [['L7'], 'offboard=revenue:yellow_20|brown_40|diesel_80;path=a:1,b:_0;path=a:2,b:_0']
  ]
};

function pathEnd(v: string): number | 'center' {
  return v === '_0' ? 'center' : parseInt(v, 10);
}

function parseCode(coord: string, color: TileColor, code: string): HexDef {
  const hex: HexDef = {
    coord,
    color,
    name: LOCATION_NAMES[coord],
    cities: [],
    towns: [],
    paths: [],
    icons: []
  };

  for (const token of code.split(';').filter(Boolean)) {
    const eq = token.indexOf('=');
    const key = token.slice(0, eq);
    const body = token.slice(eq + 1);
    const attrs: Record<string, string> = {};
    for (const pair of body.split(',')) {
      const c = pair.indexOf(':');
      if (c === -1) continue;
      attrs[pair.slice(0, c)] = pair.slice(c + 1);
    }

    switch (key) {
      case 'city':
        hex.cities.push({ revenue: parseInt(attrs.revenue, 10) || 0, slots: attrs.slots ? parseInt(attrs.slots, 10) : 1 });
        break;
      case 'town':
        hex.towns.push({ revenue: parseInt(attrs.revenue, 10) || 0 });
        break;
      case 'path': {
        const p: PathPart = { a: pathEnd(attrs.a), b: pathEnd(attrs.b) };
        hex.paths.push(p);
        break;
      }
      case 'offboard': {
        const revenue: Record<string, number> = {};
        for (const part of attrs.revenue.split('|')) {
          const [tier, val] = part.split('_');
          revenue[tier] = parseInt(val, 10);
        }
        hex.offboard = { revenue };
        break;
      }
      case 'label':
        // label=H -> body is just "H" with no colon; recover it.
        hex.label = body;
        break;
      case 'upgrade':
        if (attrs.cost) hex.upgradeCost = parseInt(attrs.cost, 10);
        if (attrs.terrain) hex.terrain = attrs.terrain.split('|');
        break;
      case 'icon':
        if (attrs.image) hex.icons.push(attrs.image);
        break;
    }
  }
  return hex;
}

export const HEXES: HexDef[] = (Object.keys(HEXES_RAW) as TileColor[]).flatMap((color) =>
  HEXES_RAW[color].flatMap(([coords, code]) => coords.map((coord) => parseCode(coord, color, code)))
);

/** Lookup by coordinate. */
export const HEX_BY_COORD: Record<string, HexDef> = Object.fromEntries(HEXES.map((h) => [h.coord, h]));

/** Available tile manifest (id -> count), from the reference TILES hash. */
export const TILE_MANIFEST: TileManifestEntry[] = [
  { id: '3', count: 2 },
  { id: '5', count: 2 },
  { id: '6', count: 2 },
  { id: '7', count: 2 },
  { id: '8', count: 5 },
  { id: '9', count: 5 },
  { id: '12', count: 1 },
  { id: '13', count: 1 },
  { id: '14', count: 1 },
  { id: '15', count: 3 },
  { id: '16', count: 1 },
  { id: '19', count: 1 },
  { id: '20', count: 1 },
  { id: '23', count: 2 },
  { id: '24', count: 2 },
  { id: '25', count: 1 },
  { id: '26', count: 1 },
  { id: '27', count: 1 },
  { id: '28', count: 1 },
  { id: '29', count: 1 },
  { id: '39', count: 1 },
  { id: '40', count: 1 },
  { id: '41', count: 1 },
  { id: '42', count: 1 },
  { id: '45', count: 1 },
  { id: '46', count: 1 },
  { id: '47', count: 1 },
  { id: '57', count: 2 },
  { id: '58', count: 3 },
  { id: '205', count: 1 },
  { id: '206', count: 1 },
  { id: '437', count: 1 },
  { id: '438', count: 1 },
  { id: '439', count: 1 },
  { id: '440', count: 1 },
  { id: '448', count: 4 },
  { id: '465', count: 1 },
  { id: '466', count: 1 },
  { id: '492', count: 1 },
  { id: '611', count: 2 },
  { id: 'Beg6', count: 2, color: 'yellow' },
  { id: 'Beg7', count: 1, color: 'yellow' },
  { id: 'Beg8', count: 1, color: 'yellow' },
  { id: 'Beg9', count: 1, color: 'yellow' },
  { id: 'Beg23', count: 1, color: 'green' },
  { id: 'Beg24', count: 1, color: 'green' }
];
