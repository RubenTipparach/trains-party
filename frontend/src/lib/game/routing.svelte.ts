/**
 * Manual train-route assignment for the operating round's run step.
 *
 * The engine stays the source of truth for revenue: this store only holds the
 * player's in-progress route choices (which stops each train visits) and resolves
 * them through the pure engine (`routeThroughStops`) to get the consumed track
 * segments and revenue. Both the operating panel (controls) and the hex map
 * (highlighting + click-to-add-stop) read and drive this shared state.
 *
 * Routing is presentation/intent only; nothing here mutates the action log. When
 * the player commits (pay/withhold) the OR engine recomputes revenue itself.
 */

import { corpRoutes, routeThroughStops, TRAIN_ROUTE_COLORS, type GameState, type Route } from '$lib/engine';
import { TRAINS } from '$lib/data/g1889';

export interface TrainRoute {
  train: string; // train name, e.g. "3"
  color: string;
  stops: string[]; // ordered revenue-centre hexes the player has chosen
  route: Route | null; // resolved route (null until >= 2 connectable stops)
  revenue: number;
}

function trainDistance(name: string): number {
  const d = TRAINS.find((t) => t.name === name)?.distance ?? 2;
  return d > 90 ? 99 : d;
}

export interface AnimRoute {
  color: string;
  hexes: string[];
  revenue: number;
}

class Routing {
  /** Per-train routes for the corporation currently operating. */
  trains = $state<TrainRoute[]>([]);
  /**
   * Routes captured at pay/withhold time, coloured per train, for the run
   * animation to consume. Survives `clear()` (the run step ends before the
   * animation plays). Empty array => the animator falls back to the auto routes.
   */
  pending = $state<AnimRoute[]>([]);
  /** Index into `trains` that is "armed" to receive the next clicked stop. */
  armed = $state(0);
  /** True once auto-calculate or any manual edit has produced routes. */
  active = $state(false);
  /**
   * True once the player has hand-edited stops (not just auto-calculated). The
   * run action only sends explicit routes when manual, so auto-calculate keeps
   * the engine's own best-route computation as the authoritative result.
   */
  manual = $state(false);
  private corp = '';

  /** Total revenue across all assigned trains. */
  get revenue(): number {
    return this.trains.reduce((n, t) => n + t.revenue, 0);
  }

  /** All track-segment ids highlighted, mapped to their train colour. */
  segColors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const t of this.trains) {
      if (!t.route?.segs) continue;
      for (const sid of t.route.segs) out[sid] = t.color;
    }
    return out;
  }

  /** Begin (or reset) routing for a corporation's trains. */
  begin(corpSym: string, trainNames: string[]) {
    this.corp = corpSym;
    this.trains = trainNames.map((train, i) => ({
      train,
      color: TRAIN_ROUTE_COLORS[i % TRAIN_ROUTE_COLORS.length],
      stops: [],
      route: null,
      revenue: 0
    }));
    this.armed = 0;
    this.active = false;
    this.manual = false;
  }

  /** The player's chosen stop-lists per train (resolved routes), for the run action. */
  chosenRoutes(): string[][] {
    return this.trains.filter((t) => t.route).map((t) => [...t.stops]);
  }

  /**
   * Snapshot the currently-resolved routes (with colours) for the run animation,
   * to be called just before committing pay/withhold. Returns true if any route
   * was captured (so the caller knows whether to rely on the auto fallback).
   */
  capture(): boolean {
    this.pending = this.trains
      .filter((t) => t.route && t.route.hexes.length >= 1)
      .map((t) => ({ color: t.color, hexes: [...t.route!.hexes], revenue: t.revenue }));
    return this.pending.length > 0;
  }

  /** Consume the captured animation routes (clears them). */
  takePending(): AnimRoute[] {
    const p = this.pending;
    this.pending = [];
    return p;
  }

  /** Clear everything (e.g. on leaving the run step). Keeps `pending` intact. */
  clear() {
    this.trains = [];
    this.armed = 0;
    this.active = false;
    this.corp = '';
  }

  isForCorp(corpSym: string): boolean {
    return this.corp === corpSym && this.trains.length > 0;
  }

  arm(i: number) {
    if (i >= 0 && i < this.trains.length) this.armed = i;
  }

  /** Re-resolve every train's route from its stops, respecting earlier trains. */
  private recompute(s: GameState) {
    const usedSegs = new Set<string>();
    const usedLinks = new Set<string>();
    const corp = s.corporations.find((x) => x.sym === this.corp);
    for (const t of this.trains) {
      t.route = null;
      t.revenue = 0;
      if (t.stops.length < 1) continue;
      // 1 stop = a RoLA local route (a single hub city, no track); 2+ = a normal
      // route. routeThroughStops resolves both.
      const res = routeThroughStops(s, t.stops, trainDistance(t.train), usedSegs, usedLinks, corp);
      if (res) {
        t.route = res.route;
        t.revenue = res.route.revenue;
        res.segs.forEach((x) => usedSegs.add(x));
        res.links.forEach((x) => usedLinks.add(x));
      }
    }
    this.trains = [...this.trains]; // poke reactivity
  }

  /** Player clicked a revenue centre: add/remove it from the armed train's route. */
  toggleStop(s: GameState, hex: string) {
    const t = this.trains[this.armed];
    if (!t) return;
    this.active = true;
    this.manual = true;
    const at = t.stops.indexOf(hex);
    if (at !== -1) t.stops.splice(at, 1);
    else t.stops.push(hex);
    this.recompute(s);
  }

  /** Auto-calculate the best routes from the engine and load them in. */
  auto(s: GameState, corpSym: string) {
    const c = s.corporations.find((x) => x.sym === corpSym);
    if (!c) return;
    const { routes } = corpRoutes(s, c);
    // Match engine routes (longest-train-first) to our train chips in the same order.
    const order = [...this.trains].sort((a, b) => trainDistance(b.train) - trainDistance(a.train));
    order.forEach((t, i) => {
      const r = routes[i];
      t.stops = r ? [...r.hexes] : [];
    });
    this.active = true;
    this.manual = false; // auto routes defer to the engine's own best-route calc
    this.recompute(s);
  }
}

export const routing = new Routing();
