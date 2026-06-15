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
  it('buys an affordable pool train instead of soft-locking on the unaffordable depot top', () => {
    const s = floatIRAtBuyStep(350); // can afford the pooled 4 (300), not the depot 5 (450)
    const a = botAction(s, 'normal');
    expect(a).not.toBeNull();
    expect(a!.type).toBe('buy_train');
    expect((a as any).train).toBe('4');
    // The chosen action is legal: applying it adds the train, no throw.
    const next = apply(s, a!);
    const ir = next.corporations.find((c) => c.sym === 'IR')!;
    expect(ir.trains).toContain('4');
  });

  it('still raises money (emergency) when even the cheapest buyable train is unaffordable', () => {
    const s = floatIRAtBuyStep(50); // cannot afford the pooled 4 either -> emergency path
    const a = botAction(s, 'normal');
    expect(a).not.toBeNull();
    // The president sells shares or the corp funds the buy; never an illegal pass.
    expect(a!.type).not.toBe('pass');
  });
});
