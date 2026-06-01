import { describe, it, expect } from 'vitest';
import { initialState } from './setup';
import { exhaustedTilesOnHex, tileSupply, legalLays } from './track';
import type { GameState } from './types';

describe('tile supply exhaustion (matches the real G4 case)', () => {
  it('once both #5 copies are laid, #5 is excluded from lays but reported exhausted on a fitting hex', () => {
    const s: GameState = initialState([{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }] as any);
    const ir = s.corporations.find((c) => c.sym === 'IR')!;
    ir.floated = true; ir.president = 'p1';
    ir.tokenHexes = ['E2'];

    // Reproduce the reported board: #5 laid on I2 and E2 (both copies used),
    // #6 on K8 (1 left), #57 on F3 (1 left). Connect F3 into IR's network.
    s.tiles['I2'] = { id: '5', rotation: 0 };
    s.tiles['E2'] = { id: '5', rotation: 4 }; // home, edges {4,5}
    s.tiles['K8'] = { id: '6', rotation: 1 };
    s.tiles['F3'] = { id: '57', rotation: 2 }; // edges {2,5}, F3 edge5 -> G4

    expect(tileSupply(s, '5')).toBe(0);
    expect(tileSupply(s, '6')).toBe(1);
    expect(tileSupply(s, '57')).toBe(1);

    // #5 must NOT be a legal lay on G4 (no supply)...
    const g4 = legalLays(s, ir).filter((l) => l.hex === 'G4').map((l) => l.tile);
    expect(g4).not.toContain('5');

    // ...but it IS reported as a fitting-but-exhausted tile so the UI can grey it.
    const exhausted = exhaustedTilesOnHex(s, 'G4');
    expect(exhausted).toContain('5');
    expect(exhausted).not.toContain('6');
    expect(exhausted).not.toContain('57');
  });
});
