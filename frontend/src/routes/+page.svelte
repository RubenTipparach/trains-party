<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { fly, fade } from 'svelte/transition';
  import { BUILD_SHA } from '$lib/version';
  import { GAMES } from '$lib/data/games';
  import { listSessions, deleteSession, migrateLegacySaves, type SessionMeta } from '$lib/game/sessions';

  // The lobby reads client-side localStorage, so it populates on mount (the
  // prerendered shell shows nothing until then).
  let sessions = $state<SessionMeta[]>([]);
  const refresh = () => (sessions = listSessions());
  onMount(() => {
    migrateLegacySaves();
    refresh();
  });
  const titleOf = (id: string) => GAMES.find((g) => g.id === id)?.title ?? id;
  function remove(code: string) {
    deleteSession(code);
    refresh();
  }
  function ago(t: number): string {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  }
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
        {#if g.status === 'playable' && g.path}
          <div class="actions">
            <a class="play" href={`${base}${g.path}`}>Play →</a>
          </div>
        {/if}
      </article>
    {/each}
  </section>

  <section class="lobby" in:fade={{ duration: 400, delay: 320 }}>
    <h2 class="lobtitle">Your games</h2>
    {#if sessions.length === 0}
      <p class="empty">No games yet. Pick a title above to start one - each game gets its own room.</p>
    {:else}
      <ul class="rooms">
        {#each sessions as s (s.code)}
          <li class="room" style="--accent:{GAMES.find((g) => g.id === s.title)?.accent ?? '#f5c542'}">
            <a class="rmain" href={`${base}/${s.title}/room/${s.code}`}>
              <span class="rtitle">{titleOf(s.title)}</span>
              <span class="rcode">Room {s.code.toUpperCase()}</span>
              <span class="rmeta">
                {s.seats.length} players
                <span class="dot">•</span>{s.status}
                <span class="dot">•</span>{s.moves} moves
                <span class="dot">•</span>{ago(s.updatedAt)}
              </span>
            </a>
            <button class="rdel" title="Delete this game" onclick={() => remove(s.code)}>Delete</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

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
  .lobby {
    margin-top: 2.4rem;
    text-align: left;
  }
  .lobtitle {
    font-size: 1.05rem;
    margin: 0 0 0.8rem;
    color: var(--ink);
  }
  .empty {
    color: var(--muted);
    font-size: 0.9rem;
  }
  .rooms {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .room {
    display: flex;
    align-items: stretch;
    border: 1px solid var(--line);
    border-left: 3px solid var(--accent);
    border-radius: 12px;
    background: var(--bg-soft);
    overflow: hidden;
  }
  .rmain {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas: 'title code' 'meta meta';
    gap: 0.15rem 0.6rem;
    padding: 0.7rem 0.9rem;
    text-decoration: none;
    color: inherit;
    transition: background 140ms ease;
  }
  .rmain:hover {
    background: rgba(255, 255, 255, 0.03);
  }
  .rtitle {
    grid-area: title;
    font-weight: 700;
    color: var(--accent);
  }
  .rcode {
    grid-area: code;
    font: 700 0.75rem ui-monospace, monospace;
    letter-spacing: 0.06em;
    color: var(--muted);
    align-self: center;
  }
  .rmeta {
    grid-area: meta;
    font-size: 0.78rem;
    color: var(--muted);
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    align-items: center;
  }
  .rdel {
    border: none;
    border-left: 1px solid var(--line);
    background: none;
    color: var(--muted);
    font-size: 0.78rem;
    padding: 0 0.9rem;
    cursor: pointer;
    transition: color 140ms ease, background 140ms ease;
  }
  .rdel:hover {
    color: #e0655c;
    background: rgba(224, 101, 92, 0.08);
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
