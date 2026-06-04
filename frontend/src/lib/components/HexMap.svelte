<script lang="ts">
  import { onMount } from 'svelte';
  import { tweened } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import type { HexDef, PathPart, TileColor } from '$lib/data/types';
  import { HEX_SIZE, APOTHEM, hexCenter, hexPolygon, edgeMidpoint } from '$lib/hexgeo';
  import { mapView } from '$lib/config/mapView';
  import { game } from '$lib/game/sandbox.svelte';
  import { anim } from '$lib/game/anim.svelte';
  import { routing } from '$lib/game/routing.svelte';
  import { TILES, rotatePaths, trackLays, tokenPlays, corpRoutes, routeThroughStops, tileSupply, exhaustedTilesOnHex, configFor, placementCoords, isLegalPlacement } from '$lib/engine';
  import TileGraphic from './TileGraphic.svelte';

  // The active board: a procedurally-built RoLA runtime map (state.map), or the
  // title's static map. Hex structure is stable for a game, captured on mount.
  const activeMap = $derived(game.state.map ?? configFor(game.title).hexByCoord);
  const HEX_LIST = $derived(Object.values(activeMap));

  // RoLA Manual map-build: click anywhere on the grid to position the next tile;
  // a green outline = legal, red = illegal. When green, confirm to lay it.
  const building = $derived(game.state.round === 'mapbuild');
  const canBuild = $derived(building && !!game.active && !game.isBot(game.active) && !game.reviewing);
  // The next tile's three cells (so the preview shows what is actually being placed).
  const nextCells = $derived(game.state.mapBuild?.pool[0]?.cells ?? null);

  let selectedAnchor = $state<string | null>(null);
  let spin = $state(0); // cumulative 60-degree steps, so rotation animates smoothly
  const selectedRotation = $derived(((spin % 6) + 6) % 6);
  const validRotationsAt = (anchor: string) =>
    [0, 1, 2, 3, 4, 5].filter((r) => isLegalPlacement(activeMap, anchor, r));
  const selectedLegal = $derived(
    !!selectedAnchor && isLegalPlacement(activeMap, selectedAnchor, selectedRotation)
  );
  // Tweened spin angle (degrees) so the tri-hex rotates smoothly to each orientation.
  const spinAngle = tweened(0, { duration: 240, easing: cubicOut });
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
    selectedAnchor = anchor;
    spin = validRotationsAt(anchor)[0] ?? 0; // prefer a legal orientation
    spinAngle.set(spin * 60, { duration: 0 }); // snap (no spin) on a fresh selection
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
    const c = hexCenter(selectedAnchor);
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
    runMode = false
  }: { layMode?: boolean; tokenMode?: boolean; runMode?: boolean } = $props();
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
    const c = hexCenter(layHex);
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
  function peaks(coord: string): Array<{ x: number; s: number }> {
    const r = rngFor(coord + 'm');
    const n = 2 + Math.floor(r() * 2);
    const out = [];
    for (let i = 0; i < n; i++) out.push({ x: -14 + i * 13 + r() * 4, s: 9 + r() * 5 });
    return out;
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

  const RIPPLES: Array<[number, number, string]> = [
    [4, 6, '#9bd6d1'],
    [24, 11, '#bdeae6'],
    [14, 20, '#9bd6d1'],
    [33, 23, 'rgba(255,255,255,.5)'],
    [1, 16, 'rgba(255,255,255,.35)']
  ];

  const HOME = $derived(new Map(game.state.corporations.map((c) => [c.coordinates, c])));
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

  const pad = HEX_SIZE + 28;
  const xs = $derived(placed.map((p) => p.cx));
  const ys = $derived(placed.map((p) => p.cy));
  const minX = $derived(Math.min(...xs) - pad);
  const minY = $derived(Math.min(...ys) - pad);
  const width = $derived(Math.max(...xs) - Math.min(...xs) + pad * 2);
  const height = $derived(Math.max(...ys) - Math.min(...ys) + pad * 2);

  const labels = $derived.by(() => {
    const colLabels = new Map<string, number>();
    const rowLabels = new Map<number, number>();
    for (const p of placed) {
      const m = p.coord.match(/^([A-Za-z]+)(\d+)$/)!;
      colLabels.set(m[1], p.cx);
      rowLabels.set(parseInt(m[2], 10), p.cy);
    }
    return { colLabels, rowLabels };
  });
  const cols = $derived([...labels.colLabels.entries()].sort((a, b) => a[1] - b[1]));
  const rows = $derived([...labels.rowLabels.entries()].sort((a, b) => a[1] - b[1]));

  const poly = hexPolygon(0, 0);

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
  // During map building, frame ~11 hexes end-to-end (a 5-tile radius) centred on
  // the built map - generous padding so placement is comfortable, and the zoom-in
  // cap (MIN_W) below keeps it from ever getting closer than this.
  const BUILD_VIEW = 17 * HEX_SIZE;
  $effect(() => {
    if (building) {
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const w = Math.max(BUILD_VIEW, width + 2 * pad);
      view = { x: cx - w / 2, y: cy - w / 2, w, h: w };
    } else if (!fittedOnce) {
      view = { x: minX, y: minY, w: width, h: height };
      fittedOnce = true;
    }
  });
  let dragging = $state(false);
  let rotation = $state(0); // whole-map rotation in degrees (rotate button)
  let isFullscreen = $state(false);
  // On a quarter turn the landscape map would overflow the frame, so shrink it to fit.
  const onQuarterTurn = $derived(((rotation % 180) + 180) % 180 === 90);
  const fitScale = $derived(onQuarterTurn ? Math.min(width / height, height / width) : 1);
  // While building, cap max zoom-IN at the 11-tile frame (you can still zoom out).
  const MIN_W = $derived(building ? BUILD_VIEW : width * mapView.minZoomFraction); // max zoom in
  const MAX_W = $derived(
    building ? Math.max(BUILD_VIEW, width + 2 * pad) * 2 : width * mapView.maxZoomFraction
  ); // max zoom out
  const pointers = new Map<number, { x: number; y: number }>();
  let moved = false;
  let viewRaf = 0; // in-flight animated-view frame

  // Keep the view within the map bounds, leaving a little wiggle room past the
  // edge (mapView.edgeMargin). While laying a tile, allow a larger margin so the
  // fan of options (which sits outside the chosen hex) stays reachable.
  function clamped(v: { x: number; y: number; w: number; h: number }) {
    let { x, y, w, h } = v;
    const m = (layHex ? mapView.layFanMargin : mapView.edgeMargin) * HEX_SIZE;
    if (w >= width + 2 * m) x = minX - (w - width) / 2;
    else x = Math.min(Math.max(x, minX - m), minX + width - w + m);
    if (h >= height + 2 * m) y = minY - (h - height) / 2;
    else y = Math.min(Math.max(y, minY - m), minY + height - h + m);
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
    const c = hexCenter(hex);
    const targetW = Math.min(MAX_W, Math.max(MIN_W, HEX_SIZE * 10));
    const targetH = targetW * (height / width);
    animateView({ x: c.x - targetW / 2, y: c.y - targetH / 2, w: targetW, h: targetH });
  }

  /** Map a client point to SVG user coordinates, honouring the CSS rotation. */
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
    const p = clientToSvg(clientX, clientY);
    const fx = (p.x - view.x) / view.w;
    const fy = (p.y - view.y) / view.h;
    const nw = Math.max(MIN_W, Math.min(MAX_W, view.w * factor));
    const nh = view.h * (nw / view.w);
    view = clamped({ x: p.x - fx * nw, y: p.y - fy * nh, w: nw, h: nh });
  }
  /** Zoom toward the viewport centre, animated (used by the +/- buttons). */
  function zoomCenter(factor: number) {
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
    rotation = (rotation + mapView.rotationStepDeg) % 360;
  }
  function toggleFullscreen() {
    if (!document.fullscreenElement) wrap?.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  }

  // Coordinate guides: pinned to the viewport edges, sliding along their axis to
  // stay aligned with each column/row as the map pans/zooms.
  let colMarks = $derived(
    cols.map(([l, x]) => ({ l, f: (x - view.x) / view.w })).filter((m) => m.f >= 0 && m.f <= 1)
  );
  let rowMarks = $derived(
    rows.map(([n, y]) => ({ n, f: (y - view.y) / view.h })).filter((m) => m.f >= 0 && m.f <= 1)
  );

  function onDown(e: PointerEvent) {
    stopViewAnim();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    if (pointers.size === 1) dragging = true;
  }
  function onMove(e: PointerEvent) {
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
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      moved = true;
      hide();
    }
    // Pan in SVG space (rotation-aware): keep the point under the cursor put.
    const p0 = clientToSvg(prev.x, prev.y);
    const p1 = clientToSvg(e.clientX, e.clientY);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    view = clamped({ ...view, x: view.x - (p1.x - p0.x), y: view.y - (p1.y - p0.y) });
  }
  function onUp(e: PointerEvent) {
    const wasDrag = moved;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) dragging = false;
    if (!wasDrag) {
      // Map building: a tap anywhere on the grid positions the next tile.
      if (canBuild) {
        const sp = clientToSvg(e.clientX, e.clientY);
        selectAnchor(hexAt(sp.x, sp.y));
        return;
      }
      const el = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest('g.hex') as
        | SVGGraphicsElement
        | null;
      const coord = el?.getAttribute('data-coord') ?? null;
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
    const onFs = () => (isFullscreen = document.fullscreenElement === wrap);
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

<div class="wrap" bind:this={wrap} style="aspect-ratio: {width} / {height}">
  <div class="sea">
    <svg
      class="map"
      class:grabbing={dragging}
      bind:this={svgEl}
      viewBox="{view.x} {view.y} {view.w} {view.h}"
      style="transform: rotate({rotation}deg) scale({fitScale}); transform-origin: center; transition: transform {mapView.rotationAnimMs}ms ease;"
      role="application"
      aria-label="1889 Shikoku map (drag to pan, scroll to zoom)"
      onpointerdown={onDown}
      onpointermove={onMove}
      onpointerup={onUp}
      onpointercancel={onUp}
    >
      <defs>
        <clipPath id="hexclip"><polygon points={poly} /></clipPath>
        <clipPath id="cityclip"><circle r="12.5" /></clipPath>
        <pattern id="ripples" width="40" height="28" patternUnits="userSpaceOnUse">
          <rect width="40" height="28" fill="#74c1be" />
          {#each RIPPLES as [x, y, fill]}
            <rect x={x} y={y + 2} width="4" height="2" {fill} />
            <rect x={x + 4} y={y} width="4" height="2" {fill} />
            <rect x={x + 8} y={y + 2} width="4" height="2" {fill} />
          {/each}
          <animateTransform attributeName="patternTransform" type="translate" from="0 0" to="40 28" dur="9s" repeatCount="indefinite" />
        </pattern>
      </defs>

      <!-- animated water: covers the whole visible viewBox (3x, centred) at any zoom -->
      <rect x={view.x - view.w} y={view.y - view.h} width={view.w * 3} height={view.h * 3} fill="url(#ripples)" />

      {#each placed as h (h.coord)}
        <g
          class="hex"
          data-coord={h.coord}
          data-name={h.name ?? ''}
          transform="translate({h.cx} {h.cy})"
          role="button"
          tabindex="-1"
          aria-label="{h.coord}{h.name ? ` ${h.name}` : ''}"
          onpointerenter={(e) => e.pointerType === 'mouse' && pointers.size === 0 && show(e.currentTarget, h.coord, h.name)}
          onpointerleave={(e) => e.pointerType === 'mouse' && !dragging && hide()}
        >
          <polygon points={poly} class="tile" fill={laid(h.coord) ? tfill(laidDef(h.coord)?.color ?? 'yellow') : tip?.coord === h.coord ? thover(h.color) : tfill(h.color)} stroke="#4a4332" stroke-width="1" />

          {#if layMode && layHexes.has(h.coord)}
            <polygon points={poly} class="layhi" />
          {/if}
          {#if tokenMode && tokenHexes.has(h.coord)}
            <polygon points={poly} class="tokenhi" />
          {/if}
          {#if runMode && isStopHex(h.coord)}
            <circle r="17" class="routestop" />
          {/if}

          {#if h.terrain?.includes('water')}
            <polygon points={poly} fill="#2f6f96" opacity="0.32" />
            {#each [-7, 1, 9] as wy}
              <path d="M -13 {wy} q 4 -3 8 0 q 4 3 8 0 q 4 -3 8 0" class="wave" />
            {/each}
          {/if}

          {#if h.terrain?.includes('mountain')}
            {#each peaks(h.coord) as pk}
              <path d="M {pk.x} 14 L {pk.x + pk.s / 2} {14 - pk.s} L {pk.x + pk.s} 14 Z" fill="#7d6a47" />
              <path d="M {pk.x + pk.s / 2} {14 - pk.s} L {pk.x + pk.s} 14 L {pk.x + pk.s * 0.62} 14 Z" fill="#5c4d31" />
              <path
                d="M {pk.x + pk.s / 2} {14 - pk.s} l {pk.s * 0.16} {pk.s * 0.34} l {pk.s * 0.18} -{pk.s * 0.12} l {pk.s * 0.16} {pk.s * 0.2}"
                fill="none"
                stroke="#efe9da"
                stroke-width="1"
                opacity="0.8"
              />
            {/each}
          {/if}

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
            {#if def && def.cities > 0}
              <circle r="13" class="city" />
              {#if def.revenue > 0}<text class="rev" y="-17" text-anchor="middle">{def.revenue}</text>{/if}
            {:else if def && def.towns > 0}
              <rect x="-9" y="-4" width="18" height="8" rx="2" class="town" transform="rotate(30)" />
              {#if def.revenue > 0}<text class="rev" y="-15" text-anchor="middle">{def.revenue}</text>{/if}
            {/if}
          {/if}

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
              {#if c.revenue > 0}<text class="rev" y="-17" text-anchor="middle">{c.revenue}</text>{/if}
              {#if c.slots === 1 && !HOME.has(h.coord)}
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

          {#each tokensOn(h.coord) as t, ti (t.sym)}
            <g transform="translate({ti * 11 - (tokensOn(h.coord).length - 1) * 5.5} 0)">
              <circle r="9" fill={t.color} stroke="#fff" stroke-width="1.5" />
              <text class="tok" y="3" text-anchor="middle">{t.sym}</text>
            </g>
          {/each}

          {#if h.label}
            {@const lp = labelPos(h)}
            <text class="label" x={lp.x} y={lp.y + 4} text-anchor="middle">{h.label}</text>
          {/if}
          {#if h.name}<text class="name" y={APOTHEM - 6} text-anchor="middle">{h.name}</text>{/if}
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

      <!-- outline of the tile at the clicked slot: green if legal, red if not. The
           base (rotation 0) layout is spun by the tweened angle around the anchor so
           rotation animates through the six 60-degree orientations. -->
      {#if canBuild && selectedAnchor && nextCells}
        {@const piv = hexCenter(selectedAnchor)}
        <g class="tilepreview" transform="rotate({$spinAngle} {piv.x} {piv.y})">
          {#each placementCoords(selectedAnchor, 0) as c, i (i)}
            {@const ctr = hexCenter(c)}
            <g transform="translate({ctr.x} {ctr.y})">
              <polygon points={poly} class={selectedLegal ? 'okline' : 'badline'} />
              {@render cellMarks(nextCells[i])}
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
          {#if def.revenue > 0}<text class="rev" y="-15" text-anchor="middle">{def.revenue}</text>{/if}
        {:else if def.towns > 0}
          <rect x="-9" y="-4" width="18" height="8" rx="2" class="town" transform="rotate(30)" />
          {#if def.revenue > 0}<text class="rev" y="-14" text-anchor="middle">{def.revenue}</text>{/if}
        {/if}
        {#if def.label}<text class="label" x={APOTHEM - 9} y={-APOTHEM + 17} text-anchor="middle">{def.label}</text>{/if}
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
          <!-- dim the board so the floating option tiles read clearly -->
          <rect
            x={view.x} y={view.y} width={view.w} height={view.h}
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
              <text class="fanid" y={APOTHEM - 4} text-anchor="middle">#{entry.tile}</text>
              <text class="fanleft" class:none={entry.left === 0} y={-APOTHEM - 6} text-anchor="middle">
                {entry.left} left
              </text>
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
          <g class="coin">
            <circle r="11" fill="#f5c542" stroke={coin.color} stroke-width="2" />
            <text y="3.5" text-anchor="middle" class="coint">{coin.val > 0 ? coin.val : '¥'}</text>
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
    </svg>
  </div>

  <!-- coordinate guides pinned to the four edges (hidden while the map is turned) -->
  {#if rotation === 0}
    <div class="guides" aria-hidden="true">
      {#each colMarks as m (m.l)}
        <span class="g top" style="left:{m.f * 100}%">{m.l}</span>
        <span class="g bot" style="left:{m.f * 100}%">{m.l}</span>
      {/each}
      {#each rowMarks as m (m.n)}
        <span class="g left" style="top:{m.f * 100}%">{m.n}</span>
        <span class="g right" style="top:{m.f * 100}%">{m.n}</span>
      {/each}
    </div>
  {/if}

  {#if canBuild && selectedAnchor}
    <!-- preview controls: rotate / place / cancel (like the 1889 tile lay) -->
    <div class="layctl" style="left:{buildPos.x}px; top:{buildPos.y}px">
      <button onclick={rotateSel} title="Rotate 60°">⟳ rotate</button>
      <button class="ok" onclick={confirmBuild} title="Place" disabled={!selectedLegal}>✓ place</button>
      <button class="cancel" onclick={cancelBuild} title="Cancel">×</button>
    </div>
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
  }
  /* In fullscreen the wrap fills the screen; ignore the inline aspect-ratio. */
  .wrap:fullscreen {
    width: 100vw;
    height: 100vh;
    aspect-ratio: auto !important;
    background: #0c1620;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .wrap:fullscreen .sea {
    width: 100%;
    height: 100%;
    border-radius: 0;
  }
  .sea {
    border-radius: 12px;
    overflow: hidden;
    background-color: #74c1be;
    height: 100%;
  }
  .map {
    width: 100%;
    height: 100%;
    display: block;
    touch-action: none;
    cursor: grab;
  }
  .map.grabbing {
    cursor: grabbing;
  }
  .guides {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 4;
  }
  .g {
    position: absolute;
    font: 700 10px ui-monospace, monospace;
    color: #0e3942;
    background: rgba(255, 255, 255, 0.72);
    border-radius: 4px;
    padding: 0 3px;
    line-height: 15px;
  }
  .g.top {
    top: 3px;
    transform: translateX(-50%);
  }
  .g.bot {
    bottom: 3px;
    transform: translateX(-50%);
  }
  .g.left {
    left: 3px;
    transform: translateY(-50%);
  }
  .g.right {
    right: 3px;
    transform: translateY(-50%);
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
  .wave {
    fill: none;
    stroke: #cfeaff;
    stroke-width: 1;
    opacity: 0.5;
  }
  .city {
    fill: #fbfbf7;
    stroke: #2b2b2b;
    stroke-width: 2;
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
