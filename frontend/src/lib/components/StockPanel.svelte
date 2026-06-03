<script lang="ts">
  import { game } from '$lib/game/sandbox.svelte';
  import {
    stockLegalActions,
    rolaStockLegalActions,
    playerValue,
    playerLiquidity,
    exchangeOptions,
    currencyFor,
    configFor
  } from '$lib/engine';
  import { COMPANIES, PAR_PRICES } from '$lib/data/g1889';
  import type { CorporationState, PlayerState } from '$lib/engine';
  import CompanyLogo from './CompanyLogo.svelte';
  import MinorMatrix from './MinorMatrix.svelte';
  import PrivateChip from './PrivateChip.svelte';
  import MoneyValue from './MoneyValue.svelte';

  const CURRENCY = $derived(currencyFor(game.title));
  const isRola = $derived(game.title === 'rola');
  const market = $derived(configFor(game.title).market);
  const SEAT = ['#f5c542', '#3fb6a8', '#e0655c', '#9b8cf0', '#7cc36b', '#e8923a'];
  const seatColor = (id: string) => SEAT[game.state.players.findIndex((p) => p.id === id) % SEAT.length];
  const pname = (id: string) => game.state.players.find((p) => p.id === id)?.name ?? id;

  // Active player + legal actions. RoLA launches a minor by bidding; 1889 pars.
  const me = $derived(game.state.players[game.state.current]?.id ?? '');
  const sl = $derived(isRola ? null : stockLegalActions(game.state));
  const rsl = $derived(isRola ? rolaStockLegalActions(game.state) : null);
  const exchanges = $derived(game.canAct && !isRola ? exchangeOptions(game.state, me) : []);
  const acted = $derived(game.state.stock?.acted ?? false);

  // RoLA minor launching now lives in <MinorMatrix />; this panel handles buy/sell.
  const canBuyIpo = (sym: string) => (isRola ? rsl!.buyIpo : sl!.buyIpo).includes(sym);
  const canBuyPool = (sym: string) => (isRola ? rsl!.buyPool : sl!.buyPool).includes(sym);
  const canSellSym = (sym: string) => (isRola ? rsl!.sell : sl!.sell).includes(sym);
  const canPar = (sym: string) => !isRola && !!sl?.par.includes(sym);

  // Buy a share, then end the turn in one click (the common stock-round move).
  function buyAndDone(corp: string, from: 'ipo' | 'pool') {
    game.act({ type: 'buy', player: me, corp, from });
    if (!game.error) game.act({ type: 'pass', player: me });
  }

  function priceOf(c: CorporationState): number | null {
    if (c.priceRow === null || c.priceCol === null) return null;
    return market[c.priceRow]?.[c.priceCol]?.price ?? null;
  }
  function held(p: PlayerState, sym: string) {
    return p.shares[sym] ?? 0;
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
  const certLimit = $derived(configFor(game.title).certLimit[game.state.players.length] ?? -1);

  const privInfo = (sym: string) => COMPANIES.find((c) => c.sym === sym);
  const privIncome = (p: PlayerState) => p.companies.reduce((n, sym) => n + (privInfo(sym)?.revenue ?? 0), 0);
  const playerName = (id: string) => game.state.players.find((p) => p.id === id)?.name ?? id;
  const playerCash = (id: string) => game.state.players.find((p) => p.id === id)?.cash ?? 0;

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
      <div class="pcard" class:active={p.id === me} style="--p:{SEAT[i % SEAT.length]}">
        <div class="ph">
          <span class="pn">{p.name}{#if game.isBot(p.id)}<span class="bot">BOT</span>{/if}</span>
          {#if game.state.priority === i}<span class="pd">Priority</span>{/if}
        </div>
        <div class="pm">
          <div><span>Cash</span><b><MoneyValue value={p.cash} /></b></div>
          <div><span>Value</span><b>{CURRENCY}{playerValue(game.state, p.id)}</b></div>
          <div><span>Liquidity</span><b>{CURRENCY}{playerLiquidity(game.state, p.id)}</b></div>
          <div><span>Certs</span><b class:over={certLimit >= 0 && certs(p) > certLimit}>{certs(p)}/{certLimit < 0 ? '∞' : certLimit}</b></div>
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
    {#if game.canAct}
      <span class="turnnote myturn" style="--p:{seatColor(me)}">Your turn, {playerName(me)}</span>
      <button class="pass" class:done={acted} onclick={() => game.act({ type: 'pass', player: me })}>
        {acted ? 'Done' : 'Pass'}
      </button>
    {:else}
      <span class="turnnote">{playerName(me)} is {game.isBot(me) ? 'thinking' : 'acting'}…</span>
    {/if}
  </div>

  {#if exchanges.length}
    <div class="exchanges">
      {#each exchanges as ex (ex.company)}
        <button onclick={() => game.act({ type: 'exchange', player: me, company: ex.company })}>
          Exchange {ex.company} for a 10% share of {ex.corp}
        </button>
      {/each}
    </div>
  {/if}

  <!-- RoLA: the staggered minor matrix (launch the bottom of each column) -->
  {#if isRola}<MinorMatrix />{/if}

  <!-- corporation cards (RoLA: only companies already in play; unlaunched minors
       live in the matrix above) -->
  <div class="corps">
    {#each isRola ? game.state.corporations.filter((c) => c.parPrice !== null) : game.state.corporations as c (c.sym)}
      <div class="corp" style="--c:{c.color}">
        <div class="chead" style="background:{c.color}">
          <CompanyLogo sym={c.sym} color="#fff" size={20} />
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

          {#if game.canAct && canPar(c.sym)}
            <div class="parrow">
              <span class="parlabel">Par at</span>
              {#each PAR_PRICES as price (price)}
                <button
                  class="parbtn"
                  disabled={playerCash(me) < 2 * price}
                  onclick={() => game.act({ type: 'par', player: me, corp: c.sym, price })}
                >
                  {CURRENCY}{price}
                </button>
              {/each}
            </div>
          {/if}

          {#if game.canAct}
          <div class="cact">
            {#if canBuyIpo(c.sym)}
              <button onclick={() => game.act({ type: 'buy', player: me, corp: c.sym, from: 'ipo' })}>Buy IPO {CURRENCY}{c.parPrice}</button>
              <button class="combo" onclick={() => buyAndDone(c.sym, 'ipo')}>Buy &amp; done</button>
            {/if}
            {#if canBuyPool(c.sym)}
              <button class="ghost" onclick={() => game.act({ type: 'buy', player: me, corp: c.sym, from: 'pool' })}>Buy pool {CURRENCY}{priceOf(c)}</button>
              <button class="combo" onclick={() => buyAndDone(c.sym, 'pool')}>Buy &amp; done</button>
            {/if}
            {#if canSellSym(c.sym)}
              <button class="ghost" onclick={() => game.act({ type: 'sell', player: me, corp: c.sym, count: 1 })}>Sell</button>
            {/if}
          </div>
          {/if}
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
  .exchanges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: 0.9rem;
  }
  .exchanges button {
    padding: 0.35rem 0.7rem;
    border-radius: 8px;
    border: 1px solid var(--rail-deep);
    background: var(--rail);
    color: #1b1b1b;
    font: 700 0.78rem ui-sans-serif, sans-serif;
    cursor: pointer;
  }
  .turnnote {
    font-size: 0.85rem;
    color: var(--muted);
  }
  .turnnote.myturn {
    color: var(--p);
    font-weight: 700;
    border: 1px solid var(--p);
    border-radius: 999px;
    padding: 0.15rem 0.7rem;
  }
  .parrow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
    margin-bottom: 0.45rem;
  }
  .parlabel {
    font-size: 0.72rem;
    color: var(--muted);
    margin-right: 0.1rem;
  }
  .parbtn {
    padding: 0.25rem 0.5rem;
    border-radius: 6px;
    border: 1px solid var(--rail-deep);
    background: var(--rail);
    color: #1b1b1b;
    font: 700 0.74rem ui-sans-serif, sans-serif;
    cursor: pointer;
  }
  .parbtn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .combo:disabled {
    opacity: 0.4;
    cursor: not-allowed;
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
  .cact button.combo {
    background: var(--rail-deep);
    color: #fff;
    border-color: var(--rail-deep);
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
  .pass.done {
    background: var(--rail);
    border-color: var(--rail-deep);
    color: #1b1b1b;
    font-weight: 700;
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
