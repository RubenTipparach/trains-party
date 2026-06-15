/**
 * Investigation tests for the reported "SU shows 0 legal lays" track bug.
 *
 * These build a synthetic vertical hex chain (column D, rows 2..12) so we can
 * isolate `legalLays` / `network` / `cityBlocks` behaviour:
 *   - empty hexes connected via an open straight-track end  -> should be layable
 *   - tracing through an empty (untokened) city             -> should pass
 *   - tracing through a foreign fully-tokened city          -> should block
 *   - tracing through a city holding the corp's own token   -> should pass
 *
 * Edge geometry (doubled coords): edge 0 = row+2 (down), edge 3 = row-2 (up).
 * So D4 --edge0--> D6 --edge0--> D8 ... is a straight vertical chain.
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

/** Launch AG and reach the OR track step. */
function toOperating(): GameState {
  let s = launchViaAuction(initialState(seats, 'rola'), 'p1', 'AG', 160);
  s = apply(s, { type: 'pass', player: 'p2' });
  s = apply(s, { type: 'pass', player: 'p3' });
  s = apply(s, { type: 'pass', player: 'p1' });
  return s;
}
const AG = (s: GameState) => s.corporations.find((c) => c.sym === 'AG')!;
const SU = (s: GameState) => s.corporations.find((c) => c.sym !== 'AG')!; // a second corp to act as "foreign token"

/** A plain empty hex (no preprinted track, white). */
function plainHex(coord: string): HexDef {
  return { coord, color: 'white', cities: [], towns: [], paths: [], icons: [] };
}
/** A preprinted yellow city hex with `slots` token slots. */
function cityHex(coord: string, slots: number): HexDef {
  return {
    coord,
    color: 'yellow',
    cities: [{ revenue: 20, slots }],
    towns: [],
    // straight vertical track through the city: edge 3 - center - edge 0
    paths: [
      { a: 3, b: 'center' },
      { a: 'center', b: 0 }
    ],
    icons: []
  };
}

/** Build a column-D vertical map of rows 2..12 (all plain unless overridden). */
function buildMap(overrides: Record<string, HexDef> = {}): Record<string, HexDef> {
  const map: Record<string, HexDef> = {};
  for (let r = 2; r <= 12; r += 2) {
    const c = 'D' + r;
    map[c] = overrides[c] ?? plainHex(c);
  }
  // include the immediate side neighbours so "no track into the sea" passes for
  // straight tiles using only edges 0/3 (those never point off our column).
  return map;
}

/** Put the OR into the track step for AG and give it a clean treasury. */
function trackStep(s: GameState): void {
  s.phase = '2';
  s.or = { order: ['AG'], index: 0, step: 'track', orNumber: 1, orsThisSet: 1, yellowLaid: 0 } as GameState['or'];
  AG(s).cash = 1000;
}

describe('SU track-blocking investigation', () => {
  it('a) straight track to an empty hex with an open end pointing further is layable', () => {
    const s = toOperating();
    s.map = buildMap();
    // AG token at D4, with a straight tile already laid connecting D4<->D6.
    s.tiles['D4'] = { id: '9', rotation: 0 }; // path a:0 b:3 -> edges 0 and 3
    AG(s).tokenHexes = ['D4'];
    trackStep(s);

    const net = network(s, AG(s));
    // D4 has track to edge 0 -> D6 (empty, no track) so D6 is NOT in the network,
    // but is a fresh-lay candidate; D6's open end could then point at D8.
    const lays = legalLays(s, AG(s));
    const d6 = lays.filter((l) => l.hex === 'D6');
    expect(net.has('D4')).toBe(true);
    // Laying a straight tile on D6 (continuing to D8) must be legal.
    expect(d6.length).toBeGreaterThan(0);
  });

  it('b) connected through an EMPTY (untokened) city -> far-side hex is layable', () => {
    const s = toOperating();
    s.map = buildMap({ D6: cityHex('D6', 1) }); // empty 1-slot city at D6
    // AG token D4, straight track D4<->D6 (into the city's edge 3).
    s.tiles['D4'] = { id: '9', rotation: 0 };
    AG(s).tokenHexes = ['D4'];
    SU(s).tokenHexes = []; // nobody tokens the city
    trackStep(s);

    const net = network(s, AG(s));
    // The empty city has a preprinted straight path (edge3-center-edge0), so the
    // network should trace THROUGH it (D6 reachable AND expanded past).
    expect(net.has('D6')).toBe(true);
    const lays = legalLays(s, AG(s));
    // D8 (an empty hex beyond the empty city) must be a legal fresh lay.
    expect(lays.some((l) => l.hex === 'D8')).toBe(true);
  });

  it('c) connected through a city FULLY tokened by ANOTHER corp -> far side blocked', () => {
    const s = toOperating();
    s.map = buildMap({ D6: cityHex('D6', 1) }); // 1-slot city
    s.tiles['D4'] = { id: '9', rotation: 0 };
    AG(s).tokenHexes = ['D4'];
    SU(s).tokenHexes = ['D6']; // foreign corp fully fills the single slot
    trackStep(s);

    const net = network(s, AG(s));
    expect(net.has('D6')).toBe(true); // reachable (may upgrade it)
    expect(net.has('D8')).toBe(false); // cannot trace past a foreign-blocked city
    const lays = legalLays(s, AG(s));
    expect(lays.some((l) => l.hex === 'D8')).toBe(false); // far side NOT layable
  });

  it('d) connected through a city holding the corp OWN token -> far side layable', () => {
    const s = toOperating();
    s.map = buildMap({ D6: cityHex('D6', 1) });
    s.tiles['D4'] = { id: '9', rotation: 0 };
    AG(s).tokenHexes = ['D4', 'D6']; // AG owns the city token
    trackStep(s);

    const net = network(s, AG(s));
    expect(net.has('D6')).toBe(true);
    const lays = legalLays(s, AG(s));
    expect(lays.some((l) => l.hex === 'D8')).toBe(true);
  });
});
