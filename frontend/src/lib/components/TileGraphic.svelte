<script lang="ts">
  import { TILES } from '$lib/engine';
  import type { TileColor } from '$lib/data/types';

  let { id, count, bare = false }: { id: string; count?: number; bare?: boolean } = $props();
  const def = $derived(TILES[id]);

  const R = 28;
  const AP = (Math.sqrt(3) / 2) * R;
  const FILL: Record<TileColor, string> = {
    white: '#e7dcbf',
    yellow: '#f3cf3e',
    green: '#7cc36b',
    brown: '#c69b66',
    gray: '#aeb7bb',
    red: '#df6a5c',
    blue: '#86c5e0'
  };

  const poly = Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 180) * (60 * k);
    return `${(R * Math.cos(a)).toFixed(1)},${(R * Math.sin(a)).toFixed(1)}`;
  }).join(' ');

  function pt(e: number | 'c') {
    if (e === 'c') return { x: 0, y: 0 };
    const a = (Math.PI / 180) * (90 + 60 * e);
    return { x: AP * Math.cos(a), y: AP * Math.sin(a) };
  }
  function d(p: { a: number | 'c'; b: number | 'c' }) {
    const a = pt(p.a);
    const b = pt(p.b);
    if (p.a === 'c' || p.b === 'c') return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
    return `M ${a.x} ${a.y} Q 0 0 ${b.x} ${b.y}`;
  }
  // token-slot positions for 1..3 slots
  const slotXs = (n: number) => (n === 1 ? [0] : n === 2 ? [-7, 7] : [-9, 0, 9]);
</script>

<div class="tile">
  <svg viewBox="-34 -30 68 60" aria-label="tile {id}">
    <polygon points={poly} fill={FILL[def.color]} stroke="#4a4332" stroke-width="1.2" />
    {#each def.paths as p}
      <path d={d(p)} class="ties" />
      <path d={d(p)} class="rail" />
    {/each}
    {#if def.cities > 0}
      {#each slotXs(def.slots) as x}
        <circle cx={x} r="6.5" class="city" />
      {/each}
      <text class="rev" x="0" y="-14" text-anchor="middle">{def.revenue}</text>
    {:else if def.towns > 0}
      <rect x="-8" y="-3.5" width="16" height="7" rx="2" class="town" />
      <text class="rev" x="0" y="-12" text-anchor="middle">{def.revenue}</text>
    {/if}
    {#if def.label}<text class="label" x="15" y="-15" text-anchor="middle">{def.label}</text>{/if}
    {#if def.port}<text class="port" x="0" y="3" text-anchor="middle">⚓</text>{/if}
  </svg>
  {#if !bare}
    <div class="cap"><span class="tid">#{id}</span>{#if count}<span class="tn">×{count}</span>{/if}</div>
  {/if}
</div>

<style>
  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
  }
  svg {
    width: 100%;
    height: auto;
    display: block;
  }
  .ties {
    fill: none;
    stroke: #111;
    stroke-width: 6;
    stroke-dasharray: 1.5 3.5;
    stroke-linecap: butt;
  }
  .rail {
    fill: none;
    stroke: #111;
    stroke-width: 2.4;
    stroke-linecap: round;
  }
  .city {
    fill: #e9e2c9;
    stroke: #1b1b1b;
    stroke-width: 2.2;
  }
  .town {
    fill: #1b1b1b;
    stroke: #1b1b1b;
    stroke-width: 1.4;
  }
  .rev {
    font: 700 9px ui-sans-serif, sans-serif;
    fill: #1b1b1b;
    paint-order: stroke;
    stroke: #fff;
    stroke-width: 2.5;
  }
  .label {
    font: 700 11px ui-sans-serif, sans-serif;
    fill: #1b1b1b;
  }
  .port {
    font: 11px serif;
    fill: #1c3a44;
  }
  .cap {
    display: flex;
    gap: 0.3rem;
    align-items: baseline;
  }
  .tid {
    font: 700 0.78rem ui-monospace, monospace;
    color: var(--ink);
  }
  .tn {
    font-size: 0.7rem;
    color: var(--muted);
  }
</style>
