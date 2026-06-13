<script lang="ts">
  // The RoLA minor matrix: minors stacked in columns so players see what is coming
  // up, but only the bottom of each column is launchable (rulebook p.7). Launching
  // the bottom reveals the next one up the column.
  import { game } from '$lib/game/sandbox.svelte';
  import { parForBid, rolaStockLegalActions, currencyFor, adaptiveHomes, configFor } from '$lib/engine';
  import CompanyLogo from './CompanyLogo.svelte';

  const CURRENCY = $derived(currencyFor(game.title));
  const matrix = $derived(game.state.minorMatrix ?? []);
  const corp = (sym: string) => game.state.corporations.find((c) => c.sym === sym)!;
  const launched = (sym: string) => corp(sym).parPrice !== null;
  const me = $derived(game.active ?? '');
  const legal = $derived(game.state.round === 'stock' ? rolaStockLegalActions(game.state) : null);
  // A minor is launched only by winning a bidding auction (rulebook p.10).
  const auction = $derived(legal?.auction ?? null);
  const available = (sym: string) => legal?.available.includes(sym) ?? false;
  const pname = (id: string) => game.state.players.find((p) => p.id === id)?.name ?? id;

  const price = (bid: number) => parForBid(game.state, bid);
  // Opening-bid and raise inputs.
  let openBid = $state(120);
  let raiseBid = $state(125);
  $effect(() => {
    if (legal && openBid < legal.minBid) openBid = legal.minBid;
  });
  $effect(() => {
    if (auction && raiseBid < auction.minRaise) raiseBid = auction.minRaise;
  });

  // Adaptive chooses an empty basic-city home as it launches.
  const homes = $derived(adaptiveHomes(game.state));
  let homeSel = $state('');
  $effect(() => {
    if (!homeSel || !homes.includes(homeSel)) homeSel = homes[0] ?? '';
  });
  const minorDef = (sym: string) => configFor(game.title).minors?.find((m) => m.sym === sym);
  const descOf = (sym: string) => minorDef(sym)?.desc ?? '';
  const isAdaptive = (sym: string) => minorDef(sym)?.ability?.type === 'choose_home';

  function initiate() {
    game.act({ type: 'initiate_auction', player: me, bid: openBid });
  }
  function raise() {
    game.act({ type: 'launch_bid', player: me, bid: raiseBid });
  }
  function passAuction() {
    game.act({ type: 'pass', player: me });
  }
  function launchPick(sym: string) {
    game.act({ type: 'launch', player: me, corp: sym, ...(isAdaptive(sym) ? { home: homeSel } : {}) });
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
    </div>

    {#if auction}
      <div class="auc">
        <div class="aucrow">
          <span>Launch auction. High bid <b>{CURRENCY}{auction.highBid}</b> by <b>{pname(auction.highBidder)}</b></span>
          <span class="muted">price would be {CURRENCY}{price(auction.highBid)}</span>
        </div>
        {#if game.canAct && auction.myTurn}
          <div class="aucact">
            <label>raise to <input type="number" min={auction.minRaise} step="5" bind:value={raiseBid} /></label>
            <button class="go" disabled={raiseBid < auction.minRaise || raiseBid % 5 !== 0} onclick={raise}>Bid</button>
            <button class="ghost" onclick={passAuction}>Drop out</button>
          </div>
        {:else if game.canAct && auction.iWon}
          <p class="muted">You won. Pick a minor below to launch for {CURRENCY}{auction.highBid}.</p>
        {:else}
          <p class="muted">Waiting for {pname(legal?.player ?? '')} to bid…</p>
        {/if}
      </div>
    {:else if game.canAct && legal?.canInitiate}
      <div class="auc">
        <div class="aucact">
          <label>open auction at <input type="number" min={legal.minBid} step="5" bind:value={openBid} /></label>
          <span class="muted">price {CURRENCY}{price(openBid)}</span>
          <button class="go" disabled={openBid < legal.minBid || openBid % 5 !== 0} onclick={initiate}>Start auction</button>
        </div>
      </div>
    {/if}

    <div class="cols">
      {#each matrix as col, i (i)}
        {@const c = column(col)}
        <div class="col">
          {#each [...c.upcoming].reverse() as sym (sym)}
            <div class="chip up" title={descOf(sym) || 'Up next'}>
              <CompanyLogo {sym} color={corp(sym).color} size={16} />
              <span class="csym" style="color:{corp(sym).color}">{corp(sym).sym}</span>
              <span class="cname">{corp(sym).name}</span>
            </div>
          {/each}

          {#if c.available}
            {@const sym = c.available}
            <div class="chip cur" style="--c:{corp(sym).color}">
              <div class="chiphead" style="background:{corp(sym).color}">
                <CompanyLogo {sym} color={corp(sym).color} size={22} />
                <span class="csym">{corp(sym).sym}</span>
                <span class="cname">{corp(sym).name}</span>
              </div>
              {#if descOf(sym)}
                <p class="cdesc">{descOf(sym)}</p>
              {/if}
              {#if game.canAct && auction?.iWon && available(sym)}
                <div class="launch">
                  {#if isAdaptive(sym)}
                    <label>home
                      <select bind:value={homeSel}>
                        {#each homes as h (h)}<option value={h}>{h}</option>{/each}
                      </select>
                    </label>
                  {/if}
                  <button class="go" disabled={isAdaptive(sym) && !homeSel} onclick={() => launchPick(sym)}>
                    Launch for {CURRENCY}{auction.highBid}
                  </button>
                </div>
              {:else}
                <div class="wait">bottom of column - launched by auction</div>
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
  .auc {
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg-soft);
    padding: 0.55rem 0.7rem;
    margin-bottom: 0.7rem;
  }
  .aucrow {
    display: flex;
    justify-content: space-between;
    gap: 0.6rem;
    flex-wrap: wrap;
    font-size: 0.86rem;
    margin-bottom: 0.4rem;
  }
  .aucact {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .aucact label {
    font-size: 0.8rem;
    color: var(--muted);
  }
  .aucact input {
    width: 4.6rem;
    margin-left: 0.3rem;
    padding: 0.2rem 0.3rem;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--bg);
    color: var(--ink);
    font: inherit;
  }
  .muted {
    color: var(--muted);
    font-size: 0.82rem;
    margin: 0.2rem 0 0;
  }
  .ghost {
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0.32rem 0.7rem;
    background: transparent;
    color: var(--ink);
    font-weight: 700;
    font-size: 0.8rem;
    cursor: pointer;
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
  .cdesc {
    margin: 0;
    padding: 0.4rem 0.55rem 0.1rem;
    font-size: 0.76rem;
    line-height: 1.3;
    color: var(--muted);
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
