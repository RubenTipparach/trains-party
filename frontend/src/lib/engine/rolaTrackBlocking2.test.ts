/**
 * Round 2 of the SU "0 legal lays" investigation. The first file used PREPRINTED
 * city hexes; the user's intervening "20" city is more likely an empty yellow
 * city placed as a LAID tile, sitting inside a larger network of OTHER companies'
 * track. These tests probe:
 *   e) a LAID empty yellow city ('57') between SU and the target hex
 *   f) SU connected to the target ONLY through another company's already-laid
 *      track (no SU tile in between) - the "connected to a larger network" case
 *   g) cityBlocks on a multi-slot city with one (foreign) of two slots filled
 *   h) the precise blocking boundary: does an empty city wrongly block?
 *
 * Edge geometry (doubled coords): edge 0 = row+2 (down), edge 3 = row-2 (up).
 */
import { describe, it, expect } from 'vitest';
import { apply, initialState } from './index';
import { launchViaAuction } from './rolaTestUtil';
import { legalLays, network } from './track';
import type { GameState } from './types';
import type { HexDef } from '$lib/data/types';

const seats = [
  { id: 'p1', name: 'A' },
  { id: 'p2', name: 'B' },
  { id: 'p3', name: 'C' }
];

function toOperating(): GameState {
  let s = launchViaAuction(initialState(seats, 'rola'), 'p1', 'AG', 160);
  s = apply(s, { type: 'pass', player: 'p2' });
  s = apply(s, { type: 'pass', player: 'p3' });
  s = apply(s, { type: 'pass', player: 'p1' });
  return s;
}
const AG = (s: GameState) => s.corporations.find((c) => c.sym === 'AG')!;
const SU = (s: GameState) => s.corporations.find((c) => c.sym !== 'AG')!;

function plainHex(coord: string): HexDef {
  return { coord, color: 'white', cities: [], towns: [], paths: [], icons: [] };
}
/** A WHITE city hex (no preprinted track) - becomes a city only via a laid tile. */
function whiteCityHex(coord: string): HexDef {
  return { coord, color: 'white', cities: [{ revenue: 0, slots: 1 }], towns: [], paths: [], icons: [] };
}
function buildMap(overrides: Record<string, HexDef> = {}): Record<string, HexDef> {
  const map: Record<string, HexDef> = {};
  for (let r = 2; r <= 14; r += 2) {
    const c = 'D' + r;
    map[c] = overrides[c] ?? plainHex(c);
  }
  return map;
}
function trackStep(s: GameState): void {
  s.phase = '2';
  s.or = { order: ['AG'], index: 0, step: 'track', orNumber: 1, orsThisSet: 1, yellowLaid: 0 } as GameState['or'];
  AG(s).cash = 1000;
}

describe('SU track-blocking investigation round 2 (laid cities + foreign networks)', () => {
  it('e) LAID empty yellow city ("57") between token and target -> far side layable', () => {
    const s = toOperating();
    s.map = buildMap();
    // AG home token in a white-city hex D4 with a laid yellow city tile.
    s.map['D4'] = whiteCityHex('D4');
    AG(s).tokenHexes = ['D4'];
    s.tiles['D4'] = { id: '6', rotation: 0 }; // city, track out edges 0 and 2
    // D6: LAID empty yellow city '57' (path a:0 b:_0 ; path a:_0 b:3 -> edges 0,3 through city)
    s.tiles['D6'] = { id: '57', rotation: 0 };
    SU(s).tokenHexes = []; // city is empty
    trackStep(s);

    const net = network(s, AG(s));
    const lays = legalLays(s, AG(s));
    const d8 = lays.filter((l) => l.hex === 'D8');
    // eslint-disable-next-line no-console
    console.log('e) net=', [...net].sort(), 'D6 in net=', net.has('D6'), 'D8 lays=', d8.length);
    expect(net.has('D6')).toBe(true);
    expect(d8.length).toBeGreaterThan(0); // empty laid city must allow building through
  });

  it('f) SU connected to target ONLY through ANOTHER company\'s laid track', () => {
    const s = toOperating();
    s.map = buildMap();
    s.map['D4'] = whiteCityHex('D4'); // AG home
    s.map['D10'] = whiteCityHex('D10'); // SU (foreign) home further down
    AG(s).tokenHexes = ['D4'];
    SU(s).tokenHexes = ['D10'];
    s.tiles['D4'] = { id: '6', rotation: 0 }; // AG city, track out edge 0 -> D6
    // The "larger network of other companies' track": straight tiles laid by SU
    // (or whoever) on D6 and D8 forming a continuous line D4..D10.
    s.tiles['D6'] = { id: '9', rotation: 0 }; // straight edges 0,3
    s.tiles['D8'] = { id: '9', rotation: 0 }; // straight edges 0,3
    s.tiles['D10'] = { id: '6', rotation: 3 }; // SU city, rotated so track is on edge 3 (toward D8)
    trackStep(s);

    const net = network(s, AG(s));
    const lays = legalLays(s, AG(s));
    // eslint-disable-next-line no-console
    console.log('f) AG net=', [...net].sort());
    // AG should reach D6, D8 (plain track) and D10 (SU's city, foreign-tokened ->
    // reachable but blocked). D12 is the empty hex past the foreign city.
    expect(net.has('D6')).toBe(true);
    expect(net.has('D8')).toBe(true);
    expect(net.has('D10')).toBe(true); // foreign city is REACHABLE
    // D10 is foreign-tokened (1 slot, SU) -> AG cannot build past it.
    const d12 = lays.filter((l) => l.hex === 'D12');
    // eslint-disable-next-line no-console
    console.log('f) D12 lays (should be 0, foreign city blocks)=', d12.length);
    expect(d12.length).toBe(0);
    // But every empty hex ALONG the reachable straight (none here, all filled) -
    // there are no empty hexes between D4 and D10, so check we CAN at least upgrade
    // reachable hexes / there are SOME lays where geometry allows.
  });

  it('g) 2-slot city, ONE foreign token (a free slot remains) -> NOT blocked', () => {
    const s = toOperating();
    s.map = buildMap();
    s.map['D4'] = whiteCityHex('D4');
    // D6 is a 2-slot city via a green '14' tile (slots:2). One foreign token in it.
    s.map['D6'] = { coord: 'D6', color: 'white', cities: [{ revenue: 0, slots: 2 }], towns: [], paths: [], icons: [] };
    AG(s).tokenHexes = ['D4'];
    SU(s).tokenHexes = ['D6']; // one of two slots filled by a foreign corp
    s.tiles['D4'] = { id: '6', rotation: 0 };
    // green city tile with 2 slots and straight-ish track. '14' edges 0,1,3,4.
    s.tiles['D6'] = { id: '14', rotation: 0 };
    s.phase = '3'; // allow green so this 2-slot tile is valid context
    s.or = { order: ['AG'], index: 0, step: 'track', orNumber: 1, orsThisSet: 1, yellowLaid: 0 } as GameState['or'];
    AG(s).cash = 1000;

    const net = network(s, AG(s));
    const lays = legalLays(s, AG(s));
    const d8 = lays.filter((l) => l.hex === 'D8');
    // eslint-disable-next-line no-console
    console.log('g) net=', [...net].sort(), 'D6 in net=', net.has('D6'), 'D8 fresh lays=', d8.length);
    // 2-slot city, only 1 token -> a free slot remains -> NOT blocked -> the empty
    // hex on its open edge (D8) must be a legal fresh lay.
    expect(net.has('D6')).toBe(true);
    expect(d8.length).toBeGreaterThan(0); // a free slot means we can build through
  });
});
