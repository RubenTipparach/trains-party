<script lang="ts">
  import { base } from '$app/paths';
  import { fly, fade } from 'svelte/transition';
  import { BUILD_SHA } from '$lib/version';
  import { GAMES } from '$lib/data/games';
</script>

<main in:fade={{ duration: 400 }}>
  <header class="hero">
    <div class="badge" in:fly={{ y: -12, duration: 500 }}>18xx · web</div>
    <h1 in:fly={{ y: 16, duration: 500, delay: 80 }}>Trains Party</h1>
    <p class="tagline" in:fly={{ y: 16, duration: 500, delay: 160 }}>
      Modern, animated web ports of the 18xx railway games. Pick a title to play.
    </p>
  </header>

  <section class="games">
    {#each GAMES as g, i (g.id)}
      <article class="card" class:soon={g.status === 'coming-soon'} style="--accent:{g.accent}" in:fly={{ y: 20, duration: 420, delay: 220 + i * 90 }}>
        <div class="ctop">
          <h2>{g.title}</h2>
          {#if g.status === 'coming-soon'}<span class="tag">Coming soon</span>{/if}
        </div>
        <p class="sub">{g.subtitle}</p>
        <p class="meta">
          {#if g.players}<span>{g.players} players</span><span class="dot">•</span>{/if}
          <span>{g.publisher}</span>
          {#if g.designer}<span class="dot">•</span><span>{g.designer}</span>{/if}
        </p>
        <p class="blurb">{g.blurb}</p>
        <div class="actions">
          {#if g.status === 'playable' && g.path}
            <a class="play" href={`${base}${g.path}`}>Play →</a>
          {/if}
          {#if g.rulebookUrl}
            <a class="rules" href={g.rulebookUrl} target="_blank" rel="noopener noreferrer">Rulebook ↗</a>
          {/if}
        </div>
      </article>
    {/each}
  </section>

  <p class="more" in:fade={{ duration: 600, delay: 600 }}>
    More 18xx titles are on the way. See the
    <a href="https://www.asterisk-games.com/rulebook" target="_blank" rel="noopener noreferrer">Asterisk Games rulebooks</a>
    for what's coming.
  </p>

  <footer class="foot" in:fade={{ duration: 600, delay: 700 }}>
    <span>Trains Party</span>
    <span class="dot">•</span>
    <span>build {BUILD_SHA}</span>
  </footer>
</main>

<style>
  main {
    max-width: 880px;
    margin: 0 auto;
    padding: clamp(2rem, 6vw, 4rem) 1.25rem 3rem;
    text-align: center;
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
    margin: 0 auto 2rem;
    max-width: 46ch;
  }
  .games {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1rem;
    text-align: left;
  }
  .card {
    border: 1px solid var(--line);
    border-top: 3px solid var(--accent);
    background: var(--bg-soft);
    border-radius: 16px;
    padding: 1.1rem 1.2rem 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .card.soon {
    opacity: 0.92;
  }
  .ctop {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .card h2 {
    margin: 0;
    font-size: 1.3rem;
    color: var(--accent);
  }
  .tag {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0.1rem 0.5rem;
    white-space: nowrap;
  }
  .sub {
    margin: 0;
    font-weight: 600;
  }
  .meta {
    margin: 0;
    font-size: 0.78rem;
    color: var(--muted);
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
  }
  .blurb {
    margin: 0.3rem 0 0.6rem;
    font-size: 0.86rem;
    color: var(--ink);
    flex: 1;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .play {
    padding: 0.55rem 1.1rem;
    border-radius: 999px;
    background: var(--rail);
    color: #1b1b1b;
    font-weight: 800;
    text-decoration: none;
    transition: transform 160ms ease, box-shadow 160ms ease;
  }
  .play:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(245, 197, 66, 0.25);
  }
  .rules {
    color: var(--muted);
    text-decoration: none;
    font-size: 0.85rem;
  }
  .rules:hover {
    color: var(--ink);
  }
  .more {
    margin: 2rem auto 0;
    color: var(--muted);
    font-size: 0.85rem;
    max-width: 50ch;
  }
  .more a {
    color: var(--rail);
  }
  .foot {
    margin-top: 1.4rem;
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
</style>
