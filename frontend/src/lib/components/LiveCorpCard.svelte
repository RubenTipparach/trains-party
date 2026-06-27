<script lang="ts">
  import { game } from '$lib/game/sandbox.svelte';
  import { currencyFor, currentPrice, type CorporationState } from '$lib/engine';

  // A live corporation card for the Entities panel: who holds what %, the treasury,
  // trains, price, and privates - the in-game state, not the static company sheet.
  let { corp }: { corp: CorporationState } = $props();

  const SEAT = ['#f5c542', '#3fb6a8', '#e0655c', '#9b8cf0', '#7cc36b', '#e8923a'];
  const currency = $derived(currencyFor(game.title));

  const started = $derived(corp.parPrice !== null || corp.floated);
  const price = $derived(corp.priceRow !== null ? currentPrice(game.state, corp) : null);
  const holders = $derived(
    game.state.players
      .map((p, i) => ({ name: p.name, seat: SEAT[i % SEAT.length], pct: p.shares[corp.sym] ?? 0, pres: corp.president === p.id }))
      .filter((h) => h.pct > 0)
      .sort((a, b) => b.pct - a.pct)
  );
  const privates = $derived(game.state.companies.filter((c) => c.owner === corp.sym && !c.closed).map((c) => c.sym));
  const presName = $derived(
    corp.president ? (game.state.players.find((p) => p.id === corp.president)?.name ?? corp.president) : null
  );
</script>

<div class="card" class:dim={!started} style="--corp:{corp.color}">
  <div class="head">
    <span class="sym">{corp.sym}</span>
    <span class="name">{corp.name}</span>
    {#if corp.dissolved}<span class="tag closed">closed</span>
    {:else if !started}<span class="tag">unstarted</span>
    {:else if !corp.floated}<span class="tag">floating</span>{/if}
  </div>

  {#if started}
    <div class="stats">
      <span><b>{currency}{corp.cash}</b><small>treasury</small></span>
      <span><b>{price !== null ? `${currency}${price}` : '-'}</b><small>price{corp.parPrice ? ` · par ${currency}${corp.parPrice}` : ''}</small></span>
      <span><b>{corp.trains.length ? corp.trains.join(' ') : '-'}</b><small>trains</small></span>
    </div>
    <div class="owners">
      {#each holders as h (h.name)}
        <span class="own" style="--c:{h.seat}"><i></i>{h.name} {h.pct}%{#if h.pres}<sup>P</sup>{/if}</span>
      {/each}
      {#if corp.ipoShares > 0}<span class="own pool">IPO {corp.ipoShares}%</span>{/if}
      {#if corp.poolShares > 0}<span class="own pool">Pool {corp.poolShares}%</span>{/if}
    </div>
    {#if privates.length}<div class="privs">Privates: {privates.join(', ')}</div>{/if}
  {:else}
    <div class="stats one">
      <span><b>{corp.coordinates || '-'}</b><small>home</small></span>
      <span><b>{currency}{corp.parPrice ?? '-'}</b><small>par</small></span>
    </div>
  {/if}
</div>

<style>
  .card {
    border: 1px solid var(--line);
    border-left: 6px solid var(--corp);
    border-radius: 12px;
    background: var(--bg-soft);
    padding: 0.7rem 0.85rem;
  }
  .card.dim {
    opacity: 0.7;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.55rem;
  }
  .sym {
    display: inline-grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--corp);
    color: #fff;
    font-weight: 700;
    font-size: 0.74rem;
    flex: none;
  }
  .name {
    font-weight: 600;
    line-height: 1.1;
    flex: 1;
    min-width: 0;
  }
  .tag {
    font-size: 0.58rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0.05rem 0.4rem;
  }
  .tag.closed {
    color: #ff8a7e;
    border-color: #ff8a7e;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.4rem;
    margin-bottom: 0.55rem;
  }
  .stats.one {
    grid-template-columns: repeat(2, 1fr);
  }
  .stats span {
    display: flex;
    flex-direction: column;
    line-height: 1.15;
  }
  .stats b {
    font-size: 0.95rem;
    font-weight: 800;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .stats small {
    font-size: 0.58rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .owners {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .own {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.72rem;
    font-weight: 600;
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0.05rem 0.45rem;
    white-space: nowrap;
  }
  .own i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--c);
  }
  .own sup {
    color: var(--rail);
    font-weight: 800;
  }
  .own.pool {
    color: var(--muted);
  }
  .privs {
    margin-top: 0.5rem;
    font-size: 0.74rem;
    color: var(--muted);
  }
</style>
