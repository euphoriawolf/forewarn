// The harness around Muse Spark Open: the model, its tools, and the rules that keep it honest.
//
// 1. Tools are typed and run in code. A repeated call with the same arguments returns the first
//    result instead of running again (seen in the spike: the model sometimes asks twice).
// 2. The checker reads every number in an answer and looks for it in the tool results or the
//    question. An answer with a number from nowhere is sent back once with the list of bad numbers.
import { generateText, tool, stepCountIs, type ToolSet } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import { readForecast } from './forecast';

export interface Env { BASETEN_API_KEY: string; BASETEN_BASE_URL: string; BASETEN_MODEL: string; PlaceAgent: DurableObjectNamespace }

export function model(env: Env) {
  return createOpenAICompatible({ name: 'baseten', baseURL: env.BASETEN_BASE_URL, apiKey: env.BASETEN_API_KEY })(env.BASETEN_MODEL);
}

export const SYSTEM = `You are Forewarn. You tell people in Africa what the weather will do to their place: a street, a farm or a village.
- Before you answer anything about rain or floods, call read_forecast for the place.
- Use only numbers, days and dates that are in tool results or in the question. Never estimate a number yourself.
- Say the level as a word (unlikely, possible, likely) with its chance in words, for example "about 1 in 4 forecasts".
- The forecast is for the area around the place (blended from 28 km squares), not for one street. Say so when it matters.
- Name days by their weekday ("Thursday"), never as a date like 2026-10-29. Do not name the levels by colour.
- Plain English, short sentences, three or four at most. No em dashes.`;

// Tools for one answer. `results` collects every tool output so the checker can read them.
export function makeTools(results: unknown[]): ToolSet {
  const seen = new Map<string, unknown>();
  const once = async (name: string, args: unknown, run: () => Promise<unknown>) => {
    const key = name + JSON.stringify(args);
    if (!seen.has(key)) { const out = await run(); seen.set(key, out); results.push(out); }
    return seen.get(key);
  };
  return {
    read_forecast: tool({
      description: 'Read the 51-run ECMWF rain forecast for the next 7 days at a place, blended from the four nearest 28 km squares. Returns per day how many runs reach the flood line (the rain in a day that flooded this place last time), the middle and the wettest run, and the level.',
      inputSchema: z.object({ lat: z.number(), lon: z.number(), floodLineMm: z.number().describe('Rain in mm in one day that flooded this place last time. Use 30 if unknown.') }),
      execute: (a) => once('read_forecast', a, () => readForecast(a.lat, a.lon, a.floodLineMm)),
    }),
  };
}

// Every number in the text must appear, after rounding, in the tool results or the question.
export function checkNumbers(text: string, results: unknown[], question: string): string[] {
  const allowed = new Set<string>();
  const add = (v: number) => { allowed.add(String(v)); allowed.add(String(Math.round(v))); allowed.add(v.toFixed(1)); };
  const walk = (x: unknown) => {
    if (typeof x === 'number') add(x);
    else if (typeof x === 'string') for (const m of x.match(/\d+(?:\.\d+)?/g) ?? []) add(+m);
    else if (x && typeof x === 'object') for (const v of Object.values(x)) walk(v);
  };
  results.forEach(walk); walk(question);
  [7, 28, 51].forEach(add); // fixed facts of the method: 7 days, 28 km squares, 51 runs
  return (text.match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => !allowed.has(n) && !allowed.has(String(+n)));
}

// One question, answered with the tools and checked. Used by the HTTP test route.
export async function answer(env: Env, question: string) {
  const results: unknown[] = [];
  const base = { model: model(env), system: SYSTEM, tools: makeTools(results), stopWhen: stepCountIs(4), maxOutputTokens: 3000, providerOptions: { baseten: { reasoningEffort: 'low' } } };
  const t0 = Date.now();
  let r = await generateText({ ...base, prompt: question });
  let bad = checkNumbers(r.text, results, question), retried = false;
  if (bad.length) {
    retried = true;
    r = await generateText({ ...base, messages: [
      { role: 'user', content: question },
      ...r.response.messages,
      { role: 'user', content: `These numbers are not in the tool results: ${bad.join(', ')}. Rewrite the answer using only numbers from the tool results.` },
    ] });
    bad = checkNumbers(r.text, results, question);
  }
  return { text: r.text, ms: Date.now() - t0, toolCalls: results.length, checked: bad.length === 0, badNumbers: bad, retried, forecast: results[0] ?? null };
}
