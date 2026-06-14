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
 *
 * Map and train data come from the title config (by `state.title`).
 */

import { configFor, rolaAbility } from './registry';
import { hexesFor } from './board';
import { neighbor } from './track';
import { TILES, rotatePaths, type TileEnd } from './tiles';
import { GameError, type CorporationState, type GameState } from './types';
import type { HexDef, TrainDef } from '$lib/data/types';

const opposite = (e: number) => (e + 3) % 6;

/** Local-routes rule on for this game (per-game flag, else the title default). */
function localRoutesOn(s: GameState): boolean {
  return s.localRoutes ?? configFor(s.title).localRoutes ?? false;
}

/** Max revenue centres a train may visit (the diesel is effectively unlimited). */
function trainMaxStops(trains: TrainDef[], name: string): number {
  const d = trains.find((x) => x.name === name)?.distance ?? 2;
  return d > 90 ? 99 : d;
}
/** Whether a train scores the diesel offboard tier. */
function isDiesel(trains: TrainDef[], name: string): boolean {
  return (trains.find((t) => t.name === name)?.distance ?? 0) > 90;
}

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
  const base = hexesFor(s)[hex];
  if (!base) return [];
  return base.paths.map((p) => ({ a: p.a === 'center' ? 'c' : p.a, b: p.b === 'center' ? 'c' : p.b }));
}

/**
 * Offboard revenue for the current phase, mirroring the reference
 * `route_base_revenue`: a diesel train scores the `diesel` value; otherwise scan
 * the phase's tile colours from highest to lowest and take the first that the
 * offboard defines. In 1889 green has no offboard key, so phases 2-4 fall to the
 * yellow value, phases 5-6 to brown, and only a D-train scores diesel.
 */
function offboardRevenue(s: GameState, revenue: Record<string, number>, diesel: boolean): number {
  if (diesel && revenue.diesel !== undefined) return revenue.diesel;
  const tiles = configFor(s.title).phases.find((p) => p.name === s.phase)?.tiles ?? ['yellow'];
  for (let i = tiles.length - 1; i >= 0; i--) {
    const v = revenue[tiles[i]];
    if (v !== undefined) return v;
  }
  return Object.values(revenue)[0] ?? 0;
}

/**
 * Revenue of a hex's centre for the current phase (0 if it is not a stop).
 * `diesel` selects the diesel offboard tier (set when a D-train runs the route).
 */
function centreRevenue(s: GameState, hex: string, diesel = false, corp?: CorporationState): number {
  // Suburban: +bonus for each of the running company's trains through a suburb.
  const suburb = corp && s.suburbs?.[hex] === corp.sym ? 10 : 0;
  return baseCentreRevenue(s, hex, diesel) + suburb;
}
function baseCentreRevenue(s: GameState, hex: string, diesel = false): number {
  const laid = s.tiles?.[hex];
  if (laid) {
    const def = TILES[laid.id];
    if (def.cities || def.towns) return def.revenue;
  }
  const base = hexesFor(s)[hex];
  if (!base) return 0;
  if (base.offboard) return offboardRevenue(s, base.offboard.revenue, diesel);
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
  const base = hexesFor(s)[hex];
  return !!base && (base.cities.length > 0 || base.towns.length > 0 || !!base.offboard);
}

function isCity(s: GameState, hex: string): boolean {
  const laid = s.tiles?.[hex];
  if (laid) return TILES[laid.id].cities > 0;
  const base = hexesFor(s)[hex];
  return !!base && (base.cities.length > 0 || !!base.offboard);
}

/** Number of station-token slots in the city at `hex` (0 if not a slotted city). */
function citySlots(s: GameState, hex: string): number {
  const laid = s.tiles?.[hex];
  if (laid) return TILES[laid.id]?.slots ?? 0;
  return hexesFor(s)[hex]?.cities?.[0]?.slots ?? 0;
}

/** How many corporations currently have a station token in `hex`. */
function tokenCount(s: GameState, hex: string): number {
  return s.corporations.filter((c) => c.tokenHexes.includes(hex)).length;
}

/**
 * Token blocking: a city whose token slots are all filled by OTHER corporations
 * blocks `corp` from tracing a train THROUGH it. The corporation's own token
 * always grants passage; a city with a free slot never blocks; towns and
 * offboards have no slots and never block. A blocked city may still be used as a
 * route endpoint (the train terminates there) - this only prevents passing
 * through, which callers enforce by not extending a route past it.
 */
function blocksThrough(s: GameState, corp: CorporationState, hex: string): boolean {
  const slots = citySlots(s, hex);
  if (slots <= 0) return false;
  if (corp.tokenHexes.includes(hex)) return false;
  return tokenCount(s, hex) >= slots;
}

const segId = (hex: string, seg: Seg) => {
  const a = String(seg.a);
  const b = String(seg.b);
  return `${hex}|${[a, b].sort().join('-')}`;
};
const linkId = (hexes: Record<string, HexDef>, hex: string, e: number) => {
  const nb = neighbor(hexes, hex, e)!;
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
  usedLinks: Set<string>,
  corp: CorporationState,
  diesel = false
): { route: Route; segs: Set<string>; links: Set<string> } | null {
  const hexes = hexesFor(s);
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
    // Token blocking: a city full of other corporations' tokens may be a route
    // endpoint (recorded above) but cannot be passed through, so stop extending.
    // (Overnight glides arrive here WITHOUT the hex counted as a stop, and may
    // keep going - skipped blocked cities count nothing and earn nothing.)
    if (hex !== start && blocksThrough(s, corp, hex) && stops[stops.length - 1] === hex) return;

    // From the centre, take any segment touching 'c' to reach an edge.
    for (const seg of hexSegments(s, hex)) {
      const fromCentre = seg.a === 'c' || seg.b === 'c';
      if (!fromCentre) continue;
      const edge = (seg.a === 'c' ? seg.b : seg.a) as number;
      const sid = segId(hex, seg);
      if (segs.has(sid) || usedSegs.has(sid)) continue;
      const nb = neighbor(hexes, hex, edge);
      if (!nb) continue;
      const lid = linkId(hexes, hex, edge);
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
        const rev = centreRevenue(s, hex, diesel, corp);
        if (rev <= 0 && !hasCentre(s, hex)) continue;
        walk(hex, [...stops, hex], revenue + rev, segs2, links);
        // Overnight: may instead skip a blocked city entirely (no stop, no
        // revenue) and continue tracing past it.
        if (
          blocksThrough(s, corp, hex) &&
          rolaAbility(s.title, corp, 'skip_blocked_cities')
        ) {
          walk(hex, stops, revenue, segs2, links);
        }
      } else {
        // pass through to the next hex
        const edge = other as number;
        const nb = neighbor(hexes, hex, edge);
        if (!nb) continue;
        const lid = linkId(hexes, hex, edge);
        if (links.has(lid) || usedLinks.has(lid)) continue;
        traverse(nb, opposite(edge), stops, revenue, segs2, withAdd(links, lid));
      }
    }
  }

  walk(start, [start], centreRevenue(s, start, diesel, corp), new Set(), new Set());
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
  // Resourceful: rusted trains get one final run before they are discarded.
  const roster = [...corp.trains, ...(corp.rustedTrains ?? [])];
  if (tokenCities.length === 0 || roster.length === 0) return { routes: [], revenue: 0 };

  const trainDefs = configFor(s.title).trains;
  const trains = [...roster].sort((a, b) => trainMaxStops(trainDefs, b) - trainMaxStops(trainDefs, a));
  // Express: +1 stop while the company owns a single train.
  const expressBoost = roster.length === 1 && rolaAbility(s.title, corp, 'boost_stop_if_single_train') ? 1 : 0;

  const usedSegs = new Set<string>();
  const usedLinks = new Set<string>();
  const routes: Route[] = [];
  let revenue = 0;

  for (const train of trains) {
    const maxStops = trainMaxStops(trainDefs, train) + expressBoost;
    const diesel = isDiesel(trainDefs, train);
    let pick: { route: Route; segs: Set<string>; links: Set<string> } | null = null;
    for (const anchor of tokenCities) {
      const r = bestRouteFrom(s, anchor, maxStops, usedSegs, usedLinks, corp, diesel);
      if (r && (!pick || r.route.revenue > pick.route.revenue)) pick = r;
    }
    if (pick && pick.route.revenue > 0) {
      routes.push(pick.route);
      revenue += pick.route.revenue;
      pick.segs.forEach((x) => usedSegs.add(x));
      pick.links.forEach((x) => usedLinks.add(x));
    } else if (localRoutesOn(s)) {
      // RoLA local route: a train that cannot reach a second stop still runs a
      // single stop inside a hub city (no track used; any number per city).
      let best: Route | null = null;
      for (const hub of tokenCities) {
        const rev = centreRevenue(s, hub, diesel, corp);
        if (rev > 0 && (!best || rev > best.revenue)) best = { hexes: [hub], revenue: rev, segs: [] };
      }
      if (best) {
        routes.push(best);
        revenue += best.revenue;
      }
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
    const r = bestRouteFrom(s, anchor, 2, new Set(), new Set(), corp);
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
  usedLinks: Set<string> = new Set(),
  corp?: CorporationState,
  diesel = false
): { route: Route; segs: Set<string>; links: Set<string> } | null {
  if (stops.length === 1) {
    if (!localRoutesOn(s)) return null;
    if (!corp?.tokenHexes.includes(stops[0])) return null; // local runs stay in a hub city
    const rev = centreRevenue(s, stops[0], diesel, corp);
    return rev > 0 ? { route: { hexes: [...stops], revenue: rev, segs: [] }, segs: new Set<string>(), links: new Set<string>() } : null;
  }
  if (stops.length < 2 || stops.length > maxStops) return null;
  const hexes = hexesFor(s);
  // Token blocking: an interior stop full of other corporations' tokens cannot
  // be passed through (only route endpoints may be such a blocked city).
  if (corp) {
    for (let i = 1; i < stops.length - 1; i++) {
      if (blocksThrough(s, corp, stops[i])) return null;
    }
  }

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
        const nb = neighbor(hexes, hex, edge);
        if (!nb) continue;
        const lid = linkId(hexes, hex, edge);
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
        const nb = neighbor(hexes, hex, edge);
        if (!nb) continue;
        const lid = linkId(hexes, hex, edge);
        if (links2.has(lid) || usedLinks.has(lid)) continue;
        cross(nb, opposite(edge), segs3, withAdd(links2, lid));
      }
    }
    leave(from, segs, links);
    return found;
  }

  const segs = new Set<string>();
  const links = new Set<string>();
  let revenue = centreRevenue(s, stops[0], diesel, corp);
  for (let i = 0; i < stops.length - 1; i++) {
    const link = connect(stops[i], stops[i + 1], segs, links);
    if (!link) return null;
    link.segs.forEach((x) => segs.add(x));
    link.links.forEach((x) => links.add(x));
    revenue += centreRevenue(s, stops[i + 1], diesel, corp); // corp -> suburb bonus at every stop
  }
  return { route: { hexes: [...stops], revenue, segs: [...segs] }, segs, links };
}

/**
 * Score a player's explicitly chosen routes (one ordered stop-list per train).
 * Validates that there are no more routes than trains, each route fits a distinct
 * train (longest routes to the longest trains), routes share no track, and each
 * route includes a city the corporation has tokened. Throws on any illegal choice.
 */
export function revenueForChosenRoutes(s: GameState, corp: CorporationState, routes: string[][]): number {
  const chosen = routes.filter((r) => r.length >= 1); // 1 stop = a RoLA local route
  if (chosen.length === 0) return 0;
  const trainDefs = configFor(s.title).trains;
  const roster = [...corp.trains, ...(corp.rustedTrains ?? [])];
  const expressBoost = roster.length === 1 && rolaAbility(s.title, corp, 'boost_stop_if_single_train') ? 1 : 0;
  const trainsByReach = [...roster].sort((a, b) => trainMaxStops(trainDefs, b) - trainMaxStops(trainDefs, a));
  if (chosen.length > trainsByReach.length) throw new GameError('more routes than trains');
  const sorted = [...chosen].sort((a, b) => b.length - a.length);
  const tokenCities = new Set(corp.tokenHexes.filter((h) => isCity(s, h)));
  const usedSegs = new Set<string>();
  const usedLinks = new Set<string>();
  let total = 0;
  for (let i = 0; i < sorted.length; i++) {
    const stops = sorted[i];
    const train = trainsByReach[i];
    const maxStops = trainMaxStops(trainDefs, train) + expressBoost;
    if (stops.length > maxStops) throw new GameError(`a ${train}-train cannot reach ${stops.length} stops`);
    if (!stops.some((h) => tokenCities.has(h))) throw new GameError('each route must include a tokened city');
    const res = routeThroughStops(s, stops, maxStops, usedSegs, usedLinks, corp, isDiesel(trainDefs, train));
    if (!res) throw new GameError(`route ${stops.join('-')} is not connectable without reusing track`);
    res.segs.forEach((x) => usedSegs.add(x));
    res.links.forEach((x) => usedLinks.add(x));
    total += res.route.revenue;
  }
  return total;
}
