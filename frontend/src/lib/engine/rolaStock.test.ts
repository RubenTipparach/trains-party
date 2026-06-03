import { describe, it, expect } from 'vitest';
import { initialState } from './setup';
import { currentPrice } from './stock';
import {
  launchMinor,
  launchablePars,
  parForBid,
  issueShare,
  redeemShare,
  applyDividend,
  sellPriceMove,
  soldOutMove,
  moveLadder,
  isClosed,
  dissolve
} from './rolaStock';
import type { CorporationState, GameState } from './types';

const seats = [
  { id: 'p1', name: 'A' },
  { id: 'p2', name: 'B' },
  { id: 'p3', name: 'C' }
];
const rola = (): GameState => initialState(seats, 'rola');
const minor = (s: GameState, sym: string): CorporationState => s.corporations.find((c) => c.sym === sym)!;

describe('RoLA stock model (Stage 3)', () => {
  it('builds a RoLA initial state: stock round, 12 minors + 6 majors', () => {
    const s = rola();
    expect(s.round).toBe('stock');
    expect(s.corporations.filter((c) => c.kind === 'minor')).toHaveLength(12);
    expect(s.corporations.filter((c) => c.kind === 'major')).toHaveLength(6);
    const ag = minor(s, 'AG');
    expect(ag).toMatchObject({ kind: 'minor', shareUnit: 20, ipoShares: 100, parPrice: null });
    expect(s.players[0].cash).toBe(300); // 3-player starting cash
  });

  it('launches a minor with incremental capitalization (treasury = bid, 40% president cert)', () => {
    const s = rola();
    const ag = minor(s, 'AG');
    launchMinor(s, ag, 'p1', 160);
    expect(ag).toMatchObject({ parPrice: 80, priceRow: 0, priceCol: 8, president: 'p1', floated: true });
    expect(currentPrice(s, ag)).toBe(80);
    expect(ag.cash).toBe(160); // treasury = the full winning bid
    expect(ag.ipoShares).toBe(60); // 100 - 40% president cert
    expect(s.players[0].shares['AG']).toBe(40);
    expect(s.players[0].cash).toBe(140); // 300 - 160 bid (to treasury, not the bank)
  });

  it('derives the price from the bid (half, rounded down within band) and enforces min bid 120', () => {
    const s = rola(); // phase 2 -> yellow band 60-90
    expect(launchablePars(s)).toEqual([60, 70, 80, 90]);
    expect(parForBid(s, 120)).toBe(60); // minimum bid -> price 60
    expect(parForBid(s, 160)).toBe(80);
    expect(parForBid(s, 165)).toBe(80); // 82 rounded down to the printed 80
    expect(parForBid(s, 400)).toBe(90); // capped at the yellow band high
    expect(() => launchMinor(s, minor(s, 'AG'), 'p1', 100)).toThrow(/at least 120/);
    expect(() => launchMinor(s, minor(s, 'AG'), 'p1', 121)).toThrow(/increments of 5/);
  });

  it('issues shares: treasury gains the price, price drops, pool caps at 50%', () => {
    const s = rola();
    const ag = minor(s, 'AG');
    launchMinor(s, ag, 'p1', 160);
    issueShare(s, ag); // sells a 20% share to the pool at 80
    expect(ag.poolShares).toBe(20);
    expect(ag.ipoShares).toBe(40);
    expect(ag.cash).toBe(240); // 160 + 80
    expect(currentPrice(s, ag)).toBe(70); // dropped one space
    issueShare(s, ag); // pool 40, price 60
    expect(ag.poolShares).toBe(40);
    expect(() => issueShare(s, ag)).toThrow(/pool cannot exceed 50%/);
  });

  it('redeems a pooled share for the current price with no price move', () => {
    const s = rola();
    const ag = minor(s, 'AG');
    launchMinor(s, ag, 'p1', 160);
    issueShare(s, ag); // pool 20, treasury 240, price 70
    redeemShare(s, ag);
    expect(ag.poolShares).toBe(0);
    expect(ag.ipoShares).toBe(60);
    expect(ag.cash).toBe(170); // 240 - 70
    expect(currentPrice(s, ag)).toBe(70); // unchanged
  });

  it('moves the price by the dividend bands', () => {
    const s = rola();
    const ag = minor(s, 'AG');
    launchMinor(s, ag, 'p1', 160); // priceCol 8 (=80)

    applyDividend(s, ag, 'withhold', 0);
    expect(ag.priceCol).toBe(7); // down one

    ag.priceCol = 8;
    const seqBefore = ag.stackSeq;
    applyDividend(s, ag, 'pay', 50); // 0 < 50 < 80: stay, re-stamp to bottom
    expect(ag.priceCol).toBe(8);
    expect(ag.stackSeq).toBeGreaterThan(seqBefore);

    ag.priceCol = 8;
    applyDividend(s, ag, 'pay', 80); // price <= payout < 2x: up one
    expect(ag.priceCol).toBe(9);

    ag.priceCol = 8;
    applyDividend(s, ag, 'pay', 160); // payout >= 2x price: up two
    expect(ag.priceCol).toBe(10);
  });

  it('sell drops one space, sold-out rises one, and the ladder clamps at the ends', () => {
    const s = rola();
    const ag = minor(s, 'AG');
    launchMinor(s, ag, 'p1', 160); // col 8
    sellPriceMove(s, ag);
    expect(ag.priceCol).toBe(7);

    ag.ipoShares = 0;
    ag.poolShares = 0;
    soldOutMove(s, ag); // fully held -> +1
    expect(ag.priceCol).toBe(8);

    ag.priceCol = 0;
    expect(moveLadder(s, ag, -1)).toBe(0); // clamped at CLOSED
    const last = 26; // 27 ladder spaces (0..500)
    ag.priceCol = last;
    expect(moveLadder(s, ag, 1)).toBe(last); // clamped at 500
  });

  it('dissolves at the CLOSED space: treasury to bank, trains to depot, shares cleared', () => {
    const s = rola();
    const ag = minor(s, 'AG');
    launchMinor(s, ag, 'p1', 160);
    ag.cash = 90;
    ag.trains = ['2'];
    const depot2 = s.depot.find((d) => d.name === '2')!;
    const before = depot2.remaining;
    const bankBefore = s.bank;

    ag.priceCol = 1;
    moveLadder(s, ag, -1);
    expect(isClosed(s, ag)).toBe(true);

    dissolve(s, ag);
    expect(ag.dissolved).toBe(true);
    expect(s.bank).toBe(bankBefore + 90);
    expect(depot2.remaining).toBe(before + 1);
    expect(s.players[0].shares['AG']).toBeUndefined();
    expect(ag.president).toBeNull();
  });
});
