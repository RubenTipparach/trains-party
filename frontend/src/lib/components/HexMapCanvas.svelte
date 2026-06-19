<script lang="ts">
  // View-only canvas board (Stage 1 of the SVG -> canvas migration). It paints the
  // whole board in one imperative pass via drawBoard() and repaints (coalesced to one
  // rAF) only when the game advances or the container resizes - no per-node DOM diff,
  // which is what janks the SVG board on every poll/bot move. It has no pan/zoom or
  // click handling yet, so it is used for VIEWING (watch mode, spectating); the SVG
  // board still drives interactive lay/token/build/run steps.
  import { onMount } from 'svelte';
  import { game } from '$lib/game/sandbox.svelte';
  import { drawBoard, boardBounds } from '$lib/render/boardRender';

  let wrap: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let raf = 0;

  function render() {
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = wrap.clientWidth;
    const cssH = wrap.clientHeight;
    if (cssW < 2 || cssH < 2) return;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawBoard(ctx, game.state, {
      title: game.title,
      cssW,
      cssH,
      dpr,
      view: boardBounds(game.state, game.title)
    });
  }
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      render();
    });
  }

  // Repaint whenever the game advances (seq changes) ...
  $effect(() => {
    void game.state.seq;
    schedule();
  });
  // ... and whenever the container resizes.
  onMount(() => {
    const ro = new ResizeObserver(schedule);
    ro.observe(wrap);
    render();
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  });
</script>

<div class="cwrap" bind:this={wrap}>
  <canvas bind:this={canvas}></canvas>
</div>

<style>
  .cwrap {
    position: absolute;
    inset: 0;
  }
  canvas {
    display: block;
  }
</style>
