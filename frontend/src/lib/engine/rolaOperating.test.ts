import { describe, it, expect } from 'vitest';
import { apply, initialState } from './index';
import type { GameState } from './types';

const seats = [
  { id: 'p1', name: 'A' },
  { id: 'p2', name: 'B' },
  { id: 'p3', name: 'C' }
];

/** Launch AG (home C2) and run the stock round out to the operating round. */
function toOperating(): GameState {
  let s = initialState(seats, 'rola');
  s = apply(s, { type: 'launch', player: 'p1', corp: 'AG', bid: 160 });
  s = apply(s, { type: 'pass', player: 'p1' }); // end p1 turn
  s = apply(s, { type: 'pass', player: 'p2' });
  s = apply(s, { type: 'pass', player: 'p3' });
  s = apply(s, { type: 'pass', player: 'p1' }); // full lap -> OR
  return s;
}
const AG = (s: GameState) => s.corporations.find((c) => c.sym === 'AG')!;

describe('RoLA operating round (Stage 4d)', () => {
  it('starts the OR with the launched minor and places its home token', () => {
    const s = toOperating();
    expect(s.round).toBe('operating');
    expect(s.or!.order).toEqual(['AG']);
    expect(AG(s).tokenHexes).toEqual(['C2']);
    expect(AG(s).priceCol).toBe(8); // par 80
  });

  it('withholds: drops the price one ladder space (linear movement)', () => {
    let s = toOperating();
    s = apply(s, { type: 'pass', player: 'p1' }); // skip track
    s = apply(s, { type: 'pass', player: 'p1' }); // skip token
    s = apply(s, { type: 'run', player: 'p1', corp: 'AG', revenue: 0, dividend: 'withhold' });
    expect(AG(s).priceCol).toBe(7); // 80 -> 70 on the ladder
    expect(s.or!.step).toBe('trains');
  });

  it('pays a dividend by ownership and uses the linear small-payout band (price holds)', () => {
    let s = toOperating();
    // Build a two-city route from AG's home C2 to the adjacent city D3.
    s.tiles['C2'] = { id: '5', rotation: 5 }; // city, paths to edges 5 (->D3) and 0
    s.tiles['D3'] = { id: '5', rotation: 2 }; // city, paths to edges 2 (->C2) and 3
    AG(s).trains = ['2'];
    const cashBefore = s.players[0].cash;

    s = apply(s, { type: 'pass', player: 'p1' }); // skip track
    s = apply(s, { type: 'pass', player: 'p1' }); // skip token
    s = apply(s, {
      type: 'run',
      player: 'p1',
      corp: 'AG',
      revenue: 40,
      dividend: 'pay',
      routes: [['C2', 'D3']]
    });
    // Two yellow cities (20 each) = 40. p1 holds 40% -> 16 paid; 40 < price 80 so
    // the price holds (small-payout band), confirming the linear dividend path.
    expect(s.players[0].cash).toBe(cashBefore + 16);
    expect(AG(s).priceCol).toBe(8);
  });
});
