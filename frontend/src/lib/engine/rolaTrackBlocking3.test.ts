/**
 * Round 3: hunt for the ACTUAL cause of SU seeing "0 legal lays" on a connected
 * empty hex. The core blocking logic (rounds 1-2) is correct, so the culprit is
 * likely RoLA's water rule or tile-geometry / "no track into the sea".
 *
 *   i) target hex is itself a WATER hex -> a non-Bridging company gets 0 lays
 *      there (the Bridging Company can still bridge it).
 *   j) target hex is land but its only non-network neighbours are WATER, so
 *      every connecting tile orientation points the other end into water -> 0.
 *   k) the SAME hex with the Bridging ability present -> lays appear (proving the
 *      water rule, not a connectivity bug, is what zeroes it out).
 *
 * Edge geometry: edge 0 = row+2 (down), edge 3 = row-2 (up),
 *                edge 1 = (-1,+1), edge 5 = (+1,+1), edge 2 = (-1,-1), edge 4 = (+1,-1).
 */
import { describe, it, expect } from 'vitest';
import { apply, initialState } from './index';
import { launchViaAuction } from './rolaTestUtil';
import { legalLays } from './track';
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

function plainHex(coord: string): HexDef {
  return { coord, color: 'white', cities: [], towns: [], paths: [], icons: [] };
}
function waterHex(coord: string): HexDef {
  return { coord, color: 'white', cities: [], towns: [], paths: [], icons: [], terrain: ['water'] };
}
function whiteCityHex(coord: string): HexDef {
  return { coord, color: 'white', cities: [{ revenue: 0, slots: 1 }], towns: [], paths: [], icons: [] };
}
function trackStep(s: GameState): void {
  s.phase = '2';
  s.or = { order: ['AG'], index: 0, step: 'track', orNumber: 1, orsThisSet: 1, yellowLaid: 0 } as GameState['or'];
  AG(s).cash = 1000;
}

/**
 * Build a small neighbourhood around a target hex D6 reachable from AG's home
 * city D4. `targetWater` makes D6 itself water; `surroundWater` makes every D6
 * neighbour except D4 water.
 */
function scene(opts: { targetWater?: boolean; surroundWater?: boolean }): GameState {
  const s = toOperating();
  const map: Record<string, HexDef> = {};
  // the column line and the six neighbours of D6
  for (const c of ['D2', 'D4', 'D6', 'D8', 'C5', 'C7', 'E5', 'E7']) map[c] = plainHex(c);
  map['D4'] = whiteCityHex('D4');
  if (opts.targetWater) map['D6'] = waterHex('D6');
  if (opts.surroundWater) {
    // every neighbour of D6 except D4 (which is the connecting network hex) -> water
    for (const c of ['D8', 'C5', 'C7', 'E5', 'E7']) map[c] = waterHex(c);
  }
  s.map = map;
  AG(s).tokenHexes = ['D4'];
  s.tiles['D4'] = { id: '6', rotation: 0 }; // AG city, track out edge 0 -> D6
  trackStep(s);
  return s;
}

describe('SU "0 legal lays" root-cause: RoLA water rule', () => {
  it('i) the target hex itself is WATER -> a non-Bridging company gets 0 lays there', () => {
    const s = scene({ targetWater: true });
    const lays = legalLays(s, AG(s)).filter((l) => l.hex === 'D6');
    // eslint-disable-next-line no-console
    console.log('i) D6 (water) lays for non-bridging AG =', lays.length);
    expect(lays.length).toBe(0);
  });

  it('j) target is land but every other-end neighbour is WATER -> 0 connecting lays', () => {
    const s = scene({ surroundWater: true });
    const lays = legalLays(s, AG(s)).filter((l) => l.hex === 'D6');
    // eslint-disable-next-line no-console
    console.log('j) D6 (land, water-surrounded) lays =', lays.length, lays.map((l) => `${l.tile}r${l.rotation}`));
    // Every yellow tile that connects to D4 (edge 3) must run its other end into a
    // water neighbour, which the water rule forbids for a non-bridging company.
    expect(lays.length).toBe(0);
  });

  it('k) control: target is plain land with land neighbours -> lays DO appear', () => {
    const s = scene({});
    const lays = legalLays(s, AG(s)).filter((l) => l.hex === 'D6');
    // eslint-disable-next-line no-console
    console.log('k) D6 (plain land) lays =', lays.length);
    expect(lays.length).toBeGreaterThan(0);
  });
});
