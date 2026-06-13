<script lang="ts">
  // Floating round/cycle tracker, styled like the physical RoLA tracker board:
  // a ROUNDS loop (SR -> OR1 -> OR2 -> MR -> next cycle) with era-coloured
  // arrows, and a CYCLES track. Shown on the map for fixed-cycle games (RoLA).
  import { game } from '$lib/game/sandbox.svelte';
  import { configFor } from '$lib/engine';

  const totalCycles = $derived(configFor(game.title).cyclesByPlayers?.[game.state.players.length] ?? 0);
  const isCycleGame = $derived(totalCycles > 0);
  const cycle = $derived(Math.min(game.state.cycle ?? 1, totalCycles));
  const shortEnd = 4; // cycles 1-4 are the Short game; 5-6 are Long
  let open = $state(true); // collapse/expand the floating tracker

  // Current position in the cycle: 0=SR, 1=OR1, 2=OR2, 3=MR, -1=not started.
  const pos = $derived.by(() => {
    const s = game.state;
    if (s.round === 'stock') return 0;
    if (s.round === 'operating') return (s.or?.orNumber ?? 1) >= 2 ? 2 : 1;
    if (s.round === 'merger') return 3;
    return -1;
  });

  const ERA = ['#e6b93a', '#6fb84e', '#9b6fb0', '#9aa6ac']; // yellow / green / purple / grey
  const NR = 18; // node radius for trimming the arrows

  // The connector colours encode each era's path. EVERY era runs SR->OR1->OR2.
  // The YELLOW era then skips the merger and loops back (OR2->SR), so only the
  // yellow stripe is on that arrow. Green/purple/grey all go through the merger
  // (OR2->MR->SR), so those arrows carry every colour EXCEPT yellow.
  const ALL = [0, 1, 2, 3];
  const NON_YELLOW = [1, 2, 3];
  const YELLOW = [0];
  // Fixed board layout (matches the physical tracker): SR top-left, OR1 top-
  // right, MR bottom-left, OR2 bottom-right.
  const NODES = [
    { id: 0, label: 'SR', x: 26, y: 24 },
    { id: 1, label: 'OR1', x: 108, y: 24 },
    { id: 3, label: 'MR', x: 26, y: 92 },
    { id: 2, label: 'OR2', x: 108, y: 92 }
  ];
  const POS = NODES.reduce((m, n) => ((m[n.id] = n), m), {} as Record<number, (typeof NODES)[number]>);
  // a -> b with the era colours that travel it. (OR2 has two outgoing arrows:
  // the yellow shortcut back to SR, and the non-yellow path to MR.)
  const EDGES: Array<{ a: number; b: number; eras: number[] }> = [
    { a: 0, b: 1, eras: ALL }, // SR -> OR1
    { a: 1, b: 2, eras: ALL }, // OR1 -> OR2
    { a: 2, b: 3, eras: NON_YELLOW }, // OR2 -> MR
    { a: 3, b: 0, eras: NON_YELLOW }, // MR -> SR
    { a: 2, b: 0, eras: YELLOW } // OR2 -> SR (yellow shortcut, skips MR)
  ];
  // Which era we are in now (0=yellow..3=grey), to highlight the live arrow.
  const eraIdx = $derived.by(() => {
    const p = game.state.phase;
    if (p === '2') return 0;
    if (p === '3' || p === '4') return 1;
    if (p === '5' || p === '6') return 2;
    return 3;
  });

  // Striped connector from a to b in the given era colours, trimmed to the rims.
  function stripes(a: { x: number; y: number }, b: { x: number; y: number }, eras: number[]) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    const sx = a.x + ux * NR;
    const sy = a.y + uy * NR;
    const ex = b.x - ux * (NR + 6);
    const ey = b.y - uy * (NR + 6);
    return eras.map((eraIdx2, i) => {
      const o = (i - (eras.length - 1) / 2) * 2.3;
      return { x1: sx + px * o, y1: sy + py * o, x2: ex + px * o, y2: ey + py * o, col: ERA[eraIdx2] };
    });
  }
  function head(a: { x: number; y: number }, b: { x: number; y: number }) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    const tx = b.x - ux * (NR + 1);
    const ty = b.y - uy * (NR + 1);
    const bx = tx - ux * 9;
    const by = ty - uy * 9;
    return `${tx},${ty} ${bx + px * 5.5},${by + py * 5.5} ${bx - px * 5.5},${by - py * 5.5}`;
  }
</script>

{#if isCycleGame && pos >= 0}
  {#if open}
    <div class="tracker" aria-label="Round and cycle tracker">
      <button class="min" title="Minimise" aria-label="Minimise tracker" onclick={() => (open = false)}>–</button>
      <div class="cols">
        <!-- ROUNDS -->
        <div class="rounds">
          <div class="cap">Rounds</div>
          <svg viewBox="0 0 134 116" class="rsvg">
            {#each EDGES as e, i (i)}
              {@const active = pos === e.a && e.eras.includes(eraIdx)}
              <g class:activeedge={active}>
                {#each stripes(POS[e.a], POS[e.b], e.eras) as s, si (si)}
                  <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.col} stroke-width="2.1" stroke-linecap="round" />
                {/each}
                <polygon points={head(POS[e.a], POS[e.b])} fill={active ? '#1c2a36' : '#6b5f44'} />
              </g>
            {/each}
            {#each NODES as n (n.id)}
              {@const here = pos === n.id}
              <circle cx={n.x} cy={n.y} r={NR} class="node" class:here />
              <text x={n.x} y={n.y + 3.5} text-anchor="middle" class="nlabel">{n.label}</text>
            {/each}
          </svg>
        </div>

        <!-- CYCLES -->
        <div class="cycles">
          <div class="cap">Cycles</div>
          <div class="dots">
            {#each Array(totalCycles) as _, i (i)}
              {@const n = i + 1}
              <span class="dot" class:on={n === cycle} class:done={n < cycle} class:long={n > shortEnd}>{n}</span>
            {/each}
          </div>
          <div class="zones">
            <span class="zlabel" style="flex:{Math.min(shortEnd, totalCycles)}">Short</span>
            {#if totalCycles > shortEnd}<span class="zlabel" style="flex:{totalCycles - shortEnd}">Long</span>{/if}
          </div>
        </div>
      </div>
      <p class="note">Remove a train before each Stock Round</p>
    </div>
  {:else}
    <button class="chip" onclick={() => (open = true)} title="Show round tracker">
      Cycle {cycle}/{totalCycles} · {NODES.find((n) => n.id === pos)?.label ?? ''}
      <span class="exp">▢</span>
    </button>
  {/if}
{/if}

<style>
  .tracker {
    position: relative;
    background: #efe7d0;
    border: 1px solid #6e5f42;
    border-radius: 12px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
    padding: 0.5rem 0.6rem 0.4rem;
    color: #3a3526;
    user-select: none;
    width: max-content;
  }
  .min {
    position: absolute;
    top: 4px;
    right: 5px;
    width: 18px;
    height: 18px;
    border-radius: 5px;
    border: 1px solid #9a8f72;
    background: #f6efda;
    color: #4a4030;
    font: 800 13px/1 ui-sans-serif, sans-serif;
    cursor: pointer;
    display: grid;
    place-items: center;
  }
  .min:hover {
    background: #e8dec2;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: #efe7d0;
    border: 1px solid #6e5f42;
    border-radius: 999px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
    padding: 0.35rem 0.7rem;
    color: #3a3526;
    font: 800 0.74rem ui-sans-serif, sans-serif;
    cursor: pointer;
  }
  .chip .exp {
    font-size: 0.66rem;
    opacity: 0.7;
  }
  .cols {
    display: flex;
    gap: 0.8rem;
    align-items: flex-start;
    padding-right: 0.6rem;
  }
  .cap {
    font: 800 0.62rem ui-sans-serif, sans-serif;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #4a4030;
    text-align: center;
    margin-bottom: 0.1rem;
  }
  .rsvg {
    width: 118px;
    height: 102px;
    display: block;
  }
  .node {
    fill: #fbf7e9;
    stroke: #3a3526;
    stroke-width: 1.6;
  }
  .node.here {
    fill: #eaf3f8;
    stroke: #2f6f96;
    stroke-width: 3;
  }
  .nlabel {
    font: 800 11px ui-sans-serif, sans-serif;
    fill: #4a4030;
  }
  .activeedge line {
    stroke-width: 3 !important;
  }
  .activeedge {
    animation: edgeflow 1.1s ease-in-out infinite;
  }
  @keyframes edgeflow {
    0%,
    100% {
      opacity: 0.6;
    }
    50% {
      opacity: 1;
    }
  }
  .cycles {
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }
  .dots {
    display: flex;
    flex-wrap: nowrap;
    gap: 5px;
    justify-content: center;
    margin-top: 0.4rem;
  }
  .dot {
    width: 22px;
    height: 22px;
    flex: none;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font: 700 0.72rem ui-sans-serif, sans-serif;
    background: #fbf7e9;
    border: 1.6px solid #3a3526;
    color: #4a4030;
  }
  .dot.long {
    background: #e3dcc6;
    border-style: dashed;
  }
  .dot.done {
    background: #cdbf99;
    color: #6b5f44;
  }
  .dot.on {
    background: #e6b93a;
    border-color: #b06a30;
    color: #2a2418;
    box-shadow: 0 0 0 2px rgba(230, 185, 58, 0.4);
  }
  .zones {
    display: flex;
    gap: 5px;
    margin-top: 0.3rem;
  }
  .zlabel {
    font: 700 0.56rem ui-sans-serif, sans-serif;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    text-align: center;
    color: #6b5f44;
    border-top: 1.5px solid #b3a77f;
    padding-top: 0.1rem;
    min-width: 0;
  }
  .note {
    margin: 0.35rem 0 0;
    font: 600 0.58rem ui-sans-serif, sans-serif;
    color: #7a6c4b;
    text-align: center;
  }
</style>
