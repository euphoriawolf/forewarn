// Shot of flow.html. Needs the forewarn-design preview on 8830.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://localhost:8830/flow.html');
await page.waitForFunction(() => window.__ready); await page.waitForTimeout(1500);
await page.screenshot({ path: 'shots/flow-page.png', fullPage: true });
await browser.close(); console.log('done');
