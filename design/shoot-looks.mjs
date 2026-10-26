// Shot of looks.html. Needs the forewarn-design preview on 8830.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://localhost:8830/looks.html');
await page.waitForFunction(() => window.__ready, null, { timeout: 30000 }); await page.waitForTimeout(2500);
await page.screenshot({ path: 'shots/looks-page.png', fullPage: true });
await browser.close(); console.log('done');
