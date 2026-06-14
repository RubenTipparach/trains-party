import { describe, it, expect } from 'vitest';
import { apply, initialState, rolaStockLegalActions } from './index';
import { launchViaAuction } from './rolaTestUtil';
import type { GameState } from './types';

const seats = [
  { id: 'p1', name: 'A' },
  { id: 'p2', name: 'B' },
  { id: 'p3', name: 'C' }
];
const rola = () => initialState(seats, 'rola');
const ag = (s: GameState) => s.corporations.find((c) => c.sym === 'AG')!;

describe('RoLA stock round (Stage 4c)', () => {
  it('launches a minor by winning an unopposed auction', () => {
    const s = launchViaAuction(rola(), 'p1', 'AG', 160);
    expect(ag(s).floated).toBe(true);
    expect(ag(s).president).toBe('p1');
    expect(s.players[0].shares['AG']).toBe(40);
    expect(ag(s).cash).toBe(160); // treasury = the full winning bid
    expect(s.players[0].cash).toBe(140); // 300 - 160 bid (to treasury)
    expect(s.current).toBe(1); // turn passes clockwise from the initiator
  });

  it('rejects an opening bid below the minimum (120)', () => {
    const s = rola();
    expect(() => apply(s, { type: 'initiate_auction', player: 'p1', bid: 100 })).toThrow();
  });

  it('runs a contested auction: high bidder wins and pays their bid', () => {
    let s = rola();
    s = apply(s, { type: 'initiate_auction', player: 'p1', bid: 120 });
    s = apply(s, { type: 'launch_bid', player: 'p2', bid: 130 });
    s = apply(s, { type: 'pass', player: 'p3' }); // out
    s = apply(s, { type: 'pass', player: 'p1' }); // out -> p2 wins at 130
    s = apply(s, { type: 'launch', player: 'p2', corp: 'AG' });
    expect(ag(s).president).toBe('p2');
    expect(ag(s).cash).toBe(130);
    expect(s.players[1].cash).toBe(170); // 300 - 130
    expect(s.current).toBe(1); // clockwise from the initiator p1
  });

  it('auto-drops a player who cannot afford the next bid', () => {
    let s = rola();
    s.players[1].cash = 100; // p2 cannot afford 125 (120 + 5)
    s = apply(s, { type: 'initiate_auction', player: 'p1', bid: 120 });
    const la = s.stock!.launchAuction!;
    expect(la.passed).toContain('p2'); // dropped automatically, never asked to bid
    expect(la.turn).toBe('p3'); // p3 can afford, so it is their turn
  });

  it('the initiator wins outright when no one else can afford to bid', () => {
    let s = rola();
    s.players[1].cash = 50;
    s.players[2].cash = 50;
    s = apply(s, { type: 'initiate_auction', player: 'p1', bid: 200 });
    expect(s.stock!.launchAuction!.winner).toBe('p1');
    expect(s.stock!.launchAuction!.turn).toBeNull();
    s = apply(s, { type: 'launch', player: 'p1', corp: 'AG' });
    expect(ag(s).president).toBe('p1');
    expect(ag(s).cash).toBe(200);
  });

  it('lets another player buy a 20% IPO share at par', () => {
    let s = launchViaAuction(rola(), 'p1', 'AG', 160);
    s = apply(s, { type: 'buy', player: 'p2', corp: 'AG', from: 'ipo' });
    expect(s.players[1].shares['AG']).toBe(20);
    expect(ag(s).ipoShares).toBe(40); // 100 - 40 (pres) - 20 (sold)
    expect(s.players[1].cash).toBe(220); // 300 - 80 par
  });

  it('drops the price one space per sale (not per share)', () => {
    let s = launchViaAuction(rola(), 'p1', 'AG', 160); // col 8; p2's turn now
    s.players[1].shares['AG'] = 40;
    ag(s).ipoShares = 20; // 100 - 40 pres - 40 p2
    ag(s).operated = true; // companies cannot be sold before their first OR
    const before = ag(s).priceCol!;
    s = apply(s, { type: 'sell', player: 'p2', corp: 'AG', count: 2 });
    expect(ag(s).priceCol).toBe(before - 1); // one space, despite selling two shares
    expect(ag(s).poolShares).toBe(40);
    expect(s.players[1].shares['AG']).toBe(0);
    expect(s.players[1].cash).toBe(300 + 2 * 80); // proceeds at the pre-move price (80)
  });

  it('cannot sell shares of a company that has not operated yet', () => {
    const s = launchViaAuction(rola(), 'p1', 'AG', 160);
    s.players[1].shares['AG'] = 40;
    ag(s).ipoShares = 20;
    expect(() => apply(s, { type: 'sell', player: 'p2', corp: 'AG', count: 1 })).toThrow(/cannot sell/);
  });

  it('ends the round on a full lap of passes and starts the OR with launched minors', () => {
    let s = launchViaAuction(rola(), 'p1', 'AG', 160); // p2's turn now
    s = apply(s, { type: 'pass', player: 'p2' }); // pure pass 1
    s = apply(s, { type: 'pass', player: 'p3' }); // pure pass 2
    s = apply(s, { type: 'pass', player: 'p1' }); // pure pass 3 -> end SR
    expect(s.round).toBe('operating');
    expect(s.or!.order).toContain('AG');
    expect(ag(s).tokenHexes).toContain('C2'); // home token placed when it first operates
  });

  it('surfaces auction / buy / sell options and respects the 60% hold cap', () => {
    let s = rola();
    let legal = rolaStockLegalActions(s);
    expect(legal.canInitiate).toBe(true);
    expect(legal.minBid).toBe(120);
    expect(legal.available).toContain('AG');

    s = launchViaAuction(s, 'p1', 'AG', 160); // p2's turn now
    // p2 at 60% should not be offered another AG buy
    s.players[1].shares['AG'] = 60;
    legal = rolaStockLegalActions(s);
    expect(legal.player).toBe('p2');
    expect(legal.buyIpo).not.toContain('AG');
  });

  it('transfers the presidency when a buyer out-holds the president', () => {
    let s = launchViaAuction(rola(), 'p1', 'AG', 160); // p1 pres 40%; p2's turn
    // set p2 to 40% then buy one more 20% -> 60% > 40%, takes presidency
    s.players[1].shares['AG'] = 40;
    ag(s).ipoShares = 20;
    s = apply(s, { type: 'buy', player: 'p2', corp: 'AG', from: 'ipo' });
    expect(s.players[1].shares['AG']).toBe(60);
    expect(ag(s).president).toBe('p2');
  });
});

describe('RoLA minor matrix (2 columns, bottom-row launchable)', () => {
  const seeded = () => initialState(seats, 'rola', undefined, { seed: 31337 });

  it('lays the minors into 2 columns and only offers the bottom of each', () => {
    const s = seeded();
    expect(s.minorMatrix).toHaveLength(2);
    expect(s.minorMatrix!.flat().length).toBe(s.corporations.filter((c) => c.kind === 'minor').length);
    const offered = rolaStockLegalActions(s).available.slice().sort();
    const bottoms = s.minorMatrix!.map((col) => col[0]).sort();
    expect(offered).toEqual(bottoms); // exactly the two column bottoms
  });

  it('reveals the next company up a column once its bottom launches', () => {
    let s = seeded();
    const col0 = s.minorMatrix![0];
    const bottom = col0[0];
    const next = col0[1];
    expect(rolaStockLegalActions(s).available).not.toContain(next); // hidden behind bottom
    s = launchViaAuction(s, 'p1', bottom, 120);
    expect(rolaStockLegalActions(s).available).toContain(next); // now revealed
  });

  it('rejects launching a company that is not at the bottom of its column', () => {
    let s = seeded();
    const buried = s.minorMatrix![0][2]; // third up the first column
    s = apply(s, { type: 'initiate_auction', player: 'p1', bid: 120 });
    s = apply(s, { type: 'pass', player: 'p2' });
    s = apply(s, { type: 'pass', player: 'p3' }); // p1 wins
    expect(() => apply(s, { type: 'launch', player: 'p1', corp: buried })).toThrow();
  });
});

describe('RoLA merger round', () => {
  /** Launch AG + EA under p1, run both through the OR set at phase 3. */
  function toMerger(): GameState {
    let s = initialState(seats, 'rola');
    s = launchViaAuction(s, 'p1', 'AG', 120); // p1 wins, turn -> p2
    s = apply(s, { type: 'pass', player: 'p2' });
    s = apply(s, { type: 'pass', player: 'p3' }); // back to p1
    s = launchViaAuction(s, 'p1', 'EA', 120); // p1 wins, turn -> p2
    s = apply(s, { type: 'pass', player: 'p2' });
    s = apply(s, { type: 'pass', player: 'p3' });
    s = apply(s, { type: 'pass', player: 'p1' }); // full pass lap -> OR
    s.phase = '3'; // first green bought (mergers unlock)
    // run both companies through both ORs (leadoff only on the first)
    for (let or = 0; or < 2; or++) {
      for (let i = 0; i < 2; i++) {
        const sym = s.or!.order[s.or!.index];
        if (s.or!.step === 'leadoff') s = apply(s, { type: 'pass', player: 'p1' });
        s = apply(s, { type: 'pass', player: 'p1' }); // track
        s = apply(s, { type: 'pass', player: 'p1' }); // token
        s = apply(s, { type: 'run', player: 'p1', corp: sym, revenue: 0, dividend: 'withhold' });
        if (s.round !== 'operating') return s;
        s = apply(s, { type: 'pass', player: 'p1' }); // finish turn
        if (s.round !== 'operating') return s;
      }
    }
    return s;
  }

  it('runs a merger round after the ORs once green has begun, and merges 1:1', () => {
    let s = toMerger();
    expect(s.round).toBe('merger');
    // make EA reachable from the proposer's network for the test
    const proposer = s.merger!.queue[s.merger!.index];
    const other = proposer === 'AG' ? 'EA' : 'AG';
    const a = s.corporations.find((c) => c.sym === proposer)!;
    const b = s.corporations.find((c) => c.sym === other)!;
    b.tokenHexes = [a.tokenHexes[0]];
    const cashA = a.cash;
    const cashB = b.cash;
    s = apply(s, { type: 'propose_merge', player: 'p1', from: proposer, to: other, major: 'Con' });
    const con = s.corporations.find((c) => c.sym === 'Con')!;
    expect(con.floated).toBe(true);
    expect(con.president).toBe('p1');
    // p1 held 40% + 40% (4 minor certs) -> 4 major certs = 40%
    expect(s.players[0].shares['Con']).toBe(40);
    expect(con.cash).toBe(cashA + cashB);
    expect(con.tokenHexes.length).toBe(1); // duplicate hub deduped
    expect(con.mergedFrom?.sort()).toEqual(['AG', 'EA']);
    expect(s.corporations.find((c) => c.sym === proposer)!.dissolved).toBe(true);
    // both minors merged -> queue empty -> the cycle resumes (export + SR)
    expect(s.round).toBe('stock');
    expect(s.cycle).toBe(2);
  });

  /** A connected, cross-president proposal under the hostile-mergers variant. */
  function toHostile(): { s: GameState; from: string; to: string } {
    const s = toMerger();
    s.hostileMergers = true;
    const from = s.merger!.queue[s.merger!.index];
    const to = from === 'AG' ? 'EA' : 'AG';
    const a = s.corporations.find((c) => c.sym === from)!;
    const b = s.corporations.find((c) => c.sym === to)!;
    b.tokenHexes = [a.tokenHexes[0]]; // connected so the merge is legal
    b.president = 'p2'; // different president -> proposal is hostile
    return { s, from, to };
  }

  it('hostile mergers: a player-share majority forces a refused merger through', () => {
    let { s, from, to } = toHostile();
    const a = s.corporations.find((c) => c.sym === from)!;
    const b = s.corporations.find((c) => c.sym === to)!;
    // p1 (proposer) holds 40% from + 20% to = 60 'for'; p2 holds 40% to = 40 'against'.
    s.players[0].shares = { [from]: 40, [to]: 20 };
    s.players[1].shares = { [to]: 40 };
    a.ipoShares = 60;
    a.poolShares = 0;
    b.ipoShares = 40;
    b.poolShares = 0;

    s = apply(s, { type: 'propose_merge', player: 'p1', from, to, major: 'Con' });
    expect(s.merger?.vote).toBeTruthy(); // a vote opens instead of an immediate merge
    s = apply(s, { type: 'cast_merge_vote', player: 'p2', vote: 'against' });

    const con = s.corporations.find((c) => c.sym === 'Con')!;
    expect(con.floated).toBe(true); // 60 for > 40 against -> merged over p2's objection
    expect(con.mergedFrom?.sort()).toEqual(['AG', 'EA']);
  });

  it('hostile mergers: the share vote can reject a proposal', () => {
    let { s, from, to } = toHostile();
    const a = s.corporations.find((c) => c.sym === from)!;
    const b = s.corporations.find((c) => c.sym === to)!;
    s.players[0].shares = { [from]: 40 }; // 40 'for'
    s.players[1].shares = { [to]: 60 }; // 60 'against'
    a.ipoShares = 60;
    a.poolShares = 0;
    b.ipoShares = 40;
    b.poolShares = 0;

    s = apply(s, { type: 'propose_merge', player: 'p1', from, to, major: 'Con' });
    s = apply(s, { type: 'cast_merge_vote', player: 'p2', vote: 'against' });

    expect(s.round).toBe('merger'); // still in the round, no merge
    expect(s.corporations.find((c) => c.sym === 'Con')!.floated).toBe(false);
    expect(s.merger!.vote).toBeNull();
    expect(s.merger!.declined).toContain([from, to].sort().join('|'));
  });

  it('hostile mergers: pooled shares vote with their value change, treasury abstains', () => {
    let { s, from, to } = toHostile();
    const a = s.corporations.find((c) => c.sym === from)!;
    const b = s.corporations.find((c) => c.sym === to)!;
    // player votes tie 40-40
    s.players[0].shares = { [from]: 40 };
    s.players[1].shares = { [to]: 40 };
    // prices: from 60, to 80 -> merged averages to 70; from's pool (60) gains -> 'for'.
    a.priceCol = 6;
    b.priceCol = 8;
    a.poolShares = 20; // 20% pool votes 'for' (value rises 60 -> 70)
    a.ipoShares = 40; // 40% treasury abstains
    b.poolShares = 0;
    b.ipoShares = 60;

    s = apply(s, { type: 'propose_merge', player: 'p1', from, to, major: 'Con' });
    s = apply(s, { type: 'cast_merge_vote', player: 'p2', vote: 'against' });

    // for = 40 (p1) + 20 (from pool) = 60; against = 40 (p2). The pool breaks the tie.
    expect(s.corporations.find((c) => c.sym === 'Con')!.floated).toBe(true);
  });

  it('prices the major at the rounded-down average on the ladder', () => {
    let s = toMerger();
    const proposer = s.merger!.queue[s.merger!.index];
    const other = proposer === 'AG' ? 'EA' : 'AG';
    const a = s.corporations.find((c) => c.sym === proposer)!;
    const b = s.corporations.find((c) => c.sym === other)!;
    b.tokenHexes = [a.tokenHexes[0]];
    // both launched at 80 and withheld 4 times -> both dropped; set explicit prices
    a.priceCol = 8; // 80
    b.priceCol = 6; // 60
    s = apply(s, { type: 'propose_merge', player: 'p1', from: proposer, to: other, major: 'Fed' });
    const fed = s.corporations.find((c) => c.sym === 'Fed')!;
    expect(fed.parPrice).toBe(70); // avg(80,60) = 70 on the ladder
  });
});
