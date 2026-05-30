import { describe, it, expect } from 'vitest';
import { initialState } from './setup';
import { apply, replay, activePlayer, legalActions } from './index';
import type { GameAction, GameState } from './types';

const seats3 = [
  { id: 'p1', name: 'Ann' },
  { id: 'p2', name: 'Bo' },
  { id: 'p3', name: 'Cy' }
];

function owner(s: GameState, sym: string) {
  return s.companies.find((c) => c.sym === sym)!.owner;
}
function cash(s: GameState, id: string) {
  return s.players.find((p) => p.id === id)!.cash;
}

describe('setup', () => {
  it('builds a deterministic 3-player initial state', () => {
    const s = initialState(seats3);
    expect(s.players.map((p) => p.cash)).toEqual([420, 420, 420]);
    expect(s.bank).toBe(7000 - 3 * 420);
    // 3p: TR, MF, ER, SMR, DR, SIR (no UTF which needs 4+)
    expect(s.auction!.available).toEqual(['TR', 'MF', 'ER', 'SMR', 'DR', 'SIR']);
    expect(s.round).toBe('auction');
    expect(activePlayer(s)).toBe('p1');
  });

  it('drops SIR in a 2-player game and UTF below 4 players', () => {
    const s2 = initialState([
      { id: 'p1', name: 'A' },
      { id: 'p2', name: 'B' }
    ]);
    expect(s2.auction!.available).toEqual(['TR', 'MF', 'ER', 'SMR', 'DR']);
  });
});

describe('waterfall auction - straight buys', () => {
  it('sells every company in turn and transitions to the stock round', () => {
    const actions: GameAction[] = [
      { type: 'bid', player: 'p1', company: 'TR', price: 20 },
      { type: 'bid', player: 'p2', company: 'MF', price: 30 },
      { type: 'bid', player: 'p3', company: 'ER', price: 40 },
      { type: 'bid', player: 'p1', company: 'SMR', price: 50 },
      { type: 'bid', player: 'p2', company: 'DR', price: 60 },
      { type: 'bid', player: 'p3', company: 'SIR', price: 80 }
    ];
    const s = replay(initialState(seats3), actions);
    expect(owner(s, 'TR')).toBe('p1');
    expect(owner(s, 'MF')).toBe('p2');
    expect(owner(s, 'ER')).toBe('p3');
    expect(owner(s, 'SMR')).toBe('p1');
    expect(owner(s, 'SIR')).toBe('p3');
    expect(cash(s, 'p1')).toBe(420 - 20 - 50);
    expect(cash(s, 'p2')).toBe(420 - 30 - 60);
    expect(cash(s, 'p3')).toBe(420 - 40 - 80);
    expect(s.bank).toBe(7000 - 3 * 420 + 280);
    expect(s.round).toBe('stock');
    expect(s.auction).toBeNull();
  });

  it('rejects an action from the wrong player', () => {
    const s = initialState(seats3);
    expect(() => apply(s, { type: 'bid', player: 'p2', company: 'TR', price: 20 })).toThrow();
  });

  it('rejects buying the cheapest below face', () => {
    const s = initialState(seats3);
    expect(() => apply(s, { type: 'bid', player: 'p1', company: 'TR', price: 15 })).toThrow();
  });
});

describe('waterfall auction - all pass reduces the cheapest', () => {
  it('drops the minimum bid by 5 and returns priority', () => {
    const s = replay(initialState(seats3), [
      { type: 'pass', player: 'p1' },
      { type: 'pass', player: 'p2' },
      { type: 'pass', player: 'p3' }
    ]);
    expect(s.companies.find((c) => c.sym === 'TR')!.discount).toBe(5);
    expect(legalActions(s).find((a) => a.buy)!.min).toBe(15); // TR now 15
    expect(s.players.every((p) => !p.passed)).toBe(true);
    expect(activePlayer(s)).toBe('p1');
  });

  it('forces a free purchase once the cheapest reaches zero', () => {
    // TR (20) reduced 5 each full pass-round: 4 rounds -> 0 -> forced free
    const passRound: GameAction[] = [
      { type: 'pass', player: 'p1' },
      { type: 'pass', player: 'p2' },
      { type: 'pass', player: 'p3' }
    ];
    const s = replay(initialState(seats3), [...passRound, ...passRound, ...passRound, ...passRound]);
    expect(owner(s, 'TR')).not.toBeNull();
    expect(cash(s, owner(s, 'TR')!)).toBe(420); // bought for 0
  });
});

describe('waterfall auction - placement bids and sub-auction', () => {
  it('resolves a contested company via a sub-auction', () => {
    let s = initialState(seats3);
    // p1 and p2 place bids on MF (2nd cheapest); p3 buys TR -> MF becomes cheapest with 2 bids
    s = apply(s, { type: 'bid', player: 'p1', company: 'MF', price: 35 });
    s = apply(s, { type: 'bid', player: 'p2', company: 'MF', price: 40 });
    s = apply(s, { type: 'bid', player: 'p3', company: 'TR', price: 20 });
    // MF now up for auction; lowest current bidder (p1 @35) acts
    expect(s.auction!.auctioning).toBe('MF');
    expect(activePlayer(s)).toBe('p1');
    // p1 raises to 45; p2 (now lowest at 40) passes -> p1 wins MF at 45
    s = apply(s, { type: 'bid', player: 'p1', company: 'MF', price: 45 });
    expect(activePlayer(s)).toBe('p2');
    s = apply(s, { type: 'pass', player: 'p2' });
    expect(owner(s, 'MF')).toBe('p1');
    expect(owner(s, 'TR')).toBe('p3');
    expect(cash(s, 'p1')).toBe(420 - 45);
    expect(cash(s, 'p3')).toBe(420 - 20);
    expect(s.auction!.auctioning).toBeNull();
  });

  it('auto-sells a company that has exactly one standing bid', () => {
    let s = initialState(seats3);
    s = apply(s, { type: 'bid', player: 'p1', company: 'MF', price: 35 }); // single placement bid
    s = apply(s, { type: 'bid', player: 'p2', company: 'TR', price: 20 }); // buy cheapest -> resolve MF
    expect(owner(s, 'TR')).toBe('p2');
    expect(owner(s, 'MF')).toBe('p1'); // auto-sold to the lone bidder
    expect(cash(s, 'p1')).toBe(420 - 35);
  });
});

describe('determinism', () => {
  it('replays to an identical state', () => {
    const actions: GameAction[] = [
      { type: 'bid', player: 'p1', company: 'TR', price: 20 },
      { type: 'bid', player: 'p2', company: 'MF', price: 30 }
    ];
    const a = replay(initialState(seats3), actions);
    const b = replay(initialState(seats3), actions);
    expect(a).toEqual(b);
  });
});
