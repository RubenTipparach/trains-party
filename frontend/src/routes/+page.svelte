<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import { BUILD_SHA } from '$lib/version';
  import { TRAINS } from '$lib/data/g1889';
</script>

<main in:fade={{ duration: 400 }}>
  <header class="hero">
    <div class="badge" in:fly={{ y: -12, duration: 500 }}>1889 · Shikoku Railways</div>
    <h1 in:fly={{ y: 16, duration: 500, delay: 80 }}>Trains Party</h1>
    <p class="tagline" in:fly={{ y: 16, duration: 500, delay: 160 }}>
      A modern, animated web port of the most approachable 18xx game.
    </p>
  </header>

  <section class="roster">
    {#each TRAINS as t, i (t.name)}
      <div class="train" in:fly={{ y: 20, duration: 420, delay: 220 + i * 70 }}>
        <span class="train-name">{t.name}</span>
        <span class="train-cost">¥{t.cost}</span>
      </div>
    {/each}
  </section>

  <footer class="foot" in:fade={{ duration: 600, delay: 700 }}>
    <span>Stage 0 · scaffold</span>
    <span class="dot">•</span>
    <span>build {BUILD_SHA}</span>
    <span class="dot">•</span>
    <a href="https://github.com/tobymao/18xx" rel="noreferrer">reference engine</a>
  </footer>
</main>

<style>
  main {
    max-width: 880px;
    margin: 0 auto;
    padding: clamp(2rem, 6vw, 5rem) 1.25rem 3rem;
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
    font-size: clamp(2.6rem, 9vw, 5rem);
    margin: 1rem 0 0.4rem;
    background: linear-gradient(120deg, var(--ink), var(--rail));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }

  .tagline {
    color: var(--muted);
    font-size: 1.05rem;
    margin: 0 auto;
    max-width: 40ch;
  }

  .roster {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    justify-content: center;
    margin-top: 2.5rem;
  }

  .train {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 64px;
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg-soft);
    transition: transform 160ms ease, border-color 160ms ease;
  }

  .train:hover {
    transform: translateY(-4px);
    border-color: var(--rail-deep);
  }

  .train-name {
    font-size: 1.4rem;
    font-weight: 700;
    color: var(--rail);
  }

  .train-cost {
    font-size: 0.8rem;
    color: var(--muted);
  }

  .foot {
    margin-top: 3.5rem;
    color: var(--muted);
    font-size: 0.85rem;
    display: flex;
    gap: 0.6rem;
    justify-content: center;
    align-items: center;
    flex-wrap: wrap;
  }

  .dot {
    opacity: 0.4;
  }
</style>
