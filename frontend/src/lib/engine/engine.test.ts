import { describe, it, expect } from 'vitest';
import { initialState } from './setup';
import { apply, replay, activePlayer, legalActions, trackLays, routeRevenue, stockLegalActions } from './index';
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

/** Drive the auction so every private sells, leaving a fresh stock round. */
function toStockRound(): GameState {
  const buys: GameAction[] = [
    { type: 'bid', player: 'p1', company: 'TR', price: 20 },
    { type: 'bid', player: 'p2', company: 'MF', price: 30 },
    { type: 'bid', player: 'p3', company: 'ER', price: 40 },
    { type: 'bid', player: 'p1', company: 'SMR', price: 50 },
    { type: 'bid', player: 'p2', company: 'DR', price: 60 },
    { type: 'bid', player: 'p3', company: 'SIR', price: 80 }
  ];
  return replay(initialState(seats3), buys);
}

function shares(s: GameState, id: string, sym: string) {
  return s.players.find((p) => p.id === id)!.shares[sym] ?? 0;
}
function corp(s: GameState, sym: string) {
  return s.corporations.find((c) => c.sym === sym)!;
}

describe('stock round - par, float, buy', () => {
  it('pars a corporation, takes the presidency, and pays 2x par', () => {
    let s = toStockRound();
    expect(s.round).toBe('stock');
    const p1Cash = cash(s, 'p1');
    s = apply(s, { type: 'par', player: 'p1', corp: 'AR', price: 100 });
    expect(corp(s, 'AR').president).toBe('p1');
    expect(corp(s, 'AR').parPrice).toBe(100);
    expect(shares(s, 'p1', 'AR')).toBe(20);
    expect(corp(s, 'AR').ipoShares).toBe(80);
    expect(cash(s, 'p1')).toBe(p1Cash - 200);
    expect(activePlayer(s)).toBe('p2'); // par ends the turn
  });

  it('floats with full capitalization once 50% is sold from the IPO', () => {
    let s = toStockRound();
    s = apply(s, { type: 'par', player: 'p1', corp: 'AR', price: 100 }); // 20% -> p2
    s = apply(s, { type: 'buy', player: 'p2', corp: 'AR', from: 'ipo' }); // 30% -> p3
    s = apply(s, { type: 'buy', player: 'p3', corp: 'AR', from: 'ipo' }); // 40% -> p1
    expect(corp(s, 'AR').floated).toBe(false);
    s = apply(s, { type: 'buy', player: 'p1', corp: 'AR', from: 'ipo' }); // 50% -> floats
    const ar = corp(s, 'AR');
    expect(ar.floated).toBe(true);
    expect(ar.cash).toBe(1000); // full cap = 10 x par
    expect(ar.ipoShares).toBe(50);
  });
});

describe('stock round - selling', () => {
  it('drops the price one step per share and moves shares to the pool', () => {
    let s = toStockRound();
    // p1 pars AR at 100 (row 0). To sell, p1 must hold more than the 20% cert.
    s = apply(s, { type: 'par', player: 'p1', corp: 'AR', price: 100 });
    s = apply(s, { type: 'pass', player: 'p2' });
    s = apply(s, { type: 'pass', player: 'p3' });
    s = apply(s, { type: 'buy', player: 'p1', corp: 'AR', from: 'ipo' }); // p1 now 30%
    s = apply(s, { type: 'pass', player: 'p2' });
    s = apply(s, { type: 'pass', player: 'p3' });
    expect(activePlayer(s)).toBe('p1');
    const before = corp(s, 'AR').priceRow!;
    const cashBefore = cash(s, 'p1');
    s = apply(s, { type: 'sell', player: 'p1', corp: 'AR', count: 1 }); // keep the 20% cert
    expect(shares(s, 'p1', 'AR')).toBe(20);
    expect(corp(s, 'AR').president).toBe('p1');
    expect(corp(s, 'AR').poolShares).toBe(10);
    expect(corp(s, 'AR').priceRow).toBe(before + 1); // one step down
    expect(cash(s, 'p1')).toBe(cashBefore + 100); // sold at 100
  });

  it('refuses to split the 20% president certificate', () => {
    let s = toStockRound();
    s = apply(s, { type: 'par', player: 'p1', corp: 'AR', price: 100 }); // p1 holds only 20%
    s = apply(s, { type: 'pass', player: 'p2' });
    s = apply(s, { type: 'pass', player: 'p3' });
    expect(() => apply(s, { type: 'sell', player: 'p1', corp: 'AR', count: 1 })).toThrow();
    // ...and the UI is not offered the illegal sale
    expect(stockLegalActions(s).sell).not.toContain('AR');
  });

  it('lets the president give up the cert when another player holds 20%', () => {
    let s = toStockRound();
    s = apply(s, { type: 'par', player: 'p1', corp: 'AR', price: 100 }); // p1 20% (pres)
    s = apply(s, { type: 'buy', player: 'p2', corp: 'AR', from: 'ipo' }); // p2 10%
    s = apply(s, { type: 'pass', player: 'p3' });
    s = apply(s, { type: 'buy', player: 'p1', corp: 'AR', from: 'ipo' }); // p1 30%
    s = apply(s, { type: 'buy', player: 'p2', corp: 'AR', from: 'ipo' }); // p2 20%
    s = apply(s, { type: 'pass', player: 'p3' });
    // back to p1 (30% pres); p2 holds 20% -> p1 may now sell below 20%
    expect(activePlayer(s)).toBe('p1');
    expect(stockLegalActions(s).sell).toContain('AR');
    s = apply(s, { type: 'sell', player: 'p1', corp: 'AR', count: 2 }); // drop to 10%
    expect(corp(s, 'AR').president).toBe('p2'); // presidency transfers
    expect(shares(s, 'p1', 'AR')).toBe(10);
  });
});

describe('stock round - ends on a full lap of passes', () => {
  it('with no floated corporations, the empty operating round returns to a stock round', () => {
    let s = toStockRound();
    s = apply(s, { type: 'pass', player: 'p1' });
    s = apply(s, { type: 'pass', player: 'p2' });
    s = apply(s, { type: 'pass', player: 'p3' });
    expect(s.round).toBe('stock'); // empty OR is skipped
    expect(s.or).toBeNull();
  });
});

/** Float AR (par 65) and pass into the operating round, AR operating, p1 president. */
function toOperatingRound(): GameState {
  let s = toStockRound();
  s = apply(s, { type: 'par', player: 'p1', corp: 'AR', price: 65 }); // p1 20%
  s = apply(s, { type: 'buy', player: 'p2', corp: 'AR', from: 'ipo' }); // 30%
  s = apply(s, { type: 'buy', player: 'p3', corp: 'AR', from: 'ipo' }); // 40%
  s = apply(s, { type: 'buy', player: 'p1', corp: 'AR', from: 'ipo' }); // 50% -> floats
  s = apply(s, { type: 'pass', player: 'p2' });
  s = apply(s, { type: 'pass', player: 'p3' });
  s = apply(s, { type: 'pass', player: 'p1' });
  return s;
}

describe('operating round', () => {
  it('floats AR and starts an operating round with AR operating', () => {
    const s = toOperatingRound();
    expect(corp(s, 'AR').floated).toBe(true);
    expect(corp(s, 'AR').cash).toBe(650); // full cap = 10 x par(65)
    expect(s.round).toBe('operating');
    expect(s.or!.order).toEqual(['AR']);
    expect(activePlayer(s)).toBe('p1'); // AR president
    // round counters: first stock round, first OR set, OR 1.1
    expect(s.srCount).toBe(1);
    expect(s.orSet).toBe(1);
    expect(s.or!.orNumber).toBe(1);
  });

  it('pays a dividend per share and moves the price right', () => {
    let s = toOperatingRound();
    // Engine computes revenue from routes: give AR a train + a K8->L7 route (40).
    corp(s, 'AR').trains = ['2'];
    s.tiles = { K8: { id: '5', rotation: 4 } };
    // holdings: p1 30%, p2 10%, p3 10%, IPO 50%; per-share = 40/10 = 4
    const col = corp(s, 'AR').priceCol!;
    const p1c = cash(s, 'p1');
    s = apply(s, { type: 'run', player: 'p1', corp: 'AR', revenue: 0, dividend: 'pay' });
    expect(cash(s, 'p1')).toBe(p1c + 12); // 3 shares x 4
    expect(corp(s, 'AR').cash).toBe(650 + 20); // 5 IPO+pool shares x 4 to treasury
    expect(corp(s, 'AR').priceCol).toBe(col + 1);
  });

  it('withholds, buys a train from the depot, then returns to a stock round', () => {
    let s = toOperatingRound();
    s = apply(s, { type: 'run', player: 'p1', corp: 'AR', revenue: 0, dividend: 'withhold' });
    s = apply(s, { type: 'buy_train', player: 'p1', corp: 'AR', train: '2' });
    expect(corp(s, 'AR').trains).toEqual(['2']);
    expect(corp(s, 'AR').cash).toBe(650 - 80);
    expect(s.depot.find((d) => d.name === '2')!.remaining).toBe(5);
    s = apply(s, { type: 'pass', player: 'p1' }); // AR finishes; phase 2 has 1 OR
    expect(s.round).toBe('stock');
  });

  it('rejects buying out of depot order', () => {
    let s = toOperatingRound();
    s = apply(s, { type: 'pass', player: 'p1' }); // skip track
    s = apply(s, { type: 'run', player: 'p1', corp: 'AR', revenue: 0, dividend: 'withhold' });
    expect(() => apply(s, { type: 'buy_train', player: 'p1', corp: 'AR', train: '3' })).toThrow();
  });
});

describe('track laying', () => {
  it('places the home token on float and lays a yellow city tile on the home hex', () => {
    let s = toOperatingRound(); // AR floated at K8, operating, track step
    expect(corp(s, 'AR').tokenHexes).toEqual(['K8']); // home token placed on float
    expect(s.or!.step).toBe('track');
    const lays = trackLays(s);
    // home hex K8 is a city -> yellow city tiles are legal there
    const home = lays.filter((l) => l.hex === 'K8');
    expect(home.length).toBeGreaterThan(0);
    expect(home.every((l) => ['5', '6', '57'].includes(l.tile))).toBe(true);
    const lay = home[0];
    s = apply(s, { type: 'lay_tile', player: 'p1', corp: 'AR', hex: lay.hex, tile: lay.tile, rotation: lay.rotation });
    expect(s.tiles['K8']).toEqual({ id: lay.tile, rotation: lay.rotation });
    expect(s.or!.step).toBe('run'); // one tile per OR -> advance to run
  });

  it('rejects an illegal lay disconnected from the network', () => {
    const s = toOperatingRound();
    // B3 (Yawatahama, gray) is far from AR's K8 token and not white -> illegal
    expect(() => apply(s, { type: 'lay_tile', player: 'p1', corp: 'AR', hex: 'B3', tile: '9', rotation: 0 })).toThrow();
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

describe('route revenue', () => {
  it('computes a 2-stop route from a tokened city to an adjacent offboard', () => {
    const s = toOperatingRound();
    corp(s, 'AR').trains = ['2'];
    s.tiles = { K8: { id: '5', rotation: 4 } }; // city tile, centre<->edges 4 & 5
    // K8 city (tile 5 = 20) + L7 offboard (yellow = 20) = 40
    expect(routeRevenue(s, corp(s, 'AR'))).toBe(40);
  });

  it('earns nothing with no train', () => {
    const s = toOperatingRound();
    s.tiles = { K8: { id: '5', rotation: 4 } };
    expect(routeRevenue(s, corp(s, 'AR'))).toBe(0);
  });
});
