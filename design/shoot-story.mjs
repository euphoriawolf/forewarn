import { chromium } from 'playwright-core';
const b = await chromium.launch({ channel: 'chrome', headless: true });
for (const [name, width] of [['story-desktop', 1280], ['story-phone', 390]]) {
  const p = await b.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
  await p.goto('http://127.0.0.1:8830/story.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `shots/${name}.png`, fullPage: true });
}
await b.close(); console.log('done');
