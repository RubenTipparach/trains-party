<script lang="ts">
  import { base } from '$app/paths';
  import { fly, fade } from 'svelte/transition';
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
</script>

<main in:fade={{ duration: 300 }}>
  <header>
    <a class="back" href="{base}/">← Trains Party</a>
    <h1>1889 · board reference</h1>
    <p class="sub">Read-only static data. Stage 1 of the build (see design.md).</p>
  </header>

  <section in:fly={{ y: 16, duration: 400 }}>
    <h2>Shikoku map</h2>
    <HexMap />
  </section>

  <div class="two">
    <section in:fly={{ y: 16, duration: 400, delay: 60 }}>
      <h2>Game setup</h2>
      <dl class="setup">
        <div><dt>Bank</dt><dd>{CURRENCY}{BANK_CASH.toLocaleString()}</dd></div>
        <div><dt>Starting cash</dt><dd>{[...new Set(Object.values(STARTING_CASH))].map((v) => `${CURRENCY}${v}`).join(' / ')}</dd></div>
        <div><dt>Cert limit (2–6p)</dt><dd>{Object.values(CERT_LIMIT).join(' · ')}</dd></div>
        <div><dt>Phases</dt><dd>{PHASES.map((p) => p.name).join(' → ')}</dd></div>
      </dl>
    </section>

    <section in:fly={{ y: 16, duration: 400, delay: 120 }}>
      <h2>Trains</h2>
      <TrainRoster />
    </section>
  </div>

  <section in:fly={{ y: 16, duration: 400, delay: 160 }}>
    <h2>Stock market</h2>
    <StockMarket />
  </section>

  <section in:fly={{ y: 16, duration: 400, delay: 200 }}>
    <h2>Corporations <span class="count">{CORPORATIONS.length}</span></h2>
    <div class="cards">
      {#each CORPORATIONS as corp (corp.sym)}
        <CorporationCard {corp} />
      {/each}
    </div>
  </section>

  <section in:fly={{ y: 16, duration: 400, delay: 240 }}>
    <h2>Private companies <span class="count">{COMPANIES.length}</span></h2>
    <div class="cards">
      {#each COMPANIES as company (company.sym)}
        <CompanyCard {company} />
      {/each}
    </div>
  </section>

  <footer>Data transcribed from the reference 18xx engine. No rules logic yet.</footer>
</main>

<style>
  main {
    max-width: 1100px;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 4rem;
  }
  header {
    margin-bottom: 1.5rem;
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
    font-size: clamp(1.8rem, 5vw, 2.6rem);
    margin: 0.4rem 0 0.2rem;
    color: var(--rail);
  }
  .sub {
    color: var(--muted);
    margin: 0;
    font-size: 0.9rem;
  }
  section {
    margin-top: 2rem;
  }
  h2 {
    font-size: 1.05rem;
    border-bottom: 1px solid var(--line);
    padding-bottom: 0.4rem;
    margin-bottom: 0.9rem;
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
  .two {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1.5rem;
  }
  @media (min-width: 760px) {
    .two {
      grid-template-columns: 1fr 1.4fr;
      align-items: start;
    }
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 0.8rem;
  }
  .setup {
    margin: 0;
    display: grid;
    gap: 0.4rem;
  }
  .setup div {
    display: flex;
    justify-content: space-between;
    border-bottom: 1px dashed var(--line);
    padding-bottom: 0.3rem;
    font-size: 0.9rem;
  }
  .setup dt {
    color: var(--muted);
  }
  .setup dd {
    margin: 0;
    font-weight: 600;
  }
  footer {
    margin-top: 3rem;
    color: var(--muted);
    font-size: 0.8rem;
    text-align: center;
  }
</style>
