/**
 * Track laying (operating round): hex adjacency, a corporation's connected track
 * network, legal yellow-tile lays, and applying a lay.
 *
 * First pass: yellow tiles onto empty white hexes (plain / city / town), the lay
 * must connect to the corporation's network (seeded from its token), terrain
 * build cost is paid from the treasury. Green/brown upgrades, special-ability
 * lays, and routes follow.
 */

import { HEX_BY_COORD } from '$lib/data/map1889';
import { GameError, type CorporationState, type GameState } from './types';
import { TILES, rotatePaths, yellowTilesFor, type TileEnd } from './tiles';

// edge index -> [dCol, dRow] in the engine's doubled coordinates.
const EDGE_DELTA: Record<number, [number, number]> = {
  0: [0, 2],
  1: [-1, 1],
  2: [-1, -1],
  3: [0, -2],
  4: [1, -1],
  5: [1, 1]
};
const opposite = (e: number) => (e + 3) % 6;

function parse(coord: string): { col: number; row: number } | null {
  const m = coord.match(/^([A-Za-z])(\d+)$/);
  if (!m) return null;
  return { col: m[1].toUpperCase().charCodeAt(0) - 65, row: parseInt(m[2], 10) };
}
export function neighbor(coord: string, edge: number): string | null {
  const p = parse(coord);
  if (!p) return null;
  const [dc, dr] = EDGE_DELTA[edge];
  const col = p.col + dc;
  const row = p.row + dr;
  if (col < 0 || row < 1) return null;
  const c = String.fromCharCode(65 + col) + row;
  return HEX_BY_COORD[c] ? c : null;
}

type Pair = { a: TileEnd; b: TileEnd };
/** Current track on a hex: a laid tile (rotated) or the preprinted base paths. */
function hexTrack(s: GameState, coord: string): Pair[] {
  const laid = s.tiles[coord];
  if (laid) return rotatePaths(TILES[laid.id], laid.rotation);
  const base = HEX_BY_COORD[coord];
  if (!base) return [];
  return base.paths.map((p) => ({ a: p.a === 'center' ? 'c' : p.a, b: p.b === 'center' ? 'c' : p.b }));
}
function edgesTouched(paths: Pair[]): Set<number> {
  const s = new Set<number>();
  for (const p of paths) {
    if (typeof p.a === 'number') s.add(p.a);
    if (typeof p.b === 'number') s.add(p.b);
  }
  return s;
}

/** A white hex with no laid tile can receive a yellow tile. */
function layable(s: GameState, coord: string): boolean {
  const h = HEX_BY_COORD[coord];
  return !!h && h.color === 'white' && !s.tiles[coord];
}
function baseKind(coord: string): 'plain' | 'city' | 'town' {
  const h = HEX_BY_COORD[coord];
  if (h && h.cities.length > 0) return 'city';
  if (h && h.towns.length > 0) return 'town';
  return 'plain';
}

/** The set of hexes the corporation's track reaches from its token(s). */
function network(s: GameState, corp: CorporationState): Set<string> {
  const visited = new Set<string>(corp.tokenHexes);
  const queue = [...corp.tokenHexes];
  while (queue.length) {
    const h = queue.pop()!;
    for (const e of edgesTouched(hexTrack(s, h))) {
      const n = neighbor(h, e);
      if (n && !visited.has(n) && edgesTouched(hexTrack(s, n)).has(opposite(e))) {
        visited.add(n);
        queue.push(n);
      }
    }
  }
  return visited;
}

export interface TileLay {
  hex: string;
  tile: string;
  rotation: number;
  cost: number;
}

/** All legal yellow-tile lays for a corporation in the current state. */
export function legalLays(s: GameState, corp: CorporationState): TileLay[] {
  if (corp.tokenHexes.length === 0) return [];
  const net = network(s, corp);

  const candidates = new Set<string>();
  for (const h of net) {
    if (layable(s, h)) candidates.add(h); // lay on the token/home hex
    for (const e of edgesTouched(hexTrack(s, h))) {
      const n = neighbor(h, e);
      if (n && layable(s, n)) candidates.add(n); // extend off an open track end
    }
  }

  const out: TileLay[] = [];
  const seen = new Set<string>();
  for (const hex of candidates) {
    const kind = baseKind(hex);
    const onToken = corp.tokenHexes.includes(hex);
    for (const tile of yellowTilesFor(kind)) {
      for (let r = 0; r < 6; r++) {
        const rp = rotatePaths(TILES[tile], r);
        const tileEdges = [...edgesTouched(rp)];
        // No track may point into the sea: every tile edge must border a hex.
        if (tileEdges.some((e) => neighbor(hex, e) === null)) continue;
        // The lay must connect to this corporation's network (its tokened
        // cities and the track already linked to them).
        let ok = onToken;
        if (!ok) {
          for (const e of tileEdges) {
            const n = neighbor(hex, e);
            if (n && net.has(n) && edgesTouched(hexTrack(s, n)).has(opposite(e))) {
              ok = true;
              break;
            }
          }
        }
        if (!ok) continue;
        // dedupe rotations that yield the same edge footprint
        const key = `${hex}:${tile}:${tileEdges.slice().sort((a, b) => a - b).join('')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ hex, tile, rotation: r, cost: HEX_BY_COORD[hex].upgradeCost ?? 0 });
      }
    }
  }
  return out;
}

export function applyLayTile(s: GameState, corp: CorporationState, hex: string, tile: string, rotation: number): void {
  const legal = legalLays(s, corp).some((l) => l.hex === hex && l.tile === tile && l.rotation === rotation);
  if (!legal) throw new GameError(`illegal tile lay: ${tile} on ${hex} r${rotation}`);
  const cost = HEX_BY_COORD[hex].upgradeCost ?? 0;
  if (corp.cash < cost) throw new GameError(`${corp.sym} cannot afford the ${cost} build cost`);
  if (cost > 0) {
    corp.cash -= cost;
    s.bank += cost;
  }
  s.tiles[hex] = { id: tile, rotation };
  s.log.push(`${corp.sym} lays tile ${tile} on ${hex}${cost ? ` for ${cost}` : ''}`);
}
