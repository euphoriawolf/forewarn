// Adds a flood photo through the camera button on a place and shoots the result card (phone size).
import { chromium } from 'playwright-core';
const [photo = '../app/public/hero-lagos.jpg'] = process.argv.slice(2);
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto('http://[::1]:8843/?lat=-1.3133&lon=36.7876&name=Kibera&where=Nairobi%2C%20Kenya', { waitUntil: 'commit', timeout: 60000 });
await p.waitForSelector('.ask .cam', { timeout: 60000 });
await p.setInputFiles('.askbar input[type=file]', photo);
await p.waitForSelector('.note.photo img', { timeout: 90000 });
await p.waitForTimeout(800);
await p.screenshot({ path: 'shots/witness-phone.png' });
await (await p.$('.note.photo')).screenshot({ path: 'shots/witness-card.png' });
console.log(await p.$eval('.note.photo', (e) => e.innerText));
await b.close();
