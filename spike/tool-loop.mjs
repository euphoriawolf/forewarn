// Spike: does Muse Spark Open on Baseten run a real tool loop through the Vercel AI SDK?
// One real tool reads the live 51-run ECMWF forecast for a place and counts the runs over its
// flood line. The numbers come from code; the model only decides to call the tool and explains.
// Run: node --env-file=../.env tool-loop.mjs [stream]
import { generateText, streamText, tool, stepCountIs } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';

const baseten = createOpenAICompatible({ name: 'baseten', baseURL: process.env.BASETEN_BASE_URL, apiKey: process.env.BASETEN_API_KEY });
const model = baseten(process.env.BASETEN_MODEL);

const calls = [];
const readForecast = tool({
  description: 'Read the 51-run ECMWF rain forecast for the next 7 days at a place, and count per day how many runs reach the flood line (the 24 h rain that flooded this place last time).',
  inputSchema: z.object({
    lat: z.number().describe('Latitude'),
    lon: z.number().describe('Longitude'),
    floodLineMm: z.number().describe('Rain in mm per day that flooded this place last time'),
  }),
  execute: async ({ lat, lon, floodLineMm }) => {
    calls.push({ lat, lon, floodLineMm });
    const url = `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${lat}&longitude=${lon}&daily=precipitation_sum&models=ecmwf_ifs025&forecast_days=7&timezone=Africa%2FNairobi`;
    const d = await fetch(url).then((r) => r.json());
    const keys = Object.keys(d.daily).filter((k) => k.startsWith('precipitation_sum'));
    return d.daily.time.map((day, j) => {
      const v = keys.map((k) => d.daily[k][j] ?? 0).sort((a, b) => a - b);
      return { day, runs: v.length, runsOverLine: v.filter((x) => x >= floodLineMm).length, middleMm: +v[Math.floor(v.length / 2)].toFixed(1), wettestMm: +v.at(-1).toFixed(1) };
    });
  },
});

const system = 'You are Forewarn, a flood early-warning helper for places in Africa. Always call read_forecast before answering about rain. Use only numbers from tool results. Answer in plain English, three sentences at most.';
const prompt = 'I live in Eastleigh, Nairobi (lat -1.2847, lon 36.8608). It flooded here in March with 33 mm in a day. Will my street flood this week?';
const opts = { model, system, prompt, tools: { read_forecast: readForecast }, stopWhen: stepCountIs(4), maxOutputTokens: 3000, providerOptions: { baseten: { reasoningEffort: 'low' } } };

const t0 = Date.now();
if (process.argv[2] === 'stream') {
  const r = streamText(opts);
  let first = null, text = '';
  for await (const part of r.fullStream) {
    if (part.type === 'tool-call') console.log(`[${Date.now() - t0} ms] tool call: ${part.toolName}(${JSON.stringify(part.input)})`);
    if (part.type === 'tool-result') console.log(`[${Date.now() - t0} ms] tool result: ${JSON.stringify(part.output).slice(0, 120)}...`);
    if (part.type === 'text-delta') { if (first === null) { first = Date.now() - t0; console.log(`[${first} ms] first words`); } text += part.text; }
    if (part.type === 'error') console.log('ERROR', part.error?.message ?? part.error);
  }
  console.log(`\nANSWER (${Date.now() - t0} ms):\n${text.trim()}`);
} else {
  const r = await generateText(opts);
  console.log(`steps: ${r.steps.length}, tool calls made: ${calls.length} ${JSON.stringify(calls)}`);
  r.steps.forEach((s, i) => console.log(`  step ${i + 1}: finish=${s.finishReason}, tool calls=${s.toolCalls.length}, reasoning chars=${(s.reasoningText ?? '').length}, text chars=${s.text.length}`));
  console.log(`\nANSWER (${Date.now() - t0} ms):\n${r.text.trim()}`);
  console.log('\nusage:', JSON.stringify(r.totalUsage));
}
