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
import { reportsOf } from './reports';

export interface Env { BASETEN_API_KEY: string; BASETEN_BASE_URL: string; BASETEN_MODEL: string; FLOOD_CHECK_API: string; AskAgent: DurableObjectNamespace; ASSETS: Fetcher; Logbook: DurableObjectNamespace; LOG_CHATS: string; LOGS_TOKEN: string; MODEL_API_KEY: string; Reports: DurableObjectNamespace; REVIEW_TOKEN: string;
  Watch: DurableObjectNamespace; Alerts: DurableObjectNamespace; EMAIL: SendEmail; EMAIL_FROM: string; ALERTS_REPLY_TO: string; SITE: string; ALERTS_TOKEN: string; FOLLOW_LIMIT: RateLimit }
export interface Place { name: string; where: string; lat: number; lon: number }

// The agent's model: Muse Spark Open on Baseten, or Muse Spark 1.3 on Meta's Model API (standard mode,
// so Meta does not train on what we send). The test route can ask for either, to compare them.
export type Which = 'open' | 'meta' | 'meta-min';
export function model(env: Env, which: Which = 'open') {
  if (which !== 'open') return createOpenAICompatible({ name: 'meta', baseURL: 'https://api.meta.ai/v1', apiKey: env.MODEL_API_KEY })('muse-spark-1.3');
  return createOpenAICompatible({ name: 'baseten', baseURL: env.BASETEN_BASE_URL, apiKey: env.BASETEN_API_KEY })(env.BASETEN_MODEL);
}

// The page asks this for the person when a place opens (the same words in src/client/Chat.tsx), so
// the agent's first message is the answer.
export const OPENING = 'How does my place look for the next 14 days?';
// A message that starts with this comes from the page, not from the person (after a photo, for example).
// The page hides it; the agent answers it as a reply to what the person did.
export const FROM_PAGE = '[from the page]';

export const system = (p: Place | null, today?: string) => `You are Forewarn. You tell people in Africa what the weather will do to their place: a street, a farm or a village.${today ? `\nToday is ${today}. The forecast tool keeps only 3 days: answer about those days.` : ''}
${p ? `The person's place is ${p.name}${p.where ? `, ${p.where}` : ''}. Every tool already knows it.` : 'The person has not picked a place yet. Ask them to search for it first.'}
- Before you answer anything about rain or floods, call read_forecast. When the ground matters (a flood chance, a farm, a dry spell), also call read_last_30_days: if groundSoaked is true, say plainly that soaked ground floods sooner. For questions about the last flood, call last_flood.
- Use only numbers, days and dates that are in tool results or in the question. Never estimate a number yourself.
- If a tool returns an error, say in one plain sentence which information you could not get right now, then answer with what you do have. Never guess what the missing data would have said.
- Water depths from last_flood are a model estimate (Flood Check), not measurements. Say "the model shows", never "measured".
- Say the level as a word (unlikely, possible, likely) with its chance in words, for example "about 1 in 4 forecasts".
- The forecast is for the area around the place (blended from 28 km squares). Say so only when they ask about one street or road.
- Beyond 14 days only the weekly outlook exists: say wetter, near or drier than normal, never that it will or will not flood.
- Name days with the "when" field of each day ("today", "Thursday", or "Wednesday 4 November" beyond a week), never as 2026-10-29. Do not name the levels by colour.
${p && packFor(p.lat, p.lon) ? `- The screen shows the place in 3D. Change it with tools: show_last_flood when they ask how bad it was or what it looks like; show_nearest_flood when they ask what floods near them or where it flooded; light_roads when they ask about a road or a route; show_street_view or show_overview to move the camera; mark_day to point at a day. Say in one short sentence what the view now shows.` : '- There is no 3D view for this place yet. If they ask to see it, say that street-level 3D covers Lagos and Nairobi for now.'}
- When they want alerts, call follow_area and say in one sentence that the form is on their screen and a person checks every alert before it goes out. When they want to warn family or neighbours, call read_forecast, then warn_family with the message, and say they can send it from their phone.
- When the question is "${OPENING}", it opens the conversation: call read_forecast, read_last_30_days and flood_reports, and do not move the 3D. If flood_reports has any, say first that people near them reported floodwater, using its when and distance words. Then do not call flooding unlikely: say the water is already there, and what the forecast and the ground add to it. Answer in three short sentences, in this shape (the numbers here are only an example): "Flooding looks unlikely here for the next 14 days. The riskiest day is Thursday: about 1 in 20 forecasts bring more than 28.4 mm, more than the worst day of the March storm. The ground is not soaked: 46 mm in the last 30 days, close to normal." Mention the weeks after 14 days only if they look wetter or drier than normal. Take every number, day and the meaning of the flood line from the tool result.
- A message starting with "${FROM_PAGE}" is the page telling you what the person just did; they did not write it. When it says they added a photo of floodwater, take it as fact and never say you believe them or question it. Call read_forecast and read_last_30_days, then answer in three short sentences: what the water means for them now, whether more rain is coming and whether the ground is soaked, and that they can report it with the button under their photo.
- Answer in at most three short sentences, about 60 words in all. Lead with the answer; leave out anything they did not ask about. Plain English. No em dashes, no dashes between words.`;

// Tools for one answer about one place. `results` collects every tool output for the checker.
// A forecast from the past (src/server/past.ts), for the test suite: the two reading tools answer from it.
export interface PastView { today: string; forecast: unknown; ground: unknown }

export function makeTools(env: Env, place: Place | null, results: unknown[], past?: PastView): ToolSet {
  const seen = new Map<string, Promise<unknown>>();
  // a failed call is not kept, so the next call tries again; its message goes to the log and the model
  const once = (name: string, run: () => Promise<unknown>) => {
    if (!seen.has(name)) seen.set(name, run().then((out) => { results.push(out); return out; }, (e: unknown) => {
      seen.delete(name);
      const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.error(`tool ${name} failed:`, message);
      // the reason in plain words (which service, and that it was slow), for the agent to pass on
      return { error: `${e instanceof Error && e.message.length < 120 ? e.message : 'A data service did not answer'}. Try again in a minute.`, detail: message };
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
      execute: () => (past ? once('read_forecast', async () => past.forecast) : place ? once('read_forecast', async () => {
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
    flood_reports: tool({
      description: "Flood reports from people near the person's place in the last 48 hours: photos checked by a person, with what the water reached and how far away. Empty when there are none.",
      inputSchema: z.object({}),
      execute: () => (place ? once('flood_reports', async () => {
        const all = await reportsOf(env.Reports).near(place.lat, place.lon);
        const h = (at: string) => Math.round((Date.now() - Date.parse(at)) / 3600e3);
        return { reports: all.map((r) => ({ when: h(r.at) < 1 ? 'less than an hour ago' : h(r.at) === 1 ? 'about an hour ago' : `about ${h(r.at)} hours ago`, distance: r.km < 1 ? 'less than 1 km away' : `about ${Math.round(r.km)} km away`, waterReaches: r.reaches, moving: r.moving })) };
      }) : Promise.resolve(none)),
    }),
    read_last_30_days: tool({
      description: "How much rain fell at the person's place in the last 30 days, against normal for those days of the year (CHIRPS 1991 to 2020). Soaked ground floods sooner; on a farm, far below normal means the season is running dry.",
      inputSchema: z.object({}),
      execute: () => (past ? once('read_last_30_days', async () => past.ground ?? { error: 'No rain record for those 30 days.' }) : place ? once('read_last_30_days', () => rainLast30(env.ASSETS, place.lat, place.lon)) : Promise.resolve(none)),
    }),
    follow_area: tool({
      description: "Open the form on the person's screen where they give their email to get flood alerts for this area. Use when they ask for alerts, warnings, updates or to be told when a flood is coming. The tool cannot sign them up itself.",
      inputSchema: z.object({}),
      execute: async () => ({ action: 'follow' }),
    }),
    warn_family: tool({
      description: "Put a short message on the person's screen that they can send to their family or neighbours on WhatsApp, from their own phone. Call read_forecast first and use only its numbers. Use when they want to warn or tell someone.",
      inputSchema: z.object({ message: z.string().max(400).describe('The message, in the person\'s voice, at most 60 words: the place, the risky day, the chance in words, one thing to do. No em dashes.') }),
      execute: async ({ message }) => ({ action: 'share', message: message.replace(/\s*\u2014\s*/g, ', ') }),
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
  transform(chunk, ctl) { ctl.enqueue(chunk.type === 'text-delta' ? { ...chunk, text: chunk.text.replace(/\s*\u2014\s*/g, ', ').replace(/ [-\u2013] /g, ', ') } : chunk); },
});

export const loopOptions = { stopWhen: stepCountIs(4), maxOutputTokens: 3000, providerOptions: { baseten: { reasoningEffort: 'low' }, meta: { reasoningEffort: 'low' } } };

// Follow-ups for the chips under the chat: two or three short questions that fit what was just said,
// chosen only from what Forewarn can answer, so a chip never leads nowhere. The model writes the words.
export async function followUps(env: Env, place: Place | null, asked: string[], lastAnswer: string): Promise<string[]> {
  const has3d = !!(place && packFor(place.lat, place.lon));
  const can = [
    'the rain and flood chance on a given day in the next 14 days', 'which day is riskiest', 'whether the weeks after that look wetter or drier than normal',
    'how wet the ground already is (the last 30 days against normal)', 'what to do to get ready',
    ...(has3d ? ['how bad the last big storm was here, played in 3D', 'where the nearest spot that flooded is', 'whether a named road flooded in the last storm', 'a street-level view'] : []),
    'adding a photo of floodwater where they are', 'getting flood alerts for this area by email', 'warning their family on WhatsApp',
  ];
  const r = await generateText({
    model: model(env), maxOutputTokens: 1200, providerOptions: { baseten: { reasoningEffort: 'low' } },
    prompt: `A person is using Forewarn, a flood warning app, for ${place ? place.name : 'their place'}.
Questions they already asked: ${asked.map((q) => `"${q}"`).join(', ') || 'none'}.
The last answer they got: "${lastAnswer.slice(0, 600)}"
Write 3 follow-up questions they might tap next, in their own voice, each 6 words or fewer, each about a different thing.
Pick only from what Forewarn can answer: ${can.join('; ')}.
Do not repeat a question they already asked. No numbers. One question per line, nothing else.`,
  });
  return r.text.split('\n').map((l) => l.replace(/^[\s\-*\d.)"]+|["\s]+$/g, '').trim()).filter((l) => l.length > 3 && l.length < 60 && !/\d/.test(l)).slice(0, 3);
}

// One question about one place, answered with the tools and checked. Used by the test route.
export async function answer(env: Env, place: Place, question: string, which: Which = 'open', past?: PastView) {
  const results: unknown[] = [];
  // a past forecast: only the two reading tools, so nothing reads today's data
  const all = makeTools(env, place, results, past), toolSet = past ? { read_forecast: all.read_forecast, read_last_30_days: all.read_last_30_days } : all;
  const base = { model: model(env, which), system: system(place, past?.today), tools: toolSet, ...loopOptions, ...(which === 'meta-min' ? { providerOptions: { meta: { reasoningEffort: 'minimal' } } } : {}) };
  const t0 = Date.now();
  let r = await generateText({ ...base, prompt: question, abortSignal: AbortSignal.timeout(90000) });
  const firstMs = Date.now() - t0, tools = r.steps.flatMap((st) => st.toolCalls.map((c) => c.toolName)), usage = r.totalUsage;
  let bad = checkNumbers(r.text, results, question), retried = false;
  const firstText = r.text, firstChecked = bad.length === 0;
  if (bad.length) {
    retried = true;
    r = await generateText({ ...base, abortSignal: AbortSignal.timeout(90000), messages: [
      { role: 'user', content: question },
      ...r.response.messages,
      { role: 'user', content: `(A note from the app, not the person: these numbers are not in the tool results: ${bad.join(', ')}. Write your answer to the person again without them, using only numbers from the tool results. Do not mention this note.)` },
    ] });
    bad = checkNumbers(r.text, results, question);
  }
  return { text: r.text.replace(/\s*\u2014\s*/g, ', '), ms: Date.now() - t0, firstMs, firstText, firstChecked, tools, usage, toolCalls: results.length, checked: bad.length === 0, badNumbers: bad, retried };
}
