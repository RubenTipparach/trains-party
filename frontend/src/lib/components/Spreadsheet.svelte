<script lang="ts">
  import { game } from '$lib/game/sandbox.svelte';
  import { CURRENCY, MARKET } from '$lib/data/g1889';

  const SEAT = ['#f5c542', '#3fb6a8', '#e0655c', '#9b8cf0', '#7cc36b', '#e8923a'];

  function held(playerId: string, sym: string): number {
    return game.state.players.find((p) => p.id === playerId)?.shares[sym] ?? 0;
  }
  function certs(playerId: string): number {
    const p = game.state.players.find((x) => x.id === playerId)!;
    let n = p.companies.length; // each private is one certificate
    for (const c of game.state.corporations) {
      const pct = p.shares[c.sym] ?? 0;
      if (pct <= 0) continue;
      const pres = c.president === playerId;
      n += (pct - (pres ? 20 : 0)) / 10 + (pres ? 1 : 0);
    }
    return n;
  }
  function price(sym: string): number | null {
    const c = game.state.corporations.find((x) => x.sym === sym)!;
    if (c.priceRow === null || c.priceCol === null) return null;
    return MARKET[c.priceRow][c.priceCol].price;
  }
</script>

<div class="scroll">
  <table class="players">
    <thead>
      <tr>
        <th>Player</th>
        <th>Cash</th>
        <th>Certs</th>
        {#each game.state.corporations as c}<th style="color:{c.color}">{c.sym}</th>{/each}
        <th>Privates</th>
      </tr>
    </thead>
    <tbody>
      {#each game.state.players as p, i}
        <tr>
          <td><span class="seat" style="--p:{SEAT[i % SEAT.length]}">{p.name}</span></td>
          <td>{CURRENCY}{p.cash}</td>
          <td>{certs(p.id)}</td>
          {#each game.state.corporations as c}
            <td class:zero={held(p.id, c.sym) === 0}>
              {held(p.id, c.sym) || '-'}{#if c.president === p.id}<sup class="pres">P</sup>{/if}
            </td>
          {/each}
          <td>{p.companies.join(', ') || '-'}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<h3>Corporations</h3>
<div class="scroll">
  <table>
    <thead>
      <tr><th>Corp</th><th>President</th><th>Par</th><th>Price</th><th>Cash</th><th>Trains</th><th>Privates</th><th>IPO</th><th>Pool</th><th>Floated</th></tr>
    </thead>
    <tbody>
      {#each game.state.corporations as c}
        {@const privs = game.state.companies.filter((x) => x.owner === c.sym && !x.closed)}
        <tr>
          <td><span class="dot" style="background:{c.color}"></span>{c.sym}</td>
          <td>{c.president ? (game.state.players.find((p) => p.id === c.president)?.name ?? c.president) : '-'}</td>
          <td>{c.parPrice ? `${CURRENCY}${c.parPrice}` : '-'}</td>
          <td>{price(c.sym) !== null ? `${CURRENCY}${price(c.sym)}` : '-'}</td>
          <td>{CURRENCY}{c.cash}</td>
          <td>{c.trains.join(', ') || '-'}</td>
          <td>{privs.map((x) => x.sym).join(', ') || '-'}</td>
          <td>{c.ipoShares}%</td>
          <td>{c.poolShares}%</td>
          <td>{c.floated ? 'yes' : '-'}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .scroll {
    overflow-x: auto;
    margin-bottom: 1.2rem;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }
  th,
  td {
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid var(--line);
    text-align: center;
    white-space: nowrap;
  }
  th:first-child,
  td:first-child {
    text-align: left;
  }
  thead th {
    color: var(--muted);
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .seat {
    font-weight: 700;
    color: var(--p);
  }
  td.zero {
    color: #455;
  }
  .pres {
    color: var(--rail);
    font-weight: 700;
  }
  .dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    margin-right: 0.4rem;
    vertical-align: middle;
  }
  h3 {
    font-size: 0.95rem;
    border-bottom: 1px solid var(--line);
    padding-bottom: 0.3rem;
  }
</style>
