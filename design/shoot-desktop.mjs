// Shots of desktop.html in two views. Needs the forewarn-design preview on 8830.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('ERR', e.message));
for (const v of ['overview', 'march']) {
  await page.goto(`http://localhost:8830/desktop.html?still&v=${v}`);
  await page.waitForFunction(() => window.__ready, null, { timeout: 60000 }); await page.waitForTimeout(4000);
  await page.screenshot({ path: `shots/desktop-${v}.png` });
}
await browser.close(); console.log('done');
