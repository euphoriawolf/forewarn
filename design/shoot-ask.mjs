// Shots of ask.html. Needs the forewarn-design preview on 8830.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:8830/ask.html');
await page.waitForFunction(() => window.__ready); await page.waitForTimeout(1200);
await page.screenshot({ path: 'shots/ask-page.png', fullPage: true });
await browser.close(); console.log('done');
