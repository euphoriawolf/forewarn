// Forewarn Worker.
//   /api/search?q=        places across Africa
//   /api/place?lat&lon    the answer for a place, computed in code: flood line, 7 days, levels
//   /api/ask?lat&lon&q=   one checked agent answer (local testing only)
//   /agents/ask-agent/<session>   the chat, over WebSocket
// Everything else is the page.
import { routeAgentRequest } from 'agents';
import { AIChatAgent } from '@cloudflare/ai-chat';
import { streamText, convertToModelMessages } from 'ai';
import { model, system, makeTools, checkNumbers, answer, loopOptions, noEmDash, type Env, type Place } from './harness';
import { readForecast, outlookWeeks } from './forecast';
import { floodLine, search } from './place';
import { packFor, nearestFlood } from './packs';
import { Logbook, stepsOf, bookOf } from './logbook';
export { Logbook };

// One chat agent per visitor session. The page sets the place in its state before the first question.
export class AskAgent extends AIChatAgent<Env, { place: Place | null }> {
  initialState = { place: null };

  async onChatMessage(onFinish: Parameters<AIChatAgent<Env>['onChatMessage']>[0], options?: Parameters<AIChatAgent<Env>['onChatMessage']>[1]) {
    const place = this.state.place, results: unknown[] = [], t0 = Date.now();
    const last = this.messages.at(-1);
    const question = last?.parts?.map((p) => ('text' in p ? p.text : '')).join(' ') ?? '';
    const result = streamText({
      model: model(this.env), system: system(place), tools: makeTools(this.env, place, results), ...loopOptions,
      messages: await convertToModelMessages(this.messages),
      abortSignal: options?.abortSignal,
      experimental_transform: noEmDash,
      onError: ({ error }) => console.error('agent stream error:', error instanceof Error ? error.message : error),
      onStepFinish: (st) => console.log('agent step:', st.finishReason, st.toolCalls.map((c) => c.toolName).join(','), st.text.length),
      onFinish: async (event) => {
        // A streamed answer cannot be unsent, so here the checker logs. Holding the final text
        // until it passes is on the plan for after Day 2.
        const bad = checkNumbers(event.text, results, question);
        if (bad.length) console.warn('checker: numbers not in tool results', bad);
        if (this.env.LOG_CHATS === '1') {
          await bookOf(this.env.Logbook).add({ at: new Date().toISOString(), session: this.name, place, question, answer: event.text, ms: Date.now() - t0, checked: bad.length === 0, badNumbers: bad, steps: stepsOf(event.steps as never) }).catch((e: unknown) => console.error('logbook:', e));
        }
        await onFinish(event as never);
      },
    });
    return result.toUIMessageStreamResponse();
  }
}

const num = (v: string | null) => (v === null || v === '' || Number.isNaN(+v) ? null : +v);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url), q = url.searchParams;
    try {
      if (url.pathname === '/api/logs') {
        // the private test log: needs the LOGS_TOKEN secret, as a Bearer header or ?token=
        const token = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? q.get('token');
        if (!env.LOGS_TOKEN || token !== env.LOGS_TOKEN) return new Response('Not found', { status: 404 });
        return Response.json(await bookOf(env.Logbook).list(Math.min(200, Number(q.get('limit') ?? 50)), q.get('session') ?? undefined));
      }
      if (url.pathname === '/api/search') {
        const text = (q.get('q') ?? '').trim();
        return Response.json(text.length < 2 ? [] : await search(text));
      }
      if (url.pathname === '/api/place' || url.pathname === '/api/ask') {
        const lat = num(q.get('lat')), lon = num(q.get('lon'));
        if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return Response.json({ error: 'Add lat and lon.' }, { status: 400 });
        if (url.pathname === '/api/ask') {
          // a test route: on the public address it would let anyone spend the model credits
          if (!['localhost', '127.0.0.1'].includes(url.hostname)) return new Response('Not found', { status: 404 });
          const text = q.get('q');
          if (!text) return Response.json({ error: 'Add q with a question.' }, { status: 400 });
          return Response.json(await answer(env, { name: q.get('name') ?? 'this place', where: '', lat, lon }, text));
        }
        const line = floodLine(env.FLOOD_CHECK_API, lat, lon), pack = packFor(lat, lon);
        const [l, forecast, nearby] = await Promise.all([line, readForecast(lat, lon, line.then((x) => x.mm)), pack ? nearestFlood(env.ASSETS, pack).catch(() => null) : null]);
        const outlook = await outlookWeeks(lat, lon, forecast.days.at(-1)!.day).catch(() => []);
        return Response.json({ floodLine: l, forecast, outlook, pack, nearby, logging: env.LOG_CHATS === '1' }, { headers: { 'Cache-Control': 'public, max-age=600' } });
      }
    } catch (e) {
      return Response.json({ error: 'Something went wrong while reading the forecast. Try again in a minute.', detail: String(e) }, { status: 502 });
    }
    return (await routeAgentRequest(req, env)) ?? new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
