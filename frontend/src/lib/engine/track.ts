/**
 * Track laying and station tokens (operating round).
 *
 * Hex adjacency, a corporation's connected network, and the set of legal tile
 * plays: yellow tiles onto empty hexes plus green/brown UPGRADES of existing
 * tiles. Upgrades follow the standard 18xx rules:
 *   - the new tile's colour is exactly one step up (white->yellow->green->brown),
 *     gated by the current phase;
 *   - it preserves every existing track connection (old paths are a subset of
 *     the new tile's paths in some rotation);
 *   - labels match (T / H / K hexes only take the matching labelled tiles);
 *   - the city/town count is preserved and slots do not drop below tokens placed;
 *   - no track edge points into the sea;
 *   - tile supply (the manifest count) is respected.
 *
 * Map and tile data come from the title config (by `state.title`), so this module
 * is title-agnostic.
 */

import { configFor, rolaAbility } from './registry';
import { hexesFor } from './board';
import { GameError, type CorporationState, type GameState } from './types';
import { TILES, rotatePaths, type TileEnd } from './tiles';
import type { TileColor, HexDef } from '$lib/data/types';

const COLORS: TileColor[] = ['white', 'yellow', 'green', 'brown', 'gray', 'red'];
const colorIdx = (c: TileColor) => COLORS.indexOf(c);

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

/** The hex on the far side of `edge` from `coord` that actually exists on the map. */
export function neighbor(hexes: Record<string, HexDef>, coord: string, edge: number): string | null {
  const p = parse(coord);
  if (!p) return null;
  const [dc, dr] = EDGE_DELTA[edge];
  const col = p.col + dc;
  const row = p.row + dr;
  if (col < 0 || row < 1) return null;
  const c = String.fromCharCode(65 + col) + row;
  return hexes[c] ? c : null;
}

type Pair = { a: TileEnd; b: TileEnd };

/** The effective tile on a hex: a laid tile (rotated) or the preprinted base. */
interface TileInfo {
  color: TileColor;
  paths: Pair[];
  cities: number;
  towns: number;
  slots: number;
  label?: string;
}
function tileInfo(s: GameState, coord: string): TileInfo {
  const laid = s.tiles[coord];
  const base = hexesFor(s)[coord];
  if (laid) {
    const def = TILES[laid.id];
    return {
      color: def.color,
      paths: rotatePaths(def, laid.rotation),
      cities: def.cities,
      towns: def.towns,
      slots: def.slots,
      label: def.label
    };
  }
  return {
    color: base?.color ?? 'white',
    paths: (base?.paths ?? []).map((p) => ({ a: p.a === 'center' ? 'c' : p.a, b: p.b === 'center' ? 'c' : p.b })),
    cities: base?.cities.length ?? 0,
    towns: base?.towns.length ?? 0,
    slots: base?.cities[0]?.slots ?? 0,
    label: base?.label
  };
}

function hexTrack(s: GameState, coord: string): Pair[] {
  return tileInfo(s, coord).paths;
}
function edgesTouched(paths: Pair[]): Set<number> {
  const set = new Set<number>();
  for (const p of paths) {
    if (typeof p.a === 'number') set.add(p.a);
    if (typeof p.b === 'number') set.add(p.b);
  }
  return set;
}
const endKey = (e: TileEnd) => (e === 'c' ? 'c' : String(e));
const pathKey = (p: Pair) => [endKey(p.a), endKey(p.b)].sort().join('-');

/** Tiles already laid on the board, counted by id (for supply limits). */
function tilesUsed(s: GameState): Record<string, number> {
  const used: Record<string, number> = {};
  for (const coord of Object.keys(s.tiles)) used[s.tiles[coord].id] = (used[s.tiles[coord].id] ?? 0) + 1;
  return used;
}
function supplyLeft(s: GameState, id: string): number {
  const total = configFor(s.title).tileManifest.find((t) => t.id === id)?.count ?? 0;
  return total - (tilesUsed(s)[id] ?? 0);
}

/** Colours allowed to be laid in the current phase. */
function phaseColors(s: GameState): TileColor[] {
  return (configFor(s.title).phases.find((p) => p.name === s.phase)?.tiles ?? ['yellow']) as TileColor[];
}

/** The set of hexes the corporation's track reaches from its token(s). */
export function network(s: GameState, corp: CorporationState): Set<string> {
  const hexes = hexesFor(s);
  const visited = new Set<string>(corp.tokenHexes);
  const queue = [...corp.tokenHexes];
  while (queue.length) {
    const h = queue.pop()!;
    for (const e of edgesTouched(hexTrack(s, h))) {
      const n = neighbor(hexes, h, e);
      if (n && !visited.has(n) && edgesTouched(hexTrack(s, n)).has(opposite(e))) {
        visited.add(n);
        // A blocked city is reachable (you may upgrade it) but cannot be traced
        // through, so do not expand the network past it.
        if (!cityBlocks(s, corp, n)) queue.push(n);
      }
    }
  }
  return visited;
}

/** Number of station tokens currently in a hex (across all corporations). */
function tokensInHex(s: GameState, hex: string): number {
  return s.corporations.filter((c) => c.tokenHexes.includes(hex)).length;
}

/**
 * Token blocking for connectivity: a city whose slots are all filled by OTHER
 * corporations blocks `corp` from tracing PAST it. The corporation may still
 * reach (and upgrade) the blocked city itself, but not anything beyond it. Its
 * own token grants passage; cities with a free slot and slotless hexes (towns,
 * offboards, plain track) never block.
 */
function cityBlocks(s: GameState, corp: CorporationState, hex: string): boolean {
  const info = tileInfo(s, hex);
  if (info.cities === 0 || info.slots <= 0) return false;
  if (corp.tokenHexes.includes(hex)) return false;
  return tokensInHex(s, hex) >= info.slots;
}

/**
 * Hexes a still-player-owned private blocks from tile lays and token placement
 * (Takamatsu E-Railroad -> K4, Ehime Railway -> C4). The block lifts once the
 * private closes or is bought by a corporation. A corporation's mandatory home
 * token is placed directly (it does not go through `legalTokens`), so a blocked
 * home hex is still tokened on float/first-operation.
 */
export function blockedHexes(s: GameState): Set<string> {
  const out = new Set<string>();
  for (const co of s.companies) {
    if (co.closed || !co.owner) continue; // only while a PLAYER owns it
    for (const ab of co.abilities) {
      if (ab.type === 'blocks_hexes') for (const h of ab.hexes) out.add(h);
    }
  }
  return out;
}

/** Build-cost discount on `hex` from a terrain-discount private the corp owns (SMR). */
function buildCostDiscount(s: GameState, corp: CorporationState, hex: string): number {
  const terrain = hexesFor(s)[hex]?.terrain;
  if (!terrain || terrain.length === 0) return 0;
  let disc = 0;
  for (const sym of corp.companies) {
    const co = s.companies.find((c) => c.sym === sym);
    if (!co || co.closed) continue;
    for (const ab of co.abilities) {
      if (ab.type === 'tile_discount' && terrain.includes(ab.terrain)) disc = Math.max(disc, ab.discount);
    }
  }
  return disc;
}

/** Net build cost of laying on `hex` for `corp` (terrain cost minus owned discounts). */
function buildCost(s: GameState, corp: CorporationState, hex: string): number {
  const base = hexesFor(s)[hex]?.upgradeCost ?? 0;
  return Math.max(0, base - buildCostDiscount(s, corp, hex));
}

/**
 * Non-connectivity geometric fit: the tile preserves every existing track
 * connection, points no track into the sea, matches the label and city/town
 * count, has enough slots for placed tokens, and is still in supply. Shared by
 * the normal lay search and the private special lays (which skip connectivity).
 */
function tileFitsHex(s: GameState, hex: string, tile: string, rotation: number): boolean {
  const hexes = hexesFor(s);
  const def = TILES[tile];
  const base = hexes[hex];
  if (!def || !base) return false;
  const cur = tileInfo(s, hex);
  if ((def.label ?? '') !== (cur.label ?? '')) return false;
  if (def.cities !== cur.cities || def.towns !== cur.towns) return false;
  if (def.cities > 0 && def.slots < Math.max(cur.slots, tokensInHex(s, hex))) return false;
  if (supplyLeft(s, tile) <= 0) return false;
  const rp = rotatePaths(def, rotation);
  const tileEdges = [...edgesTouched(rp)];
  if (tileEdges.some((e) => neighbor(hexes, hex, e) === null)) return false; // no track into the sea
  const newKeys = new Set(rp.map(pathKey));
  return cur.paths.map(pathKey).every((k) => newKeys.has(k)); // preserve connections
}

export interface TileLay {
  hex: string;
  tile: string;
  rotation: number;
  cost: number;
  /** true = upgrade of an existing tile, false = fresh lay on an empty hex. */
  upgrade: boolean;
}

/** Tile ids of a given colour that geometrically fit `hex` (ignoring supply). */
function fittingTiles(s: GameState, hex: string, color: TileColor): string[] {
  const cur = tileInfo(s, hex);
  const minSlots = tokensInHex(s, hex);
  return Object.values(TILES)
    .filter((t) => t.color === color)
    .filter((t) => !t.id.startsWith('Beg')) // beginner-variant tiles only
    .filter((t) => (t.label ?? '') === (cur.label ?? '')) // label must match
    .filter((t) => t.cities === cur.cities && t.towns === cur.towns)
    .filter((t) => t.slots >= Math.max(cur.slots, minSlots) || cur.cities === 0)
    .map((t) => t.id);
}

/** Candidate tile ids of a given colour that fit `hex` AND are still in supply. */
function candidateTiles(s: GameState, hex: string, color: TileColor): string[] {
  return fittingTiles(s, hex, color).filter((id) => supplyLeft(s, id) > 0);
}

/** Remaining copies of a tile id in the depot (manifest count minus laid). */
export function tileSupply(s: GameState, id: string): number {
  return supplyLeft(s, id);
}

/** All legal tile plays (fresh yellow lays + green/brown upgrades) for a corp. */
export function legalLays(s: GameState, corp: CorporationState): TileLay[] {
  if (corp.tokenHexes.length === 0) return [];
  const hexes = hexesFor(s);
  const allowed = phaseColors(s);
  const net = network(s, corp);
  const blocked = blockedHexes(s);

  // Hexes we might play on: every hex in the network (upgrades + on-token lays),
  // and empty hexes adjacent to an open track end (fresh lays).
  const candidates = new Set<string>(net);
  for (const h of net) {
    // The blocked city may be upgraded (it is already in `net`), but you cannot
    // lay a fresh tile on the far side of it.
    if (cityBlocks(s, corp, h)) continue;
    for (const e of edgesTouched(hexTrack(s, h))) {
      const n = neighbor(hexes, h, e);
      if (n) candidates.add(n);
    }
  }

  const out: TileLay[] = [];
  const seen = new Set<string>();
  for (const hex of candidates) {
    const base = hexes[hex];
    if (!base) continue;
    if (blocked.has(hex)) continue; // a player-owned private blocks building here
    const cur = tileInfo(s, hex);
    const nextColor = COLORS[colorIdx(cur.color) + 1];
    if (!nextColor || !allowed.includes(nextColor)) continue; // phase gate / gray-red end
    const curKeys = cur.paths.map(pathKey);
    const onToken = corp.tokenHexes.includes(hex);
    const inNet = net.has(hex);

    for (const tile of candidateTiles(s, hex, nextColor)) {
      const def = TILES[tile];
      for (let r = 0; r < 6; r++) {
        const rp = rotatePaths(def, r);
        const tileEdges = [...edgesTouched(rp)];
        // No track may point into the sea.
        if (tileEdges.some((e) => neighbor(hexes, hex, e) === null)) continue;
        // Preserve every existing connection (old paths subset of new).
        const newKeys = new Set(rp.map(pathKey));
        if (!curKeys.every((k) => newKeys.has(k))) continue;
        // Connectivity: on a token, already in the network, or a new tile edge
        // links to a network neighbour's matching track end.
        let ok = onToken || inNet;
        if (!ok) {
          for (const e of tileEdges) {
            const n = neighbor(hexes, hex, e);
            if (n && net.has(n) && edgesTouched(hexTrack(s, n)).has(opposite(e))) {
              ok = true;
              break;
            }
          }
        }
        if (!ok) continue;
        const key = `${hex}:${tile}:${tileEdges.slice().sort((a, b) => a - b).join('')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ hex, tile, rotation: r, cost: buildCost(s, corp, hex), upgrade: !!s.tiles[hex] || cur.color !== 'white' });
      }
    }
  }
  return out;
}

/**
 * Tiles that would geometrically fit `hex` for the current phase but are out of
 * supply (every copy is already on the board). The UI shows these greyed with a
 * "0 left" badge so an exhausted tile is visibly unavailable rather than silently
 * missing from the option fan. Only reports a colour the phase allows on this hex.
 */
export function exhaustedTilesOnHex(s: GameState, hex: string): string[] {
  if (!hexesFor(s)[hex]) return [];
  const cur = tileInfo(s, hex);
  const nextColor = COLORS[colorIdx(cur.color) + 1];
  if (!nextColor || !phaseColors(s).includes(nextColor)) return [];
  return fittingTiles(s, hex, nextColor).filter((id) => supplyLeft(s, id) <= 0);
}

export function applyLayTile(s: GameState, corp: CorporationState, hex: string, tile: string, rotation: number): void {
  const legal = legalLays(s, corp).some((l) => l.hex === hex && l.tile === tile && l.rotation === rotation);
  if (!legal) throw new GameError(`illegal tile lay: ${tile} on ${hex} r${rotation}`);
  const cost = buildCost(s, corp, hex);
  if (corp.cash < cost) throw new GameError(`${corp.sym} cannot afford the ${cost} build cost`);
  if (cost > 0) {
    corp.cash -= cost;
    s.bank += cost;
    // Tunneling Company: gains into its treasury each time it digs a mountain
    // (the cost is paid first; the rulebook's net gain is amount - cost).
    const tun = rolaAbility(s.title, corp, 'mountain_treasury_gain');
    if (tun?.amount && (hexesFor(s)[hex]?.terrain ?? []).includes('mountain')) {
      corp.cash += tun.amount;
      s.bank -= tun.amount;
      s.log.push(`${corp.sym} tunnels the mountain and gains ${tun.amount}`);
    }
  }
  const upgrade = !!s.tiles[hex];
  s.tiles[hex] = { id: tile, rotation };
  s.log.push(`${corp.sym} ${upgrade ? 'upgrades' : 'lays'} tile ${tile} on ${hex}${cost ? ` for ${cost}` : ''}`);
}

// --- station tokens --------------------------------------------------------

export interface TokenPlay {
  hex: string;
  cost: number;
}

/** Cities the corporation may place its next station token in. */
export function legalTokens(s: GameState, corp: CorporationState): TokenPlay[] {
  const used = corp.tokenHexes.length;
  if (used >= corp.tokens.length) return []; // no tokens left
  const cost = corp.tokens[used];
  if (corp.cash < cost) return [];
  const net = network(s, corp);
  const blocked = blockedHexes(s);
  const out: TokenPlay[] = [];
  for (const hex of net) {
    if (corp.tokenHexes.includes(hex)) continue;
    if (blocked.has(hex)) continue; // a player-owned private blocks placing here
    const info = tileInfo(s, hex);
    if (info.cities === 0) continue; // only cities take tokens
    if (tokensInHex(s, hex) >= info.slots) continue; // no open slot
    out.push({ hex, cost });
  }
  return out;
}

/**
 * Lay a tile via a private company's special ability (Mitsubishi Ferry port tile;
 * Ehime Railway's green tile on Ohzu after sale to a corporation). Bypasses the
 * normal connectivity / phase / build-cost rules but still enforces geometric fit
 * and tile supply. The target hex must be empty (no tile laid yet).
 */
export function applySpecialLay(
  s: GameState,
  player: string,
  companySym: string,
  hex: string,
  tile: string,
  rotation: number
): void {
  const co = s.companies.find((c) => c.sym === companySym);
  if (!co || co.closed) throw new GameError(`${companySym} cannot act`);
  const ab = co.abilities.find((a) => a.type === 'tile_lay');
  if (!ab || ab.type !== 'tile_lay') throw new GameError(`${companySym} has no tile-lay ability`);
  if (!ab.hexes.includes(hex)) throw new GameError(`${companySym} cannot lay on ${hex}`);
  if (!ab.tiles.includes(tile)) throw new GameError(`${companySym} cannot lay tile ${tile}`);
  if (s.tiles[hex]) throw new GameError(`a tile is already laid on ${hex}`);

  if (ab.ownerType === 'player') {
    if (co.owner !== player) throw new GameError(`${player} does not own ${companySym}`);
    if (co.usedAbility) throw new GameError(`${companySym}'s tile lay is already used`);
  } else {
    const corp = s.corporations.find((c) => c.companies.includes(companySym));
    if (!corp) throw new GameError(`${companySym} is not owned by a corporation`);
    if (corp.president !== player) throw new GameError(`only ${corp.sym}'s president may use ${companySym}`);
    if (!co.pendingLay) throw new GameError(`${companySym} has no pending tile lay`);
  }
  if (!tileFitsHex(s, hex, tile, rotation)) throw new GameError(`tile ${tile} does not fit ${hex} at r${rotation}`);

  s.tiles[hex] = { id: tile, rotation };
  if (ab.ownerType === 'player') co.usedAbility = true;
  else co.pendingLay = false;
  s.log.push(`${co.name} lays tile ${tile} on ${hex} (special ability)`);
}

/** Hexes/tiles a player's private may special-lay right now (UI helper). */
export function specialLayOptions(s: GameState, player: string): { company: string; hexes: string[]; tiles: string[] }[] {
  const out: { company: string; hexes: string[]; tiles: string[] }[] = [];
  for (const co of s.companies) {
    if (co.closed) continue;
    for (const ab of co.abilities) {
      if (ab.type !== 'tile_lay') continue;
      if (ab.ownerType === 'player') {
        if (co.owner !== player || co.usedAbility) continue;
      } else {
        const corp = s.corporations.find((c) => c.companies.includes(co.sym));
        if (!corp || corp.president !== player || !co.pendingLay) continue;
      }
      const hexes = ab.hexes.filter((h) => !s.tiles[h]);
      if (hexes.length) out.push({ company: co.sym, hexes, tiles: ab.tiles });
    }
  }
  return out;
}

export function applyToken(s: GameState, corp: CorporationState, hex: string): void {
  const legal = legalTokens(s, corp).find((t) => t.hex === hex);
  if (!legal) throw new GameError(`illegal token placement on ${hex}`);
  if (corp.cash < legal.cost) throw new GameError(`${corp.sym} cannot afford the ${legal.cost} token`);
  corp.cash -= legal.cost;
  s.bank += legal.cost;
  corp.tokenHexes.push(hex);
  s.log.push(`${corp.sym} places a token on ${hex}${legal.cost ? ` for ${legal.cost}` : ''}`);
}
