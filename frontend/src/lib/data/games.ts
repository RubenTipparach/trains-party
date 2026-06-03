/**
 * Game catalog: the titles selectable from the main menu. Adding a new 18xx game
 * is a single entry here (plus its data/engine + a setup route once playable).
 * The menu renders straight from this list, so it stays the single source of truth.
 *
 * Record each title's rulebook / reference sources in design.md (section 10).
 */

import { DESIGNER, PUBLISHER, RULEBOOK_URL } from './g1889';

export interface GameSummary {
  /** Stable id (also the setup route segment for playable games). */
  id: string;
  /** Short title shown on the card. */
  title: string;
  /** Full name / tagline under the title. */
  subtitle: string;
  designer?: string;
  publisher: string;
  /** Player-count range, e.g. "2-6" (omitted when not yet confirmed). */
  players?: string;
  /** One or two sentence description. */
  blurb: string;
  status: 'playable' | 'coming-soon';
  /** App-relative path to the new-game setup (playable titles only). */
  path?: string;
  /** External rulebook link. */
  rulebookUrl?: string;
  /** Accent colour for the card. */
  accent: string;
}

export const GAMES: GameSummary[] = [
  {
    id: '1889',
    title: '1889',
    subtitle: 'History of Shikoku Railways',
    designer: DESIGNER,
    publisher: PUBLISHER,
    players: '2-6',
    blurb:
      'The most approachable 18xx: a compact Shikoku map, straightforward shares, and no loans or mergers. Fully playable against bots.',
    status: 'playable',
    path: '/1889',
    rulebookUrl: RULEBOOK_URL,
    accent: '#f5c542'
  },
  {
    id: 'rola',
    title: 'Railways of the Lost Atlas',
    subtitle: '18xx in a shifting landscape',
    publisher: 'Asterisk Games',
    players: '2-5',
    blurb:
      'An 18xx where minor companies launch on a linear market, operate, and merge into majors. Early access: playable against bots; human stock-round controls are being wired up.',
    status: 'playable',
    path: '/rola',
    rulebookUrl: 'https://www.asterisk-games.com/s/Railways-Rulebook-0912.pdf',
    accent: '#5fb0e6'
  }
];
