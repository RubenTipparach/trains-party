<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { goto } from '$app/navigation';
  import { fly, fade } from 'svelte/transition';
  import { BUILD_SHA } from '$lib/version';
  import { game, type SeatConfig } from '$lib/game/sandbox.svelte';
  import type { BotLevel } from '$lib/game/bots';

  const NAME_KEY = 'tp.playerName';

  let mode = $state<'single' | 'multi'>('single');
  let count = $state(4);
  const names = $state(['You', 'Bot 2', 'Bot 3', 'Bot 4', 'Bot 5', 'Bot 6']);
  const bots = $state([false, true, true, true, true, true]);
  const levels = $state<BotLevel[]>(['normal', 'normal', 'normal', 'normal', 'normal', 'normal']);

  // Player profile name (prompted once, then remembered).
  let you = $state('');
  let needName = $state(false);

  onMount(() => {
    const saved = localStorage.getItem(NAME_KEY)?.trim();
    if (saved) {
      you = saved;
      names[0] = saved;
    } else {
      needName = true;
    }
  });

  function saveName() {
    const n = you.trim();
    if (!n) return;
    localStorage.setItem(NAME_KEY, n);
    names[0] = n;
    needName = false;
  }

  function start() {
    if (names[0]?.trim()) localStorage.setItem(NAME_KEY, names[0].trim());
    const seats: SeatConfig[] = Array.from({ length: count }, (_, i) => ({
      id: `p${i + 1}`,
      name: names[i]?.trim() || `Player ${i + 1}`,
      bot: mode === 'single' ? bots[i] : false,
      level: levels[i]
    }));
    game.newGame(seats);
    goto(`${base}/board`);
  }
</script>

{#if needName}
  <div class="namemodal" transition:fade={{ duration: 150 }}>
    <div class="namebox" transition:fly={{ y: 12, duration: 200 }}>
      <h2>Welcome to Trains Party</h2>
      <p>What should we call you?</p>
      <input
        bind:value={you}
        placeholder="Your name"
        maxlength="20"
        onkeydown={(e) => e.key === 'Enter' && saveName()}
      />
      <button onclick={saveName} disabled={!you.trim()}>Continue</button>
    </div>
  </div>
{/if}

<main in:fade={{ duration: 400 }}>
  <a class="back" href={`${base}/`}>← All games</a>

  <header class="hero">
    <div class="badge" in:fly={{ y: -12, duration: 500 }}>1889 · Shikoku Railways</div>
    <h1 in:fly={{ y: 16, duration: 500, delay: 80 }}>New 1889 game</h1>
    <p class="tagline" in:fly={{ y: 16, duration: 500, delay: 160 }}>
      A modern, animated web port of the most approachable 18xx game.
    </p>
  </header>

  <section class="setup" in:fly={{ y: 20, duration: 420, delay: 240 }}>
    <h2>Set up</h2>

    <div class="modes">
      <button class="mode" class:on={mode === 'single'} onclick={() => (mode = 'single')}>
        <span class="mlabel">Single player</span>
        <span class="mdesc">Play against bots</span>
      </button>
      <button class="mode" class:on={mode === 'multi'} onclick={() => (mode = 'multi')}>
        <span class="mlabel">Multiplayer</span>
        <span class="mdesc">Online rooms · coming soon</span>
      </button>
    </div>

    <div class="players-row">
      <label for="count">Players</label>
      <select id="count" bind:value={count}>
        {#each [2, 3, 4, 5, 6] as n}<option value={n}>{n}</option>{/each}
      </select>
    </div>

    <div class="seats">
      {#each Array(count) as _, i}
        <div class="seat">
          <input class="name" bind:value={names[i]} placeholder={`Player ${i + 1}`} />
          {#if mode === 'single'}
            <div class="toggle">
              <button class:on={!bots[i]} onclick={() => (bots[i] = false)}>Human</button>
              <button class:on={bots[i]} onclick={() => (bots[i] = true)}>Bot</button>
            </div>
            <select class="lvl" bind:value={levels[i]} disabled={!bots[i]}>
              <option value="easy">Easy</option>
              <option value="normal">Normal</option>
            </select>
          {:else}
            <span class="seat-note">seat {i + 1}</span>
          {/if}
        </div>
      {/each}
    </div>

    {#if mode === 'multi'}
      <p class="note">Online multiplayer rooms arrive with the server stage. For now, start a single-player game against bots.</p>
    {/if}

    <button class="start" onclick={start}>Start game →</button>
  </section>

  <footer class="foot" in:fade={{ duration: 600, delay: 700 }}>
    <span>1889 · Shikoku Railways</span>
    <span class="dot">•</span>
    <span>build {BUILD_SHA}</span>
  </footer>
</main>

<style>
  main {
    max-width: 720px;
    margin: 0 auto;
    padding: clamp(2rem, 6vw, 4rem) 1.25rem 3rem;
    text-align: center;
  }
  .back {
    display: inline-block;
    color: var(--muted);
    text-decoration: none;
    font-size: 0.85rem;
    margin-bottom: 1.2rem;
  }
  .back:hover {
    color: var(--ink);
  }
  .badge {
    display: inline-block;
    font-size: 0.8rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--rail);
    border: 1px solid var(--rail-deep);
    border-radius: 999px;
    padding: 0.35rem 0.9rem;
    background: rgba(245, 197, 66, 0.06);
  }
  h1 {
    font-size: clamp(2.4rem, 9vw, 4.5rem);
    margin: 1rem 0 0.4rem;
    background: linear-gradient(120deg, var(--ink), var(--rail));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .tagline {
    color: var(--muted);
    margin: 0 auto 1.5rem;
    max-width: 40ch;
  }
  .setup {
    text-align: left;
    border: 1px solid var(--line);
    background: var(--bg-soft);
    border-radius: 16px;
    padding: 1.2rem 1.3rem 1.4rem;
  }
  .setup h2 {
    margin: 0 0 0.9rem;
    font-size: 1.2rem;
  }
  .modes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
    margin-bottom: 1rem;
  }
  .mode {
    text-align: left;
    padding: 0.7rem 0.9rem;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--ink);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .mode.on {
    border-color: var(--rail);
    box-shadow: 0 0 0 1px var(--rail) inset;
  }
  .mlabel {
    font-weight: 700;
  }
  .mdesc {
    font-size: 0.78rem;
    color: var(--muted);
  }
  .players-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.8rem;
  }
  .players-row label {
    font-weight: 600;
  }
  select,
  .name {
    background: var(--bg);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 0.4rem 0.5rem;
    font-size: 0.9rem;
  }
  .seats {
    display: grid;
    gap: 0.5rem;
  }
  .seat {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .name {
    flex: 1;
    min-width: 0;
  }
  .toggle {
    display: flex;
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow: hidden;
  }
  .toggle button {
    padding: 0.4rem 0.7rem;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    font-size: 0.82rem;
  }
  .toggle button.on {
    background: var(--rail);
    color: #1b1b1b;
    font-weight: 700;
  }
  .lvl:disabled {
    opacity: 0.4;
  }
  .seat-note {
    color: var(--muted);
    font-size: 0.8rem;
  }
  .note {
    color: var(--muted);
    font-size: 0.82rem;
    margin: 0.9rem 0 0;
  }
  .start {
    margin-top: 1.2rem;
    width: 100%;
    padding: 0.8rem 1.3rem;
    border-radius: 999px;
    background: var(--rail);
    color: #1b1b1b;
    font-weight: 800;
    font-size: 1rem;
    border: none;
    cursor: pointer;
    transition: transform 160ms ease, box-shadow 160ms ease;
  }
  .start:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(245, 197, 66, 0.25);
  }
  .foot {
    margin-top: 2rem;
    color: var(--muted);
    font-size: 0.85rem;
    display: flex;
    gap: 0.6rem;
    justify-content: center;
    align-items: center;
  }
  .dot {
    opacity: 0.4;
  }

  .namemodal {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    background: rgba(8, 12, 16, 0.72);
    backdrop-filter: blur(4px);
    padding: 1rem;
  }
  .namebox {
    width: min(420px, 100%);
    background: var(--bg-soft);
    border: 1px solid var(--rail-deep);
    border-radius: 16px;
    padding: 1.4rem 1.5rem 1.5rem;
    text-align: center;
  }
  .namebox h2 {
    margin: 0 0 0.3rem;
    color: var(--rail);
  }
  .namebox p {
    margin: 0 0 1rem;
    color: var(--muted);
  }
  .namebox input {
    width: 100%;
    background: var(--bg);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 0.7rem 0.8rem;
    font-size: 1.05rem;
    text-align: center;
    margin-bottom: 0.9rem;
  }
  .namebox button {
    width: 100%;
    padding: 0.75rem 1rem;
    border-radius: 999px;
    border: none;
    background: var(--rail);
    color: #1b1b1b;
    font-weight: 800;
    font-size: 1rem;
    cursor: pointer;
  }
  .namebox button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
