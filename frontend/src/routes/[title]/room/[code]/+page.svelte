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
  import RoundTracker from '$lib/components/RoundTracker.svelte';
  import OperatingPanel from '$lib/components/OperatingPanel.svelte';
  import MergerPanel from '$lib/components/MergerPanel.svelte';
  import LogPanel from '$lib/components/LogPanel.svelte';
  import Spreadsheet from '$lib/components/Spreadsheet.svelte';
  import TileGraphic from '$lib/components/TileGraphic.svelte';
  import PrivateChip from '$lib/components/PrivateChip.svelte';
  import { game } from '$lib/game/sandbox.svelte';
  import { highlight } from '$lib/game/highlight.svelte';
  import { playerValue, playerLiquidity, configFor, currencyFor, operatingView } from '$lib/engine';
  import { BUILD_SHA } from '$lib/version';

  const SEAT = ['#f5c542', '#3fb6a8', '#e0655c', '#9b8cf0', '#7cc36b', '#e8923a'];
  // The entities tab still lists 1889's privates/corporations directly (RoLA's
  // minors/majors are a later pass); every other tab reads the active config.
  import { CORPORATIONS, COMPANIES } from '$lib/data/g1889';
  import type { TileColor } from '$lib/data/types';
  import { anim } from '$lib/game/anim.svelte';
  import { pingHex, flyToHex } from '$lib/game/locate.svelte';
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

  // The map is the board's permanent background. The single background HexMap
  // also carries the operating-round interactions (lay track / token / routes).
  const opv = $derived(game.state.round === 'operating' ? operatingView(game.state) : null);

  let isMobile = $state(false);

  // Mobile op-sheet height (% of viewport). Players drag the handle to set the
  // map/sheet split to taste; persisted so it sticks across rounds and reloads.
  let sheetH = $state(50);
  let sheetDragging = $state(false);
  function onSheetDown(e: PointerEvent) {
    sheetDragging = true;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }
  function onSheetMove(e: PointerEvent) {
    if (!sheetDragging) return;
    const pct = (1 - e.clientY / window.innerHeight) * 100;
    sheetH = Math.max(24, Math.min(86, pct));
  }
  function onSheetUp(e: PointerEvent) {
    if (!sheetDragging) return;
    sheetDragging = false;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    try {
      localStorage.setItem('tp.sheetH', String(Math.round(sheetH)));
    } catch {
      /* private mode: keep the in-memory value */
    }
  }

  // Init animation prefs and the hotkeys on the client; open the Game panel by
  // default on desktop (it holds the action UI), keep the map clear on mobile.
  onMount(() => {
    anim.init();
    const saved = Number(localStorage.getItem('tp.sheetH'));
    if (saved >= 24 && saved <= 86) sheetH = saved;
    const mq = window.matchMedia('(min-width: 920px)');
    if (mq.matches) active = 'game';
    isMobile = !mq.matches;
    const onMq = () => (isMobile = !mq.matches);
    mq.addEventListener('change', onMq);
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        anim.skip();
      } else if (e.key === 'Escape') {
        active = null;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      mq.removeEventListener('change', onMq);
    };
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

  // Floating-toolbar panels. The map is not a panel: it is the background.
  const tabs = [
    {
      id: 'menu',
      label: 'Menu',
      icon: '<path d="M4 6.5h16"/><path d="M4 12h16"/><path d="M4 17.5h16"/>'
    },
    {
      id: 'game',
      label: 'Game',
      icon: '<path d="M7 5.3v13.4a.6.6 0 0 0 .92.5l10.5-6.7a.6.6 0 0 0 0-1L7.92 4.8a.6.6 0 0 0-.92.5z"/>'
    },
    {
      id: 'log',
      label: 'Log',
      icon: '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8h8"/><path d="M8 12h8"/><path d="M8 16h5"/>'
    },
    {
      id: 'market',
      label: 'Market',
      icon: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14.5 7H21v6.5"/>'
    },
    {
      id: 'info',
      label: 'Info',
      icon: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11.2v5"/><path d="M12 7.8h.01"/>'
    },
    {
      id: 'entities',
      label: 'Entities',
      icon: '<circle cx="9" cy="8.2" r="3.4"/><path d="M2.8 19.4c0-3.2 2.8-5.3 6.2-5.3s6.2 2.1 6.2 5.3"/><circle cx="16.8" cy="9.2" r="2.5"/><path d="M16.6 14.3c2.7.4 4.6 2.2 4.6 4.6"/>'
    },
    {
      id: 'tiles',
      label: 'Tiles',
      icon: '<path d="M12 2.6l8.1 4.7v9.4L12 21.4l-8.1-4.7V7.3z"/>'
    },
    {
      id: 'spreadsheet',
      label: 'Spreadsheet',
      icon: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M3.5 9.5h17"/><path d="M9.3 9.5V20"/><path d="M14.9 9.5V20"/>'
    }
  ] as const;
  type TabId = (typeof tabs)[number]['id'];
  let active = $state<TabId | null>(null);
  const activeTab = $derived(tabs.find((t) => t.id === active) ?? null);

  function toggle(id: TabId) {
    active = active === id ? null : id;
  }

  // Map-generation inspection (Tiles panel): group the generated hexes by type so
  // hovering one spotlights them on the board, and find where a laid tile id sits.
  const mapHexes = $derived(game.state.map ?? configFor(game.title).hexByCoord);
  const terrainGroups = $derived.by(() => {
    const g = {
      Cities: [] as string[], Capitals: [] as string[], Mountains: [] as string[],
      Water: [] as string[], Plains: [] as string[]
    };
    for (const [coord, h] of Object.entries(mapHexes)) {
      if (h.offboard) continue;
      if (h.cities?.some((c) => c.capital)) g.Capitals.push(coord);
      else if (h.cities?.length) g.Cities.push(coord);
      else if (h.terrain?.includes('mountain')) g.Mountains.push(coord);
      else if (h.terrain?.includes('water')) g.Water.push(coord);
      else g.Plains.push(coord);
    }
    return Object.entries(g) as [string, string[]][];
  });
  const laidOf = (id: string) =>
    Object.entries(game.state.tiles).filter(([, t]) => t.id === id).map(([c]) => c);
  // clear the spotlight whenever the panel changes / closes
  $effect(() => {
    void active;
    highlight.clear();
  });

  // Debug: copy the full replayable game (title, seed, seats, action log) so it
  // can be pasted back for diagnosis. The log + seed reproduce the exact board.
  let debugMsg = $state('');
  async function copyDebug() {
    const dump = JSON.stringify({
      title: game.title,
      seed: game.seed,
      mapMode: game.mapMode,
      hostileMergers: game.hostileMergers,
      seats: $state.snapshot(game.seats),
      actions: $state.snapshot(game.actions),
      build: BUILD_SHA
    });
    try {
      await navigator.clipboard.writeText(dump);
      debugMsg = `Copied (${game.actions.length} actions). Paste it to share your board.`;
    } catch {
      console.log('[trains-party debug state]', dump);
      debugMsg = 'Clipboard blocked - logged to the browser console (F12) instead.';
    }
  }

  // The current operation (OR/MR) lives in its OWN always-on panel, separate
  // from the tab system: a bottom sheet on mobile, a floating panel on desktop.
  const opPanel = $derived(
    game.state.round === 'operating' || game.state.round === 'merger'
  );
  // During an operating/merger round the play screen IS the map plus the always-on
  // operation panel, so the Game (play) tab opens no independent overlay: selecting
  // it just shows the board. Other tabs still open over the map as usual.
  const panelOpen = $derived(!!active && !(active === 'game' && opPanel));
  // A full-screen modal covering the map pauses its renderer (mobile).
  const mapPaused = $derived(isMobile && !!active);

  // Always-visible status pill: round, active player (seat colour), bank.
  const seatColor = (id: string) => {
    const i = game.state.players.findIndex((p) => p.id === id);
    return SEAT[(i < 0 ? 0 : i) % SEAT.length];
  };
  const playerName = (id: string | null) =>
    id ? (game.state.players.find((p) => p.id === id)?.name ?? id) : '-';
  const roundLabel = $derived.by(() => {
    const s = game.state;
    if (s.round === 'auction') return 'ISR';
    if (s.round === 'mapbuild') return 'MAP';
    if (s.round === 'stock') return `SR ${s.srCount}`;
    if (s.round === 'merger') return 'MR';
    return s.or ? `OR ${s.orSet}.${s.or.orNumber}` : 'OR';
  });

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
<div
  class="board-root"
  class:theme-rola={isRola}
  class:opdock={opPanel}
  class:panelopen={panelOpen}
  class:sheetdrag={sheetDragging}
  style="--sheeth:{sheetH}%"
>
  <!-- the map: full-screen, always on, the board's background. On desktop the
       open panel pushes it over so the board re-centres in the visible space. -->
  <div class="maplayer" class:squeezed={panelOpen}>
    <HexMap
      fill
      paused={mapPaused}
      liftControls={isMobile && opPanel}
      layMode={game.canAct && opv?.step === 'track'}
      tokenMode={game.canAct && opv?.step === 'token'}
      runMode={game.canAct && opv?.step === 'run'}
    />
  </div>

  <!-- room identity chip (desktop) -->
  <div class="roomchip">
    <span class="rtitle">{meta.title}</span>
    {#if game.code}<span class="rcode">Room {game.code.toUpperCase()}</span>{/if}
  </div>

  <!-- floating cycle/round tracker (RoLA): the board-style visual aid -->
  <div class="trackerfloat" class:shifted={!!active}>
    <RoundTracker />
  </div>

  <!-- turn status + history rewind, shared between the floating pill and the
       operating panel header (mobile folds it into the op sheet during ORs) -->
  {#snippet turnStatus()}
    <span class="srnd">{roundLabel}</span>
    <span class="splayer">{game.canAct ? 'Your turn · ' : ''}{playerName(game.active)}</span>
    {#if game.isBot(game.active)}<span class="sbot">BOT</span>{/if}
    <span class="sbank">Bank {currency}{game.state.bank.toLocaleString()}</span>
    <span class="shist" role="group" aria-label="History">
      <button class="hb" title="To start" aria-label="To start" disabled={!game.canBack} onclick={() => game.first()}>|&lt;</button>
      <button class="hb" title="Back" aria-label="Back" disabled={!game.canBack} onclick={() => game.back()}>&lt;&lt;</button>
      <span class="hpos" class:rev={game.reviewing} title={game.reviewing ? 'Reviewing an earlier point' : 'History position'}>{game.cursor}/{game.actions.length}</span>
      <button class="hb" title="Forward" aria-label="Forward" disabled={!game.canForward} onclick={() => game.forward()}>&gt;&gt;</button>
      <button class="hb" title="To latest" aria-label="To latest" disabled={!game.canForward} onclick={() => game.last()}>&gt;|</button>
      <button class="hb u" title="Undo" aria-label="Undo" disabled={!game.canUndo} onclick={() => game.undo()}>↶</button>
      <button class="hb u" title="Redo" aria-label="Redo" disabled={!game.canRedo} onclick={() => game.redo()}>↷</button>
    </span>
    {#if anim.pacing}
      <button class="skip" onclick={() => anim.skip()}>Skip ⏭ <kbd>Space</kbd></button>
    {/if}
  {/snippet}

  <!-- always-visible turn status (hidden on mobile during ORs: folded into the
       operating panel header below) -->
  <div class="statusbar" class:myturn={game.canAct} class:shifted={!!active} style="--p:{seatColor(game.active ?? '')}">
    {@render turnStatus()}
  </div>

  {#if opPanel}
    <!-- the current operation: its own persistent panel, never closeable. On
         mobile the turn status + rewind fold into this header (.opstatus) so the
         floating pill can hide; on desktop the floating pill stays and this is
         hidden. -->
    <section class="oppanel" aria-label="Current operation">
      <!-- mobile: drag to set the map/sheet split (resizes the bottom sheet) -->
      <div
        class="ophandle"
        role="separator"
        aria-label="Drag to resize panel"
        aria-orientation="horizontal"
        title="Drag to resize"
        onpointerdown={onSheetDown}
        onpointermove={onSheetMove}
        onpointerup={onSheetUp}
        onpointercancel={onSheetUp}
        ondblclick={() => (sheetH = 50)}
      >
        <span class="ogrip"></span>
      </div>
      <!-- desktop: the room title lives at the top of the docked panel (the
           floating chip is hidden during ORs so the centred status bar is clear) -->
      <div class="optitle">
        <span class="rtitle">{meta.title}</span>
        {#if game.code}<span class="rcode">Room {game.code.toUpperCase()}</span>{/if}
      </div>
      <div class="opstatus" class:myturn={game.canAct} style="--p:{seatColor(game.active ?? '')}">
        {@render turnStatus()}
      </div>
      <div class="opbody" class:locked={game.reviewing}>
        {#if game.state.round === 'merger'}<MergerPanel />{:else}<OperatingPanel />{/if}
      </div>
    </section>
  {/if}

  {#if panelOpen}
    <!-- mobile-only scrim behind the modal -->
    <button class="scrim" aria-label="Close panel" onclick={() => (active = null)} transition:fade={{ duration: 120 }}></button>
  {/if}

  <!-- the toolbar + panel shell: tabs merge into the open panel. Mobile: a
       horizontal bar at the top that the modal hangs from. Desktop: a vertical
       rail on the panel's left edge, the whole shell docked to the right. -->
  <div class="shell" class:open={panelOpen}>
    <nav class="dock" aria-label="Board sections">
      {#each tabs as t, i (t.id)}
        <button
          class="dbtn"
          class:on={active === t.id}
          title={t.label}
          aria-label={t.label}
          aria-pressed={active === t.id}
          onclick={() => toggle(t.id)}
        >
          <svg viewBox="0 0 24 24">{@html t.icon}</svg>
        </button>
        {#if i === 0}<span class="dsep" aria-hidden="true"></span>{/if}
      {/each}
    </nav>

    {#if panelOpen && activeTab}
    <aside class="panelhost" transition:fade={{ duration: 140 }} aria-label={activeTab.label}>
      <header class="phead">
        <svg class="picon" viewBox="0 0 24 24">{@html activeTab.icon}</svg>
        <h2>{activeTab.label}</h2>
        <button class="pclose" aria-label="Close panel" onclick={() => (active = null)}>✕</button>
      </header>
      <div class="pbody">
        {#key active}
          <div class="panel" in:fade={{ duration: 150 }}>
            {#if active === 'menu'}
              <div class="menu">
                <div class="mrow">
                  <div class="mtext">
                    <span class="mname">Animations</span>
                    <span class="mdesc">Pace bot moves and board changes so they are easy to follow.</span>
                  </div>
                  <button class="mtoggle" class:on={anim.enabled} role="switch" aria-checked={anim.enabled} onclick={() => anim.toggle()}>
                    {anim.enabled ? 'On' : 'Off'}
                  </button>
                </div>
                <a class="mlobby" href="{base}/">Return to lobby</a>
                <div class="mrow">
                  <div class="mtext">
                    <span class="mname">Copy game state</span>
                    <span class="mdesc">Copies the full action log (for bug reports / sharing your exact board).</span>
                  </div>
                  <button class="mtoggle" onclick={copyDebug}>Copy</button>
                </div>
                {#if debugMsg}<p class="mdesc" style="margin:0">{debugMsg}</p>{/if}
                <p class="mbuild">{meta.title}{game.code ? ` · Room ${game.code.toUpperCase()}` : ''} · build {BUILD_SHA}</p>
              </div>
            {:else if active === 'game'}
              <GamePanel />
            {:else if active === 'log'}
              <LogPanel />
            {:else if active === 'spreadsheet'}
              <Spreadsheet />
            {:else if active === 'market'}
              <StockMarket />
              <ul class="legend-list">
                <li><span class="chip par">par</span> Par price: a corporation's starting share price.</li>
                <li><span class="chip yel">yellow</span> Shares do not count toward the certificate limit.</li>
                <li><span class="chip ora">orange</span> Shares may be held above 60%.</li>
              </ul>
            {:else if active === 'info'}
              {#if isRola}
                <section class="trackerinfo">
                  <h3>Rounds and cycles</h3>
                  <RoundTracker embedded />
                </section>
              {/if}
              <section>
                <h3>Trains</h3>
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
                <h3>Game phases</h3>
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
                <h3>Reasons for end of game</h3>
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
                <h3>Game info</h3>
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
                <h3>Players <span class="count">{game.state.players.length}</span></h3>
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
                  <h3>Minor companies <span class="count">{cfg.minors?.length ?? 0}</span></h3>
                  <div class="cards">
                    {#each cfg.minors ?? [] as m (m.sym)}
                      {@const home = game.state.corporations.find((c) => c.sym === m.sym)?.coordinates || ''}
                      <div class="entcard" style="--c:{m.color}">
                        <div class="enthead">
                          <button
                            class="locate"
                            class:disabled={!home}
                            title={home ? `Find ${m.sym} home (${home})` : 'No home placed yet'}
                            aria-label="Find {m.sym} on the map"
                            onmouseenter={() => home && pingHex(home)}
                            onmouseleave={() => pingHex(null)}
                            onclick={() => { if (home) { active = isMobile ? null : active; flyToHex(home); } }}
                          >
                            <CompanyLogo sym={m.sym} color={m.color} size={26} />
                          </button>
                          <span class="entsym">{m.sym}</span>
                          <span class="entname">{m.name}</span>
                          {#if home}<span class="enthome">{home}</span>{/if}
                        </div>
                        <p class="entdesc">{m.desc}</p>
                      </div>
                    {/each}
                  </div>
                </section>
                <section>
                  <h3>Major corporations <span class="count">{cfg.majors?.length ?? 0}</span></h3>
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
                  <h3>Corporations <span class="count">{CORPORATIONS.length}</span></h3>
                  <div class="cards">
                    {#each CORPORATIONS as corp (corp.sym)}<CorporationCard {corp} />{/each}
                  </div>
                </section>
                <section>
                  <h3>Private companies <span class="count">{COMPANIES.length}</span></h3>
                  <div class="cards">
                    {#each COMPANIES as company (company.sym)}<CompanyCard {company} />{/each}
                  </div>
                </section>
              {/if}
            {:else if active === 'tiles'}
              <section>
                <h3>Generated map <span class="count">hover to spotlight</span></h3>
                <div class="terrains">
                  {#each terrainGroups as [label, coords] (label)}
                    <button
                      class="terrain"
                      onmouseenter={() => highlight.set(coords)}
                      onmouseleave={() => highlight.clear()}
                      onfocus={() => highlight.set(coords)}
                      onblur={() => highlight.clear()}
                    >
                      <span class="tlabel">{label}</span><span class="tnum">{coords.length}</span>
                    </button>
                  {/each}
                </div>
                <p class="legend">Hover a terrain type to highlight every hex of that type on the board (verifies the procedural generation).</p>
              </section>
              <h3>Tile manifest <span class="count">{cfg.tileManifest.reduce((n, t) => n + t.count, 0)} tiles</span></h3>
              <div class="tiles">
                {#each cfg.tileManifest as t (t.id)}
                  <button
                    class="tilebtn"
                    title={laidOf(t.id).length ? `laid at ${laidOf(t.id).join(', ')}` : 'not yet laid'}
                    onmouseenter={() => highlight.set(laidOf(t.id))}
                    onmouseleave={() => highlight.clear()}
                    onfocus={() => highlight.set(laidOf(t.id))}
                    onblur={() => highlight.clear()}
                  >
                    <TileGraphic id={t.id} count={t.count} />
                  </button>
                {/each}
              </div>
              <p class="legend">Each tile and how many are available, coloured by phase ({isRola ? 'yellow / green / purple / grey' : 'yellow / green / brown'}). Hover a tile to spotlight where it's laid.</p>
            {/if}
          </div>
        {/key}
      </div>
    </aside>
    {/if}
  </div>
</div>
{:else}
  <div class="loadingroom"><p>Loading room {code.toUpperCase()}…</p></div>
{/if}

<style>
  /* ---- full-screen board: the map is the background, everything floats ---- */
  .board-root {
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: var(--bg);
  }
  /* fullscreen targets the whole board UI (toolbar + panels come along) */
  .board-root:fullscreen {
    width: 100%;
    height: 100%;
  }
  .maplayer {
    position: absolute;
    inset: 0;
    z-index: 0;
    transition: left 240ms ease, right 240ms ease, bottom 240ms ease;
  }
  .loadingroom {
    min-height: 60vh;
    display: grid;
    place-items: center;
    color: var(--muted);
    font-size: 1rem;
  }
  /* Railways of the Lost Atlas — its own identity (inspired by the rulebook):
     deep navy + copper, parchment ink. The CSS-variable overrides cascade into
     every floating panel that uses them. */
  .board-root.theme-rola {
    --bg: #0c2032;
    --bg-soft: #14304a;
    --ink: #ece2cf;
    --muted: #a6b6c4;
    --rail: #e29a5a;
    --rail-deep: #b06a30;
    --accent: #d6884a;
    --line: #294258;
  }

  /* ---- the shell: floating toolbar merged with the open panel ----
     Mobile: a horizontal bar at the top; the modal hangs from it, fused.
     Desktop: the shell docks to the right edge; the icon rail sits on the
     panel's left edge, fused into one surface. */
  .shell {
    position: absolute;
    z-index: 15;
    top: 8px;
    left: 8px;
    right: 8px;
    max-height: calc(100% - 16px);
    display: flex;
    flex-direction: column;
    align-items: center;
    pointer-events: none;
  }
  .shell.open {
    bottom: 8px;
    align-items: stretch;
  }
  .dock {
    pointer-events: auto;
    flex: none;
    max-width: 100%;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px;
    border-radius: 14px;
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: blur(8px);
    border: 1px solid var(--line);
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .dock::-webkit-scrollbar {
    display: none;
  }
  .shell.open .dock {
    justify-content: center;
    border-radius: 14px 14px 0 0;
    border-bottom: none;
  }
  .dbtn {
    flex: 0 0 auto;
    width: 42px;
    height: 42px;
    display: grid;
    place-items: center;
    border: 1px solid transparent;
    border-radius: 10px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    text-decoration: none;
    transition: color 120ms ease, background 120ms ease, border-color 120ms ease;
  }
  .dbtn svg {
    width: 22px;
    height: 22px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .dbtn:hover {
    color: var(--ink);
    background: rgba(255, 255, 255, 0.06);
  }
  .dbtn.on {
    color: var(--rail);
    background: color-mix(in srgb, var(--rail) 14%, transparent);
    border-color: var(--rail-deep);
  }
  .dsep {
    flex: 0 0 auto;
    width: 1px;
    height: 26px;
    background: var(--line);
    margin: 0 2px;
  }

  /* ---- floating cycle/round tracker ---- */
  .trackerfloat {
    position: absolute;
    z-index: 11;
    left: 10px;
    bottom: 14px;
    transform: scale(0.9);
    transform-origin: bottom left;
  }
  @media (min-width: 920px) {
    /* desktop: sit to the right of the bottom-left zoom controls (~54px wide) */
    .trackerfloat {
      left: 64px;
    }
  }
  @media (max-width: 919px) {
    /* mobile: hide the floating tracker entirely to keep the board clear; it is
       available (always expanded) in the Info panel instead. */
    .trackerfloat {
      display: none;
    }
  }

  /* ---- room identity chip ---- */
  .roomchip {
    display: none;
    position: absolute;
    z-index: 12;
    top: 14px;
    left: 14px;
    align-items: center;
    gap: 0.55rem;
    padding: 0.4rem 0.8rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg) 84%, transparent);
    backdrop-filter: blur(8px);
    border: 1px solid var(--line);
  }
  .rtitle {
    font-weight: 800;
    color: var(--rail);
    font-size: 0.88rem;
  }
  .rcode {
    font: 700 0.72rem ui-monospace, monospace;
    letter-spacing: 0.08em;
    color: var(--accent);
    text-transform: uppercase;
  }

  /* ---- always-visible turn status ---- */
  .statusbar {
    position: absolute;
    z-index: 12;
    bottom: 14px;
    left: 50%;
    transform: translateX(-50%);
    max-width: calc(100vw - 120px);
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 0.3rem 0.55rem;
    padding: 0.45rem 0.85rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg) 86%, transparent);
    backdrop-filter: blur(8px);
    border: 1px solid var(--line);
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
    font-size: 0.84rem;
    white-space: nowrap;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .statusbar.myturn {
    border-color: var(--p);
    box-shadow: 0 0 0 1px var(--p) inset, 0 4px 18px rgba(0, 0, 0, 0.35);
  }
  .srnd {
    font: 700 0.74rem ui-monospace, monospace;
    color: #0f1419;
    background: var(--rail);
    border-radius: 999px;
    padding: 0.12rem 0.5rem;
  }
  .splayer {
    font-weight: 700;
    color: var(--p);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sbot {
    font-size: 0.58rem;
    color: var(--muted);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0 0.3rem;
  }
  .sbank {
    color: var(--muted);
    font-size: 0.76rem;
  }
  /* On narrow screens the bank crowds the pill (it lives in the Game panel too). */
  @media (max-width: 480px) {
    .sbank {
      display: none;
    }
  }
  /* history / rewind cluster (wraps to its own row on narrow screens) */
  .shist {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
  }
  .hb {
    min-width: 26px;
    height: 24px;
    padding: 0 0.3rem;
    border-radius: 7px;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--muted);
    font: 700 0.72rem ui-monospace, monospace;
    cursor: pointer;
  }
  .hb:hover:not(:disabled) {
    color: var(--ink);
    border-color: var(--rail-deep);
  }
  .hb:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .hb.u {
    font-family: ui-sans-serif, sans-serif;
    color: var(--rail);
    border-color: var(--rail-deep);
  }
  .hb.u:disabled {
    color: var(--muted);
    border-color: var(--line);
  }
  .hpos {
    font: 0.7rem ui-monospace, monospace;
    color: var(--muted);
    padding: 0 0.15rem;
  }
  .hpos.rev {
    color: var(--rail);
    font-weight: 700;
  }
  .skip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.25rem 0.6rem;
    border-radius: 999px;
    border: 1px solid var(--rail-deep);
    background: var(--rail);
    color: #1b1b1b;
    font: 700 0.76rem ui-sans-serif, sans-serif;
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
    font: 600 0.62rem ui-monospace, monospace;
    background: rgba(0, 0, 0, 0.18);
    border-radius: 4px;
    padding: 0 0.25rem;
  }

  /* ---- the open panel, fused to the dock ---- */
  .scrim {
    position: absolute;
    inset: 0;
    z-index: 14;
    border: none;
    background: rgba(5, 9, 13, 0.55);
    cursor: pointer;
  }
  .panelhost {
    pointer-events: auto;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-radius: 0 0 14px 14px;
    border: 1px solid var(--line);
    background: color-mix(in srgb, var(--bg) 94%, transparent);
    backdrop-filter: blur(10px);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
    overflow: hidden;
  }
  .phead {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.65rem 0.9rem;
    border-bottom: 1px solid var(--line);
    background: color-mix(in srgb, var(--bg-soft) 80%, transparent);
  }
  .picon {
    width: 19px;
    height: 19px;
    fill: none;
    stroke: var(--rail);
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .phead h2 {
    margin: 0;
    font-size: 1rem;
    color: var(--rail);
  }
  .pclose {
    margin-left: auto;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--muted);
    font-size: 0.85rem;
    cursor: pointer;
  }
  .pclose:hover {
    color: var(--ink);
    border-color: var(--rail-deep);
  }
  .pbody {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0.9rem 1rem 1.4rem;
    overscroll-behavior: contain;
  }

  /* the always-on operation panel (OR/MR) */
  .oppanel {
    position: absolute;
    z-index: 13;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--line);
    background: var(--bg);
    overflow: hidden;
  }
  .opbody {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0.7rem 0.8rem 1rem;
    overscroll-behavior: contain;
  }
  .opbody.locked {
    opacity: 0.5;
    pointer-events: none;
  }
  /* turn status + rewind folded into the op-panel header: mobile only (desktop
     keeps the floating pill at the top of the screen). */
  .opstatus {
    display: none;
  }
  /* room title in the op-panel header: desktop only (mobile uses the bottom sheet) */
  .optitle {
    display: none;
  }
  /* drag handle to resize the bottom sheet: mobile only */
  .ophandle {
    display: none;
  }
  @media (max-width: 919px) {
    /* mobile: a fixed bottom sheet; the map stays live above it. Its height (and
       the matching map cut-off) is the player-set --sheeth split. */
    .oppanel {
      left: 0;
      right: 0;
      bottom: 0;
      height: var(--sheeth, 50%);
      border-radius: 14px 14px 0 0;
      border-bottom: none;
    }
    /* render only the visible part of the map while the sheet is up: the SVG
       shrinks to the area above the sheet, cutting what the browser rasterises
       (the controls ride along inside it). */
    .board-root.opdock .maplayer {
      bottom: var(--sheeth, 50%);
    }
    /* while dragging the handle, follow the finger immediately (no easing lag) */
    .board-root.sheetdrag .maplayer {
      transition: none;
    }
    .ophandle {
      display: flex;
      flex: none;
      align-items: center;
      justify-content: center;
      height: 22px;
      cursor: ns-resize;
      touch-action: none;
      background: var(--bg-soft);
      border-radius: 14px 14px 0 0;
    }
    .ogrip {
      width: 44px;
      height: 5px;
      border-radius: 999px;
      background: var(--muted);
      opacity: 0.6;
    }
    .ophandle:hover .ogrip {
      opacity: 0.9;
    }
    /* during ORs/MRs the turn status lives in the op-panel header, so hide the
       floating pill and reveal the header bar. */
    .board-root.opdock .statusbar {
      display: none;
    }
    .opstatus {
      display: flex;
      flex: none;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 0.3rem 0.5rem;
      padding: 0.5rem 0.7rem;
      border-bottom: 1px solid var(--line);
      background: var(--bg-soft);
      font-size: 0.84rem;
      white-space: nowrap;
    }
    .opstatus.myturn {
      box-shadow: 0 2px 0 -1px var(--p) inset;
    }
    /* perf: backdrop blur is expensive on phones - use solid surfaces instead */
    .dock,
    .panelhost,
    .statusbar,
    .roomchip {
      backdrop-filter: none;
      background: var(--bg);
    }
  }
  @media (min-width: 920px) {
    /* desktop: dock the operation panel as a full-height column on the LEFT edge,
       and shift the board (with its in-map zoom controls) clear of it. */
    .board-root {
      --opw: 380px;
    }
    .oppanel {
      left: 0;
      top: 0;
      bottom: 0;
      width: var(--opw);
      max-height: none;
      border-radius: 0 14px 14px 0;
      border-left: none;
      /* solid background: a blurred backdrop over a full-height edge re-composites
         every frame while the board pans beside it and makes panning stutter. */
      background: var(--bg);
    }
    .optitle {
      display: flex;
      align-items: baseline;
      gap: 0.55rem;
      padding: 0.6rem 0.9rem 0.2rem;
    }
    .board-root.opdock .maplayer {
      left: var(--opw);
    }
    /* keep the floating tracker out from under the docked panel; the room title
       moves into the panel header, so hide the floating chip during ORs. */
    .board-root.opdock .trackerfloat {
      left: calc(var(--opw) + 64px);
    }
    .board-root.opdock .roomchip {
      display: none;
    }
  }

  /* desktop: the shell sits flush against the screen's top/right/bottom edges;
     the icon rail fuses to the panel's left edge, and the open panel pushes the
     map over so the board re-centres in the space that remains. */
  @media (min-width: 920px) {
    .board-root {
      /* panel (540px) + icon rail (~54px): the space the open shell occupies */
      --shellw: 594px;
    }
    .shell {
      top: 0;
      bottom: 0;
      right: 0;
      left: auto;
      max-height: none;
      flex-direction: row;
      align-items: center;
      justify-content: flex-end;
    }
    .shell.open {
      align-items: stretch;
    }
    .maplayer.squeezed {
      right: var(--shellw);
    }
    .dock {
      flex-direction: column;
      max-width: none;
      max-height: 100%;
      overflow-x: visible;
      overflow-y: auto;
      border-radius: 14px 0 0 14px;
      border-right: none;
    }
    .shell.open .dock {
      border-radius: 14px 0 0 14px;
      border-bottom: 1px solid var(--line);
    }
    .dsep {
      width: 26px;
      height: 1px;
      margin: 2px 0;
    }
    .roomchip {
      display: inline-flex;
    }
    /* Always centred over the *visible board*: the left/right docked panels set
       --leftpad/--rightpad, and the pill centres in the space between them rather
       than being pushed toward a corner. */
    .board-root.opdock {
      --leftpad: var(--opw);
    }
    .board-root.panelopen {
      --rightpad: var(--shellw);
    }
    .statusbar {
      bottom: auto;
      top: 14px;
      max-width: min(46vw, 640px);
      transition: left 240ms ease;
      left: calc(var(--leftpad, 0px) + (100vw - var(--leftpad, 0px) - var(--rightpad, 0px)) / 2);
    }
    .scrim {
      display: none;
    }
    .panelhost {
      flex: none;
      min-height: 0;
      height: 100%;
      width: min(540px, calc(100vw - 96px));
      border-radius: 0;
      border-top: none;
      border-right: none;
      border-bottom: none;
    }
  }

  /* ---- panel content (shared by all tabs) ---- */
  section {
    margin-bottom: 1.8rem;
  }
  h3 {
    font-size: 1rem;
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
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.8rem;
  }
  .pent {
    border: 1px solid var(--line);
    border-top: 3px solid var(--p);
    border-radius: 10px;
    background: var(--bg-soft);
    padding: 0.55rem 0.7rem;
  }
  .pehead {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }
  .pename {
    font-weight: 700;
    color: var(--p);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pebot {
    font-size: 0.58rem;
    color: var(--muted);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0 0.3rem;
    margin-left: 0.35rem;
  }
  .pecash {
    font-weight: 700;
    white-space: nowrap;
  }
  .pemetrics {
    display: flex;
    flex-wrap: wrap;
    gap: 0.15rem 0.9rem;
    font-size: 0.74rem;
    color: var(--muted);
    margin-bottom: 0.45rem;
  }
  .peholds {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }
  .peshare {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.74rem;
    font-weight: 600;
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0.08rem 0.5rem;
    white-space: nowrap;
  }
  .peshare i {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--c);
  }
  .peshare sup {
    color: var(--rail);
  }
  .penone {
    font-size: 0.76rem;
    color: var(--muted);
    font-style: italic;
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
  .locate {
    border: none;
    background: transparent;
    padding: 0;
    margin: 0;
    cursor: pointer;
    border-radius: 50%;
    line-height: 0;
    transition: transform 120ms ease, box-shadow 120ms ease;
  }
  .locate:hover:not(.disabled) {
    transform: scale(1.12);
    box-shadow: 0 0 0 2px var(--c);
  }
  .locate.disabled {
    cursor: default;
    opacity: 0.5;
  }
  .enthome {
    margin-left: auto;
    font: 700 0.68rem ui-monospace, monospace;
    color: var(--muted);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0.05rem 0.4rem;
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
  .tilebtn {
    border: 1px solid transparent;
    background: none;
    padding: 0.1rem;
    border-radius: 8px;
    cursor: pointer;
  }
  .tilebtn:hover {
    border-color: #5fb0e6;
    background: rgba(95, 176, 230, 0.12);
  }
  .terrains {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .terrain {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.6rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--bg-soft);
    color: var(--ink);
    cursor: pointer;
    font: inherit;
  }
  .terrain:hover {
    border-color: #5fb0e6;
    background: rgba(95, 176, 230, 0.14);
  }
  .terrain .tnum {
    font-weight: 800;
    color: #5fb0e6;
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

  /* ---- menu panel ---- */
  .menu {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    max-width: 440px;
  }
  .mrow {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.7rem 0.85rem;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg-soft);
  }
  .mtext {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .mname {
    font-weight: 700;
  }
  .mdesc {
    font-size: 0.78rem;
    color: var(--muted);
    line-height: 1.4;
  }
  .mtoggle {
    flex: none;
    min-width: 56px;
    padding: 0.4rem 0.8rem;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--muted);
    font: 700 0.82rem ui-sans-serif, sans-serif;
    cursor: pointer;
  }
  .mtoggle.on {
    background: var(--rail);
    border-color: var(--rail-deep);
    color: #1b1b1b;
  }
  .mlobby {
    display: block;
    text-align: center;
    padding: 0.65rem 0.85rem;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg-soft);
    color: var(--ink);
    font-weight: 700;
    text-decoration: none;
  }
  .mlobby:hover {
    border-color: var(--rail-deep);
    color: var(--rail);
  }
  .mbuild {
    margin: 0.4rem 0 0;
    text-align: center;
    color: var(--muted);
    font-size: 0.78rem;
  }
</style>
