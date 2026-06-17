/**
 * Bot self-play simulator. Runs whole games driven entirely by bots and reports
 * how long they last (steps, stock rounds, phase reached) plus the winning margin,
 * action mix, and wall-clock time. Use it to gauge game length and to sanity-check
 * that bots never stall or emit an illegal action.
 *
 * The engine and bots are deterministic, so a 1889 game is identical for a given
 * (players, level) - one run tells you its exact length. RoLA derives its map and
 * minor order from a seed, so different seeds give genuinely different games; pass
 * --games=N to sample a distribution there.
 *
 * Run (from frontend/):
 *   npm run sim                                  # default matrix
 *   npx vite-node scripts/simulate.ts -- --title=1889 --players=4 --level=easy
 *   npx vite-node scripts/simulate.ts -- --title=rola --players=4 --games=20
 *   npx vite-node scripts/simulate.ts -- --trace                 # print every game
 */

import { initialState, apply, RULES_VERSION, playerValue, type GameState, type GameAction } from '$lib/engine';
import { botAction, type BotLevel } from '$lib/game/bots';

const STEP_CAP = 8000; // a full game finishes well under this; a hit flags a stall

interface GameStats {
  title: string;
  players: number;
  level: BotLevel;
  seed: number;
  steps: number;
  finished: boolean;
  stalled: boolean; // a bot returned null / threw before the game finished
  round: string;
  phase: string;
  srCount: number;
  winnerValue: number;
  loserValue: number;
  durMs: number;
  actions: Record<string, number>;
}

function runGame(title: string, players: number, level: BotLevel, seed: number): GameStats {
  const seats = Array.from({ length: players }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
  const opts = title === 'rola' ? { seed, mapMode: 'auto' as const } : { seed };
  let s = initialState(seats, title, RULES_VERSION, opts);
  const actions: Record<string, number> = {};
  let steps = 0;
  let stalled = false;
  const t0 = performance.now();
  while (steps < STEP_CAP && !s.finished) {
    const a = botAction(s, level);
    if (!a) {
      stalled = true;
      break;
    }
    actions[a.type] = (actions[a.type] ?? 0) + 1;
    try {
      s = apply(s, a as GameAction);
    } catch (e) {
      stalled = true;
      console.error(`  ILLEGAL ACTION in ${title} ${players}p ${level} seed ${seed}:`, a, (e as Error).message);
      break;
    }
    steps += 1;
  }
  const durMs = performance.now() - t0;
  const values = s.players.map((p) => playerValue(s, p.id)).sort((x, y) => y - x);
  return {
    title,
    players,
    level,
    seed,
    steps,
    finished: s.finished,
    stalled,
    round: s.round,
    phase: s.phase,
    srCount: s.srCount,
    winnerValue: values[0] ?? 0,
    loserValue: values[values.length - 1] ?? 0,
    durMs,
    actions
  };
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const a = [...xs].sort((p, q) => p - q);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
};
const mean = (xs: number[]): number => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0);
const range = (xs: number[]): [number, number] => [Math.min(...xs), Math.max(...xs)];

function summarize(label: string, games: GameStats[], trace: boolean): void {
  const steps = games.map((g) => g.steps);
  const srs = games.map((g) => g.srCount);
  const [sMin, sMax] = range(steps);
  const finished = games.filter((g) => g.finished).length;
  const stalled = games.filter((g) => g.stalled).length;
  const phases = [...new Set(games.map((g) => g.phase))].sort();
  const margin = mean(games.map((g) => g.winnerValue - g.loserValue));
  const durs = games.map((g) => g.durMs);

  console.log(`\n${label}  (${games.length} game${games.length > 1 ? 's' : ''})`);
  console.log(
    `  steps     median ${median(steps)}  mean ${mean(steps)}  range ${sMin}-${sMax}`
  );
  console.log(`  stock rds median ${median(srs)}  mean ${mean(srs)}  range ${range(srs)[0]}-${range(srs)[1]}`);
  console.log(`  end phase ${phases.join('/')}    finished ${finished}/${games.length}${stalled ? `  STALLED ${stalled}` : ''}`);
  console.log(`  win margin (value) mean ${margin}    sim time median ${median(durs)}ms`);
  if (trace) {
    for (const g of games) {
      console.log(
        `    seed ${String(g.seed).padStart(4)}  steps ${String(g.steps).padStart(4)}  SR ${String(g.srCount).padStart(2)}  ` +
          `phase ${g.phase}  ${g.finished ? 'finished' : g.stalled ? 'STALLED@' + g.round : 'cap@' + g.round}  ` +
          `value ${g.winnerValue}/${g.loserValue}  ${Math.round(g.durMs)}ms`
      );
    }
  }
}

// --- CLI ---------------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : undefined;
};
const flag = (name: string): boolean => argv.includes(`--${name}`);

const titleArg = arg('title'); // 1889 | rola | (default: both)
const levelArg = arg('level') as BotLevel | undefined; // testing | easy | normal
const playersArg = arg('players');
const gamesArg = Number(arg('games') ?? 10); // seeds to sample for seeded titles
const trace = flag('trace');

const titles = titleArg ? [titleArg] : ['1889', 'rola'];
const levels: BotLevel[] = levelArg ? [levelArg] : ['easy', 'testing'];

console.log(`Bot self-play simulator  (rules ${RULES_VERSION}, step cap ${STEP_CAP})`);

for (const title of titles) {
  const playerCounts = playersArg
    ? [Number(playersArg)]
    : title === '1889'
      ? [2, 3, 4, 5, 6]
      : [3, 4, 5];
  // 1889 is fully deterministic (seed is ignored), so one game per config tells the
  // whole story. RoLA varies by seed, so sample several.
  const seedCount = title === 'rola' ? gamesArg : 1;
  for (const level of levels) {
    for (const players of playerCounts) {
      const games: GameStats[] = [];
      for (let i = 0; i < seedCount; i++) games.push(runGame(title, players, level, 1000 + i));
      summarize(`${title}  ${players}p  ${level}`, games, trace || seedCount === 1);
    }
  }
}
console.log('');
