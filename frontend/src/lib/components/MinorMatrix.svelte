<script lang="ts">
  // The RoLA minor matrix: minors stacked in columns so players see what is coming
  // up, but only the bottom of each column is launchable (rulebook p.7). Launching
  // the bottom reveals the next one up the column.
  import { game } from '$lib/game/sandbox.svelte';
  import { parForBid, rolaStockLegalActions, currencyFor } from '$lib/engine';
  import CompanyLogo from './CompanyLogo.svelte';

  const CURRENCY = $derived(currencyFor(game.title));
  const matrix = $derived(game.state.minorMatrix ?? []);
  const corp = (sym: string) => game.state.corporations.find((c) => c.sym === sym)!;
  const launched = (sym: string) => corp(sym).parPrice !== null;
  const me = $derived(game.active ?? '');
  const legal = $derived(game.state.round === 'stock' ? rolaStockLegalActions(game.state) : null);
  const canLaunch = (sym: string) => !!legal?.launch.find((l) => l.corp === sym);
  const minBid = (sym: string) => legal?.launch.find((l) => l.corp === sym)?.minBid ?? 120;

  let sel = $state<{ sym: string; bid: number } | null>(null);
  const price = (bid: number) => parForBid(game.state, bid);
  function open(sym: string) {
    sel = { sym, bid: sel?.sym === sym ? sel.bid : minBid(sym) };
  }
  function launch(sym: string) {
    if (!sel || sel.sym !== sym) return;
    game.act({ type: 'launch', player: me, corp: sym, bid: sel.bid });
    if (!game.error) sel = null;
  }
  // For a column: the unlaunched minors, available first (bottom), upcoming above.
  const column = (col: string[]) => {
    const un = col.filter((s) => !launched(s));
    return { available: un[0] ?? null, upcoming: un.slice(1) };
  };
</script>

{#if matrix.length}
  <div class="matrix">
    <div class="mhead">
      <h3>Minor companies</h3>
      <span class="hint">Launch the bottom of a column — the next one reveals.</span>
    </div>
    <div class="cols">
      {#each matrix as col, i (i)}
        {@const c = column(col)}
        <div class="col">
          {#each [...c.upcoming].reverse() as sym (sym)}
            <div class="chip up" title="Up next">
              <CompanyLogo {sym} color={corp(sym).color} size={16} />
              <span class="csym" style="color:{corp(sym).color}">{corp(sym).sym}</span>
              <span class="cname">{corp(sym).name}</span>
            </div>
          {/each}

          {#if c.available}
            {@const sym = c.available}
            <div class="chip cur" style="--c:{corp(sym).color}">
              <div class="chiphead" style="background:{corp(sym).color}">
                <CompanyLogo {sym} color="#fff" size={20} />
                <span class="csym">{corp(sym).sym}</span>
                <span class="cname">{corp(sym).name}</span>
              </div>
              {#if game.canAct && canLaunch(sym)}
                {#if sel?.sym === sym}
                  <div class="launch">
                    <label>bid <input type="number" min={minBid(sym)} step="5" bind:value={sel.bid} /></label>
                    <span class="derv">price {CURRENCY}{price(sel.bid)} · treasury {CURRENCY}{sel.bid}</span>
                    <button class="go" disabled={sel.bid < minBid(sym) || sel.bid % 5 !== 0} onclick={() => launch(sym)}>
                      Launch
                    </button>
                  </div>
                {:else}
                  <button class="openbtn" onclick={() => open(sym)}>Launch · bid ≥ {CURRENCY}{minBid(sym)}</button>
                {/if}
              {:else}
                <div class="wait">bottom of column — launchable on a turn</div>
              {/if}
            </div>
          {:else}
            <div class="chip empty">all launched</div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .matrix {
    margin-bottom: 0.9rem;
  }
  .mhead {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    margin-bottom: 0.5rem;
    flex-wrap: wrap;
  }
  .mhead h3 {
    margin: 0;
    font-size: 0.95rem;
  }
  .hint {
    font-size: 0.76rem;
    color: var(--muted);
  }
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
    align-items: end;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .chip {
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg-soft);
  }
  /* upcoming: compact + dimmed, peeking out from behind the active one */
  .chip.up {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.25rem 0.5rem;
    opacity: 0.5;
    font-size: 0.78rem;
  }
  .chip.up .csym {
    font-weight: 800;
  }
  .chip.up .cname {
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip.empty {
    padding: 0.5rem;
    text-align: center;
    color: var(--muted);
    font-size: 0.78rem;
    opacity: 0.7;
  }
  /* active (launchable) minor */
  .chip.cur {
    border-color: var(--c);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    overflow: hidden;
  }
  .chiphead {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.55rem;
    color: #fff;
  }
  .chiphead .csym {
    font-weight: 800;
    letter-spacing: 0.03em;
  }
  .chiphead .cname {
    font-size: 0.82rem;
    opacity: 0.95;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .launch {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem;
    padding: 0.45rem 0.55rem;
  }
  .launch label {
    font-size: 0.78rem;
    color: var(--muted);
  }
  .launch input {
    width: 4.2rem;
    margin-left: 0.25rem;
    padding: 0.2rem 0.3rem;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--bg);
    color: var(--ink);
    font: inherit;
  }
  .derv {
    font-size: 0.74rem;
    color: var(--muted);
  }
  .openbtn,
  .go {
    border: none;
    border-radius: 6px;
    padding: 0.32rem 0.7rem;
    background: var(--c, var(--rail));
    color: #15110a;
    font-weight: 800;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .openbtn {
    margin: 0.45rem 0.55rem;
  }
  .go:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .wait {
    padding: 0.4rem 0.55rem;
    font-size: 0.74rem;
    color: var(--muted);
  }
</style>
