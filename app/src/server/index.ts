// Forewarn Worker.
//   /api/search?q=        places across Africa
//   /api/place?lat&lon    the answer for a place, computed in code: flood line, 7 days, levels
//   /api/ask?lat&lon&q=   one checked agent answer (local testing only)
//   /api/witness (POST)   a flood photo through SAM 3.1 and Muse Spark: the water and the people in it
//   /api/reports          send a report (POST), or the approved ones near ?lat&lon; /review is the review page
//   /api/follow (POST)    follow an area by email; /api/follow/confirm and /api/follow/stop are the links in the emails
//   /api/past, /api/past/<n>  the time machine: what Forewarn would have said before 36 past floods
//   /api/alerts/run       run one area's check now, with a lowered flood line to force a warning (ALERTS_TOKEN)
//   /agents/ask-agent/<session>   the chat, over WebSocket
// Everything else is the page.
import { routeAgentRequest } from 'agents';
import { AIChatAgent } from '@cloudflare/ai-chat';
import { streamText, convertToModelMessages } from 'ai';
import { model, system, makeTools, checkNumbers, answer, loopOptions, noEmDash, followUps, OPENING, FROM_PAGE, type Env, type Place } from './harness';
import { readForecast, outlookWeeks } from './forecast';
import { replay, scorecard, pastView } from './past';
import { floodLine, search, placeName } from './place';
import { packFor, nearestFlood } from './packs';
import { Logbook, stepsOf, bookOf } from './logbook';
import { witness } from './witness';
import { Reports, reportsOf } from './reports';
import { reviewPage } from './review';
import { Alerts, alertsOf, areaKey, confirmEmail, mail, notePage, sendDraft, type Area } from './alerts';
import { Watch, watchOf } from './watch';
export { Logbook, Reports, Alerts, Watch };

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
      // a whole answer has a time limit too, so a slow model cannot hang the chat
      abortSignal: AbortSignal.any([AbortSignal.timeout(90000), ...(options?.abortSignal ? [options.abortSignal] : [])]),
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
        const asked = this.messages.filter((m) => m.role === 'user').map((m) => m.parts?.map((p) => ('text' in p ? p.text : '')).join(' ') ?? '').filter((q) => q && q !== OPENING && !q.startsWith(FROM_PAGE));
        this.setState({ ...this.state, suggestions: [] });
        followUps(this.env, place, asked, event.text).then((suggestions) => this.setState({ ...this.state, suggestions })).catch((e: unknown) => console.error('follow-ups:', e instanceof Error ? e.message : e));
      },
    });
    return result.toUIMessageStreamResponse();
  }
}

const num = (v: string | null) => (v === null || v === '' || Number.isNaN(+v) ? null : +v);

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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
        let named = String(b.place ?? '');
        if (!named || /^your location/i.test(named)) { const n = await placeName(lat, lon).catch(() => null); named = n ? [n.name, n.where].filter(Boolean).join(', ') : `${lat.toFixed(4)}, ${lon.toFixed(4)}`; }
        const r = await reportsOf(env.Reports).add({ session: String(b.session ?? '').slice(0, 60), lat, lon, place: named, source: String(b.source ?? 'map').slice(0, 10), takenAt: String(b.takenAt ?? '').slice(0, 20), reaches: String(b.reaches ?? ''), moving: String(b.moving ?? ''), meaning: String(b.meaning ?? ''), waterPct: Number(b.waterPct) || 0, people: Number(b.people) || 0, image });
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
        // the review page: alert drafts and flood reports. Needs the REVIEW_TOKEN secret (?token=)
        const token = q.get('token') ?? '';
        if (!env.REVIEW_TOKEN || token !== env.REVIEW_TOKEN) return new Response('Not found', { status: 404 });
        if (req.method === 'POST') {
          const f = await req.formData(), id = String(f.get('id')), d = String(f.get('decision'));
          let done = '';
          if (f.get('kind') === 'alert' && (d === 'approved' || d === 'rejected')) {
            const draft = await alertsOf(env.Alerts).decide(id, d, String(f.get('subject') ?? '').slice(0, 140), String(f.get('body') ?? '').replace(/\r/g, '').slice(0, 2000));
            if (draft) { const r = await sendDraft(env, draft); done = `Sent to ${r.sent}${r.capped ? `, ${r.capped} held by the daily limit` : ''}${r.failed ? `, ${r.failed} failed` : ''}.`; }
          } else if (d === 'approved' || d === 'rejected') await reportsOf(env.Reports).decide(id, d);
          return Response.redirect(`${url.origin}/review?token=${encodeURIComponent(token)}${done ? `&done=${encodeURIComponent(done)}` : ''}`, 303);
        }
        const [reports, drafts] = await Promise.all([reportsOf(env.Reports).pending(), alertsOf(env.Alerts).pendingDrafts()]);
        return new Response(reviewPage(reports, token, drafts, q.get('done') ?? ''), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
      }
      if (url.pathname === '/api/follow' && req.method === 'POST') {
        const origin = req.headers.get('Origin');
        if (origin && new URL(origin).host !== url.host) return new Response('Not found', { status: 404 });
        const { success } = await env.FOLLOW_LIMIT.limit({ key: req.headers.get('CF-Connecting-IP') ?? 'local' });
        if (!success) return Response.json({ error: 'Too many tries. Wait a minute and try again.' }, { status: 429 });
        const b = (await req.json()) as Record<string, unknown>;
        const email = String(b.email ?? '').trim().toLowerCase(), lat = num(String(b.lat)), lon = num(String(b.lon));
        if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email) || email.length > 120) return Response.json({ error: 'That email address does not look right.' }, { status: 400 });
        if (lat === null || lon === null) return Response.json({ error: 'Pick a place first.' }, { status: 400 });
        const area: Area = { key: areaKey(lat, lon), name: String(b.name ?? 'Your place').slice(0, 80), where: String(b.where ?? '').slice(0, 120), lat, lon };
        const store = alertsOf(env.Alerts), f = await store.follow(email, area);
        if (f.already) return Response.json({ status: 'already' });
        if (!(await store.mayConfirm(email))) return Response.json({ status: 'wait' });
        const r = await mail(env, email, `Confirm flood alerts for ${area.name}`, confirmEmail(env.SITE, area, f.token));
        return r === 'ok' ? Response.json({ status: 'sent' }) : Response.json({ error: 'The email did not send. Try again later.', detail: r }, { status: 502 });
      }
      if (url.pathname === '/api/follow/confirm') {
        const areas = await alertsOf(env.Alerts).confirm(q.get('t') ?? '');
        if (!areas.length) return notePage('This link has expired', 'Follow your area again from the map to get a new link.', env.SITE);
        // each confirmed area gets its Watch agent, which checks every 6 hours from now
        await Promise.all(areas.map(async (a) => (await watchOf(env, a.key)).watch(a)));
        return notePage('Alerts are on', `Forewarn now checks ${areas.map((a) => a.name).join(', ')} every 6 hours. When a flood looks possible in the next 7 days, a person reads the alert and then it comes to you. At most 2 alerts a day.`, env.SITE);
      }
      if (url.pathname === '/api/follow/stop') {
        const s = await alertsOf(env.Alerts).stop(q.get('t') ?? '');
        return s ? notePage('Alerts stopped', `You will get no more alerts for ${s.name}.`, env.SITE) : notePage('Link not found', 'This stop link is not valid.', env.SITE);
      }
      if (url.pathname === '/api/alerts/run' && req.method === 'POST') {
        // a check now for one area, for testing: ?lat&lon&name, and &line=<mm> to force a warning
        const token = req.headers.get('Authorization')?.replace(/^Bearer /, '');
        if (!env.ALERTS_TOKEN || token !== env.ALERTS_TOKEN) return new Response('Not found', { status: 404 });
        const lat = num(q.get('lat')), lon = num(q.get('lon')), line = num(q.get('line'));
        if (lat === null || lon === null) return Response.json({ error: 'Add lat and lon.' }, { status: 400 });
        const w = await watchOf(env, areaKey(lat, lon));
        await w.watch({ key: areaKey(lat, lon), name: q.get('name') ?? 'Test place', where: q.get('where') ?? '', lat, lon });
        const decision = await w.check(line ? { lineMm: line } : undefined);
        return Response.json({ decision, memory: await w.memory() });
      }
      if (url.pathname === '/api/where') {
        const lat = num(q.get('lat')), lon = num(q.get('lon'));
        if (lat === null || lon === null) return Response.json({ error: 'Add lat and lon.' }, { status: 400 });
        return Response.json((await placeName(lat, lon)) ?? { name: 'Your location', where: '' });
      }
      if (url.pathname === '/api/past' || url.pathname.startsWith('/api/past/')) {
        // the time machine: the whole scorecard, or one flood. The answer only changes with the data or
        // the rules, so it is kept for a day (the scorecard reads 40 places from two services).
        const cache = (caches as unknown as { default: Cache }).default, key = new Request(url.origin + url.pathname);
        const hit = await cache.match(key);
        if (hit) return hit;
        const id = url.pathname === '/api/past' ? null : Number(url.pathname.slice('/api/past/'.length));
        if (id !== null && !Number.isInteger(id)) return Response.json({ error: 'Add a flood number.' }, { status: 400 });
        const res = Response.json(id === null ? await scorecard(env) : await replay(env, id), { headers: { 'Cache-Control': 'public, max-age=86400' } });
        ctx.waitUntil(cache.put(key, res.clone()));
        return res;
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
          const which = (['meta', 'meta-min'].includes(q.get('model') ?? '') ? q.get('model') : 'open') as 'open' | 'meta' | 'meta-min';
          // ?past=<flood>&lead=<days>: answer from the forecast made that many days before a past flood (evals/past-suite.mjs)
          if (q.has('past')) {
            const v = await pastView(env, Number(q.get('past')), Number(q.get('lead') ?? 3));
            return Response.json({ ...(await answer(env, v.place, text, which, { today: v.today, forecast: v.forecast, ground: v.ground })), expected: v.expected, place: v.place, today: v.today });
          }
          return Response.json(await answer(env, { name: q.get('name') ?? 'this place', where: '', lat, lon }, text, which));
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
