<script lang="ts">
  // View-only WebGL board (PixiJS), stage 1 of the GPU renderer. The board is
  // painted by the shared drawBoard() into an offscreen canvas and uploaded as a
  // GPU texture that PixiJS composites; it is re-baked (one rAF) only when the game
  // advances or the container resizes. This caches the (rarely-changing) board as a
  // single texture - cheap to composite - and gives us a WebGL stage on which the
  // animated layer (trains, route stripes, sliding tokens) becomes GPU sprites in a
  // later stage. View-only: interactive steps fall back to the SVG board.
  //
  // PixiJS is loaded with a dynamic import so it never runs during static
  // prerender (it touches browser-only globals).
  import { onMount } from 'svelte';
  import { game } from '$lib/game/sandbox.svelte';
  import { drawBoard, boardBounds } from '$lib/render/boardRender';

  let wrap: HTMLDivElement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let PIXI: any = null, app: any = null, sprite: any = null, texture: any = null;
  let off: HTMLCanvasElement | null = null;
  let offCtx: CanvasRenderingContext2D | null = null;
  let raf = 0;
  let destroyed = false;

  function bake() {
    // app exists as soon as it is constructed, but app.renderer only after init()
    // resolves; a bot move / resize can schedule a bake during that gap, so guard it.
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
        app.stage.addChild(sprite);
      }
      app.renderer.resize(cssW, cssH);
    }
    if (!offCtx) return;
    drawBoard(offCtx, game.state, {
      title: game.title,
      cssW,
      cssH,
      dpr,
      view: boardBounds(game.state, game.title)
    });
    texture.source.update(); // re-upload the freshly painted board to the GPU
    sprite.setSize(cssW, cssH);
    app.renderer.render(app.stage);
  }
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      bake();
    });
  }

  $effect(() => {
    void game.state.seq;
    schedule();
  });

  onMount(() => {
    let ro: ResizeObserver | undefined;
    const canvas = document.createElement('canvas');
    (async () => {
      PIXI = await import('pixi.js');
      app = new PIXI.Application();
      await app.init({
        canvas,
        width: Math.max(1, wrap?.clientWidth ?? 1),
        height: Math.max(1, wrap?.clientHeight ?? 1),
        backgroundAlpha: 0,
        antialias: false,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true
      });
      if (destroyed) {
        app.destroy(true);
        return;
      }
      app.ticker.stop(); // we render on demand (on bake), not every frame
      wrap.appendChild(canvas);
      bake();
      ro = new ResizeObserver(() => schedule());
      ro.observe(wrap);
    })();
    return () => {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      app?.destroy(true, { children: true });
    };
  });
</script>

<div class="cwrap" bind:this={wrap}></div>

<style>
  .cwrap {
    position: absolute;
    inset: 0;
  }
  .cwrap :global(canvas) {
    display: block;
  }
</style>
