// CPU profiler for the board UI. Drives a representative workload (a RoLA game
// with the map intro, bot turns, then map panning + zooming) while a Chrome CPU
// profile records, then prints the hottest functions by SELF time and the
// hottest source files, plus the FPS measured during the pan.
//
// Usage:
//   1. start the dev server:  npm run dev   (readable names; default :5173)
//   2. profile it:            npm run profile           (or: node scripts/profile.mjs [url])
//
// Requires: npx playwright install chromium
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://localhost:5173';
const SAMPLE_US = 100; // sampling interval (microseconds)
// CPU slowdown to emulate a slower device (4-6x ~= a mid-range phone). Override:
//   node scripts/profile.mjs <url> <throttle>
const THROTTLE = Number(process.argv[3] || 1);

const shortUrl = (u) => {
  if (!u) return '(native)';
  const m = u.match(/\/src\/(.*)$/) || u.match(/\/node_modules\/(.*)$/);
  return m ? m[1].split('?')[0] : u.split('/').slice(-1)[0].split('?')[0];
};

async function drive(page, ms, fn) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) await fn();
}

const main = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const client = await page.context().newCDPSession(page);
  if (THROTTLE > 1) await client.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

  // Start a RoLA auto-built game (lots of hexes = the heavy case).
  await page.goto(`${URL}/rola`);
  await page.waitForTimeout(600);
  await page.click('button.start');
  await page.waitForURL('**/room/**');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape'); // clear the panel, full map

  // Instrument per-frame timing (so we can see frames over the 16ms budget).
  await page.evaluate(() => {
    const w = window;
    w.__f = { deltas: [], last: 0, running: false };
    const tick = (t) => {
      if (!w.__f.running) return;
      if (w.__f.last) w.__f.deltas.push(t - w.__f.last);
      w.__f.last = t;
      requestAnimationFrame(tick);
    };
    w.__startFps = () => {
      w.__f = { deltas: [], last: 0, running: true };
      requestAnimationFrame(tick);
    };
    w.__stopFps = () => {
      w.__f.running = false;
      const d = w.__f.deltas.slice().sort((a, b) => a - b);
      const n = d.length || 1;
      const sum = d.reduce((s, x) => s + x, 0);
      return {
        frames: d.length,
        fps: sum > 0 ? (d.length / sum) * 1000 : 0,
        avg: sum / n,
        p95: d[Math.floor(n * 0.95)] || 0,
        max: d[n - 1] || 0,
        over16: d.filter((x) => x > 17).length, // a frame longer than ~16.7ms = dropped
        over32: d.filter((x) => x > 33).length
      };
    };
  });

  // Capture a timeline trace too, to break down the native rendering pipeline.
  const traceEvents = [];
  client.on('Tracing.dataCollected', (d) => traceEvents.push(...d.value));
  await client.send('Tracing.start', {
    transferMode: 'ReportEvents',
    categories: 'devtools.timeline,disabled-by-default-devtools.timeline'
  });

  await client.send('Profiler.enable');
  await client.send('Profiler.setSamplingInterval', { interval: SAMPLE_US });
  await client.send('Profiler.start');

  // Phase 1: idle/bots/intro animation (engine reduce + render + water).
  await page.waitForTimeout(4000);

  // Phase 2: pan the map by dragging, then zoom in/out, all under one FPS window.
  await page.evaluate(() => window.__startFps());
  const cx = 720;
  const cy = 450;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await drive(page, 3500, async () => {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      await page.mouse.move(cx + Math.cos(a) * 160, cy + Math.sin(a) * 110);
    }
  });
  await page.mouse.up();
  for (let i = 0; i < 5; i++) {
    await page.click('button[aria-label="Zoom in"]').catch(() => {});
    await page.waitForTimeout(280);
  }
  for (let i = 0; i < 5; i++) {
    await page.click('button[aria-label="Zoom out"]').catch(() => {});
    await page.waitForTimeout(280);
  }
  const fps = await page.evaluate(() => window.__stopFps());

  const { profile } = await client.send('Profiler.stop');
  await client.send('Tracing.end');
  await new Promise((r) => client.once('Tracing.tracingComplete', r));
  await browser.close();

  // --- rendering pipeline breakdown from the trace (sum of leaf event durs) ---
  // These timeline events don't nest within each other, so summing dur is a fair
  // measure of time spent per pipeline step.
  const STEP = {
    Script: ['EvaluateScript', 'FunctionCall', 'V8.Execute', 'MajorGC', 'MinorGC'],
    'Style (recalc)': ['UpdateLayoutTree', 'ParseAuthorStyleSheet', 'ScheduleStyleRecalculation'],
    Layout: ['Layout'],
    'Paint (record)': ['Paint', 'PrePaint', 'PaintImage'],
    'Raster / Decode': ['RasterTask', 'Rasterize', 'DecodeImage', 'GPUTask'],
    Composite: ['CompositeLayers', 'Commit', 'Layerize', 'UpdateLayer', 'UpdateLayerTree'],
    'Hit test': ['HitTest']
  };
  const nameToStep = {};
  for (const [step, names] of Object.entries(STEP)) for (const n of names) nameToStep[n] = step;
  const stepUs = {};
  const eventUs = {};
  for (const e of traceEvents) {
    if (e.ph !== 'X' || !e.dur) continue;
    const step = nameToStep[e.name];
    if (step) stepUs[step] = (stepUs[step] || 0) + e.dur;
    if (step || /Paint|Layout|Raster|Style|Composite|Image|Layer/.test(e.name))
      eventUs[e.name] = (eventUs[e.name] || 0) + e.dur;
  }

  // --- aggregate self time per node ---
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const selfById = new Map();
  let total = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i];
    const dt = profile.timeDeltas[i] || 0;
    selfById.set(id, (selfById.get(id) || 0) + dt);
    total += dt;
  }
  const byFn = new Map();
  const byFile = new Map();
  for (const [id, t] of selfById) {
    const n = byId.get(id);
    if (!n) continue;
    const f = n.callFrame;
    const name = f.functionName || '(anonymous)';
    const file = shortUrl(f.url);
    byFn.set(`${name}  —  ${file}:${(f.lineNumber ?? 0) + 1}`, (byFn.get(`${name}  —  ${file}:${(f.lineNumber ?? 0) + 1}`) || 0) + t);
    byFile.set(file, (byFile.get(file) || 0) + t);
  }
  const ms = (us) => (us / 1000).toFixed(1);
  const pct = (us) => ((us / total) * 100).toFixed(1);
  const top = (m, k) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);

  console.log(`\n=== CPU profile over ${ms(total)} ms total =====================`);
  console.log(
    `Frames during pan+zoom: ${fps.frames} | fps ${fps.fps.toFixed(1)} | avg ${fps.avg.toFixed(1)}ms | ` +
      `p95 ${fps.p95.toFixed(1)}ms | max ${fps.max.toFixed(1)}ms | >16ms: ${fps.over16} | >32ms (dropped): ${fps.over32}\n`
  );
  console.log('Hottest functions (self time):');
  for (const [k, t] of top(byFn, 30)) console.log(`  ${ms(t).padStart(8)} ms  ${pct(t).padStart(5)}%  ${k}`);
  console.log('\nHottest files (self time):');
  for (const [k, t] of top(byFile, 15)) console.log(`  ${ms(t).padStart(8)} ms  ${pct(t).padStart(5)}%  ${k}`);

  console.log('\nRendering pipeline (trace, time per step):');
  for (const [k, t] of [...Object.entries(stepUs)].sort((a, b) => b[1] - a[1]))
    console.log(`  ${ms(t).padStart(8)} ms  ${k}`);
  console.log('\nTop timeline events:');
  for (const [k, t] of top(new Map(Object.entries(eventUs)), 14)) console.log(`  ${ms(t).padStart(8)} ms  ${k}`);
  console.log('');
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
