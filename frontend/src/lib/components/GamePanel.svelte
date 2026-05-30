<script lang="ts">
  import { game } from '$lib/game/sandbox.svelte';
  import AuctionPanel from './AuctionPanel.svelte';
  import StockPanel from './StockPanel.svelte';
  import { PHASES, CURRENCY } from '$lib/data/g1889';

  const SEAT = ['#f5c542', '#3fb6a8', '#e0655c', '#9b8cf0', '#7cc36b', '#e8923a'];
  const seatColor = (id: string) => {
    const i = game.state.players.findIndex((p) => p.id === id);
    return SEAT[i % SEAT.length];
  };
  const playerName = (id: string | null) =>
    id ? (game.state.players.find((p) => p.id === id)?.name ?? id) : '-';

  const roundLabel = $derived(
    game.state.round === 'auction'
      ? 'Initial Auction'
      : game.state.round === 'stock'
        ? 'Stock Round'
        : 'Operating Round'
  );
  const orCount = $derived(PHASES.find((p) => p.name === game.state.phase)?.operatingRounds ?? 1);
</script>

<div class="game">
  <!-- round / phase tracker -->
  <div class="tracker">
    <div class="track-pill" class:on={game.state.round === 'auction'} style="--c:#1b1b1b">ISR</div>
    <span class="arrow">→</span>
    <div class="track-pill sr" class:on={game.state.round === 'stock'}>SR</div>
    <span class="arrow">→</span>
    {#each Array(orCount) as _, i}
      <div class="track-pill or" class:on={game.state.round === 'operating'}>OR{orCount > 1 ? ` ${i + 1}` : ''}</div>
    {/each}
    <span class="phase">Phase {game.state.phase}</span>
  </div>

  <!-- status -->
  <div class="status">
    <div><span class="k">Round</span><span class="v">{roundLabel}</span></div>
    <div>
      <span class="k">Active</span>
      <span class="v player" style="--p:{seatColor(game.active ?? '')}">{playerName(game.active)}</span>
    </div>
    <div><span class="k">Bank</span><span class="v">{CURRENCY}{game.state.bank.toLocaleString()}</span></div>
  </div>

  {#if game.error}<p class="err">{game.error}</p>{/if}

  <!-- actions -->
  {#if game.state.round === 'auction'}
    <AuctionPanel />
  {:else if game.state.round === 'stock'}
    <StockPanel />
  {:else}
    <p class="muted">Operating round actions arrive in Stage 3.</p>
  {/if}
  <div class="actions"><button class="reset" onclick={() => game.reset()}>Reset game</button></div>

  <!-- log -->
  <div class="log">
    <h3>Log</h3>
    <ul>
      {#each [...game.state.log].slice(-40).reverse() as line, i (game.state.log.length - i)}
        <li>{line}</li>
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
  .err {
    color: #ff8a7e;
    background: rgba(255, 100, 90, 0.1);
    border: 1px solid rgba(255, 100, 90, 0.3);
    border-radius: 8px;
    padding: 0.4rem 0.7rem;
    font-size: 0.85rem;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    margin: 1rem 0;
  }
  .actions button {
    padding: 0.5rem 0.85rem;
    border-radius: 8px;
    border: 1px solid var(--rail-deep);
    background: var(--rail);
    color: #1b1b1b;
    font: 600 0.85rem ui-sans-serif, sans-serif;
    cursor: pointer;
  }
  .actions button.reset {
    margin-left: auto;
    background: transparent;
    color: var(--muted);
    border-color: var(--line);
  }
  .muted {
    color: var(--muted);
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
