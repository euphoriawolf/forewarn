// Shots of agent.html with the March water held at its peak. Needs the forewarn-design preview on 8830.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('ERR', e.message)); page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()));
await page.goto('http://localhost:8830/agent-sat.html?still');
await page.waitForFunction(() => window.__ready, null, { timeout: 60000 }); await page.waitForTimeout(6000);
await page.screenshot({ path: 'shots/agentsat-page.png', fullPage: true });
const ph = page.locator('.phone'); for (let i = 0; i < await ph.count(); i++) await ph.nth(i).screenshot({ path: `shots/agentsat-${i + 1}.png` });
await browser.close(); console.log('done');
