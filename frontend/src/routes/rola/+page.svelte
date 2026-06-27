<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { goto } from '$app/navigation';
  import { fly, fade } from 'svelte/transition';
  import { game, type SeatConfig } from '$lib/game/sandbox.svelte';
  import type { BotLevel } from '$lib/game/bots';

  const NAME_KEY = 'tp.playerName';

  let count = $state(4); // RoLA: 2-5 players
  let mapMode = $state<'auto' | 'manual'>('auto');
  let hostileMergers = $state(false);
  let localRoutes = $state(true);
  const names = $state(['You', 'Bot 2', 'Bot 3', 'Bot 4', 'Bot 5']);
  const bots = $state([false, true, true, true, true]);
  const levels = $state<BotLevel[]>(['easy', 'easy', 'easy', 'easy', 'easy']);

  onMount(() => {
    const saved = localStorage.getItem(NAME_KEY)?.trim();
    if (saved) names[0] = saved;
  });

  function start() {
    if (names[0]?.trim()) localStorage.setItem(NAME_KEY, names[0].trim());
    const seats: SeatConfig[] = Array.from({ length: count }, (_, i) => ({
      id: `p${i + 1}`,
      name: names[i]?.trim() || `Player ${i + 1}`,
      bot: bots[i],
      level: levels[i]
    }));
    const code = game.newGame(seats, 'rola', { mapMode, hostileMergers, localRoutes });
    goto(`${base}/rola/room/${code}`);
  }
</script>

<main in:fade={{ duration: 400 }}>
  <a class="back" href={`${base}/`}>← All games</a>

  <header class="hero">
    <div class="badge" in:fly={{ y: -12, duration: 500 }}>Railways of the Lost Atlas</div>
    <h1 in:fly={{ y: 16, duration: 500, delay: 80 }}>New RoLA game</h1>
    <p class="tagline" in:fly={{ y: 16, duration: 500, delay: 160 }}>
      An 18xx where minor companies launch, expand, and merge into majors. Play against bots.
    </p>
  </header>

  <section class="setup" in:fly={{ y: 20, duration: 420, delay: 240 }}>
    <h2>Set up</h2>

    <div class="players-row">
      <label for="count">Players</label>
      <select id="count" bind:value={count}>
        {#each [2, 3, 4, 5] as n}<option value={n}>{n}</option>{/each}
      </select>
    </div>

    <div class="players-row">
      <span class="maplbl">Map</span>
      <div class="toggle">
        <button class:on={mapMode === 'auto'} onclick={() => (mapMode = 'auto')}>Auto (algorithm)</button>
        <button class:on={mapMode === 'manual'} onclick={() => (mapMode = 'manual')}>Manual (place tiles)</button>
      </div>
    </div>

    <div class="players-row">
      <span class="maplbl">Mergers</span>
      <div class="toggle">
        <button class:on={!hostileMergers} onclick={() => (hostileMergers = false)}>Consensual</button>
        <button class:on={hostileMergers} onclick={() => (hostileMergers = true)}>Hostile (share vote)</button>
      </div>
    </div>

    <div class="players-row">
      <span class="maplbl">Local routes</span>
      <div class="toggle">
        <button class:on={localRoutes} onclick={() => (localRoutes = true)}>On</button>
        <button class:on={!localRoutes} onclick={() => (localRoutes = false)}>Off</button>
      </div>
    </div>

    <div class="seats">
      {#each Array(count) as _, i}
        <div class="seat">
          <input class="name" bind:value={names[i]} placeholder={`Player ${i + 1}`} />
          <div class="toggle">
            <button class:on={!bots[i]} onclick={() => (bots[i] = false)}>Human</button>
            <button class:on={bots[i]} onclick={() => (bots[i] = true)}>Bot</button>
          </div>
          <select class="lvl" bind:value={levels[i]} disabled={!bots[i]} title="Hard: adds a sharper train rush and ganging up on the leader. Easy: plays a solid strategy. Testing: makes simple legal moves to fill a seat.">
            <option value="hard">Hard</option>
            <option value="easy">Easy</option>
            <option value="testing">Testing</option>
          </select>
        </div>
      {/each}
    </div>

    <p class="note">
      Auto builds a fresh procedural board instantly. Manual lets you and the bots
      lay tri-hex tiles in turn on the Map tab to build the board together.
    </p>
    <p class="note">
      Consensual mergers need the target president's consent. Hostile mergers settle
      a refused proposal by a share vote instead: treasury shares abstain, pooled
      shares back the side that raises their value, and bots always vote against.
    </p>
    <p class="note">
      Local routes (on by default): a train that can't reach a second city may still
      run its hub city alone for that city's value.
    </p>

    <button class="start" onclick={start}>Start game →</button>
  </section>
</main>

<style>
  main {
    max-width: 760px;
    margin: 0 auto;
    padding: 2rem 1.2rem 4rem;
    color: #e9e6df;
  }
  .back {
    color: #9aa0aa;
    text-decoration: none;
    font-size: 0.9rem;
  }
  .hero {
    margin: 1.5rem 0 2rem;
  }
  .badge {
    display: inline-block;
    background: #5fb0e6;
    color: #06202e;
    font-weight: 700;
    border-radius: 999px;
    padding: 0.25rem 0.8rem;
    font-size: 0.8rem;
  }
  h1 {
    margin: 0.6rem 0 0.4rem;
    font-size: 2rem;
  }
  .tagline {
    color: #b6bcc6;
    margin: 0;
  }
  .setup {
    background: #1c2330;
    border: 1px solid #2c3543;
    border-radius: 14px;
    padding: 1.4rem;
  }
  h2 {
    margin: 0 0 1rem;
    font-size: 1.1rem;
  }
  .players-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 1rem;
  }
  select,
  .name {
    background: #0f141c;
    color: #e9e6df;
    border: 1px solid #2c3543;
    border-radius: 8px;
    padding: 0.45rem 0.6rem;
  }
  .seats {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-bottom: 1rem;
  }
  .seat {
    display: flex;
    gap: 0.6rem;
    align-items: center;
  }
  .name {
    flex: 1;
  }
  .toggle button {
    background: #0f141c;
    color: #b6bcc6;
    border: 1px solid #2c3543;
    padding: 0.4rem 0.7rem;
    cursor: pointer;
  }
  .toggle button:first-child {
    border-radius: 8px 0 0 8px;
  }
  .toggle button:last-child {
    border-radius: 0 8px 8px 0;
  }
  .toggle button.on {
    background: #5fb0e6;
    color: #06202e;
    font-weight: 700;
  }
  .note {
    color: #8b93a0;
    font-size: 0.85rem;
    line-height: 1.4;
  }
  .start {
    background: #5fb0e6;
    color: #06202e;
    font-weight: 800;
    border: none;
    border-radius: 10px;
    padding: 0.7rem 1.2rem;
    font-size: 1rem;
    cursor: pointer;
  }
</style>
