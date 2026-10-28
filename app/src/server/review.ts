// The review page. First the alert drafts from the Watch agents: what the agent read, why it decided to
// warn, and the words, which the reviewer can edit before "Approve and send". Then the flood reports:
// every pending flood report, its photo (people already pixelated) and what Muse Spark
// read in it, with Approve and Reject. Only approved reports reach other people's maps and the agent.
import type { Report } from './reports';
import type { Draft } from './alerts';

const SOURCE: Record<string, string> = { photo: 'from the photo itself', map: 'the place on their map', gps: 'their phone location when sending', other: 'a place they searched for' };
// when the photo says it was taken; a photo older than 2 days is flagged, since it may show an older flood
const taken = (r: Report) => {
  if (!r.takenAt) return '<small>The photo carries no date.</small>';
  const days = (Date.parse(r.at) - Date.parse(r.takenAt)) / 864e5;
  return days > 2 ? `<b class="old">Taken ${esc(r.takenAt.replace('T', ' at '))}, ${Math.round(days)} days before it was sent.</b>` : `<small>Taken ${esc(r.takenAt.replace('T', ' at '))}.</small>`;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const LEVEL: Record<string, string> = { green: 'unlikely', amber: 'possible', red: 'likely' };
const alertCard = (d: Draft & { followers: number }) => {
  const r = JSON.parse(d.reading) as { level: string; when: string; chance: string; runsOverLine: number; runs: number; floodLineMm: number; middleMm: number; wettestMm: number; lineNote: string; ground: { mm: number; normalMm: number; word: string } | null };
  return `<article class="alert">
  <div><b>${esc(d.name)}</b> <small>${esc(new Date(d.at).toUTCString())}. ${d.followers === 1 ? '1 follower' : `${d.followers} followers`}.</small>
  <p class="why">${esc(d.why)}</p>
  <p><small>Flooding ${LEVEL[r.level] ?? r.level} ${/^(today|tomorrow)$/.test(r.when) ? r.when : `on ${esc(r.when)}`}: ${r.runsOverLine} of ${r.runs} forecasts reach ${r.floodLineMm} mm (middle run ${r.middleMm} mm, wettest ${r.wettestMm} mm). ${esc(r.lineNote)}${r.ground ? ` Last 30 days: ${r.ground.mm} mm against a normal ${r.ground.normalMm} mm (${esc(r.ground.word)}).` : ''}</small></p>
  <form method="post"><input type="hidden" name="kind" value="alert"><input type="hidden" name="id" value="${d.id}">
  <label>Subject<input name="subject" value="${esc(d.subject)}" maxlength="140"></label>
  <label>Alert<textarea name="body" rows="6" maxlength="2000">${esc(d.body)}</textarea></label>
  <small>Each email adds the map link, "A person at Forewarn read this alert before it was sent." and a stop link.</small>
  <p><button name="decision" value="approved">Approve and send</button> <button name="decision" value="rejected" class="no">Reject</button></p></form></div>
</article>`;
};

export function reviewPage(list: Report[], token: string, drafts: (Draft & { followers: number })[] = [], done = '') {
  const t = encodeURIComponent(token);
  const card = (r: Report) => `<article>
  <img src="/api/reports/${r.id}.jpg?token=${t}" alt="Report photo">
  <div><b>${esc(r.place)}</b> <small>${esc(new Date(r.at).toUTCString())}</small>
  <p>Water reaches ${esc(r.reaches || 'unclear')}${r.moving && r.moving !== 'unclear' ? `, moving ${esc(r.moving)}` : ''}. ${esc(r.meaning)}</p>
  <p><small>${r.waterPct}% of the photo is water. ${r.people} people pixelated. At ${r.lat.toFixed(4)}, ${r.lon.toFixed(4)}, ${esc(SOURCE[r.source] ?? 'place not stated')}.</small></p>
  <p>${taken(r)}</p>
  <form method="post"><input type="hidden" name="id" value="${r.id}">
  <button name="decision" value="approved">Approve</button> <button name="decision" value="rejected" class="no">Reject</button></form></div>
</article>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Forewarn: review</title><style>
body{margin:0;font:15px/1.5 system-ui,sans-serif;background:#f8f9f6;color:#16201b}main{max-width:760px;margin:0 auto;padding:20px 16px}
h1{font-size:24px;margin:0 0 4px}article{display:grid;grid-template-columns:240px 1fr;gap:16px;background:#fff;border:1px solid #dde2dc;border-radius:16px;padding:14px;margin-top:14px}
img{width:100%;border-radius:10px}small{color:#5d6a63}p{margin:6px 0}button{font:600 14px system-ui;border:0;border-radius:20px;padding:9px 16px;background:#1d4ed8;color:#fff;cursor:pointer}
button.no{background:#dde2dc;color:#16201b}article.alert{grid-template-columns:1fr}label{display:grid;gap:4px;font-weight:600;margin:8px 0}input,textarea{font:15px/1.5 system-ui,sans-serif;border:1px solid #c9d0c8;border-radius:10px;padding:8px 10px}.why{font-weight:600}.done{background:#e5f3ea;border-radius:12px;padding:10px 14px}h2{font-size:18px;margin:28px 0 0}.old{color:#b42318}@media(max-width:600px){article{grid-template-columns:1fr}}</style></head><body><main>
<h1>Review</h1>${done ? `<p class="done">${esc(done)}</p>` : ''}
<h2>Alerts to approve</h2><small>An approved alert goes to every confirmed follower of the area, at most 2 a day each.</small>
${drafts.length ? drafts.map(alertCard).join('') : '<p>No alert waiting.</p>'}
<h2>Flood reports</h2><small>Approved reports show on the map of anyone within 5 km for 48 hours.</small>
${list.length ? list.map(card).join('') : '<p>Nothing waiting.</p>'}
</main></body></html>`;
}
