// Shots of verdict.html. Needs the forewarn-design preview on 8830.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:8830/verdict.html');
await page.waitForFunction(() => window.__ready); await page.waitForTimeout(1500);
await page.screenshot({ path: 'shots/verdict-page.png', fullPage: true });
const ph = page.locator('.phone'); for (let i = 0; i < await ph.count(); i++) await ph.nth(i).screenshot({ path: `shots/verdict-${i + 1}.png` });
await browser.close(); console.log('done');
