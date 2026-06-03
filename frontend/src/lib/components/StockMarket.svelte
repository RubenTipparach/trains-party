<script lang="ts">
  import { game } from '$lib/game/sandbox.svelte';
  import { configFor } from '$lib/engine';
  import type { MarketCell } from '$lib/data/types';

  // The active game's market: 1889 is a 2D grid; RoLA is a single linear row.
  const market = $derived(configFor(game.title).market);
  const cols = $derived(Math.max(...market.map((r) => r.length)));
  const linear = $derived(configFor(game.title).marketKind === 'linear');

  const ZONE: Record<MarketCell['zone'], string> = {
    white: '#f3efe4',
    yellow: '#f5d23f',
    orange: '#e8923a',
    brown: '#c98a5a',
    green: '#78c474',
    purple: '#a67ab6'
  };
  // Corporations sitting on a given cell (so you can see where minors trade).
  function tokensAt(row: number, col: number) {
    return game.state.corporations.filter((c) => c.priceRow === row && c.priceCol === col);
  }
</script>

<div class="grid" class:linear style="--cols:{cols}">
  {#each market as row, ri}
    {#each Array(cols) as _, c}
      {#if row[c]}
        {@const cell = row[c]}
        <div
          class="cell"
          class:par={cell.par}
          class:closed={cell.price === 0}
          style="background:{cell.price === 0 ? '#241a12' : ZONE[cell.zone]}"
        >
          <span>{cell.price === 0 ? '✕' : cell.price}</span>
          {#if cell.price === 0}<small>closed</small>{:else if cell.par}<small>par</small>{/if}
          {#if tokensAt(ri, c).length}
            <div class="toks">
              {#each tokensAt(ri, c) as t (t.sym)}<i style="background:{t.color}" title={t.sym}></i>{/each}
            </div>
          {/if}
        </div>
      {:else}
        <div class="cell empty"></div>
      {/if}
    {/each}
  {/each}
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(34px, 1fr));
    gap: 3px;
    overflow-x: auto;
    padding-bottom: 4px;
  }
  .cell {
    aspect-ratio: 1;
    border-radius: 5px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font: 700 12px ui-sans-serif, sans-serif;
    color: #1b1b1b;
    border: 1px solid rgba(0, 0, 0, 0.15);
  }
  .cell.empty {
    background: transparent !important;
    border: none;
  }
  .cell.par {
    outline: 2px solid #c25a52;
    outline-offset: -2px;
  }
  .cell small {
    font: 600 8px ui-sans-serif, sans-serif;
    opacity: 0.7;
  }
  .cell.closed {
    color: #e9d9b8;
    border-color: rgba(255, 255, 255, 0.15);
  }
  .toks {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    margin-top: 2px;
    justify-content: center;
  }
  .toks i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1px solid rgba(0, 0, 0, 0.4);
    display: inline-block;
  }
</style>
