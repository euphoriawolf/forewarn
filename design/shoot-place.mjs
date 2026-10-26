// Shots of place.html in three states. Needs the forewarn-design preview on 8830.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 430, height: 880 }, deviceScaleFactor: 2 });
for (const [name, qs] of [['week', ''], ['sunday', '?day=6'], ['peak', '?day=6&peak']]) {
  await page.goto('http://localhost:8830/place.html' + qs);
  await page.waitForFunction(() => window.__ready); await page.waitForTimeout(2500);
  await page.locator('.phone').screenshot({ path: `shots/place-${name}.png` });
}
await browser.close(); console.log('done');
