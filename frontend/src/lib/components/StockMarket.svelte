<script lang="ts">
  import { game } from '$lib/game/sandbox.svelte';
  import { configFor, currencyFor } from '$lib/engine';
  import type { MarketCell } from '$lib/data/types';

  const cur = $derived(currencyFor(game.title));
  const bankFinite = $derived(game.state.bank >= 0);

  // The active game's market: 1889 is a 2D grid; RoLA is a single linear track,
  // shown as a VERTICAL ladder of long bars (high value at the top) so the
  // token move-up / move-down / re-stack rules read clearly.
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
  // Corporations on a cell, bottom-of-stack first (operating order).
  function tokensAt(row: number, col: number) {
    return game.state.corporations
      .filter((c) => c.priceRow === row && c.priceCol === col)
      .sort((a, b) => a.stackSeq - b.stackSeq);
  }
  // Linear ladder rungs, highest price at the top.
  const rungs = $derived(
    linear ? market[0].map((cell, col) => ({ cell, col })).slice().reverse() : []
  );
</script>

<div class="bankbar">
  <span class="blabel">Bank</span>
  <span class="bval">{bankFinite ? `${cur}${game.state.bank.toLocaleString()}` : 'unlimited'}</span>
</div>

{#if linear}
  <p class="rules">
    Token moves: <b>+1</b> when fully owned at the end of a Stock Round, or when it pays at least its
    price; <b>+2</b> at 2x its price. <b>-1</b> when issued / sold, or revenue withheld / zero. A payout
    below its price keeps the value but drops the token to the <b>bottom</b> of its level (operates last).
  </p>
  <div class="ladder">
    {#each rungs as { cell, col } (col)}
      {@const toks = tokensAt(0, col)}
      <div class="bar" class:par={cell.par} class:closed={cell.price === 0} class:occupied={toks.length > 0}>
        <span class="swatch" style="background:{cell.price === 0 ? '#241a12' : ZONE[cell.zone]}"></span>
        <span class="price">{cell.price === 0 ? '✕' : cell.price}</span>
        <span class="tag">{cell.price === 0 ? 'closed' : cell.par ? 'par' : ''}</span>
        <div class="bartoks">
          {#each toks as t, i (t.sym)}
            <span class="chip" style="background:{t.color}" title="{t.sym}{i === 0 ? ' (operates first)' : ''}">{t.sym}</span>
          {/each}
        </div>
      </div>
    {/each}
  </div>
{:else}
  <div class="grid" style="--cols:{cols}">
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
{/if}

<style>
  .bankbar {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.6rem;
    margin: 0 0 0.8rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--line);
    border-left: 4px solid #d9b25b;
    border-radius: 9px;
    background: var(--bg-soft);
  }
  .blabel {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    font-weight: 700;
  }
  .bval {
    font-size: 1.15rem;
    font-weight: 800;
    color: #d9b25b;
  }

  /* ---- linear vertical ladder (RoLA) ---- */
  .rules {
    margin: 0 0 0.7rem;
    font-size: 0.76rem;
    color: var(--muted);
    line-height: 1.5;
  }
  .rules b {
    color: var(--ink);
  }
  .ladder {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    min-height: 28px;
    padding: 0.1rem 0.5rem 0.1rem 0;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--bg-soft);
  }
  .bar.par {
    border-color: #c25a52;
  }
  .bar.occupied {
    background: color-mix(in srgb, var(--rail) 9%, var(--bg-soft));
    border-color: var(--rail-deep);
  }
  .bar.closed {
    opacity: 0.7;
  }
  .swatch {
    width: 6px;
    align-self: stretch;
    border-radius: 6px 0 0 6px;
    flex: none;
  }
  .price {
    width: 3ch;
    text-align: right;
    font: 700 0.92rem ui-monospace, monospace;
    color: var(--ink);
  }
  .tag {
    width: 3.2rem;
    font: 600 0.62rem ui-sans-serif, sans-serif;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  .bartoks {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    flex: 1;
  }
  .chip {
    display: inline-grid;
    place-items: center;
    min-width: 1.5rem;
    height: 1.2rem;
    padding: 0 0.25rem;
    border-radius: 4px;
    font: 800 0.66rem ui-sans-serif, sans-serif;
    color: #fff;
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.5);
    border: 1px solid rgba(0, 0, 0, 0.3);
  }

  /* ---- 2D grid (1889) ---- */
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
