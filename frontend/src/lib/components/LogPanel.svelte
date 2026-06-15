<script lang="ts">
  // The game log on its own panel/tab, so it stays reachable in every round
  // (including operating rounds, where the Game tab shows the board). Newest first.
  import { game } from '$lib/game/sandbox.svelte';

  const logLines = $derived(
    game.state.log.map((line, idx) => ({ line, idx })).reverse()
  );
</script>

<div class="log">
  <ul>
    {#each logLines as entry (entry.idx)}
      <li>{entry.line}</li>
    {/each}
  </ul>
</div>

<style>
  .log ul {
    list-style: none;
    margin: 0;
    padding: 0.6rem 0.8rem;
    background: var(--bg-soft);
    border: 1px solid var(--line);
    border-radius: 10px;
    font: 0.82rem/1.5 ui-monospace, monospace;
  }
  .log li {
    color: #b7c3cf;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    padding: 0.18rem 0;
  }
</style>
