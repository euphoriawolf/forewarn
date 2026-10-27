// Records the landing page video from the app's ?film mode, one frame at a time, so the result is
// smooth however slow the machine renders: the page's clock and animation frames are driven from here.
// Usage (the app's dev server on port 8840): node record-film.mjs [lat] [lon] [seconds]
// Writes film/frame-0000.jpg ...; encode with the ffmpeg lines in design/README.md.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [lat = '-1.31436', lon = '36.86705', secs = '14'] = process.argv.slice(2);
const FPS = 30, W = 1600, H = 900;
mkdirSync('film', { recursive: true });
const b = await chromium.launch({ channel: 'chrome', headless: process.env.HEADED !== '1', args: [...(process.env.GL ?? '').split(' ').filter(Boolean), '--window-position=-3000,0'] });
const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await p.addInitScript(() => {
  let clock = 0; const cbs = [];
  window.requestAnimationFrame = (cb) => { cbs.push(cb); return cbs.length; };
  window.cancelAnimationFrame = () => {};
  performance.now = () => clock;
  window.__step = (ms) => { clock += ms; for (const cb of cbs.splice(0)) cb(clock); };
});
await p.goto(`http://localhost:8840/?film&wait&lat=${lat}&lon=${lon}&name=film`, { waitUntil: 'domcontentloaded' });
// load: step the clock until every part of the scene is in
for (let i = 0; i < 4000 && !(await p.$('[data-ready]')); i++) { await p.evaluate(() => window.__step(33)); await p.waitForTimeout(20); }
// start the flood, and let the camera settle into the street view before the first frame
await p.evaluate(() => window.play());
for (let i = 0; i < 45; i++) await p.evaluate(() => window.__step(1000 / 30));
const n = Math.round(Number(secs) * FPS);
for (let f = 0; f < n; f++) {
  await p.evaluate(() => window.__step(1000 / 30));
  await p.screenshot({ path: `film/frame-${String(f).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 92 });
  if (f % 60 === 0) console.log('frame', f, 'of', n);
}
await b.close(); console.log('done');
