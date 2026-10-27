import { chromium } from 'playwright-core';
const b = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-position=-3000,0'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const measure = async (label) => { const f = await p.evaluate(() => new Promise((res) => { const out = []; let last = performance.now(); const tick = (t) => { out.push(t - last); last = t; if (out.length < 120) requestAnimationFrame(tick); else res(out.slice(2)); }; requestAnimationFrame(tick); })); console.log(label, 'average', (f.reduce((a, b) => a + b, 0) / f.length).toFixed(1), 'ms'); };
await p.goto('http://[::1]:8843/', { waitUntil: 'commit' }); await p.waitForTimeout(4000); await measure('landing page (no 3D)');
await p.goto('http://[::1]:8843/?lat=-1.3133&lon=36.7876&name=Kibera&where=Nairobi%2C%20Kenya', { waitUntil: 'commit' });
await p.waitForSelector('.load.done', { state: 'attached', timeout: 90000 }); await p.waitForTimeout(5000); await measure('place page, 3D idle');
console.log('gl', await p.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const d = c.getExtension('WEBGL_debug_renderer_info'); return c.getParameter(d.UNMASKED_RENDERER_WEBGL); }));
await b.close();
