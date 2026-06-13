import { describe, it, expect } from 'vitest';
import { initialState, apply } from '$lib/engine';
import type { GameState } from '$lib/engine';
import { botAction } from './bots';

const seats = [
  { id: 'p1', name: 'A' },
  { id: 'p2', name: 'B' },
  { id: 'p3', name: 'C' }
];

/** Launch AG + EA under p1, run both through the OR set at phase 3 (merger unlocked). */
function toMerger(): GameState {
  let s = initialState(seats, 'rola');
  s = apply(s, { type: 'launch', player: 'p1', corp: 'AG', bid: 120 });
  s = apply(s, { type: 'pass', player: 'p1' });
  s = apply(s, { type: 'pass', player: 'p2' });
  s = apply(s, { type: 'pass', player: 'p3' });
  s = apply(s, { type: 'launch', player: 'p1', corp: 'EA', bid: 120 });
  s = apply(s, { type: 'pass', player: 'p1' });
  s = apply(s, { type: 'pass', player: 'p2' });
  s = apply(s, { type: 'pass', player: 'p3' });
  s = apply(s, { type: 'pass', player: 'p1' }); // full pass lap -> OR
  s.phase = '3'; // first green bought (mergers unlock)
  for (let or = 0; or < 2; or++) {
    for (let i = 0; i < 2; i++) {
      const sym = s.or!.order[s.or!.index];
      if (s.or!.step === 'leadoff') s = apply(s, { type: 'pass', player: 'p1' });
      s = apply(s, { type: 'pass', player: 'p1' }); // track
      s = apply(s, { type: 'pass', player: 'p1' }); // token
      s = apply(s, { type: 'run', player: 'p1', corp: sym, revenue: 0, dividend: 'withhold' });
      if (s.round !== 'operating') return s;
      s = apply(s, { type: 'pass', player: 'p1' }); // finish turn
      if (s.round !== 'operating') return s;
    }
  }
  return s;
}

describe('RoLA bot merger behaviour', () => {
  it('always merges two minors a bot solely controls, no permission needed', () => {
    let s = toMerger();
    expect(s.round).toBe('merger');
    // both AG and EA are p1's; make them connected so a merge is legal
    const front = s.merger!.queue[s.merger!.index];
    const other = front === 'AG' ? 'EA' : 'AG';
    const a = s.corporations.find((c) => c.sym === front)!;
    const b = s.corporations.find((c) => c.sym === other)!;
    b.tokenHexes = [a.tokenHexes[0]];

    const action = botAction(s, 'normal');
    expect(action?.type).toBe('propose_merge');
    s = apply(s, action!);
    // self-controlled proposal resolves immediately into a floated major
    const major = s.corporations.find((c) => c.kind === 'major' && c.floated);
    expect(major).toBeTruthy();
    expect(major!.mergedFrom?.sort()).toEqual(['AG', 'EA']);
    expect(s.merger).toBeNull(); // queue drained -> round over
  });

  it('votes its shares against an open hostile bid', () => {
    const s = toMerger();
    s.hostileMergers = true;
    const ag = s.corporations.find((c) => c.sym === 'AG')!;
    const ea = s.corporations.find((c) => c.sym === 'EA')!;
    ea.president = 'p2';
    ea.tokenHexes = [ag.tokenHexes[0]];
    // p1 proposed (pre-counted for); p2 is the remaining shareholder to vote
    s.players[1].shares = { EA: 40 };
    s.merger!.vote = { from: 'AG', to: 'EA', major: 'Con', ballots: { p1: 'for' }, voters: ['p2'] };

    expect(botAction(s, 'normal')).toEqual({ type: 'cast_merge_vote', player: 'p2', vote: 'against' });
  });

  it('declines a cross-player proposal targeting a bot-controlled minor', () => {
    const s = toMerger();
    // p1 owns both; pretend p2 controls EA so the proposal needs p2's permission
    const ea = s.corporations.find((c) => c.sym === 'EA')!;
    const ag = s.corporations.find((c) => c.sym === 'AG')!;
    ea.president = 'p2';
    ea.tokenHexes = [ag.tokenHexes[0]];
    s.merger!.pending = { from: 'AG', to: 'EA', major: 'Con' };

    const action = botAction(s, 'normal');
    expect(action).toEqual({ type: 'decline_merge', player: 'p2' });
  });
});

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
