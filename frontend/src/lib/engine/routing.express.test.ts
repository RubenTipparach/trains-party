import { describe, it, expect } from 'vitest';
import { initialState } from './setup';
import { replay } from './index';
import { routeThroughStops, trainReach, corpRoutes } from './routes';
import type { GameAction } from './types';

/**
 * Regression: the RoLA Express minor (ER) carries `boost_stop_if_single_train`,
 * so its lone 2-train may visit 3 stops. The manual route UI must resolve routes
 * against this boosted reach (engine `trainReach`), not the raw train distance,
 * or a legal boosted run is wrongly rejected as "no route / too many stops".
 *
 * From a real game (seed 625710449): ER tokens I6 and has track I6-H5-G8, a
 * 3-centre line. With the base 2-train reach the route was unresolvable in the UI
 * and the run panel showed "2-train no route ¥0" despite an obvious valid route.
 */
const GAME = {
  title: 'rola',
  seed: 625710449,
  mapMode: 'auto',
  hostileMergers: false,
  seats: [
    { id: 'p1', name: 'Ruben' },
    { id: 'p2', name: 'Bot 2' },
    { id: 'p3', name: 'Bot 3' },
    { id: 'p4', name: 'Bot 4' }
  ],
  actions: [
    { type: 'initiate_auction', player: 'p1', bid: 120 }, { type: 'pass', player: 'p2' }, { type: 'pass', player: 'p3' }, { type: 'pass', player: 'p4' },
    { type: 'launch', player: 'p1', corp: 'EA' }, { type: 'initiate_auction', player: 'p2', bid: 120 }, { type: 'pass', player: 'p3' }, { type: 'pass', player: 'p4' },
    { type: 'launch_bid', player: 'p1', bid: 125 }, { type: 'pass', player: 'p2' }, { type: 'launch', player: 'p1', corp: 'ER' },
    { type: 'initiate_auction', player: 'p3', bid: 120 }, { type: 'pass', player: 'p4' }, { type: 'pass', player: 'p2' }, { type: 'launch', player: 'p3', corp: 'AD', home: 'G12' },
    { type: 'initiate_auction', player: 'p4', bid: 120 }, { type: 'pass', player: 'p2' }, { type: 'pass', player: 'p3' }, { type: 'launch', player: 'p4', corp: 'BR' },
    { type: 'pass', player: 'p1' }, { type: 'initiate_auction', player: 'p2', bid: 120 }, { type: 'pass', player: 'p3' }, { type: 'pass', player: 'p4' }, { type: 'launch', player: 'p2', corp: 'RE' },
    { type: 'buy', player: 'p3', corp: 'AD', from: 'ipo' }, { type: 'pass', player: 'p3' }, { type: 'buy', player: 'p4', corp: 'AD', from: 'ipo' }, { type: 'pass', player: 'p4' }, { type: 'pass', player: 'p1' },
    { type: 'buy', player: 'p2', corp: 'AD', from: 'ipo' }, { type: 'pass', player: 'p2' }, { type: 'buy', player: 'p3', corp: 'BR', from: 'ipo' }, { type: 'pass', player: 'p3' },
    { type: 'buy', player: 'p4', corp: 'BR', from: 'ipo' }, { type: 'pass', player: 'p4' }, { type: 'pass', player: 'p1' }, { type: 'buy', player: 'p2', corp: 'BR', from: 'ipo' }, { type: 'pass', player: 'p2' },
    { type: 'pass', player: 'p3' }, { type: 'pass', player: 'p4' }, { type: 'pass', player: 'p1' }, { type: 'pass', player: 'p2' },
    { type: 'buy_train', player: 'p3', corp: 'AD', train: '2' }, { type: 'lay_tile', player: 'p3', corp: 'AD', hex: 'G12', tile: '5', rotation: 3 }, { type: 'lay_tile', player: 'p3', corp: 'AD', hex: 'G10', tile: '7', rotation: 5 }, { type: 'pass', player: 'p3' }, { type: 'run', player: 'p3', corp: 'AD', revenue: 20, dividend: 'pay' }, { type: 'pass', player: 'p3' },
    { type: 'buy_train', player: 'p4', corp: 'BR', train: '2' }, { type: 'lay_tile', player: 'p4', corp: 'BR', hex: 'M14', tile: '5', rotation: 1 }, { type: 'lay_tile', player: 'p4', corp: 'BR', hex: 'L15', tile: '7', rotation: 3 }, { type: 'pass', player: 'p4' }, { type: 'run', player: 'p4', corp: 'BR', revenue: 20, dividend: 'pay' }, { type: 'pass', player: 'p4' },
    { type: 'buy_train', player: 'p1', corp: 'EA', train: '2' }, { type: 'lay_tile', player: 'p1', corp: 'EA', hex: 'M6', tile: '6', rotation: 0 }, { type: 'lay_tile', player: 'p1', corp: 'EA', hex: 'M8', tile: '292', rotation: 1 }, { type: 'pass', player: 'p1' }, { type: 'run', player: 'p1', corp: 'EA', revenue: 60, dividend: 'pay' }, { type: 'pass', player: 'p1' },
    { type: 'buy_train', player: 'p1', corp: 'ER', train: '2' }, { type: 'lay_tile', player: 'p1', corp: 'ER', hex: 'I6', tile: '5', rotation: 1 }, { type: 'lay_tile', player: 'p1', corp: 'ER', hex: 'H7', tile: '57', rotation: 1 }, { type: 'pass', player: 'p1' }, { type: 'run', player: 'p1', corp: 'ER', revenue: 40, dividend: 'pay' }, { type: 'pass', player: 'p1' },
    { type: 'buy_train', player: 'p2', corp: 'RE', train: '2' }, { type: 'lay_tile', player: 'p2', corp: 'RE', hex: 'H15', tile: '5', rotation: 4 }, { type: 'lay_tile', player: 'p2', corp: 'RE', hex: 'I14', tile: '7', rotation: 0 }, { type: 'pass', player: 'p2' }, { type: 'run', player: 'p2', corp: 'RE', revenue: 20, dividend: 'pay' }, { type: 'pass', player: 'p2' },
    { type: 'lay_tile', player: 'p3', corp: 'AD', hex: 'H11', tile: '7', rotation: 1 }, { type: 'pass', player: 'p3' }, { type: 'pass', player: 'p3' }, { type: 'run', player: 'p3', corp: 'AD', revenue: 40, dividend: 'pay' }, { type: 'pass', player: 'p3' },
    { type: 'lay_tile', player: 'p4', corp: 'BR', hex: 'L13', tile: '7', rotation: 0 }, { type: 'lay_tile', player: 'p4', corp: 'BR', hex: 'K14', tile: '7', rotation: 3 }, { type: 'pass', player: 'p4' }, { type: 'run', player: 'p4', corp: 'BR', revenue: 20, dividend: 'pay' }, { type: 'pass', player: 'p4' },
    { type: 'lay_tile', player: 'p1', corp: 'EA', hex: 'L9', tile: '6', rotation: 2 }, { type: 'lay_tile', player: 'p1', corp: 'EA', hex: 'K8', tile: '291', rotation: 5 }, { type: 'pass', player: 'p1' }, { type: 'run', player: 'p1', corp: 'EA', revenue: 60, dividend: 'pay' }, { type: 'pass', player: 'p1' },
    { type: 'lay_tile', player: 'p1', corp: 'ER', hex: 'H5', tile: '6', rotation: 5 }, { type: 'lay_tile', player: 'p1', corp: 'ER', hex: 'G6', tile: '8', rotation: 4 }, { type: 'pass', player: 'p1' }, { type: 'run', player: 'p1', corp: 'ER', revenue: 40, dividend: 'pay' }, { type: 'pass', player: 'p1' },
    { type: 'pass', player: 'p2' }, { type: 'pass', player: 'p2' }, { type: 'run', player: 'p2', corp: 'RE', revenue: 20, dividend: 'pay' }, { type: 'pass', player: 'p2' },
    { type: 'buy', player: 'p3', corp: 'EA', from: 'ipo' }, { type: 'pass', player: 'p3' }, { type: 'buy', player: 'p4', corp: 'EA', from: 'ipo' }, { type: 'pass', player: 'p4' }, { type: 'buy', player: 'p1', corp: 'EA', from: 'ipo' }, { type: 'pass', player: 'p1' }, { type: 'buy', player: 'p2', corp: 'ER', from: 'ipo' }, { type: 'pass', player: 'p2' },
    { type: 'pass', player: 'p3' }, { type: 'pass', player: 'p4' }, { type: 'pass', player: 'p1' }, { type: 'pass', player: 'p2' }, { type: 'pass', player: 'p3' },
    { type: 'pass', player: 'p3' }, { type: 'run', player: 'p3', corp: 'AD', revenue: 40, dividend: 'pay' }, { type: 'pass', player: 'p3' },
    { type: 'lay_tile', player: 'p4', corp: 'BR', hex: 'K12', tile: '8', rotation: 0 }, { type: 'lay_tile', player: 'p4', corp: 'BR', hex: 'J11', tile: '5', rotation: 4 }, { type: 'pass', player: 'p4' }, { type: 'run', player: 'p4', corp: 'BR', revenue: 40, dividend: 'pay' }, { type: 'pass', player: 'p4' },
    { type: 'lay_tile', player: 'p1', corp: 'EA', hex: 'K10', tile: '6', rotation: 3 }, { type: 'lay_tile', player: 'p1', corp: 'EA', hex: 'L11', tile: '9', rotation: 2 }, { type: 'place_token', player: 'p1', corp: 'EA', hex: 'K10' }, { type: 'run', player: 'p1', corp: 'EA', revenue: 60, dividend: 'pay' }, { type: 'buy_train', player: 'p1', corp: 'EA', train: '3' }, { type: 'pass', player: 'p1' },
    { type: 'lay_tile', player: 'p1', corp: 'ER', hex: 'G8', tile: '293', rotation: 0 }, { type: 'pass', player: 'p1' }, { type: 'pass', player: 'p1' }
  ]
} as const;

function liveState() {
  const s0 = initialState(GAME.seats as any, GAME.title, undefined as any, {
    seed: GAME.seed,
    mapMode: GAME.mapMode as any,
    hostileMergers: GAME.hostileMergers
  });
  return replay(s0, GAME.actions as unknown as GameAction[]);
}

describe('Express single-train stop boost (manual route resolution)', () => {
  it('boosts the lone 2-train to a 3-stop reach', () => {
    const s = liveState();
    const er = s.corporations.find((c) => c.sym === 'ER')!;
    expect(er.trains).toEqual(['2']);
    expect(trainReach(s, er, '2')).toBe(3);
  });

  it('resolves the boosted 3-stop route the UI hands to routeThroughStops', () => {
    const s = liveState();
    const er = s.corporations.find((c) => c.sym === 'ER')!;
    const reach = trainReach(s, er, '2');
    const res = routeThroughStops(s, ['I6', 'H5', 'G8'], reach, new Set(), new Set(), er);
    expect(res).not.toBeNull();
    expect(res!.route.revenue).toBe(80);
    // The auto best route agrees, confirming the boost is consistent across paths.
    expect(corpRoutes(s, er).revenue).toBe(80);
  });
});
