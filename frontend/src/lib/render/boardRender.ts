/**
 * Canvas 2D board renderer (Stage 1 of the SVG -> canvas migration).
 *
 * A PURE, framework-free draw routine: given a 2D context, the game state, and a
 * view rectangle (world units), it paints the whole board in one imperative pass -
 * no DOM nodes, no Svelte reactivity, no per-element diffing. That is the point: the
 * SVG board (HexMap.svelte) re-diffs ~1-3k nodes and re-runs dozens of reactive
 * computations on every state poll, which janks; a single canvas repaint per change
 * (or per animation frame) sidesteps all of it.
 *
 * Geometry, colours, track curves, centre/token/label placement and fonts mirror
 * HexMap.svelte exactly so the two render identically (verified by screenshot).
 *
 * Not yet ported here (later stages, where the SVG still covers them): animated
 * water + coastlines + ground texture/skylines, route highlight stripes, the
 * lay-fan / build-preview UI, pings, board rotation, and suburbs.
 */
import { HEX_SIZE, APOTHEM, hexCenter, hexVertices, edgeMidpoint } from '$lib/hexgeo';
import { TILES, rotatePaths, configFor, neighbor } from '$lib/engine';
import type { GameState } from '$lib/engine';
import type { HexDef, TileColor } from '$lib/data/types';
import { WATER_BASE, WATER_STATIC, WATER_FRAMES, TILE_W, TILE_H } from '$lib/config/waterArt';

/** The world-space rectangle currently shown (maps onto the canvas, preserving aspect). */
export interface BoardView {
  x: number;
  y: number;
  w: number;
  h: number;
}

const SEA_BASE = WATER_BASE; // teal shallow used for lake hexes
const SEA_DEEP = '#1b6075'; // deep base behind the pixel-art sea (matches HexMap)

// One pixel-art water tile (base + always-on deep shadows + a representative
// highlight/foam frame), baked once to an offscreen canvas and tiled as a
// repeating pattern for the sea. Mirrors HexMap's WATER_BASE/STATIC/FRAMES art.
let seaTile: HTMLCanvasElement | null = null;
function seaTileCanvas(): HTMLCanvasElement | null {
  if (seaTile) return seaTile;
  if (typeof document === 'undefined') return null;
  const PXS = 3; // render the tile at 3x so it upscales crisply
  const cv = document.createElement('canvas');
  cv.width = TILE_W * PXS;
  cv.height = TILE_H * PXS;
  const c = cv.getContext('2d');
  if (!c) return null;
  c.scale(PXS, PXS);
  c.fillStyle = WATER_BASE;
  c.fillRect(0, 0, TILE_W, TILE_H);
  for (const [x, y, w, h, col] of [...WATER_STATIC, ...WATER_FRAMES[2]]) {
    c.fillStyle = col;
    c.fillRect(x, y, w, h);
  }
  seaTile = cv;
  return cv;
}

const HALO_R = 1.7 * HEX_SIZE; // shallow teal reach from a coastal land hex centre

/** Stable per-coordinate hash (matches HexMap.segRand) for wave phase/speed. */
function segRand(x: number, y: number, salt: number): number {
  let h = (Math.round(x) * 374761393 + Math.round(y) * 668265263 + salt * 974711) >>> 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

export interface WaveEdge {
  x1: number; y1: number; x2: number; y2: number; // shore edge (padded), world coords
  ox: number; oy: number; // bordering ocean-hex centre (wave origin)
  phase: number; speed: number;
}
export interface Coast {
  halos: { cx: number; cy: number }[];
  waves: WaveEdge[];
  coastalLand: Set<string>;
}

// Coast (halos + shore-wave edges) only changes when the map/coastline changes, so
// memoize on a cheap signature rather than recompute every animation frame.
let coastMemo: { key: string; coast: Coast } | null = null;
/** Sea-facing edges of the placed map: a teal halo per coastal hex centre, and a
 *  wave edge (with the ocean-hex centre beyond it) per sea-facing edge. Mirrors the
 *  SVG board's coast derivation so all renderers share one coastline. */
export function computeCoast(state: GameState, title: string): Coast {
  const map: Record<string, HexDef> = state.map ?? configFor(title).hexByCoord;
  const key = `${title}|${Object.keys(map).length}`;
  if (coastMemo && coastMemo.key === key) return coastMemo.coast;
  const halos: { cx: number; cy: number }[] = [];
  const waves: WaveEdge[] = [];
  const coastalLand = new Set<string>();
  for (const h of Object.values(map)) {
    const { x: cx, y: cy } = hexCenter(h.coord);
    const verts = hexVertices(cx, cy);
    let coastal = false;
    for (let e = 0; e < 6; e++) {
      if (neighbor(map, h.coord, e)) continue; // a placed land neighbour: not sea-facing
      coastal = true;
      const v1 = verts[(e + 1) % 6];
      const v2 = verts[(e + 2) % 6];
      const em = edgeMidpoint(cx, cy, e);
      const ox = 2 * em.x - cx; // ocean-hex centre beyond this edge
      const oy = 2 * em.y - cy;
      const mx = (v1.x + v2.x) / 2;
      const my = (v1.y + v2.y) / 2;
      const PADF = 0.14; // pull endpoints toward the midpoint so waves never touch at corners
      waves.push({
        x1: v1.x + (mx - v1.x) * PADF,
        y1: v1.y + (my - v1.y) * PADF,
        x2: v2.x + (mx - v2.x) * PADF,
        y2: v2.y + (my - v2.y) * PADF,
        ox,
        oy,
        phase: segRand(mx, my, 1),
        speed: 6 + 4 * segRand(mx, my, 2)
      });
    }
    if (coastal) {
      halos.push({ cx, cy });
      coastalLand.add(h.coord);
    }
  }
  const coast: Coast = { halos, waves, coastalLand };
  coastMemo = { key, coast };
  return coast;
}

/** Scale (0.5 -> 1) and foam opacity for wave `w` at time `t` (seconds), offset by
 *  `lead` (0 or 0.5 -> two waves per edge half a cycle apart). Shared by all renderers
 *  so the surf is identical. */
export function waveParams(w: WaveEdge, t: number, lead: number): { scale: number; alpha: number } {
  const p = (((t / w.speed) + w.phase + lead) % 1 + 1) % 1;
  const scale = 0.5 + 0.5 * p;
  let alpha: number;
  if (p < 0.3) alpha = (p / 0.3) * 0.55;
  else if (p < 0.75) alpha = 0.55 + ((p - 0.3) / 0.45) * (0.5 - 0.55);
  else alpha = 0.5 * (1 - (p - 0.75) / 0.25);
  return { scale, alpha: Math.max(0, alpha) };
}

/** Draw the shore foam for the current time into a world-space context (board scale
 *  `s`, so the stroke/dash stay ~constant on screen). Shared with the canvas board;
 *  the WebGL board mirrors this with PixiJS Graphics. */
function drawWaves(ctx: CanvasRenderingContext2D, waves: WaveEdge[], t: number, s: number): void {
  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineWidth = 2.3 / s;
  ctx.setLineDash([8 / s, 6 / s]);
  for (const w of waves) {
    for (const lead of [0, 0.5]) {
      const { scale, alpha } = waveParams(w, t, lead);
      if (alpha <= 0.01) continue;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(w.ox + (w.x1 - w.ox) * scale, w.oy + (w.y1 - w.oy) * scale);
      ctx.lineTo(w.ox + (w.x2 - w.ox) * scale, w.oy + (w.y2 - w.oy) * scale);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** The hex coordinate at world point (wx, wy), or null if the point is off the board
 *  (in the sea). Nearest hex centre within a hex radius - exact enough for hover/click
 *  hit-testing on the tiled board. */
export function hexAtWorld(state: GameState, title: string, wx: number, wy: number): string | null {
  const map: Record<string, HexDef> = state.map ?? configFor(title).hexByCoord;
  let best: string | null = null;
  let bestD = Infinity;
  for (const h of Object.values(map)) {
    const c = hexCenter(h.coord);
    const d = (c.x - wx) ** 2 + (c.y - wy) ** 2;
    if (d < bestD) {
      bestD = d;
      best = h.coord;
    }
  }
  return best && bestD <= HEX_SIZE * HEX_SIZE ? best : null;
}

/** The world -> screen fit drawBoard uses (contain, centred), so overlays (e.g. the
 *  WebGL wave layer) can map world coords to screen identically. */
export function boardTransform(view: BoardView, cssW: number, cssH: number): { s: number; offX: number; offY: number } {
  const s = Math.min(cssW / view.w, cssH / view.h);
  return { s, offX: (cssW - view.w * s) / 2, offY: (cssH - view.h * s) / 2 };
}


const FILL: Record<TileColor, string> = {
  white: '#cdcb92',
  yellow: '#f3cf3e',
  green: '#7cc36b',
  brown: '#c69b66',
  gray: '#aeb7bb',
  red: '#df6a5c',
  blue: '#86c5e0'
};
const OFFBOARD_TIER: Record<string, string> = { yellow: '#8a6b18', brown: '#5a3a1b', diesel: '#222' };
const STAR_PTS = [
  [0, -8], [2, -2.75], [7.61, -2.47], [3.23, 1.05], [4.7, 6.47],
  [0, 3.4], [-4.7, 6.47], [-3.23, 1.05], [-7.61, -2.47], [-2, -2.75]
];

const fillOf = (title: string, c: TileColor) => (title === 'rola' && c === 'brown' ? '#9b6fb0' : FILL[c]);

/** Deterministic per-hex RNG (matches HexMap.rngFor) for mountain peak jitter. */
function rngFor(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function peaks(coord: string): Array<{ x: number; s: number }> {
  const r = rngFor(coord + 'm');
  return [
    { x: -17 + r() * 2, s: 9 + r() * 3 },
    { x: 3 + r() * 4, s: 9 + r() * 3 },
    { x: -9 + r() * 3, s: 14 + r() * 4 }
  ];
}
function slotCenters(n: number): number[] {
  if (n <= 1) return [0];
  if (n === 2) return [-14, 14];
  if (n === 3) return [-18, 0, 18];
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * 18);
}

/** Grass tufts on an inland plain-land hex (matches HexMap.grassTufts). */
function grassTufts(coord: string): Array<{ x: number; y: number; s: number }> {
  const r = rngFor(coord + 'g');
  const out: Array<{ x: number; y: number; s: number }> = [];
  for (let i = 0; i < 7; i++) {
    const ang = r() * Math.PI * 2;
    const dist = Math.sqrt(r()) * (APOTHEM - 8);
    out.push({ x: Math.cos(ang) * dist, y: Math.sin(ang) * dist - 1, s: 2.6 + r() * 1.8 });
  }
  return out;
}
/** Sand speckle on a coastal plain-land hex (matches HexMap.sandDots). */
function sandDots(coord: string): Array<{ x: number; y: number; r: number }> {
  const r = rngFor(coord + 's');
  const out: Array<{ x: number; y: number; r: number }> = [];
  for (let i = 0; i < 9; i++) {
    const ang = r() * Math.PI * 2;
    const dist = Math.sqrt(r()) * (APOTHEM - 6);
    out.push({ x: Math.cos(ang) * dist, y: Math.sin(ang) * dist, r: 0.7 + r() * 0.9 });
  }
  return out;
}
// A track end: a hex edge (0..5) or the centre. Base hex paths spell the centre
// 'center'; laid-tile paths spell it 'c'. Treat both the same.
type End = number | 'center' | 'c';
type Seg = { a: End; b: End };
const isCentre = (e: End) => e === 'center' || e === 'c';
const endPoint = (e: End) => (isCentre(e) ? { x: 0, y: 0 } : edgeMidpoint(0, 0, e as number));

function tracePath(ctx: CanvasRenderingContext2D, p: Seg): void {
  const a = endPoint(p.a);
  const b = endPoint(p.b);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  if (isCentre(p.a) || isCentre(p.b)) ctx.lineTo(b.x, b.y);
  else ctx.quadraticCurveTo(0, 0, b.x, b.y);
}

/** Draw one tile's track (sleeper ties under a solid rail), clipped to the hex. */
function drawTrack(ctx: CanvasRenderingContext2D, paths: readonly Seg[]): void {
  ctx.save();
  // clip to hex
  const v = hexVertices(0, 0);
  ctx.beginPath();
  v.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
  ctx.closePath();
  ctx.clip();
  for (const p of paths) {
    ctx.strokeStyle = '#111';
    ctx.lineCap = 'butt';
    ctx.lineWidth = 9;
    ctx.setLineDash([2, 5]);
    tracePath(ctx, p);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
    ctx.lineWidth = 3.4;
    tracePath(ctx, p);
    ctx.stroke();
  }
  ctx.restore();
}

/** Centred text with a halo (mirrors SVG paint-order:stroke). */
function haloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  fill: string,
  stroke: string,
  strokeW: number
): void {
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  if (strokeW > 0) {
    ctx.lineWidth = strokeW;
    ctx.strokeStyle = stroke;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function star(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  STAR_PTS.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = '#f5c542';
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = '#1c2a36';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function drawCity(ctx: CanvasRenderingContext2D, slots: number, capital: boolean): void {
  for (const cx of slotCenters(slots)) {
    ctx.beginPath();
    ctx.arc(cx, 0, 13, 0, Math.PI * 2);
    ctx.fillStyle = '#fbfbf7';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#2b2b2b';
    ctx.stroke();
  }
  if (capital) star(ctx);
}
function drawTown(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.rotate((30 * Math.PI) / 180);
  ctx.beginPath();
  const r = 2;
  // rounded rect -9,-4 18x8
  ctx.roundRect ? ctx.roundRect(-9, -4, 18, 8, r) : ctx.rect(-9, -4, 18, 8);
  ctx.fillStyle = '#1b1b1b';
  ctx.fill();
  ctx.restore();
}
function drawToken(ctx: CanvasRenderingContext2D, dx: number, color: string, sym: string, faded = false): void {
  ctx.save();
  ctx.translate(dx, 0);
  ctx.globalAlpha = faded ? 0.5 : 1;
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.font = '700 8px ui-sans-serif, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText(sym, 0, 0.5);
  ctx.restore();
}

/** Paint the whole board into `ctx`. `cssW/cssH` are CSS pixels; `dpr` the device ratio. */
export function drawBoard(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  opts: { title: string; cssW: number; cssH: number; dpr: number; view: BoardView; time?: number }
): void {
  const { title, cssW, cssH, dpr, view, time } = opts;
  const map: Record<string, HexDef> = state.map ?? configFor(title).hexByCoord;
  const tiles = state.tiles ?? {};
  const coast = computeCoast(state, title);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.imageSmoothingEnabled = false; // keep the pixel-art water crisp when upscaled
  ctx.fillStyle = SEA_DEEP;
  ctx.fillRect(0, 0, cssW, cssH); // also covers any letterbox bars

  const s = Math.min(cssW / view.w, cssH / view.h);
  const offX = (cssW - view.w * s) / 2;
  const offY = (cssH - view.h * s) / 2;
  ctx.translate(offX, offY);
  ctx.scale(s, s);
  ctx.translate(-view.x, -view.y);

  // Deep sea base, then a teal shallow halo glowing out from every coastal hex
  // (lighten compositing so overlapping halos clamp instead of brightening).
  ctx.fillStyle = SEA_DEEP;
  ctx.fillRect(view.x, view.y, view.w, view.h);
  ctx.save();
  ctx.globalCompositeOperation = 'lighten';
  for (const hl of coast.halos) {
    const g = ctx.createRadialGradient(hl.cx, hl.cy, 0, hl.cx, hl.cy, HALO_R);
    g.addColorStop(0, 'rgba(116,193,190,0.9)');
    g.addColorStop(0.52, 'rgba(116,193,190,0.9)');
    g.addColorStop(1, 'rgba(116,193,190,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(hl.cx, hl.cy, HALO_R, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Shore waves: each spawns at its ocean-hex centre and grows to the shore edge.
  // Only when a time is supplied (the animated render loop); the static bake omits
  // them (the WebGL renderer draws them as a separate GPU layer instead).
  if (time != null) drawWaves(ctx, coast.waves, time, s);

  // tokens (live), keyed by hex
  const tokensByHex = new Map<string, { sym: string; color: string }[]>();
  for (const c of state.corporations) {
    for (const h of c.tokenHexes) {
      if (!tokensByHex.has(h)) tokensByHex.set(h, []);
      tokensByHex.get(h)!.push({ sym: c.sym, color: c.color });
    }
  }
  const homeReserved = new Map<string, { sym: string; color: string }>();
  for (const c of state.corporations) {
    if (!c.coordinates || c.dissolved || c.tokenHexes.length) continue;
    if (!tokensByHex.has(c.coordinates)) homeReserved.set(c.coordinates, { sym: c.sym, color: c.color });
  }

  // The classic pixel-art water, for lake/river hexes (not the open sea).
  const seaTileC = seaTileCanvas();
  const seaPat = seaTileC ? ctx.createPattern(seaTileC, 'repeat') : null;
  if (seaPat && typeof DOMMatrix !== 'undefined') {
    seaPat.setTransform(new DOMMatrix().scale(TILE_W / seaTileC!.width, TILE_H / seaTileC!.height));
  }

  for (const h of Object.values(map)) {
    const { x: cx, y: cy } = hexCenter(h.coord);
    const laid = tiles[h.coord];
    const laidDef = laid ? TILES[laid.id] : null;
    const isWater = (h.terrain ?? []).includes('water') && !(h.terrain ?? []).includes('mountain');

    ctx.save();
    ctx.translate(cx, cy);

    // hex fill + outline
    const v = hexVertices(0, 0);
    ctx.beginPath();
    v.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
    ctx.closePath();
    const centre = (h.cities?.length ?? 0) > 0 || (h.towns?.length ?? 0) > 0 || !!h.offboard;
    const plainLand = !isWater && !laid && !centre && !(h.terrain ?? []).includes('mountain') && h.color === 'white';
    const coastal = coast.coastalLand.has(h.coord);
    if (isWater && seaPat) ctx.fillStyle = seaPat;
    else if (plainLand && coastal) ctx.fillStyle = '#e3d6a4';
    else ctx.fillStyle = isWater ? SEA_BASE : fillOf(title, (laidDef?.color as TileColor) ?? h.color);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#4a4332';
    ctx.stroke();

    // Catan-style ground texture on plain land: grass tufts inland, sand speckle on
    // the coast (matches the SVG board so the renderers read alike).
    if (plainLand) {
      if (coastal) {
        ctx.fillStyle = '#cdba81';
        for (const d of sandDots(h.coord)) {
          ctx.beginPath();
          ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.strokeStyle = '#9aa867';
        ctx.lineWidth = 1.1;
        ctx.lineCap = 'round';
        for (const g of grassTufts(h.coord)) {
          ctx.beginPath();
          ctx.moveTo(g.x - g.s, g.y);
          ctx.quadraticCurveTo(g.x - g.s + g.s * 0.5, g.y - g.s * 1.4, g.x, g.y);
          ctx.moveTo(g.x - g.s * 0.3, g.y);
          ctx.quadraticCurveTo(g.x - g.s * 0.3 + g.s * 0.4, g.y - g.s * 1.1, g.x + g.s * 0.5, g.y);
          ctx.stroke();
        }
      }
    }

    // mountains
    if ((h.terrain ?? []).includes('mountain')) {
      for (const pk of peaks(h.coord)) {
        const ax = pk.x + pk.s / 2;
        const ay = 14 - pk.s;
        ctx.beginPath();
        ctx.moveTo(pk.x, 14);
        ctx.lineTo(ax, ay);
        ctx.lineTo(pk.x + pk.s, 14);
        ctx.closePath();
        ctx.fillStyle = '#9c8861';
        ctx.fill();
        ctx.lineWidth = 0.9;
        ctx.strokeStyle = '#4a4030';
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(pk.x + pk.s, 14);
        ctx.lineTo(ax, 14);
        ctx.closePath();
        ctx.fillStyle = '#6f5d3c';
        ctx.fill();
        // snow cap
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - pk.s * 0.21, ay + pk.s * 0.42);
        ctx.lineTo(ax - pk.s * 0.1, ay + pk.s * 0.36);
        ctx.lineTo(ax - pk.s * 0.05, ay + pk.s * 0.46);
        ctx.lineTo(ax, ay + pk.s * 0.34);
        ctx.lineTo(ax + pk.s * 0.05, ay + pk.s * 0.46);
        ctx.lineTo(ax + pk.s * 0.1, ay + pk.s * 0.36);
        ctx.lineTo(ax + pk.s * 0.21, ay + pk.s * 0.42);
        ctx.closePath();
        ctx.fillStyle = '#f7f5ef';
        ctx.fill();
      }
    }

    // track: preprinted base paths, then the laid tile's paths
    if (h.paths?.length) drawTrack(ctx, h.paths);
    if (laidDef) drawTrack(ctx, rotatePaths(laidDef, laid!.rotation));

    // centres + revenue
    const def = laidDef;
    if (def && def.cities > 0) {
      drawCity(ctx, def.slots ?? 1, !!h.cities?.[0]?.capital);
      if (def.revenue > 0) haloText(ctx, String(def.revenue), 0, -19, '700 11px ui-sans-serif, sans-serif', '#1b1b1b', '#fff', 3);
    } else if (def && def.towns > 0) {
      drawTown(ctx);
      if (def.revenue > 0) haloText(ctx, String(def.revenue), 0, -15, '700 11px ui-sans-serif, sans-serif', '#1b1b1b', '#fff', 3);
    } else if (!laid) {
      for (const t of h.towns ?? []) {
        drawTown(ctx);
        if (t.revenue > 0) haloText(ctx, String(t.revenue), 0, -15, '700 11px ui-sans-serif, sans-serif', '#1b1b1b', '#fff', 3);
      }
      for (const c of h.cities ?? []) {
        drawCity(ctx, c.slots, !!c.capital);
        if (c.revenue > 0) haloText(ctx, String(c.revenue), 0, -19, '700 11px ui-sans-serif, sans-serif', '#1b1b1b', '#fff', 3);
      }
      if (h.offboard) {
        const tiers = Object.entries(h.offboard.revenue);
        tiers.forEach(([tier, val], i) =>
          haloText(ctx, String(val), 0, i * 13 - 6, '700 11px ui-sans-serif, sans-serif', OFFBOARD_TIER[tier] ?? '#333', '#fff', 2.5)
        );
      }
    }

    // labels
    if (h.upgradeCost && !laid) {
      haloText(ctx, String(h.upgradeCost), -HEX_SIZE * 0.42, -APOTHEM + 16, '700 7px ui-sans-serif, sans-serif', '#6d3f12', 'rgba(243,238,222,0.8)', 1.6);
    }
    if (laidDef?.label && laidDef.label !== 'C') {
      haloText(ctx, laidDef.label, HEX_SIZE * 0.42, -APOTHEM + 16, '700 12px ui-sans-serif, sans-serif', '#1b1b1b', '#fff', 2.5);
    }
    if (h.name) {
      haloText(ctx, h.name, 0, APOTHEM - 6, '600 9px ui-sans-serif, sans-serif', '#1c2a36', '#e9e6c4', 2.5);
    }

    // tokens (and reserved-home ghosts)
    const toks = tokensByHex.get(h.coord) ?? [];
    if (toks.length) {
      const slots = slotCenters(Math.max(def?.slots ?? h.cities?.[0]?.slots ?? 1, toks.length));
      toks.forEach((t, i) => drawToken(ctx, slots[i] ?? 0, t.color, t.sym));
    } else if (homeReserved.has(h.coord)) {
      const hr = homeReserved.get(h.coord)!;
      drawToken(ctx, 0, hr.color, hr.sym, true);
    }

    ctx.restore();
  }
}

/** The world-space bounding rectangle of a board's hexes (+ a one-hex margin). */
export function boardBounds(state: GameState, title: string): BoardView {
  const map: Record<string, HexDef> = state.map ?? configFor(title).hexByCoord;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const h of Object.values(map)) {
    const { x, y } = hexCenter(h.coord);
    minX = Math.min(minX, x - HEX_SIZE);
    maxX = Math.max(maxX, x + HEX_SIZE);
    minY = Math.min(minY, y - APOTHEM);
    maxY = Math.max(maxY, y + APOTHEM);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 100, h: 100 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
