<script lang="ts">
  import { MARKET } from '$lib/data/g1889';
  import type { MarketCell } from '$lib/data/types';

  const cols = Math.max(...MARKET.map((r) => r.length));

  const ZONE: Record<MarketCell['zone'], string> = {
    white: '#f3efe4',
    yellow: '#f5d23f',
    orange: '#e8923a',
    brown: '#c98a5a',
    green: '#78c474',
    purple: '#a67ab6'
  };
</script>

<div class="grid" style="--cols:{cols}">
  {#each MARKET as row}
    {#each Array(cols) as _, c}
      {#if row[c]}
        <div class="cell" class:par={row[c].par} style="background:{row[c].par ? '#f6a39c' : ZONE[row[c].zone]}">
          <span>{row[c].price}</span>
          {#if row[c].par}<small>par</small>{/if}
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
</style>
