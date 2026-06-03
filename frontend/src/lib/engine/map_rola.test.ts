import { describe, it, expect } from 'vitest';
import { HEXES, HEX_BY_COORD, MINOR_HOMES } from '$lib/data/map_rola';
import { configRola } from '$lib/data/grola';
import { neighbor } from './track';
import { initialState } from './setup';

const parse = (c: string) => ({ col: c.charCodeAt(0) - 65, row: parseInt(c.slice(1), 10) });

describe('RoLA fixed starter map (Stage 4b)', () => {
  it('places every hex on a valid (col+row even) grid cell', () => {
    for (const h of HEXES) {
      const { col, row } = parse(h.coord);
      expect((col + row) % 2, `${h.coord} off-grid`).toBe(0);
    }
  });

  it('is fully connected: every hex has at least one on-map neighbour', () => {
    for (const h of HEXES) {
      const nb = [0, 1, 2, 3, 4, 5].map((e) => neighbor(HEX_BY_COORD, h.coord, e)).filter(Boolean);
      expect(nb.length, `${h.coord} is isolated`).toBeGreaterThan(0);
    }
  });

  it('has exactly one home city per minor', () => {
    const minors = configRola.minors!.map((m) => m.sym).sort();
    expect(Object.keys(MINOR_HOMES).sort()).toEqual(minors);
    for (const [sym, coord] of Object.entries(MINOR_HOMES)) {
      const h = HEX_BY_COORD[coord];
      expect(h, `${sym} home ${coord} missing`).toBeTruthy();
      expect(h.cities.length, `${coord} is not a city`).toBeGreaterThan(0);
    }
  });

  it('has 3 off-board Distant Destinations: all phase tiers, connected edges', () => {
    const offs = HEXES.filter((h) => h.offboard);
    expect(offs).toHaveLength(3);
    for (const h of offs) {
      for (const tier of ['yellow', 'green', 'brown', 'gray']) {
        expect(h.offboard!.revenue[tier], `${h.coord} missing ${tier}`).toBeGreaterThan(0);
      }
      for (const p of h.paths) {
        const edge = (typeof p.a === 'number' ? p.a : p.b) as number;
        expect(neighbor(HEX_BY_COORD, h.coord, edge), `${h.coord} edge ${edge} dangling`).toBeTruthy();
      }
    }
  });

  it('seats each minor on its home hex in the initial RoLA state', () => {
    const s = initialState(
      [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }, { id: 'p3', name: 'C' }],
      'rola'
    );
    for (const [sym, coord] of Object.entries(MINOR_HOMES)) {
      expect(s.corporations.find((x) => x.sym === sym)!.coordinates).toBe(coord);
    }
    expect(configRola.hexByCoord).toBe(HEX_BY_COORD);
  });
});
