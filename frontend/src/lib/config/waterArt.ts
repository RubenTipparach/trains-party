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
/** Seconds for one full 6-frame loop. */
export const WATER_LOOP_S = 1.8;

const LIGHT = '#9bd6d1';
const LIGHTER = '#bdeae6';
const FOAM = 'rgba(255,255,255,.55)';
const DEEP = '#5fb3ae';

export const WATER_STATIC: Px[] = [
  [30, 8, 6, 2, DEEP],
  [8, 14, 6, 2, DEEP]
];

// Crest A rides row y=6, crest B row y=18, small swell C row y=24. Each grows,
// drifts right while breaking (detached foam above), then settles back.
export const WATER_FRAMES: Px[][] = [
  [
    [2, 6, 4, 2, LIGHT],
    [22, 18, 4, 2, LIGHT],
    [12, 24, 4, 2, LIGHTER]
  ],
  [
    [2, 6, 6, 2, LIGHT],
    [22, 18, 6, 2, LIGHT],
    [12, 24, 4, 2, LIGHTER]
  ],
  [
    [2, 6, 8, 2, LIGHTER],
    [22, 18, 8, 2, LIGHT],
    [14, 24, 4, 2, LIGHTER],
    [34, 2, 2, 2, FOAM]
  ],
  [
    [4, 6, 6, 2, LIGHT],
    [12, 2, 2, 2, FOAM],
    [24, 18, 6, 2, LIGHTER],
    [14, 24, 4, 2, LIGHTER]
  ],
  [
    [6, 6, 4, 2, LIGHT],
    [14, 2, 2, 2, FOAM],
    [26, 18, 4, 2, LIGHTER],
    [32, 14, 2, 2, FOAM],
    [16, 24, 4, 2, LIGHTER]
  ],
  [
    [4, 6, 4, 2, LIGHTER],
    [24, 18, 4, 2, LIGHT],
    [14, 24, 4, 2, LIGHTER],
    [4, 10, 2, 2, FOAM]
  ]
];
