// Capture screenshots of bot-vs-bot games for visual review. Drives the dev server
// with a headless browser: makes every seat a bot, starts a game, lets the bots
// auto-play, and snapshots the board (and the Market / Spreadsheet panels) as it
// progresses. Saves PNGs to an output directory.
//
// Usage:
//   1. start the dev server:  npm run dev            (default http://localhost:5173)
//   2. install a browser once: npx playwright install chromium
//   3. capture:                npm run screenshots    (or: node scripts/screenshots.mjs)
//      options: node scripts/screenshots.mjs [url] [outDir] [titles]
//      e.g.     node scripts/screenshots.mjs http://localhost:5173 ./screenshots 1889,rola
//
// Requires the `playwright` package (a dev tool; see profile.mjs).
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL = process.argv[2] || 'http://localhost:5173';
const OUT = process.argv[3] || './screenshots';
const TITLES = (process.argv[4] || '1889,rola').split(',').map((t) => t.trim());

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(page, dir, name) {
  const path = `${dir}/${name}.png`;
  await page.screenshot({ path });
  // eslint-disable-next-line no-console
  console.log('  saved', path);
}

/** Make every seat a bot so the whole game auto-plays (seat 0 defaults to human). */
async function allSeatsBot(page) {
  const seats = page.locator('.seat');
  const n = await seats.count();
  for (let i = 0; i < n; i++) {
    const bot = seats.nth(i).getByRole('button', { name: 'Bot', exact: true });
    if ((await bot.count()) && !(await bot.getAttribute('class'))?.includes('on')) {
      await bot.click().catch(() => {});
    }
  }
}

/** Open a board panel by its tab label (Market, Spreadsheet, ...) and snapshot it. */
async function panelShot(page, dir, label, name) {
  const btn = page.locator(`.dock .dbtn[aria-label="${label}"]`);
  if (await btn.count()) {
    await btn.first().click().catch(() => {});
    await wait(700);
    await shoot(page, dir, name);
    await page.keyboard.press('Escape').catch(() => {}); // close the panel -> full board
    await wait(300);
  }
}

async function captureTitle(browser, title) {
  const dir = `${OUT}/${title}`;
  await mkdir(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Skip the "what should we call you?" modal on first load.
  await ctx.addInitScript(() => localStorage.setItem('tp.playerName', 'SimBot'));
  const page = await ctx.newPage();

  // eslint-disable-next-line no-console
  console.log(`\n${title}: starting an all-bot game`);
  await page.goto(`${URL}/${title}`);
  await page.waitForTimeout(700);
  await allSeatsBot(page);
  await page.click('button.start');
  await page.waitForURL('**/room/**', { timeout: 15000 });
  await page.keyboard.press('Escape').catch(() => {}); // clear any open panel -> full board

  // Snapshot the board as the bots play through the opening and into operating.
  const beats = [2500, 6000, 6000, 8000, 8000];
  for (let i = 0; i < beats.length; i++) {
    await wait(beats[i]);
    await page.keyboard.press('Escape').catch(() => {});
    await shoot(page, dir, `board-${String(i + 1).padStart(2, '0')}`);
  }
  // Panels: the stock market grid and the financial spreadsheet.
  await panelShot(page, dir, 'Market', 'market');
  await panelShot(page, dir, 'Spreadsheet', 'spreadsheet');

  await ctx.close();
}

const main = async () => {
  const browser = await chromium.launch();
  try {
    for (const title of TITLES) await captureTitle(browser, title);
  } finally {
    await browser.close();
  }
  // eslint-disable-next-line no-console
  console.log(`\nDone. Screenshots in ${OUT}/`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
