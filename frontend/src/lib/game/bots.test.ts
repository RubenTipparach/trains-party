import { describe, it, expect } from 'vitest';
import { initialState, apply, type GameState } from '$lib/engine';
import { botAction } from './bots';

/**
 * Regression: a bot soft-locked on a mandatory train purchase.
 *
 * When a corporation must own a train (zero trains, can run a route) at the buy
 * step, the bot only ever tried to buy the depot's TOP train. If that top train
 * is unaffordable but a cheaper discard sits in the bank pool (e.g. a minor
 * dropped a train to the pool when the train limit fell at a phase change), the
 * buy is affordable - so it is not an "emergency" - yet the bot had no branch to
 * pick the pool train. It fell through to an illegal `pass` ("must own a train
 * before finishing"), freezing the game.
 */
function floatIRAtBuyStep(cash: number): GameState {
  const s: GameState = initialState([{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }] as any);
  const ir = s.corporations.find((c) => c.sym === 'IR')!;
  ir.floated = true;
  ir.president = 'p1';
  ir.tokenHexes = ['E2'];
  ir.trains = [];
  ir.cash = cash;
  // A connected city line E2-F3-G4 so the company can actually run a route
  // (mustBuyTrain is true only when a route exists). Mirrors routing.test.ts.
  s.tiles['E2'] = { id: '5', rotation: 4 };
  s.tiles['F3'] = { id: '57', rotation: 2 };
  s.tiles['G4'] = { id: '57', rotation: 2 };
  // Depot: exhaust the cheap piles so the top available train is the 5-train
  // (unaffordable at 350); drop a cheaper 4-train into the bank pool.
  for (const name of ['2', '3', '4']) {
    const pile = s.depot.find((d) => d.name === name);
    if (pile) pile.remaining = 0;
  }
  s.trainPool = ['4'];
  s.round = 'operating';
  s.or = { order: ['IR'], index: 0, step: 'trains', orNumber: 1, orsThisSet: 2, yellowLaid: 0 };
  return s;
}

describe('bot mandatory train purchase', () => {
  // Both the testing and strategic ('easy') bots must handle a forced buy; the
  // strategic bot delegates the mandatory/emergency cases to the testing logic.
  for (const level of ['testing', 'easy'] as const) {
    it(`(${level}) buys an affordable pool train instead of soft-locking on the unaffordable depot top`, () => {
      const s = floatIRAtBuyStep(350); // can afford the pooled 4 (300), not the depot 5 (450)
      const a = botAction(s, level);
      expect(a).not.toBeNull();
      expect(a!.type).toBe('buy_train');
      expect((a as any).train).toBe('4');
      // The chosen action is legal: applying it adds the train, no throw.
      const next = apply(s, a!);
      const ir = next.corporations.find((c) => c.sym === 'IR')!;
      expect(ir.trains).toContain('4');
    });

    it(`(${level}) still raises money (emergency) when even the cheapest buyable train is unaffordable`, () => {
      const s = floatIRAtBuyStep(50); // cannot afford the pooled 4 either -> emergency path
      const a = botAction(s, level);
      expect(a).not.toBeNull();
      // The president sells shares or the corp funds the buy; never an illegal pass.
      expect(a!.type).not.toBe('pass');
    });
  }
});

describe('strategic bot steals a beatable, cash-rich company', () => {
  it('out-buys a weak president (< 50%) of a treasury-rich floated corp', () => {
    // p1 already presides over a floated IR (so it founds nothing). p2 presides over
    // AR with only 20%; AR is floated and cash-rich. p1 holds 40% of AR, so buying
    // one more share out-holds p2 and seizes the AR presidency.
    const s: GameState = initialState([
      { id: 'p1', name: 'A' },
      { id: 'p2', name: 'B' }
    ] as any);
    s.round = 'stock';
    s.srCount = 2; // a later stock round (strategy / selling enabled)
    s.stock = { acted: false, bought: false, passes: 0, soldThisRound: {} } as any;
    s.current = 0; // p1 to act

    const ir = s.corporations.find((c) => c.sym === 'IR')!;
    ir.floated = true;
    ir.president = 'p1';
    ir.parPrice = 75;
    ir.priceRow = 3;
    ir.priceCol = 3;
    ir.ipoShares = 30;

    const ar = s.corporations.find((c) => c.sym === 'AR')!;
    ar.floated = true;
    ar.president = 'p2';
    ar.parPrice = 100;
    ar.priceRow = 0;
    ar.priceCol = 3;
    ar.ipoShares = 40; // 100% - p2 20% - p1 40% = 40% left in IPO
    ar.poolShares = 0;
    ar.cash = 300; // "lots of money" -> worth stealing
    ar.trains = ['3'];

    s.players[0].cash = 1000;
    s.players[0].shares = { IR: 20, AR: 40 };
    s.players[1].shares = { AR: 20 };

    const a = botAction(s, 'easy');
    expect(a).toEqual({ type: 'buy', player: 'p1', corp: 'AR', from: 'ipo' });
    const next = apply(s, a!);
    expect(next.corporations.find((c) => c.sym === 'AR')!.president).toBe('p1'); // seized
  });
});

describe('strategic bot 1889 full playthrough', () => {
  // The strategic bot must never propose an illegal action across an entire game.
  for (const level of ['testing', 'easy'] as const) {
    it(`(${level}) drives a 4-player 1889 game to completion without an illegal move`, () => {
      let s: GameState = initialState([
        { id: 'p1', name: 'A' },
        { id: 'p2', name: 'B' },
        { id: 'p3', name: 'C' },
        { id: 'p4', name: 'D' }
      ] as any);
      let floated = false;
      let operated = false;
      let steps = 0;
      while (steps < 4000 && !s.finished) {
        const action = botAction(s, level);
        if (!action) break;
        s = apply(s, action); // throws if the bot ever proposes an illegal action
        if (s.round === 'operating') operated = true;
        if (s.corporations.some((c) => c.floated)) floated = true;
        steps += 1;
      }
      expect(floated).toBe(true); // a corporation gets founded and floated
      expect(operated).toBe(true); // the game reaches operating rounds
      expect(s.round).not.toBe('auction'); // it progresses past the opening auction
    });
  }
});
