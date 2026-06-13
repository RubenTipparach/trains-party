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

  // Current position in the cycle: 0=SR, 1=OR1, 2=OR2, 3=MR, -1=not started.
  const pos = $derived.by(() => {
    const s = game.state;
    if (s.round === 'stock') return 0;
    if (s.round === 'operating') return (s.or?.orNumber ?? 1) >= 2 ? 2 : 1;
    if (s.round === 'merger') return 3;
    return -1;
  });

  // The yellow era (phase 2) has NO merger round: the token path is just
  // SR -> OR1 -> OR2 -> (next SR). Green and later eras add MR (matches the
  // engine, which only runs a merger once a green train has been bought). The
  // board always SHOWS all four spaces; in yellow MR is just greyed off-path.
  const hasMerger = $derived(game.state.phase !== '2');

  // Fixed board layout (matches the physical tracker): SR top-left, OR1 top-
  // right, MR bottom-left, OR2 bottom-right.
  const NODES = [
    { id: 0, label: 'SR', x: 26, y: 24 },
    { id: 1, label: 'OR1', x: 108, y: 24 },
    { id: 3, label: 'MR', x: 26, y: 92 },
    { id: 2, label: 'OR2', x: 108, y: 92 }
  ];
  const POS = NODES.reduce((m, n) => ((m[n.id] = n), m), {} as Record<number, (typeof NODES)[number]>);
  // Token path: yellow skips MR (OR2 -> SR), green+ goes OR2 -> MR -> SR.
  const EDGES = $derived(
    hasMerger
      ? [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 0]
        ]
      : [
          [0, 1],
          [1, 2],
          [2, 0]
        ]
  );
  const ERA = ['#e6b93a', '#6fb84e', '#9b6fb0', '#9aa6ac']; // yellow / green / purple / grey
  const NR = 18; // node radius for trimming the arrows

  // Striped (era-coloured) connector from node a to node b, trimmed to the rims.
  function stripes(a: { x: number; y: number }, b: { x: number; y: number }) {
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
    return ERA.map((col, i) => {
      const o = (i - 1.5) * 2.3;
      return { x1: sx + px * o, y1: sy + py * o, x2: ex + px * o, y2: ey + py * o, col };
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
  <div class="tracker" aria-label="Round and cycle tracker">
    <div class="cols">
      <!-- ROUNDS -->
      <div class="rounds">
        <div class="cap">Rounds</div>
        <svg viewBox="0 0 134 116" class="rsvg">
          {#each EDGES as [a, b], i (i)}
            {@const active = pos === a}
            <g class:activeedge={active}>
              {#each stripes(POS[a], POS[b]) as s (s.col)}
                <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.col} stroke-width="2.1" stroke-linecap="round" />
              {/each}
              <polygon points={head(POS[a], POS[b])} fill={active ? '#1c2a36' : '#6b5f44'} />
            </g>
          {/each}
          {#each NODES as n (n.id)}
            {@const here = pos === n.id}
            {@const offpath = n.id === 3 && !hasMerger}
            <circle cx={n.x} cy={n.y} r={NR} class="node" class:here class:offpath />
            <text x={n.x} y={n.y + 3.5} text-anchor="middle" class="nlabel" class:offlabel={offpath}>{n.label}</text>
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
          <span class="zlabel short" style="flex:{Math.min(shortEnd, totalCycles)}">Short</span>
          {#if totalCycles > shortEnd}<span class="zlabel long" style="flex:{totalCycles - shortEnd}">Long</span>{/if}
        </div>
      </div>
    </div>
    <p class="note">Remove a train before each Stock Round</p>
  </div>
{/if}

<style>
  .tracker {
    background: #efe7d0;
    border: 1px solid #6e5f42;
    border-radius: 12px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
    padding: 0.5rem 0.6rem 0.4rem;
    color: #3a3526;
    user-select: none;
    width: max-content;
  }
  .cols {
    display: flex;
    gap: 0.7rem;
    align-items: flex-start;
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
  .node.offpath {
    fill: #e4ddca;
    stroke: #9a8f72;
    stroke-dasharray: 3 3;
  }
  .nlabel {
    font: 800 11px ui-sans-serif, sans-serif;
    fill: #4a4030;
  }
  .nlabel.offlabel {
    fill: #9a8f72;
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
    min-width: 96px;
  }
  .dots {
    display: flex;
    gap: 4px;
    justify-content: center;
    margin-top: 0.4rem;
  }
  .dot {
    width: 22px;
    height: 22px;
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
    gap: 4px;
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
  }
  .zlabel.long {
    color: #8a7d56;
  }
  .note {
    margin: 0.35rem 0 0;
    font: 600 0.58rem ui-sans-serif, sans-serif;
    color: #7a6c4b;
    text-align: center;
  }
</style>
