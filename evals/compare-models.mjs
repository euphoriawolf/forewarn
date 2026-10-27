// Side by side: the same 10 questions to Muse Spark Open (Baseten) and Muse Spark 1.3 (Meta Model API),
// through the local test route (/api/ask). Scores speed, length, the number checker, and whether the
// tools a good answer needs were called. Usage: node evals/compare-models.mjs [open] [meta] [meta-min]  (dev server on 8840)
import { writeFileSync } from 'node:fs';
const PLACES = {
  kibera: { name: 'Kibera', lat: -1.3133, lon: 36.7876 },
  lekki: { name: 'Lekki', lat: 6.4474, lon: 3.472 },
  kitui: { name: 'a farm near Kitui', lat: -1.367, lon: 38.01 },
};
const Q = [
  ['kibera', 'How does my place look for the next 14 days?', ['read_forecast', 'read_last_30_days']],
  ['kibera', 'Which day is wettest?', ['read_forecast']],
  ['kibera', 'Show me the last flood here', ['show_last_flood']],
  ['kibera', 'Did Ngong Road flood in March?', ['light_roads']],
  ['kibera', 'What floods near me?', ['show_nearest_flood']],
  ['lekki', 'Will my street flood this week?', ['read_forecast']],
  ['lekki', 'Is it safe to drive to Victoria Island on Friday?', ['read_forecast']],
  ['kitui', 'Is my farm getting enough rain this season?', ['read_last_30_days']],
  ['kitui', 'Show me my street in 3D', []],
  ['kibera', "[from the page] The person added a photo of floodwater here. Muse Spark read it: the water reaches a person's knees, moving fast.", ['read_forecast', 'read_last_30_days']],
];
const out = [];
const MODELS = process.argv.slice(2).length ? process.argv.slice(2) : ['open', 'meta'];
for (const which of MODELS) {
  for (const [pl, q, need] of Q) {
    const p = PLACES[pl], u = new URL('http://localhost:8840/api/ask');
    Object.entries({ lat: p.lat, lon: p.lon, name: p.name, q, model: which }).forEach(([k, v]) => u.searchParams.set(k, String(v)));
    const t0 = Date.now();
    let d; try { d = await (await fetch(u)).json(); } catch (e) { d = { error: String(e) }; }
    const text = d.text ?? '', words = text.split(/\s+/).filter(Boolean).length, sentences = (text.match(/[.!?](\s|$)/g) ?? []).length;
    const row = { which, place: pl, q: q.slice(0, 60), ms: Date.now() - t0, firstMs: d.firstMs, words, sentences, firstChecked: d.firstChecked, checked: d.checked, retried: d.retried,
      toolsOk: need.every((t) => (d.tools ?? []).includes(t)), tools: d.tools, dash: /\s[-–—]\s|—/.test(text), outTokens: d.usage?.outputTokens, error: d.error, text };
    out.push(row);
    console.log(`${which.padEnd(4)} ${String(row.ms).padStart(6)} ms ${String(words).padStart(3)} words ${row.firstChecked ? 'checked' : 'NUMBERS'} ${row.toolsOk ? 'tools ok' : 'TOOLS MISSED'}  ${q.slice(0, 45)}`);
  }
}
writeFileSync(new URL(`./compare-models-${MODELS.join('-')}.json`, import.meta.url), JSON.stringify(out, null, 1));
