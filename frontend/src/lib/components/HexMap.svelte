<script lang="ts">
  import { onMount } from 'svelte';
  import { tweened } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import type { HexDef, PathPart, TileColor } from '$lib/data/types';
  import { HEX_SIZE, APOTHEM, hexCenter, hexPolygon, edgeMidpoint } from '$lib/hexgeo';
  import { mapView } from '$lib/config/mapView';
  import { WATER_BASE, WATER_STATIC, WATER_FRAMES, TILE_W, TILE_H } from '$lib/config/waterArt';
  import { game } from '$lib/game/sandbox.svelte';
  import { highlight } from '$lib/game/highlight.svelte';
  import { anim } from '$lib/game/anim.svelte';
  import { routing } from '$lib/game/routing.svelte';
  import { locate } from '$lib/game/locate.svelte';
  import { TILES, rotatePaths, trackLays, tokenPlays, corpRoutes, routeThroughStops, tileSupply, exhaustedTilesOnHex, configFor, placementCoords, isLegalPlacement } from '$lib/engine';
  import TileGraphic from './TileGraphic.svelte';

  // The active board: a procedurally-built RoLA runtime map (state.map), or the
  // title's static map. Hex structure is stable for a game, captured on mount.
  const activeMap = $derived(game.state.map ?? configFor(game.title).hexByCoord);
  const HEX_LIST = $derived(Object.values(activeMap));

  // Animate tiles added to the map (by you, other players, or bots): flag newly
  // appeared hexes so they get a brief "land" entrance.
  let recentlyPlaced = $state(new Set<string>());
  let knownHexes = new Set<string>();
  $effect(() => {
    const keys = visiblePlaced.map((p) => p.coord);
    if (knownHexes.size === 0) {
      knownHexes = new Set(keys);
      return;
    }
    const added = keys.filter((k) => !knownHexes.has(k));
    if (added.length) {
      knownHexes = new Set(keys);
      const mark = new Set(added);
      recentlyPlaced = mark;
      setTimeout(() => {
        if (recentlyPlaced === mark) recentlyPlaced = new Set();
      }, 650);
    }
  });

  // RoLA Manual map-build: click anywhere on the grid to position the next tile;
  // a green outline = legal, red = illegal. When green, confirm to lay it.
  const building = $derived(game.state.round === 'mapbuild');
  const canBuild = $derived(building && !!game.active && !game.isBot(game.active) && !game.reviewing);
  // The next tile's three cells (so the preview shows what is actually being placed).
  const nextCells = $derived(game.state.mapBuild?.pool[0]?.cells ?? null);

  let selectedAnchor = $state<string | null>(null);
  let hoveredHex = $state<string | null>(null); // hex under the cursor (build target highlight)
  let spin = $state(0); // cumulative 60-degree steps, so rotation animates smoothly
  const selectedRotation = $derived(((spin % 6) + 6) % 6);
  const selectedLegal = $derived(
    !!selectedAnchor && isLegalPlacement(activeMap, selectedAnchor, selectedRotation)
  );
  // Tweened spin angle (degrees) so the tri-hex rotates smoothly to each orientation.
  const spinAngle = tweened(0, { duration: 240, easing: cubicOut });
  // Tweened slide offset (SVG units): the tile glides in from the side when it
  // spawns and slides to the new spot when you move it (< 0.5s, friendly).
  const slide = tweened({ x: 0, y: 0 }, { duration: 150, easing: cubicOut });
  /** Nearest valid (even-parity) hex to an SVG point - lets you click the open grid. */
  function hexAt(x: number, y: number): string {
    const colF = x / (1.5 * HEX_SIZE);
    const rowF = y / APOTHEM + 1;
    let best = '';
    let bestD = Infinity;
    for (let col = Math.floor(colF) - 1; col <= Math.ceil(colF) + 1; col++) {
      if (col < 0) continue;
      for (let row = Math.floor(rowF) - 2; row <= Math.ceil(rowF) + 2; row++) {
        if (row < 1 || (col + row) % 2 !== 0) continue;
        const d = (col * 1.5 * HEX_SIZE - x) ** 2 + ((row - 1) * APOTHEM - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = String.fromCharCode(65 + col) + row;
        }
      }
    }
    return best;
  }
  function selectAnchor(anchor: string) {
    const to = hexCenter(anchor);
    // Glide from the previous spot, or in from the left when a tile first spawns.
    const from = selectedAnchor ? hexCenter(selectedAnchor) : { x: to.x - view.w * 0.55, y: to.y };
    selectedAnchor = anchor;
    // Keep the current orientation - only the rotate button changes it (spinAngle
    // already tracks `spin`, so moving never re-rotates the tile).
    slide.set({ x: from.x - to.x, y: from.y - to.y }, { duration: 0 });
    slide.set({ x: 0, y: 0 }); // animate to the target
  }
  function rotateSel() {
    if (!selectedAnchor) return;
    spin += 1; // next 60-degree orientation
    spinAngle.set(spin * 60);
  }
  function placeTri(anchor: string, rotation: number) {
    if (game.active) game.act({ type: 'place_tri', player: game.active, anchor, rotation });
    selectedAnchor = null;
  }
  const confirmBuild = () => {
    if (selectedAnchor && selectedLegal) placeTri(selectedAnchor, selectedRotation);
  };
  const cancelBuild = () => (selectedAnchor = null);
  // Screen position of the selected anchor (for the floating rotate/place controls).
  let buildPos = $derived.by(() => {
    void view;
    if (!selectedAnchor || !svgEl || !wrap) return { x: 0, y: 0 };
    const c = mapToView(hexCenter(selectedAnchor));
    const r = svgEl.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    return {
      x: ((c.x - view.x) / view.w) * r.width + (r.left - w.left),
      y: ((c.y - view.y) / view.h) * r.height + (r.top - w.top)
    };
  });

  // Optional: when in the operating-round track step, hexes that can receive a
  // tile are highlighted and clickable. In the token step, tokenable cities are
  // highlighted instead.
  let {
    layMode = false,
    tokenMode = false,
    runMode = false,
    fill = false,
    paused = false,
    liftControls = false,
    pickHexes = [],
    onpick
  }: {
    layMode?: boolean;
    tokenMode?: boolean;
    runMode?: boolean;
    fill?: boolean;
    paused?: boolean;
    liftControls?: boolean;
    /** "Choose a space" mode: these hexes glow and clicking one calls onpick. */
    pickHexes?: string[];
    onpick?: (hex: string) => void;
  } = $props();
  const pickSet = $derived(new Set(pickHexes));
  // Spotlight hexes hovered in the Tiles panel (map-generation inspection).
  const spotlight = $derived(new Set(highlight.hexes));
  const lays = $derived(layMode ? trackLays(game.state) : []);
  const layHexes = $derived(new Set(lays.map((l) => l.hex)));
  const tokenHexes = $derived(tokenMode ? new Set(tokenPlays(game.state).map((t) => t.hex)) : new Set<string>());
  // Track-segment -> train colour map for route highlighting during the run step.
  const routeSegColors = $derived(runMode ? routing.segColors() : {});
  // Coloured stripes for the routes being animated (held during the run animation).
  let animSegColors = $state<Record<string, string>>({});
  /** Colour to tint a hex's segment (a,b ends) if it is on an assigned/animating route. */
  function segColor(hex: string, a: PathPart['a'], b: PathPart['b']): string | null {
    const ka = a === 'center' ? 'c' : String(a);
    const kb = b === 'center' ? 'c' : String(b);
    const id = `${hex}|${[ka, kb].sort().join('-')}`;
    return animSegColors[id] ?? routeSegColors[id] ?? null;
  }
  /** Whether route stripes should be drawn at all (assigning, or animating a run). */
  const showRoutes = $derived(runMode || Object.keys(animSegColors).length > 0);
  /** Is this hex a revenue centre (city / town / offboard) the player can route through? */
  function isStopHex(hex: string): boolean {
    const t = game.state.tiles?.[hex];
    if (t) {
      const def = TILES[t.id];
      return def.cities > 0 || def.towns > 0;
    }
    const base = activeMap[hex];
    return !!base && (base.cities.length > 0 || base.towns.length > 0 || !!base.offboard);
  }
  function placeToken(hex: string) {
    const v = game.state.or;
    if (!v) return;
    game.act({ type: 'place_token', player: game.active!, corp: v.order[v.index], hex });
  }
  function layOptions(hex: string) {
    return lays.filter((l) => l.hex === hex);
  }
  /** Distinct tile ids available on a hex. */
  function tileChoices(hex: string): string[] {
    return [...new Set(layOptions(hex).map((l) => l.tile))];
  }
  /** Tiles that fit this hex but are out of supply (shown greyed, "0 left"). */
  function exhaustedChoices(hex: string): string[] {
    return exhaustedTilesOnHex($state.snapshot(game.state) as typeof game.state, hex);
  }
  /**
   * Fan entries: every selectable tile (available), then every fitting-but-
   * exhausted tile, each tagged with how many copies remain in the depot.
   */
  function fanEntries(hex: string): { tile: string; left: number; available: boolean }[] {
    const snap = $state.snapshot(game.state) as typeof game.state;
    const avail = tileChoices(hex).map((tile) => ({ tile, left: tileSupply(snap, tile), available: true }));
    const out = exhaustedChoices(hex).map((tile) => ({ tile, left: 0, available: false }));
    return [...avail, ...out];
  }
  /** Valid rotations of a tile on a hex (sorted). */
  function rotationsFor(hex: string, tile: string): number[] {
    return layOptions(hex)
      .filter((l) => l.tile === tile)
      .map((l) => l.rotation)
      .sort((a, b) => a - b);
  }

  // Lay interaction state machine:
  //   pick a highlighted hex -> fan of candidate tiles -> preview (tap to rotate) -> confirm.
  let layHex = $state<string | null>(null); // hex being laid on (fan shown)
  let preview = $state<{ tile: string; rotations: number[]; idx: number } | null>(null);

  function clickLayHex(hex: string) {
    if (layOptions(hex).length === 0) return;
    layHex = hex;
    preview = null;
    centerOn(hex); // pan so the hex (and its fan of options) is centred and fully visible
    const choices = tileChoices(hex);
    if (choices.length === 1) pickTile(choices[0]); // single tile type -> straight to preview
  }
  function pickTile(tile: string) {
    if (!layHex) return;
    preview = { tile, rotations: rotationsFor(layHex, tile), idx: 0 };
  }
  function rotatePreview() {
    if (preview) preview = { ...preview, idx: (preview.idx + 1) % preview.rotations.length };
  }
  // Direction the tile fan splays in, in radians. It normally points up (-90deg),
  // but near a map edge it tilts toward the interior so options never land off
  // the canvas (which previously hid tiles on top-row hexes such as Matsuyama E2).
  function fanBaseAngle(hex: string): number {
    const c = hexCenter(hex);
    const reach = HEX_SIZE * 4; // how far the fan extends from the hex centre
    let ang = -Math.PI / 2; // default: up
    if (c.y - reach < minY) ang = Math.PI / 2; // too close to the top -> fan down
    else if (c.y + reach > minY + height) ang = -Math.PI / 2; // bottom -> fan up
    // Nudge horizontally away from a side edge so the spread stays on-canvas.
    if (c.x - reach < minX) ang += Math.PI / 5; // left edge -> lean right
    else if (c.x + reach > minX + width) ang -= Math.PI / 5; // right edge -> lean left
    return ang;
  }
  function confirmLay() {
    if (!layHex || !preview) return;
    const v = game.state.or!;
    game.act({
      type: 'lay_tile',
      player: game.active!,
      corp: v.order[v.index],
      hex: layHex,
      tile: preview.tile,
      rotation: preview.rotations[preview.idx]
    });
    cancelLay();
  }
  function cancelLay() {
    layHex = null;
    preview = null;
  }
  // Cancel any in-progress lay when it is no longer the track step.
  $effect(() => {
    if (!layMode && (layHex || preview)) cancelLay();
  });
  // Screen position (relative to the wrapper) of the lay hex centre, for the
  // HTML fan/controls overlay. Recomputes when the view (pan/zoom) or hex changes.
  let fanPos = $derived.by(() => {
    void view; // track pan/zoom
    if (!layHex || !svgEl || !wrap) return { x: 0, y: 0 };
    const c = mapToView(hexCenter(layHex));
    const r = svgEl.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    return {
      x: ((c.x - view.x) / view.w) * r.width + (r.left - w.left),
      y: ((c.y - view.y) / view.h) * r.height + (r.top - w.top)
    };
  });

  // Laid tiles (track placed during operating rounds).
  const laid = (coord: string) => game.state.tiles?.[coord];
  const laidDef = (coord: string) => {
    const t = laid(coord);
    return t ? TILES[t.id] : null;
  };
  function tilePaths(id: string, rotation: number): PathPart[] {
    return rotatePaths(TILES[id], rotation).map((p) => ({
      a: p.a === 'c' ? ('center' as const) : p.a,
      b: p.b === 'c' ? ('center' as const) : p.b
    }));
  }
  function laidPaths(coord: string): PathPart[] {
    const t = laid(coord);
    if (!t) return [];
    return tilePaths(t.id, t.rotation);
  }

  // --- train run animation -------------------------------------------------
  // When a corporation pays a dividend, drive a top-down train (a locomotive
  // pulling a couple of cars) smoothly along its best route: it emerges from a
  // tunnel portal at the origin, makes each city glow as it passes, pops a coin
  // for that city's revenue, then slides into a tunnel at the destination.
  type Body = { x: number; y: number; angle: number; opacity: number };
  let train = $state<{ cars: Body[]; color: string } | null>(null);
  // Tunnel portals at the origin and destination of the current route.
  let portals = $state<{ x: number; y: number; angle: number }[]>([]);
  // City glow pulses fired as the train reaches each revenue centre.
  let glows = $state<{ id: number; x: number; y: number; color: string }[]>([]);
  let coins = $state<{ id: number; x: number; y: number; val: number; color: string }[]>([]);
  let coinId = 0;
  let glowId = 0;
  let raf = 0;
  let lastLogLen = 0;

  const BODIES = 3; // locomotive + two cars
  const CAR_GAP = 14; // path distance between consecutive bodies
  const SPEED = 165; // px per second along the route

  /** Cumulative arc-length at each polyline point. */
  function arcTable(pts: { x: number; y: number }[]): number[] {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dy = pts[i].y - pts[i - 1].y;
      cum[i] = cum[i - 1] + Math.hypot(dx, dy);
    }
    return cum;
  }

  /** Position + heading at arc-length `s` along the polyline. */
  function sampleAt(pts: { x: number; y: number }[], cum: number[], s: number) {
    const total = cum[cum.length - 1];
    s = Math.max(0, Math.min(total, s));
    let k = 0;
    while (k < cum.length - 2 && cum[k + 1] < s) k++;
    const segLen = cum[k + 1] - cum[k] || 1;
    const t = (s - cum[k]) / segLen;
    const a = pts[k];
    const b = pts[k + 1];
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
    };
  }

  /** Animate one route; resolves true when finished, false if skipped. */
  function animateRoute(
    pts: { x: number; y: number }[],
    stopRev: number[],
    color: string
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const cum = arcTable(pts);
      const total = cum[cum.length - 1];
      const emerge = Math.min(16, total * 0.34); // tunnel fade-in/out distance
      const trail = (BODIES - 1) * CAR_GAP;
      const sMax = total + trail; // run on until the last car enters the tunnel
      const dur = Math.max(800, (sMax / SPEED) * 1000);
      const tok = anim.token;
      anim.begin();

      // Tunnel portals: mouths open along the direction of travel.
      portals = [sampleAt(pts, cum, 0), sampleAt(pts, cum, total)];
      const fired = new Array(pts.length).fill(false);
      const start = performance.now();

      const cleanup = () => {
        cancelAnimationFrame(raf);
        raf = 0;
        train = null;
        portals = [];
      };

      const fade = (s: number) =>
        Math.max(0, Math.min(1, s / emerge)) * Math.max(0, Math.min(1, (total - s) / emerge));

      const frame = (now: number) => {
        if (anim.token !== tok) {
          cleanup();
          anim.end(tok); // already-skipped is a no-op, but keep the flag in sync
          resolve(false);
          return; // skipped
        }
        const t = Math.min(1, (now - start) / dur);
        const head = t * sMax;
        const cars: Body[] = [];
        for (let i = 0; i < BODIES; i++) {
          const s = head - i * CAR_GAP;
          const p = sampleAt(pts, cum, s);
          cars.push({ ...p, opacity: fade(s) });
        }
        train = { cars, color };
        // Glow + coin as the locomotive reaches each revenue centre.
        for (let i = 0; i < pts.length; i++) {
          if (!fired[i] && head >= cum[i]) {
            fired[i] = true;
            const gid = ++glowId;
            glows = [...glows, { id: gid, x: pts[i].x, y: pts[i].y, color }];
            setTimeout(() => (glows = glows.filter((g) => g.id !== gid)), 1200);
            const val = stopRev[i] || 0;
            if (val > 0) {
              const id = ++coinId;
              coins = [...coins, { id, x: pts[i].x, y: pts[i].y, val, color }];
              setTimeout(() => (coins = coins.filter((x) => x.id !== id)), 1100);
            }
          }
        }
        if (t >= 1) {
          cleanup();
          anim.end(tok); // clear the pacing flag so the Skip button hides
          resolve(true);
          return;
        }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    });
  }

  async function runTrain(corpSym: string) {
    const snap = $state.snapshot(game.state) as typeof game.state;
    const c = snap.corporations.find((x) => x.sym === corpSym);
    if (!c) return;
    // Prefer the player's assigned (coloured) routes; fall back to the auto best.
    const pending = routing.takePending();
    const routes =
      pending.length > 0
        ? pending
        : corpRoutes(snap, c).routes.map((r, i) => ({
            color: ['#39b3ff', '#ff5da2', '#ffd23f', '#7cf06b', '#b07cff', '#ff9442'][i % 6],
            hexes: r.hexes,
            revenue: r.revenue
          }));

    // Pre-colour every animated route's track so the trail is visible throughout.
    const segs: Record<string, string> = {};
    for (const route of routes) {
      const res = routeThroughStops(snap, route.hexes, 99, new Set(), new Set(), c);
      if (res?.route.segs) for (const sid of res.route.segs) segs[sid] = route.color;
    }
    animSegColors = segs;

    // Run each of the corporation's trains along its route in turn.
    for (const route of routes) {
      if (route.hexes.length < 2) continue;
      const pts = route.hexes.map((h) => hexCenter(h));
      const stopRev = route.hexes.map((h) => stopRevenue(snap, h));
      if (!(await animateRoute(pts, stopRev, route.color))) {
        animSegColors = {};
        return; // skipped
      }
    }
    animSegColors = {};
  }

  /** Revenue of a single revenue centre hex under its current tile / base. */
  function stopRevenue(s: typeof game.state, hex: string): number {
    const t = s.tiles?.[hex];
    if (t) {
      const def = TILES[t.id];
      if (def.cities || def.towns) return def.revenue;
    }
    const base = activeMap[hex];
    if (!base) return 0;
    if (base.offboard) {
      const tier = s.phase === '2' || s.phase === '3' ? 'yellow' : s.phase === '4' || s.phase === '5' ? 'brown' : 'diesel';
      return base.offboard.revenue[tier] ?? Object.values(base.offboard.revenue)[0] ?? 0;
    }
    if (base.cities.length) return base.cities[0].revenue;
    if (base.towns.length) return base.towns[0].revenue;
    return 0;
  }

  $effect(() => {
    const log = game.state.log;
    if (lastLogLen === 0) {
      lastLogLen = log.length;
      return;
    }
    const added = log.slice(lastLogLen);
    lastLogLen = log.length;
    if (!anim.on) {
      routing.takePending(); // discard captured routes if animations are off
      return;
    }
    // The train runs whether the dividend is paid or withheld; animate either.
    const ran = added.find((l) => / runs for .* and (pays a dividend|withholds)/.test(l));
    if (ran) {
      const v = game.state.or;
      if (v) runTrain(v.order[v.index]);
      else routing.takePending();
    }
  });

  // --- tile fly-in animation -----------------------------------------------
  // When a new tile appears in state, fly a copy from a side "pool" onto the hex.
  let flying = $state<{ id: string; rotation: number; from: { x: number; y: number }; to: { x: number; y: number }; on: boolean } | null>(null);
  let known = new Set<string>();
  $effect(() => {
    const tiles = game.state.tiles ?? {};
    const coords = Object.keys(tiles);
    if (known.size === 0) {
      known = new Set(coords);
      return;
    }
    const fresh = coords.find((c) => !known.has(c));
    known = new Set(coords);
    if (fresh && anim.on) {
      const to = hexCenter(fresh);
      const from = { x: minX + 30, y: minY + 30 }; // the tile pool corner
      flying = { id: tiles[fresh].id, rotation: tiles[fresh].rotation, from, to, on: false };
      requestAnimationFrame(() => requestAnimationFrame(() => (flying && (flying = { ...flying, on: true }))));
      setTimeout(() => (flying = null), 650);
    }
  });

  // Flat palette echoing the published 1889 board (no per-tile 3D shading).
  const FILL: Record<TileColor, string> = {
    white: '#cdcb92',
    yellow: '#f3cf3e',
    green: '#7cc36b',
    brown: '#c69b66',
    gray: '#aeb7bb',
    red: '#df6a5c',
    blue: '#86c5e0'
  };
  // RoLA's third era renders as purple (the engine stores it in the brown slot).
  const tfill = (c: TileColor) => (game.title === 'rola' && c === 'brown' ? '#9b6fb0' : FILL[c]);
  const fanFill = (tile: string) => tfill(TILES[tile]?.color ?? 'yellow');

  // --- deterministic RNG for procedural city skylines ----------------------
  // A plain, unbuilt land hex (no city/town/terrain/off-board and not yet laid):
  // these get the Catan-style grass / sand ground texture.
  const isPlainLand = (h: Placed) =>
    h.color === 'white' && h.cities.length === 0 && h.towns.length === 0 && !h.terrain && !h.offboard && !laid(h.coord);
  /** Grass tufts scattered over an inland land hex (deterministic per coord). */
  function grassTufts(coord: string): Array<{ x: number; y: number; s: number }> {
    const r = rngFor(coord + 'g');
    const n = 7;
    const out = [];
    for (let i = 0; i < n; i++) {
      const ang = r() * Math.PI * 2;
      const dist = Math.sqrt(r()) * (APOTHEM - 8);
      out.push({ x: Math.cos(ang) * dist, y: Math.sin(ang) * dist - 1, s: 2.6 + r() * 1.8 });
    }
    return out;
  }
  /** Sand speckle + dune lines for a coastal land hex (deterministic per coord). */
  function sandDots(coord: string): Array<{ x: number; y: number; r: number }> {
    const r = rngFor(coord + 's');
    const out = [];
    for (let i = 0; i < 9; i++) {
      const ang = r() * Math.PI * 2;
      const dist = Math.sqrt(r()) * (APOTHEM - 6);
      out.push({ x: Math.cos(ang) * dist, y: Math.sin(ang) * dist, r: 0.7 + r() * 0.9 });
    }
    return out;
  }
  function rngFor(seed: string): () => number {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    let a = h >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  type Bldg = { x: number; w: number; h: number; lit: boolean };
  function skyline(coord: string): Bldg[] {
    const r = rngFor(coord);
    const n = 4 + Math.floor(r() * 3);
    const out: Bldg[] = [];
    let x = -11;
    for (let i = 0; i < n && x < 10; i++) {
      const w = 2.4 + r() * 2.4;
      const h = 4 + r() * 8;
      out.push({ x, w, h, lit: r() > 0.5 });
      x += w + 0.8 + r() * 1.2;
    }
    return out;
  }
  // A little mountain range, back-to-front: two flanking peaks then a taller
  // central one drawn on top, so they read as an overlapping ridge.
  function peaks(coord: string): Array<{ x: number; s: number }> {
    const r = rngFor(coord + 'm');
    return [
      { x: -17 + r() * 2, s: 9 + r() * 3 }, // left (back)
      { x: 3 + r() * 4, s: 9 + r() * 3 }, // right (back)
      { x: -9 + r() * 3, s: 14 + r() * 4 } // centre (front)
    ];
  }

  const HOVER: Record<TileColor, string> = {
    white: '#dad873',
    yellow: '#ffe24a',
    green: '#8fe673',
    brown: '#e3ad6f',
    gray: '#c8d2d8',
    red: '#ff7c6d',
    blue: '#a6d8f0'
  };
  const thover = (c: TileColor) => (game.title === 'rola' && c === 'brown' ? '#b98fce' : HOVER[c]);

  function labelPos(h: HexDef): { x: number; y: number } {
    const used = new Set<number>();
    for (const p of h.paths) {
      if (typeof p.a === 'number') used.add(p.a);
      if (typeof p.b === 'number') used.add(p.b);
    }
    const e = [3, 0, 4, 1, 5, 2].find((d) => !used.has(d)) ?? 3;
    const m = edgeMidpoint(0, 0, e);
    return { x: m.x * 0.58, y: m.y * 0.58 };
  }


  const HOME = $derived(new Map(game.state.corporations.map((c) => [c.coordinates, c])));
  // Reserved home spots: companies that exist but have not placed their home
  // token yet - shown as a faded token so launches are visible at a glance.
  const homeReserved = $derived.by(() => {
    const m = new Map<string, { sym: string; color: string }>();
    for (const c of game.state.corporations) {
      if (!c.coordinates || c.dissolved || c.tokenHexes.length) continue;
      m.set(c.coordinates, { sym: c.sym, color: c.color });
    }
    return m;
  });
  const suburbAt = (coord: string) => {
    const sym = game.state.suburbs?.[coord];
    return sym ? game.state.corporations.find((c) => c.sym === sym) : undefined;
  };
  // Station tokens actually present on a hex (from live game state).
  function tokensOn(coord: string) {
    return game.state.corporations
      .filter((c) => c.tokenHexes.includes(coord))
      .map((c) => ({ sym: c.sym, color: c.color }));
  }

  type Placed = HexDef & { cx: number; cy: number };
  const placed = $derived(
    HEX_LIST.map((h) => {
      const { x, y } = hexCenter(h.coord);
      return { ...h, cx: x, cy: y } as Placed;
    })
  );

  // Intro: a freshly auto-built RoLA map assembles tile by tile (skippable).
  // Bounds/zoom use the FULL map so the camera holds still while tiles land.
  let introN = $state(Number.POSITIVE_INFINITY);
  let introTimer = 0;
  const introActive = $derived(introN < placed.length);
  const visiblePlaced = $derived(introN >= placed.length ? placed : placed.slice(0, introN));
  function skipIntro() {
    clearInterval(introTimer);
    introN = Number.POSITIVE_INFINITY;
  }

  const pad = HEX_SIZE + 28;
  const xs = $derived(placed.map((p) => p.cx));
  const ys = $derived(placed.map((p) => p.cy));
  // Raw extents of the placed tiles (plus breathing room).
  const extMinX = $derived(Math.min(...xs) - pad);
  const extMinY = $derived(Math.min(...ys) - pad);
  const extMaxX = $derived(Math.max(...xs) + pad);
  const extMaxY = $derived(Math.max(...ys) + pad);

  // RoLA plays inside a fixed sea frame (the 1889 board size x rolaFrameScale),
  // anchored on the starting tiles, so the zoom/pan bounds stay put instead of
  // shifting as the map is built. The frame only grows (per axis) in the rare
  // case that placed tiles actually pass its edge.
  const SHIKOKU = (() => {
    const pts = Object.keys(configFor('1889').hexByCoord).map(hexCenter);
    const sx = pts.map((p) => p.x);
    const sy = pts.map((p) => p.y);
    return {
      w: Math.max(...sx) - Math.min(...sx) + pad * 2,
      h: Math.max(...sy) - Math.min(...sy) + pad * 2
    };
  })();
  const framed = $derived(!!game.state.map); // procedurally-built runtime map (RoLA)
  let frameAnchor = $state<{ x: number; y: number; code: string } | null>(null);
  $effect(() => {
    if (!framed || placed.length === 0) return;
    if (frameAnchor && frameAnchor.code === game.code) return;
    frameAnchor = {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
      code: game.code
    };
  });
  const bounds = $derived.by(() => {
    if (framed && frameAnchor && frameAnchor.code === game.code) {
      const fw = SHIKOKU.w * mapView.rolaFrameScale;
      const fh = SHIKOKU.h * mapView.rolaFrameScale;
      const x0 = Math.min(frameAnchor.x - fw / 2, extMinX);
      const y0 = Math.min(frameAnchor.y - fh / 2, extMinY);
      const x1 = Math.max(frameAnchor.x + fw / 2, extMaxX);
      const y1 = Math.max(frameAnchor.y + fh / 2, extMaxY);
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    return { x: extMinX, y: extMinY, w: extMaxX - extMinX, h: extMaxY - extMinY };
  });
  const minX = $derived(bounds.x);
  const minY = $derived(bounds.y);
  const width = $derived(bounds.w);
  const height = $derived(bounds.h);

  const poly = hexPolygon(0, 0);
  const STAR = 'M 0.00 -8.00 L 2.00 -2.75 L 7.61 -2.47 L 3.23 1.05 L 4.70 6.47 L 0.00 3.40 L -4.70 6.47 L -3.23 1.05 L -7.61 -2.47 L -2.00 -2.75 Z'; // Capital City star marker

  // Water lives on composited CSS layers behind the SVG (opacity-only fades on
  // the GPU): animating it inside the SVG forced full-scene repaints on phones.
  // World-space water (pans and rotates with the map): a deep base and shallow
  // wedges that step down from every coast into the depths.
  // A generous rect (in world units) for the deep base, covering the map with
  // room to pan; beyond it the .sea deep colour shows through.
  const seaRect = $derived({
    x: minX - width,
    y: minY - height,
    w: width * 3,
    h: height * 3
  });

  // Coastline: sea-facing hex edges of the visible map, with their outward
  // normal and a vertex->edges index. Offsetting a band by distance d uses a
  // MITER join at each shared vertex, so adjacent segments meet at one point
  // instead of crossing - the bands never overlap. Derived from the visible
  // tiles, so it grows with the assembly intro and follows the island outline.
  // Per-segment phase and speed (stable coordinate hashes): every stretch of
  // shore rolls on its own slow clock, so the coast never pulses in unison.
  function segRand(x: number, y: number, salt: number): number {
    let h = (Math.round(x) * 374761393 + Math.round(y) * 668265263 + salt * 974711) >>> 0;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  }
  type CoastEdge = {
    x1: number; y1: number; x2: number; y2: number; // the shore edge (padded, for waves)
    ox: number; oy: number; // the bordering ocean hex centre (wave origin)
    phase: number; speed: number;
  };
  const coast = $derived.by(() => {
    const have = new Set(visiblePlaced.map((p) => p.coord));
    const edges: CoastEdge[] = [];
    // Coastal LAND hex centres: each casts a shallow halo into the surrounding
    // ocean. Halos from adjacent coast hexes overlap to cover convex-corner
    // notches smoothly; rendered through a mask so the overlap can't brighten.
    const halos: { cx: number; cy: number }[] = [];
    const coastalLand = new Set<string>();
    for (const h of visiblePlaced) {
      let coastal = false;
      for (let e = 0; e < 6; e++) {
        const na = (Math.PI / 180) * (90 + 60 * e);
        const nx = Math.cos(na);
        const ny = Math.sin(na);
        const ncx = h.cx + 2 * APOTHEM * nx;
        const ncy = h.cy + 2 * APOTHEM * ny;
        const nb = hexAt(ncx, ncy);
        if (nb && have.has(nb)) {
          const c = hexCenter(nb);
          if (Math.hypot(c.x - ncx, c.y - ncy) < 1) continue; // a real land neighbour: not coast
        }
        coastal = true;
        const a1 = (Math.PI / 180) * (60 * (e + 1));
        const a2 = (Math.PI / 180) * (60 * (e + 2));
        const x1 = h.cx + HEX_SIZE * Math.cos(a1);
        const y1 = h.cy + HEX_SIZE * Math.sin(a1);
        const x2 = h.cx + HEX_SIZE * Math.cos(a2);
        const y2 = h.cy + HEX_SIZE * Math.sin(a2);
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        // pad the endpoints in toward the midpoint so neighbouring waves never
        // touch at shared triangle corners (the pad scales with the wave)
        const PADF = 0.14;
        edges.push({
          x1: x1 + (mx - x1) * PADF,
          y1: y1 + (my - y1) * PADF,
          x2: x2 + (mx - x2) * PADF,
          y2: y2 + (my - y2) * PADF,
          ox: ncx, // the ocean hex centre beyond this edge
          oy: ncy,
          phase: segRand(mx, my, 1),
          speed: 6 + 4 * segRand(mx, my, 2) // slow: 6-10s per wave cycle
        });
      }
      if (coastal) {
        halos.push({ cx: h.cx, cy: h.cy });
        coastalLand.add(h.coord);
      }
    }
    return { edges, halos, coastalLand };
  });
  const HALO_R = 1.7 * HEX_SIZE; // shallow reach from a coastal land hex centre

  // The deep base + shallow halos only change when the COASTLINE changes (board
  // build / intro), never on pan/zoom/rotate. So bake them to a bitmap once per
  // coast change and blit it (the GPU just transforms the image): no per-frame
  // re-rasterising of the mask. `lighten` compositing clamps overlapping halos
  // exactly like the SVG mask did.
  let waterUrl = $state('');
  $effect(() => {
    const halos = coast.halos;
    const r = { ...seaRect };
    if (typeof document === 'undefined' || !(r.w > 0)) return;
    const scale = Math.min(1.5, 1700 / Math.max(r.w, r.h));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(r.w * scale));
    cv.height = Math.max(1, Math.round(r.h * scale));
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.scale(scale, scale);
    ctx.translate(-r.x, -r.y); // world coords -> canvas
    ctx.fillStyle = '#1b6075'; // deep base
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.globalCompositeOperation = 'lighten'; // overlaps clamp to the lighter (teal)
    for (const hl of halos) {
      const g = ctx.createRadialGradient(hl.cx, hl.cy, 0, hl.cx, hl.cy, HALO_R);
      g.addColorStop(0, 'rgba(116,193,190,0.9)'); // #74c1be
      g.addColorStop(0.52, 'rgba(116,193,190,0.9)');
      g.addColorStop(1, 'rgba(116,193,190,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(hl.cx, hl.cy, HALO_R, 0, Math.PI * 2);
      ctx.fill();
    }
    waterUrl = cv.toDataURL();
  });
  // Waves, per the design algorithm: for each ocean hex bordering the map, for
  // each shared edge, a wave SPAWNS AT THE OCEAN HEX CENTRE and travels to that
  // edge, its endpoints riding the triangle (centre -> edge vertices). That is
  // exactly the shore edge segment scaled about the ocean centre from ~0 to 1,
  // so each wave is one line + one scale-about-origin animation. Two waves per
  // edge, half a cycle apart, keep the surf continuous.
  const WAVE_LEADS = [0, 0.5];

  function endPoint(e: number | 'center') {
    return e === 'center' ? { x: 0, y: 0 } : edgeMidpoint(0, 0, e);
  }
  function pathD(p: PathPart): string {
    const a = endPoint(p.a);
    const b = endPoint(p.b);
    if (p.a === 'center' || p.b === 'center') return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
    return `M ${a.x} ${a.y} Q 0 0 ${b.x} ${b.y}`;
  }
  const OFFBOARD_TIER: Record<string, string> = { yellow: '#8a6b18', brown: '#5a3a1b', diesel: '#222' };

  // --- pan / zoom (SVG viewBox) ---------------------------------------------
  let wrap: HTMLDivElement;
  let svgEl: SVGSVGElement;
  let view = $state({ x: 0, y: 0, w: 100, h: 100 });
  let fittedOnce = false;
  let buildFitted = false;
  // Rendered width of the map area, in CSS px (tracked live). The fit zoom uses
  // it so a hex lands at a legible on-screen size on any device: a fixed-world
  // fit makes hexes ~4x smaller on a phone than on a desktop, which is why the
  // per-hex icons (tokens, skylines) were unreadable on mobile.
  let viewportW = $state(0);
  $effect(() => {
    if (!wrap) return;
    if (wrap.clientWidth) viewportW = wrap.clientWidth;
    const ro = new ResizeObserver((es) => {
      const w = es[es.length - 1].contentRect.width;
      if (w) viewportW = w;
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  });
  // Keep a fitted hex at least this many CSS px wide so its icon stays readable.
  const LEGIBLE_HEX_PX = 92;
  const HEX_W = 2 * HEX_SIZE; // flat-top hex world width
  // Map building starts framed at ~11 hexes around the seed tiles; the pan/zoom
  // bounds are the fixed RoLA frame, so the camera never jumps as the map grows.
  const BUILD_VIEW = 17 * HEX_SIZE;
  const BUILD_ASPECT_W = 16;
  const BUILD_ASPECT_H = 9;
  const wrapAspect = $derived(building ? `${BUILD_ASPECT_W} / ${BUILD_ASPECT_H}` : `${width} / ${height}`);
  $effect(() => {
    if (building) {
      // Fit once when building starts, then leave the zoom under the player's control.
      if (!buildFitted) {
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const h = (BUILD_VIEW * BUILD_ASPECT_H) / BUILD_ASPECT_W;
        view = { x: cx - BUILD_VIEW / 2, y: cy - h / 2, w: BUILD_VIEW, h };
        buildFitted = true;
      }
    } else if (!fittedOnce && viewportW > 0) {
      // Fit the placed tiles (not the whole sea frame) so the board fills the
      // view, but never so far out that hexes shrink below a legible size: on a
      // narrow screen, zoom in to the board centre instead (the player can zoom
      // out for the overview). Desktop fits the whole board as before.
      const fw = extMaxX - extMinX;
      const fh = extMaxY - extMinY;
      const cap = (HEX_W * viewportW) / LEGIBLE_HEX_PX;
      if (fw > cap) {
        const k = cap / fw;
        const cx = extMinX + fw / 2;
        const cy = extMinY + fh / 2;
        const w = cap;
        const h = fh * k;
        view = clamped({ x: cx - w / 2, y: cy - h / 2, w, h });
      } else {
        view = { x: extMinX, y: extMinY, w: fw, h: fh };
      }
      fittedOnce = true;
    }
  });
  let dragging = $state(false);
  // True while actively panning/zooming. During interaction we drop the most
  // raster-heavy detail (animated foam, ground texture, coord labels) and switch
  // the SVG to fast rasterisation, then restore full detail when the view settles
  // - the viewBox churn is what re-rasterises the whole scene each frame.
  let interacting = $state(false);
  let settleTimer = 0;
  function bumpInteract() {
    interacting = true;
    clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => (interacting = false), 180);
  }
  // Whole-map rotation (rotate button). It is applied to the map CONTENT inside
  // the SVG, around the board centre - the water and the viewBox stay screen
  // aligned, and per-hex art/text counter-rotates so it reads right side up.
  // rotation is cumulative (not mod 360) so the tween never spins the long way.
  let rotation = $state(0);
  const rotAnim = tweened(0, { duration: mapView.rotationAnimMs, easing: cubicOut });
  let isFullscreen = $state(false);
  const rotPivot = $derived({ x: minX + width / 2, y: minY + height / 2 });
  // On quarter turns the rotated map occupies a box with width/height swapped
  // around the pivot; pan/zoom clamping uses these effective bounds.
  const quarter = $derived(((rotation % 180) + 180) % 180 === 90);
  const eW = $derived(quarter ? height : width);
  const eH = $derived(quarter ? width : height);
  const eMinX = $derived(quarter ? rotPivot.x - height / 2 : minX);
  const eMinY = $derived(quarter ? rotPivot.y - width / 2 : minY);
  /** Map coords -> screen-aligned (viewBox) coords under the current rotation. */
  function mapToView(c: { x: number; y: number }) {
    const a = (rotation * Math.PI) / 180;
    const dx = c.x - rotPivot.x;
    const dy = c.y - rotPivot.y;
    return {
      x: rotPivot.x + dx * Math.cos(a) - dy * Math.sin(a),
      y: rotPivot.y + dx * Math.sin(a) + dy * Math.cos(a)
    };
  }
  /** Screen-aligned (viewBox) coords -> map coords (inverse of mapToView). */
  function viewToMap(p: { x: number; y: number }) {
    const a = (-rotation * Math.PI) / 180;
    const dx = p.x - rotPivot.x;
    const dy = p.y - rotPivot.y;
    return {
      x: rotPivot.x + dx * Math.cos(a) - dy * Math.sin(a),
      y: rotPivot.y + dx * Math.sin(a) + dy * Math.cos(a)
    };
  }
  // Max zoom-in is always relative to the 1889 board, so close-up hexes are the
  // same size in every title regardless of how large the RoLA frame is.
  const MIN_W = $derived((framed ? SHIKOKU.w : width) * mapView.minZoomFraction);
  const MAX_W = $derived(eW * mapView.maxZoomFraction); // farthest out: the whole (rotated) frame
  // The placed-tiles (land) extent in screen-aligned view space, under the current
  // rotation: the bounding box of the four rotated land corners. Panning clamps the
  // CAMERA CENTRE to this (not the whole rectangle to the sea frame), so the player
  // can centre the viewport over any board hex - edge land included - and no further
  // out into empty sea.
  const landViewBounds = $derived.by(() => {
    const corners = [
      mapToView({ x: extMinX, y: extMinY }),
      mapToView({ x: extMaxX, y: extMinY }),
      mapToView({ x: extMinX, y: extMaxY }),
      mapToView({ x: extMaxX, y: extMaxY })
    ];
    const cx = corners.map((c) => c.x);
    const cy = corners.map((c) => c.y);
    return { minX: Math.min(...cx), maxX: Math.max(...cx), minY: Math.min(...cy), maxY: Math.max(...cy) };
  });
  const pointers = new Map<number, { x: number; y: number }>();
  let moved = false;
  let downPos = { x: 0, y: 0 }; // pointer-down screen position (drag-vs-tap threshold)
  let viewRaf = 0; // in-flight animated-view frame

  // --- transform-based panning (composited, no per-frame raster) -------------
  // A single-pointer drag does NOT churn the viewBox (which would re-rasterise
  // the whole scene every frame). Instead we translate the SVG element with a
  // CSS transform - a compositor-only operation - and only bake the offset back
  // into the viewBox occasionally (when it nears the overscan edge, and on
  // pointer-up). To keep the reveal seamless the SVG renders an overscan margin
  // on every side: the element is 1 + 2*PAN_OS the size of the visible sea, and
  // the viewBox is expanded to match, so the visible scale is unchanged but
  // there is real content to slide in from beyond the edges.
  const PAN_OS = 0.35;
  // Expanded viewBox actually rendered (visible `view` plus the overscan ring).
  const vb = $derived({
    x: view.x - PAN_OS * view.w,
    y: view.y - PAN_OS * view.h,
    w: view.w * (1 + 2 * PAN_OS),
    h: view.h * (1 + 2 * PAN_OS)
  });
  let panOffset = $state({ x: 0, y: 0 }); // live CSS-px translate during a drag
  let dragScale = 1; // svg view-units per screen pixel, captured at drag start

  // Keep the view within the map bounds, leaving a little wiggle room past the
  // edge (mapView.edgeMargin). While laying a tile, allow a larger margin so the
  // fan of options (which sits outside the chosen hex) stays reachable.
  function clamped(v: { x: number; y: number; w: number; h: number }) {
    let { x, y, w, h } = v;
    const m = (layHex ? mapView.layFanMargin : mapView.edgeMargin) * HEX_SIZE;
    // While building, keep the generous fixed-frame containment (the camera holds
    // still as tiles land). Otherwise clamp the CAMERA CENTRE to the land extent so
    // panning stops when the middle of the (panel-adjusted) viewport reaches the
    // board edge, and the rectangle is free to overhang into the surrounding sea.
    if (layHex || building) {
      if (w >= eW + 2 * m) x = eMinX - (w - eW) / 2;
      else x = Math.min(Math.max(x, eMinX - m), eMinX + eW - w + m);
      if (h >= eH + 2 * m) y = eMinY - (h - eH) / 2;
      else y = Math.min(Math.max(y, eMinY - m), eMinY + eH - h + m);
      return { x, y, w, h };
    }
    const b = landViewBounds;
    // If the view already covers the whole land on an axis, keep it centred there;
    // otherwise constrain the camera centre to the land span (+ a small margin).
    if (w >= b.maxX - b.minX) x = (b.minX + b.maxX) / 2 - w / 2;
    else x = Math.min(Math.max(x + w / 2, b.minX - m), b.maxX + m) - w / 2;
    if (h >= b.maxY - b.minY) y = (b.minY + b.maxY) / 2 - h / 2;
    else y = Math.min(Math.max(y + h / 2, b.minY - m), b.maxY + m) - h / 2;
    return { x, y, w, h };
  }
  function clampView() {
    view = clamped(view);
  }

  /** Smoothly ease the viewBox toward a (clamped) target. Cancels on interaction. */
  function animateView(target: { x: number; y: number; w: number; h: number }, dur = mapView.zoomAnimMs) {
    cancelAnimationFrame(viewRaf);
    const start = { ...view };
    const goal = clamped(target);
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3); // easeOutCubic
      bumpInteract();
      view = {
        x: start.x + (goal.x - start.x) * e,
        y: start.y + (goal.y - start.y) * e,
        w: start.w + (goal.w - start.w) * e,
        h: start.h + (goal.h - start.h) * e
      };
      if (k < 1) viewRaf = requestAnimationFrame(tick);
    };
    viewRaf = requestAnimationFrame(tick);
  }
  function stopViewAnim() {
    cancelAnimationFrame(viewRaf);
  }

  /** Pan (and zoom in a little) so a hex is centred and its fan is fully visible. */
  function centerOn(hex: string) {
    const c = mapToView(hexCenter(hex));
    const targetW = Math.min(MAX_W, Math.max(MIN_W, HEX_SIZE * 10));
    const targetH = targetW * (view.h / view.w);
    animateView({ x: c.x - targetW / 2, y: c.y - targetH / 2, w: targetW, h: targetH });
  }

  // "Find on the map": the entities panel requests a fly-to (panSeq bumps) and a
  // hover ping (locate.hex). Centre on the requested hex and keep a brief ping.
  let pingSeq = 0;
  $effect(() => {
    const seq = locate.panSeq;
    const hex = locate.panHex;
    if (seq !== pingSeq && hex && activeMap[hex]) {
      pingSeq = seq;
      centerOn(hex);
      locate.hex = hex;
      const mark = seq;
      setTimeout(() => {
        if (locate.panSeq === mark) locate.hex = null;
      }, 2200);
    }
  });
  const pingAt = $derived(locate.hex && activeMap[locate.hex] ? hexCenter(locate.hex) : null);

  /** Map a client point to screen-aligned SVG (viewBox) coordinates. */
  function clientToSvg(clientX: number, clientY: number): { x: number; y: number } {
    const ctm = svgEl.getScreenCTM();
    if (ctm) {
      const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
    }
    // Fallback (no rotation): fraction of the bounding rect.
    const r = svgEl.getBoundingClientRect();
    return { x: view.x + ((clientX - r.left) / r.width) * view.w, y: view.y + ((clientY - r.top) / r.height) * view.h };
  }

  function zoomAt(clientX: number, clientY: number, factor: number) {
    bumpInteract();
    const p = clientToSvg(clientX, clientY);
    const fx = (p.x - view.x) / view.w;
    const fy = (p.y - view.y) / view.h;
    const nw = Math.max(MIN_W, Math.min(MAX_W, view.w * factor));
    const nh = view.h * (nw / view.w);
    view = clamped({ x: p.x - fx * nw, y: p.y - fy * nh, w: nw, h: nh });
  }
  /** Zoom toward the viewport centre, animated (used by the +/- buttons). */
  function zoomCenter(factor: number) {
    bumpInteract();
    const fx = 0.5;
    const fy = 0.5;
    const px = view.x + fx * view.w;
    const py = view.y + fy * view.h;
    const nw = Math.max(MIN_W, Math.min(MAX_W, view.w * factor));
    const nh = view.h * (nw / view.w);
    animateView({ x: px - fx * nw, y: py - fy * nh, w: nw, h: nh });
  }
  /** Rotate the whole map by the configured step (replaces the old reset button). */
  function rotateMap() {
    rotation += mapView.rotationStepDeg;
    rotAnim.set(rotation);
  }
  // Fullscreen the whole board UI (the .board-root ancestor), not just the map,
  // so the panels/toolbar come along.
  function fsTarget(): HTMLElement {
    return (wrap?.closest('.board-root') as HTMLElement | null) ?? wrap;
  }
  function toggleFullscreen() {
    if (!document.fullscreenElement) fsTarget()?.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  }

  // Per-hex coordinate labels: printed at the bottom of each tile, fading in
  // once the view is zoomed close enough that they are readable.
  const showCoords = $derived(view.w <= mapView.coordZoomHexes * 1.5 * HEX_SIZE);

  onMount(() => {
    // Assembly intro: once per client per room, and only during the first
    // stock round (a flag in localStorage stops replays on reload/revisit).
    const introKey = `tp.mapIntro.${game.code}`;
    if (
      fill &&
      game.state.map &&
      game.state.round === 'stock' &&
      game.state.srCount === 1 &&
      anim.enabled &&
      placed.length > 12 &&
      !localStorage.getItem(introKey)
    ) {
      localStorage.setItem(introKey, '1');
      introN = 0;
      introTimer = window.setInterval(() => {
        introN += 3;
        if (introN >= placed.length) clearInterval(introTimer);
      }, 90);
    }
    return () => clearInterval(introTimer);
  });

  function onDown(e: PointerEvent) {
    stopViewAnim();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    downPos = { x: e.clientX, y: e.clientY };
    if (pointers.size === 1) {
      dragging = true;
      // svg user-units per screen pixel = rendered viewBox width / element width.
      const rw = svgEl.getBoundingClientRect().width || 1;
      dragScale = (view.w * (1 + 2 * PAN_OS)) / rw;
    }
  }
  function onMove(e: PointerEvent) {
    // Map building: highlight the hex under the cursor (where a click would place).
    if (canBuild && !dragging) {
      const sp = viewToMap(clientToSvg(e.clientX, e.clientY));
      hoveredHex = hexAt(sp.x, sp.y);
    }
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId)!;
    if (pointers.size === 2) {
      const ids = [...pointers.keys()];
      const a = pointers.get(ids[0])!;
      const b = pointers.get(ids[1])!;
      const oldDist = Math.hypot(a.x - b.x, a.y - b.y);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const a2 = pointers.get(ids[0])!;
      const b2 = pointers.get(ids[1])!;
      const newDist = Math.hypot(a2.x - b2.x, a2.y - b2.y);
      if (oldDist > 0 && newDist > 0) zoomAt((a2.x + b2.x) / 2, (a2.y + b2.y) / 2, oldDist / newDist);
      moved = true;
      hide();
      return;
    }
    // Drag vs tap is measured from the down point (not per-frame), so a slow drag
    // still counts and a jittery click on a busy frame still lays/places.
    if (Math.abs(e.clientX - downPos.x) + Math.abs(e.clientY - downPos.y) > 6) {
      moved = true;
      hide();
    }
    // Pan via a composited CSS transform on the SVG (no viewBox churn). The
    // screen-pixel delta maps straight to screen-aligned view units (the viewBox
    // is screen-aligned; rotation lives on an inner group), so dragScale alone
    // converts between them - the same scale the old CTM path used.
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    bumpInteract();
    const maxPx = PAN_OS * (view.w / dragScale);
    // Desired total visual offset, continuing from the live transform.
    const nx = panOffset.x + (e.clientX - prev.x);
    const ny = panOffset.y + (e.clientY - prev.y);
    // Resolve where the camera wants to sit, clamped to the map bounds, then read
    // back how far it can actually travel from the current baked view (in pixels).
    const want = clamped({ ...view, x: view.x - nx * dragScale, y: view.y - ny * dragScale });
    const tx = (view.x - want.x) / dragScale;
    const ty = (view.y - want.y) / dragScale;
    // The SVG renders only a PAN_OS overscan ring, so the composited transform can
    // travel at most that far; bake whatever surplus is needed into the viewBox and
    // keep the live transform inside the ring. Splitting it this way keeps the
    // content glued to the finger with no snap (total = baked + transform = tx),
    // stops dead only at the true map edge, and never springs back on release. The
    // viewBox re-rasters only when a drag exceeds the ring, not every frame.
    const px = Math.max(-maxPx, Math.min(maxPx, tx));
    const py = Math.max(-maxPx, Math.min(maxPx, ty));
    if (tx !== px || ty !== py) {
      view = clamped({ ...view, x: view.x - (tx - px) * dragScale, y: view.y - (ty - py) * dragScale });
    }
    panOffset = { x: px, y: py };
  }
  function onUp(e: PointerEvent) {
    const wasDrag = moved;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) dragging = false;
    // Bake any live transform-pan into the viewBox, then drop the transform.
    if (panOffset.x || panOffset.y) {
      view = clamped({ ...view, x: view.x - panOffset.x * dragScale, y: view.y - panOffset.y * dragScale });
      panOffset = { x: 0, y: 0 };
    }
    if (!wasDrag) {
      // Map building: a tap anywhere on the grid positions the next tile.
      if (canBuild) {
        const sp = viewToMap(clientToSvg(e.clientX, e.clientY));
        selectAnchor(hexAt(sp.x, sp.y));
        return;
      }
      const el = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest('g.hex') as
        | SVGGraphicsElement
        | null;
      const coord = el?.getAttribute('data-coord') ?? null;
      // "Choose a space" mode (e.g. Adaptive's home): a click on a highlighted hex
      // makes the choice and nothing else.
      if (pickSet.size) {
        if (coord && pickSet.has(coord)) onpick?.(coord);
        return;
      }
      // In lay mode: tap the preview tile to rotate it; tap a highlighted hex to
      // start (or switch) a lay.
      if (layMode) {
        // tapping a fan tile picks it
        const fanEl = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest('g.fanhex');
        const fanTile = fanEl?.getAttribute('data-fantile');
        if (fanTile) {
          // Exhausted tiles are shown greyed ("0 left") but cannot be selected.
          if (layHex && tileChoices(layHex).includes(fanTile)) pickTile(fanTile);
          return;
        }
        if (preview && coord === layHex) {
          rotatePreview();
          return;
        }
        if (coord && layHexes.has(coord)) {
          clickLayHex(coord);
          return;
        }
      }
      if (tokenMode && coord && tokenHexes.has(coord)) {
        placeToken(coord);
        return;
      }
      // Run step: click a revenue centre to add/remove it from the armed train's route.
      if (runMode && coord && isStopHex(coord)) {
        routing.toggleStop($state.snapshot(game.state) as typeof game.state, coord);
        return;
      }
      if (el && coord) {
        if (tip?.coord === coord) hide();
        else show(el, coord, el.getAttribute('data-name') || undefined);
      } else {
        hide();
      }
    }
  }

  onMount(() => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopViewAnim();
      zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? mapView.wheelZoomFactor : 1 / mapView.wheelZoomFactor);
    };
    svgEl.addEventListener('wheel', onWheel, { passive: false });
    const onFs = () => (isFullscreen = !!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      svgEl.removeEventListener('wheel', onWheel);
      document.removeEventListener('fullscreenchange', onFs);
    };
  });

  // --- hover / tap tooltip ---------------------------------------------------
  let tip = $state<{ coord: string; name?: string; x: number; y: number; hx: number; hy: number } | null>(null);

  function show(el: SVGGraphicsElement, coord: string, name?: string) {
    const r = wrap.getBoundingClientRect();
    const ctm = el.getScreenCTM();
    const c = hexCenter(coord);
    let x = 0;
    let y = 0;
    if (ctm) {
      const sp = new DOMPoint(0, 0).matrixTransform(ctm);
      x = sp.x - r.left;
      y = sp.y - r.top;
    }
    tip = { coord, name, x, y, hx: c.x, hy: c.y };
  }
  function hide() {
    tip = null;
  }
</script>

<div class="wrap" class:fill class:paused class:interacting class:liftctrl={liftControls} bind:this={wrap} style="aspect-ratio: {wrapAspect}">
  <div class="sea">
    <svg
      class="map"
      class:grabbing={dragging}
      bind:this={svgEl}
      viewBox="{vb.x} {vb.y} {vb.w} {vb.h}"
      style="transform: translate({panOffset.x}px, {panOffset.y}px)"
      role="application"
      aria-label="1889 Shikoku map (drag to pan, scroll to zoom)"
      onpointerdown={onDown}
      onpointermove={onMove}
      onpointerup={onUp}
      onpointercancel={onUp}
      onpointerleave={() => (hoveredHex = null)}
    >
      <defs>
        <clipPath id="hexclip"><polygon points={poly} /></clipPath>
        <clipPath id="cityclip"><circle r="12.5" /></clipPath>
        <!-- buildable water hexes (lakes / rivers): the classic pixel water -->
        <pattern id="lakepx" patternUnits="userSpaceOnUse" width={TILE_W} height={TILE_H}>
          <rect width={TILE_W} height={TILE_H} fill={WATER_BASE} />
          {#each [...WATER_STATIC, ...WATER_FRAMES[0]] as [x, y, w, h, c]}
            <rect {x} {y} width={w} height={h} fill={c} />
          {/each}
        </pattern>
        <!-- shallow water is baked to a bitmap (see waterUrl) and blitted below;
             the radial halo + mask defs are kept for the canvas profile only. -->
      </defs>

      <!-- everything on the board rotates as a group around the board centre -->
      <g transform="rotate({$rotAnim} {rotPivot.x} {rotPivot.y})">
      <!-- deep base + shallow band, baked once per coast change and blitted
           (a plain deep rect shows until the first bake completes) -->
      {#if waterUrl}
        <image
          href={waterUrl}
          x={seaRect.x}
          y={seaRect.y}
          width={seaRect.w}
          height={seaRect.h}
          preserveAspectRatio="none"
        />
      {:else}
        <rect class="deep" x={seaRect.x} y={seaRect.y} width={seaRect.w} height={seaRect.h} />
      {/if}
      <!-- locate ping: radiating circle around a hex (hover/click in Entities) -->
      {#if pingAt}
        <g class="ping" transform="translate({pingAt.x} {pingAt.y})">
          <circle class="ping1" r="14" />
          <circle class="ping2" r="14" />
          <circle class="pingdot" r="6" />
        </g>
      {/if}
      <!-- shoreline waves: spawn at each bordering ocean hex centre and travel
           to the shared shore edge, endpoints confined to the centre->edge
           triangle (the line scales about the ocean centre). Per-edge random
           phase + speed; negative delays keep the surf always mid-motion. -->
      <g class="coast" aria-hidden="true">
        {#each WAVE_LEADS as lead (lead)}
          {#each coast.edges as s, i (i)}
            <!-- static translate to the ocean centre; the line's local origin is
                 then that centre, so a plain scale() animation (no custom-property
                 transforms -> no per-frame style recalc) spawns it there. -->
            <g transform="translate({s.ox.toFixed(1)} {s.oy.toFixed(1)})">
              <line
                class="foam"
                x1={(s.x1 - s.ox).toFixed(1)}
                y1={(s.y1 - s.oy).toFixed(1)}
                x2={(s.x2 - s.ox).toFixed(1)}
                y2={(s.y2 - s.oy).toFixed(1)}
                stroke-width="2.3"
                stroke-dasharray="8 6"
                vector-effect="non-scaling-stroke"
                style="animation-duration:{s.speed.toFixed(2)}s; animation-delay:{(-(s.phase + lead) * s.speed).toFixed(2)}s"
              />
            </g>
          {/each}
        {/each}
      </g>
      {#each visiblePlaced as h (h.coord)}
        <g
          class="hex"
          class:placing={recentlyPlaced.has(h.coord)}
          data-coord={h.coord}
          data-name={h.name ?? ''}
          transform="translate({h.cx} {h.cy})"
          role="button"
          tabindex="-1"
          aria-label="{h.coord}{h.name ? ` ${h.name}` : ''}"
          onpointerenter={(e) => e.pointerType === 'mouse' && pointers.size === 0 && show(e.currentTarget, h.coord, h.name)}
          onpointerleave={(e) => e.pointerType === 'mouse' && !dragging && hide()}
        >
          <polygon points={poly} class="tile" fill={laid(h.coord) ? tfill(laidDef(h.coord)?.color ?? 'yellow') : tip?.coord === h.coord ? thover(h.color) : isPlainLand(h) && coast.coastalLand.has(h.coord) ? '#e3d6a4' : tfill(h.color)} stroke="#4a4332" stroke-width="1" />

          <!-- Catan-style ground texture on plain land: grass tufts inland,
               sandy beach speckle on coastal hexes. Counter-rotated so the
               grass blades stay upright when the board is turned. -->
          {#if isPlainLand(h)}
            <g class="groundtex" transform="rotate({-$rotAnim})">
              {#if coast.coastalLand.has(h.coord)}
                {#each sandDots(h.coord) as d (d.x)}
                  <circle cx={d.x} cy={d.y} r={d.r} fill="#cdba81" />
                {/each}
              {:else}
                {#each grassTufts(h.coord) as g (g.x)}
                  <path
                    d="M {g.x - g.s} {g.y} q {g.s * 0.5} {-g.s * 1.4} {g.s} 0 M {g.x - g.s * 0.3} {g.y} q {g.s * 0.4} {-g.s * 1.1} {g.s * 0.8} 0"
                    fill="none"
                    stroke="#9aa867"
                    stroke-width="1.1"
                    stroke-linecap="round"
                  />
                {/each}
              {/if}
            </g>
          {/if}

          {#if layMode && layHexes.has(h.coord)}
            <polygon points={poly} class="layhi" />
          {/if}
          {#if tokenMode && tokenHexes.has(h.coord)}
            <polygon points={poly} class="tokenhi" />
          {/if}
          {#if pickSet.has(h.coord)}
            <polygon points={poly} class="pickhi" />
          {/if}
          {#if spotlight.has(h.coord)}
            <polygon points={poly} class="spothi" />
          {/if}
          {#if runMode && isStopHex(h.coord)}
            <circle r="17" class="routestop" />
          {/if}

          {#if h.terrain?.includes('water')}
            {#if h.terrain.includes('mountain')}
              <!-- river crossing (1889 H5/I6): land with a water build cost -->
              <polygon points={poly} fill="#2f6f96" opacity="0.32" />
            {:else}
              <!-- true water hex (RoLA lakes, bridgeable): the classic pixel water -->
              <polygon points={poly} fill="url(#lakepx)" />
            {/if}
          {/if}

          <!-- terrain art counter-rotates so it stays right side up -->
          <g transform="rotate({-$rotAnim})">
            {#if h.terrain?.includes('mountain')}
              {#each peaks(h.coord) as pk}
                {@const ax = pk.x + pk.s / 2}
                {@const ay = 14 - pk.s}
                <!-- silhouette (lit left face) with an outline for definition -->
                <path
                  d="M {pk.x} 14 L {ax} {ay} L {pk.x + pk.s} 14 Z"
                  fill="#9c8861"
                  stroke="#4a4030"
                  stroke-width="0.9"
                  stroke-linejoin="round"
                />
                <!-- shadowed right face -->
                <path d="M {ax} {ay} L {pk.x + pk.s} 14 L {ax} 14 Z" fill="#6f5d3c" />
                <!-- snow cap: top ~42% of the peak; the lower corners sit exactly
                     on the slopes (no overhang), the bottom edge is jagged -->
                <path
                  d="M {ax} {ay}
                     L {ax - pk.s * 0.21} {ay + pk.s * 0.42}
                     L {ax - pk.s * 0.1} {ay + pk.s * 0.36}
                     L {ax - pk.s * 0.05} {ay + pk.s * 0.46}
                     L {ax} {ay + pk.s * 0.34}
                     L {ax + pk.s * 0.05} {ay + pk.s * 0.46}
                     L {ax + pk.s * 0.1} {ay + pk.s * 0.36}
                     L {ax + pk.s * 0.21} {ay + pk.s * 0.42}
                     Z"
                  fill="#f7f5ef"
                  stroke="#d3d8d4"
                  stroke-width="0.4"
                  stroke-linejoin="round"
                />
                <!-- shade the snow's right half so the cap reads 3D (stays inside) -->
                <path
                  d="M {ax} {ay} L {ax + pk.s * 0.21} {ay + pk.s * 0.42} L {ax + pk.s * 0.07} {ay + pk.s * 0.3} Z"
                  fill="#dadfe2"
                  opacity="0.8"
                />
              {/each}
            {/if}
          </g>

          <g clip-path="url(#hexclip)">
            {#each h.paths as p}
              <path d={pathD(p)} class="ties" />
              <path d={pathD(p)} class="rail" />
              {#if showRoutes}{@const sc = segColor(h.coord, p.a, p.b)}{#if sc}<path d={pathD(p)} class="routeline" style="stroke:{sc}" />{/if}{/if}
            {/each}
          </g>

          {#if laidDef(h.coord)}
            {@const def = laidDef(h.coord)}
            <g clip-path="url(#hexclip)">
              {#each laidPaths(h.coord) as p}
                <path d={pathD(p)} class="ties" />
                <path d={pathD(p)} class="rail" />
                {#if showRoutes}{@const sc = segColor(h.coord, p.a, p.b)}{#if sc}<path d={pathD(p)} class="routeline" style="stroke:{sc}" />{/if}{/if}
              {/each}
            </g>
            <!-- the laid tile's stops and revenue stay right side up -->
            <g transform="rotate({-$rotAnim})">
              {#if def && def.cities > 0}
                {#if def.slots > 1}
                  <!-- a multi-slot city: a stadium wide enough for every token slot
                       (matches the base-city and inventory rendering) -->
                  <rect x={-12 * def.slots} y="-13" width={24 * def.slots} height="26" rx="13" class="city" />
                {:else}
                  <circle r="13" class="city" />
                {/if}
                {#if def.revenue > 0}<text class="rev" y="-19" text-anchor="middle">{def.revenue}</text>{/if}
                {#if h.cities?.[0]?.capital}<path class="capstar" d={STAR} />{/if}
              {:else if def && def.towns > 0}
                <rect x="-9" y="-4" width="18" height="8" rx="2" class="town" transform="rotate(30)" />
                {#if def.revenue > 0}<text class="rev" y="-15" text-anchor="middle">{def.revenue}</text>{/if}
              {/if}
            </g>
          {/if}

          <!-- stops, tokens, and every label counter-rotate so they read upright -->
          <g transform="rotate({-$rotAnim})">
            {#if !laid(h.coord)}
              {#each h.towns as t}
                <rect x="-9" y="-4" width="18" height="8" rx="2" class="town" transform="rotate(30)" />
                {#if t.revenue > 0}<text class="rev" y="-15" text-anchor="middle">{t.revenue}</text>{/if}
              {/each}

              {#each h.cities as c}
                {#if c.slots > 1}
                  <rect x={-12 * c.slots} y="-13" width={24 * c.slots} height="26" rx="13" class="city" />
                {:else}
                  <circle r="13" class="city" />
                {/if}
                {#if c.revenue > 0}<text class="rev" y="-19" text-anchor="middle">{c.revenue}</text>{/if}
                {#if c.capital}
                  <!-- Capital City: a star instead of the skyline -->
                  <path class="capstar" d={STAR} />
                {:else if c.slots === 1 && !HOME.has(h.coord)}
                  <g clip-path="url(#cityclip)">
                    {#each skyline(h.coord) as b}
                      <rect x={b.x} y={9 - b.h} width={b.w} height={b.h} fill="#43566a" />
                      {#if b.lit}<rect x={b.x + b.w / 2 - 0.5} y={11 - b.h} width="1" height="1" fill="#ffd76a" />{/if}
                    {/each}
                    <rect x="-13" y="9" width="26" height="4" fill="#36475a" />
                  </g>
                {/if}
              {/each}
            {/if}

            {#if h.offboard}
              {#each Object.entries(h.offboard.revenue) as [tier, val], i}
                <text class="off" x="0" y={i * 13 - 6} text-anchor="middle" fill={OFFBOARD_TIER[tier] ?? '#333'}>{val}</text>
              {/each}
            {/if}

            {#if homeReserved.has(h.coord) && tokensOn(h.coord).length === 0}
              {@const hr = homeReserved.get(h.coord)!}
              <g class="homeres">
                <circle r="9" fill={hr.color} stroke="#fff" stroke-width="1.5" />
                <text class="tok" y="3" text-anchor="middle">{hr.sym}</text>
              </g>
            {/if}
            {#if suburbAt(h.coord)}
              {@const su = suburbAt(h.coord)!}
              <!-- upper-left corner so it never covers the centre revenue / token -->
              <g transform="translate(-22 {-APOTHEM + 16})">
                <rect x="-7" y="-5" width="14" height="10" rx="2" fill={su.color} stroke="#fff" stroke-width="1.2" />
                <text class="tok" y="3" text-anchor="middle">S</text>
              </g>
            {/if}
            {#if h.upgradeCost && !laid(h.coord)}
              <text class="costlbl" y={-APOTHEM + 12} text-anchor="middle">{h.upgradeCost}</text>
            {/if}
            {#each tokensOn(h.coord) as t, ti (t.sym)}
              <g transform="translate({ti * 11 - (tokensOn(h.coord).length - 1) * 5.5} 0)">
                <circle r="9" fill={t.color} stroke="#fff" stroke-width="1.5" />
                <text class="tok" y="3" text-anchor="middle">{t.sym}</text>
              </g>
            {/each}

            {#if h.label && h.label !== 'C'}
              {@const lp = labelPos(h)}
              <text class="label" x={lp.x} y={lp.y + 4} text-anchor="middle">{h.label}</text>
            {/if}
            {#if h.name}<text class="name" y={APOTHEM - 6 - (showCoords ? 7 : 0)} text-anchor="middle">{h.name}</text>{/if}
            {#if showCoords}<text class="coordlbl show" y={APOTHEM - 5} text-anchor="middle">{h.coord}</text>{/if}
          </g>
        </g>
      {/each}

      <!-- map-build placement: show the actual next tile, green at valid slots,
           red where it cannot go (occupied / off the grid). -->
      {#snippet cellMarks(cell: Omit<HexDef, 'coord'> | undefined)}
        {#if cell?.terrain?.includes('water')}
          <polygon points={poly} fill="#2f6f96" opacity="0.3" />
        {/if}
        {#if cell?.terrain?.includes('mountain')}
          <path d="M -15 13 L -5 -6 L 3 7 L 13 -10 L 19 13 Z" fill="#7d6a47" opacity="0.85" />
        {/if}
        {#if cell?.cities?.length}
          <circle r="18" fill="#f3eede" stroke="#3a3326" stroke-width="2.5" />
        {:else if cell?.towns?.length}
          <circle r="8" fill="#3a3326" />
        {/if}
      {/snippet}

      <!-- highlight the hex under the cursor so it's clear where a tile will land -->
      {#if canBuild && hoveredHex && hoveredHex !== selectedAnchor}
        {@const hc = hexCenter(hoveredHex)}
        <polygon class="hoverhex" points={poly} transform="translate({hc.x} {hc.y})" />
      {/if}

      <!-- outline of the tile at the clicked slot: green if legal, red if not. The
           base (rotation 0) layout is spun by the tweened angle around the anchor so
           rotation animates through the six 60-degree orientations. -->
      {#if canBuild && selectedAnchor && nextCells}
        {@const piv = hexCenter(selectedAnchor)}
        <g class="tilepreview" transform="translate({$slide.x} {$slide.y}) rotate({$spinAngle} {piv.x} {piv.y})">
          {#each placementCoords(selectedAnchor, 0) as c, i (i)}
            {@const ctr = hexCenter(c)}
            <g transform="translate({ctr.x} {ctr.y})">
              <polygon points={poly} class={selectedLegal ? 'okline' : 'badline'} />
              <g transform="rotate({-$rotAnim - $spinAngle})">{@render cellMarks(nextCells[i])}</g>
            </g>
          {/each}
        </g>
      {/if}

      {#if tip}
        <g transform="translate({tip.hx} {tip.hy})">
          <polygon points={poly} class="selring" />
        </g>
      {/if}

      {#snippet tileCentre(id: string)}
        {@const def = TILES[id]}
        {#if def.cities > 0}
          <circle r="11" class="city" />
          {#if def.revenue > 0}<g transform="rotate({-$rotAnim})"><text class="rev" y="-15" text-anchor="middle">{def.revenue}</text></g>{/if}
        {:else if def.towns > 0}
          <rect x="-9" y="-4" width="18" height="8" rx="2" class="town" transform="rotate(30)" />
          {#if def.revenue > 0}<g transform="rotate({-$rotAnim})"><text class="rev" y="-14" text-anchor="middle">{def.revenue}</text></g>{/if}
        {/if}
        {#if def.label}<g transform="rotate({-$rotAnim})"><text class="label" x={APOTHEM - 9} y={-APOTHEM + 17} text-anchor="middle">{def.label}</text></g>{/if}
      {/snippet}

      {#if layMode && layHex}
        {@const lc = hexCenter(layHex)}
        {#if preview}
          {#key preview.tile}
            <g class="previewtile" transform="translate({lc.x} {lc.y})">
              <g class="previewspin" style="transform: rotate({preview.rotations[preview.idx] * 60}deg)">
                <polygon points={poly} fill="#f3cf3e" stroke="#15252f" stroke-width="3" />
                <g clip-path="url(#hexclip)">
                  {#each tilePaths(preview.tile, 0) as p}
                    <path d={pathD(p)} class="ties" />
                    <path d={pathD(p)} class="rail" />
                  {/each}
                </g>
                {@render tileCentre(preview.tile)}
              </g>
            </g>
          {/key}
        {:else}
          <!-- dim the board so the floating option tiles read clearly (3x the
               viewBox so it still covers the screen when the map is rotated) -->
          <rect
            x={view.x - view.w} y={view.y - view.h} width={view.w * 3} height={view.h * 3}
            fill="#0b1622" opacity="0.45"
          />
          <g transform="translate({lc.x} {lc.y})">
            <polygon points={poly} class="laysel" />
          </g>
          <!-- radial fan of candidate tiles, drawn as real hex tiles on a dark disc
               so they float above (and never blend into) the board hexes behind. -->
          {#each fanEntries(layHex) as entry, i (entry.tile)}
            {@const n = fanEntries(layHex).length}
            {@const ang = fanBaseAngle(layHex) + (i - (n - 1) / 2) * (54 * Math.PI / 180)}
            {@const fx = lc.x + Math.cos(ang) * HEX_SIZE * 3.05}
            {@const fy = lc.y + Math.sin(ang) * HEX_SIZE * 3.05}
            <g
              class="fanhex"
              class:exhausted={!entry.available}
              data-fantile={entry.tile}
              transform="translate({fx} {fy}) scale(0.7)"
            >
              <circle r={HEX_SIZE + 9} fill="#0b1622" opacity="0.92" />
              <polygon points={poly} fill={fanFill(entry.tile)} stroke={entry.available ? '#f5c542' : '#5b6b7a'} stroke-width="3" />
              <g clip-path="url(#hexclip)">
                {#each tilePaths(entry.tile, 0) as p}
                  <path d={pathD(p)} class="ties" />
                  <path d={pathD(p)} class="rail" />
                {/each}
              </g>
              {@render tileCentre(entry.tile)}
              <g transform="rotate({-$rotAnim})">
                <text class="fanid" y={APOTHEM - 4} text-anchor="middle">#{entry.tile}</text>
                <text class="fanleft" class:none={entry.left === 0} y={-APOTHEM - 6} text-anchor="middle">
                  {entry.left} left
                </text>
              </g>
            </g>
          {/each}
        {/if}
      {/if}

      <!-- city glow pulses as the train passes -->
      {#each glows as g (g.id)}
        <circle class="cityglow" cx={g.x} cy={g.y} r="17" style="stroke:{g.color}" />
      {/each}
      <!-- tunnel portals at the route's origin and destination -->
      {#each portals as p (p.x + ',' + p.y)}
        <g class="portal" transform="translate({p.x} {p.y}) rotate({p.angle})">
          <path d="M 0 -12 A 12 12 0 0 0 0 12 L -7 12 L -7 -12 Z" fill="#322c26" stroke="#100e0c" stroke-width="1.5" />
          <ellipse rx="7.5" ry="9" fill="#040404" />
        </g>
      {/each}
      {#if train}
        <g class="train">
          <!-- coupling line through the car centres -->
          <polyline
            points={train.cars.map((c) => `${c.x},${c.y}`).join(' ')}
            fill="none"
            stroke="#111"
            stroke-width="2.5"
            stroke-linecap="round"
          />
          {#each train.cars as car, i (i)}
            <g transform="translate({car.x} {car.y}) rotate({car.angle})" style="opacity:{car.opacity}">
              {#if i === 0}
                <!-- locomotive: cab windows, chimney, front coupler -->
                <rect x="-9" y="-6" width="18" height="12" rx="3" fill="#1b1b1b" stroke={train.color} stroke-width="2" />
                <rect x="1" y="-4.2" width="5" height="3.4" fill="#e9f3ff" />
                <rect x="1" y="0.8" width="5" height="3.4" fill="#e9f3ff" />
                <circle cx="-5" cy="0" r="2.2" fill={train.color} />
                <rect x="9" y="-1.4" width="3" height="2.8" fill="#3a3a3a" />
              {:else}
                <!-- boxcar -->
                <rect x="-7" y="-5.2" width="14" height="10.4" rx="2.4" fill="#242424" stroke={train.color} stroke-width="1.6" />
                <line x1="0" y1="-5.2" x2="0" y2="5.2" stroke={train.color} stroke-width="1" opacity="0.5" />
              {/if}
            </g>
          {/each}
        </g>
      {/if}
      {#each coins as coin (coin.id)}
        <g transform="translate({coin.x} {coin.y})">
          <g transform="rotate({-$rotAnim})">
            <g class="coin">
              <circle r="11" fill="#f5c542" stroke={coin.color} stroke-width="2" />
              <text y="3.5" text-anchor="middle" class="coint">{coin.val > 0 ? coin.val : '¥'}</text>
            </g>
          </g>
        </g>
      {/each}

      {#if flying}
        <g
          class="flyer"
          transform="translate({flying.on ? flying.to.x : flying.from.x} {flying.on ? flying.to.y : flying.from.y}) scale({flying.on ? 1 : 0.4})"
          style="opacity:{flying.on ? 1 : 0.2}"
        >
          <polygon points={poly} fill="#f3cf3e" stroke="#4a4332" stroke-width="1" />
          <g clip-path="url(#hexclip)">
            {#each tilePaths(flying.id, flying.rotation) as p}
              <path d={pathD(p)} class="ties" />
              <path d={pathD(p)} class="rail" />
            {/each}
          </g>
        </g>
      {/if}
      </g>
    </svg>
  </div>

  {#if canBuild && selectedAnchor}
    <!-- preview controls: icon-only rotate, green check to place, x to cancel -->
    <div class="layctl buildctl" style="left:{buildPos.x}px; top:{buildPos.y}px">
      <button class="rot" onclick={rotateSel} title="Rotate 60°" aria-label="Rotate">⟳</button>
      <button class="ok" onclick={confirmBuild} title="Place tile" aria-label="Place" disabled={!selectedLegal}>✓</button>
      <button class="cancel" onclick={cancelBuild} title="Cancel" aria-label="Cancel">✕</button>
    </div>
  {/if}

  {#if introActive}
    <button class="introskip" onclick={skipIntro}>Building the map… Skip ⏭</button>
  {/if}

  <div class="controls">
    <button type="button" aria-label="Zoom in" onclick={() => zoomCenter(1 / mapView.zoomButtonFactor)}>+</button>
    <button type="button" aria-label="Zoom out" onclick={() => zoomCenter(mapView.zoomButtonFactor)}>−</button>
    <button type="button" aria-label="Rotate map" title="Rotate map" onclick={rotateMap}>⟳</button>
    <button type="button" aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} title="Fullscreen" onclick={toggleFullscreen}>
      {isFullscreen ? '⤢' : '⛶'}
    </button>
  </div>

  {#if tip}
    <div class="tip" style="left:{tip.x}px; top:{tip.y}px">
      <strong>{tip.coord}</strong>{#if tip.name} · {tip.name}{/if}
    </div>
  {/if}

  {#if layMode && layHex && !preview}
    <div class="layctl" style="left:{fanPos.x}px; top:{fanPos.y}px">
      <button class="cancel" onclick={cancelLay} title="Cancel">× cancel</button>
    </div>
  {/if}

  {#if layMode && layHex && preview}
    <!-- preview controls: rotate / confirm / cancel -->
    <div class="layctl" style="left:{fanPos.x}px; top:{fanPos.y}px">
      <button onclick={rotatePreview} title="Rotate" disabled={preview.rotations.length < 2}>⟳ rotate</button>
      <button class="ok" onclick={confirmLay} title="Confirm">✓ place</button>
      <button class="cancel" onclick={cancelLay} title="Cancel">×</button>
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
    width: 100%;
    /* click-drag pans the map; never let the drag select hex names/labels */
    user-select: none;
    -webkit-user-select: none;
  }
  /* As a background layer the wrap fills its parent; ignore the inline aspect-ratio. */
  .wrap.fill {
    width: 100%;
    height: 100%;
    aspect-ratio: auto !important;
  }
  .wrap.fill .sea {
    border-radius: 0;
  }
  /* A full-screen modal covers the map: stop painting it (and its water
     animation) entirely while hidden. */
  .wrap.paused .sea {
    display: none;
  }
  /* As a background the right edge hosts the panel shell, so park the controls
     bottom-left where they stay reachable. */
  .wrap.fill .controls {
    right: auto;
    left: 14px;
    bottom: 14px;
  }
  /* lift the controls clear of the operating bottom sheet (mobile) so its drag
     handle / status header never sits under them. */
  .wrap.fill.liftctrl .controls {
    bottom: 58px;
  }
  .sea {
    position: relative;
    border-radius: 12px;
    overflow: hidden;
    /* deep-ocean base; world-space shallows + texture layer over it in the SVG */
    background-color: #1b6075;
    height: 100%;
  }
  .deep {
    fill: #1b6075;
  }
  /* The SVG is rendered with a PAN_OS (35%) overscan ring on every side (its
     viewBox is expanded to match), so a drag can slide real content in from
     beyond the visible edge. .sea (overflow:hidden) clips it back to the
     viewport, and clipping also confines pointer hit-testing to the visible
     area. will-change promotes it to its own layer so panning is a pure
     compositor translate (no re-raster). */
  .map {
    position: absolute;
    left: -35%;
    top: -35%;
    width: 170%;
    height: 170%;
    display: block;
    touch-action: none;
    cursor: grab;
    will-change: transform;
  }
  .map.grabbing {
    cursor: grabbing;
  }
  .introskip {
    position: absolute;
    left: 50%;
    bottom: 70px;
    transform: translateX(-50%);
    z-index: 6;
    padding: 0.45rem 0.9rem;
    border-radius: 999px;
    border: 1px solid #c9971f;
    background: #f5c542;
    color: #1b1b1b;
    font: 700 0.82rem ui-sans-serif, sans-serif;
    cursor: pointer;
  }
  .coast .foam {
    fill: none;
    stroke: #ffffff;
    stroke-linecap: round;
    opacity: 0;
    /* the wrapping <g> is translated to the ocean centre, so the line's local
       origin IS that centre: a plain scale() about (0,0) spawns the wave there
       and grows it to the shore. No custom-property transforms -> the keyframe
       is a static value the compositor can interpolate without style recalc. */
    transform-box: view-box;
    transform-origin: 0 0;
    /* duration + (negative) delay are per segment, set inline */
    animation: wavepulse 7s linear infinite;
  }
  /* While panning/zooming, freeze the surf (rather than hiding it) so the map
     layer stays static and the pan composites without re-rastering for the
     animation. The foam stays visible - no blink - and resumes on settle. */
  .wrap.interacting .coast .foam {
    animation-play-state: paused;
  }
  /* scale the shore-edge line about its local origin (the ocean hex centre): the
     wave spawns at HALF the distance to the shore (clamped: never nearer the
     centre than 50%), its endpoints ride the centre->vertex triangle sides, and
     it lands exactly on the shore edge as it fades. */
  @keyframes wavepulse {
    0% {
      opacity: 0;
      transform: scale(0.5);
    }
    30% {
      opacity: 0.55;
    }
    75% {
      opacity: 0.5;
    }
    100% {
      opacity: 0;
      transform: scale(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .coast .foam {
      animation: none;
      opacity: 0.3;
    }
  }
  .homeres {
    opacity: 0.38;
  }
  .costlbl {
    font: 700 7px ui-sans-serif, sans-serif;
    fill: #6d3f12;
    paint-order: stroke;
    stroke: rgba(243, 238, 222, 0.8);
    stroke-width: 1.6;
  }
  /* per-hex coordinate, printed on the tile's bottom edge at close zoom */
  .coordlbl {
    font: 700 5.5px ui-monospace, monospace;
    fill: #0e3942;
    opacity: 0;
    transition: opacity 250ms ease;
    pointer-events: none;
    user-select: none;
    paint-order: stroke;
    stroke: rgba(243, 238, 222, 0.75);
    stroke-width: 1.4;
  }
  .coordlbl.show {
    opacity: 0.75;
  }
  .hex {
    cursor: inherit;
  }
  .hex:focus,
  .hex:focus-visible {
    outline: none;
  }
  .tile {
    transition: fill 130ms ease;
  }
  /* a tile someone just laid lands with a quick fade + pop */
  .hex.placing {
    animation: tileland 0.45s ease both;
  }
  .hex.placing .tile {
    transform-box: fill-box;
    transform-origin: center;
    animation: tilepop 0.5s cubic-bezier(0.34, 1.5, 0.5, 1) both;
  }
  @keyframes tileland {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes tilepop {
    from {
      transform: scale(0.3);
    }
    to {
      transform: scale(1);
    }
  }
  .selring {
    fill: none;
    stroke: #15252f;
    stroke-width: 3;
    pointer-events: none;
  }
  .layhi {
    fill: rgba(63, 182, 168, 0.28);
    stroke: #3fb6a8;
    stroke-width: 3;
    pointer-events: none;
    animation: laypulse 1.4s ease-in-out infinite;
  }
  .tokenhi {
    fill: rgba(245, 197, 66, 0.28);
    stroke: var(--rail, #f5c542);
    stroke-width: 3;
    pointer-events: none;
    animation: laypulse 1.4s ease-in-out infinite;
  }
  /* spotlight a generated terrain / laid-tile group hovered in the Tiles panel */
  .spothi {
    fill: rgba(95, 176, 230, 0.35);
    stroke: #5fb0e6;
    stroke-width: 4;
    pointer-events: none;
  }
  /* "choose a space" highlight (home/token pick on the real map) */
  .pickhi {
    fill: rgba(245, 197, 66, 0.3);
    stroke: var(--rail, #f5c542);
    stroke-width: 4;
    cursor: pointer;
    animation: laypulse 1.4s ease-in-out infinite;
  }
  .laysel {
    fill: rgba(245, 197, 66, 0.25);
    stroke: var(--rail, #f5c542);
    stroke-width: 3;
    pointer-events: none;
  }
  /* tile placement outline: green = legal, red = illegal */
  .tilepreview {
    pointer-events: none;
  }
  /* hex under the cursor while building - shows where a tile will land */
  .hoverhex {
    fill: rgba(255, 255, 255, 0.16);
    stroke: #ffffff;
    stroke-width: 2.5;
    pointer-events: none;
  }
  .okline {
    fill: rgba(74, 195, 110, 0.2);
    stroke: #2fae5e;
    stroke-width: 3.5;
  }
  .badline {
    fill: rgba(224, 101, 92, 0.16);
    stroke: #e0655c;
    stroke-width: 3.5;
    stroke-dasharray: 6 4;
  }
  .previewtile {
    pointer-events: none;
    filter: drop-shadow(0 3px 5px rgba(0, 0, 0, 0.4));
    animation: tiledrop 0.32s cubic-bezier(0.34, 1.4, 0.5, 1);
  }
  .previewspin {
    transform-origin: 0 0;
    transition: transform 0.28s cubic-bezier(0.34, 1.3, 0.5, 1);
  }
  @keyframes tiledrop {
    0% {
      opacity: 0.2;
    }
    100% {
      opacity: 1;
    }
  }
  .fanhex {
    cursor: pointer;
    filter: drop-shadow(0 3px 5px rgba(0, 0, 0, 0.45));
    animation: tiledrop 0.2s ease-out;
  }
  /* Out-of-supply tiles: darkened and not selectable, but still shown so the
     player can see the option exists and that 0 copies remain. */
  .fanhex.exhausted {
    cursor: not-allowed;
    opacity: 0.4;
    filter: grayscale(0.85) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.4));
  }
  .fanid {
    font: 700 13px ui-sans-serif, sans-serif;
    fill: #1b1b1b;
    text-anchor: middle;
    paint-order: stroke;
    stroke: #fff;
    stroke-width: 3;
    pointer-events: none;
  }
  .fanleft {
    font: 700 11px ui-sans-serif, sans-serif;
    fill: #9fe0c0;
    paint-order: stroke;
    stroke: #0b1622;
    stroke-width: 3;
    pointer-events: none;
  }
  .fanleft.none {
    fill: #ff9a8e;
  }
  .layctl {
    position: absolute;
    z-index: 14;
    pointer-events: none;
    display: flex;
    gap: 0.3rem;
    transform: translate(-50%, 40px);
  }
  .layctl button {
    pointer-events: auto;
    padding: 0.35rem 0.6rem;
    border-radius: 7px;
    border: 1px solid var(--line, #243240);
    background: rgba(17, 32, 44, 0.95);
    color: var(--ink, #e8eef4);
    font: 700 0.78rem ui-sans-serif, sans-serif;
    cursor: pointer;
    white-space: nowrap;
  }
  .layctl button.ok {
    background: var(--rail, #f5c542);
    color: #1b1b1b;
    border-color: var(--rail-deep, #c9971f);
  }
  .layctl button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  /* map-build controls: friendly round icon buttons */
  .buildctl {
    gap: 0.4rem;
  }
  .buildctl button {
    width: 40px;
    height: 40px;
    padding: 0;
    border-radius: 50%;
    font-size: 1.3rem;
    line-height: 1;
    display: grid;
    place-items: center;
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.35);
    transition: transform 0.12s ease, background 0.12s ease;
  }
  .buildctl button:hover:not(:disabled) {
    transform: translateY(-2px);
  }
  .buildctl .ok {
    background: #3fb56a;
    color: #fff;
    border-color: #2f8d52;
    font-size: 1.4rem;
  }
  .buildctl .ok:hover:not(:disabled) {
    background: #49c878;
  }
  .buildctl .cancel {
    color: #f0b3ad;
    font-size: 1.05rem;
  }
  .flyer {
    pointer-events: none;
    transition:
      transform 0.6s cubic-bezier(0.34, 1.3, 0.5, 1),
      opacity 0.45s ease;
    filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.4));
  }
  .train {
    pointer-events: none;
    filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.5));
  }
  .portal {
    pointer-events: none;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
  }
  .cityglow {
    pointer-events: none;
    fill: none;
    stroke-width: 3;
    transform-box: fill-box;
    transform-origin: center;
    animation: cityglow 1.2s ease-out forwards;
  }
  @keyframes cityglow {
    0% {
      opacity: 0;
      stroke-width: 5;
      transform: scale(0.7);
    }
    30% {
      opacity: 0.9;
      stroke-width: 4;
      transform: scale(1.05);
    }
    100% {
      opacity: 0;
      stroke-width: 1;
      transform: scale(1.5);
    }
  }
  .coin {
    pointer-events: none;
    animation: coinpop 0.9s ease-out forwards;
  }
  .coint {
    font: 700 9px ui-sans-serif, sans-serif;
    fill: #1b1b1b;
  }
  @keyframes coinpop {
    0% {
      opacity: 0;
      transform: translateY(0) scale(0.5);
    }
    25% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      transform: translateY(-22px) scale(1);
    }
  }
  @keyframes laypulse {
    0%,
    100% {
      fill-opacity: 0.45;
    }
    50% {
      fill-opacity: 0.12;
    }
  }
  .ties {
    fill: none;
    stroke: #111;
    stroke-width: 9;
    stroke-dasharray: 2 5;
    stroke-linecap: butt;
  }
  .rail {
    fill: none;
    stroke: #111;
    stroke-width: 3.4;
    stroke-linecap: round;
  }
  /* Thin coloured stripe inside the rail (narrower than it), in the train's colour. */
  .routeline {
    fill: none;
    stroke-width: 1.7;
    stroke-linecap: round;
  }
  .routestop {
    fill: none;
    stroke: #ffd23f;
    stroke-width: 2.5;
    opacity: 0.9;
    pointer-events: none;
    animation: stoppulse 1.4s ease-in-out infinite;
  }
  @keyframes stoppulse {
    0%, 100% { opacity: 0.35; }
    50% { opacity: 0.95; }
  }
  .city {
    fill: #fbfbf7;
    stroke: #2b2b2b;
    stroke-width: 2;
  }
  .ping {
    pointer-events: none;
  }
  .ping circle {
    fill: none;
  }
  .pingdot {
    fill: #f5c542;
    stroke: #1c2a36;
    stroke-width: 1.5;
  }
  .ping1,
  .ping2 {
    stroke: #f5c542;
    stroke-width: 3;
    transform-box: fill-box;
    transform-origin: center;
    animation: pingpulse 1.6s ease-out infinite;
  }
  .ping2 {
    animation-delay: 0.8s;
  }
  @keyframes pingpulse {
    0% {
      transform: scale(0.5);
      opacity: 0.9;
    }
    100% {
      transform: scale(2.6);
      opacity: 0;
    }
  }
  .capstar {
    fill: #f5c542;
    stroke: #1c2a36;
    stroke-width: 1.2;
    stroke-linejoin: round;
  }
  .town {
    fill: #1b1b1b;
    stroke: #1b1b1b;
    stroke-width: 1.5;
  }
  .rev {
    font: 700 11px ui-sans-serif, sans-serif;
    fill: #1b1b1b;
    paint-order: stroke;
    stroke: #fff;
    stroke-width: 3;
  }
  .off {
    font: 700 11px ui-sans-serif, sans-serif;
    paint-order: stroke;
    stroke: #fff;
    stroke-width: 2.5;
  }
  .tok {
    font: 700 8px ui-sans-serif, sans-serif;
    fill: #fff;
  }
  .label {
    font: 700 13px ui-sans-serif, sans-serif;
    fill: #1b1b1b;
  }
  .name {
    font: 600 9px ui-sans-serif, sans-serif;
    fill: #1c2a36;
    paint-order: stroke;
    stroke: #e9e6c4;
    stroke-width: 2.5;
  }
  .controls {
    position: absolute;
    right: 28px;
    bottom: 28px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    z-index: 5;
  }
  .controls button {
    width: 34px;
    height: 34px;
    border-radius: 8px;
    border: 1px solid var(--line, #243240);
    background: rgba(17, 32, 44, 0.85);
    color: #fff;
    font-size: 1.1rem;
    line-height: 1;
    cursor: pointer;
  }
  .controls button:hover {
    border-color: var(--rail-deep, #c9971f);
  }
  .tip {
    position: absolute;
    transform: translate(-50%, -50%);
    background: #11202c;
    color: #fff;
    border: 1px solid var(--rail-deep, #c9971f);
    border-radius: 7px;
    padding: 0.25rem 0.5rem;
    font: 600 0.78rem ui-sans-serif, sans-serif;
    white-space: nowrap;
    pointer-events: none;
    z-index: 10;
  }
  .tip strong {
    color: var(--rail, #f5c542);
    font-family: ui-monospace, monospace;
  }
</style>
