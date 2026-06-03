/**
 * Tests for the 1889 rule fixes and private-company special abilities:
 * offboard revenue tiers, the diesel trade-in, train limits, UTF (never closes /
 * revenue rise), hex blocking, the SMR mountain discount, the DR exchange, the
 * MF / ER special tile lays, and the market-stack operating order.
 */
import { describe, it, expect } from 'vitest';
import { initialState } from './setup';
import { apply, routeRevenue, legalLays, blockedHexes, neighbor, type GameState, type GameAction } from './index';
import { HEX_BY_COORD } from '$lib/data/map1889';

const seats3 = [
  { id: 'p1', name: 'Ann' },
  { id: 'p2', name: 'Bo' },
  { id: 'p3', name: 'Cy' }
];
const seats4 = [...seats3, { id: 'p4', name: 'Di' }];

const corp = (s: GameState, sym: string) => s.corporations.find((c) => c.sym === sym)!;
const company = (s: GameState, sym: string) => s.companies.find((c) => c.sym === sym)!;

/** A minimal operating-round state with AR floated, tokened at K8, p1 president. */
function operatingState(seats = seats3): GameState {
  const s = initialState(seats);
  s.round = 'operating';
  s.auction = null;
  const ar = corp(s, 'AR');
  ar.floated = true;
  ar.parPrice = 100;
  ar.priceRow = 0;
  ar.priceCol = 3;
  ar.president = 'p1';
  ar.cash = 2000;
  ar.ipoShares = 50;
  ar.tokenHexes = ['K8'];
  s.players[0].shares = { AR: 50 };
  s.or = { order: ['AR'], index: 0, step: 'track', orNumber: 1, orsThisSet: 1 };
  return s;
}

/** Smallest rotation of a tile (given its centre-edge list) with no edge in the sea. */
function landRotation(hex: string, edges: number[]): number {
  for (let r = 0; r < 6; r++) {
    if (edges.every((e) => neighbor(HEX_BY_COORD, hex, (e + r) % 6) !== null)) return r;
  }
  return -1;
}

describe('offboard revenue tiers', () => {
  // AR at K8 (city, tile 5 = 20) running to the L7 offboard (yellow 20 / brown 40 / diesel 80).
  function withRoute(phase: string, trains: string[]): GameState {
    const s = operatingState();
    const ar = corp(s, 'AR');
    ar.trains = trains;
    s.tiles = { K8: { id: '5', rotation: 4 } };
    s.phase = phase;
    return s;
  }

  it('uses the yellow tier in phases 2-4 (green has no offboard key)', () => {
    expect(routeRevenue(withRoute('2', ['2']), corp(withRoute('2', ['2']), 'AR'))).toBe(40); // 20 + 20
    const s4 = withRoute('4', ['4']);
    expect(routeRevenue(s4, corp(s4, 'AR'))).toBe(40); // still yellow (20 + 20), NOT brown
  });

  it('uses the brown tier in phases 5-6 for non-diesel trains', () => {
    const s5 = withRoute('5', ['5']);
    expect(routeRevenue(s5, corp(s5, 'AR'))).toBe(60); // 20 + 40 (brown)
    const s6 = withRoute('6', ['6']);
    expect(routeRevenue(s6, corp(s6, 'AR'))).toBe(60); // 20 + 40 (brown), NOT diesel
  });

  it('uses the diesel tier only for a D-train', () => {
    const s = withRoute('D', ['D']);
    expect(routeRevenue(s, corp(s, 'AR'))).toBe(100); // 20 + 80 (diesel)
  });
});

describe('train limit', () => {
  it('caps a corporation at the phase train limit', () => {
    let s = operatingState();
    s.or!.step = 'trains';
    // phase 2 limit is 4
    for (let i = 0; i < 4; i++) s = apply(s, { type: 'buy_train', player: 'p1', corp: 'AR', train: '2' });
    expect(corp(s, 'AR').trains).toEqual(['2', '2', '2', '2']);
    expect(() => apply(s, { type: 'buy_train', player: 'p1', corp: 'AR', train: '2' })).toThrow();
  });
});

describe('diesel trade-in', () => {
  it('trades an older train toward a diesel for the discount', () => {
    const s = operatingState();
    s.phase = '6';
    s.or!.step = 'trains';
    const ar = corp(s, 'AR');
    ar.trains = ['6'];
    ar.cash = 900;
    for (const d of s.depot) if (d.name !== 'D') d.remaining = 0; // diesel is the buyable train
    const after = apply(s, { type: 'buy_train', player: 'p1', corp: 'AR', train: 'D', tradeIn: '6' });
    expect(corp(after, 'AR').trains).toEqual(['D']); // 6 traded out, D in
    expect(corp(after, 'AR').cash).toBe(900 - 800); // 1100 - 300 discount
  });

  it('rejects trading in a train the corporation does not own', () => {
    const s = operatingState();
    s.phase = '6';
    s.or!.step = 'trains';
    const ar = corp(s, 'AR');
    ar.trains = ['6'];
    ar.cash = 2000;
    for (const d of s.depot) if (d.name !== 'D') d.remaining = 0;
    expect(() => apply(s, { type: 'buy_train', player: 'p1', corp: 'AR', train: 'D', tradeIn: '5' })).toThrow();
  });
});

describe('Uno-Takamatsu Ferry (UTF)', () => {
  // Buy a 5-train (with cheaper trains exhausted) so the 5-train close fires.
  function buyFiveTrain(): GameState {
    const s = operatingState(seats4);
    s.or!.step = 'trains';
    corp(s, 'AR').cash = 500;
    for (const d of s.depot) if (['2', '3', '4'].includes(d.name)) d.remaining = 0;
    company(s, 'UTF').owner = 'p1';
    s.players.find((p) => p.id === 'p1')!.companies = ['UTF'];
    company(s, 'SMR').owner = 'p2';
    s.players.find((p) => p.id === 'p2')!.companies = ['SMR'];
    return apply(s, { type: 'buy_train', player: 'p1', corp: 'AR', train: '5' });
  }

  it('survives the 5-train close and its revenue rises to 50', () => {
    const s = buyFiveTrain();
    expect(s.phase).toBe('5');
    const utf = company(s, 'UTF');
    expect(utf.closed).toBe(false);
    expect(utf.owner).toBe('p1');
    expect(utf.revenue).toBe(50);
    // a normal private still closes
    expect(company(s, 'SMR').closed).toBe(true);
  });

  it('cannot be sold to a corporation once the 5-train phase is reached', () => {
    const s = buyFiveTrain(); // phase 5, UTF still owned by p1 (AR's president)
    s.or!.step = 'trains';
    expect(() => apply(s, { type: 'buy_company', player: 'p1', corp: 'AR', company: 'UTF', price: 150 })).toThrow();
  });
});

describe('hex blocking (Takamatsu E-Railroad / Ehime Railway)', () => {
  it('blocks tile lays on K4 while a player owns the blocking private', () => {
    const s = operatingState();
    s.phase = '3';
    corp(s, 'AR').tokenHexes = ['K4']; // reach K4 directly
    company(s, 'TR').owner = 'p1'; // TR blocks K4
    expect(blockedHexes(s).has('K4')).toBe(true);
    expect(legalLays(s, corp(s, 'AR')).some((l) => l.hex === 'K4')).toBe(false);
    // once the private is no longer player-owned, the block lifts
    company(s, 'TR').owner = null;
    company(s, 'TR').closed = true;
    expect(legalLays(s, corp(s, 'AR')).some((l) => l.hex === 'K4')).toBe(true);
  });
});

describe('Sumitomo Mines Railway (mountain discount)', () => {
  it('waives the mountain build cost for the owning corporation', () => {
    const s = operatingState();
    corp(s, 'AR').tokenHexes = ['H9']; // H9 is a mountain hex (build cost 80)
    const lay = (st: GameState) => legalLays(st, corp(st, 'AR')).find((l) => l.hex === 'H9');
    expect(lay(s)!.cost).toBe(80); // no discount yet
    // give AR the SMR private (owned by the corporation)
    corp(s, 'AR').companies = ['SMR'];
    company(s, 'SMR').owner = null;
    expect(lay(s)!.cost).toBe(0); // 80 - 80 discount
  });
});

describe('Dougo Railway (exchange for IR share)', () => {
  it('exchanges the private for a 10% IR share from the IPO', () => {
    const s = operatingState();
    company(s, 'DR').owner = 'p1';
    s.players[0].companies = ['DR'];
    const after = apply(s, { type: 'exchange', player: 'p1', company: 'DR' });
    expect(company(after, 'DR').closed).toBe(true);
    expect(after.players[0].shares['IR']).toBe(10);
    expect(corp(after, 'IR').ipoShares).toBe(90);
    expect(after.players[0].companies).not.toContain('DR');
  });

  it('rejects an exchange by a non-owner', () => {
    const s = operatingState();
    company(s, 'DR').owner = 'p2';
    expect(() => apply(s, { type: 'exchange', player: 'p1', company: 'DR' })).toThrow();
  });
});

describe('Mitsubishi Ferry (port tile lay)', () => {
  it('lays the port tile 437 on a coastal town, once', () => {
    const s = operatingState();
    company(s, 'MF').owner = 'p1';
    s.players[0].companies = ['MF'];
    const r = landRotation('B11', [0, 2]); // tile 437 has centre-edges 0 and 2
    expect(r).toBeGreaterThanOrEqual(0);
    const after = apply(s, { type: 'special_lay', player: 'p1', company: 'MF', hex: 'B11', tile: '437', rotation: r });
    expect(after.tiles['B11']).toEqual({ id: '437', rotation: r });
    expect(company(after, 'MF').usedAbility).toBe(true);
    expect(company(after, 'MF').closed).toBe(false); // does not close
    // the one-shot ability cannot be used again
    expect(() => apply(after, { type: 'special_lay', player: 'p1', company: 'MF', hex: 'G10', tile: '437', rotation: 0 })).toThrow();
  });
});

describe('Ehime Railway (green tile on Ohzu when sold)', () => {
  it('grants the buying corporation a green lay on C4', () => {
    let s = operatingState();
    s.phase = '3';
    s.or!.step = 'trains';
    company(s, 'ER').owner = 'p1';
    s.players[0].companies = ['ER'];
    s = apply(s, { type: 'buy_company', player: 'p1', corp: 'AR', company: 'ER', price: 40 });
    expect(corp(s, 'AR').companies).toContain('ER');
    expect(company(s, 'ER').pendingLay).toBe(true);
    expect(blockedHexes(s).has('C4')).toBe(false); // block lifts once corp-owned

    // place a green tile on C4 (preserving the preprinted edge-2 connection)
    let placed = false;
    for (let r = 0; r < 6 && !placed; r++) {
      try {
        const next = apply(s, { type: 'special_lay', player: 'p1', company: 'ER', hex: 'C4', tile: '12', rotation: r });
        if (next.tiles['C4']?.id === '12') {
          s = next;
          placed = true;
        }
      } catch {
        /* try the next rotation */
      }
    }
    expect(placed).toBe(true);
    expect(company(s, 'ER').pendingLay).toBe(false);
  });
});

describe('operating order (market stack)', () => {
  // Two corporations sharing a price cell: the one that reached it first operates first.
  function orderWith(arSeq: number, irSeq: number): string[] {
    let s = initialState(seats3);
    s.round = 'stock';
    s.auction = null;
    s.stock = { acted: false, bought: false, passes: 0, soldThisRound: {} };
    for (const sym of ['AR', 'IR']) {
      const c = corp(s, sym);
      c.floated = true;
      c.parPrice = 100;
      c.priceRow = 0; // row 0 so the sold-out move-up is a no-op (preserves stackSeq)
      c.priceCol = 3;
      c.president = 'p1';
    }
    corp(s, 'AR').stackSeq = arSeq;
    corp(s, 'IR').stackSeq = irSeq;
    // a full lap of passes ends the stock round and starts the OR
    s = apply(s, { type: 'pass', player: 'p1' });
    s = apply(s, { type: 'pass', player: 'p2' });
    s = apply(s, { type: 'pass', player: 'p3' });
    return s.or!.order;
  }

  it('orders the earlier arrival (lower stackSeq) first at equal price', () => {
    expect(orderWith(1, 2)).toEqual(['AR', 'IR']);
    expect(orderWith(5, 2)).toEqual(['IR', 'AR']);
  });
});
