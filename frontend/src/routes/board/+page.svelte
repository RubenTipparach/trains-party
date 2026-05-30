<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { fade, fly } from 'svelte/transition';
  import HexMap from '$lib/components/HexMap.svelte';
  import StockMarket from '$lib/components/StockMarket.svelte';
  import CorporationCard from '$lib/components/CorporationCard.svelte';
  import CompanyCard from '$lib/components/CompanyCard.svelte';
  import GamePanel from '$lib/components/GamePanel.svelte';
  import Spreadsheet from '$lib/components/Spreadsheet.svelte';
  import TileGraphic from '$lib/components/TileGraphic.svelte';
  import { game } from '$lib/game/sandbox.svelte';
  import {
    CORPORATIONS,
    COMPANIES,
    BANK_CASH,
    STARTING_CASH,
    CERT_LIMIT,
    PHASES,
    TRAINS,
    PAR_PRICES,
    CURRENCY,
    TITLE,
    PUBLISHER,
    DESIGNER,
    RULEBOOK_URL,
    END_GAME
  } from '$lib/data/g1889';
  import { TILE_MANIFEST } from '$lib/data/map1889';
  import type { TileColor } from '$lib/data/types';

  // Restore a locally-saved game (survives reloads) on the client.
  onMount(() => game.load());

  // Auto-play bot turns. Re-runs whenever the active player changes.
  $effect(() => {
    const a = game.active;
    if (a && game.isBot(a)) {
      const t = setTimeout(() => game.botStep(), 650);
      return () => clearTimeout(t);
    }
  });

  const tabs = [
    { id: 'game', label: 'Game' },
    { id: 'map', label: 'Map' },
    { id: 'market', label: 'Market' },
    { id: 'info', label: 'Info' },
    { id: 'entities', label: 'Entities' },
    { id: 'tiles', label: 'Tiles' },
    { id: 'spreadsheet', label: 'Spreadsheet' }
  ] as const;
  type TabId = (typeof tabs)[number]['id'];
  let active = $state<TabId>('game');

  function onKey(e: KeyboardEvent, i: number) {
    if (e.key === 'ArrowRight') active = tabs[(i + 1) % tabs.length].id;
    else if (e.key === 'ArrowLeft') active = tabs[(i - 1 + tabs.length) % tabs.length].id;
  }

  const cash = [...new Set(Object.values(STARTING_CASH))].map((v) => `${CURRENCY}${v}`).join(' / ');
  const rustsWhenBought = (name: string) => TRAINS.find((x) => x.rustsOn === name)?.name;
  const TILE_FILL: Record<TileColor, string> = {
    white: '#cdcb92',
    yellow: '#f3cf3e',
    green: '#7cc36b',
    brown: '#c69b66',
    gray: '#aeb7bb',
    red: '#df6a5c'
  };
</script>

<header>
  <a class="back" href="{base}/">← Trains Party</a>
  <h1>{TITLE} · Shikoku Railways</h1>
</header>

<nav class="topnav" aria-label="Board sections">
  <div role="tablist">
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
</nav>

<main in:fade={{ duration: 200 }}>
  {#key active}
    <div class="panel" role="tabpanel" id="panel-{active}" aria-labelledby="tab-{active}" in:fly={{ y: 10, duration: 200 }}>
      {#if active === 'game'}
        <GamePanel />
      {:else if active === 'spreadsheet'}
        <h2>Spreadsheet</h2>
        <Spreadsheet />
      {:else if active === 'map'}
        <HexMap />
      {:else if active === 'market'}
        <h2>Stock market</h2>
        <StockMarket />
        <ul class="legend-list">
          <li><span class="chip par">par</span> Par price: a corporation's starting share price.</li>
          <li><span class="chip yel">yellow</span> Shares do not count toward the certificate limit.</li>
          <li><span class="chip ora">orange</span> Shares may be held above 60%.</li>
        </ul>
      {:else if active === 'info'}
        <section>
          <h2>Trains</h2>
          <div class="scroll">
            <table>
              <thead>
                <tr><th>Type</th><th>Price</th><th>Count</th><th>Rusts</th><th>Upgrade discount</th><th>Available</th></tr>
              </thead>
              <tbody>
                {#each TRAINS as t (t.name)}
                  <tr>
                    <td><strong>{t.name}</strong></td>
                    <td>{CURRENCY}{t.price}</td>
                    <td>{t.num === -1 ? '∞' : t.num}</td>
                    <td>{rustsWhenBought(t.name) ?? '-'}</td>
                    <td>{t.discount ? `${Object.keys(t.discount).join(', ')} → ${CURRENCY}${Object.values(t.discount)[0]}` : '-'}</td>
                    <td>{t.availableOn ? `phase ${t.availableOn}` : '-'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <p class="legend">The 5-train closes all private companies when the first one is bought.</p>
        </section>

        <section>
          <h2>Game phases</h2>
          <div class="scroll">
            <table>
              <thead>
                <tr><th>Phase</th><th>On train</th><th>ORs</th><th>Train limit</th><th>Tiles</th><th>Status</th></tr>
              </thead>
              <tbody>
                {#each PHASES as p (p.name)}
                  {@const hi = p.tiles[p.tiles.length - 1]}
                  <tr>
                    <td><strong>{p.name}</strong></td>
                    <td>{p.on ?? 'start'}</td>
                    <td>{p.operatingRounds}</td>
                    <td>{p.trainLimit}</td>
                    <td><span class="tilebadge" style:background={TILE_FILL[hi]}>{hi}</span></td>
                    <td>{p.canBuyCompanies ? 'Can buy companies' : '-'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2>Reasons for end of game</h2>
          <table>
            <thead>
              <tr><th>Reason</th><th>Timing</th></tr>
            </thead>
            <tbody>
              {#each END_GAME as e (e.reason)}
                <tr><td>{e.reason}</td><td>{e.timing}</td></tr>
              {/each}
            </tbody>
          </table>
        </section>

        <section>
          <h2>Game info</h2>
          <table>
            <tbody>
              <tr><th>Title</th><td>{TITLE} - History of Shikoku Railways</td></tr>
              <tr><th>Players</th><td>2 - 6</td></tr>
              <tr><th>Bank</th><td>{CURRENCY}{BANK_CASH.toLocaleString()}</td></tr>
              <tr><th>Starting cash</th><td>{cash} (by player count)</td></tr>
              <tr><th>Certificate limit</th><td>{Object.entries(CERT_LIMIT).map(([p, n]) => `${p}p: ${n}`).join(' · ')}</td></tr>
              <tr><th>Par prices</th><td>{PAR_PRICES.map((p) => `${CURRENCY}${p}`).join(' · ')}</td></tr>
              <tr><th>Capitalization</th><td>Full</td></tr>
              <tr><th>Published by</th><td>{PUBLISHER}</td></tr>
              <tr><th>Designed by</th><td>{DESIGNER}</td></tr>
              <tr><th>Rules</th><td><a href={RULEBOOK_URL} target="_blank" rel="noreferrer">Rulebook (PDF)</a></td></tr>
            </tbody>
          </table>
        </section>
      {:else if active === 'entities'}
        <section>
          <h2>Corporations <span class="count">{CORPORATIONS.length}</span></h2>
          <div class="cards">
            {#each CORPORATIONS as corp (corp.sym)}<CorporationCard {corp} />{/each}
          </div>
        </section>
        <section>
          <h2>Private companies <span class="count">{COMPANIES.length}</span></h2>
          <div class="cards">
            {#each COMPANIES as company (company.sym)}<CompanyCard {company} />{/each}
          </div>
        </section>
      {:else if active === 'tiles'}
        <h2>Tile manifest <span class="count">{TILE_MANIFEST.reduce((n, t) => n + t.count, 0)} tiles</span></h2>
        <div class="tiles">
          {#each TILE_MANIFEST as t (t.id)}
            <TileGraphic id={t.id} count={t.count} />
          {/each}
        </div>
        <p class="legend">Each upgrade tile and how many are available, coloured by phase (yellow / green / brown).</p>
      {/if}
    </div>
  {/key}

  <footer>1889 · auction, stock and operating rounds with yellow track laying. Tokens, upgrades and route revenue are next.</footer>
</main>

<style>
  header {
    max-width: 1100px;
    margin: 0 auto;
    padding: 1.1rem 1rem 0;
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
    font-size: clamp(1.4rem, 4vw, 2rem);
    margin: 0.3rem 0 0;
    color: var(--rail);
  }
  .topnav {
    position: sticky;
    top: 0;
    z-index: 6;
    background: rgba(15, 20, 25, 0.92);
    backdrop-filter: blur(6px);
    border-bottom: 2px solid var(--accent);
    margin-top: 0.8rem;
  }
  .topnav div[role='tablist'] {
    max-width: 1100px;
    margin: 0 auto;
    display: flex;
    gap: 0.2rem;
    padding: 0 0.6rem;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .topnav div[role='tablist']::-webkit-scrollbar {
    display: none;
  }
  .topnav button {
    flex: 0 0 auto;
    min-height: 44px;
    padding: 0.6rem 0.9rem;
    border: none;
    background: transparent;
    color: var(--muted);
    font: 600 0.98rem ui-sans-serif, sans-serif;
    cursor: pointer;
    border-bottom: 3px solid transparent;
    margin-bottom: -2px;
    transition: color 120ms ease, border-color 120ms ease;
  }
  .topnav button:hover {
    color: var(--ink);
  }
  .topnav button.selected {
    color: var(--rail);
    border-bottom-color: var(--rail);
  }
  main {
    max-width: 1100px;
    margin: 0 auto;
    padding: 1.2rem 1rem 4rem;
  }
  .panel {
    min-height: 50vh;
  }
  section {
    margin-bottom: 1.8rem;
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
  .scroll {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
  }
  th,
  td {
    text-align: left;
    padding: 0.45rem 0.7rem;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }
  thead th {
    color: var(--muted);
    font-weight: 600;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  tbody th {
    color: var(--muted);
    font-weight: 500;
    width: 11rem;
  }
  td strong {
    color: var(--rail);
  }
  .tilebadge {
    display: inline-block;
    padding: 0.1rem 0.5rem;
    border-radius: 4px;
    color: #1b1b1b;
    font-weight: 600;
    font-size: 0.78rem;
    text-transform: capitalize;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
    gap: 0.7rem 0.5rem;
  }
  .legend {
    color: var(--muted);
    font-size: 0.8rem;
    margin-top: 0.8rem;
  }
  .legend-list {
    list-style: none;
    margin: 0.9rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.45rem;
  }
  .legend-list li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .chip {
    flex: none;
    min-width: 48px;
    text-align: center;
    display: inline-block;
    padding: 0.05rem 0.4rem;
    border-radius: 4px;
    color: #1b1b1b;
    font-weight: 600;
    font-size: 0.72rem;
  }
  .chip.par {
    background: #f6a39c;
    outline: 2px solid #c25a52;
    outline-offset: -2px;
  }
  .chip.yel {
    background: #f5d23f;
  }
  .chip.ora {
    background: #e8923a;
  }
  footer {
    margin-top: 2rem;
    color: var(--muted);
    font-size: 0.8rem;
    text-align: center;
  }
</style>
