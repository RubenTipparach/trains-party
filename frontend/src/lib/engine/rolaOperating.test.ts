import { describe, it, expect } from 'vitest';
import { apply, initialState, trackLays, operatingView } from './index';
import { launchViaAuction } from './rolaTestUtil';
import type { GameState } from './types';

const seats = [
  { id: 'p1', name: 'A' },
  { id: 'p2', name: 'B' },
  { id: 'p3', name: 'C' }
];

/** Launch AG (home C2) and run the stock round out to the operating round. */
function toOperating(): GameState {
  let s = launchViaAuction(initialState(seats, 'rola'), 'p1', 'AG', 160); // turn -> p2
  s = apply(s, { type: 'pass', player: 'p2' });
  s = apply(s, { type: 'pass', player: 'p3' });
  s = apply(s, { type: 'pass', player: 'p1' }); // full lap -> OR
  return s;
}
const AG = (s: GameState) => s.corporations.find((c) => c.sym === 'AG')!;

describe('RoLA leadoff train + issue/redeem + two yellow lays', () => {
  it("opens a fresh minor's first turn at the leadoff step and buys a train that can run", () => {
    let s = toOperating();
    expect(s.or!.step).toBe('leadoff');
    s = apply(s, { type: 'buy_train', player: 'p1', corp: 'AG', train: '2' });
    expect(AG(s).trains).toEqual(['2']);
    expect(AG(s).cash).toBe(60); // 160 bid - 100 train, paid from the treasury
    expect(s.or!.step).toBe('track'); // one leadoff train, then the normal turn
  });

  it('enforces the minor train limit (2 in the early phases)', () => {
    const s = toOperating();
    AG(s).trains = ['2', '2']; // phase 2: a minor may hold at most 2 trains
    AG(s).cash = 1000;
    s.or!.step = 'trains';
    expect(operatingView(s)!.canBuyTrain).toBeNull(); // no buy offered at the limit
    expect(() => apply(s, { type: 'buy_train', player: 'p1', corp: 'AG', train: '2' })).toThrow(/limit/i);
  });

  it('does not let the president fund an optional train buy (only emergencies)', () => {
    const s = toOperating(); // AG at the leadoff step (an optional buy)
    AG(s).cash = 50; // treasury short of the 100 price
    s.players[0].cash = 1000; // president is flush, but may not chip in
    expect(() => apply(s, { type: 'buy_train', player: 'p1', corp: 'AG', train: '2' })).toThrow(/afford/i);
  });

  it('skipping the leadoff moves to the track step; later ORs skip it entirely', () => {
    let s = toOperating();
    s = apply(s, { type: 'pass', player: 'p1' }); // skip leadoff
    expect(s.or!.step).toBe('track');
    // finish the turn: skip track + token, run 0, finish -> OR 2 begins
    s = apply(s, { type: 'pass', player: 'p1' });
    s = apply(s, { type: 'pass', player: 'p1' });
    s = apply(s, { type: 'run', player: 'p1', corp: 'AG', revenue: 0, dividend: 'withhold' });
    s = apply(s, { type: 'pass', player: 'p1' });
    expect(s.or!.orNumber).toBe(2);
    expect(AG(s).operated).toBe(true);
    expect(s.or!.step).toBe('track'); // no leadoff once the minor has operated
  });

  it('issues a share at the start of the turn (treasury +price, price -1, once)', () => {
    let s = toOperating();
    const before = AG(s).cash;
    s = apply(s, { type: 'issue', player: 'p1', corp: 'AG' });
    expect(AG(s).cash).toBe(before + 80); // current price 80
    expect(AG(s).poolShares).toBe(20);
    expect(AG(s).priceCol).toBe(7); // 80 -> 70
    expect(() => apply(s, { type: 'issue', player: 'p1', corp: 'AG' })).toThrow(/already issued/);
  });

  it('redeems a pooled share at current price with no price move', () => {
    let s = toOperating();
    AG(s).poolShares = 20;
    AG(s).ipoShares = 40;
    AG(s).cash = 200;
    s = apply(s, { type: 'redeem', player: 'p1', corp: 'AG' });
    expect(AG(s).poolShares).toBe(0);
    expect(AG(s).cash).toBe(120); // paid the 80 price
    expect(AG(s).priceCol).toBe(8); // unchanged
  });

  it('allows a second yellow lay in the same turn (2 yellow or 1 upgrade)', () => {
    let s = toOperating();
    s = apply(s, { type: 'pass', player: 'p1' }); // leadoff -> track
    const lays = trackLays(s).filter((l) => !l.upgrade && l.cost <= AG(s).cash);
    expect(lays.length).toBeGreaterThan(0);
    const a = lays[0];
    s = apply(s, { type: 'lay_tile', player: 'p1', corp: 'AG', hex: a.hex, tile: a.tile, rotation: a.rotation });
    expect(s.or!.step).toBe('track'); // still open for the second yellow
    expect(s.or!.yellowLaid).toBe(1);
    const lays2 = trackLays(s).filter((l) => l.cost <= AG(s).cash);
    expect(lays2.every((l) => !l.upgrade)).toBe(true); // upgrades are off the table now
    if (lays2.length) {
      const b = lays2[0];
      s = apply(s, { type: 'lay_tile', player: 'p1', corp: 'AG', hex: b.hex, tile: b.tile, rotation: b.rotation });
      expect(s.or!.step).toBe('token'); // two yellows laid -> on to the token step
    }
  });
});

describe('RoLA cycles + export-a-train', () => {
  const finishOr1Turn = (s: GameState) => {
    s = apply(s, { type: 'pass', player: 'p1' }); // leadoff
    s = apply(s, { type: 'pass', player: 'p1' }); // track
    s = apply(s, { type: 'pass', player: 'p1' }); // token
    s = apply(s, { type: 'run', player: 'p1', corp: 'AG', revenue: 0, dividend: 'withhold' });
    return apply(s, { type: 'pass', player: 'p1' }); // trains -> next
  };
  const finishOr2Turn = (s: GameState) => {
    s = apply(s, { type: 'pass', player: 'p1' }); // track (no leadoff now)
    s = apply(s, { type: 'pass', player: 'p1' }); // token
    s = apply(s, { type: 'run', player: 'p1', corp: 'AG', revenue: 0, dividend: 'withhold' });
    return apply(s, { type: 'pass', player: 'p1' });
  };

  it('exports the top train after the OR set (all 2s go together) and advances the cycle', () => {
    let s = toOperating();
    expect(s.cycle).toBe(1);
    s = finishOr1Turn(s);
    expect(s.or!.orNumber).toBe(2);
    s = finishOr2Turn(s);
    expect(s.round).toBe('stock');
    expect(s.cycle).toBe(2);
    expect(s.depot.find((d) => d.name === '2')!.remaining).toBe(0); // exported as a block
  });

  it('ends the game after the final cycle with cash + share value scoring', () => {
    let s = toOperating();
    s.cycle = 6; // 3 players -> Long game, 6 cycles
    s = finishOr1Turn(s);
    s = finishOr2Turn(s);
    expect(s.finished).toBe(true);
    expect(s.winner).toBeTruthy();
  });

  it('removes the player-count extra 3/6 trains below 4 players', () => {
    const s3 = initialState(seats, 'rola');
    expect(s3.depot.find((d) => d.name === '3')!.remaining).toBe(4);
    expect(s3.depot.find((d) => d.name === '6')!.remaining).toBe(2);
    const s4 = initialState([...seats, { id: 'p4', name: 'D' }], 'rola');
    expect(s4.depot.find((d) => d.name === '3')!.remaining).toBe(5);
    expect(s4.depot.find((d) => d.name === '6')!.remaining).toBe(3);
  });
});

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
