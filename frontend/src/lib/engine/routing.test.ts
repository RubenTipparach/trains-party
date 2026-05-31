import { describe, it, expect } from 'vitest';
import { initialState } from './setup';
import { routeThroughStops, corpRoutes } from './routes';
import type { GameState } from './types';

describe('routeThroughStops (manual route assignment)', () => {
  function floatIRWithTrack(): { s: GameState; corp: GameState['corporations'][number] } {
    const s: GameState = initialState([{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }] as any);
    const ir = s.corporations.find((c) => c.sym === 'IR')!;
    ir.floated = true; ir.president = 'p1';
    ir.tokenHexes = ['E2'];
    ir.trains = ['3'];
    // E2 home city track to edge 5 (toward F3); F3 city straight {2,5} so E2->F3 connects,
    // F3 edge5 -> G4. Lay tiles to make a connected line E2-F3-G4.
    s.tiles['E2'] = { id: '5', rotation: 4 }; // edges {4,5}
    s.tiles['F3'] = { id: '57', rotation: 2 }; // edges {2,5}
    s.tiles['G4'] = { id: '57', rotation: 2 }; // edges {2,5}: F3(e5)->G4(e2) connects
    return { s, corp: ir };
  }

  it('returns a connected route and revenue for stops given in order', () => {
    const { s } = floatIRWithTrack();
    const res = routeThroughStops(s, ['E2', 'F3'], 3);
    expect(res).not.toBeNull();
    expect(res!.route.hexes).toEqual(['E2', 'F3']);
    expect(res!.route.revenue).toBeGreaterThan(0);
    expect(res!.route.segs && res!.route.segs.length).toBeGreaterThan(0);
  });

  it('rejects stops that are not connectable', () => {
    const { s } = floatIRWithTrack();
    // K8 (Tokushima) is across the map with no track to E2.
    expect(routeThroughStops(s, ['E2', 'K8'], 3)).toBeNull();
  });

  it('rejects more stops than the train can reach', () => {
    const { s } = floatIRWithTrack();
    expect(routeThroughStops(s, ['E2', 'F3', 'G4'], 2)).toBeNull(); // 2-train, 3 stops
  });

  it('a manual route matches the auto best when the player picks the same stops', () => {
    const { s, corp } = floatIRWithTrack();
    const auto = corpRoutes(s, corp);
    const best = auto.routes[0];
    if (best) {
      const manual = routeThroughStops(s, best.hexes, 3);
      expect(manual).not.toBeNull();
      expect(manual!.route.revenue).toBe(best.revenue);
    }
  });
});
