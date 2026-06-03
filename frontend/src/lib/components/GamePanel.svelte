<script lang="ts">
  import { game } from '$lib/game/sandbox.svelte';
  import AuctionPanel from './AuctionPanel.svelte';
  import StockPanel from './StockPanel.svelte';
  import OperatingPanel from './OperatingPanel.svelte';
  import { PHASES } from '$lib/data/g1889';
  import { currencyFor } from '$lib/engine';
  const CURRENCY = $derived(currencyFor(game.title));

  const SEAT = ['#f5c542', '#3fb6a8', '#e0655c', '#9b8cf0', '#7cc36b', '#e8923a'];
  const seatColor = (id: string) => {
    const i = game.state.players.findIndex((p) => p.id === id);
    return SEAT[i % SEAT.length];
  };
  const playerName = (id: string | null) =>
    id ? (game.state.players.find((p) => p.id === id)?.name ?? id) : '-';

  // 18xx-style round label: ISR, SR n, OR set.num
  const roundLabel = $derived.by(() => {
    const s = game.state;
    if (s.round === 'auction') return 'ISR';
    if (s.round === 'stock') return `SR ${s.srCount}`;
    return s.or ? `OR ${s.orSet}.${s.or.orNumber}` : 'OR';
  });
  const roundName = $derived(
    game.state.round === 'auction'
      ? 'Initial Auction'
      : game.state.round === 'stock'
        ? 'Stock Round'
        : 'Operating Round'
  );
  const orCount = $derived(PHASES.find((p) => p.name === game.state.phase)?.operatingRounds ?? 1);
  // The OR set that follows the current stock round is "OR <srCount>"; while
  // operating, use the live orSet. (orSet only updates when the OR starts.)
  const orSetNum = $derived(game.state.round === 'operating' ? game.state.orSet : game.state.srCount);

  // Newest-first log lines, keyed by their absolute index in the full log so the
  // {#each} key is guaranteed unique and stable across renders.
  const logLines = $derived(
    game.state.log.map((line, idx) => ({ line, idx })).slice(-40).reverse()
  );
</script>

<div class="game">
  <!-- round / phase tracker -->
  <div class="tracker">
    <div class="track-pill" class:on={game.state.round === 'auction'} style="--c:#1b1b1b">ISR</div>
    <span class="arrow">→</span>
    <div class="track-pill sr" class:on={game.state.round === 'stock'}>SR {Math.max(1, game.state.srCount)}</div>
    <span class="arrow">→</span>
    {#each Array(orCount) as _, i}
      <div class="track-pill or" class:on={game.state.round === 'operating' && game.state.or?.orNumber === i + 1}>
        OR {Math.max(1, orSetNum)}.{i + 1}
      </div>
    {/each}
    <span class="phase">Phase {game.state.phase}</span>
  </div>

  <!-- status (tints to the active player's seat colour when it's your turn) -->
  <div class="status" class:myturn={game.canAct} style="--p:{seatColor(game.active ?? '')}">
    <div><span class="k">Round</span><span class="v">{roundLabel}<span class="rname"> · {roundName}</span></span></div>
    <div>
      <span class="k">{game.canAct ? 'Your turn' : 'Active'}</span>
      <span class="v player">{playerName(game.active)}{#if game.isBot(game.active)}<span class="botflag">BOT</span>{/if}</span>
    </div>
    <div><span class="k">Bank</span><span class="v">{CURRENCY}{game.state.bank.toLocaleString()}</span></div>
  </div>

  {#if game.error}<p class="err">{game.error}</p>{/if}

  <!-- history review (left) + undo/redo (right) -->
  <div class="history">
    <span class="hlabel">History</span>
    <div class="hgroup">
      <button title="To start" disabled={!game.canBack} onclick={() => game.first()}>|&lt;</button>
      <button title="Back" disabled={!game.canBack} onclick={() => game.back()}>&lt;&lt;</button>
      <button title="Forward" disabled={!game.canForward} onclick={() => game.forward()}>&gt;&gt;</button>
      <button title="To latest" disabled={!game.canForward} onclick={() => game.last()}>&gt;|</button>
      <span class="hpos">{game.cursor}/{game.actions.length}</span>
    </div>
    <div class="hgroup right">
      <button class="undo" disabled={!game.canUndo} onclick={() => game.undo()}>Undo</button>
      <button class="undo" disabled={!game.canRedo} onclick={() => game.redo()}>Redo</button>
      <button class="reset" onclick={() => game.reset()}>Reset game</button>
    </div>
  </div>

  {#if game.reviewing}
    <p class="reviewbar">
      Reviewing an earlier point in the game. <button class="link" onclick={() => game.last()}>Return to latest</button> to act.
    </p>
  {/if}

  <!-- actions -->
  <div class:locked={game.reviewing}>
    {#if game.state.round === 'auction'}
      <AuctionPanel />
    {:else if game.state.round === 'stock'}
      <StockPanel />
    {:else}
      <OperatingPanel />
    {/if}
  </div>

  <!-- log -->
  <div class="log">
    <h3>Log</h3>
    <ul>
      {#each logLines as entry (entry.idx)}
        <li>{entry.line}</li>
      {/each}
    </ul>
  </div>
</div>

<style>
  .tracker {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
    margin-bottom: 1rem;
  }
  .history {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    padding: 0.5rem 0.7rem;
    background: var(--bg-soft);
    border: 1px solid var(--line);
    border-radius: 10px;
    margin: 0.8rem 0;
  }
  .hlabel {
    font-size: 0.72rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .hgroup {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .hgroup.right {
    margin-left: auto;
  }
  .history button {
    min-width: 34px;
    min-height: 30px;
    padding: 0.25rem 0.5rem;
    border-radius: 7px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--ink);
    font: 600 0.8rem ui-monospace, monospace;
    cursor: pointer;
  }
  .history button:hover:not(:disabled) {
    border-color: var(--rail-deep);
  }
  .history button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .history button.undo {
    font-family: ui-sans-serif, sans-serif;
    color: var(--rail);
    border-color: var(--rail-deep);
  }
  .history button.reset {
    font-family: ui-sans-serif, sans-serif;
    color: var(--muted);
  }
  .hpos {
    font: 0.72rem ui-monospace, monospace;
    color: var(--muted);
    margin-left: 0.3rem;
  }
  .reviewbar {
    margin: 0 0 0.8rem;
    padding: 0.4rem 0.7rem;
    border-radius: 8px;
    background: rgba(245, 197, 66, 0.1);
    border: 1px solid var(--rail-deep);
    color: var(--ink);
    font-size: 0.82rem;
  }
  .link {
    background: none;
    border: none;
    color: var(--rail);
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
    padding: 0;
  }
  .locked {
    opacity: 0.5;
    pointer-events: none;
    filter: grayscale(0.3);
  }
  .track-pill {
    --c: #3fb6a8;
    min-width: 38px;
    text-align: center;
    padding: 0.3rem 0.6rem;
    border-radius: 999px;
    font: 700 0.8rem ui-sans-serif, sans-serif;
    color: #cdd6df;
    background: var(--bg-soft);
    border: 1px solid var(--line);
    opacity: 0.55;
  }
  .track-pill.sr {
    --c: #2f9e6f;
  }
  .track-pill.or {
    --c: #b5784a;
  }
  .track-pill.on {
    opacity: 1;
    color: #0f1419;
    background: var(--c);
    border-color: var(--c);
  }
  .arrow {
    color: var(--muted);
  }
  .phase {
    margin-left: auto;
    font-size: 0.8rem;
    color: var(--muted);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0.2rem 0.6rem;
  }
  .status {
    display: flex;
    gap: 1.4rem;
    flex-wrap: wrap;
    padding: 0.7rem 0.9rem;
    background: var(--bg-soft);
    border: 1px solid var(--line);
    border-radius: 10px;
    transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
  }
  /* When it's the local player's turn, tint the whole banner to their seat colour. */
  .status.myturn {
    border-color: var(--p);
    box-shadow: 0 0 0 2px var(--p) inset;
    background: color-mix(in srgb, var(--p) 12%, var(--bg-soft));
  }
  .status.myturn .k {
    color: var(--p);
  }
  .botflag {
    font-size: 0.58rem;
    color: var(--muted);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0 0.3rem;
    margin-left: 0.35rem;
    vertical-align: middle;
  }
  .status .k {
    display: block;
    font-size: 0.72rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .status .v {
    font-weight: 700;
  }
  .player {
    color: var(--p);
  }
  .rname {
    font-weight: 400;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .err {
    color: #ff8a7e;
    background: rgba(255, 100, 90, 0.1);
    border: 1px solid rgba(255, 100, 90, 0.3);
    border-radius: 8px;
    padding: 0.4rem 0.7rem;
    font-size: 0.85rem;
  }
  .log {
    margin-top: 0.5rem;
  }
  .log h3 {
    font-size: 0.85rem;
    color: var(--muted);
    margin: 0 0 0.4rem;
  }
  .log ul {
    list-style: none;
    margin: 0;
    padding: 0.6rem 0.8rem;
    background: var(--bg-soft);
    border: 1px solid var(--line);
    border-radius: 10px;
    max-height: 240px;
    overflow-y: auto;
    font: 0.82rem/1.5 ui-monospace, monospace;
  }
  .log li {
    color: #b7c3cf;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    padding: 0.15rem 0;
  }
</style>
