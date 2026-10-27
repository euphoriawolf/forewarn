import { chromium } from 'playwright-core';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await p.goto('http://127.0.0.1:8830/og-card.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
await p.screenshot({ path: 'media/og.png' });
await b.close(); console.log('done');
