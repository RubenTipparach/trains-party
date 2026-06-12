import { describe, it, expect } from 'vitest';
import { configFor } from './registry';
import {
  configRola,
  MARKET,
  MINORS,
  MAJORS,
  TRAINS,
  PHASES,
  STARTING_CASH,
  BANK_CASH,
  PAR_BANDS,
  TILE_MANIFEST
} from '$lib/data/grola';

describe('RoLA static data (Stage 2)', () => {
  it('is registered under the "rola" title', () => {
    expect(configFor('rola')).toBe(configRola);
    expect(configRola.marketKind).toBe('linear');
  });

  it('has the board-validated linear stock ladder (27 spaces, CLOSED at 0)', () => {
    expect(MARKET).toHaveLength(1); // single row
    const prices = MARKET[0].map((c) => c.price);
    expect(prices).toEqual([
      0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 135, 150, 165, 180, 200, 220,
      245, 270, 300, 330, 360, 400, 450, 500
    ]);
    // par-eligible start-zone cells and their phase colours
    const byPrice = Object.fromEntries(MARKET[0].map((c) => [c.price, c]));
    expect(byPrice[60].zone).toBe('yellow');
    expect(byPrice[100].zone).toBe('green');
    expect(byPrice[135].zone).toBe('purple');
    expect(byPrice[150].zone).toBe('white');
    expect(byPrice[0].par).toBe(false);
    expect(MARKET[0].filter((c) => c.par).map((c) => c.price)).toEqual([
      60, 70, 80, 90, 100, 110, 120, 135
    ]);
    expect(PAR_BANDS).toEqual({ yellow: [60, 90], green: [60, 110], purple: [60, 135] });
  });

  it('has 12 minors: 5 shares (40% + 3x20%), 1 token (Expansive 2), correct home tiles', () => {
    expect(MINORS).toHaveLength(12);
    for (const m of MINORS) {
      expect(m.shares).toBe(5);
      expect(m.presidentPercent).toBe(40);
      expect(m.sharePercent).toBe(20);
    }
    const home = Object.fromEntries(MINORS.map((m) => [m.sym, m.homeTriHex]));
    expect(home).toEqual({
      AD: null, EM: 2, EA: 1, AG: 3, RE: 4, ER: 5, SU: 6, NP: 7, TU: 8, BR: 9, OV: 10, SP: 11
    });
    expect(MINORS.find((m) => m.sym === 'EA')!.tokens).toBe(2);
    expect(MINORS.find((m) => m.sym === 'AD')!.ability).toEqual({ type: 'choose_home' });
    expect(MINORS.find((m) => m.sym === 'SP')!.ability).toEqual({ type: 'extra_train_slot' });
    expect(MINORS.find((m) => m.sym === 'TU')!.ability).toEqual({
      type: 'mountain_treasury_gain',
      amount: 60
    });
    expect(MINORS.find((m) => m.sym === 'EM')!.ability).toBeUndefined();
  });

  it('has 6 majors: 10 shares (20% + 8x10%), 4 tokens', () => {
    expect(MAJORS.map((m) => m.sym)).toEqual(['Con', 'Exp', 'Fed', 'Int', 'Syn', 'Unl']);
    for (const m of MAJORS) {
      expect(m.shares).toBe(10);
      expect(m.presidentPercent).toBe(20);
      expect(m.sharePercent).toBe(10);
      expect(m.tokens).toBe(4);
    }
  });

  it('has the validated train roster, rust chain, and infinity trade-in', () => {
    const byName = Object.fromEntries(TRAINS.map((t) => [t.name, t]));
    expect(byName['2']).toMatchObject({ price: 100, num: 7, rustsOn: '4' });
    expect(byName['3']).toMatchObject({ price: 200, num: 5, rustsOn: '6' });
    expect(byName['4']).toMatchObject({ price: 300, num: 4, rustsOn: '7' });
    expect(byName['5']).toMatchObject({ price: 450, num: 3 });
    // 6-trains: 3 cards, one only shipping with 4+ players (matches the 3's extra)
    expect(byName['6']).toMatchObject({ price: 550, num: 3, extraForPlayers: 4 });
    expect(byName['3']).toMatchObject({ extraForPlayers: 4 });
    expect(byName['7']).toMatchObject({ price: 750, num: 7 });
    expect(byName['∞']).toMatchObject({ price: 1000, availableOn: '7' });
    expect(byName['∞'].discount).toEqual({ '4': 200, '5': 200, '6': 200 });
    // 5 and 6 rust nothing
    expect(TRAINS.filter((t) => t.rustsOn).map((t) => t.name)).toEqual(['2', '3', '4']);
  });

  it('has 6 phases with split minor/major train limits and the era tile ladder', () => {
    expect(PHASES.map((p) => p.name)).toEqual(['2', '3', '4', '5', '6', '7']);
    const p = Object.fromEntries(PHASES.map((x) => [x.name, x]));
    expect(p['2'].minorTrainLimit).toBe(2);
    expect(p['3'].trainLimit).toBe(4); // major
    expect(p['4'].trainLimit).toBe(3);
    expect(p['5'].trainLimit).toBe(2);
    expect(p['5'].minorTrainLimit).toBe(1);
    expect(p['3'].tiles).toEqual(['yellow', 'green']);
    expect(p['5'].tiles).toEqual(['yellow', 'green', 'brown']);
    expect(p['7'].tiles).toEqual(['yellow', 'green', 'brown', 'gray']);
    for (const ph of PHASES) expect(ph.operatingRounds).toBe(2);
  });

  it('has the validated cash and the 128-tile base manifest', () => {
    expect(STARTING_CASH).toEqual({ 2: 450, 3: 300, 4: 275, 5: 220 });
    expect(BANK_CASH).toBe(24500);
    expect(configRola.certLimit).toEqual({ 2: -1, 3: -1, 4: -1, 5: -1 });

    const total = TILE_MANIFEST.reduce((n, t) => n + t.count, 0);
    expect(total).toBe(128);
    const byColor = (c: string) =>
      TILE_MANIFEST.filter((t) => t.color === c).reduce((n, t) => n + t.count, 0);
    expect(byColor('yellow')).toBe(55);
    expect(byColor('green')).toBe(41);
    expect(byColor('brown')).toBe(24);
    expect(byColor('gray')).toBe(3);
    // blue bridges carry no manifest colour
    const blue = TILE_MANIFEST.filter((t) => ['721', '722', '723'].includes(t.id)).reduce(
      (n, t) => n + t.count,
      0
    );
    expect(blue).toBe(5);
  });
});
