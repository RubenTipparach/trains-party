<script lang="ts">
  // View-only canvas board (Stage 1 of the SVG -> canvas migration). It paints the
  // whole board in one imperative pass via drawBoard(); a steady rAF loop drives the
  // shore-wave animation (and so also picks up game advances and resizes for free).
  // No pan/zoom or click handling yet, so it is used for VIEWING (watch mode); the
  // SVG board still drives interactive lay/token/build/run steps.
  import { onMount } from 'svelte';
  import { game } from '$lib/game/sandbox.svelte';
  import { drawBoard, boardBounds } from '$lib/render/boardRender';
  import { BoardCamera } from '$lib/render/camera';

  let wrap: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let raf = 0;
  const cam = new BoardCamera();

  function frame() {
    raf = requestAnimationFrame(frame);
    if (!canvas || !wrap || (typeof document !== 'undefined' && document.hidden)) return;
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
    const bounds = boardBounds(game.state, game.title);
    drawBoard(ctx, game.state, {
      title: game.title,
      cssW,
      cssH,
      dpr,
      view: cam.viewFor(bounds, cssW, cssH),
      time: performance.now() / 1000
    });
  }

  onMount(() => {
    const unbind = cam.bind(
      wrap,
      () => boardBounds(game.state, game.title),
      () => ({ w: wrap.clientWidth, h: wrap.clientHeight }),
      () => {} // the steady rAF loop already repaints
    );
    raf = requestAnimationFrame(frame);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      unbind();
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
    touch-action: none; /* we handle drag/pinch ourselves */
    cursor: grab;
  }
  .cwrap:active {
    cursor: grabbing;
  }
  canvas {
    display: block;
  }
</style>
