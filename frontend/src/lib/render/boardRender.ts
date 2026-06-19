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
import { TILES, rotatePaths, configFor } from '$lib/engine';
import type { GameState } from '$lib/engine';
import type { HexDef, TileColor } from '$lib/data/types';

/** The world-space rectangle currently shown (maps onto the canvas, preserving aspect). */
export interface BoardView {
  x: number;
  y: number;
  w: number;
  h: number;
}

const SEA_BASE = '#74c1be'; // WATER_BASE
const SEA_DEEP = '#2f6f96';

const FILL: Record<TileColor, string> = {
  white: '#e7dcbf',
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
  opts: { title: string; cssW: number; cssH: number; dpr: number; view: BoardView }
): void {
  const { title, cssW, cssH, dpr, view } = opts;
  const map: Record<string, HexDef> = state.map ?? configFor(title).hexByCoord;
  const tiles = state.tiles ?? {};

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = SEA_DEEP;
  ctx.fillRect(0, 0, cssW, cssH);

  const s = Math.min(cssW / view.w, cssH / view.h);
  const offX = (cssW - view.w * s) / 2;
  const offY = (cssH - view.h * s) / 2;
  ctx.translate(offX, offY);
  ctx.scale(s, s);
  ctx.translate(-view.x, -view.y);

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
    ctx.fillStyle = isWater ? SEA_BASE : fillOf(title, (laidDef?.color as TileColor) ?? h.color);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#4a4332';
    ctx.stroke();

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
