/**
 * `approachRevenue` is the forward-looking track-lay signal: the value of revenue
 * centres the network is building TOWARD but has not connected yet, discounted by how
 * many more lays it would take. It is what stops a bot from stubbing out / grabbing the
 * nearest cheap town instead of running a line to a far high-value city (the behaviour
 * reported in-game: "TR dead-ends instead of heading to the city", "KU should aim at
 * Uwajima").
 *
 * Synthetic column-D map (rows 2..12), doubled coords: edge 0 = row+2 (down), edge 3 =
 * row-2 (up). So a straight (edge3<->edge0) tile makes a vertical chain.
 */
import { describe, it, expect } from 'vitest';
import { initialState, approachRevenue } from './index';
import type { GameState } from './types';
import type { HexDef } from '$lib/data/types';

const seats = [
  { id: 'p1', name: 'A' },
  { id: 'p2', name: 'B' },
  { id: 'p3', name: 'C' }
];

const plainHex = (coord: string): HexDef => ({ coord, color: 'white', cities: [], towns: [], paths: [], icons: [] });

/** A city with preprinted straight track (edge3-center-edge0): its dangling end is an
 *  OPEN end the network can build from. */
const cityTracked = (coord: string, revenue: number): HexDef => ({
  coord,
  color: 'yellow',
  cities: [{ revenue, slots: 1 }],
  towns: [],
  paths: [
    { a: 3, b: 'center' },
    { a: 'center', b: 0 }
  ],
  icons: []
});

/** A city with NO track: a reachable-but-unconnected target the network aims at. */
const cityPlain = (coord: string, revenue: number): HexDef => ({
  coord,
  color: 'yellow',
  cities: [{ revenue, slots: 1 }],
  towns: [],
  paths: [],
  icons: []
});

function colMap(overrides: Record<string, HexDef>): Record<string, HexDef> {
  const map: Record<string, HexDef> = {};
  for (let r = 2; r <= 12; r += 2) {
    const c = 'D' + r;
    map[c] = overrides[c] ?? plainHex(c);
  }
  return map;
}
function baseState(map: Record<string, HexDef>): GameState {
  const s = initialState(seats, 'rola');
  s.map = map;
  s.phase = '2';
  return s;
}
const corp0 = (s: GameState) => s.corporations[0];

describe('approachRevenue (forward-looking track value)', () => {
  it('values an open track end aimed at a distant unconnected city', () => {
    const s = baseState(colMap({ D4: cityTracked('D4', 20), D10: cityPlain('D10', 60) }));
    const c = corp0(s);
    c.tokenHexes = ['D4']; // home city; its straight track dangles toward D6 -> D8 -> D10
    expect(approachRevenue(s, c)).toBeGreaterThan(0);
  });

  it('approaches nothing when the network has no open track ends', () => {
    const s = baseState(colMap({ D4: cityPlain('D4', 20), D10: cityPlain('D10', 60) }));
    const c = corp0(s);
    c.tokenHexes = ['D4']; // a home city with no track -> no frontier to build from
    expect(approachRevenue(s, c)).toBe(0);
  });

  it('scores a nearer open end toward the city higher than a farther one', () => {
    const near = baseState(colMap({ D8: cityTracked('D8', 20), D10: cityPlain('D10', 60) }));
    const cn = corp0(near);
    cn.tokenHexes = ['D8']; // one lay from the 60-city
    const far = baseState(colMap({ D4: cityTracked('D4', 20), D10: cityPlain('D10', 60) }));
    const cf = corp0(far);
    cf.tokenHexes = ['D4']; // three lays from the 60-city
    expect(approachRevenue(near, cn)).toBeGreaterThan(approachRevenue(far, cf));
  });
});
