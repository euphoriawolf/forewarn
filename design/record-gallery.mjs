// Records the hero gallery mockup (hero-gallery.html) as short clips: screenshots as fast as they come,
// each kept for the time it really lasted, joined by ffmpeg. Writes media/gallery-<size>.mp4.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const b = await chromium.launch({ channel: 'chrome', headless: true });
for (const [name, width, height, secs] of [['desktop', 1280, 720, 14], ['phone', 390, 760, 13]]) {
  const dir = `film-gallery/${name}`; rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const p = await b.newPage({ viewport: { width, height }, userAgent: UA });
  await p.goto('http://127.0.0.1:8830/hero-gallery.html', { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(1500);
  const t0 = Date.now(), times = [];
  for (let i = 0; Date.now() - t0 < secs * 1000; i++) { await p.screenshot({ path: `${dir}/${String(i).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 85 }); times.push(Date.now()); }
  let list = '';
  times.forEach((t, i) => { list += `file '${String(i).padStart(4, '0')}.jpg'\nduration ${((times[i + 1] ?? t + 80) - t) / 1000}\n`; });
  writeFileSync(`${dir}/list.txt`, list);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', `${dir}/list.txt`, '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '24', '-movflags', '+faststart', `media/gallery-${name}.mp4`]);
  console.log(name, times.length, 'frames,', (times.length / secs).toFixed(1), 'a second');
  await p.close();
}
await b.close();
