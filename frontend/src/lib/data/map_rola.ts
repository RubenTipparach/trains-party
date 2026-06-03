/**
 * Railways of the Lost Atlas - fixed starter map.
 *
 * RoLA's map is normally assembled from tri-hex tiles during setup; until that
 * procedural build lands, this is a fixed, connected placeholder layout so the
 * existing board / track / route / operating engine can run RoLA. Geography is
 * generated (not the published tiles), but every hex uses a real reference hex
 * type and the standard flat-top doubled-coordinate grid ((col+row) even), so it
 * is a valid, fully-connected board. Swap in the real tri-hex tiles later.
 *
 * 12 white home cities (one per minor), towns, mountains (cost 40), water, and 3
 * off-board Distant Destinations (phase-valued: yellow/green/brown/gray).
 */

import type { HexDef, PathPart, TileColor } from './types';

export const LOCATION_NAMES: Record<string, string> = {
  A4: 'Adaptive', C2: 'Agricultural', F5: 'Bridging', B3: 'Eastern Mining',
  B7: 'Expansive', D3: 'Express', E2: 'Northern Port', G4: 'Overnight',
  C6: 'Resourceful', B9: 'Spacious', D7: 'Suburban', E6: 'Tunneling',
  A2: 'Distant North', D9: 'Distant South', G6: 'Distant East'
};

/** Minor home hexes (token placed when the minor first operates). */
export const MINOR_HOMES: Record<string, string> = {
  AD: 'A4', AG: 'C2', BR: 'F5', EM: 'B3', EA: 'B7', ER: 'D3',
  NP: 'E2', OV: 'G4', RE: 'C6', SP: 'B9', SU: 'D7', TU: 'E6'
};

const HEXES_RAW: Record<TileColor, Array<[string[], string]>> = {
  blue: [],
  white: [
    [['A8', 'D1', 'E8', 'F3'], ''],
    [['A4', 'C2', 'F5', 'B3', 'B7', 'D3', 'E2', 'G4', 'C6', 'B9', 'D7', 'E6'], 'city=revenue:0'],
    [['A6', 'B1', 'C8'], 'town=revenue:0'],
    [['C4', 'E4', 'F7'], 'upgrade=cost:40,terrain:mountain'],
    [['B5', 'D5'], 'upgrade=cost:40,terrain:water']
  ],
  yellow: [],
  green: [],
  brown: [],
  gray: [],
  red: [
    [['A2'], 'offboard=revenue:yellow_30|green_40|brown_50|gray_60;path=a:0,b:_0;path=a:5,b:_0'],
    [['D9'], 'offboard=revenue:yellow_20|green_30|brown_40|gray_50;path=a:3,b:_0;path=a:2,b:_0'],
    [['G6'], 'offboard=revenue:yellow_30|green_50|brown_70|gray_90;path=a:3,b:_0;path=a:2,b:_0']
  ]
};

// Compact transcription of the shared HexDef parser (kept local so each map
// module owns its own parsing; mirrors map1889.ts).
function pathEnd(v: string): number | 'center' {
  return v === '_0' ? 'center' : parseInt(v, 10);
}
function parseCode(coord: string, color: TileColor, code: string): HexDef {
  const hex: HexDef = { coord, color, name: LOCATION_NAMES[coord], cities: [], towns: [], paths: [], icons: [] };
  for (const token of code.split(';').filter(Boolean)) {
    const eq = token.indexOf('=');
    const key = token.slice(0, eq);
    const body = token.slice(eq + 1);
    const attrs: Record<string, string> = {};
    for (const pair of body.split(',')) {
      const c = pair.indexOf(':');
      if (c !== -1) attrs[pair.slice(0, c)] = pair.slice(c + 1);
    }
    switch (key) {
      case 'city':
        hex.cities.push({ revenue: parseInt(attrs.revenue, 10) || 0, slots: attrs.slots ? parseInt(attrs.slots, 10) : 1 });
        break;
      case 'town':
        hex.towns.push({ revenue: parseInt(attrs.revenue, 10) || 0 });
        break;
      case 'path':
        hex.paths.push({ a: pathEnd(attrs.a), b: pathEnd(attrs.b) } as PathPart);
        break;
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

export const HEX_BY_COORD: Record<string, HexDef> = Object.fromEntries(HEXES.map((h) => [h.coord, h]));
