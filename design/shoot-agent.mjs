// Shots of agent.html with the March water held at its peak. Needs the forewarn-design preview on 8830.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:8830/agent.html?still');
await page.waitForFunction(() => window.__ready); await page.waitForTimeout(2500);
await page.screenshot({ path: 'shots/agent-page.png', fullPage: true });
const ph = page.locator('.phone'); for (let i = 0; i < await ph.count(); i++) await ph.nth(i).screenshot({ path: `shots/agent-${i + 1}.png` });
await browser.close(); console.log('done');
