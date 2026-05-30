<script lang="ts">
  import { HEXES } from '$lib/data/map1889';
  import { CORPORATIONS } from '$lib/data/g1889';
  import type { HexDef, PathPart, TileColor } from '$lib/data/types';
  import { HEX_SIZE, APOTHEM, hexCenter, hexPolygon, edgeMidpoint } from '$lib/hexgeo';

  // Palette echoes the published 1889 board: olive/khaki land, teal sea.
  const FILL: Record<TileColor, string> = {
    white: '#cdcb92',
    yellow: '#f3cf3e',
    green: '#7cc36b',
    brown: '#c69b66',
    gray: '#aeb7bb',
    red: '#df6a5c'
  };

  // --- colour helpers (for 3D gradient fills) ------------------------------
  function adjust(hex: string, amt: number): string {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
    const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
    const b = Math.max(0, Math.min(255, (n & 255) + amt));
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }
  const colors = Object.keys(FILL) as TileColor[];

  // --- deterministic RNG for procedural city skylines ----------------------
  function rngFor(seed: string): () => number {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    let a = h >>> 0;
    return () => {
      a |= 0;
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

  // --- mountains (3D shaded glyphs) ----------------------------------------
  function peaks(coord: string): Array<{ x: number; s: number }> {
    const r = rngFor(coord + 'm');
    const n = 2 + Math.floor(r() * 2);
    const out = [];
    for (let i = 0; i < n; i++) out.push({ x: -14 + i * 13 + r() * 4, s: 9 + r() * 5 });
    return out;
  }

  const HOME = new Map(CORPORATIONS.map((c) => [c.coordinates, c]));

  type Placed = HexDef & { cx: number; cy: number };
  const placed: Placed[] = HEXES.map((h) => {
    const { x, y } = hexCenter(h.coord);
    return { ...h, cx: x, cy: y };
  });

  const xs = placed.map((p) => p.cx);
  const ys = placed.map((p) => p.cy);
  const pad = HEX_SIZE + 26;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const width = Math.max(...xs) - Math.min(...xs) + pad * 2;
  const height = Math.max(...ys) - Math.min(...ys) + pad * 2;

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
</script>

<div class="sea">
  <svg class="map" viewBox="{minX} {minY} {width} {height}" role="img" aria-label="1889 Shikoku map">
    <defs>
      {#each colors as c}
        <linearGradient id="g-{c}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={adjust(FILL[c], 26)} />
          <stop offset="1" stop-color={adjust(FILL[c], -22)} />
        </linearGradient>
      {/each}
      <clipPath id="hexclip"><polygon points={poly} /></clipPath>
      <clipPath id="cityclip"><circle r="12.5" /></clipPath>
    </defs>

    {#each placed as h (h.coord)}
      <g transform="translate({h.cx} {h.cy})">
        <polygon points={poly} fill="url(#g-{h.color})" stroke="#4a4332" stroke-width="1" />

        <!-- water tint + waves -->
        {#if h.terrain?.includes('water')}
          <polygon points={poly} fill="#2f6f96" opacity="0.32" />
          {#each [-7, 1, 9] as wy}
            <path d="M -13 {wy} q 4 -3 8 0 q 4 3 8 0 q 4 -3 8 0" class="wave" />
          {/each}
        {/if}

        <!-- mountains (3D) -->
        {#if h.terrain?.includes('mountain')}
          {#each peaks(h.coord) as pk}
            <path d="M {pk.x} 14 L {pk.x + pk.s / 2} {14 - pk.s} L {pk.x + pk.s} 14 Z" fill="#7d6a47" />
            <path d="M {pk.x + pk.s / 2} {14 - pk.s} L {pk.x + pk.s} 14 L {pk.x + pk.s * 0.62} 14 Z" fill="#5c4d31" />
            <path d="M {pk.x + pk.s / 2} {14 - pk.s} l {pk.s * 0.16} {pk.s * 0.34} l {pk.s * 0.18} -{pk.s * 0.12} l {pk.s * 0.16} {pk.s * 0.2}" fill="none" stroke="#efe9da" stroke-width="1" opacity="0.8" />
          {/each}
        {/if}

        <!-- preprinted track: clipped to the hex so it never overflows -->
        <g clip-path="url(#hexclip)">
          {#each h.paths as p}
            <path d={pathD(p)} class="ties" />
            <path d={pathD(p)} class="bed" />
            <path d={pathD(p)} class="rail" />
          {/each}
        </g>

        <!-- towns -->
        {#each h.towns as t}
          <rect x="-9" y="-4" width="18" height="8" rx="2" class="town" transform="rotate(30)" />
          {#if t.revenue > 0}<text class="rev" y="-15" text-anchor="middle">{t.revenue}</text>{/if}
        {/each}

        <!-- cities -->
        {#each h.cities as c}
          {#if c.slots > 1}
            <rect x={-12 * c.slots} y="-13" width={24 * c.slots} height="26" rx="13" class="city" />
          {:else}
            <circle r="13" class="city" />
          {/if}
          {#if c.revenue > 0}<text class="rev" y="-17" text-anchor="middle">{c.revenue}</text>{/if}
          <!-- procedural skyline for non-home single-slot cities -->
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

        <!-- offboard revenue tiers -->
        {#if h.offboard}
          {#each Object.entries(h.offboard.revenue) as [tier, val], i}
            <text class="off" x="0" y={i * 13 - 6} text-anchor="middle" fill={OFFBOARD_TIER[tier] ?? '#333'}>{val}</text>
          {/each}
        {/if}

        <!-- home token -->
        {#if HOME.has(h.coord)}
          {@const corp = HOME.get(h.coord)!}
          <circle r="11" fill={corp.color} stroke="#fff" stroke-width="1.5" />
          <text class="tok" y="3.2" text-anchor="middle">{corp.sym}</text>
        {/if}

        {#if h.label}<text class="label" x={APOTHEM - 9} y={-APOTHEM + 17} text-anchor="middle">{h.label}</text>{/if}
        <text class="coord" x={-APOTHEM + 6} y={-APOTHEM + 14}>{h.coord}</text>
        {#if h.name}<text class="name" y={APOTHEM - 6} text-anchor="middle">{h.name}</text>{/if}
      </g>
    {/each}
  </svg>
</div>

<style>
  .sea {
    border-radius: 12px;
    overflow: hidden;
    background-color: #74c1be;
    background-image:
      repeating-linear-gradient(90deg, #6cb8b5 0 4px, #79c6c2 4px 8px),
      repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.22) 0 2px, transparent 2px 16px),
      repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.11) 0 2px, transparent 2px 26px),
      repeating-linear-gradient(0deg, rgba(40, 110, 120, 0.14) 0 3px, transparent 3px 10px);
    background-size: 8px 8px, 16px 100%, 26px 100%, 100% 10px;
    image-rendering: pixelated;
    animation: sea 3.4s steps(8) infinite;
  }
  @keyframes sea {
    to {
      background-position: 8px 0, 32px 0, -26px 0, 0 0;
    }
  }
  .map {
    width: 100%;
    height: auto;
    display: block;
    filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.35));
  }
  .ties {
    fill: none;
    stroke: #2a241b;
    stroke-width: 10;
    stroke-dasharray: 2 5;
    stroke-linecap: butt;
  }
  .bed {
    fill: none;
    stroke: #6b6052;
    stroke-width: 5;
    stroke-linecap: round;
  }
  .rail {
    fill: none;
    stroke: #d9dde1;
    stroke-width: 1.8;
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
  .coord {
    font: 600 8px ui-monospace, monospace;
    fill: #6b6450;
  }
  .name {
    font: 600 9px ui-sans-serif, sans-serif;
    fill: #1c2a36;
    paint-order: stroke;
    stroke: #e9e6c4;
    stroke-width: 2.5;
  }
  @media (prefers-reduced-motion: reduce) {
    .sea {
      animation: none;
    }
  }
</style>
