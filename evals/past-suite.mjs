// The agent's test suite: the 36 past African floods with a forecast. For each flood, the agent gets the
// forecast made N days before (default 3) through the local test route (/api/ask?past=&lead=), with only
// its two reading tools, and answers "Will it flood here in the next few days?". A pass needs both:
//   1. the number checker passed (every number in the answer is in the tool results), and
//   2. the highest level word in the answer (unlikely, possible, likely) is the level code computed
//      for the riskiest day.
// Run it after every change to the harness. Usage: node evals/past-suite.mjs [lead] [model]  (dev server on 8840)
import { writeFileSync } from 'node:fs';

const LEAD = Number(process.argv[2] ?? 3), MODEL = process.argv[3] ?? 'open', Q = 'Will it flood here in the next few days?';
const WORD = { green: 'unlikely', amber: 'possible', red: 'likely' };
const { replays } = await (await fetch('http://localhost:8840/api/past')).json();
const floods = replays.filter((r) => r.leads.some((l) => l.lead === LEAD));

async function one(r) {
  const u = new URL('http://localhost:8840/api/ask');
  Object.entries({ lat: r.lat, lon: r.lon, q: Q, past: r.id, lead: LEAD, model: MODEL }).forEach(([k, v]) => u.searchParams.set(k, String(v)));
  let d; try { d = await (await fetch(u)).json(); } catch (e) { d = { error: String(e) }; }
  // the level of the riskiest day: its word must be there, and no word for a higher level
  // ("less likely", "most likely Saturday", "not yet likely" are not a level)
  const words = [...(d.text ?? '').matchAll(/(?<!\b(?:less|more|most|not|yet) )\b(unlikely|possible|likely)\b/gi)].map((m) => m[1].toLowerCase());
  const want = d.expected ? WORD[d.expected.level] : null, rank = ['unlikely', 'possible', 'likely'];
  const said = words.length ? rank[Math.max(...words.map((w) => rank.indexOf(w)))] : null;
  return { id: r.id, flood: `${r.label}, ${r.peak}`, want, said, levelOk: said === want, checked: d.checked === true, pass: said === want && d.checked === true, ms: d.ms, retried: d.retried, badNumbers: d.badNumbers, text: d.text, error: d.error };
}

// three at a time, so the suite takes minutes, not half an hour
const out = [];
for (let i = 0; i < floods.length; i += 3) out.push(...(await Promise.all(floods.slice(i, i + 3).map(one))));
for (const o of out) console.log(`${o.pass ? 'pass' : 'FAIL'}  ${o.flood.padEnd(40)} want ${String(o.want).padEnd(8)} said ${String(o.said).padEnd(8)} checker ${o.checked ? 'ok' : 'no'}${o.error ? ` error ${o.error}` : ''}`);
const pass = out.filter((o) => o.pass).length;
console.log(`\n${pass} of ${out.length} passed, ${LEAD} days before, model ${MODEL}. Level right: ${out.filter((o) => o.levelOk).length}. Checker passed: ${out.filter((o) => o.checked).length}.`);
writeFileSync(new URL(`past-suite-${LEAD}d-${MODEL}.json`, import.meta.url), JSON.stringify({ lead: LEAD, model: MODEL, question: Q, at: new Date().toISOString(), pass, of: out.length, results: out }, null, 1));
process.exit(pass === out.length ? 0 : 1);
