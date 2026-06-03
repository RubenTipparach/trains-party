/**
 * The RoLA Manual map-build round: players (and bots) take turns laying tri-hex
 * tiles to grow a connected board. When the pool is exhausted the map is finalised
 * (minor home cities assigned) and the stock round begins.
 */
import { GameError, type GameAction, type GameState } from './types';
import { fmtCoord, isLegalPlacement, legalPlacements, parseCoord, placementCoords } from './triHex';

/** Whose turn it is to place a tile, or null. */
export function mapBuildActivePlayer(s: GameState): string | null {
  if (!s.mapBuild || s.mapBuild.order.length === 0) return null;
  return s.mapBuild.order[s.mapBuild.turn % s.mapBuild.order.length];
}

export function applyMapBuild(s: GameState, action: GameAction): void {
  if (action.type !== 'place_tri') throw new GameError(`cannot ${action.type} during map building`);
  const mb = s.mapBuild;
  if (!mb || !s.map) throw new GameError('no map is being built');
  const active = mapBuildActivePlayer(s);
  if (action.player !== active) throw new GameError(`it is ${active ?? 'nobody'}'s turn to place a tile`);
  if (mb.pool.length === 0) throw new GameError('no tiles left to place');
  if (!isLegalPlacement(s.map, action.anchor, action.shape)) {
    throw new GameError(`illegal tile placement at ${action.anchor}`);
  }
  const tile = mb.pool[0];
  const coords = placementCoords(action.anchor, action.shape);
  coords.forEach((coord, i) => {
    s.map![coord] = { coord, ...tile.cells[i] };
  });
  mb.pool.shift();
  mb.turn += 1;
  const name = s.players.find((p) => p.id === action.player)?.name ?? action.player;
  s.log.push(`${name} placed a tri-hex tile at ${action.anchor}`);
  if (mb.pool.length === 0) finalizeBuild(s);
}

/** Assign minor homes onto the finished map and hand off to the stock round. */
function finalizeBuild(s: GameState): void {
  const map = s.map!;
  const cityCoords = Object.keys(map)
    .filter((k) => (map[k].cities?.length ?? 0) > 0)
    .sort();
  const minors = s.corporations.filter((c) => c.kind === 'minor');
  const step = Math.max(1, Math.floor(cityCoords.length / Math.max(1, minors.length)));
  minors.forEach((c, i) => {
    const coord = cityCoords[(i * step) % cityCoords.length];
    if (coord) {
      c.coordinates = coord;
      map[coord].name = c.sym;
    }
  });
  delete s.mapBuild;
  s.round = 'stock';
  s.log.push('Map complete. Minor home cities assigned.');
}

/** A bot's tile placement: keep the map compact (most shared edges). */
export function pickBuildPlacement(s: GameState): GameAction | null {
  const active = mapBuildActivePlayer(s);
  if (!active || !s.map) return null;
  const options = legalPlacements(s.map);
  if (options.length === 0) return null;
  const adjScore = (coords: string[]) =>
    coords.reduce((n, c) => {
      const { col, row } = parseCoord(c);
      const adj = [
        [0, 2],
        [-1, 1],
        [-1, -1],
        [0, -2],
        [1, -1],
        [1, 1]
      ].filter(([dc, dr]) => s.map![fmtCoord(col + dc, row + dr)]).length;
      return n + adj;
    }, 0);
  options.sort(
    (a, b) => adjScore(b.coords) - adjScore(a.coords) || a.coords.join().localeCompare(b.coords.join())
  );
  const best = options[0];
  return { type: 'place_tri', player: active, anchor: best.anchor, shape: best.shape };
}
