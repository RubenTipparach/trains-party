<script lang="ts">
  import { onMount } from 'svelte';
  import { HEXES, HEX_BY_COORD } from '$lib/data/map1889';
  import { CORPORATIONS } from '$lib/data/g1889';
  import type { HexDef, PathPart, TileColor } from '$lib/data/types';
  import { HEX_SIZE, APOTHEM, hexCenter, hexPolygon, edgeMidpoint } from '$lib/hexgeo';
  import { game } from '$lib/game/sandbox.svelte';
  import { anim } from '$lib/game/anim.svelte';
  import { TILES, rotatePaths, trackLays } from '$lib/engine';
  import TileGraphic from './TileGraphic.svelte';

  // Optional: when in the operating-round track step, hexes that can receive a
  // tile are highlighted and clickable.
  let { layMode = false }: { layMode?: boolean } = $props();
  const lays = $derived(layMode ? trackLays(game.state) : []);
  const layHexes = $derived(new Set(lays.map((l) => l.hex)));
  function layOptions(hex: string) {
    return lays.filter((l) => l.hex === hex);
  }
  /** Distinct tile ids available on a hex. */
  function tileChoices(hex: string): string[] {
    return [...new Set(layOptions(hex).map((l) => l.tile))];
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
  // When a corporation pays a dividend, send a train across its network hexes,
  // popping a coin at each revenue centre.
  let train = $state<{ pts: { x: number; y: number }[]; at: number; running: boolean } | null>(null);
  let coins = $state<{ id: number; x: number; y: number }[]>([]);
  let coinId = 0;
  let lastLogLen = 0;

  function corpNetworkHexes(corpSym: string): string[] {
    const c = game.state.corporations.find((x) => x.sym === corpSym);
    if (!c) return [];
    // token hexes + any hex with track, as a simple ordered trail
    const set = new Set<string>(c.tokenHexes);
    for (const coord of Object.keys(game.state.tiles ?? {})) set.add(coord);
    // keep only this corp's reachable area cheaply: token hexes first
    return [...set];
  }

  async function runTrain(corpSym: string) {
    const hexes = corpNetworkHexes(corpSym);
    if (hexes.length === 0) return;
    const pts = hexes.map((h) => hexCenter(h));
    if (pts.length === 1) pts.push({ x: pts[0].x + 1, y: pts[0].y });
    train = { pts, at: 0, running: true };
    for (let i = 0; i < pts.length; i++) {
      train = { ...train, at: i };
      // pop a coin at city hexes
      const hx = hexes[i];
      const def = HEX_BY_COORD[hx];
      if (def && (def.cities.length || def.towns.length || game.state.tiles?.[hx])) {
        const id = ++coinId;
        coins = [...coins, { id, x: pts[i].x, y: pts[i].y }];
        setTimeout(() => (coins = coins.filter((c) => c.id !== id)), 900);
      }
      if (!(await anim.wait(260))) break; // skipped
    }
    train = null;
  }

  $effect(() => {
    const log = game.state.log;
    if (lastLogLen === 0) {
      lastLogLen = log.length;
      return;
    }
    const added = log.slice(lastLogLen);
    lastLogLen = log.length;
    if (!anim.on) return;
    const ran = added.find((l) => / runs for .* and pays a dividend/.test(l));
    if (ran) {
      const v = game.state.or;
      if (v) runTrain(v.order[v.index]);
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
    red: '#df6a5c'
  };

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
    red: '#ff7c6d'
  };

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

  const HOME = new Map(CORPORATIONS.map((c) => [c.coordinates, c]));

  type Placed = HexDef & { cx: number; cy: number };
  const placed: Placed[] = HEXES.map((h) => {
    const { x, y } = hexCenter(h.coord);
    return { ...h, cx: x, cy: y };
  });

  const xs = placed.map((p) => p.cx);
  const ys = placed.map((p) => p.cy);
  const pad = HEX_SIZE + 28;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const width = Math.max(...xs) - Math.min(...xs) + pad * 2;
  const height = Math.max(...ys) - Math.min(...ys) + pad * 2;

  const colLabels = new Map<string, number>();
  const rowLabels = new Map<number, number>();
  for (const p of placed) {
    const m = p.coord.match(/^([A-Za-z]+)(\d+)$/)!;
    colLabels.set(m[1], p.cx);
    rowLabels.set(parseInt(m[2], 10), p.cy);
  }
  const cols = [...colLabels.entries()].sort((a, b) => a[1] - b[1]);
  const rows = [...rowLabels.entries()].sort((a, b) => a[1] - b[1]);

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
  let view = $state({ x: minX, y: minY, w: width, h: height });
  let dragging = $state(false);
  const MIN_W = width * 0.18; // max zoom in
  const MAX_W = width; // max zoom out: the whole map fits, no further
  const pointers = new Map<number, { x: number; y: number }>();
  let moved = false;

  // Keep the view within the map bounds so you cannot pan/zoom into empty space.
  function clampView() {
    let { x, y, w, h } = view;
    if (w >= width) x = minX - (w - width) / 2;
    else x = Math.min(Math.max(x, minX), minX + width - w);
    if (h >= height) y = minY - (h - height) / 2;
    else y = Math.min(Math.max(y, minY), minY + height - h);
    view = { x, y, w, h };
  }

  function zoomAt(clientX: number, clientY: number, factor: number) {
    const r = svgEl.getBoundingClientRect();
    const fx = (clientX - r.left) / r.width;
    const fy = (clientY - r.top) / r.height;
    const px = view.x + fx * view.w;
    const py = view.y + fy * view.h;
    let nw = Math.max(MIN_W, Math.min(MAX_W, view.w * factor));
    const nh = view.h * (nw / view.w);
    view = { x: px - fx * nw, y: py - fy * nh, w: nw, h: nh };
    clampView();
  }
  function zoomCenter(factor: number) {
    const r = svgEl.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  }
  function reset() {
    view = { x: minX, y: minY, w: width, h: height };
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
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      moved = true;
      hide();
    }
    const r = svgEl.getBoundingClientRect();
    view = { ...view, x: view.x - (dx / r.width) * view.w, y: view.y - (dy / r.height) * view.h };
    clampView();
  }
  function onUp(e: PointerEvent) {
    const wasDrag = moved;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) dragging = false;
    if (!wasDrag) {
      const el = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest('g.hex') as
        | SVGGraphicsElement
        | null;
      const coord = el?.getAttribute('data-coord') ?? null;
      // In lay mode: tap the preview tile to rotate it; tap a highlighted hex to
      // start (or switch) a lay.
      if (layMode) {
        if (preview && coord === layHex) {
          rotatePreview();
          return;
        }
        if (coord && layHexes.has(coord)) {
          clickLayHex(coord);
          return;
        }
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
      zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 1.12 : 1 / 1.12);
    };
    svgEl.addEventListener('wheel', onWheel, { passive: false });
    return () => svgEl.removeEventListener('wheel', onWheel);
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

      <!-- animated water (enlarged so it stays visible while panning/zooming) -->
      <rect x={minX - width} y={minY - height} width={width * 3} height={height * 3} fill="url(#ripples)" />

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
          <polygon points={poly} class="tile" fill={laid(h.coord) ? '#f3cf3e' : tip?.coord === h.coord ? HOVER[h.color] : FILL[h.color]} stroke="#4a4332" stroke-width="1" />

          {#if layMode && layHexes.has(h.coord)}
            <polygon points={poly} class="layhi" />
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
            {/each}
          </g>

          {#if laidDef(h.coord)}
            {@const def = laidDef(h.coord)}
            <g clip-path="url(#hexclip)">
              {#each laidPaths(h.coord) as p}
                <path d={pathD(p)} class="ties" />
                <path d={pathD(p)} class="rail" />
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

          {#if HOME.has(h.coord)}
            {@const corp = HOME.get(h.coord)!}
            <circle r="11" fill={corp.color} stroke="#fff" stroke-width="1.5" />
            <text class="tok" y="3.2" text-anchor="middle">{corp.sym}</text>
          {/if}

          {#if h.label}
            {@const lp = labelPos(h)}
            <text class="label" x={lp.x} y={lp.y + 4} text-anchor="middle">{h.label}</text>
          {/if}
          {#if h.name}<text class="name" y={APOTHEM - 6} text-anchor="middle">{h.name}</text>{/if}
        </g>
      {/each}

      {#if tip}
        <g transform="translate({tip.hx} {tip.hy})">
          <polygon points={poly} class="selring" />
        </g>
      {/if}

      {#if train && train.pts[train.at]}
        <g class="train" transform="translate({train.pts[train.at].x} {train.pts[train.at].y})">
          <rect x="-11" y="-7" width="22" height="14" rx="3" fill="#1b1b1b" stroke="#f5c542" stroke-width="1.5" />
          <circle cx="-6" cy="8" r="2.4" fill="#f5c542" />
          <circle cx="6" cy="8" r="2.4" fill="#f5c542" />
          <rect x="-7" y="-4" width="5" height="5" fill="#3fb6a8" />
          <rect x="2" y="-4" width="5" height="5" fill="#3fb6a8" />
        </g>
      {/if}
      {#each coins as coin (coin.id)}
        <g transform="translate({coin.x} {coin.y})">
          <g class="coin">
            <circle r="8" fill="#f5c542" stroke="#c9971f" stroke-width="1.5" />
            <text y="3" text-anchor="middle" class="coint">¥</text>
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

  <!-- coordinate guides pinned to the four edges -->
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

  <div class="controls">
    <button type="button" aria-label="Zoom in" onclick={() => zoomCenter(1 / 1.25)}>+</button>
    <button type="button" aria-label="Zoom out" onclick={() => zoomCenter(1.25)}>−</button>
    <button type="button" aria-label="Reset view" onclick={reset}>⟳</button>
  </div>

  {#if tip}
    <div class="tip" style="left:{tip.x}px; top:{tip.y}px">
      <strong>{tip.coord}</strong>{#if tip.name} · {tip.name}{/if}
    </div>
  {/if}

  {#if layMode && layHex && !preview}
    <!-- radial fan of candidate tile types around the chosen hex -->
    <div class="fan" style="left:{fanPos.x}px; top:{fanPos.y}px">
      {#each tileChoices(layHex) as tile, i (tile)}
        {@const n = tileChoices(layHex).length}
        {@const ang = (-90 + (i - (n - 1) / 2) * 42) * (Math.PI / 180)}
        <button
          class="fantile"
          style="transform: translate(-50%,-50%) translate({Math.cos(ang) * 64}px, {Math.sin(ang) * 64}px)"
          onclick={() => pickTile(tile)}
          title="Tile {tile}"
        >
          <TileGraphic id={tile} />
        </button>
      {/each}
      <button class="fancancel" onclick={cancelLay} title="Cancel">×</button>
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
  .laysel {
    fill: rgba(245, 197, 66, 0.25);
    stroke: var(--rail, #f5c542);
    stroke-width: 3;
    pointer-events: none;
  }
  .fan,
  .layctl {
    position: absolute;
    transform: translate(-50%, -50%);
    z-index: 14;
    pointer-events: none;
  }
  .fantile {
    position: absolute;
    left: 0;
    top: 0;
    width: 52px;
    padding: 2px;
    border: 1px solid var(--rail-deep, #c9971f);
    border-radius: 8px;
    background: rgba(17, 32, 44, 0.95);
    cursor: pointer;
    pointer-events: auto;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
  }
  .fantile:hover {
    border-color: var(--rail, #f5c542);
  }
  .fancancel {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 1px solid var(--line, #243240);
    background: rgba(17, 32, 44, 0.95);
    color: var(--muted, #9fb0c0);
    cursor: pointer;
    pointer-events: auto;
  }
  .layctl {
    display: flex;
    gap: 0.3rem;
    transform: translate(-50%, 36px);
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
    transition: transform 0.26s linear;
    filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.5));
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
    fill: #fbfbf7;
    stroke: #2b2b2b;
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
    right: 10px;
    bottom: 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
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
  .chooser {
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: rgba(17, 32, 44, 0.95);
    border: 1px solid var(--rail-deep, #c9971f);
    border-radius: 10px;
    padding: 0.4rem 0.6rem;
    z-index: 12;
    max-width: 90%;
  }
  .chooser .cl {
    font: 600 0.78rem ui-sans-serif, sans-serif;
    color: #fff;
    white-space: nowrap;
  }
  .copts {
    display: flex;
    gap: 0.3rem;
    overflow-x: auto;
  }
  .copts button {
    width: 46px;
    flex: none;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    cursor: pointer;
    padding: 1px;
  }
  .copts button:hover {
    border-color: var(--rail, #f5c542);
  }
  .ccancel {
    background: none;
    border: none;
    color: var(--muted, #9fb0c0);
    font-size: 1.1rem;
    cursor: pointer;
    line-height: 1;
  }
</style>
