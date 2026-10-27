import { chromium } from 'playwright-core';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1250, height: 900 }, deviceScaleFactor: 2 });
await p.goto('http://127.0.0.1:8830/agent-only.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(2500);
await p.screenshot({ path: 'shots/agent-only.png', fullPage: true });
await b.close(); console.log('done');
