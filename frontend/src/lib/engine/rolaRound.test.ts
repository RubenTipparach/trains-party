import { describe, it, expect } from 'vitest';
import { apply, initialState, rolaStockLegalActions } from './index';
import type { GameState } from './types';

const seats = [
  { id: 'p1', name: 'A' },
  { id: 'p2', name: 'B' },
  { id: 'p3', name: 'C' }
];
const rola = () => initialState(seats, 'rola');
const ag = (s: GameState) => s.corporations.find((c) => c.sym === 'AG')!;

describe('RoLA stock round (Stage 4c)', () => {
  it('launches a minor and keeps the turn open until the player passes', () => {
    let s = rola();
    s = apply(s, { type: 'launch', player: 'p1', corp: 'AG', price: 80, bid: 100 });
    expect(ag(s).floated).toBe(true);
    expect(ag(s).president).toBe('p1');
    expect(s.players[0].shares['AG']).toBe(40);
    expect(ag(s).cash).toBe(100);
    expect(s.players[0].cash).toBe(200); // 300 - 100 bid (to treasury)
    expect(s.current).toBe(0); // still p1's turn
    s = apply(s, { type: 'pass', player: 'p1' });
    expect(s.current).toBe(1);
  });

  it('rejects launching at a par outside the phase band', () => {
    const s = rola(); // phase 2 -> yellow band 60-90
    expect(() => apply(s, { type: 'launch', player: 'p1', corp: 'AG', price: 100, bid: 100 })).toThrow();
  });

  it('lets another player buy a 20% IPO share at par', () => {
    let s = rola();
    s = apply(s, { type: 'launch', player: 'p1', corp: 'AG', price: 80, bid: 100 });
    s = apply(s, { type: 'pass', player: 'p1' });
    s = apply(s, { type: 'buy', player: 'p2', corp: 'AG', from: 'ipo' });
    expect(s.players[1].shares['AG']).toBe(20);
    expect(ag(s).ipoShares).toBe(40); // 100 - 40 (pres) - 20 (sold)
    expect(s.players[1].cash).toBe(220); // 300 - 80 par
  });

  it('drops the price one space per sale (not per share)', () => {
    let s = rola();
    s = apply(s, { type: 'launch', player: 'p1', corp: 'AG', price: 80, bid: 100 }); // col 8
    s = apply(s, { type: 'pass', player: 'p1' }); // p2's turn
    // p2 (a non-president) holds two single shares (40%)
    s.players[1].shares['AG'] = 40;
    ag(s).ipoShares = 20; // 100 - 40 pres - 40 p2
    const before = ag(s).priceCol!;
    s = apply(s, { type: 'sell', player: 'p2', corp: 'AG', count: 2 });
    expect(ag(s).priceCol).toBe(before - 1); // one space, despite selling two shares
    expect(ag(s).poolShares).toBe(40);
    expect(s.players[1].shares['AG']).toBe(0);
    expect(s.players[1].cash).toBe(300 + 2 * 80); // proceeds at the pre-move price (80)
  });

  it('ends the round on a full lap of passes and starts the OR with launched minors', () => {
    let s = rola();
    s = apply(s, { type: 'launch', player: 'p1', corp: 'AG', price: 80, bid: 100 });
    s = apply(s, { type: 'pass', player: 'p1' }); // ends p1 turn
    s = apply(s, { type: 'pass', player: 'p2' }); // pure pass 1
    s = apply(s, { type: 'pass', player: 'p3' }); // pure pass 2
    s = apply(s, { type: 'pass', player: 'p1' }); // pure pass 3 -> end SR
    expect(s.round).toBe('operating');
    expect(s.or!.order).toContain('AG');
    expect(ag(s).tokenHexes).toContain('C2'); // home token placed when it first operates
  });

  it('surfaces launch / buy / sell options and respects the 60% hold cap', () => {
    let s = rola();
    let legal = rolaStockLegalActions(s);
    expect(legal.launch.find((l) => l.corp === 'AG')?.pars).toEqual([60, 70, 80, 90]);

    s = apply(s, { type: 'launch', player: 'p1', corp: 'AG', price: 80, bid: 100 });
    s = apply(s, { type: 'pass', player: 'p1' });
    // p2 at 60% should not be offered another AG buy
    s.players[1].shares['AG'] = 60;
    legal = rolaStockLegalActions(s);
    expect(legal.player).toBe('p2');
    expect(legal.buyIpo).not.toContain('AG');
  });

  it('transfers the presidency when a buyer out-holds the president', () => {
    let s = rola();
    s = apply(s, { type: 'launch', player: 'p1', corp: 'AG', price: 80, bid: 100 }); // p1 pres 40%
    s = apply(s, { type: 'pass', player: 'p1' });
    // set p2 to 40% then buy one more 20% -> 60% > 40%, takes presidency
    s.players[1].shares['AG'] = 40;
    ag(s).ipoShares = 20;
    s = apply(s, { type: 'buy', player: 'p2', corp: 'AG', from: 'ipo' });
    expect(s.players[1].shares['AG']).toBe(60);
    expect(ag(s).president).toBe('p2');
  });
});
