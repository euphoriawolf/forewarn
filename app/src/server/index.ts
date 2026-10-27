// Forewarn Worker.
//   /api/search?q=        places across Africa
//   /api/place?lat&lon    the answer for a place, computed in code: flood line, 7 days, levels
//   /api/ask?lat&lon&q=   one checked agent answer (local testing only)
//   /api/witness (POST)   a flood photo through SAM 3.1 and Muse Spark: the water and the people in it
//   /api/reports          send a report (POST), or the approved ones near ?lat&lon; /review is the review page
//   /agents/ask-agent/<session>   the chat, over WebSocket
// Everything else is the page.
import { routeAgentRequest } from 'agents';
import { AIChatAgent } from '@cloudflare/ai-chat';
import { streamText, convertToModelMessages } from 'ai';
import { model, system, makeTools, checkNumbers, answer, loopOptions, noEmDash, followUps, OPENING, type Env, type Place } from './harness';
import { readForecast, outlookWeeks } from './forecast';
import { floodLine, search } from './place';
import { packFor, nearestFlood } from './packs';
import { Logbook, stepsOf, bookOf } from './logbook';
import { witness } from './witness';
import { Reports, reportsOf } from './reports';
import { reviewPage } from './review';
export { Logbook, Reports };

// One chat agent per visitor session. The page sets the place in its state before the first question.
export class AskAgent extends AIChatAgent<Env, { place: Place | null; suggestions?: string[] }> {
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
        // the chips under the chat: follow-ups that fit this answer (the page shows them when they arrive)
        const asked = this.messages.filter((m) => m.role === 'user').map((m) => m.parts?.map((p) => ('text' in p ? p.text : '')).join(' ') ?? '').filter((q) => q && q !== OPENING);
        this.setState({ ...this.state, suggestions: [] });
        followUps(this.env, place, asked, event.text).then((suggestions) => this.setState({ ...this.state, suggestions })).catch((e: unknown) => console.error('follow-ups:', e instanceof Error ? e.message : e));
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
      if (url.pathname === '/api/witness' && req.method === 'POST') {
        // a photo from the page itself only: SAM calls cost money
        const origin = req.headers.get('Origin');
        if (origin && new URL(origin).host !== url.host) return new Response('Not found', { status: 404 });
        const body = (await req.json()) as { image?: string; width?: number; height?: number };
        try { return Response.json(await witness(env, String(body.image ?? ''), Number(body.width), Number(body.height))); }
        catch (e) { return Response.json({ error: e instanceof Error ? e.message : 'The photo check failed. Try again.' }, { status: 400 }); }
      }
      if (url.pathname === '/api/reports' && req.method === 'POST') {
        const origin = req.headers.get('Origin');
        if (origin && new URL(origin).host !== url.host) return new Response('Not found', { status: 404 });
        const b = (await req.json()) as Record<string, unknown>;
        const lat = num(String(b.lat)), lon = num(String(b.lon)), image = String(b.image ?? '');
        if (lat === null || lon === null || !/^data:image\/jpeg;base64,/.test(image) || image.length > 1_500_000) return Response.json({ error: 'That report could not be read. Try again.' }, { status: 400 });
        const r = await reportsOf(env.Reports).add({ session: String(b.session ?? '').slice(0, 60), lat, lon, place: String(b.place ?? ''), reaches: String(b.reaches ?? ''), moving: String(b.moving ?? ''), meaning: String(b.meaning ?? ''), waterPct: Number(b.waterPct) || 0, people: Number(b.people) || 0, image });
        return Response.json(r, { status: 'error' in r ? 429 : 200 });
      }
      if (url.pathname === '/api/reports') {
        const lat = num(q.get('lat')), lon = num(q.get('lon'));
        if (lat === null || lon === null) return Response.json({ error: 'Add lat and lon.' }, { status: 400 });
        return Response.json(await reportsOf(env.Reports).near(lat, lon));
      }
      const pic = url.pathname.match(/^\/api\/reports\/([0-9a-f-]{36})\.jpg$/);
      if (pic) {
        // approved photos are public; a pending one only with the review token
        const any = !!env.REVIEW_TOKEN && q.get('token') === env.REVIEW_TOKEN;
        const data = await reportsOf(env.Reports).image(pic[1], any);
        if (!data) return new Response('Not found', { status: 404 });
        return new Response(Uint8Array.from(atob(data.split(',')[1]), (c) => c.charCodeAt(0)), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': any ? 'no-store' : 'public, max-age=3600' } });
      }
      if (url.pathname === '/review') {
        // the review page: needs the REVIEW_TOKEN secret (?token=)
        const token = q.get('token') ?? '';
        if (!env.REVIEW_TOKEN || token !== env.REVIEW_TOKEN) return new Response('Not found', { status: 404 });
        if (req.method === 'POST') {
          const f = await req.formData(), id = String(f.get('id')), d = String(f.get('decision'));
          if (d === 'approved' || d === 'rejected') await reportsOf(env.Reports).decide(id, d);
          return Response.redirect(`${url.origin}/review?token=${encodeURIComponent(token)}`, 303);
        }
        return new Response(reviewPage(await reportsOf(env.Reports).pending(), token), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
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
