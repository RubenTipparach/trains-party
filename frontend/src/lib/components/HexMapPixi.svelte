<script lang="ts">
  // WebGL board (PixiJS). The static board (sea glow, hexes, tiles, tokens) is painted
  // by the shared drawBoard() into an offscreen canvas and uploaded as a GPU texture,
  // re-baked only when the game advances, the camera moves, or a lay preview changes.
  // Animated shore waves + interaction highlights are GPU Graphics redrawn each frame.
  //
  // Interaction (native, no SVG): pan/zoom/pinch via BoardCamera; hover tooltips; and
  // tile laying on the player's track step - tap a highlighted hex, cycle the legal
  // tile/rotation options, then confirm. Token/run/map-build still fall back to the
  // SVG board until they are ported too. PixiJS is dynamically imported so it never
  // runs during static prerender.
  import { onMount } from 'svelte';
  import { game } from '$lib/game/sandbox.svelte';
  import { drawBoard, boardBounds, computeCoast, boardTransform, waveParams, hexAtWorld } from '$lib/render/boardRender';
  import { hexesFor, trackLays, tokenPlays, operatingView, TILES } from '$lib/engine';
  import { routing } from '$lib/game/routing.svelte';
  import { hexCenter, hexVertices } from '$lib/hexgeo';
  import { BoardCamera } from '$lib/render/camera';

  const cam = new BoardCamera();
  let wrap: HTMLDivElement;
  let hover = $state<{ label: string; x: number; y: number } | null>(null);

  // --- interaction state (tile laying) ---------------------------------------
  type Lay = { hex: string; tile: string; rotation: number; cost: number; upgrade?: boolean };
  const opv = $derived.by(() => {
    try {
      return game.state.round === 'operating' ? operatingView(game.state) : null;
    } catch {
      return null;
    }
  });
  const layMode = $derived(game.canAct && opv?.step === 'track');
  const lays = $derived<Lay[]>(layMode ? (trackLays(game.state) as Lay[]) : []);
  const legalHexes = $derived(new Set(lays.map((l) => l.hex)));
  let selected = $state<{ hex: string; options: Lay[]; idx: number } | null>(null);
  const previewTile = $derived(
    selected ? { hex: selected.hex, id: selected.options[selected.idx].tile, rotation: selected.options[selected.idx].rotation } : null
  );
  // Clear a stale selection if it is no longer a legal lay (turn/step changed).
  $effect(() => {
    if (selected && (!layMode || !legalHexes.has(selected.hex))) selected = null;
  });
  // Re-bake whenever the preview changes so the ghost tile shows in the texture.
  $effect(() => {
    void previewTile;
    scheduleBake();
  });

  function take(hex: string) {
    const options = lays.filter((l) => l.hex === hex);
    if (options.length) selected = { hex, options, idx: 0 };
  }
  function cycle() {
    if (selected) selected = { ...selected, idx: (selected.idx + 1) % selected.options.length };
  }
  function confirm() {
    if (!selected || !opv) return;
    const o = selected.options[selected.idx];
    game.act({ type: 'lay_tile', player: game.active!, corp: opv.corp, hex: o.hex, tile: o.tile, rotation: o.rotation });
    selected = null;
  }
  function cancel() {
    selected = null;
  }

  // --- token step ---
  const tokenMode = $derived(game.canAct && opv?.step === 'token');
  const tokenHexes = $derived(tokenMode ? new Set(tokenPlays(game.state).map((t) => t.hex)) : new Set<string>());
  let tokenSel = $state<string | null>(null);
  $effect(() => {
    if (tokenSel && (!tokenMode || !tokenHexes.has(tokenSel))) tokenSel = null;
  });
  function placeToken() {
    if (!tokenSel || !opv) return;
    game.act({ type: 'place_token', player: game.active!, corp: opv.corp, hex: tokenSel });
    tokenSel = null;
  }

  // --- run step (route stop selection; pay/withhold lives in the operating panel) ---
  const runMode = $derived(game.canAct && opv?.step === 'run');
  const routeSegColors = $derived(runMode ? routing.segColors() : {});
  function isStop(coord: string): boolean {
    const t = game.state.tiles?.[coord];
    if (t) {
      const d = TILES[t.id];
      return d.cities > 0 || d.towns > 0;
    }
    const base = hexesFor(game.state)[coord];
    return !!base && (base.cities.length > 0 || base.towns.length > 0 || !!base.offboard);
  }
  // Re-bake the board (route stripes live in the texture) whenever the routes change.
  $effect(() => {
    void routeSegColors;
    scheduleBake();
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let PIXI: any = null, app: any = null, sprite: any = null, texture: any = null, waveG: any = null, uiG: any = null;
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
    drawBoard(offCtx, game.state, {
      title: game.title,
      cssW,
      cssH,
      dpr,
      view: cam.viewFor(boardBounds(game.state, game.title), cssW, cssH),
      overlayTile: previewTile,
      routeSegColors
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

  function dash(g: any, x1: number, y1: number, x2: number, y2: number) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < 0.001) return;
    const ux = dx / len, uy = dy / len;
    for (let d = 0; d < len; d += 14) {
      const e = Math.min(d + 8, len);
      g.moveTo(x1 + ux * d, y1 + uy * d).lineTo(x1 + ux * e, y1 + uy * e);
    }
  }
  function hexPath(g: any, coord: string, view: { x: number; y: number }, s: number, offX: number, offY: number) {
    const c = hexCenter(coord);
    const v = hexVertices(c.x, c.y);
    g.moveTo(offX + (v[0].x - view.x) * s, offY + (v[0].y - view.y) * s);
    for (let i = 1; i < 6; i++) g.lineTo(offX + (v[i].x - view.x) * s, offY + (v[i].y - view.y) * s);
    g.closePath();
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    if (!app || !app.renderer || !waveG || !wrap || (typeof document !== 'undefined' && document.hidden)) return;
    const cssW = wrap.clientWidth, cssH = wrap.clientHeight;
    if (cssW < 2 || cssH < 2) return;
    const view = cam.viewFor(boardBounds(game.state, game.title), cssW, cssH);
    const { s, offX, offY } = boardTransform(view, cssW, cssH);
    // shore foam
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
    // interaction highlights
    uiG.clear();
    const pulse = 0.55 + 0.25 * Math.sin(performance.now() / 320);
    if (layMode) {
      for (const hx of legalHexes) {
        if (selected && hx === selected.hex) continue;
        hexPath(uiG, hx, view, s, offX, offY);
        uiG.stroke({ width: 3, color: 0xf5c542, alpha: pulse });
      }
      if (selected) {
        hexPath(uiG, selected.hex, view, s, offX, offY);
        uiG.stroke({ width: 4, color: 0x5fd39b, alpha: 0.95 });
      }
    } else if (tokenMode) {
      for (const hx of tokenHexes) {
        hexPath(uiG, hx, view, s, offX, offY);
        uiG.stroke({ width: hx === tokenSel ? 4 : 3, color: hx === tokenSel ? 0x5fd39b : 0x39b3ff, alpha: hx === tokenSel ? 0.95 : pulse });
      }
    } else if (runMode) {
      for (const tr of routing.trains) {
        const col = parseInt(tr.color.replace('#', ''), 16);
        for (const hx of tr.stops) {
          hexPath(uiG, hx, view, s, offX, offY);
          uiG.stroke({ width: 4, color: col, alpha: 0.95 });
        }
      }
    }
    app.renderer.render(app.stage);
  }

  // --- pointer: hover, and tap-to-select on the lay step ---------------------
  function hexAt(clientX: number, clientY: number): string | null {
    const rect = wrap.getBoundingClientRect();
    const cssW = rect.width, cssH = rect.height;
    if (cssW < 2 || cssH < 2) return null;
    const view = cam.viewFor(boardBounds(game.state, game.title), cssW, cssH);
    const sc = cssW / view.w;
    return hexAtWorld(game.state, game.title, view.x + (clientX - rect.left) / sc, view.y + (clientY - rect.top) / sc);
  }
  function onHover(e: PointerEvent) {
    if (e.buttons !== 0) {
      hover = null;
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
  let downAt: { x: number; y: number; t: number } | null = null;
  const onDown = (e: PointerEvent) => (downAt = { x: e.clientX, y: e.clientY, t: performance.now() });
  function onUp(e: PointerEvent) {
    const d = downAt;
    downAt = null;
    if (!d) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 500) return; // a drag, not a tap
    const coord = hexAt(e.clientX, e.clientY);
    if (!coord) return;
    if (layMode && legalHexes.has(coord)) take(coord);
    else if (tokenMode && tokenHexes.has(coord)) tokenSel = coord;
    else if (runMode && isStop(coord)) {
      routing.toggleStop($state.snapshot(game.state) as typeof game.state, coord);
      scheduleBake();
    }
  }

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
      app.ticker.stop();
      waveG = new PIXI.Graphics();
      uiG = new PIXI.Graphics();
      app.stage.addChild(waveG);
      app.stage.addChild(uiG);
      wrap.appendChild(canvas);
      bake();
      raf = requestAnimationFrame(frame);
      ro = new ResizeObserver(() => scheduleBake());
      ro.observe(wrap);
      unbind = cam.bind(
        wrap,
        () => boardBounds(game.state, game.title),
        () => ({ w: wrap.clientWidth, h: wrap.clientHeight }),
        () => scheduleBake()
      );
      wrap.addEventListener('pointermove', onHover);
      wrap.addEventListener('pointerleave', clearHover);
      wrap.addEventListener('pointerdown', onDown);
      wrap.addEventListener('pointerup', onUp);
    })();
    return () => {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      if (bakeReq) cancelAnimationFrame(bakeReq);
      ro?.disconnect();
      unbind?.();
      wrap?.removeEventListener('pointermove', onHover);
      wrap?.removeEventListener('pointerleave', clearHover);
      wrap?.removeEventListener('pointerdown', onDown);
      wrap?.removeEventListener('pointerup', onUp);
      app?.destroy(true, { children: true });
    };
  });
</script>

<div class="cwrap" bind:this={wrap}>
  {#if hover}
    <div class="htip" style="left:{hover.x}px; top:{hover.y}px">{hover.label}</div>
  {/if}
  {#if selected}
    <div class="laybar">
      <span class="lcost">{selected.options[selected.idx].tile}{#if selected.options[selected.idx].cost > 0} · ¥{selected.options[selected.idx].cost}{/if}</span>
      {#if selected.options.length > 1}
        <button class="lbtn" onclick={cycle} title="Next tile / rotation">⟳ next ({selected.idx + 1}/{selected.options.length})</button>
      {/if}
      <button class="lbtn ok" onclick={confirm} title="Place tile">✓ place</button>
      <button class="lbtn cancel" onclick={cancel} title="Cancel">✕</button>
    </div>
  {:else if tokenSel}
    <div class="laybar">
      <span class="lcost">token · {tokenSel}</span>
      <button class="lbtn ok" onclick={placeToken} title="Place token">✓ place token</button>
      <button class="lbtn cancel" onclick={() => (tokenSel = null)} title="Cancel">✕</button>
    </div>
  {/if}
</div>

<style>
  .cwrap {
    position: absolute;
    inset: 0;
    touch-action: none;
    cursor: grab;
  }
  .cwrap:active {
    cursor: grabbing;
  }
  .cwrap :global(canvas) {
    display: block;
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
  .laybar {
    position: absolute;
    left: 50%;
    bottom: 14px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: rgba(12, 20, 26, 0.94);
    border: 1px solid var(--line, #2c3a44);
    border-radius: 999px;
    padding: 0.3rem 0.5rem;
    z-index: 6;
  }
  .lcost {
    font: 700 0.72rem ui-monospace, monospace;
    color: #d9b25b;
    padding: 0 0.3rem;
  }
  .lbtn {
    border: 1px solid var(--line, #2c3a44);
    background: var(--bg-soft, #16242c);
    color: var(--ink, #eef3f6);
    border-radius: 999px;
    padding: 0.3rem 0.7rem;
    font: 700 0.75rem ui-sans-serif, sans-serif;
    cursor: pointer;
  }
  .lbtn.ok {
    background: #2f7d57;
    border-color: #2f7d57;
    color: #fff;
  }
  .lbtn.cancel {
    padding: 0.3rem 0.6rem;
  }
</style>
