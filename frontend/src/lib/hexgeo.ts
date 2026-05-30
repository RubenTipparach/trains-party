/**
 * Flat-top hex geometry for the 1889 (Shikoku) map.
 *
 * Coordinates follow the reference 18xx engine (lib/engine/hex.rb): the column
 * letter maps to x (A=0, B=1, ...) and the number maps to y (number - 1). With
 * `:flat` layout the six edges point, by index:
 *   0 = S, 1 = SW, 2 = NW, 3 = N, 4 = NE, 5 = SE
 * which corresponds to screen angle `90 + 60*edge` degrees (y axis pointing down).
 *
 * Pure module: no DOM, no framework imports.
 */

export const HEX_SIZE = 44; // center-to-vertex radius R

const SQRT3 = Math.sqrt(3);
export const APOTHEM = (SQRT3 / 2) * HEX_SIZE; // center-to-edge-midpoint

export interface Point {
  x: number;
  y: number;
}

/** Parse an 1889 coordinate like "K8" into a 0-based column index and row. */
export function parseCoord(coord: string): { col: number; row: number } {
  const m = coord.match(/^([A-Za-z]+)(\d+)$/);
  if (!m) throw new Error(`bad coordinate: ${coord}`);
  const letters = m[1].toUpperCase();
  let col = 0;
  for (const ch of letters) col = col * 26 + (ch.charCodeAt(0) - 64); // A=1
  return { col: col - 1, row: parseInt(m[2], 10) };
}

/** Pixel center of a hex (before any global translation). */
export function hexCenter(coord: string): Point {
  const { col, row } = parseCoord(coord);
  const x = col * 1.5 * HEX_SIZE;
  const y = (row - 1) * APOTHEM;
  return { x, y };
}

/** The six vertices of a flat-top hex centered at (cx, cy). */
export function hexVertices(cx: number, cy: number): Point[] {
  const pts: Point[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 180) * (60 * k);
    pts.push({ x: cx + HEX_SIZE * Math.cos(a), y: cy + HEX_SIZE * Math.sin(a) });
  }
  return pts;
}

/** SVG points attribute for a flat-top hex polygon. */
export function hexPolygon(cx: number, cy: number): string {
  return hexVertices(cx, cy)
    .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(' ');
}

/** Midpoint of edge `e` (0..5) relative to a hex center at (cx, cy). */
export function edgeMidpoint(cx: number, cy: number, e: number): Point {
  const a = (Math.PI / 180) * (90 + 60 * e);
  return { x: cx + APOTHEM * Math.cos(a), y: cy + APOTHEM * Math.sin(a) };
}
