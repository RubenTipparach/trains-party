<script lang="ts">
  import { game } from '$lib/game/sandbox.svelte';
  import { CURRENCY, TRAINS, COMPANIES } from '$lib/data/g1889';
  import MoneyValue from './MoneyValue.svelte';
  import PrivateChip from './PrivateChip.svelte';
  import type { CorporationState } from '$lib/engine';

  // A corporation's full treasury: cash, trains (with value), and any private
  // companies it owns (with their per-OR income).
  let { corp, compact = false }: { corp: CorporationState; compact?: boolean } = $props();

  const trainValue = (name: string) => TRAINS.find((t) => t.name === name)?.price ?? 0;
  // Privates owned by this corporation (owner === corp sym). Corp-buys-private
  // lands in a later stage; the display is ready for it now.
  const ownedPrivates = $derived(game.state.companies.filter((c) => c.owner === corp.sym && !c.closed));
  const privIncome = $derived(ownedPrivates.reduce((n, c) => n + c.revenue, 0));
  const trainsWorth = $derived(corp.trains.reduce((n, t) => n + trainValue(t), 0));
</script>

<div class="treasury" class:compact>
  <div class="line cash">
    <span class="lbl">Cash</span>
    <b><MoneyValue value={corp.cash} /></b>
  </div>
  <div class="line">
    <span class="lbl">Trains</span>
    <span class="val">
      {#if corp.trains.length}
        {#each corp.trains as t, i (i)}<span class="train">{t}</span>{/each}
        <span class="sub">{CURRENCY}{trainsWorth}</span>
      {:else}
        <span class="none">none</span>
      {/if}
    </span>
  </div>
  <div class="line">
    <span class="lbl">Privates</span>
    <span class="val">
      {#if ownedPrivates.length}
        {#each ownedPrivates as c (c.sym)}<PrivateChip sym={c.sym} />{/each}
        <span class="sub">+{CURRENCY}{privIncome}/OR</span>
      {:else}
        <span class="none">none</span>
      {/if}
    </span>
  </div>
</div>

<style>
  .treasury {
    display: grid;
    gap: 0.25rem;
    font-size: 0.8rem;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    justify-content: space-between;
  }
  .lbl {
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 0.68rem;
    flex: none;
  }
  .cash b {
    font-size: 0.95rem;
  }
  .val {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .train {
    font: 700 0.72rem ui-sans-serif, sans-serif;
    color: #1b1b1b;
    background: var(--rail);
    border-radius: 5px;
    padding: 0.02rem 0.35rem;
  }
  .sub {
    color: var(--accent);
    font-size: 0.72rem;
  }
  .none {
    color: var(--muted);
    opacity: 0.7;
  }
  .compact {
    font-size: 0.74rem;
  }
</style>
