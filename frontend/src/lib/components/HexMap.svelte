<script lang="ts">
  import { HEXES } from '$lib/data/map1889';
  import { CORPORATIONS } from '$lib/data/g1889';
  import type { HexDef, PathPart, TileColor } from '$lib/data/types';
  import {
    HEX_SIZE,
    APOTHEM,
    hexCenter,
    hexPolygon,
    edgeMidpoint
  } from '$lib/hexgeo';

  const FILL: Record<TileColor, string> = {
    white: '#e9dfc4',
    yellow: '#f5d23f',
    green: '#8ccf6b',
    brown: '#cda06a',
    gray: '#b9bdc2',
    red: '#e0655c'
  };

  // Home corporation per coordinate (for placing home tokens).
  const HOME = new Map(CORPORATIONS.map((c) => [c.coordinates, c]));

  type Placed = HexDef & { cx: number; cy: number };
  const placed: Placed[] = HEXES.map((h) => {
    const { x, y } = hexCenter(h.coord);
    return { ...h, cx: x, cy: y };
  });

  const xs = placed.map((p) => p.cx);
  const ys = placed.map((p) => p.cy);
  const pad = HEX_SIZE + 24;
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
  const OFFBOARD_TIER: Record<string, string> = { yellow: '#caa12f', brown: '#8a5a2b', diesel: '#444' };
</script>

<svg class="map" viewBox="{minX} {minY} {width} {height}" role="img" aria-label="1889 Shikoku map">
  {#each placed as h (h.coord)}
    <g transform="translate({h.cx} {h.cy})">
      <polygon points={poly} fill={FILL[h.color]} stroke="#5b5340" stroke-width="1" />

      <!-- terrain hint -->
      {#if h.terrain?.includes('mountain')}
        <text class="terrain" y="6" text-anchor="middle">▲</text>
      {/if}
      {#if h.terrain?.includes('water')}
        <text class="terrain water" y="-2" text-anchor="middle">≈</text>
      {/if}

      <!-- preprinted track -->
      {#each h.paths as p}
        <path d={pathD(p)} class="track" />
      {/each}

      <!-- towns -->
      {#each h.towns as t}
        <rect x="-9" y="-4" width="18" height="8" rx="2" class="town" transform="rotate(30)" />
        {#if t.revenue > 0}
          <text class="rev" y="-16" text-anchor="middle">{t.revenue}</text>
        {/if}
      {/each}

      <!-- cities -->
      {#each h.cities as c, i}
        {#if c.slots > 1}
          <rect x={-12 * c.slots} y="-12" width={24 * c.slots} height="24" rx="12" class="city" />
        {:else}
          <circle r="13" class="city" />
        {/if}
        {#if c.revenue > 0}
          <text class="rev" x="0" y={-18} text-anchor="middle">{c.revenue}</text>
        {/if}
      {/each}

      <!-- offboard revenue tiers -->
      {#if h.offboard}
        {#each Object.entries(h.offboard.revenue) as [tier, val], i}
          <text class="off" x="0" y={i * 14 - 6} text-anchor="middle" fill={OFFBOARD_TIER[tier] ?? '#333'}>{val}</text>
        {/each}
      {/if}

      <!-- home token -->
      {#if HOME.has(h.coord)}
        {@const corp = HOME.get(h.coord)!}
        <circle r="11" fill={corp.color} stroke="#fff" stroke-width="1.5" />
        <text class="tok" y="4" text-anchor="middle">{corp.sym}</text>
      {/if}

      <!-- tile label (T / H / K) -->
      {#if h.label}
        <text class="label" x={APOTHEM - 8} y={-APOTHEM + 16} text-anchor="middle">{h.label}</text>
      {/if}

      <!-- coordinate -->
      <text class="coord" x={-APOTHEM + 6} y={-APOTHEM + 14}>{h.coord}</text>

      <!-- location name -->
      {#if h.name}
        <text class="name" y={APOTHEM - 6} text-anchor="middle">{h.name}</text>
      {/if}
    </g>
  {/each}
</svg>

<style>
  .map {
    width: 100%;
    height: auto;
    background: #1a2b3a;
    border-radius: 12px;
    display: block;
  }
  .track {
    fill: none;
    stroke: #2b2b2b;
    stroke-width: 6;
    stroke-linecap: round;
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
    fill: #20303f;
    paint-order: stroke;
    stroke: #e9dfc4;
    stroke-width: 2.5;
  }
  .terrain {
    font: 16px serif;
    fill: #6b5a3a;
    opacity: 0.5;
  }
  .terrain.water {
    fill: #2a6a8a;
    font-size: 18px;
  }
</style>
