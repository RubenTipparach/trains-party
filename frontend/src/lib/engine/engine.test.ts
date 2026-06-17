import { describe, it, expect } from 'vitest';
import { HEX_BY_COORD } from '$lib/data/map1889';
import { initialState } from './setup';
import {
  apply,
  replay,
  activePlayer,
  legalActions,
  trackLays,
  routeRevenue,
  stockLegalActions,
  neighbor,
  playerValue,
  operatingView
} from './index';
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
    // the turn stays open after a par/buy; it is still p1's turn until they pass
    expect(activePlayer(s)).toBe('p1');
    s = apply(s, { type: 'pass', player: 'p1' }); // end turn
    expect(activePlayer(s)).toBe('p2');
  });

  it('floats with full capitalization once 50% is sold from the IPO', () => {
    let s = toStockRound();
    // each player buys once then passes to end their turn
    s = apply(s, { type: 'par', player: 'p1', corp: 'AR', price: 100 }); // 20%
    s = apply(s, { type: 'pass', player: 'p1' });
    s = apply(s, { type: 'buy', player: 'p2', corp: 'AR', from: 'ipo' }); // 30%
    s = apply(s, { type: 'pass', player: 'p2' });
    s = apply(s, { type: 'buy', player: 'p3', corp: 'AR', from: 'ipo' }); // 40%
    s = apply(s, { type: 'pass', player: 'p3' });
    expect(corp(s, 'AR').floated).toBe(false);
    s = apply(s, { type: 'buy', player: 'p1', corp: 'AR', from: 'ipo' }); // 50% -> floats
    const ar = corp(s, 'AR');
    expect(ar.floated).toBe(true);
    expect(ar.cash).toBe(1000); // full cap = 10 x par
    expect(ar.ipoShares).toBe(50);
  });

  it('only one buy per turn, and cannot buy a corp sold this round', () => {
    let s = toStockRound();
    // p1 pars AR and builds to 30% over earlier turns
    s = apply(s, { type: 'par', player: 'p1', corp: 'AR', price: 100 });
    s = apply(s, { type: 'pass', player: 'p1' });
    s = apply(s, { type: 'pass', player: 'p2' });
    s = apply(s, { type: 'pass', player: 'p3' });
    s = apply(s, { type: 'buy', player: 'p1', corp: 'AR', from: 'ipo' }); // 30%, turn open
    // a second buy this turn is rejected
    expect(() => apply(s, { type: 'buy', player: 'p1', corp: 'AR', from: 'ipo' })).toThrow();
    // selling is allowed in the same turn (turn stays open)
    s = apply(s, { type: 'sell', player: 'p1', corp: 'AR', count: 1 });
    expect(shares(s, 'p1', 'AR')).toBe(20);
    expect(activePlayer(s)).toBe('p1');
    s = apply(s, { type: 'pass', player: 'p1' }); // end turn
    // back to p1 next round-lap: may NOT buy AR (sold it this round)
    s = apply(s, { type: 'pass', player: 'p2' });
    s = apply(s, { type: 'pass', player: 'p3' });
    expect(activePlayer(s)).toBe('p1');
    expect(stockLegalActions(s).buyIpo).not.toContain('AR');
    expect(() => apply(s, { type: 'buy', player: 'p1', corp: 'AR', from: 'ipo' })).toThrow();
  });
});

describe('stock round - selling', () => {
  it('drops the price one step per share and moves shares to the pool', () => {
    let s = toStockRound();
    // p1 pars AR at 100 (row 0). To sell, p1 must hold more than the 20% cert.
    s = apply(s, { type: 'par', player: 'p1', corp: 'AR', price: 100 });
    s = apply(s, { type: 'pass', player: 'p1' });
    s = apply(s, { type: 'pass', player: 'p2' });
    s = apply(s, { type: 'pass', player: 'p3' });
    s = apply(s, { type: 'buy', player: 'p1', corp: 'AR', from: 'ipo' }); // p1 now 30%
    s = apply(s, { type: 'pass', player: 'p1' });
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
    // still p1's turn; selling the lone 20% cert is illegal
    expect(() => apply(s, { type: 'sell', player: 'p1', corp: 'AR', count: 1 })).toThrow();
    expect(stockLegalActions(s).sell).not.toContain('AR');
  });

  it('lets the president give up the cert when another player holds 20%', () => {
    let s = toStockRound();
    s = apply(s, { type: 'par', player: 'p1', corp: 'AR', price: 100 }); // p1 20% (pres)
    s = apply(s, { type: 'pass', player: 'p1' });
    s = apply(s, { type: 'buy', player: 'p2', corp: 'AR', from: 'ipo' }); // p2 10%
    s = apply(s, { type: 'pass', player: 'p2' });
    s = apply(s, { type: 'pass', player: 'p3' });
    s = apply(s, { type: 'buy', player: 'p1', corp: 'AR', from: 'ipo' }); // p1 30%
    s = apply(s, { type: 'pass', player: 'p1' });
    s = apply(s, { type: 'buy', player: 'p2', corp: 'AR', from: 'ipo' }); // p2 20%
    s = apply(s, { type: 'pass', player: 'p2' });
    s = apply(s, { type: 'pass', player: 'p3' });
    // back to p1 (30% pres); p2 holds 20% -> p1 may now sell below 20%
    expect(activePlayer(s)).toBe('p1');
    expect(stockLegalActions(s).sell).toContain('AR');
    s = apply(s, { type: 'sell', player: 'p1', corp: 'AR', count: 2 }); // drop to 10%
    expect(corp(s, 'AR').president).toBe('p2'); // presidency transfers
    expect(shares(s, 'p1', 'AR')).toBe(10);
  });

  it('transfers the presidency to a buyer who out-holds the president (no sale needed)', () => {
    let s = toStockRound();
    s = apply(s, { type: 'par', player: 'p1', corp: 'AR', price: 65 }); // p1 20% (pres)
    s = apply(s, { type: 'pass', player: 'p1' });
    s = apply(s, { type: 'buy', player: 'p2', corp: 'AR', from: 'ipo' }); // p2 10%
    s = apply(s, { type: 'pass', player: 'p2' });
    s = apply(s, { type: 'pass', player: 'p3' });
    s = apply(s, { type: 'pass', player: 'p1' });
    s = apply(s, { type: 'buy', player: 'p2', corp: 'AR', from: 'ipo' }); // p2 20% (ties, no steal)
    expect(corp(s, 'AR').president).toBe('p1');
    s = apply(s, { type: 'pass', player: 'p2' });
    s = apply(s, { type: 'pass', player: 'p3' });
    s = apply(s, { type: 'pass', player: 'p1' });
    s = apply(s, { type: 'buy', player: 'p2', corp: 'AR', from: 'ipo' }); // p2 30% > p1 20%
    expect(corp(s, 'AR').president).toBe('p2'); // seized by buying, p1 never sold
    expect(shares(s, 'p1', 'AR')).toBe(20); // p1 keeps its shares
    expect(corp(s, 'AR').floated).toBe(true); // the 50%th share also floats it
  });

  it('omits par/buy options that would exceed the certificate limit', () => {
    // 6-player cert limit is 11. Craft a stock turn where p1 sits just under it.
    const s: GameState = initialState(
      ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((id) => ({ id, name: id }))
    );
    s.round = 'stock';
    s.stock = { acted: false, bought: false, passes: 0, soldThisRound: {} };
    s.current = 0; // p1 to act, nothing bought yet
    // Two white-zone corps p2 presides over; p1 holds plain shares (each 10% = 1 cert).
    for (const sym of ['IR', 'SR']) {
      const c = corp(s, sym);
      c.parPrice = 100;
      c.priceRow = 0;
      c.priceCol = 3; // a white (non-yellow) cell, so the shares count toward the limit
      c.president = 'p2';
      c.floated = true;
    }
    const ar = corp(s, 'AR');
    ar.parPrice = 100;
    ar.priceRow = 0;
    ar.priceCol = 3;
    ar.president = 'p2';
    ar.floated = true;
    ar.ipoShares = 70;
    s.players[0].cash = 2000;
    s.players[0].shares = { IR: 60, SR: 40 }; // 6 + 4 = 10 certs (one under the limit)
    s.players[1].shares = { IR: 20, SR: 20, AR: 20 };

    expect(stockLegalActions(s).buyIpo).toContain('AR'); // 11th cert fits
    expect(stockLegalActions(s).par.length).toBeGreaterThan(0); // and a new par fits

    s.players[0].shares = { IR: 60, SR: 50 }; // 6 + 5 = 11 certs (exactly the limit)
    const la = stockLegalActions(s);
    expect(la.buyIpo).not.toContain('AR'); // a 12th certificate is over the limit
    expect(la.par).toEqual([]); // and no new corporation may be started either
    expect(() => apply(s, { type: 'buy', player: 'p1', corp: 'AR', from: 'ipo' })).toThrow();
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
  // each player takes one buy then ends their turn with a pass
  s = apply(s, { type: 'par', player: 'p1', corp: 'AR', price: 65 }); // p1 20%
  s = apply(s, { type: 'pass', player: 'p1' });
  s = apply(s, { type: 'buy', player: 'p2', corp: 'AR', from: 'ipo' }); // 30%
  s = apply(s, { type: 'pass', player: 'p2' });
  s = apply(s, { type: 'buy', player: 'p3', corp: 'AR', from: 'ipo' }); // 40%
  s = apply(s, { type: 'pass', player: 'p3' });
  s = apply(s, { type: 'buy', player: 'p1', corp: 'AR', from: 'ipo' }); // 50% -> floats
  s = apply(s, { type: 'pass', player: 'p1' });
  // everyone passes (a full consecutive lap) -> stock round ends, OR begins
  let guard = 0;
  while (s.round === 'stock' && guard++ < 12) {
    s = apply(s, { type: 'pass', player: activePlayer(s)! });
  }
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

  it('pays a dividend per share and moves the price right; IPO shares pay nobody', () => {
    let s = toOperatingRound();
    // Engine computes revenue from routes: give AR a train + a K8->L7 route (40).
    corp(s, 'AR').trains = ['2'];
    s.tiles = { K8: { id: '5', rotation: 4 } };
    // holdings: p1 30%, p2 10%, p3 10%, IPO 50%, pool 0%; per-share = 40/10 = 4
    const col = corp(s, 'AR').priceCol!;
    const p1c = cash(s, 'p1');
    const arCash = corp(s, 'AR').cash;
    s = apply(s, { type: 'run', player: 'p1', corp: 'AR', revenue: 0, dividend: 'pay' });
    expect(cash(s, 'p1')).toBe(p1c + 12); // 3 shares x 4
    // IPO shares pay nobody, and there are no pool shares -> treasury unchanged
    expect(corp(s, 'AR').cash).toBe(arCash);
    expect(corp(s, 'AR').priceCol).toBe(col + 1);
  });

  it('market (pool) shares pay the corporation treasury', () => {
    let s = toOperatingRound();
    const ar = corp(s, 'AR');
    ar.trains = ['2'];
    s.tiles = { K8: { id: '5', rotation: 4 } };
    // move 20% from IPO into the market pool (as if shares were sold)
    ar.ipoShares -= 20;
    ar.poolShares += 20;
    const arCash = ar.cash;
    s = apply(s, { type: 'run', player: 'p1', corp: 'AR', revenue: 0, dividend: 'pay' });
    // 40 revenue / 10 = 4 per share; 2 pool shares -> 8 to treasury
    expect(corp(s, 'AR').cash).toBe(arCash + 8);
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

  it('cross-buys a train from another corporation the same president controls', () => {
    let s = toOperatingRound();
    // Give a second corp (controlled by p1) a train to sell.
    const seller = s.corporations.find((x) => x.sym !== 'AR')!;
    seller.president = 'p1';
    seller.floated = true;
    seller.trains = ['2'];
    const sellerCash = seller.cash;
    s = apply(s, { type: 'pass', player: 'p1' }); // skip track
    s = apply(s, { type: 'run', player: 'p1', corp: 'AR', revenue: 0, dividend: 'withhold' });
    const arCash = corp(s, 'AR').cash;
    s = apply(s, { type: 'buy_train', player: 'p1', corp: 'AR', train: '2', from: seller.sym, price: 1 });
    expect(corp(s, 'AR').trains).toEqual(['2']);
    expect(corp(s, seller.sym).trains).toEqual([]);
    expect(corp(s, 'AR').cash).toBe(arCash - 1);
    expect(corp(s, seller.sym).cash).toBe(sellerCash + 1);
  });

  it('rejects a cross-buy price above the buyer treasury or below 1', () => {
    let s = toOperatingRound();
    const seller = s.corporations.find((x) => x.sym !== 'AR')!;
    seller.president = 'p1';
    seller.floated = true;
    seller.trains = ['2'];
    s = apply(s, { type: 'pass', player: 'p1' });
    s = apply(s, { type: 'run', player: 'p1', corp: 'AR', revenue: 0, dividend: 'withhold' });
    const tooMuch = corp(s, 'AR').cash + 1;
    expect(() => apply(s, { type: 'buy_train', player: 'p1', corp: 'AR', train: '2', from: seller.sym, price: tooMuch })).toThrow();
    expect(() => apply(s, { type: 'buy_train', player: 'p1', corp: 'AR', train: '2', from: seller.sym, price: 0 })).toThrow();
  });

  it('rejects cross-buying from a corporation a different president controls', () => {
    let s = toOperatingRound();
    const seller = s.corporations.find((x) => x.sym !== 'AR')!;
    seller.president = 'p2';
    seller.floated = true;
    seller.trains = ['2'];
    s = apply(s, { type: 'pass', player: 'p1' });
    s = apply(s, { type: 'run', player: 'p1', corp: 'AR', revenue: 0, dividend: 'withhold' });
    expect(() => apply(s, { type: 'buy_train', player: 'p1', corp: 'AR', train: '2', from: seller.sym, price: 1 })).toThrow();
  });

  // Give the operating president (p1) a private company, in phase 3 so a corp it
  // presides over may buy it (a corporation may only absorb its president's own
  // private; another player's needs consent, which bots decline).
  function withPrivateInPhase3() {
    let s = toOperatingRound();
    s.phase = '3';
    const co = s.companies[0];
    co.owner = 'p1';
    co.closed = false;
    for (const p of s.players) p.companies = p.companies.filter((x) => x !== co.sym);
    s.players.find((p) => p.id === 'p1')!.companies = [co.sym];
    s = apply(s, { type: 'pass', player: 'p1' }); // skip track
    s = apply(s, { type: 'run', player: 'p1', corp: 'AR', revenue: 0, dividend: 'withhold' });
    return { s, co };
  }

  it('lets a corporation buy its president\'s private company and then earns its income', () => {
    let { s, co } = withPrivateInPhase3();
    const p1Cash = cash(s, 'p1');
    const arCash = corp(s, 'AR').cash;
    s = apply(s, { type: 'buy_company', player: 'p1', corp: 'AR', company: co.sym, price: 2 });
    expect(corp(s, 'AR').companies).toContain(co.sym);
    expect(s.players.find((p) => p.id === 'p1')!.companies).not.toContain(co.sym);
    expect(s.companies.find((x) => x.sym === co.sym)!.owner).toBeNull();
    expect(cash(s, 'p1')).toBe(p1Cash + 2); // the president pockets the sale
    expect(corp(s, 'AR').cash).toBe(arCash - 2);
    // The next OR pays the private's income into the corporation treasury.
    const before = corp(s, 'AR').cash;
    s = apply(s, { type: 'pass', player: 'p1' }); // AR finishes -> next round / OR
    const arNow = corp(s, 'AR');
    if (s.round === 'operating') expect(arNow.cash).toBe(before + co.revenue);
  });

  it('refuses to buy another player\'s private (needs consent)', () => {
    let s = toOperatingRound();
    s.phase = '3';
    const co = s.companies[0];
    co.owner = 'p2'; // owned by someone other than AR's president (p1)
    co.closed = false;
    for (const p of s.players) p.companies = p.companies.filter((x) => x !== co.sym);
    s.players.find((p) => p.id === 'p2')!.companies = [co.sym];
    s = apply(s, { type: 'pass', player: 'p1' });
    s = apply(s, { type: 'run', player: 'p1', corp: 'AR', revenue: 0, dividend: 'withhold' });
    expect(() => apply(s, { type: 'buy_company', player: 'p1', corp: 'AR', company: co.sym, price: 2 })).toThrow();
  });

  it('rejects a company price above twice face value or below 1', () => {
    const { s, co } = withPrivateInPhase3();
    expect(() => apply(s, { type: 'buy_company', player: 'p1', corp: 'AR', company: co.sym, price: 2 * co.value + 1 })).toThrow();
    expect(() => apply(s, { type: 'buy_company', player: 'p1', corp: 'AR', company: co.sym, price: 0 })).toThrow();
  });

  it('rejects buying a private before phase 3', () => {
    let s = toOperatingRound(); // phase 2
    const co = s.companies[0];
    co.owner = 'p1';
    s.players.find((p) => p.id === 'p1')!.companies = [co.sym];
    s = apply(s, { type: 'pass', player: 'p1' });
    s = apply(s, { type: 'run', player: 'p1', corp: 'AR', revenue: 0, dividend: 'withhold' });
    expect(() => apply(s, { type: 'buy_company', player: 'p1', corp: 'AR', company: co.sym, price: 1 })).toThrow();
  });
});

describe('mandatory trains and emergency money raising', () => {
  // AR in its trains step with 0 trains and a runnable 2-stop route (so it must buy).
  function toARTrainStep(): GameState {
    let s = toOperatingRound();
    s.tiles = { K8: { id: '5', rotation: 4 } }; // opens a route from AR's home token
    s = apply(s, { type: 'pass', player: 'p1' }); // skip track
    s = apply(s, { type: 'pass', player: 'p1' }); // skip token
    s = apply(s, { type: 'run', player: 'p1', corp: 'AR', revenue: 0, dividend: 'withhold' });
    return s;
  }

  it('a train-less corporation that can run must buy and cannot pass', () => {
    const s = toARTrainStep();
    expect(corp(s, 'AR').trains).toEqual([]);
    expect(operatingView(s)!.mustBuy).toBe(true);
    expect(() => apply(s, { type: 'pass', player: 'p1' })).toThrow();
  });

  it('buys the mandatory train when affordable', () => {
    let s = toARTrainStep();
    s = apply(s, { type: 'buy_train', player: 'p1', corp: 'AR', train: '2' });
    expect(corp(s, 'AR').trains).toEqual(['2']);
  });

  it('president contributes personal cash when the treasury falls short', () => {
    let s = toARTrainStep();
    corp(s, 'AR').cash = 50; // 2-train costs 80 -> shortfall 30
    const p1Before = cash(s, 'p1');
    const emg = operatingView(s)!.emergency!;
    expect(emg.shortfall).toBe(30);
    expect(emg.canAfford).toBe(true);
    s = apply(s, { type: 'buy_train', player: 'p1', corp: 'AR', train: '2' });
    expect(corp(s, 'AR').trains).toEqual(['2']);
    expect(corp(s, 'AR').cash).toBe(0);
    expect(cash(s, 'p1')).toBe(p1Before - 30);
  });

  it('president sells shares to raise emergency cash, then buys', () => {
    let s = toARTrainStep();
    corp(s, 'AR').cash = 50;
    s.players.find((p) => p.id === 'p1')!.cash = 10; // shortfall 30, has only 10
    const emg = operatingView(s)!.emergency!;
    expect(emg.canAfford).toBe(false);
    expect(emg.sellable.some((x) => x.corp === 'AR')).toBe(true);
    s = apply(s, { type: 'emr_sell', player: 'p1', corp: 'AR', count: 1 });
    expect(cash(s, 'p1')).toBeGreaterThanOrEqual(30);
    s = apply(s, { type: 'buy_train', player: 'p1', corp: 'AR', train: '2' });
    expect(corp(s, 'AR').trains).toEqual(['2']);
  });

  it('declares bankruptcy and ends the game when nothing can fund the train', () => {
    let s = toARTrainStep();
    corp(s, 'AR').cash = 0;
    const p1 = s.players.find((p) => p.id === 'p1')!;
    p1.cash = 0;
    p1.shares = { AR: 20 }; // only the president cert, no >=20% successor -> unsellable
    s.players.find((p) => p.id === 'p2')!.shares = {};
    s.players.find((p) => p.id === 'p3')!.shares = {};
    const emg = operatingView(s)!.emergency!;
    expect(emg.canDeclareBankruptcy).toBe(true);
    expect(() => apply(s, { type: 'buy_train', player: 'p1', corp: 'AR', train: '2' })).toThrow();
    s = apply(s, { type: 'declare_bankruptcy', player: 'p1' });
    expect(s.finished).toBe(true);
    expect(s.bankrupt).toBe('p1');
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
    expect(s.or!.step).toBe('token'); // one tile per OR -> optional token step
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

describe('track laying - no track into the sea', () => {
  it('every legal lay keeps all track edges bordering a hex', () => {
    const s = toOperatingRound(); // AR floated at K8, track step
    const lays = trackLays(s);
    expect(lays.length).toBeGreaterThan(0);
    for (const l of lays) {
      // No tile edge may point where there is no neighbouring hex (the sea).
      expect(neighbor(HEX_BY_COORD, l.hex, 0) === null && neighbor(HEX_BY_COORD, l.hex, 5) === null).toBeDefined();
    }
    // K8 specifically borders no hex on edges 0 and 5; ensure no lay there uses them.
    for (const l of lays.filter((x) => x.hex === 'K8')) {
      expect(neighbor(HEX_BY_COORD, 'K8', 0)).toBeNull();
    }
  });
});

describe('green upgrades and tokens', () => {
  it('only allows green city upgrades that preserve the city in phase 3', () => {
    let s = toOperatingRound();
    const lay = trackLays(s).find((l) => l.hex === 'K8' && l.tile === '5')!;
    s = apply(s, { type: 'lay_tile', player: 'p1', corp: 'AR', hex: 'K8', tile: '5', rotation: lay.rotation });
    s.phase = '3';
    if (s.or) s.or.step = 'track';
    const green = trackLays(s).filter((l) => l.hex === 'K8');
    expect(green.length).toBeGreaterThan(0);
    // all candidates are green city tiles (12/13/14/15/205/206), never towns/plain
    expect(green.every((l) => ['12', '13', '14', '15', '205', '206'].includes(l.tile))).toBe(true);
  });

  it('restricts labelled hexes to matching labelled tiles (T = Takamatsu K4)', () => {
    let s = toOperatingRound();
    // K4 is the labelled "T" city (home of KO). A green upgrade there may only be
    // a T tile (440), never a plain green city tile.
    s.phase = '3';
    if (s.or) s.or.step = 'track';
    // Put AR's token reach onto K4 by giving it K4 in its network via a token.
    corp(s, 'AR').tokenHexes = ['K4'];
    const ups = trackLays(s).filter((l) => l.hex === 'K4');
    expect(ups.every((l) => l.tile === '440')).toBe(true);
  });

  it('home token occupies the first slot and the corp has spare tokens', () => {
    const s = toOperatingRound();
    expect(corp(s, 'AR').tokenHexes).toEqual(['K8']);
    expect(corp(s, 'AR').tokens.length).toBeGreaterThanOrEqual(2);
  });
});

describe('end game on bank break', () => {
  it('triggers when the bank goes negative, finishes the OR set, and picks the highest-value winner', () => {
    let s = toOperatingRound();
    // Force the bank low so one dividend breaks it. Holdings pay 50% of the 40
    // route revenue to players (IPO 50% pays nobody), so payout is ~20 > bank.
    s.bank = 10;
    s.corporations.find((c) => c.sym === 'AR')!.trains = ['2'];
    s.tiles = { K8: { id: '5', rotation: 4 } }; // K8->L7 route = 40
    // run + pay -> bank goes negative -> end triggered
    s = apply(s, { type: 'run', player: 'p1', corp: 'AR', revenue: 0, dividend: 'pay' });
    expect(s.bank).toBeLessThan(0);
    expect(s.endTriggered).toBe(true);
    // finish AR's turn (only floated corp) -> set completes -> game ends
    s = apply(s, { type: 'pass', player: 'p1' }); // buy-trains step: finish operating
    expect(s.finished).toBe(true);
    expect(s.winner).not.toBeNull();
    // winner is the player with the highest value
    const values = s.players.map((p) => playerValue(s, p.id));
    const maxVal = Math.max(...values);
    expect(playerValue(s, s.winner!)).toBe(maxVal);
  });
});
