/**
 * A tiny shared highlight channel: the Tiles panel sets a set of hex coords to
 * spotlight (on hover), and the background HexMap reads it to glow those hexes.
 * Used to verify the procedural map (where each generated terrain / laid tile is).
 */
class Highlight {
  hexes = $state<string[]>([]);
  set(hexes: string[]) {
    this.hexes = hexes;
  }
  clear() {
    this.hexes = [];
  }
}

export const highlight = new Highlight();
