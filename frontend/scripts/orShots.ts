/**
 * "Run bot sim" renders: play a bot-vs-bot game, then capture the board AND the
 * Entities panel at every operating-round boundary, so you can flip through how the
 * board and the players evolve OR by OR. Defaults to a 4-player 1889 game.
 *
 * How it stays exact: the game is played once with the engine; for each OR boundary
 * we load a *truncated* action log into the app (a saved session whose seats are
 * marked human, so nothing auto-plays) - the app replays the prefix and freezes on
 * that state, which we screenshot. No timing races.
 *
 * Run (from frontend/):
 *   1. start the dev server:   npm run dev
 *   2. install a browser once: npx playwright install chromium
 *   3. render:                 npm run sim:render
 *      options: npm run sim:render -- --players=4 --level=easy --max=12 --title=1889
 *
 * Uses vite-node (so it can import the engine) plus playwright.
 */
import { initialState, apply, RULES_VERSION, type GameState, type GameAction } from '$lib/engine';
import { botAction, type BotLevel } from '$lib/game/bots';
import { chromium, type Page } from 'playwright';
import { mkdir } from 'node:fs/promises';

const arg = (n: string, d: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const TITLE = arg('title', '1889');
const PLAYERS = Number(arg('players', '4'));
const LEVEL = arg('level', 'easy') as BotLevel;
const MAX = Number(arg('max', '12')); // cap how many OR boundaries to render
const URL = arg('url', 'http://localhost:5173');
const OUT = arg('out', `./screenshots/or-${TITLE}-${PLAYERS}p`);
const SEED = Number(arg('seed', '1'));

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Boundary {
  label: string;
  count: number; // action-log prefix length that lands on this OR's start
}

/** Play one bot game; record the prefix length at the start of each operating round. */
function playWithBoundaries(): { seats: { id: string; name: string }[]; actions: GameAction[]; boundaries: Boundary[] } {
  const seats = Array.from({ length: PLAYERS }, (_, i) => ({ id: `p${i + 1}`, name: `Bot ${i + 1}` }));
  let s: GameState = initialState(seats, TITLE, RULES_VERSION, { seed: SEED, mapMode: 'auto' });
  const actions: GameAction[] = [];
  const boundaries: Boundary[] = [];
  let lastTag = '';
  const note = () => {
    if (s.round === 'operating' && s.or) {
      const tag = `${s.orSet}.${s.or.orNumber}`;
      if (tag !== lastTag) {
        lastTag = tag;
        boundaries.push({ label: `OR ${tag}`, count: actions.length });
      }
    }
  };
  let steps = 0;
  while (!s.finished && steps < 6000) {
    const a = botAction(s, LEVEL);
    if (!a) break;
    s = apply(s, a as GameAction);
    actions.push(a as GameAction);
    note();
    steps += 1;
  }
  boundaries.push({ label: 'final', count: actions.length });
  return { seats, actions, boundaries };
}

async function shoot(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  // eslint-disable-next-line no-console
  console.log('  saved', `${OUT}/${name}.png`);
}

const main = async () => {
  const { seats, actions, boundaries } = playWithBoundaries();
  const picks = boundaries.slice(0, MAX);
  // eslint-disable-next-line no-console
  console.log(`${TITLE} ${PLAYERS}p ${LEVEL}: ${actions.length} actions, ${boundaries.length} OR boundaries; rendering ${picks.length}`);
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem('tp.playerName', 'SimBot'));
  const page = await ctx.newPage();
  await page.goto(URL); // establish the origin so we can seed localStorage

  for (let i = 0; i < picks.length; i++) {
    const b = picks[i];
    const code = `b${SEED}or${i}`;
    // Seats marked human (bot:false) so the loaded game freezes - no auto-play past
    // the prefix - while still showing the bot players' names/holdings.
    const session = {
      v: RULES_VERSION,
      code,
      title: TITLE,
      seed: SEED,
      mapMode: 'auto',
      seats: seats.map((s) => ({ id: s.id, name: s.name, bot: false, level: LEVEL })),
      actions: actions.slice(0, b.count),
      status: b.label,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await page.evaluate((sess) => localStorage.setItem('tp.session.' + sess.code, JSON.stringify(sess)), session);
    await page.goto(`${URL}/${TITLE}/room/${code}`);
    await page.locator('.dock').waitFor({ timeout: 15000 }).catch(() => {});
    await wait(1200); // let the map/animation settle
    const tag = `${String(i + 1).padStart(2, '0')}-${b.label.replace(/[^a-z0-9]+/gi, '')}`;

    await page.keyboard.press('Escape').catch(() => {}); // close any panel -> full board
    await wait(250);
    await shoot(page, `${tag}-board`);

    const ent = page.locator(`.dock .dbtn[aria-label="Entities"]`);
    if (await ent.count()) {
      await ent.first().click().catch(() => {});
      await wait(600);
      await shoot(page, `${tag}-entities`);
      await page.keyboard.press('Escape').catch(() => {});
    }
  }

  await browser.close();
  // eslint-disable-next-line no-console
  console.log(`\nDone. ${picks.length} OR renders (board + entities) in ${OUT}/`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
