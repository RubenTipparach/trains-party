<script lang="ts">
  // View-only WebGL board (PixiJS). The static board (sea glow, hexes, tiles, tokens)
  // is painted by the shared drawBoard() into an offscreen canvas and uploaded as a
  // GPU texture, re-baked only when the game advances or the container resizes. The
  // animated shore waves are NOT baked - they are drawn as a GPU Graphics layer on top
  // and redrawn every frame, so the heavy board texture is uploaded only on change.
  // View-only: interactive steps fall back to the SVG board. PixiJS is dynamically
  // imported so it never runs during static prerender.
  import { onMount } from 'svelte';
  import { game } from '$lib/game/sandbox.svelte';
  import { drawBoard, boardBounds, computeCoast, boardTransform, waveParams, hexAtWorld } from '$lib/render/boardRender';
  import { hexesFor } from '$lib/engine';
  import { BoardCamera } from '$lib/render/camera';

  const cam = new BoardCamera();
  let wrap: HTMLDivElement;
  let hover = $state<{ label: string; x: number; y: number } | null>(null);

  /** Screen point (relative to the container) -> hex coordinate under it, or null. */
  function hexAt(clientX: number, clientY: number): string | null {
    const rect = wrap.getBoundingClientRect();
    const cssW = rect.width, cssH = rect.height;
    if (cssW < 2 || cssH < 2) return null;
    const view = cam.viewFor(boardBounds(game.state, game.title), cssW, cssH);
    const sc = cssW / view.w;
    const wx = view.x + (clientX - rect.left) / sc;
    const wy = view.y + (clientY - rect.top) / sc;
    return hexAtWorld(game.state, game.title, wx, wy);
  }
  function onHover(e: PointerEvent) {
    if (e.buttons !== 0) {
      hover = null; // dragging (pan/pinch): no tooltip
      return;
    }
    const coord = hexAt(e.clientX, e.clientY);
    if (!coord) {
      hover = null;
      return;
    }
    const def = hexesFor(game.state)[coord];
    const rect = wrap.getBoundingClientRect();
    hover = { label: def?.name ? `${coord} · ${def.name}` : coord, x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  const clearHover = () => (hover = null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let PIXI: any = null, app: any = null, sprite: any = null, texture: any = null, waveG: any = null;
  let off: HTMLCanvasElement | null = null;
  let offCtx: CanvasRenderingContext2D | null = null;
  let bakeReq = 0;
  let raf = 0;
  let destroyed = false;

  function bake() {
    if (!app || !app.renderer || !PIXI || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = wrap.clientWidth;
    const cssH = wrap.clientHeight;
    if (cssW < 2 || cssH < 2) return;
    const pw = Math.round(cssW * dpr);
    const ph = Math.round(cssH * dpr);
    if (!off || off.width !== pw || off.height !== ph) {
      off = document.createElement('canvas');
      off.width = pw;
      off.height = ph;
      offCtx = off.getContext('2d');
      texture?.destroy(true);
      texture = PIXI.Texture.from(off);
      if (sprite) sprite.texture = texture;
      else {
        sprite = new PIXI.Sprite(texture);
        app.stage.addChildAt(sprite, 0);
      }
      app.renderer.resize(cssW, cssH);
    }
    if (!offCtx) return;
    // No `time` -> the board texture omits the waves (the Graphics layer draws them).
    drawBoard(offCtx, game.state, {
      title: game.title,
      cssW,
      cssH,
      dpr,
      view: cam.viewFor(boardBounds(game.state, game.title), cssW, cssH)
    });
    texture.source.update();
    sprite.setSize(cssW, cssH);
  }
  function scheduleBake() {
    if (bakeReq) return;
    bakeReq = requestAnimationFrame(() => {
      bakeReq = 0;
      bake();
    });
  }

  // Dashed foam segment (PixiJS has no native dash), built in screen coords.
  function dash(g: any, x1: number, y1: number, x2: number, y2: number) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < 0.001) return;
    const ux = dx / len, uy = dy / len;
    for (let d = 0; d < len; d += 14) {
      const e = Math.min(d + 8, len);
      g.moveTo(x1 + ux * d, y1 + uy * d).lineTo(x1 + ux * e, y1 + uy * e);
    }
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    if (!app || !app.renderer || !waveG || !wrap || (typeof document !== 'undefined' && document.hidden)) return;
    const cssW = wrap.clientWidth, cssH = wrap.clientHeight;
    if (cssW < 2 || cssH < 2) return;
    const view = cam.viewFor(boardBounds(game.state, game.title), cssW, cssH);
    const { s, offX, offY } = boardTransform(view, cssW, cssH);
    const coast = computeCoast(game.state, game.title);
    const t = performance.now() / 1000;
    waveG.clear();
    for (const w of coast.waves) {
      for (const lead of [0, 0.5]) {
        const { scale, alpha } = waveParams(w, t, lead);
        if (alpha <= 0.01) continue;
        const sx1 = offX + (w.ox + (w.x1 - w.ox) * scale - view.x) * s;
        const sy1 = offY + (w.oy + (w.y1 - w.oy) * scale - view.y) * s;
        const sx2 = offX + (w.ox + (w.x2 - w.ox) * scale - view.x) * s;
        const sy2 = offY + (w.oy + (w.y2 - w.oy) * scale - view.y) * s;
        dash(waveG, sx1, sy1, sx2, sy2);
        waveG.stroke({ width: 2.3, color: 0xffffff, alpha, cap: 'round' });
      }
    }
    app.renderer.render(app.stage);
  }

  $effect(() => {
    void game.state.seq;
    scheduleBake();
  });

  onMount(() => {
    let ro: ResizeObserver | undefined;
    let unbind: (() => void) | undefined;
    const canvas = document.createElement('canvas');
    (async () => {
      PIXI = await import('pixi.js');
      app = new PIXI.Application();
      await app.init({
        canvas,
        width: Math.max(1, wrap?.clientWidth ?? 1),
        height: Math.max(1, wrap?.clientHeight ?? 1),
        backgroundAlpha: 0,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true
      });
      if (destroyed) {
        app.destroy(true);
        return;
      }
      app.ticker.stop(); // we render on demand (bake + per-frame wave layer)
      waveG = new PIXI.Graphics();
      app.stage.addChild(waveG);
      wrap.appendChild(canvas);
      bake();
      raf = requestAnimationFrame(frame);
      ro = new ResizeObserver(() => scheduleBake());
      ro.observe(wrap);
      unbind = cam.bind(
        wrap,
        () => boardBounds(game.state, game.title),
        () => ({ w: wrap.clientWidth, h: wrap.clientHeight }),
        () => scheduleBake() // re-bake the board texture for the new view
      );
      wrap.addEventListener('pointermove', onHover);
      wrap.addEventListener('pointerleave', clearHover);
    })();
    return () => {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      if (bakeReq) cancelAnimationFrame(bakeReq);
      ro?.disconnect();
      unbind?.();
      wrap?.removeEventListener('pointermove', onHover);
      wrap?.removeEventListener('pointerleave', clearHover);
      app?.destroy(true, { children: true });
    };
  });
</script>

<div class="cwrap" bind:this={wrap}>
  {#if hover}
    <div class="htip" style="left:{hover.x}px; top:{hover.y}px">{hover.label}</div>
  {/if}
</div>

<style>
  .cwrap {
    position: absolute;
    inset: 0;
    touch-action: none; /* we handle drag/pinch ourselves */
    cursor: grab;
  }
  .htip {
    position: absolute;
    transform: translate(-50%, calc(-100% - 10px));
    pointer-events: none;
    background: rgba(12, 20, 26, 0.92);
    color: #eef3f6;
    border: 1px solid var(--line, #2c3a44);
    border-radius: 6px;
    padding: 0.2rem 0.5rem;
    font: 600 0.74rem ui-sans-serif, sans-serif;
    white-space: nowrap;
    z-index: 4;
  }
  .cwrap:active {
    cursor: grabbing;
  }
  .cwrap :global(canvas) {
    display: block;
  }
</style>
