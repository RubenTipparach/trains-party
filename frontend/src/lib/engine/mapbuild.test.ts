import { describe, it, expect } from 'vitest';
import { initialState, apply, legalPlacements } from './index';
import { botAction } from '$lib/game/bots';

const SEATS = [
  { id: 'p1', name: 'Ada' },
  { id: 'p2', name: 'Bo' },
  { id: 'p3', name: 'Cy' }
];
const EDGE: Array<[number, number]> = [
  [0, 2],
  [-1, 1],
  [-1, -1],
  [0, -2],
  [1, -1],
  [1, 1]
];
const nbCount = (coord: string, map: Record<string, unknown>) => {
  const col = coord.charCodeAt(0) - 65;
  const row = parseInt(coord.slice(1), 10);
  return EDGE.filter(([dc, dr]) => map[String.fromCharCode(65 + col + dc) + (row + dr)]).length;
};

describe('RoLA Manual map-build round (Stage 4)', () => {
  it('starts a build round seeded with a centre tile and unseated minors', () => {
    const s = initialState(SEATS, 'rola', undefined, { seed: 555, mapMode: 'manual' });
    expect(s.round).toBe('mapbuild');
    expect(s.mapMode).toBe('manual');
    expect(s.mapBuild).toBeTruthy();
    expect(Object.keys(s.map!).length).toBe(3); // one tri-hex tile down
    expect(s.corporations.filter((c) => c.kind === 'minor').every((c) => c.coordinates === '')).toBe(true);
  });

  it('bots build a connected map, homes get assigned, then the map is playable', () => {
    let s = initialState(SEATS, 'rola', undefined, { seed: 555, mapMode: 'manual' });
    let placements = 0;
    while (s.round === 'mapbuild') {
      const a = botAction(s, 'normal');
      expect(a?.type).toBe('place_tri');
      s = apply(s, a!);
      expect(++placements).toBeLessThan(60);
    }
    expect(s.round).toBe('stock');
    expect(s.mapBuild).toBeUndefined();

    // every hex touches the rest of the map
    const map = s.map!;
    for (const k of Object.keys(map)) expect(nbCount(k, map), `${k} isolated`).toBeGreaterThan(0);

    // minors seated on real city hexes
    const minors = s.corporations.filter((c) => c.kind === 'minor');
    for (const c of minors) {
      expect(c.coordinates).toBeTruthy();
      expect(map[c.coordinates].cities.length).toBeGreaterThan(0);
    }

    // the built map is playable: bots launch and operate on it
    let launches = 0;
    for (let i = 0; i < 250 && !s.finished; i++) {
      const a = botAction(s, 'normal');
      if (!a) break;
      s = apply(s, a);
      if (a.type === 'launch') launches += 1;
    }
    expect(launches).toBeGreaterThan(0);
  });

  it('rejects overlapping, disconnected, and out-of-turn placements', () => {
    const s = initialState(SEATS, 'rola', undefined, { seed: 7, mapMode: 'manual' });
    const active = s.mapBuild!.order[0];
    // overlap with the centre seed tile
    expect(() => apply(s, { type: 'place_tri', player: active, anchor: 'J11', shape: 'A' })).toThrow();
    // far-away, unconnected
    expect(() => apply(s, { type: 'place_tri', player: active, anchor: 'A1', shape: 'A' })).toThrow();
    // a legal placement, but by the wrong player
    const legal = legalPlacements(s.map!)[0];
    const other = s.players.find((p) => p.id !== active)!.id;
    expect(() => apply(s, { type: 'place_tri', player: other, anchor: legal.anchor, shape: legal.shape })).toThrow();
    // ... is fine for the active player
    const next = apply(s, { type: 'place_tri', player: active, anchor: legal.anchor, shape: legal.shape });
    expect(Object.keys(next.map!).length).toBe(6);
    expect(next.mapBuild!.turn).toBe(1);
  });

  it('is deterministic for a fixed seed + bot policy', () => {
    // Bots place by geometry (seed-independent); the seed drives tile *content*,
    // so the content signature must be stable per seed and vary across seeds.
    const build = (seed: number) => {
      let s = initialState(SEATS, 'rola', undefined, { seed, mapMode: 'manual' });
      while (s.round === 'mapbuild') s = apply(s, botAction(s, 'normal')!);
      return Object.keys(s.map!)
        .sort()
        .map((k) => `${k}:${s.map![k].cities.length}:${s.map![k].towns.length}:${s.map![k].terrain?.[0] ?? ''}`)
        .join(',');
    };
    expect(build(909)).toBe(build(909));
    expect(build(909)).not.toBe(build(910));
  });
});
