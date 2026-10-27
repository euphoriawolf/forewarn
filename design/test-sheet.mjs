// Drags the chat sheet on a phone-size place page in a real (off-screen) Chrome, measures frame times
// during the drags, and shoots the three stops. Run with the app built and served on port 8843.
import { chromium } from 'playwright-core';
const b = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-position=-3000,0'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: false });
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto('http://[::1]:8843/?lat=-1.3133&lon=36.7876&name=Kibera&where=Nairobi%2C%20Kenya', { waitUntil: 'commit' });
await p.waitForSelector('.load.done', { state: 'attached', timeout: 90000 }); await p.waitForTimeout(6000);
await p.screenshot({ path: 'shots/sheet-half.png' });
const g = await (await p.$('.grab')).boundingBox(), x = g.x + g.width / 2;
async function dragTo(y0, y1, ms) {
  await p.evaluate(() => { window.__f = []; let last = performance.now(); const tick = (t) => { window.__f.push(t - last); last = t; if (window.__f.length < 400) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  await p.mouse.move(x, y0); await p.mouse.down();
  const steps = Math.round(ms / 16);
  for (let i = 1; i <= steps; i++) { await p.mouse.move(x, y0 + ((y1 - y0) * i) / steps); await p.waitForTimeout(16); }
  const nDrag = await p.evaluate(() => window.__f.length);
  await p.mouse.up(); await p.waitForTimeout(1300);
  const all = await p.evaluate(() => window.__f.slice(2));
  const show = (label, f) => console.log(`  ${label}: ${f.length} frames, average ${(f.reduce((a, b) => a + b, 0) / f.length).toFixed(1)} ms, slower than 34 ms: ${f.filter((d) => d > 34).length}, worst ${Math.max(...f).toFixed(0)} ms`);
  console.log(`drag ${y0} to ${y1}`); show('while dragging', all.slice(0, nDrag - 2)); show('sheet lands, then the camera eases', all.slice(nDrag - 2));
}
let gb = await (await p.$('.grab')).boundingBox(); await dragTo(gb.y + 10, 140, 400);
await p.screenshot({ path: 'shots/sheet-full.png' });
gb = await (await p.$('.grab')).boundingBox(); await dragTo(gb.y + 10, 760, 450);
await p.screenshot({ path: 'shots/sheet-peek.png' });
gb = await (await p.$('.grab')).boundingBox(); await dragTo(gb.y + 10, 420, 300);
await p.screenshot({ path: 'shots/sheet-back.png' });
console.log('sheet heights', await p.$eval('.sheet', (e) => e.style.height));
await b.close();
