import { describe, it, expect } from 'vitest';
import { generateRolaMap } from './genRolaMap';
import { initialState, apply } from './index';
import { botAction } from '$lib/game/bots';
import { configRola } from '$lib/data/grola';

const MINORS = configRola.minors!.map((m) => m.sym);
const EDGE: Array<[number, number]> = [
  [0, 2],
  [-1, 1],
  [-1, -1],
  [0, -2],
  [1, -1],
  [1, 1]
];
const parse = (c: string) => ({ col: c.charCodeAt(0) - 65, row: parseInt(c.slice(1), 10) });

describe('RoLA procedural map generator (Stage 4 auto)', () => {
  it('builds a valid, connected map with one home city per minor', () => {
    const { hexByCoord, minorHomes } = generateRolaMap(12345, MINORS);
    const keys = Object.keys(hexByCoord);
    expect(keys.length).toBeGreaterThan(MINORS.length + 5);

    for (const k of keys) {
      const { col, row } = parse(k);
      expect((col + row) % 2, `${k} off-grid`).toBe(0);
      const nb = EDGE.map(([dc, dr]) => String.fromCharCode(65 + col + dc) + (row + dr)).filter(
        (n) => hexByCoord[n]
      );
      expect(nb.length, `${k} isolated`).toBeGreaterThan(0);
    }

    // every minor has a distinct home that is a city on the map
    expect(Object.keys(minorHomes).sort()).toEqual([...MINORS].sort());
    const homeCoords = Object.values(minorHomes);
    expect(new Set(homeCoords).size).toBe(homeCoords.length);
    for (const coord of homeCoords) expect(hexByCoord[coord].cities.length).toBeGreaterThan(0);
  });

  it('places off-board Distant Destinations with all phase tiers', () => {
    const { hexByCoord } = generateRolaMap(777, MINORS);
    const offs = Object.values(hexByCoord).filter((h) => h.offboard);
    expect(offs.length).toBeGreaterThan(0);
    for (const h of offs) {
      for (const tier of ['yellow', 'green', 'brown', 'gray']) {
        expect(h.offboard!.revenue[tier]).toBeGreaterThan(0);
      }
    }
  });

  it('is deterministic: same seed -> same map, different seed -> different map', () => {
    const a = generateRolaMap(99, MINORS);
    const b = generateRolaMap(99, MINORS);
    const c = generateRolaMap(100, MINORS);
    expect(Object.keys(a.hexByCoord).sort()).toEqual(Object.keys(b.hexByCoord).sort());
    expect(a.minorHomes).toEqual(b.minorHomes);
    expect(Object.keys(a.hexByCoord).sort()).not.toEqual(Object.keys(c.hexByCoord).sort());
  });

  it('initialState(seed) builds the runtime map and bots can play on it', () => {
    const seats = [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }, { id: 'p3', name: 'C' }];
    let s = initialState(seats, 'rola', undefined, { seed: 4242, mapMode: 'auto' });
    expect(s.map).toBeTruthy();
    expect(s.mapMode).toBe('auto');
    // minors seated on generated homes
    for (const m of configRola.minors!) {
      expect(s.map![s.corporations.find((c) => c.sym === m.sym)!.coordinates]).toBeTruthy();
    }
    let launches = 0;
    for (let i = 0; i < 250 && !s.finished; i++) {
      const a = botAction(s, 'normal');
      if (!a) break;
      s = apply(s, a);
      if (a.type === 'launch') launches += 1;
    }
    expect(launches).toBeGreaterThan(0);
    expect(s.srCount).toBeGreaterThan(1);
  });
});
