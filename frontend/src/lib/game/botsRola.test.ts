import { describe, it, expect } from 'vitest';
import { initialState, apply } from '$lib/engine';
import { botAction } from './bots';

describe('RoLA bot playthrough', () => {
  it('bots launch minors and drive multiple stock/operating cycles without error', () => {
    let s = initialState(
      [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }, { id: 'p3', name: 'C' }],
      'rola'
    );
    let launches = 0;
    let operated = false;
    let steps = 0;

    while (steps < 400 && !s.finished) {
      const action = botAction(s, 'normal');
      if (!action) break;
      s = apply(s, action); // throws if the bot ever proposes an illegal action
      if (action.type === 'launch') launches += 1;
      if (s.round === 'operating') operated = true;
      steps += 1;
    }

    expect(launches).toBeGreaterThan(0); // bots actually launch minors
    expect(operated).toBe(true); // the game reaches operating rounds
    expect(s.srCount).toBeGreaterThan(1); // and cycles back into later stock rounds
    expect(s.corporations.some((c) => c.kind === 'minor' && c.floated)).toBe(true);
    // a launched minor has placed its home token by operating
    const live = s.corporations.find((c) => c.floated);
    expect(live!.tokenHexes.length).toBeGreaterThan(0);
  });
});
