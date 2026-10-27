import { chromium } from 'playwright-core';
const b = await chromium.launch({ channel: 'chrome', headless: true });
for (const [name, width, height] of [['landing-desktop', 1280, 860], ['landing-phone', 390, 844]]) {
  const p = await b.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  await p.goto('http://[::1]:8843/', { waitUntil: 'commit', timeout: 60000 });
  await p.waitForTimeout(5000);
  await p.screenshot({ path: `shots/${name}-top.png` });
  await p.screenshot({ path: `shots/${name}.png`, fullPage: true });
}
await b.close(); console.log('done');
