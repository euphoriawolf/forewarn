// The review page: every pending flood report, its photo (people already pixelated) and what Muse Spark
// read in it, with Approve and Reject. Only approved reports reach other people's maps and the agent.
import type { Report } from './reports';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function reviewPage(list: Report[], token: string) {
  const t = encodeURIComponent(token);
  const card = (r: Report) => `<article>
  <img src="/api/reports/${r.id}.jpg?token=${t}" alt="Report photo">
  <div><b>${esc(r.place)}</b> <small>${esc(new Date(r.at).toUTCString())}</small>
  <p>Water reaches ${esc(r.reaches || 'unclear')}${r.moving && r.moving !== 'unclear' ? `, moving ${esc(r.moving)}` : ''}. ${esc(r.meaning)}</p>
  <p><small>${r.waterPct}% of the photo is water. ${r.people} people pixelated. At ${r.lat.toFixed(4)}, ${r.lon.toFixed(4)}.</small></p>
  <form method="post"><input type="hidden" name="id" value="${r.id}">
  <button name="decision" value="approved">Approve</button> <button name="decision" value="rejected" class="no">Reject</button></form></div>
</article>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Forewarn: review reports</title><style>
body{margin:0;font:15px/1.5 system-ui,sans-serif;background:#f8f9f6;color:#16201b}main{max-width:760px;margin:0 auto;padding:20px 16px}
h1{font-size:24px;margin:0 0 4px}article{display:grid;grid-template-columns:240px 1fr;gap:16px;background:#fff;border:1px solid #dde2dc;border-radius:16px;padding:14px;margin-top:14px}
img{width:100%;border-radius:10px}small{color:#5d6a63}p{margin:6px 0}button{font:600 14px system-ui;border:0;border-radius:20px;padding:9px 16px;background:#1d4ed8;color:#fff;cursor:pointer}
button.no{background:#dde2dc;color:#16201b}@media(max-width:600px){article{grid-template-columns:1fr}}</style></head><body><main>
<h1>Flood reports to review</h1><small>Approved reports show on the map of anyone within 5 km for 48 hours.</small>
${list.length ? list.map(card).join('') : '<p>Nothing waiting.</p>'}
</main></body></html>`;
}
