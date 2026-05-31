/**
 * Route finding and revenue (operating round).
 *
 * Models the track network as a graph of connection points (hex edges and a hex
 * centre) joined by tile paths within a hex and by shared edges between hexes. A
 * train route is a walk that alternates centre -> track -> centre, visiting up to
 * `distance` revenue centres, reusing no track segment, and passing through at
 * least one city the corporation has tokened.
 *
 * Revenue is the sum of the visited centres' values (offboard hexes use the value
 * for the current phase tier). For multiple trains we assign greedily: the
 * longest train takes the best route, then shorter trains take the best remaining
 * route without reusing track. This is a faithful-enough first pass; it finds the
 * best simple routes rather than a globally optimal non-overlapping set.
 */

import { HEX_BY_COORD } from '$lib/data/map1889';
import { TRAINS } from '$lib/data/g1889';
import { neighbor } from './track';
import { TILES, rotatePaths, type TileEnd } from './tiles';
import type { CorporationState, GameState } from './types';

const opposite = (e: number) => (e + 3) % 6;

type End = TileEnd; // edge 0-5 or 'c'
interface Seg {
  a: End;
  b: End;
}

/** The track segments on a hex (laid tile rotated, else preprinted base). */
function hexSegments(s: GameState, hex: string): Seg[] {
  const laid = s.tiles?.[hex];
  if (laid) {
    return rotatePaths(TILES[laid.id], laid.rotation);
  }
  const base = HEX_BY_COORD[hex];
  if (!base) return [];
  return base.paths.map((p) => ({ a: p.a === 'center' ? 'c' : p.a, b: p.b === 'center' ? 'c' : p.b }));
}

/** Phase tier for offboard revenue: yellow (2-3) / brown (4-5) / diesel (6,D). */
function offboardTier(phase: string): string {
  if (phase === '2' || phase === '3') return 'yellow';
  if (phase === '4' || phase === '5') return 'brown';
  return 'diesel';
}

/** Revenue of a hex's centre for the current phase (0 if it is not a stop). */
function centreRevenue(s: GameState, hex: string): number {
  const laid = s.tiles?.[hex];
  if (laid) {
    const def = TILES[laid.id];
    if (def.cities || def.towns) return def.revenue;
  }
  const base = HEX_BY_COORD[hex];
  if (!base) return 0;
  if (base.offboard) {
    const tier = offboardTier(s.phase);
    return base.offboard.revenue[tier] ?? Object.values(base.offboard.revenue)[0] ?? 0;
  }
  if (laid) return 0; // laid plain track, no centre
  if (base.cities.length) return base.cities[0].revenue;
  if (base.towns.length) return base.towns[0].revenue;
  return 0;
}

/** Does a hex have a stop (city/town/offboard) under its current tile? */
function hasCentre(s: GameState, hex: string): boolean {
  const laid = s.tiles?.[hex];
  if (laid) {
    const def = TILES[laid.id];
    return def.cities > 0 || def.towns > 0;
  }
  const base = HEX_BY_COORD[hex];
  return !!base && (base.cities.length > 0 || base.towns.length > 0 || !!base.offboard);
}

function isCity(s: GameState, hex: string): boolean {
  const laid = s.tiles?.[hex];
  if (laid) return TILES[laid.id].cities > 0;
  const base = HEX_BY_COORD[hex];
  return !!base && (base.cities.length > 0 || !!base.offboard);
}

const segId = (hex: string, seg: Seg) => {
  const a = String(seg.a);
  const b = String(seg.b);
  return `${hex}|${[a, b].sort().join('-')}`;
};
const linkId = (hex: string, e: number) => {
  const nb = neighbor(hex, e)!;
  return [`${hex}.${e}`, `${nb}.${opposite(e)}`].sort().join('~');
};

export interface Route {
  hexes: string[]; // ordered revenue-centre hexes visited
  revenue: number;
  /** Track segments used by the route, as `${hex}|${a}-${b}` ids (for highlighting). */
  segs?: string[];
}

/**
 * Find the best simple route anchored at a tokened city for a train of `maxStops`
 * stops, avoiding any track in `usedSegs` / `usedLinks`. Returns the route and the
 * segments/links it consumed.
 */
function bestRouteFrom(
  s: GameState,
  start: string,
  maxStops: number,
  usedSegs: Set<string>,
  usedLinks: Set<string>
): { route: Route; segs: Set<string>; links: Set<string> } | null {
  let best: { route: Route; segs: Set<string>; links: Set<string> } | null = null;

  // Walk state: we are AT a centre in `hex`; choose an outgoing tile segment
  // (centre->edge), cross to the neighbour, continue. `stops` are centres so far.
  function walk(
    hex: string,
    stops: string[],
    revenue: number,
    segs: Set<string>,
    links: Set<string>
  ) {
    // A valid train route connects at least two revenue centres. Since the walk
    // is anchored at a tokened city (start), every route includes a token.
    if (stops.length >= 2 && (!best || revenue > best.route.revenue)) {
      best = { route: { hexes: [...stops], revenue, segs: [...segs] }, segs: new Set(segs), links: new Set(links) };
    }
    if (stops.length >= maxStops) return;

    // From the centre, take any segment touching 'c' to reach an edge.
    for (const seg of hexSegments(s, hex)) {
      const fromCentre = seg.a === 'c' || seg.b === 'c';
      if (!fromCentre) continue;
      const edge = (seg.a === 'c' ? seg.b : seg.a) as number;
      const sid = segId(hex, seg);
      if (segs.has(sid) || usedSegs.has(sid)) continue;
      const nb = neighbor(hex, edge);
      if (!nb) continue;
      const lid = linkId(hex, edge);
      if (links.has(lid) || usedLinks.has(lid)) continue;
      // arrive at neighbour on the opposite edge; traverse to its centre(s)
      traverse(nb, opposite(edge), stops, revenue, withAdd(segs, sid), withAdd(links, lid));
    }
  }

  // We just entered `hex` on `enterEdge`; route through its track to a centre or
  // straight across to the next hex.
  function traverse(
    hex: string,
    enterEdge: number,
    stops: string[],
    revenue: number,
    segs: Set<string>,
    links: Set<string>
  ) {
    for (const seg of hexSegments(s, hex)) {
      const ends = [seg.a, seg.b];
      if (!ends.includes(enterEdge)) continue;
      const other = (seg.a === enterEdge ? seg.b : seg.a) as End;
      const sid = segId(hex, seg);
      if (segs.has(sid) || usedSegs.has(sid)) continue;
      const segs2 = withAdd(segs, sid);
      if (other === 'c') {
        // reached a centre: it becomes a stop
        const rev = centreRevenue(s, hex);
        if (rev <= 0 && !hasCentre(s, hex)) continue;
        walk(hex, [...stops, hex], revenue + rev, segs2, links);
      } else {
        // pass through to the next hex
        const edge = other as number;
        const nb = neighbor(hex, edge);
        if (!nb) continue;
        const lid = linkId(hex, edge);
        if (links.has(lid) || usedLinks.has(lid)) continue;
        traverse(nb, opposite(edge), stops, revenue, segs2, withAdd(links, lid));
      }
    }
  }

  walk(start, [start], centreRevenue(s, start), new Set(), new Set());
  return best;
}

function withAdd(set: Set<string>, v: string): Set<string> {
  const n = new Set(set);
  n.add(v);
  return n;
}

/** Best set of routes for a corporation's trains (greedy, longest train first). */
export function corpRoutes(s: GameState, corp: CorporationState): { routes: Route[]; revenue: number } {
  const tokenCities = corp.tokenHexes.filter((h) => isCity(s, h));
  if (tokenCities.length === 0 || corp.trains.length === 0) return { routes: [], revenue: 0 };

  const trainDistance = (name: string) => {
    const t = TRAINS.find((x) => x.name === name);
    const d = t?.distance ?? 2;
    return d > 90 ? 99 : d; // D-train: effectively unlimited stops
  };
  const trains = [...corp.trains].sort((a, b) => trainDistance(b) - trainDistance(a));

  const usedSegs = new Set<string>();
  const usedLinks = new Set<string>();
  const routes: Route[] = [];
  let revenue = 0;

  for (const train of trains) {
    const maxStops = trainDistance(train);
    let pick: { route: Route; segs: Set<string>; links: Set<string> } | null = null;
    for (const anchor of tokenCities) {
      const r = bestRouteFrom(s, anchor, maxStops, usedSegs, usedLinks);
      if (r && (!pick || r.route.revenue > pick.route.revenue)) pick = r;
    }
    if (pick && pick.route.revenue > 0) {
      routes.push(pick.route);
      revenue += pick.route.revenue;
      pick.segs.forEach((x) => usedSegs.add(x));
      pick.links.forEach((x) => usedLinks.add(x));
    }
  }
  return { routes, revenue };
}

/** Total run revenue a corporation can earn this OR. */
export function routeRevenue(s: GameState, corp: CorporationState): number {
  return corpRoutes(s, corp).revenue;
}

/**
 * Could this corporation run a revenue route if it owned a train? Train-independent
 * (tests a minimal 2-stop route from a tokened city), used by the mandatory-train
 * rule: a train-less corporation must buy a train only when it can actually run.
 */
export function canRunRoute(s: GameState, corp: CorporationState): boolean {
  const tokenCities = corp.tokenHexes.filter((h) => isCity(s, h));
  for (const anchor of tokenCities) {
    const r = bestRouteFrom(s, anchor, 2, new Set(), new Set());
    if (r && r.route.revenue > 0) return true;
  }
  return false;
}

/** Distinct colours assigned to a corporation's trains, in train order. */
export const TRAIN_ROUTE_COLORS = ['#39b3ff', '#ff5da2', '#ffd23f', '#7cf06b', '#b07cff', '#ff9442'];

/**
 * Build the best simple route that visits the given ordered stop hexes (each a
 * city/town/offboard the player clicked), for a train of `maxStops`, avoiding the
 * already-used track in `usedSegs`/`usedLinks`. Returns null if the stops are not
 * connectable in order under the train's reach. Used by manual route assignment.
 */
export function routeThroughStops(
  s: GameState,
  stops: string[],
  maxStops: number,
  usedSegs: Set<string> = new Set(),
  usedLinks: Set<string> = new Set()
): { route: Route; segs: Set<string>; links: Set<string> } | null {
  if (stops.length < 2 || stops.length > maxStops) return null;

  // Find a track-only path between two adjacent stops, not reusing track. Returns
  // the segment/link ids consumed (centre-to-centre), or null if unreachable.
  function connect(
    from: string,
    to: string,
    segs: Set<string>,
    links: Set<string>
  ): { segs: Set<string>; links: Set<string> } | null {
    let found: { segs: Set<string>; links: Set<string> } | null = null;
    function leave(hex: string, segs2: Set<string>, links2: Set<string>) {
      for (const seg of hexSegments(s, hex)) {
        if (seg.a !== 'c' && seg.b !== 'c') continue;
        const edge = (seg.a === 'c' ? seg.b : seg.a) as number;
        const sid = segId(hex, seg);
        if (segs2.has(sid) || usedSegs.has(sid)) continue;
        const nb = neighbor(hex, edge);
        if (!nb) continue;
        const lid = linkId(hex, edge);
        if (links2.has(lid) || usedLinks.has(lid)) continue;
        cross(nb, opposite(edge), withAdd(segs2, sid), withAdd(links2, lid));
      }
    }
    function cross(hex: string, enterEdge: number, segs2: Set<string>, links2: Set<string>) {
      if (found) return;
      for (const seg of hexSegments(s, hex)) {
        const ends = [seg.a, seg.b];
        if (!ends.includes(enterEdge)) continue;
        const other = (seg.a === enterEdge ? seg.b : seg.a) as End;
        const sid = segId(hex, seg);
        if (segs2.has(sid) || usedSegs.has(sid)) continue;
        const segs3 = withAdd(segs2, sid);
        if (other === 'c') {
          if (hex === to) {
            found = { segs: segs3, links: links2 };
            return;
          }
          // reached a different centre before the target: not a direct connection
          continue;
        }
        const edge = other as number;
        const nb = neighbor(hex, edge);
        if (!nb) continue;
        const lid = linkId(hex, edge);
        if (links2.has(lid) || usedLinks.has(lid)) continue;
        cross(nb, opposite(edge), segs3, withAdd(links2, lid));
      }
    }
    leave(from, segs, links);
    return found;
  }

  const segs = new Set<string>();
  const links = new Set<string>();
  let revenue = centreRevenue(s, stops[0]);
  for (let i = 0; i < stops.length - 1; i++) {
    const link = connect(stops[i], stops[i + 1], segs, links);
    if (!link) return null;
    link.segs.forEach((x) => segs.add(x));
    link.links.forEach((x) => links.add(x));
    revenue += centreRevenue(s, stops[i + 1]);
  }
  return { route: { hexes: [...stops], revenue, segs: [...segs] }, segs, links };
}
