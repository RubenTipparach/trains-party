/**
 * Cross-component "find this on the map" channel. The entities panel sets a hex
 * to highlight (hover) or requests a pan-to (click); the background HexMap reads
 * it to draw a radiating ping and/or animate the camera there.
 */
export const locate = $state<{
  /** Hex to ping with a radiating circle (hover), or null. */
  hex: string | null;
  /** Pan/zoom request: a target hex plus a bumping sequence so repeat clicks fire. */
  panHex: string | null;
  panSeq: number;
}>({ hex: null, panHex: null, panSeq: 0 });

export function pingHex(hex: string | null) {
  locate.hex = hex;
}
export function flyToHex(hex: string) {
  locate.panHex = hex;
  locate.panSeq += 1;
}
