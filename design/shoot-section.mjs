// Shoots one landing section (by CSS selector) at desktop and phone size.
import { chromium } from 'playwright-core';
const [sel = '.runs'] = process.argv.slice(2);
const b = await chromium.launch({ channel: 'chrome', headless: true });
for (const [name, width] of [['desktop', 1280], ['phone', 390]]) {
  const p = await b.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
  await p.goto('http://[::1]:8843/', { waitUntil: 'commit', timeout: 60000 });
  await p.waitForSelector(sel, { timeout: 60000 }); await p.waitForTimeout(2500);
  await (await p.$(sel)).screenshot({ path: `shots/section-${name}.png` });
}
await b.close(); console.log('done');
