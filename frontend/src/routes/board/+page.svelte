<script lang="ts">
  import { base } from '$app/paths';
  import { fade, fly } from 'svelte/transition';
  import HexMap from '$lib/components/HexMap.svelte';
  import StockMarket from '$lib/components/StockMarket.svelte';
  import TrainRoster from '$lib/components/TrainRoster.svelte';
  import CorporationCard from '$lib/components/CorporationCard.svelte';
  import CompanyCard from '$lib/components/CompanyCard.svelte';
  import {
    CORPORATIONS,
    COMPANIES,
    BANK_CASH,
    STARTING_CASH,
    CERT_LIMIT,
    PHASES,
    CURRENCY
  } from '$lib/data/g1889';

  const tabs = [
    { id: 'map', label: 'Map' },
    { id: 'market', label: 'Stock' },
    { id: 'trains', label: 'Trains' },
    { id: 'corps', label: 'Corps' },
    { id: 'privates', label: 'Privates' }
  ] as const;
  type TabId = (typeof tabs)[number]['id'];

  let active = $state<TabId>('map');

  function onKey(e: KeyboardEvent, i: number) {
    if (e.key === 'ArrowRight') active = tabs[(i + 1) % tabs.length].id;
    else if (e.key === 'ArrowLeft') active = tabs[(i - 1 + tabs.length) % tabs.length].id;
  }
</script>

<main in:fade={{ duration: 300 }}>
  <header>
    <a class="back" href="{base}/">← Trains Party</a>
    <h1>1889 · board reference</h1>
    <p class="sub">Read-only static data. Stage 1 of the build.</p>
  </header>

  <div class="tabs" role="tablist" aria-label="Board sections">
    {#each tabs as t, i (t.id)}
      <button
        role="tab"
        id="tab-{t.id}"
        aria-selected={active === t.id}
        aria-controls="panel-{t.id}"
        tabindex={active === t.id ? 0 : -1}
        class:selected={active === t.id}
        onclick={() => (active = t.id)}
        onkeydown={(e) => onKey(e, i)}
      >
        {t.label}
      </button>
    {/each}
  </div>

  {#key active}
    <div class="panel" role="tabpanel" id="panel-{active}" aria-labelledby="tab-{active}" in:fly={{ y: 10, duration: 220 }}>
      {#if active === 'map'}
        <dl class="setup">
          <div><dt>Bank</dt><dd>{CURRENCY}{BANK_CASH.toLocaleString()}</dd></div>
          <div><dt>Start cash</dt><dd>{[...new Set(Object.values(STARTING_CASH))].map((v) => `${CURRENCY}${v}`).join(' / ')}</dd></div>
          <div><dt>Cert limit</dt><dd>{Object.values(CERT_LIMIT).join('·')}</dd></div>
          <div><dt>Phases</dt><dd>{PHASES.map((p) => p.name).join('→')}</dd></div>
        </dl>
        <HexMap />
      {:else if active === 'market'}
        <h2>Stock market</h2>
        <StockMarket />
      {:else if active === 'trains'}
        <h2>Trains</h2>
        <TrainRoster />
      {:else if active === 'corps'}
        <h2>Corporations <span class="count">{CORPORATIONS.length}</span></h2>
        <div class="cards">
          {#each CORPORATIONS as corp (corp.sym)}<CorporationCard {corp} />{/each}
        </div>
      {:else if active === 'privates'}
        <h2>Private companies <span class="count">{COMPANIES.length}</span></h2>
        <div class="cards">
          {#each COMPANIES as company (company.sym)}<CompanyCard {company} />{/each}
        </div>
      {/if}
    </div>
  {/key}

  <footer>Data transcribed from the reference 18xx engine. No rules logic yet.</footer>
</main>

<style>
  main {
    max-width: 1100px;
    margin: 0 auto;
    padding: 1.25rem 1rem 4rem;
  }
  .back {
    font-size: 0.85rem;
    text-decoration: none;
    color: var(--muted);
  }
  .back:hover {
    color: var(--accent);
  }
  h1 {
    font-size: clamp(1.6rem, 5vw, 2.4rem);
    margin: 0.4rem 0 0.2rem;
    color: var(--rail);
  }
  .sub {
    color: var(--muted);
    margin: 0;
    font-size: 0.88rem;
  }
  .tabs {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    gap: 0.3rem;
    margin: 1.1rem 0 1.2rem;
    padding: 0.3rem;
    border-radius: 999px;
    background: var(--bg-soft);
    border: 1px solid var(--line);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tabs::-webkit-scrollbar {
    display: none;
  }
  .tabs button {
    flex: 1 0 auto;
    min-height: 40px;
    padding: 0.45rem 1rem;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: var(--muted);
    font: 600 0.92rem ui-sans-serif, sans-serif;
    cursor: pointer;
    white-space: nowrap;
    transition: background 140ms ease, color 140ms ease;
  }
  .tabs button:hover {
    color: var(--ink);
  }
  .tabs button.selected {
    background: var(--rail);
    color: #1b1b1b;
  }
  .panel {
    min-height: 40vh;
  }
  h2 {
    font-size: 1.05rem;
    border-bottom: 1px solid var(--line);
    padding-bottom: 0.4rem;
    margin: 0 0 0.9rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .count {
    font-size: 0.75rem;
    color: var(--muted);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0.05rem 0.5rem;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 0.8rem;
  }
  .setup {
    margin: 0 0 1rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1.2rem;
  }
  .setup div {
    display: flex;
    gap: 0.4rem;
    font-size: 0.85rem;
  }
  .setup dt {
    color: var(--muted);
  }
  .setup dd {
    margin: 0;
    font-weight: 600;
  }
  footer {
    margin-top: 2.5rem;
    color: var(--muted);
    font-size: 0.8rem;
    text-align: center;
  }
</style>
