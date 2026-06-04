<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { fade, fly } from 'svelte/transition';
  import HexMap from '$lib/components/HexMap.svelte';
  import StockMarket from '$lib/components/StockMarket.svelte';
  import CorporationCard from '$lib/components/CorporationCard.svelte';
  import CompanyCard from '$lib/components/CompanyCard.svelte';
  import CompanyLogo from '$lib/components/CompanyLogo.svelte';
  import GamePanel from '$lib/components/GamePanel.svelte';
  import Spreadsheet from '$lib/components/Spreadsheet.svelte';
  import TileGraphic from '$lib/components/TileGraphic.svelte';
  import PrivateChip from '$lib/components/PrivateChip.svelte';
  import { game } from '$lib/game/sandbox.svelte';
  import { playerValue, playerLiquidity, configFor, currencyFor } from '$lib/engine';

  const SEAT = ['#f5c542', '#3fb6a8', '#e0655c', '#9b8cf0', '#7cc36b', '#e8923a'];
  // The entities tab still lists 1889's privates/corporations directly (RoLA's
  // minors/majors are a later pass); every other tab reads the active config.
  import { CORPORATIONS, COMPANIES } from '$lib/data/g1889';
  import type { TileColor } from '$lib/data/types';
  import { anim } from '$lib/game/anim.svelte';
  import { GAMES } from '$lib/data/games';
  import { page } from '$app/stores';

  // The room lives in the URL: /<title>/room/<code>. Load that session, and re-load
  // when navigating between rooms (the page component is reused across params).
  const code = $derived($page.params.code ?? '');
  const urlTitle = $derived($page.params.title ?? '1889');
  $effect(() => {
    if (code && game.code !== code) game.loadRoom(code, urlTitle);
  });
  const ready = $derived(!!code && game.code === code);

  // Active title's branding (header, footer, theme) - the board is title-agnostic.
  const meta = $derived(GAMES.find((g) => g.id === game.title) ?? GAMES[0]);
  const isRola = $derived(game.title === 'rola');
  const cfg = $derived(configFor(game.title));
  const currency = $derived(currencyFor(game.title));

  // Init animation prefs and the skip hotkey on the client.
  onMount(() => {
    anim.init();
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        anim.skip();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Auto-play bot turns with a watchable pause between moves (skippable).
  $effect(() => {
    const a = game.active;
    if (a && game.isBot(a) && !game.reviewing) {
      let cancelled = false;
      (async () => {
        await anim.wait(900);
        if (!cancelled) game.botStep();
      })();
      return () => {
        cancelled = true;
      };
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

  const cash = $derived([...new Set(Object.values(cfg.startingCash))].map((v) => `${currency}${v}`).join(' / '));
  const rustsWhenBought = (name: string) => cfg.trains.find((x) => x.rustsOn === name)?.name;
  const TILE_FILL: Record<TileColor, string> = {
    white: '#cdcb92',
    yellow: '#f3cf3e',
    green: '#7cc36b',
    brown: '#c69b66',
    gray: '#aeb7bb',
    red: '#df6a5c',
    blue: '#86c5e0'
  };
</script>

<svelte:head>
  <title>{meta.title}{game.code ? ` · Room ${game.code.toUpperCase()}` : ''} · Trains Party</title>
</svelte:head>

{#if ready}
<div class="board-root" class:theme-rola={isRola}>
<header>
  <a class="back" href="{base}/">← All games</a>
  <div class="htop">
    <div class="hid">
      <h1>{meta.title}</h1>
      {#if game.code}<span class="roomcode" title="Room code (in the URL)">Room {game.code.toUpperCase()}</span>{/if}
    </div>
    <div class="animctl">
      {#if anim.pacing}
        <button class="skip" onclick={() => anim.skip()}>Skip ⏭ <kbd>Space</kbd></button>
      {/if}
      <button class="anitoggle" class:on={anim.enabled} onclick={() => anim.toggle()} title="Toggle animations">
        Animations {anim.enabled ? 'on' : 'off'}
      </button>
    </div>
  </div>
  <p class="subtitle">{meta.subtitle}</p>
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
                <tr><th>Type</th><th>Price</th><th>Available</th><th>Rusts</th><th>Upgrade discount</th><th>Phase</th></tr>
              </thead>
              <tbody>
                {#each cfg.trains as t (t.name)}
                  {@const left = game.state.depot.find((d) => d.name === t.name)?.remaining ?? t.num}
                  <tr>
                    <td><strong>{t.name}</strong></td>
                    <td>{currency}{t.price}</td>
                    <td>{t.num === -1 ? (left === -1 ? '∞' : left) : `${left}/${t.num}`}</td>
                    <td>{rustsWhenBought(t.name) ?? '-'}</td>
                    <td>{t.discount ? `${Object.keys(t.discount).join(', ')} → ${currency}${Object.values(t.discount)[0]}` : '-'}</td>
                    <td>{t.availableOn ? `phase ${t.availableOn}` : '-'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          {#if !isRola}<p class="legend">The 5-train closes all private companies when the first one is bought.</p>{/if}
        </section>

        <section>
          <h2>Game phases</h2>
          <div class="scroll">
            <table>
              <thead>
                <tr><th>Phase</th><th>On train</th><th>ORs</th><th>Train limit</th><th>Tiles</th><th>Status</th></tr>
              </thead>
              <tbody>
                {#each cfg.phases as p (p.name)}
                  {@const hi = p.tiles[p.tiles.length - 1]}
                  <tr>
                    <td><strong>{p.name}</strong></td>
                    <td>{p.on ?? 'start'}</td>
                    <td>{p.operatingRounds}</td>
                    <td>{p.minorTrainLimit ? `${p.minorTrainLimit}/${p.trainLimit}` : p.trainLimit}</td>
                    <td><span class="tilebadge" style:background={isRola && hi === 'brown' ? '#9b6fb0' : TILE_FILL[hi]}>{isRola && hi === 'brown' ? 'purple' : isRola && hi === 'gray' ? 'grey' : hi}</span></td>
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
              {#each cfg.endGame ?? [] as e (e.reason)}
                <tr><td>{e.reason}</td><td>{e.timing}</td></tr>
              {/each}
            </tbody>
          </table>
        </section>

        <section>
          <h2>Game info</h2>
          <table>
            <tbody>
              <tr><th>Title</th><td>{meta.title}{meta.subtitle ? ` - ${meta.subtitle}` : ''}</td></tr>
              <tr><th>Players</th><td>{meta.players ?? '-'}</td></tr>
              <tr><th>Bank</th><td>{currency}{cfg.bankCash.toLocaleString()}</td></tr>
              <tr><th>Starting cash</th><td>{cash} (by player count)</td></tr>
              <tr><th>Certificate limit</th><td>{Object.entries(cfg.certLimit).map(([p, n]) => `${p}p: ${n < 0 ? 'none' : n}`).join(' · ')}</td></tr>
              <tr><th>Par prices</th><td>{cfg.parPrices.map((p) => `${currency}${p}`).join(' · ')}</td></tr>
              <tr><th>Capitalization</th><td>{isRola ? 'Incremental' : 'Full'}</td></tr>
              <tr><th>Published by</th><td>{meta.publisher}</td></tr>
              <tr><th>Designed by</th><td>{meta.designer ?? '-'}</td></tr>
              <tr><th>Rules</th><td><a href={meta.rulebookUrl} target="_blank" rel="noreferrer">Rulebook (PDF)</a></td></tr>
            </tbody>
          </table>
        </section>
      {:else if active === 'entities'}
        <section>
          <h2>Players <span class="count">{game.state.players.length}</span></h2>
          <div class="cards">
            {#each game.state.players as pl, i (pl.id)}
              <div class="pent" style="--p:{SEAT[i % SEAT.length]}">
                <div class="pehead">
                  <span class="pename">{pl.name}{#if game.isBot(pl.id)}<span class="pebot">BOT</span>{/if}</span>
                  <span class="pecash">{currency}{pl.cash}</span>
                </div>
                <div class="pemetrics">
                  <span>Value {currency}{playerValue(game.state, pl.id)}</span>
                  <span>Liquidity {currency}{playerLiquidity(game.state, pl.id)}</span>
                </div>
                <div class="peholds">
                  {#each game.state.corporations.filter((c) => (pl.shares[c.sym] ?? 0) > 0) as c (c.sym)}
                    <span class="peshare" style="--c:{c.color}"><i></i>{c.sym} {pl.shares[c.sym]}%{#if c.president === pl.id}<sup>P</sup>{/if}</span>
                  {/each}
                  {#each pl.companies as sym (sym)}<PrivateChip {sym} />{/each}
                  {#if game.state.corporations.every((c) => (pl.shares[c.sym] ?? 0) === 0) && pl.companies.length === 0}
                    <span class="penone">no holdings yet</span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </section>
        {#if isRola}
          <section>
            <h2>Minor companies <span class="count">{cfg.minors?.length ?? 0}</span></h2>
            <div class="cards">
              {#each cfg.minors ?? [] as m (m.sym)}
                <div class="entcard" style="--c:{m.color}">
                  <div class="enthead">
                    <CompanyLogo sym={m.sym} color={m.color} size={26} />
                    <span class="entsym">{m.sym}</span>
                    <span class="entname">{m.name}</span>
                  </div>
                  <p class="entdesc">{m.desc}</p>
                </div>
              {/each}
            </div>
          </section>
          <section>
            <h2>Major corporations <span class="count">{cfg.majors?.length ?? 0}</span></h2>
            <div class="cards">
              {#each cfg.majors ?? [] as m (m.sym)}
                <div class="entcard" style="--c:{m.color}">
                  <div class="enthead">
                    <CompanyLogo sym={m.sym} color={m.color} size={26} />
                    <span class="entsym">{m.sym}</span>
                    <span class="entname">{m.name}</span>
                  </div>
                  <p class="entdesc">Forms in the green phase when two minors merge.</p>
                </div>
              {/each}
            </div>
          </section>
        {:else}
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
        {/if}
      {:else if active === 'tiles'}
        <h2>Tile manifest <span class="count">{cfg.tileManifest.reduce((n, t) => n + t.count, 0)} tiles</span></h2>
        <div class="tiles">
          {#each cfg.tileManifest as t (t.id)}
            <TileGraphic id={t.id} count={t.count} />
          {/each}
        </div>
        <p class="legend">Each tile and how many are available, coloured by phase ({isRola ? 'yellow / green / purple / grey' : 'yellow / green / brown'}).</p>
      {/if}
    </div>
  {/key}

  <footer>{meta.title}{meta.subtitle ? ` · ${meta.subtitle}` : ''}</footer>
</main>
</div>
{:else}
  <div class="loadingroom"><p>Loading room {code.toUpperCase()}…</p></div>
{/if}

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
  .hid {
    display: flex;
    align-items: baseline;
    gap: 0.7rem;
    flex-wrap: wrap;
  }
  .roomcode {
    font: 700 0.8rem ui-monospace, monospace;
    letter-spacing: 0.08em;
    color: var(--accent);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0.2rem 0.7rem;
    background: rgba(255, 255, 255, 0.04);
    text-transform: uppercase;
  }
  .subtitle {
    margin: 0.15rem 0 0;
    color: var(--muted);
    font-size: 0.92rem;
  }
  .loadingroom {
    min-height: 60vh;
    display: grid;
    place-items: center;
    color: var(--muted);
    font-size: 1rem;
  }
  /* Railways of the Lost Atlas — its own identity (inspired by the rulebook):
     deep navy + copper, parchment ink, a vintage engraved-serif wordmark. The
     CSS-variable overrides cascade into every child panel that uses them. */
  .board-root.theme-rola {
    --bg: #0c2032;
    --bg-soft: #14304a;
    --ink: #ece2cf;
    --muted: #a6b6c4;
    --rail: #e29a5a;
    --rail-deep: #b06a30;
    --accent: #d6884a;
    --line: #294258;
    min-height: 100vh;
    background: radial-gradient(1100px 720px at 72% -12%, #173552 0%, var(--bg) 58%);
  }
  .theme-rola h1 {
    font-family: 'Cinzel', Georgia, 'Times New Roman', serif;
    letter-spacing: 0.05em;
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.45);
  }
  .theme-rola .subtitle {
    font-style: italic;
  }
  .htop {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .animctl {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .skip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.7rem;
    border-radius: 999px;
    border: 1px solid var(--rail-deep);
    background: var(--rail);
    color: #1b1b1b;
    font: 700 0.8rem ui-sans-serif, sans-serif;
    cursor: pointer;
    animation: skippulse 1.2s ease-in-out infinite;
  }
  @keyframes skippulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgba(245, 197, 66, 0.5);
    }
    50% {
      box-shadow: 0 0 0 5px rgba(245, 197, 66, 0);
    }
  }
  .skip kbd {
    font: 600 0.66rem ui-monospace, monospace;
    background: rgba(0, 0, 0, 0.18);
    border-radius: 4px;
    padding: 0 0.25rem;
  }
  .anitoggle {
    padding: 0.35rem 0.7rem;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--muted);
    font: 600 0.78rem ui-sans-serif, sans-serif;
    cursor: pointer;
  }
  .anitoggle.on {
    color: var(--accent);
    border-color: var(--accent);
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
  .entcard {
    border: 1px solid var(--line);
    border-left: 4px solid var(--c);
    border-radius: 12px;
    background: var(--bg-soft);
    overflow: hidden;
  }
  .enthead {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.7rem;
  }
  .entsym {
    font-weight: 800;
    color: var(--c);
    letter-spacing: 0.02em;
  }
  .entname {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .entdesc {
    margin: 0;
    padding: 0 0.7rem 0.6rem;
    font-size: 0.82rem;
    color: var(--muted);
    line-height: 1.45;
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
