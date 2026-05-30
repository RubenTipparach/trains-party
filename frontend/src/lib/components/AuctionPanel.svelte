<script lang="ts">
  import { game } from '$lib/game/sandbox.svelte';
  import { auctionView, maxBidFor } from '$lib/engine';
  import { COMPANIES, CURRENCY } from '$lib/data/g1889';

  const SEAT = ['#f5c542', '#3fb6a8', '#e0655c', '#9b8cf0', '#7cc36b', '#e8923a'];
  const seatColor = (id: string) => {
    const i = game.state.players.findIndex((p) => p.id === id);
    return SEAT[i % SEAT.length];
  };
  const pname = (id: string) => game.state.players.find((p) => p.id === id)?.name ?? id;
  const desc = (sym: string) => COMPANIES.find((c) => c.sym === sym)?.desc ?? '';
  const cname = (sym: string) => COMPANIES.find((c) => c.sym === sym)?.name ?? sym;

  const av = $derived(auctionView(game.state));
</script>

<div class="auction">
  <!-- player liquidity strip -->
  <div class="players">
    {#each av.players as pl (pl.id)}
      <div class="pcard" class:active={pl.id === av.active} style="--p:{seatColor(pl.id)}">
        <div class="pname">{pl.name}{#if pl.id === av.active}<span class="turn">to act</span>{/if}</div>
        <div class="pmoney">
          <span class="avail">{CURRENCY}{pl.available}</span>
          <span class="sub">available</span>
        </div>
        <div class="prow"><span>Cash</span><span>{CURRENCY}{pl.cash}</span></div>
        <div class="prow locked"><span>In bids</span><span>{CURRENCY}{pl.committed}</span></div>
      </div>
    {/each}
  </div>

  {#if game.error}<p class="err">{game.error}</p>{/if}

  <!-- company cards with live bids -->
  <div class="companies">
    {#each av.companies as c (c.sym)}
      <div class="company" class:focus={c.inAuction || (!av.auctioning && c.buyable)}>
        <div class="chead">
          <span class="sym">{c.sym}</span>
          <span class="cn">{cname(c.sym)}</span>
          {#if c.inAuction}<span class="tag auc">auctioning</span>{:else if c.buyable}<span class="tag buy">cheapest</span>{/if}
        </div>
        <div class="cstats">
          <span><strong>{CURRENCY}{c.value - c.discount}</strong>{#if c.discount > 0} <s>{CURRENCY}{c.value}</s>{/if} cost</span>
          <span><strong>{CURRENCY}{c.revenue}</strong> revenue</span>
        </div>
        <p class="cdesc">{desc(c.sym)}</p>

        {#if c.bids.length}
          <div class="bids">
            <span class="blabel">Bids</span>
            {#each [...c.bids].sort((a, b) => b.price - a.price) as bid (bid.player)}
              <span class="bid" style="--p:{seatColor(bid.player)}">{pname(bid.player)} {CURRENCY}{bid.price}</span>
            {/each}
          </div>
        {/if}

        <!-- active player's action on this company -->
        {#if av.auctioning ? c.inAuction : true}
          <div class="cact">
            {#if c.inAuction}
              <button onclick={() => game.act({ type: 'bid', player: av.active, company: c.sym, price: c.minBid })}>
                Raise to {CURRENCY}{c.minBid}
              </button>
            {:else if c.buyable}
              <button onclick={() => game.act({ type: 'bid', player: av.active, company: c.sym, price: c.minBid })}>
                Buy {CURRENCY}{c.minBid}
              </button>
            {:else}
              <button class="ghost" onclick={() => game.act({ type: 'bid', player: av.active, company: c.sym, price: c.minBid })}>
                Bid {CURRENCY}{c.minBid}
              </button>
            {/if}
            <span class="maxhint">your max {CURRENCY}{maxBidFor(game.state, av.active, c.sym)}</span>
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <button class="pass" onclick={() => game.act({ type: 'pass', player: av.active })}>
    Pass{av.auctioning ? ` on ${av.auctioning}` : ''}
  </button>
</div>

<style>
  .players {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 0.6rem;
    margin-bottom: 1rem;
  }
  .pcard {
    border: 1px solid var(--line);
    border-top: 3px solid var(--p);
    border-radius: 10px;
    padding: 0.6rem 0.7rem;
    background: var(--bg-soft);
    opacity: 0.8;
  }
  .pcard.active {
    opacity: 1;
    box-shadow: 0 0 0 2px var(--p) inset;
  }
  .pname {
    font-weight: 700;
    color: var(--p);
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .turn {
    font-size: 0.65rem;
    color: #0f1419;
    background: var(--p);
    border-radius: 999px;
    padding: 0.05rem 0.4rem;
  }
  .pmoney {
    margin: 0.3rem 0;
  }
  .avail {
    font-size: 1.3rem;
    font-weight: 800;
  }
  .pmoney .sub {
    font-size: 0.7rem;
    color: var(--muted);
    margin-left: 0.3rem;
  }
  .prow {
    display: flex;
    justify-content: space-between;
    font-size: 0.78rem;
    color: var(--muted);
  }
  .prow.locked span:last-child {
    color: #e6b34a;
  }
  .companies {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 0.7rem;
  }
  .company {
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg-soft);
    padding: 0.8rem 0.9rem;
  }
  .company.focus {
    border-color: var(--rail-deep);
    box-shadow: 0 0 0 1px var(--rail-deep);
  }
  .chead {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.4rem;
  }
  .sym {
    font-weight: 800;
    color: var(--rail);
  }
  .cn {
    font-weight: 600;
    font-size: 0.9rem;
  }
  .tag {
    margin-left: auto;
    font-size: 0.66rem;
    border-radius: 999px;
    padding: 0.1rem 0.45rem;
    font-weight: 700;
  }
  .tag.buy {
    background: var(--accent);
    color: #06231f;
  }
  .tag.auc {
    background: #e0655c;
    color: #2a0c0a;
  }
  .cstats {
    display: flex;
    gap: 1rem;
    font-size: 0.82rem;
    color: var(--muted);
    margin-bottom: 0.4rem;
  }
  .cstats strong {
    color: var(--ink);
  }
  .cstats s {
    opacity: 0.6;
  }
  .cdesc {
    margin: 0 0 0.5rem;
    font-size: 0.78rem;
    color: var(--muted);
    line-height: 1.4;
  }
  .bids {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
    margin-bottom: 0.55rem;
  }
  .blabel {
    font-size: 0.68rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .bid {
    font-size: 0.76rem;
    font-weight: 700;
    color: var(--p);
    border: 1px solid var(--p);
    border-radius: 999px;
    padding: 0.05rem 0.45rem;
  }
  .cact {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .cact button {
    padding: 0.4rem 0.8rem;
    border-radius: 8px;
    border: 1px solid var(--rail-deep);
    background: var(--rail);
    color: #1b1b1b;
    font: 700 0.82rem ui-sans-serif, sans-serif;
    cursor: pointer;
  }
  .cact button.ghost {
    background: transparent;
    color: var(--ink);
    border-color: var(--line);
  }
  .maxhint {
    font-size: 0.72rem;
    color: var(--muted);
  }
  .pass {
    margin-top: 1rem;
    padding: 0.5rem 1.1rem;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--muted);
    font: 600 0.85rem ui-sans-serif, sans-serif;
    cursor: pointer;
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
