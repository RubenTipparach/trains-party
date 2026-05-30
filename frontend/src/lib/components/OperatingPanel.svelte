<script lang="ts">
  import { game } from '$lib/game/sandbox.svelte';
  import { operatingView, trackLays } from '$lib/engine';
  import { TRAINS, MARKET, CURRENCY, COMPANIES } from '$lib/data/g1889';
  import type { CorporationState } from '$lib/engine';
  import HexMap from './HexMap.svelte';
  import PrivateChip from './PrivateChip.svelte';

  const v = $derived(operatingView(game.state));
  const lays = $derived(trackLays(game.state));
  let revenue = $state(0);

  const SEAT = ['#f5c542', '#3fb6a8', '#e0655c', '#9b8cf0', '#7cc36b', '#e8923a'];
  const seatColor = (id: string) => SEAT[game.state.players.findIndex((p) => p.id === id) % SEAT.length];

  const corpOf = (sym: string) => game.state.corporations.find((c) => c.sym === sym)!;
  function priceOf(c: CorporationState): number | null {
    if (c.priceRow === null || c.priceCol === null) return null;
    return MARKET[c.priceRow][c.priceCol].price;
  }
  const trainCost = (name: string) => TRAINS.find((t) => t.name === name)?.price ?? 0;
  const pname = (id: string | null) => (id ? game.state.players.find((p) => p.id === id)?.name ?? id : '-');

  // Shareholders of a corporation (president first), for the OR card table.
  function holders(c: CorporationState) {
    return game.state.players
      .filter((p) => (p.shares[c.sym] ?? 0) > 0)
      .map((p) => ({ id: p.id, name: p.name, pct: p.shares[c.sym] ?? 0, pres: c.president === p.id }))
      .sort((a, b) => b.pct - a.pct);
  }
  // Private abilities the operating corporation's president may use this turn
  // (privates with a special ability still owned by that player).
  function corpAbilities(c: CorporationState) {
    if (!c.president) return [];
    const owner = game.state.players.find((p) => p.id === c.president);
    if (!owner) return [];
    return owner.companies.filter((sym) => {
      const def = COMPANIES.find((x) => x.sym === sym);
      return def && def.desc !== 'No special abilities.';
    });
  }
</script>

{#if v}
  {@const c = corpOf(v.corp)}
  <div class="op">
    <!-- operating order -->
    <div class="order">
      <span class="olabel">OR {v.orNumber}/{v.orsThisSet} · {v.step === 'track' ? 'Lay track' : v.step === 'run' ? 'Run trains' : 'Buy trains'}</span>
      {#each v.order as sym, i (sym)}
        <span class="opill" class:on={i === v.index} class:done={i < v.index} style="--c:{corpOf(sym).color}">{sym}</span>
      {/each}
    </div>

    {#if game.error}<p class="err">{game.error}</p>{/if}

    <div class="cols">
      <!-- the board, with track laying live on it -->
      <div class="mapwrap">
        <HexMap layMode={v.step === 'track'} />
      </div>

      <!-- the operating corporation + its current action -->
      <aside>
        <div class="cur" style="--c:{c.color}">
          <div class="curhead" style="background:{c.color}">
            <span class="csym">{c.sym}</span>
            <span class="cname">{c.name}</span>
            <span class="order">Order {v.index + 1}/{v.order.length}</span>
          </div>
          <div class="curbody">
            <div class="stat"><span>Treasury</span><b>{CURRENCY}{c.cash}</b></div>
            <div class="stat"><span>Price</span><b>{priceOf(c) !== null ? `${CURRENCY}${priceOf(c)}` : '-'}</b></div>
            <div class="stat"><span>Trains</span><b>{c.trains.join(', ') || 'none'}</b></div>
          </div>

          <table class="sh">
            <tbody>
              <tr><td>President</td><td class="r">{pname(c.president)}</td></tr>
              {#each holders(c) as h (h.id)}
                <tr>
                  <td><span class="dot" style="background:{seatColor(h.id)}"></span>{h.name}</td>
                  <td class="r">{h.pct}%{#if h.pres}<span class="pflag">P</span>{/if}</td>
                </tr>
              {/each}
              {#if c.poolShares > 0}<tr class="muted"><td>Market</td><td class="r">{c.poolShares}%</td></tr>{/if}
              {#if c.ipoShares > 0}<tr class="muted"><td>IPO</td><td class="r">{c.ipoShares}%</td></tr>{/if}
            </tbody>
          </table>

          {#if corpAbilities(c).length}
            <div class="abilities">
              <span class="ablabel">Abilities</span>
              {#each corpAbilities(c) as sym (sym)}<PrivateChip {sym} />{/each}
            </div>
          {/if}

          {#if v.step === 'track'}
            <div class="act track">
              <span class="tlabel">Tap a <em>highlighted</em> hex to lay track ({lays.length} legal)</span>
            </div>
            <div class="act">
              <button class="ghost" onclick={() => game.act({ type: 'pass', player: c.president! })}>Skip track</button>
            </div>
            <p class="hint">{game.isBot(c.president) ? 'Bot is choosing where to build…' : 'Lay one yellow tile connected to your network, or skip.'}</p>
          {:else if v.step === 'run'}
            <div class="act">
              <label>Revenue
                <input type="number" min="0" step="10" bind:value={revenue} />
              </label>
            </div>
            <div class="act">
              <button onclick={() => game.act({ type: 'run', player: c.president!, corp: c.sym, revenue, dividend: 'pay' })}>Pay dividend</button>
              <button class="ghost" onclick={() => game.act({ type: 'run', player: c.president!, corp: c.sym, revenue, dividend: 'withhold' })}>Withhold</button>
            </div>
            <p class="hint">Route revenue is computed in the next stage; enter it manually for now.</p>
          {:else}
            <div class="act">
              {#if v.canBuyTrain && c.cash >= trainCost(v.canBuyTrain)}
                <button onclick={() => game.act({ type: 'buy_train', player: c.president!, corp: c.sym, train: v.canBuyTrain! })}>
                  Buy {v.canBuyTrain}-train ({CURRENCY}{trainCost(v.canBuyTrain)})
                </button>
              {/if}
              <button class="ghost" onclick={() => game.act({ type: 'pass', player: c.president! })}>Finish turn</button>
            </div>
          {/if}
        </div>

        <!-- all floated corporations summary -->
        <div class="grid">
          {#each game.state.corporations.filter((x) => x.floated) as x (x.sym)}
            <div class="mini" class:on={x.sym === v.corp} style="--c:{x.color}">
              <span class="ms"><i></i>{x.sym}</span>
              <span>{priceOf(x) !== null ? `${CURRENCY}${priceOf(x)}` : '-'}</span>
              <span>{CURRENCY}{x.cash}</span>
              <span>{x.trains.join(',') || '-'}</span>
            </div>
          {/each}
        </div>
      </aside>
    </div>
  </div>
{/if}

<style>
  .cols {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
    align-items: start;
  }
  @media (min-width: 880px) {
    .cols {
      grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr);
    }
  }
  .mapwrap {
    min-width: 0;
  }
  aside {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  .mini.on {
    box-shadow: 0 0 0 2px var(--rail) inset;
  }
  .order {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
    margin-bottom: 0.9rem;
  }
  .olabel {
    font-size: 0.78rem;
    color: var(--muted);
    margin-right: 0.3rem;
  }
  .opill {
    font: 700 0.75rem ui-sans-serif, sans-serif;
    color: #fff;
    background: var(--c);
    border-radius: 999px;
    padding: 0.15rem 0.55rem;
    opacity: 0.45;
  }
  .opill.on {
    opacity: 1;
    box-shadow: 0 0 0 2px var(--ink) inset;
  }
  .cur {
    border: 1px solid var(--line);
    border-radius: 12px;
    overflow: hidden;
    background: var(--bg-soft);
    max-width: 460px;
  }
  .curhead {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.7rem;
    color: #fff;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  }
  .csym {
    font-weight: 800;
    font-size: 1.1rem;
  }
  .cname {
    font-weight: 600;
    font-size: 0.85rem;
  }
  .order {
    margin-left: auto;
    font-size: 0.72rem;
    opacity: 0.9;
  }
  .curbody {
    display: flex;
    gap: 1.4rem;
    padding: 0.6rem 0.8rem;
  }
  .sh {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.76rem;
    padding: 0 0.8rem;
  }
  .sh td {
    padding: 0.12rem 0.8rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }
  .sh td.r {
    text-align: right;
    font-weight: 600;
  }
  .sh tr.muted td {
    color: var(--muted);
  }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 0.35rem;
  }
  .pflag {
    color: var(--rail);
    font-size: 0.66rem;
    margin-left: 0.25rem;
  }
  .abilities {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    padding: 0.5rem 0.8rem 0.2rem;
  }
  .ablabel {
    font-size: 0.68rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .stat span {
    display: block;
    font-size: 0.7rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .stat b {
    font-size: 0.95rem;
  }
  .act {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    padding: 0 0.8rem 0.7rem;
  }
  .act label {
    font-size: 0.8rem;
    color: var(--muted);
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .act input {
    width: 90px;
    background: var(--bg);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 7px;
    padding: 0.35rem 0.4rem;
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
  .hint {
    margin: 0 0.8rem 0.7rem;
    font-size: 0.74rem;
    color: var(--muted);
  }
  .track .tlabel {
    font-size: 0.85rem;
    color: var(--ink);
  }
  .track .tlabel em {
    color: var(--muted);
    font-style: normal;
    font-size: 0.75rem;
  }
  .opill.done {
    opacity: 0.7;
    text-decoration: line-through;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 0.4rem;
    margin-top: 1rem;
  }
  .mini {
    display: grid;
    grid-template-columns: auto 1fr 1fr 1fr;
    gap: 0.4rem;
    font-size: 0.76rem;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg-soft);
  }
  .ms {
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .ms i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--c);
    display: inline-block;
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
