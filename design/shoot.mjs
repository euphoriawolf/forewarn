// Shots of the design page and each phone. Needs the preview server on 8830 (forewarn-design).
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:8830/');
await page.waitForTimeout(3500);
await page.screenshot({ path: 'shots/page.png', fullPage: true });
for (const d of ['ring', 'week', 'homes']) await page.locator(`[data-dir=${d}]`).screenshot({ path: `shots/${d}.png` });
await browser.close();
console.log('done');
