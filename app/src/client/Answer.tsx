// The answer for a place, then the chat. The level, the chance and the days come from /api/place,
// computed in code. The agent answers questions below it and shows each step as it works.
import { useEffect, useMemo, useRef, useState } from 'react';
import { lazy, Suspense } from 'react';
import type { StageApi } from './Stage';
// the 3D engine is large: it loads on its own, after the answer, so a slow phone gets the answer first
const Stage = lazy(() => import('./Stage').then((m) => ({ default: m.Stage })));
// the chat library is large too: it loads after the answer
const Chat = lazy(() => import('./Chat').then((m) => ({ default: m.Chat })));
import { Safe } from './Safe';
import * as I from './icons';
import type { Answer as A, Day, FloodLine, Level, Place } from './types';

const WORD: Record<Level, string> = { green: 'Unlikely', amber: 'Possible', red: 'Likely' };
const short = (d: Day, i: number) => (i === 0 ? 'Today' : `${d.weekday.slice(0, 3)} ${Number(d.day.slice(8))}`);
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
export const dayName = (_a: A, d: Day) => d.when ?? d.weekday;

function Verdict({ a }: { a: A }) {
  const w = a.forecast.worst, lv = w.level, l = a.floodLine, when = dayName(a, w);
  // beyond a week the heading shows a short date ("Wed 4 Nov"): weekdays repeat in 14 days
  const head = lv === 'green' ? 'Unlikely to flood' : `${WORD[lv]} flood ${when.includes(' ') ? new Date(w.day + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : when}`;
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

export function Answer({ place, onChange }: { place: Place; onChange: () => void }) {
  const [a, setA] = useState<A | null>(null);
  const [error, setError] = useState('');
  const stage = useRef<StageApi>(null);
  const [marked, setMarked] = useState('');
  const act = (x: Record<string, unknown>) => { if (x.action === 'mark_day') setMarked(String(x.weekday)); else stage.current?.run(x); };
  // ?replay in the address plays the last flood straight away (for demos and recordings)
  useEffect(() => { if (a?.pack && new URLSearchParams(location.search).has('replay')) stage.current?.run({ action: 'play_last_flood' }); }, [a]);
  useEffect(() => {
    setA(null); setError(''); setMarked('');
    fetch(`/api/place?lat=${place.lat}&lon=${place.lon}`).then((r) => r.json() as Promise<A>).then((d) => (d.error ? setError(d.error) : setA(d))).catch(() => setError('The forecast is not answering. Check your connection and try again.'));
  }, [place]);
  return (
    <div className="screen">
      <div className="top"><div><b>{place.name}</b><small>{place.where ? `${place.where}, next 14 days` : 'Next 14 days'}</small></div><button className="chip" type="button" onClick={onChange}>Change place</button></div>
      {error && <div className="error">{error}</div>}
      {!a && !error && <><div className="skeleton" style={{ height: 150 }} /><div className="skeleton" style={{ height: 56 }} /></>}
      {a?.pack && <Safe note="The 3D view could not load on this connection. The answer below is not affected."><Suspense fallback={<div className="stage"><div className="load"><span>Loading the 3D</span></div></div>}><Stage ref={stage} pack={a.pack} /></Suspense></Safe>}
      {a && (
        <>
          <Verdict a={a} />
          {a.nearby && !a.nearby.here && (
            <div className="near"><div><b>Nearest spot that flooded in the {month(a.floodLine.lastFlood?.event ?? (a.pack?.start.startsWith('2026-03') ? 'March' : 'June'))} storm</b><span>{a.nearby.distanceM} m {a.nearby.direction}, {a.nearby.peakCm} cm deep (model)</span></div>{a.pack && <button className="chip" type="button" onClick={() => { window.scrollTo({ top: 0, behavior: 'smooth' }); stage.current?.run({ action: 'show_spot', ...a.nearby }); }}>Show it</button>}</div>
          )}
          <div className="days">{a.forecast.days.map((d, i) => <div key={d.day} className={`day ${d.level} ${marked && d.weekday.toLowerCase() === marked.toLowerCase() ? 'sel' : ''}`}>{icon(d)}<b>{short(d, i)}</b><span>{WORD[d.level]}</span></div>)}</div>
          {a.outlook && a.outlook.length > 0 && (
            <div className="outlook"><h3>Further ahead: rain against normal</h3>
              <div className="weeks">{a.outlook.map((w) => <div key={w.start} className={`week ${w.word.split(' ')[0]}`}><b>From {new Date(w.start + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</b><span>{w.word[0].toUpperCase() + w.word.slice(1)}</span><small>about {w.meanMm} mm that week</small></div>)}</div>
              <p className="fine">A weekly outlook from ECMWF. It says if rain is likely above or below normal, not whether your place will flood.</p>
            </div>
          )}
          <ToDo level={a.forecast.worst.level} day={dayName(a, a.forecast.worst)} />
          <div className="area"><i /><div><b>Rain forecast for your area</b><span className="muted">Blended from the four nearest 28 km forecast squares. Storms can be smaller than that.</span></div></div>
          {a.logging && <p className="fine">Test version: your questions and Forewarn's answers are saved so we can check and improve it.</p>}
          <p className="fine">{a.floodLine.note} ECMWF 51-run forecast through Open-Meteo.{a.floodLine.source === 'last-flood' ? ' Last flood from Flood Check, a model estimate.' : ''}</p>
        </>
      )}
      <Safe note="The chat could not connect. Check your connection and reload the page."><Suspense fallback={null}><Chat place={place} onAction={act} /></Suspense></Safe>
    </div>
  );
}
