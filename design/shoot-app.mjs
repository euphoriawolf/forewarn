// Phone-sized shots of the app (local by default). Usage: node shoot-app.mjs <name> "<query>" [wait ms] [base]
import { chromium } from 'playwright-core';
const [name, qs, wait = '20000', base = 'http://[::1]:8840/'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', ...(process.env.NOQUIC ? ['--disable-quic'] : [])] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto(base + qs, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(+wait);
await page.screenshot({ path: `shots/app-${name}.png` });
await page.evaluate(() => window.scrollTo(0, 520)); await page.waitForTimeout(800);
await page.screenshot({ path: `shots/app-${name}-scrolled.png` });
const info = await page.evaluate(() => ({ clock: document.querySelector('.stage .clock')?.textContent, tags: [...document.querySelectorAll('.stage .tag')].map((t) => t.textContent), wide: document.documentElement.scrollWidth }));
console.log(JSON.stringify(info));
await browser.close();
