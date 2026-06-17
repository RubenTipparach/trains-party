import { describe, it, expect } from 'vitest';
import { initialState, apply, activePlayer } from './index';
import { launchViaAuction } from './rolaTestUtil';
import { botAction } from '$lib/game/bots';
import type { GameState } from './types';
import type { HexDef } from '$lib/data/types';

/**
 * RoLA bankruptcy (rulebook): a president who cannot fund a forced train - even
 * after selling everything - is knocked out and play CONTINUES with the rest
 * (unlike 1889, where bankruptcy ends the game). Their company is removed.
 */
const seats = [
  { id: 'p1', name: 'A' },
  { id: 'p2', name: 'B' },
  { id: 'p3', name: 'C' }
];
const cityHex = (coord: string): HexDef => ({ coord, color: 'white', cities: [{ revenue: 20, slots: 1 }], towns: [], paths: [], icons: [] });
const plain = (coord: string): HexDef => ({ coord, color: 'white', cities: [], towns: [], paths: [], icons: [] });

/** Launch AG under p1, then strand it at the buy step: a runnable 2-city route,
 *  no train, no money, and only the unsellable president cert in hand. */
function bankruptScene(): GameState {
  let s = launchViaAuction(initialState(seats, 'rola'), 'p1', 'AG', 160);
  s = apply(s, { type: 'pass', player: 'p2' });
  s = apply(s, { type: 'pass', player: 'p3' });
  s = apply(s, { type: 'pass', player: 'p1' }); // -> operating round

  const map: Record<string, HexDef> = {};
  for (const c of ['D2', 'D4', 'D6', 'D8', 'C5', 'C7', 'E5', 'E7']) map[c] = plain(c);
  map['D4'] = cityHex('D4');
  map['D6'] = cityHex('D6');
  s.map = map;
  s.tiles['D4'] = { id: '6', rotation: 0 }; // city, track out edge 0 -> D6
  s.tiles['D6'] = { id: '6', rotation: 3 }; // city, track in edge 3 <- D4

  const ag = s.corporations.find((c) => c.sym === 'AG')!;
  ag.tokenHexes = ['D4'];
  ag.trains = [];
  ag.operated = true;
  ag.cash = 0;
  ag.poolShares = 50; // pool full -> the president has no room to sell to raise cash
  ag.ipoShares = 10;
  s.or = { order: ['AG'], index: 0, step: 'trains', orNumber: 1, orsThisSet: 1, yellowLaid: 0 } as GameState['or'];

  const p1 = s.players.find((p) => p.id === 'p1')!;
  p1.cash = 0;
  p1.shares = { AG: 40 }; // the 40% president cert; nothing it can legally sell
  return s;
}

describe('RoLA bankruptcy knocks the player out and continues', () => {
  it('removes the bankrupt player and their company; play goes on', () => {
    const s = bankruptScene();
    // The forced, unfundable purchase makes declare_bankruptcy the only legal out
    // (apply throws if it is not actually a pending emergency).
    const next = apply(s, { type: 'declare_bankruptcy', player: 'p1' });

    expect(next.finished).toBe(false); // game continues, unlike 1889
    expect(next.players.find((p) => p.id === 'p1')!.out).toBe(true); // p1 eliminated
    expect(next.corporations.find((c) => c.sym === 'AG')!.dissolved).toBe(true); // AG removed
    expect(next.players.filter((p) => !p.out).length).toBe(2); // two players remain
    expect(next.winner).toBeNull(); // not decided yet
  });

  it('the eliminated player never acts again as the game plays on', () => {
    let s = bankruptScene();
    s = apply(s, { type: 'declare_bankruptcy', player: 'p1' });
    // Drive the rest of the game with bots; p1 must never become the active player.
    let steps = 0;
    while (!s.finished && steps < 400) {
      expect(activePlayer(s)).not.toBe('p1');
      const a = botAction(s, 'testing');
      if (!a) break;
      s = apply(s, a);
      steps += 1;
    }
    expect(s.players.find((p) => p.id === 'p1')!.out).toBe(true);
    expect(s.finished).toBe(true); // the remaining players finish the game
  });
});
