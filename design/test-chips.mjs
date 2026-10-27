// On the live site: waits for the agent's opening answer and its follow-up chips, asks a different
// question, and checks the chips change.
import { chromium } from 'playwright-core';
const b = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-position=-3000,0'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.goto('https://forewarn.dawnstackai.com/?lat=-1.3133&lon=36.7876&name=Kibera&where=Nairobi%2C%20Kenya', { waitUntil: 'commit' });
const chips = async () => p.$$eval('.suggest .chip', (e) => e.map((x) => x.textContent));
const waitChips = async (old) => { for (let i = 0; i < 60; i++) { await p.waitForTimeout(1000); const c = await chips(); if (c.length && JSON.stringify(c) !== JSON.stringify(old)) return c; } return chips(); };
const first = await waitChips([]);
console.log('opening:', (await p.$$eval('.bot', (e) => e.map((x) => x.textContent))).join(' ').slice(0, 300));
console.log('chips after opening:', first);
await p.fill('.ask input', 'Did Ngong Road flood in March?'); await p.press('.ask input', 'Enter');
const second = await waitChips(first);
console.log('answer:', (await p.$$eval('.bot', (e) => e.map((x) => x.textContent))).at(-1)?.slice(0, 300));
console.log('chips after that:', second);
console.log('sheet height after typing:', await p.$eval('.sheet', (e) => e.style.height));
await b.close();
