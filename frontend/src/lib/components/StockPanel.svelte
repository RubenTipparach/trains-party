<script lang="ts">
  import { game } from '$lib/game/sandbox.svelte';
  import { stockLegalActions } from '$lib/engine';
  import { COMPANIES, MARKET, PAR_PRICES, CERT_LIMIT, CURRENCY } from '$lib/data/g1889';
  import type { CorporationState, PlayerState } from '$lib/engine';
  import PrivateChip from './PrivateChip.svelte';

  const SEAT = ['#f5c542', '#3fb6a8', '#e0655c', '#9b8cf0', '#7cc36b', '#e8923a'];
  const seatColor = (id: string) => SEAT[game.state.players.findIndex((p) => p.id === id) % SEAT.length];
  const pname = (id: string) => game.state.players.find((p) => p.id === id)?.name ?? id;

  const sl = $derived(stockLegalActions(game.state));
  let parPrice = $state(100);

  function priceOf(c: CorporationState): number | null {
    if (c.priceRow === null || c.priceCol === null) return null;
    return MARKET[c.priceRow][c.priceCol].price;
  }
  function held(p: PlayerState, sym: string) {
    return p.shares[sym] ?? 0;
  }
  function privateValue(p: PlayerState) {
    return p.companies.reduce((n, sym) => n + (COMPANIES.find((c) => c.sym === sym)?.value ?? 0), 0);
  }
  function shareValue(p: PlayerState) {
    return game.state.corporations.reduce((n, c) => {
      const price = priceOf(c);
      return price === null ? n : n + (held(p, c.sym) / 10) * price;
    }, 0);
  }
  function sellableValue(p: PlayerState) {
    return game.state.corporations.reduce((n, c) => {
      const price = priceOf(c);
      if (price === null) return n;
      const pres = c.president === p.id;
      const sellablePct = Math.max(0, held(p, c.sym) - (pres ? 20 : 0));
      const poolRoom = Math.max(0, 50 - c.poolShares);
      const pct = Math.min(sellablePct, poolRoom);
      return n + (pct / 10) * price;
    }, 0);
  }
  function certs(p: PlayerState) {
    let n = p.companies.length; // privates are certificates too
    for (const c of game.state.corporations) {
      const pct = held(p, c.sym);
      if (pct <= 0) continue;
      const pres = c.president === p.id;
      n += (pct - (pres ? 20 : 0)) / 10 + (pres ? 1 : 0);
    }
    return n;
  }
  function totalShares(p: PlayerState) {
    return game.state.corporations.reduce((n, c) => n + held(p, c.sym) / 10, 0);
  }
  const certLimit = $derived(CERT_LIMIT[game.state.players.length]);

  const privInfo = (sym: string) => COMPANIES.find((c) => c.sym === sym);
  const privIncome = (p: PlayerState) => p.companies.reduce((n, sym) => n + (privInfo(sym)?.revenue ?? 0), 0);

  // shareholder rows for a corporation card
  function holders(c: CorporationState) {
    return game.state.players
      .filter((p) => held(p, c.sym) > 0)
      .map((p) => ({ id: p.id, name: p.name, pct: held(p, c.sym), pres: c.president === p.id }))
      .sort((a, b) => b.pct - a.pct);
  }
</script>

<div class="stock">
  <!-- player summary cards -->
  <div class="players">
    {#each game.state.players as p, i (p.id)}
      <div class="pcard" class:active={p.id === sl.player} style="--p:{SEAT[i % SEAT.length]}">
        <div class="ph">
          <span class="pn">{p.name}{#if game.isBot(p.id)}<span class="bot">BOT</span>{/if}</span>
          {#if game.state.priority === i}<span class="pd">Priority</span>{/if}
        </div>
        <div class="pm">
          <div><span>Cash</span><b>{CURRENCY}{p.cash}</b></div>
          <div><span>Value</span><b>{CURRENCY}{Math.round(p.cash + shareValue(p) + privateValue(p))}</b></div>
          <div><span>Liquidity</span><b>{CURRENCY}{Math.round(p.cash + sellableValue(p))}</b></div>
          <div><span>Certs</span><b class:over={certs(p) > certLimit}>{certs(p)}/{certLimit}</b></div>
          <div><span>Shares</span><b>{totalShares(p)}</b></div>
          {#if p.companies.length}<div><span>Pvt income</span><b>{CURRENCY}{privIncome(p)}/OR</b></div>{/if}
        </div>
        <div class="holdings">
          {#each game.state.corporations.filter((c) => held(p, c.sym) > 0) as c (c.sym)}
            <span class="hchip" style="--c:{c.color}">
              <i></i>{c.sym} {held(p, c.sym)}%{#if c.president === p.id}<sup>P</sup>{/if}
            </span>
          {/each}
        </div>
        {#if p.companies.length}
          <div class="privs">
            {#each p.companies as sym (sym)}<PrivateChip {sym} />{/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>

  {#if game.error}<p class="err">{game.error}</p>{/if}

  <div class="paronce">
    <label>Par price
      <select bind:value={parPrice}>{#each PAR_PRICES as p}<option value={p}>{CURRENCY}{p}</option>{/each}</select>
    </label>
    <button class="pass" onclick={() => game.act({ type: 'pass', player: sl.player })}>Pass</button>
  </div>

  <!-- corporation cards -->
  <div class="corps">
    {#each game.state.corporations as c (c.sym)}
      <div class="corp" style="--c:{c.color}">
        <div class="chead" style="background:{c.color}">
          <span class="csym">{c.sym}</span>
          <span class="cname">{c.name}</span>
        </div>
        <div class="cbody">
          <div class="crow">
            <span>{c.floated ? 'Floated' : c.parPrice ? 'Started' : 'Unstarted'}</span>
            <span>{priceOf(c) !== null ? `${CURRENCY}${priceOf(c)}` : '-'}{#if c.parPrice} · par {CURRENCY}{c.parPrice}{/if}</span>
          </div>
          <table class="sh">
            <tbody>
              <tr><td>IPO</td><td>{c.ipoShares}%</td><td></td></tr>
              <tr><td>Pool</td><td>{c.poolShares}%</td><td></td></tr>
              {#each holders(c) as h (h.id)}
                <tr>
                  <td><span class="dot" style="background:{seatColor(h.id)}"></span>{h.name}</td>
                  <td>{h.pct}%</td>
                  <td>{#if h.pres}<span class="pres">pres</span>{/if}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          {#if c.floated}<div class="treasury">Treasury {CURRENCY}{c.cash}</div>{/if}

          <div class="cact">
            {#if sl.par.includes(c.sym)}
              <button onclick={() => game.act({ type: 'par', player: sl.player, corp: c.sym, price: parPrice })}>Par {CURRENCY}{parPrice}</button>
            {/if}
            {#if sl.buyIpo.includes(c.sym)}
              <button onclick={() => game.act({ type: 'buy', player: sl.player, corp: c.sym, from: 'ipo' })}>Buy IPO {CURRENCY}{c.parPrice}</button>
            {/if}
            {#if sl.buyPool.includes(c.sym)}
              <button class="ghost" onclick={() => game.act({ type: 'buy', player: sl.player, corp: c.sym, from: 'pool' })}>Buy pool {CURRENCY}{priceOf(c)}</button>
            {/if}
            {#if sl.sell.includes(c.sym)}
              <button class="ghost" onclick={() => game.act({ type: 'sell', player: sl.player, corp: c.sym, count: 1 })}>Sell</button>
            {/if}
          </div>
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .players {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 0.6rem;
    margin-bottom: 1rem;
  }
  .pcard {
    border: 1px solid var(--line);
    border-top: 3px solid var(--p);
    border-radius: 10px;
    padding: 0.55rem 0.7rem;
    background: var(--bg-soft);
    opacity: 0.85;
  }
  .pcard.active {
    opacity: 1;
    box-shadow: 0 0 0 2px var(--p) inset;
  }
  .ph {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.3rem;
  }
  .pn {
    font-weight: 700;
    color: var(--p);
  }
  .bot {
    font-size: 0.58rem;
    color: var(--muted);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0 0.3rem;
    margin-left: 0.3rem;
  }
  .pd {
    font-size: 0.62rem;
    color: #f0a;
    color: var(--rail);
    border: 1px solid var(--rail-deep);
    border-radius: 999px;
    padding: 0.02rem 0.35rem;
  }
  .pm {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.05rem 0.6rem;
    font-size: 0.76rem;
    margin-bottom: 0.4rem;
  }
  .pm div {
    display: flex;
    justify-content: space-between;
  }
  .pm span {
    color: var(--muted);
  }
  .pm b.over {
    color: #ff8a7e;
  }
  .holdings {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .hchip {
    font-size: 0.68rem;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0.02rem 0.4rem;
  }
  .hchip i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--c);
    display: inline-block;
  }
  .hchip sup {
    color: var(--rail);
  }
  .privs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-top: 0.4rem;
  }
  .paronce {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    margin-bottom: 0.9rem;
  }
  .paronce label {
    font-size: 0.85rem;
    color: var(--muted);
  }
  .paronce select {
    background: var(--bg-soft);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0.3rem;
  }
  .corps {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.7rem;
  }
  .corp {
    border: 1px solid var(--line);
    border-radius: 10px;
    overflow: hidden;
    background: var(--bg-soft);
  }
  .chead {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.6rem;
    color: #fff;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  }
  .csym {
    font-weight: 800;
    font-size: 1rem;
  }
  .cname {
    font-size: 0.78rem;
    font-weight: 600;
  }
  .cbody {
    padding: 0.5rem 0.6rem 0.6rem;
  }
  .crow {
    display: flex;
    justify-content: space-between;
    font-size: 0.76rem;
    color: var(--muted);
    margin-bottom: 0.3rem;
  }
  .sh {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.76rem;
    margin-bottom: 0.4rem;
  }
  .sh td {
    padding: 0.12rem 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }
  .sh td:nth-child(2) {
    text-align: right;
    font-weight: 600;
  }
  .sh td:nth-child(3) {
    text-align: right;
    width: 2.4rem;
  }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 0.3rem;
  }
  .pres {
    font-size: 0.62rem;
    color: var(--rail);
  }
  .treasury {
    font-size: 0.74rem;
    color: var(--muted);
    margin-bottom: 0.4rem;
  }
  .cact {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .cact button {
    padding: 0.3rem 0.6rem;
    border-radius: 7px;
    border: 1px solid var(--rail-deep);
    background: var(--rail);
    color: #1b1b1b;
    font: 700 0.76rem ui-sans-serif, sans-serif;
    cursor: pointer;
  }
  .cact button.ghost {
    background: transparent;
    color: var(--ink);
    border-color: var(--line);
  }
  .pass {
    padding: 0.45rem 1.1rem;
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
    margin-bottom: 0.6rem;
  }
</style>
