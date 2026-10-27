// The harness around Muse Spark Open: the model, its tools, and the rules that keep it honest.
//
// 1. The place is fixed before the model speaks: the tools read it from the agent's state, so the
//    model cannot ask about the wrong coordinates or invent a flood line.
// 2. Tools are typed and run in code. A repeated call returns the first result instead of running
//    again (seen in the spike: the model sometimes asks twice).
// 3. The checker reads every number in an answer and looks for it in the tool results or the
//    question. An answer with a number from nowhere is sent back once with the list of bad numbers.
import { generateText, tool, stepCountIs, type ToolSet, type StreamTextTransform, type TextStreamPart } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import { readForecast, outlookWeeks } from './forecast';
import { floodLine, type FloodLine } from './place';
import { packFor, roadsCheck, nearestFlood } from './packs';
import { rainLast30 } from './rain30';

export interface Env { BASETEN_API_KEY: string; BASETEN_BASE_URL: string; BASETEN_MODEL: string; FLOOD_CHECK_API: string; AskAgent: DurableObjectNamespace; ASSETS: Fetcher; Logbook: DurableObjectNamespace; LOG_CHATS: string; LOGS_TOKEN: string; MODEL_API_KEY: string }
export interface Place { name: string; where: string; lat: number; lon: number }

export function model(env: Env) {
  return createOpenAICompatible({ name: 'baseten', baseURL: env.BASETEN_BASE_URL, apiKey: env.BASETEN_API_KEY })(env.BASETEN_MODEL);
}

// The page asks this for the person when a place opens (the same words in src/client/Chat.tsx), so
// the agent's first message is the answer.
export const OPENING = 'How does my place look for the next 14 days?';

export const system = (p: Place | null) => `You are Forewarn. You tell people in Africa what the weather will do to their place: a street, a farm or a village.
${p ? `The person's place is ${p.name}${p.where ? `, ${p.where}` : ''}. Every tool already knows it.` : 'The person has not picked a place yet. Ask them to search for it first.'}
- Before you answer anything about rain or floods, call read_forecast. When the ground matters (a flood chance, a farm, a dry spell), also call read_last_30_days: if groundSoaked is true, say plainly that soaked ground floods sooner. For questions about the last flood, call last_flood.
- Use only numbers, days and dates that are in tool results or in the question. Never estimate a number yourself.
- Water depths from last_flood are a model estimate (Flood Check), not measurements. Say "the model shows", never "measured".
- Say the level as a word (unlikely, possible, likely) with its chance in words, for example "about 1 in 4 forecasts".
- The forecast is for the area around the place (blended from 28 km squares), not for one street. Say so when it matters.
- Beyond 14 days only the weekly outlook exists: say wetter, near or drier than normal, never that it will or will not flood.
- Name days with the "when" field of each day ("today", "Thursday", or "Wednesday 4 November" beyond a week), never as 2026-10-29. Do not name the levels by colour.
${p && packFor(p.lat, p.lon) ? `- The screen shows the place in 3D. Change it with tools: show_last_flood when they ask how bad it was or what it looks like; show_nearest_flood when they ask what floods near them or where it flooded; light_roads when they ask about a road or a route; show_street_view or show_overview to move the camera; mark_day to point at a day. Say in one short sentence what the view now shows.` : '- There is no 3D view for this place yet. If they ask to see it, say that street-level 3D covers Lagos and Nairobi for now.'}
- When the question is "${OPENING}", it opens the conversation: call read_forecast and read_last_30_days, and do not move the 3D. Answer in three or four short sentences, in this shape (the numbers here are only an example): "Flooding looks unlikely here for the next 14 days. The ground is not soaked: the last 30 days brought 46 mm, close to the normal 37 mm for this time of year. The riskiest day is Thursday: about 1 in 20 forecasts bring more than 28.4 mm, more rain than the worst day of the March storm, which did not flood your spot. Further out, the weeks to 30 November look near normal. This is for the area around you, not one street." Take every number, day and the meaning of the flood line from the tool result.
- Plain English, short sentences, three or four at most. No em dashes.`;

// Tools for one answer about one place. `results` collects every tool output for the checker.
export function makeTools(env: Env, place: Place | null, results: unknown[]): ToolSet {
  const seen = new Map<string, Promise<unknown>>();
  // a failed call is not kept, so the next call tries again; its message goes to the log and the model
  const once = (name: string, run: () => Promise<unknown>) => {
    if (!seen.has(name)) seen.set(name, run().then((out) => { results.push(out); return out; }, (e: unknown) => {
      seen.delete(name);
      const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.error(`tool ${name} failed:`, message);
      return { error: 'The data service did not answer. Try again in a minute.', detail: message };
    }));
    return seen.get(name)!;
  };
  let line: Promise<FloodLine> | null = null;
  const lineOf = () => (line ??= floodLine(env.FLOOD_CHECK_API, place!.lat, place!.lon));
  const none = { error: 'No place picked yet.' };
  const pack = place ? packFor(place.lat, place.lon) : null;
  return {
    read_forecast: tool({
      description: "Read the 51-run ECMWF rain forecast for the next 14 days at the person's place, plus a weekly outlook to about a month (only wetter or drier than normal, never a flood chance), blended from the four nearest 28 km squares. Per day: how many runs reach the place's flood line, the middle and the wettest run in mm, the level and the chance in words.",
      inputSchema: z.object({}),
      execute: () => (place ? once('read_forecast', async () => {
        const l = await lineOf(), f = await readForecast(place.lat, place.lon, l.mm);
        return { floodLine: l, ...f, outlookBeyond14Days: await outlookWeeks(place.lat, place.lon, f.days.at(-1)!.day).catch(() => []) };
      }) : Promise.resolve(none)),
    }),
    show_last_flood: tool({
      description: "Play the last big storm's water on the 3D view of the person's place, hour by hour, and stop at its highest. Use for: how bad was it, what does it look like, where did it flood.",
      inputSchema: z.object({}),
      execute: async () => (pack ? { action: 'play_last_flood', lastFlood: (await lineOf()).lastFlood ?? null } : { shown: false, reason: 'No 3D view for this place yet.' }),
    }),
    light_roads: tool({
      description: 'Light named roads on the 3D view: red where water stood in the last storm, green where it stayed dry. Returns for each road how much of it had water and how deep it got.',
      inputSchema: z.object({ names: z.array(z.string()).min(1).max(4).describe('Road names as the person said them') }),
      execute: async ({ names }) => {
        if (!pack) return { shown: false, reason: 'No 3D view for this place yet.' };
        return once(`light_roads:${[...names].sort().join('|').toLowerCase()}`, async () => ({ action: 'light_roads', roads: await roadsCheck(env.ASSETS, pack, names) }));
      },
    }),
    show_nearest_flood: tool({
      description: 'Find the nearest spot to the pin where the last storm brought 10 cm of water or more, and point the 3D view at it. Use when the person asks what floods near them, or when their own spot stayed dry.',
      inputSchema: z.object({}),
      execute: () => (pack ? once('nearest', async () => { const n = await nearestFlood(env.ASSETS, pack); return n ? { action: 'show_spot', ...n } : { found: false, reason: 'No spot in this area reached 10 cm in the last storm.' }; }) : Promise.resolve({ shown: false, reason: 'No 3D view for this place yet.' })),
    }),
    show_street_view: tool({ description: 'Move the 3D camera down to street level at the pin.', inputSchema: z.object({}), execute: async () => (pack ? { action: 'street_view' } : { shown: false }) }),
    show_overview: tool({ description: 'Move the 3D camera up to see the whole area.', inputSchema: z.object({}), execute: async () => (pack ? { action: 'overview' } : { shown: false }) }),
    mark_day: tool({
      description: 'Point at one day of the 7-day forecast on the screen.',
      inputSchema: z.object({ weekday: z.string().describe('For example Thursday') }),
      execute: async ({ weekday }) => ({ action: 'mark_day', weekday }),
    }),
    read_last_30_days: tool({
      description: "How much rain fell at the person's place in the last 30 days, against normal for those days of the year (CHIRPS 1991 to 2020). Soaked ground floods sooner; on a farm, far below normal means the season is running dry.",
      inputSchema: z.object({}),
      execute: () => (place ? once('read_last_30_days', () => rainLast30(env.ASSETS, place.lat, place.lon)) : Promise.resolve(none)),
    }),
    last_flood: tool({
      description: "What the last big storm did at the person's place: how deep the water got, when, and the rain in a day that caused it. Only Lagos and Nairobi have this.",
      inputSchema: z.object({}),
      execute: () => (place ? once('last_flood', lineOf) : Promise.resolve(none)),
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

// The house style bans em dashes. The prompt asks; this makes sure, as the words stream.
export const noEmDash: StreamTextTransform<ToolSet> = () => new TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>>({
  transform(chunk, ctl) { ctl.enqueue(chunk.type === 'text-delta' ? { ...chunk, text: chunk.text.replace(/\s*\u2014\s*/g, ', ') } : chunk); },
});

export const loopOptions = { stopWhen: stepCountIs(4), maxOutputTokens: 3000, providerOptions: { baseten: { reasoningEffort: 'low' } } };

// One question about one place, answered with the tools and checked. Used by the test route.
export async function answer(env: Env, place: Place, question: string) {
  const results: unknown[] = [];
  const base = { model: model(env), system: system(place), tools: makeTools(env, place, results), ...loopOptions };
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
  return { text: r.text.replace(/\s*\u2014\s*/g, ', '), ms: Date.now() - t0, toolCalls: results.length, checked: bad.length === 0, badNumbers: bad, retried };
}
