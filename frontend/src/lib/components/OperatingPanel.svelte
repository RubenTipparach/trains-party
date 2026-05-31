<script lang="ts">
  import { game } from '$lib/game/sandbox.svelte';
  import { routing } from '$lib/game/routing.svelte';
  import { operatingView, trackLays, tokenPlays, corporationsCanBuyPrivates } from '$lib/engine';
  import { TRAINS, MARKET, CURRENCY, COMPANIES } from '$lib/data/g1889';
  import type { CorporationState } from '$lib/engine';
  import HexMap from './HexMap.svelte';
  import PrivateChip from './PrivateChip.svelte';
  import MoneyValue from './MoneyValue.svelte';
  import Treasury from './Treasury.svelte';

  const v = $derived(operatingView(game.state));
  const lays = $derived(trackLays(game.state));
  // Revenue to run: the player's assigned routes if they've started routing,
  // otherwise the engine's auto-best.
  const runRevenue = $derived(routing.active ? routing.revenue : (v?.revenue ?? 0));

  // Initialise / tear down manual route assignment as the run step comes and goes.
  $effect(() => {
    if (v && v.step === 'run' && v.hasTrains) {
      const c = game.state.corporations.find((x) => x.sym === v.corp);
      if (c && !routing.isForCorp(v.corp)) routing.begin(v.corp, c.trains);
    } else if (routing.trains.length) {
      routing.clear();
    }
  });
  // Ground-truth list of which tile ids the engine actually offers, per hex, so
  // the available options are never ambiguous (independent of the fan rendering).
  const layTileSummary = $derived.by(() => {
    const byHex = new Map<string, Set<string>>();
    for (const l of lays) {
      if (!byHex.has(l.hex)) byHex.set(l.hex, new Set());
      byHex.get(l.hex)!.add(l.tile);
    }
    return [...byHex.entries()]
      .map(([hex, tiles]) => ({ hex, tiles: [...tiles].sort() }))
      .sort((a, b) => a.hex.localeCompare(b.hex));
  });
  const tokens = $derived(tokenPlays(game.state));

  const SEAT = ['#f5c542', '#3fb6a8', '#e0655c', '#9b8cf0', '#7cc36b', '#e8923a'];
  const seatColor = (id: string) => SEAT[game.state.players.findIndex((p) => p.id === id) % SEAT.length];

  const corpOf = (sym: string) => game.state.corporations.find((c) => c.sym === sym)!;
  function priceOf(c: CorporationState): number | null {
    if (c.priceRow === null || c.priceCol === null) return null;
    return MARKET[c.priceRow][c.priceCol].price;
  }
  const trainCost = (name: string) => TRAINS.find((t) => t.name === name)?.price ?? 0;

  // Cross-buy: trains the operating corp may buy from the president's other
  // corporations (one entry per selling corp + train type), with a chosen price.
  let cbPrice = $state<Record<string, number>>({});
  function crossBuyOptions(buyer: CorporationState) {
    const out: { from: string; train: string; color: string }[] = [];
    for (const x of game.state.corporations) {
      if (x.sym === buyer.sym || x.president !== buyer.president || !x.floated) continue;
      for (const t of [...new Set(x.trains)]) out.push({ from: x.sym, train: t, color: x.color });
    }
    return out;
  }
  function crossBuy(buyer: CorporationState, from: string, train: string) {
    const key = `${from}:${train}`;
    const price = Math.max(1, Math.min(buyer.cash, Math.round(cbPrice[key] ?? 1)));
    game.act({ type: 'buy_train', player: buyer.president!, corp: buyer.sym, train, from, price });
    delete cbPrice[key];
  }

  // Buy private companies: any player-owned, unclosed private the operating corp
  // may buy (from phase 3), priced 1 up to twice face value.
  let coPrice = $state<Record<string, number>>({});
  function companyBuyOptions() {
    if (!corporationsCanBuyPrivates(game.state)) return [];
    return game.state.companies
      .filter((co) => !co.closed && co.owner)
      .map((co) => ({
        sym: co.sym,
        name: co.name,
        value: co.value,
        revenue: co.revenue,
        owner: game.state.players.find((p) => p.id === co.owner)?.name ?? co.owner!
      }));
  }
  function buyCompany(buyer: CorporationState, sym: string, value: number) {
    const price = Math.max(1, Math.min(2 * value, buyer.cash, Math.round(coPrice[sym] ?? 1)));
    game.act({ type: 'buy_company', player: buyer.president!, corp: buyer.sym, company: sym, price });
    delete coPrice[sym];
  }
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
      <span class="olabel">OR {v.orNumber}/{v.orsThisSet} · {v.step === 'track' ? 'Lay track' : v.step === 'token' ? 'Place token' : v.step === 'run' ? 'Run trains' : 'Buy trains'}</span>
      {#each v.order as sym, i (sym)}
        <span class="opill" class:on={i === v.index} class:done={i < v.index} style="--c:{corpOf(sym).color}">{sym}</span>
      {/each}
    </div>

    {#if game.error}<p class="err">{game.error}</p>{/if}

    <div class="cols">
      <!-- the board, with track laying live on it (only interactive on your turn) -->
      <div class="mapwrap">
        <HexMap
          layMode={game.canAct && v.step === 'track'}
          tokenMode={game.canAct && v.step === 'token'}
          runMode={game.canAct && v.step === 'run'}
        />
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
            <div class="stat"><span>Price</span><b>{priceOf(c) !== null ? `${CURRENCY}${priceOf(c)}` : '-'}</b></div>
          </div>
          <div class="treasurybox">
            <span class="tboxlabel">Treasury</span>
            <Treasury corp={c} />
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

          {#if !game.canAct}
            <p class="waiting" style="--p:{seatColor(c.president ?? '')}">
              {game.isBot(c.president) ? `${pname(c.president)} (bot) is operating ${c.sym}…` : `Waiting for ${pname(c.president)} to operate ${c.sym}…`}
            </p>
          {:else if v.step === 'track'}
            <div class="act track">
              <span class="tlabel">Tap a <em>highlighted</em> hex to lay track ({lays.length} legal)</span>
            </div>
            {#if layTileSummary.length}
              <div class="laysummary">
                {#each layTileSummary as g (g.hex)}
                  <span class="lsrow"><b>{g.hex}</b>: {g.tiles.join(', ')}</span>
                {/each}
              </div>
            {/if}
            <div class="act">
              <button class="ghost" onclick={() => game.act({ type: 'pass', player: c.president! })}>Skip track</button>
            </div>
            <p class="hint">{game.isBot(c.president) ? 'Bot is choosing where to build…' : 'Lay one yellow tile connected to your network, or skip.'}</p>
          {:else if v.step === 'token'}
            <div class="act track">
              <span class="tlabel">Tap a <em>highlighted</em> city to place a token ({tokens.length} legal)</span>
            </div>
            <div class="act">
              <button class="ghost" onclick={() => game.act({ type: 'pass', player: c.president! })}>Skip token</button>
            </div>
            <p class="hint">{game.isBot(c.president) ? 'Bot is deciding on a token…' : 'Place a station token in a reachable city, or skip.'}</p>
          {:else if v.step === 'run'}
            {#if v.hasTrains}
              <!-- per-train route chips: click to arm, then click stops on the map -->
              <div class="trains">
                {#each routing.trains as t, i (i)}
                  <button
                    class="trainchip"
                    class:armed={routing.armed === i}
                    style="--tc:{t.color}"
                    onclick={() => routing.arm(i)}
                  >
                    <span class="tdot"></span>
                    <b>{t.train}-train</b>
                    <span class="tstops">{t.stops.length} stops</span>
                    <span class="trev">{CURRENCY}{t.revenue}</span>
                  </button>
                {/each}
              </div>
              <div class="runrev">
                Route revenue <b>{CURRENCY}{routing.active ? routing.revenue : v.revenue}</b>
                {#if !routing.active}<span class="autonote"> (auto)</span>{/if}
              </div>
              <div class="act">
                <button class="ghost" onclick={() => routing.auto(game.state, c.sym)}>Auto-calculate</button>
                {#if routing.active}
                  <button class="ghost small" onclick={() => routing.begin(c.sym, c.trains)}>Clear routes</button>
                {/if}
              </div>
              <div class="act">
                <button disabled={runRevenue === 0} onclick={() => { routing.capture(); game.act({ type: 'run', player: c.president!, corp: c.sym, revenue: runRevenue, dividend: 'pay' }); }}>
                  Pay dividend
                </button>
                <button class="ghost" onclick={() => { routing.capture(); game.act({ type: 'run', player: c.president!, corp: c.sym, revenue: runRevenue, dividend: 'withhold' }); }}>
                  {runRevenue > 0 ? 'Withhold' : 'Run (no income)'}
                </button>
              </div>
              <p class="hint">
                Click a train, then click the cities/towns it visits on the map. Or use Auto-calculate for the best routes.
              </p>
            {:else}
              <div class="runrev"><span class="norun">No trains to run</span></div>
              <div class="act">
                <button onclick={() => game.act({ type: 'run', player: c.president!, corp: c.sym, revenue: 0, dividend: 'withhold' })}>
                  Run (no income)
                </button>
              </div>
            {/if}
          {:else}
            <div class="act">
              {#if v.canBuyTrain && c.cash >= trainCost(v.canBuyTrain)}
                <button onclick={() => game.act({ type: 'buy_train', player: c.president!, corp: c.sym, train: v.canBuyTrain! })}>
                  Buy {v.canBuyTrain}-train ({CURRENCY}{trainCost(v.canBuyTrain)})
                </button>
              {/if}
              <button class="ghost" onclick={() => game.act({ type: 'pass', player: c.president! })}>Finish turn</button>
            </div>
            {#if crossBuyOptions(c).length}
              <div class="crossbuy">
                <div class="cbhead">Buy from your other companies (price {CURRENCY}1 to {CURRENCY}{c.cash})</div>
                {#each crossBuyOptions(c) as opt (opt.from + ':' + opt.train)}
                  {@const key = opt.from + ':' + opt.train}
                  <div class="cbrow">
                    <span class="cbtrain" style="--c:{opt.color}"><i></i>{opt.from} · {opt.train}-train</span>
                    <input
                      type="number"
                      min="1"
                      max={c.cash}
                      placeholder="¥"
                      value={cbPrice[key] ?? ''}
                      oninput={(e) => (cbPrice[key] = +(e.currentTarget as HTMLInputElement).value)}
                    />
                    <button class="small" disabled={c.cash < 1} onclick={() => crossBuy(c, opt.from, opt.train)}>Buy</button>
                  </div>
                {/each}
              </div>
            {/if}
            {#if companyBuyOptions().length}
              <div class="crossbuy">
                <div class="cbhead">Buy a private company (price {CURRENCY}1 up to 2x face value)</div>
                {#each companyBuyOptions() as opt (opt.sym)}
                  <div class="cbrow">
                    <span class="cbtrain"><b>{opt.sym}</b> · {opt.name} ({CURRENCY}{opt.value}, +{CURRENCY}{opt.revenue}/OR) · {opt.owner}</span>
                    <input
                      type="number"
                      min="1"
                      max={Math.min(2 * opt.value, c.cash)}
                      placeholder="¥"
                      value={coPrice[opt.sym] ?? ''}
                      oninput={(e) => (coPrice[opt.sym] = +(e.currentTarget as HTMLInputElement).value)}
                    />
                    <button class="small" disabled={c.cash < 1} onclick={() => buyCompany(c, opt.sym, opt.value)}>Buy</button>
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
        </div>

        <!-- all floated corporations summary -->
        <div class="grid">
          {#each game.state.corporations.filter((x) => x.floated) as x (x.sym)}
            <div class="mini" class:on={x.sym === v.corp} style="--c:{x.color}">
              <span class="ms"><i></i>{x.sym}</span>
              <span>{priceOf(x) !== null ? `${CURRENCY}${priceOf(x)}` : '-'}</span>
              <span>{CURRENCY}{x.cash}</span>
              <span>{x.trains.join(',') || '-'}{x.companies.length ? ` +${x.companies.join(',')}` : ''}</span>
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
    padding: 0.6rem 0.8rem 0.3rem;
  }
  .treasurybox {
    padding: 0.2rem 0.8rem 0.6rem;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }
  .tboxlabel {
    display: block;
    font-size: 0.66rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0.3rem 0;
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
  .waiting {
    margin: 0.4rem 0.8rem 0.8rem;
    padding: 0.4rem 0.7rem;
    font-size: 0.82rem;
    color: var(--p);
    border: 1px solid var(--p);
    border-radius: 8px;
    opacity: 0.85;
  }
  .runrev {
    padding: 0.2rem 0.8rem 0;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .runrev b {
    color: var(--accent);
    font-size: 1.05rem;
  }
  .autonote {
    font-size: 0.72rem;
    color: var(--muted);
  }
  .norun {
    color: #ff8a7e;
  }
  .trains {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    padding: 0.2rem 0.8rem 0.4rem;
  }
  .trainchip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.28rem 0.55rem;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--ink);
    font: 600 0.76rem ui-sans-serif, sans-serif;
    cursor: pointer;
  }
  .trainchip.armed {
    border-color: var(--tc);
    box-shadow: 0 0 0 2px var(--tc) inset;
  }
  .trainchip .tdot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--tc);
  }
  .trainchip .tstops {
    color: var(--muted);
    font-weight: 500;
  }
  .trainchip .trev {
    color: var(--accent);
    font-weight: 700;
  }
  .small {
    font-size: 0.72rem;
    padding: 0.2rem 0.5rem;
  }
  .act button:disabled,
  .cbrow button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .crossbuy {
    padding: 0.3rem 0.8rem 0.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .cbhead {
    font-size: 0.74rem;
    color: var(--muted);
  }
  .cbrow {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .cbtrain {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.78rem;
    flex: 1;
  }
  .cbtrain i {
    width: 9px;
    height: 9px;
    border-radius: 2px;
    background: var(--c);
  }
  .cbrow input {
    width: 68px;
    padding: 0.2rem 0.35rem;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--ink);
    font-size: 0.78rem;
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
  .laysummary {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 0.8rem;
    margin: 0 0.8rem 0.6rem;
    font-size: 0.74rem;
    color: var(--muted);
  }
  .laysummary b {
    color: var(--ink);
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
