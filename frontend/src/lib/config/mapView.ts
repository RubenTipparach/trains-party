/**
 * Tunable settings for the hex-map viewport: zoom limits, how far you may pan
 * past the map edge ("wiggle room"), animation timings, and the rotation step.
 *
 * These are intentionally collected in one place so the feel of the map can be
 * adjusted without hunting through HexMap.svelte. Distances expressed "in hexes"
 * are multiplied by HEX_SIZE at the call site, so they stay correct if the hex
 * geometry changes.
 */
export interface MapViewConfig {
  /** Tightest zoom-in, as a fraction of the full map width (smaller = closer). */
  minZoomFraction: number;
  /** Loosest zoom-out, as a fraction of the full map width (1 = whole map fits). */
  maxZoomFraction: number;
  /** Wiggle room past the map edge while just viewing, in hex-size units. */
  edgeMargin: number;
  /** Extra reach past the edge while laying a tile (so its fan stays on-screen). */
  layFanMargin: number;
  /** Show per-hex coordinate labels when the view is at most this many hex columns wide. */
  coordZoomHexes: number;
  /** RoLA's fixed sea frame, as a multiple of the 1889 (Shikoku) board size. */
  rolaFrameScale: number;
  /** Multiplier applied per click of the zoom in/out buttons (>1 = zoom out). */
  zoomButtonFactor: number;
  /** Multiplier applied per mouse-wheel notch (>1 = zoom out). */
  wheelZoomFactor: number;
  /** Duration (ms) of an animated zoom/recenter (buttons, fullscreen, centre-on). */
  zoomAnimMs: number;
  /** Rotation applied per press of the rotate button, in degrees. */
  rotationStepDeg: number;
  /** Duration (ms) of the rotation animation (CSS transition). */
  rotationAnimMs: number;
}

export const mapView: MapViewConfig = {
  minZoomFraction: 0.18,
  maxZoomFraction: 1,
  edgeMargin: 1.5,
  layFanMargin: 3.6,
  coordZoomHexes: 7,
  rolaFrameScale: 2,
  zoomButtonFactor: 1.25,
  wheelZoomFactor: 1.12,
  zoomAnimMs: 260,
  rotationStepDeg: 90,
  rotationAnimMs: 320
};
