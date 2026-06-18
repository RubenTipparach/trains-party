<script lang="ts">
  import { game } from '$lib/game/sandbox.svelte';
  import { CURRENCY, MARKET } from '$lib/data/g1889';
  import {
    initialState,
    apply,
    playerValue,
    playerLiquidity,
    RULES_VERSION,
    type GameState
  } from '$lib/engine';

  const SEAT = ['#f5c542', '#3fb6a8', '#e0655c', '#9b8cf0', '#7cc36b', '#e8923a'];
  const isRola = $derived(game.title === 'rola');
  const seatColor = (i: number) => SEAT[i % SEAT.length];

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

  // --- value / income history -------------------------------------------------
  // Replay the action log once and snapshot every player's value and each
  // corporation's last-run revenue at each round boundary, so the standings table
  // and the charts can show how fast someone is pulling ahead.
  function roundLabel(s: GameState): string {
    if (s.round === 'auction') return 'ISR';
    if (s.round === 'mapbuild') return 'MAP';
    if (s.round === 'stock') return `SR${s.srCount}`;
    if (s.round === 'merger') return `MR${s.orSet}`;
    if (s.round === 'operating') return s.or ? `OR${s.orSet}.${s.or.orNumber}` : 'OR';
    return s.round;
  }

  type Point = { label: string; values: number[]; rev: Record<string, number> };
  const snap = (s: GameState): Point => ({
    label: roundLabel(s),
    values: s.players.map((p) => playerValue(s, p.id)),
    rev: Object.fromEntries(s.corporations.map((c) => [c.sym, c.lastRun?.revenue ?? 0]))
  });

  // Replaying the log recomputes route revenue per run, which is costly on a diesel
  // network, so memoize: keep the last replayed state + points and, when the log has
  // only grown (the usual case in play), resume from there instead of from scratch.
  let memo = { key: '', len: 0, state: null as GameState | null, points: [] as Point[], label: '' };
  const history = $derived.by<Point[]>(() => {
    const seats = game.seats.map((s) => ({ id: s.id, name: s.name }));
    const key = `${game.code}|${game.title}|${game.seed}|${seats.length}`;
    const actions = game.actions;
    let s = memo.state;
    let pts = memo.points;
    let last = memo.label;
    let start = memo.len;
    if (memo.key !== key || !s || memo.len > actions.length) {
      try {
        s = initialState(seats, game.title, RULES_VERSION, {
          seed: game.seed,
          mapMode: game.mapMode,
          hostileMergers: game.hostileMergers,
          localRoutes: game.localRoutes
        });
      } catch {
        return [];
      }
      pts = [snap(s)];
      last = pts[0].label;
      start = 0;
    }
    for (let i = start; i < actions.length; i++) {
      try {
        s = apply(s, actions[i]);
      } catch {
        break;
      }
      const lbl = roundLabel(s);
      if (lbl !== last) {
        pts = [...pts, snap(s)];
        last = lbl;
      }
    }
    memo = { key, len: actions.length, state: s, points: pts, label: last };
    return pts;
  });

  // Current standings (from the live state), sorted by value, with the change since
  // the previous round checkpoint.
  const standings = $derived.by(() => {
    const prev = history.length >= 2 ? history[history.length - 2].values : null;
    return game.state.players
      .map((p, i) => ({
        id: p.id,
        name: p.name,
        seat: seatColor(i),
        idx: i,
        value: playerValue(game.state, p.id),
        liquidity: playerLiquidity(game.state, p.id),
        delta: prev ? playerValue(game.state, p.id) - prev[i] : 0
      }))
      .sort((a, b) => b.value - a.value);
  });

  // --- mini line charts --------------------------------------------------------
  const CW = 320;
  const CH = 120;
  const PAD = 4;
  function path(vals: number[], max: number): string {
    const n = vals.length;
    if (!n || max <= 0) return '';
    return vals
      .map((v, i) => {
        const x = n === 1 ? CW / 2 : PAD + (i / (n - 1)) * (CW - 2 * PAD);
        const y = CH - PAD - (v / max) * (CH - 2 * PAD);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }
  const valueLines = $derived.by(() => {
    const max = Math.max(1, ...history.flatMap((p) => p.values));
    return game.state.players.map((p, i) => ({
      name: p.name,
      seat: seatColor(i),
      d: path(history.map((pt) => pt.values[i] ?? 0), max),
      max
    }));
  });
  // Corporation revenue over time: only corps that have ever run (a positive rev).
  const revLines = $derived.by(() => {
    const syms = game.state.corporations
      .filter((c) => history.some((pt) => (pt.rev[c.sym] ?? 0) > 0))
      .map((c) => c.sym);
    const max = Math.max(1, ...history.flatMap((p) => Object.values(p.rev)));
    return {
      max,
      lines: syms.map((sym) => ({
        sym,
        color: game.state.corporations.find((c) => c.sym === sym)?.color ?? '#888',
        d: path(history.map((pt) => pt.rev[sym] ?? 0), max)
      }))
    };
  });
  const fmtDelta = (n: number) => (n > 0 ? `+${CURRENCY}${n}` : n < 0 ? `-${CURRENCY}${-n}` : '0');
</script>

<!-- Standings: who is winning and how fast (value, liquidity, change this round) -->
<h3>Standings <span class="sub">value · liquidity · Δ since last round</span></h3>
<div class="standings">
  {#each standings as p, rank (p.id)}
    <div class="srow" style="--p:{p.seat}">
      <span class="rank">{rank + 1}</span>
      <span class="sname">{p.name}{#if game.isBot(p.id)}<span class="sbot">BOT</span>{/if}</span>
      <span class="sval">{CURRENCY}{p.value.toLocaleString()}</span>
      <span class="sliq">{CURRENCY}{p.liquidity.toLocaleString()}</span>
      <span class="sdelta" class:up={p.delta > 0} class:down={p.delta < 0}>{fmtDelta(p.delta)}</span>
    </div>
  {/each}
</div>

<!-- Charts: the value race + company incomes over time -->
<div class="charts">
  <div class="chart">
    <div class="ctitle">Player value over time</div>
    <svg viewBox="0 0 {CW} {CH}" preserveAspectRatio="none" role="img" aria-label="Player value over time">
      <line class="axis" x1={PAD} y1={CH - PAD} x2={CW - PAD} y2={CH - PAD} />
      {#each valueLines as l}<path class="line" d={l.d} style="stroke:{l.seat}" />{/each}
    </svg>
    <div class="legend">
      {#each valueLines as l}<span class="lg" style="--c:{l.seat}"><i></i>{l.name}</span>{/each}
    </div>
  </div>

  {#if revLines.lines.length}
    <div class="chart">
      <div class="ctitle">Company revenue (per run) over time</div>
      <svg viewBox="0 0 {CW} {CH}" preserveAspectRatio="none" role="img" aria-label="Company revenue over time">
        <line class="axis" x1={PAD} y1={CH - PAD} x2={CW - PAD} y2={CH - PAD} />
        {#each revLines.lines as l}<path class="line" d={l.d} style="stroke:{l.color}" />{/each}
      </svg>
      <div class="legend">
        {#each revLines.lines as l}<span class="lg" style="--c:{l.color}"><i></i>{l.sym}</span>{/each}
      </div>
    </div>
  {/if}
</div>

<div class="scroll">
  <table class="players">
    <thead>
      <tr>
        <th>Player</th>
        <th>Cash</th>
        <th>Value</th>
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
          <td><b>{CURRENCY}{playerValue(game.state, p.id).toLocaleString()}</b></td>
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
      <tr><th>Corp</th><th>President</th><th>Par</th><th>Price</th><th>Cash</th><th>Trains</th><th>Privates</th><th>{isRola ? 'Treasury' : 'IPO'}</th><th>Pool</th><th>Floated</th></tr>
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
  td b {
    color: var(--ink);
    font-weight: 800;
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
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }
  h3 .sub {
    font-size: 0.66rem;
    font-weight: 400;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }

  /* standings: the winning race, big and bold */
  .standings {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    margin: 0.7rem 0 1.3rem;
  }
  .srow {
    display: grid;
    grid-template-columns: 1.4rem 1fr auto auto auto;
    align-items: baseline;
    gap: 0.6rem;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--line);
    border-left: 4px solid var(--p);
    border-radius: 9px;
    background: var(--bg-soft);
  }
  .rank {
    font: 800 0.85rem ui-monospace, monospace;
    color: var(--muted);
  }
  .sname {
    font-weight: 700;
    color: var(--p);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sbot {
    font-size: 0.55rem;
    color: var(--muted);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0 0.3rem;
    margin-left: 0.35rem;
  }
  .sval {
    font-size: 1.2rem;
    font-weight: 800;
    color: var(--ink);
  }
  .sliq {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--muted);
  }
  .sdelta {
    font: 700 0.8rem ui-monospace, monospace;
    min-width: 4.5em;
    text-align: right;
    color: var(--muted);
  }
  .sdelta.up {
    color: #5fd39b;
  }
  .sdelta.down {
    color: #ff8a7e;
  }

  /* charts */
  .charts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 1rem;
    margin-bottom: 1.4rem;
  }
  .chart {
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg-soft);
    padding: 0.6rem 0.7rem;
  }
  .ctitle {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    margin-bottom: 0.4rem;
  }
  .chart svg {
    width: 100%;
    height: 120px;
    display: block;
    overflow: visible;
  }
  .chart .axis {
    stroke: var(--line);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .chart .line {
    fill: none;
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 0.7rem;
    margin-top: 0.5rem;
  }
  .lg {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.72rem;
    color: var(--muted);
  }
  .lg i {
    width: 12px;
    height: 3px;
    border-radius: 2px;
    background: var(--c);
  }
</style>
