/**
 * Six-frame pixel-art water for the sea behind the map.
 *
 * One tile is TILE_W x TILE_H SVG units with 2-unit "pixels". WATER_STATIC is
 * drawn on every frame (deep-water shadows); WATER_FRAMES holds one entry per
 * animation frame, each a list of [x, y, w, h, colour] pixel rectangles.
 *
 * Art rules: highlights are pure horizontal dashes that grow, drift, and
 * shrink; foam pixels float fully detached (never touching a dash, not even
 * diagonally) so the water never forms right-angle shapes.
 */

export type Px = [number, number, number, number, string];

export const TILE_W = 40;
export const TILE_H = 28;
export const WATER_BASE = '#74c1be';
/** Seconds for one full 6-frame loop (1 frame per second). */
export const WATER_LOOP_S = 6;
/** Seconds of crossfade between consecutive frames (gentle, not poppy). */
export const WATER_FADE_S = 0.45;

const LIGHT = '#9bd6d1';
const LIGHTER = '#bdeae6';
const FOAM = 'rgba(255,255,255,.55)';
const DEEP = '#5fb3ae';

export const WATER_STATIC: Px[] = [
  [10, 8, 6, 2, DEEP],
  [18, 18, 4, 2, DEEP]
];

// Three crests in a zig-zag (top-right, mid-left, bottom-right) so the tiling
// never reads as diagonal stripes. Each crest pulses mostly in place (drift of
// at most one pixel), with phase-shifted peaks and detached foam above.
export const WATER_FRAMES: Px[][] = [
  [
    [22, 4, 6, 2, LIGHT],
    [2, 14, 4, 2, LIGHTER],
    [30, 22, 6, 2, LIGHTER]
  ],
  [
    [22, 4, 8, 2, LIGHT],
    [2, 14, 4, 2, LIGHT],
    [30, 22, 8, 2, LIGHT]
  ],
  [
    [22, 4, 8, 2, LIGHTER],
    [26, 0, 2, 2, FOAM],
    [2, 14, 6, 2, LIGHT],
    [32, 22, 6, 2, LIGHTER],
    [34, 18, 2, 2, FOAM]
  ],
  [
    [24, 4, 6, 2, LIGHT],
    [2, 14, 8, 2, LIGHT],
    [32, 22, 4, 2, LIGHTER]
  ],
  [
    [24, 4, 4, 2, LIGHTER],
    [2, 14, 8, 2, LIGHTER],
    [4, 10, 2, 2, FOAM],
    [30, 22, 4, 2, LIGHTER]
  ],
  [
    [22, 4, 4, 2, LIGHT],
    [4, 14, 6, 2, LIGHT],
    [30, 22, 4, 2, LIGHTER],
    [16, 2, 2, 2, FOAM]
  ]
];

/** Each frame as an SVG data URI, for compositor-friendly CSS backgrounds. */
export function waterFrameUris(): string[] {
  return WATER_FRAMES.map((frame) => {
    const rects = [...WATER_STATIC, ...frame]
      .map(([x, y, w, h, c]) => `<rect x='${x}' y='${y}' width='${w}' height='${h}' fill='${c}'/>`)
      .join('');
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${TILE_W}' height='${TILE_H}'><rect width='${TILE_W}' height='${TILE_H}' fill='${WATER_BASE}'/>${rects}</svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  });
}
