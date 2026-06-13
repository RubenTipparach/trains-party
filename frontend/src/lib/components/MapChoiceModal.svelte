<script lang="ts">
  // A modal version of the board for picking a single hex (a home, a token space,
  // any "where?"). The legal choices are highlighted and clickable; everything
  // else is dimmed. See CLAUDE.md section 4: board-space choices are map choices.
  import { fade, scale } from 'svelte/transition';
  import { game } from '$lib/game/sandbox.svelte';
  import { configFor } from '$lib/engine';
  import { HEX_SIZE, APOTHEM, hexCenter, hexPolygon } from '$lib/hexgeo';
  import type { HexDef } from '$lib/data/types';

  let {
    title,
    hexes,
    onchoose,
    oncancel
  }: {
    title: string;
    hexes: string[];
    onchoose: (hex: string) => void;
    oncancel: () => void;
  } = $props();

  const activeMap = $derived<Record<string, HexDef>>(game.state.map ?? configFor(game.title).hexByCoord);
  const list = $derived(Object.values(activeMap));
  const pickable = $derived(new Set(hexes));

  // Fit the whole board into the modal's viewBox.
  const view = $derived.by(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const h of list) {
      const c = hexCenter(h.coord);
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x);
      maxY = Math.max(maxY, c.y);
    }
    const pad = HEX_SIZE * 1.2;
    return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
  });

  const isCity = (h: HexDef) => h.cities.length > 0 || h.towns.length > 0 || !!h.offboard;
  const fillFor = (h: HexDef) => {
    if (h.color === 'blue' || h.offboard) return '#22506b'; // water / off-board
    return '#3a4a32'; // land
  };
</script>

<div class="backdrop" transition:fade={{ duration: 140 }}>
  <div class="modal" transition:scale={{ duration: 160, start: 0.96 }}>
    <header>
      <h2>{title}</h2>
      <button class="x" aria-label="Cancel" onclick={oncancel}>✕</button>
    </header>
    <p class="hint">Tap a highlighted space on the map.</p>
    <div class="mapwrap">
      <svg viewBox="{view.x} {view.y} {view.w} {view.h}" role="group" aria-label="Board">
        {#each list as h (h.coord)}
          {@const c = hexCenter(h.coord)}
          {@const pick = pickable.has(h.coord)}
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <g
            class:pick
            role={pick ? 'button' : undefined}
            tabindex={pick ? 0 : undefined}
            aria-label={pick ? `Choose ${h.coord}` : undefined}
            onclick={() => pick && onchoose(h.coord)}
            onkeydown={(e) => pick && (e.key === 'Enter' || e.key === ' ') && onchoose(h.coord)}
          >
            <polygon points={hexPolygon(c.x, c.y)} fill={fillFor(h)} class:pickable={pick} />
            {#if isCity(h)}
              <circle cx={c.x} cy={c.y} r={HEX_SIZE * 0.26} fill={pick ? '#f5c542' : '#cdd6df'} stroke="#15110a" stroke-width="2" />
            {/if}
            <text x={c.x} y={c.y + APOTHEM - 7} text-anchor="middle" class="coord">{h.coord}</text>
          </g>
        {/each}
      </svg>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(6, 10, 16, 0.74);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .modal {
    width: min(900px, 96vw);
    max-height: 92vh;
    display: flex;
    flex-direction: column;
    background: var(--bg, #141a22);
    border: 1px solid var(--line, #2c3543);
    border-radius: 14px;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.7rem 0.9rem;
    border-bottom: 1px solid var(--line, #2c3543);
  }
  header h2 {
    margin: 0;
    font-size: 1rem;
    flex: 1;
  }
  .x {
    border: none;
    background: transparent;
    color: var(--ink, #e9e6df);
    font-size: 1.1rem;
    cursor: pointer;
    line-height: 1;
  }
  .hint {
    margin: 0;
    padding: 0.5rem 0.9rem 0;
    font-size: 0.82rem;
    color: var(--muted, #9aa0aa);
  }
  .mapwrap {
    overflow: auto;
    padding: 0.7rem;
  }
  svg {
    width: 100%;
    height: auto;
    display: block;
  }
  polygon {
    stroke: rgba(0, 0, 0, 0.35);
    stroke-width: 1.5;
    opacity: 0.5;
  }
  polygon.pickable {
    opacity: 1;
    stroke: #f5c542;
    stroke-width: 4;
  }
  .pick {
    cursor: pointer;
  }
  .pick:hover polygon.pickable {
    fill: #6b7a44;
  }
  .coord {
    font: 600 11px ui-monospace, monospace;
    fill: rgba(233, 230, 223, 0.55);
    pointer-events: none;
  }
  .pick .coord {
    fill: #f5c542;
  }
</style>
