<script lang="ts">
  import { game } from '$lib/game/sandbox.svelte';
  import { mergePartners, availableMajors } from '$lib/engine';

  const m = $derived(game.state.merger);
  const proposer = $derived(m && !m.pending ? (m.queue[m.index] ?? null) : null);
  const partners = $derived(proposer ? mergePartners(game.state, proposer) : []);
  const majors = $derived(availableMajors(game.state));
  let major = $state('');
  $effect(() => {
    if (!major || !majors.includes(major)) major = majors[0] ?? '';
  });
  const corpOf = (sym: string) => game.state.corporations.find((c) => c.sym === sym);
  const pname = (id: string | null) =>
    id ? (game.state.players.find((p) => p.id === id)?.name ?? id) : '-';
</script>

{#if m}
  <div class="merger">
    <p class="lead">
      Pairs of minors that can trace a route to each other may merge into a Major
      Corporation, in stock order.
    </p>

    {#if game.error}<p class="err">{game.error}</p>{/if}

    {#if m.pending}
      {@const target = corpOf(m.pending.to)}
      <div class="card">
        <p>
          <b style="color:{corpOf(m.pending.from)?.color}">{m.pending.from}</b> proposes merging
          with <b style="color:{target?.color}">{m.pending.to}</b> into
          <b>{m.pending.major}</b>.
        </p>
        {#if game.canAct}
          <div class="act">
            <button onclick={() => game.act({ type: 'accept_merge', player: target!.president! })}>Accept merger</button>
            <button class="ghost" onclick={() => game.act({ type: 'decline_merge', player: target!.president! })}>Decline</button>
          </div>
        {:else}
          <p class="muted">Waiting for {pname(target?.president ?? null)} to answer…</p>
        {/if}
      </div>
    {:else if proposer}
      {@const pc = corpOf(proposer)}
      <div class="card">
        <p>
          <b style="color:{pc?.color}">{proposer}</b> ({pname(pc?.president ?? null)}) may propose
          a merger{partners.length === 0 ? ' - no reachable partner right now' : ''}.
        </p>
        {#if game.canAct}
          {#if partners.length && majors.length}
            <div class="act">
              <label class="msel">
                into
                <select bind:value={major}>
                  {#each majors as M (M)}<option value={M}>{M} · {corpOf(M)?.name}</option>{/each}
                </select>
              </label>
              {#each partners as p (p)}
                <button onclick={() => game.act({ type: 'propose_merge', player: pc!.president!, from: proposer!, to: p, major })}>
                  Merge with {p}
                </button>
              {/each}
            </div>
          {/if}
          <div class="act">
            <button class="ghost" onclick={() => game.act({ type: 'pass', player: pc!.president! })}>Pass (no merger)</button>
          </div>
        {:else}
          <p class="muted">Waiting for {pname(pc?.president ?? null)}…</p>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .lead {
    margin: 0 0 0.8rem;
    color: var(--muted);
    font-size: 0.88rem;
    line-height: 1.5;
  }
  .card {
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg-soft);
    padding: 0.8rem 0.9rem;
  }
  .card p {
    margin: 0 0 0.6rem;
  }
  .act {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.5rem;
  }
  .act button {
    padding: 0.45rem 0.85rem;
    border-radius: 8px;
    border: 1px solid var(--rail-deep);
    background: var(--rail);
    color: #1b1b1b;
    font: 700 0.82rem ui-sans-serif, sans-serif;
    cursor: pointer;
  }
  .act button.ghost {
    background: transparent;
    color: var(--ink);
    border-color: var(--line);
  }
  .msel {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.82rem;
    color: var(--muted);
  }
  .msel select {
    background: var(--bg);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 0.35rem 0.5rem;
  }
  .muted {
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
</style>
