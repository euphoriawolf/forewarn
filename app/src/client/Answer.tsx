// The answer for a place, then the chat. The level, the chance and the days come from /api/place,
// computed in code. The agent answers questions below it and shows each step as it works.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, type StageApi } from './Stage';
import { useAgent } from 'agents/react';
import { useAgentChat } from '@cloudflare/ai-chat/react';
import * as I from './icons';
import type { Answer as A, Day, FloodLine, Level, Place } from './types';

const WORD: Record<Level, string> = { green: 'Unlikely', amber: 'Possible', red: 'Likely' };
const short = (d: Day, i: number) => (i === 0 ? 'Today' : d.weekday.slice(0, 3));
const icon = (d: Day) => (d.middleMm < 1 ? <I.Sun /> : d.middleMm < 10 ? <I.Rain /> : <I.Storm />);
const month = (event?: string) => event?.match(/January|February|March|April|May|June|July|August|September|October|November|December/)?.[0] ?? 'last';

// the simplest "k in n" within 3 points, for the raindrop picture (same rule as the server)
function fraction(k: number, n: number) {
  for (const of of [2, 3, 4, 5, 10, 20, 50]) for (let a = 1; a < of; a++) if (Math.abs(a / of - k / n) <= 0.03) return { a, of };
  return { a: k, of: n };
}

function lineWords(l: FloodLine) {
  if (l.source === 'heavy-rain') return 'heavy rain (30 mm or more in a day)';
  const m = month(l.lastFlood?.event);
  if (!l.lastFlood?.firstWet) return `the wettest day of the ${m} storm, which did not flood this spot`;
  if (l.lastFlood.river) return `the wettest day of the ${m} storm`;
  return `the day it flooded here in ${m}`;
}

// "today" when the day is today, otherwise its weekday
export const dayName = (a: A, d: Day) => (a.forecast.days[0]?.day === d.day ? 'today' : d.weekday);

function Verdict({ a }: { a: A }) {
  const w = a.forecast.worst, lv = w.level, l = a.floodLine, when = dayName(a, w);
  const head = lv === 'green' ? 'Unlikely to flood' : `${WORD[lv]} flood ${when}`;
  const Chance = w.chance[0].toUpperCase() + w.chance.slice(1);
  const f = fraction(w.runsOverLine, w.runs);
  const text = w.runsOverLine === 0
    ? `None of the ${w.runs} forecasts bring rain as heavy as ${lineWords(l)} this week.`
    : l.source === 'last-flood' && !l.lastFlood?.firstWet
      ? `${Chance} forecasts bring more than ${l.mm} mm ${when === 'today' ? 'today' : `on ${when}`}: more than the wettest day of the ${month(l.lastFlood?.event)} storm, which did not flood this spot.`
      : l.source === 'heavy-rain'
        ? `${Chance} forecasts bring heavy rain, 30 mm or more, ${when === 'today' ? 'today' : `on ${when}`}.`
        : `${Chance} forecasts bring ${l.mm} mm or more ${when === 'today' ? 'today' : `on ${when}`}, as heavy as ${lineWords(l)}.`;
  return (
    <div className={`verdict ${lv}`}>
      <div className="lvl">{lv === 'green' ? <I.Ok /> : <I.Warn />}{head}</div>
      <p>{text}</p>
      {w.runsOverLine > 0 && <div className={`drops ${f.of <= 10 ? 'few' : ''}`}>{Array.from({ length: f.of }, (_, i) => <span key={i} className={i < f.a ? 'on' : 'off'}><I.Drop /></span>)}</div>}
    </div>
  );
}

function ToDo({ level, day }: { level: Level; day: string }) {
  if (level === 'green') return <div className="act"><i><I.Ok /></i>Nothing for now. Check again in a day or two: forecasts change.</div>;
  return (
    <>
      <h3>{day === 'today' ? 'Do this now' : level === 'red' ? `Do this by ${day} morning` : `Before ${day}`}</h3>
      <div className="act"><i><I.Papers /></i>Move papers, phones and food up high.</div>
      {level === 'red' && <div className="act"><i><I.Car /></i>{day === 'today' ? 'Park on higher ground.' : 'Park on higher ground the night before.'}</div>}
      <div className="act"><i><I.Route /></i>Know your way to higher ground.</div>
    </>
  );
}

const STEP: Record<string, [string, string]> = {
  read_forecast: ['Reading 51 forecasts for the next 7 days', 'Read 51 forecasts for the next 7 days'],
  show_last_flood: ['Playing the last flood on your street', 'Played the last flood on your street'],
  light_roads: ['Checking the roads against the last flood', 'Lit the roads by the last flood'],
  show_street_view: ['Moving to your street', 'Moved to your street'],
  show_overview: ['Moving up to see the area', 'Moved up to see the area'],
  mark_day: ['Marking the day', 'Marked the day'],
  last_flood: ['Checking the last flood here', 'Checked the last flood here'],
};

function Chat({ place, onAction }: { place: Place; onAction: (a: Record<string, unknown>) => void }) {
  // one chat per visitor: a random id kept on this phone
  const session = useMemo(() => {
    try { let id = localStorage.getItem('fw-session'); if (!id) { id = crypto.randomUUID(); localStorage.setItem('fw-session', id); } return id; }
    catch { return crypto.randomUUID(); }
  }, []);
  const agent = useAgent<{ place: Place | null }>({ agent: 'AskAgent', name: session });
  useEffect(() => { agent.setState({ place }); }, [agent, place]);
  const { messages, sendMessage, status, clearHistory } = useAgentChat({ agent });
  useEffect(() => { clearHistory(); }, [place.lat, place.lon]); // a new place starts a new conversation
  const [text, setText] = useState('');
  // follow the newest words down, once the person has asked something
  useEffect(() => { if (messages.length) requestAnimationFrame(() => window.scrollTo(0, document.documentElement.scrollHeight)); }, [messages]);
  // the agent's 3D tools return actions: run each one once, when its result arrives
  const done = useRef(new Set<string>());
  useEffect(() => {
    for (const m of messages) for (const p of m.parts) {
      if (!p.type.startsWith('tool-') || !('state' in p) || p.state !== 'output-available') continue;
      const id = (p as { toolCallId: string }).toolCallId, out = (p as { output?: Record<string, unknown> }).output;
      if (done.current.has(id)) continue;
      done.current.add(id);
      if (out && typeof out.action === 'string') onAction(out);
    }
  }, [messages]);
  const busy = status === 'submitted' || status === 'streaming';
  const ask = (q: string) => { if (!q.trim() || busy) return; sendMessage({ text: q.trim() }); setText(''); };
  return (
    <>
      <div className="chat">
        {messages.length === 0 && (
          <div className="suggest">
            {['Will my street flood this week?', 'Show me the last flood here', 'Which day is wettest?'].map((q) => <button key={q} className="chip" type="button" onClick={() => ask(q)}>{q}</button>)}
          </div>
        )}
        {messages.map((m) => m.role === 'user'
          ? <div key={m.id} className="me">{m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')}</div>
          : (
            <div key={m.id}>
              <div className="steps">
                {m.parts.filter((p) => p.type.startsWith('tool-')).map((p, i) => {
                  const name = p.type.slice(5), done = 'state' in p && p.state === 'output-available', [now, past] = STEP[name] ?? [name, name];
                  return <div key={i}>{done ? <I.Tick /> : <span className="spin" />}{done ? past : now}</div>;
                })}
              </div>
              <p className="bot">{m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')}</p>
            </div>
          ))}
        {status === 'submitted' && <div className="steps"><div><span className="spin" />Thinking</div></div>}
      </div>
      <div className="askbar"><form className="ask" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about your place" aria-label="Ask about your place" disabled={busy} />
        <button type="submit" aria-label="Send" disabled={busy}><I.Send /></button>
      </form></div>
    </>
  );
}

export function Answer({ place, onChange }: { place: Place; onChange: () => void }) {
  const [a, setA] = useState<A | null>(null);
  const [error, setError] = useState('');
  const stage = useRef<StageApi>(null);
  const [marked, setMarked] = useState('');
  const act = (x: Record<string, unknown>) => { if (x.action === 'mark_day') setMarked(String(x.weekday)); else stage.current?.run(x); };
  useEffect(() => {
    setA(null); setError(''); setMarked('');
    fetch(`/api/place?lat=${place.lat}&lon=${place.lon}`).then((r) => r.json() as Promise<A>).then((d) => (d.error ? setError(d.error) : setA(d))).catch(() => setError('The forecast is not answering. Check your connection and try again.'));
  }, [place]);
  return (
    <div className="screen">
      <div className="top"><div><b>{place.name}</b><small>{place.where ? `${place.where}, next 7 days` : 'Next 7 days'}</small></div><button className="chip" type="button" onClick={onChange}>Change place</button></div>
      {error && <div className="error">{error}</div>}
      {!a && !error && <><div className="skeleton" style={{ height: 150 }} /><div className="skeleton" style={{ height: 56 }} /></>}
      {a?.pack && <Stage ref={stage} pack={a.pack} />}
      {a && (
        <>
          <Verdict a={a} />
          <div className="days">{a.forecast.days.map((d, i) => <div key={d.day} className={`day ${d.level} ${marked && d.weekday.toLowerCase() === marked.toLowerCase() ? 'sel' : ''}`}>{icon(d)}<b>{short(d, i)}</b><span>{WORD[d.level]}</span></div>)}</div>
          <ToDo level={a.forecast.worst.level} day={dayName(a, a.forecast.worst)} />
          <div className="area"><i /><div><b>Rain forecast for your area</b><span className="muted">Blended from the four nearest 28 km forecast squares. Storms can be smaller than that.</span></div></div>
          {a.logging && <p className="fine">Test version: your questions and Forewarn's answers are saved so we can check and improve it.</p>}
          <p className="fine">{a.floodLine.note} ECMWF 51-run forecast through Open-Meteo.{a.floodLine.source === 'last-flood' ? ' Last flood from Flood Check, a model estimate.' : ''}</p>
        </>
      )}
      <Chat place={place} onAction={act} />
    </div>
  );
}
