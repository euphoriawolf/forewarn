// Watches the live opening answer: what the chat shows every half second until the answer is in.
import { chromium } from 'playwright-core';
const b = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-position=-3000,0'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
const t0 = Date.now();
await p.goto('https://forewarn.dawnstackai.com/?lat=-1.27868&lon=36.79545&name=Githunguri%20Road&where=Nairobi', { waitUntil: 'commit' });
let last = '';
for (let i = 0; i < 80; i++) {
  await p.waitForTimeout(500);
  const t = await p.evaluate(() => (document.querySelector('.chat')?.innerText ?? '(no chat yet)').replace(/\s+/g, ' ').slice(0, 110));
  if (t !== last) { console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', t); last = t; }
  if (await p.$('.suggest .chip')) break;
}
await b.close();
