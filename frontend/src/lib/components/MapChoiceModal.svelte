<script lang="ts">
  // A modal version of the *actual* board for picking a single hex (a home, a
  // token space, any "where?"). It mounts the real HexMap in pick mode, so terrain,
  // laid track, tiles and tokens all show. The legal choices glow and are clickable.
  // See CLAUDE.md section 4: board-space choices are map choices.
  import { fade, scale } from 'svelte/transition';
  import HexMap from './HexMap.svelte';

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
</script>

<div class="backdrop" transition:fade={{ duration: 140 }}>
  <div class="modal" transition:scale={{ duration: 160, start: 0.96 }}>
    <header>
      <h2>{title}</h2>
      <button class="x" aria-label="Cancel" onclick={oncancel}>✕</button>
    </header>
    <p class="hint">Tap a highlighted space on the map.</p>
    <div class="mapwrap">
      <HexMap pickHexes={hexes} onpick={onchoose} fill />
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
    width: min(960px, 96vw);
    height: min(88vh, 820px);
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
    flex: 1;
    min-height: 0;
    padding: 0.6rem;
  }
</style>
