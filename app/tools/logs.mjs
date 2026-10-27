// Prints the private chat log: each turn with its reasoning, tool calls and answer.
// Usage: node tools/logs.mjs [limit] [--local] [--session <id>]
// The token is read from ~/.config/forewarn/logs.token and never printed.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const base = args.includes('--local') ? 'http://localhost:8840' : 'https://forewarn.dawnstackai.com';
const limit = Number(args.find((a) => /^\d+$/.test(a)) ?? 10);
const s = args.indexOf('--session'), session = s >= 0 ? args[s + 1] : '';
const token = readFileSync(`${homedir()}/.config/forewarn/logs.token`, 'utf8').trim();
const res = await fetch(`${base}/api/logs?limit=${limit}${session ? `&session=${session}` : ''}`, { headers: { Authorization: `Bearer ${token}` } });
if (!res.ok) { console.error(`The log answered ${res.status}.`); process.exit(1); }
const turns = await res.json();
for (const t of turns.reverse()) {
  const p = t.place ? `${t.place.name} (${t.place.lat}, ${t.place.lon})` : 'no place';
  console.log(`\n=== ${t.at}  session ${t.session.slice(0, 8)}  ${p}  ${t.ms} ms  ${t.checked ? 'checked' : `NOT CHECKED: ${t.badNumbers.join(', ')}`}`);
  console.log(`Q: ${t.question}`);
  t.steps.forEach((st, i) => {
    if (st.reasoning) console.log(`  [step ${i + 1} reasoning] ${st.reasoning.replace(/\s+/g, ' ').slice(0, 1200)}`);
    for (const c of st.tools) console.log(`  [step ${i + 1} tool] ${c.name}(${JSON.stringify(c.input)}) -> ${String(JSON.stringify(c.output ?? null)).slice(0, 300)}`);
  });
  console.log(`A: ${t.answer}`);
}
