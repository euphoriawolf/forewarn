// Forewarn Worker.
//   /api/search?q=        places across Africa
//   /api/place?lat&lon    the answer for a place, computed in code: flood line, 7 days, levels
//   /api/ask?lat&lon&q=   one checked agent answer (local testing only)
//   /agents/ask-agent/<session>   the chat, over WebSocket
// Everything else is the page.
import { routeAgentRequest } from 'agents';
import { AIChatAgent } from '@cloudflare/ai-chat';
import { streamText, convertToModelMessages } from 'ai';
import { model, system, makeTools, checkNumbers, answer, loopOptions, type Env, type Place } from './harness';
import { readForecast } from './forecast';
import { floodLine, search } from './place';

// One chat agent per visitor session. The page sets the place in its state before the first question.
export class AskAgent extends AIChatAgent<Env, { place: Place | null }> {
  initialState = { place: null };

  async onChatMessage(onFinish: Parameters<AIChatAgent<Env>['onChatMessage']>[0], options?: Parameters<AIChatAgent<Env>['onChatMessage']>[1]) {
    const place = this.state.place, results: unknown[] = [];
    const last = this.messages.at(-1);
    const question = last?.parts?.map((p) => ('text' in p ? p.text : '')).join(' ') ?? '';
    const result = streamText({
      model: model(this.env), system: system(place), tools: makeTools(this.env, place, results), ...loopOptions,
      messages: await convertToModelMessages(this.messages),
      abortSignal: options?.abortSignal,
      onError: ({ error }) => console.error('agent stream error:', error instanceof Error ? error.message : error),
      onStepFinish: (st) => console.log('agent step:', st.finishReason, st.toolCalls.map((c) => c.toolName).join(','), st.text.length),
      onFinish: async (event) => {
        // A streamed answer cannot be unsent, so here the checker logs. Holding the final text
        // until it passes is on the plan for after Day 2.
        const bad = checkNumbers(event.text, results, question);
        if (bad.length) console.warn('checker: numbers not in tool results', bad);
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
        const line = floodLine(env.FLOOD_CHECK_API, lat, lon);
        const [l, forecast] = await Promise.all([line, readForecast(lat, lon, line.then((x) => x.mm))]);
        return Response.json({ floodLine: l, forecast }, { headers: { 'Cache-Control': 'public, max-age=600' } });
      }
    } catch (e) {
      return Response.json({ error: 'Something went wrong while reading the forecast. Try again in a minute.', detail: String(e) }, { status: 502 });
    }
    return (await routeAgentRequest(req, env)) ?? new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
