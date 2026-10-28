// The time machine: what Forewarn would have said before 36 real African floods, computed by the
// Worker with today's rules (/api/past). Every flood is listed, the misses too.
import { useEffect, useState } from 'react';
import * as I from './icons';

type Level = 'green' | 'amber' | 'red';
interface Day { day: string; when: string; runsOverLine: number; runsOver3Days: number; threeDayLineMm: number; why: 'one day' | '3 days'; runs: number; middleMm: number; wettestMm: number; level: Level; chance: string }
interface Lead { lead: number; init: string; days: Day[]; worst: Day; ground: { mm: number; normalMm: number; word: string; groundSoaked: boolean } | null; alert: boolean }
interface Replay { id: number; label: string; country: string; peak: string; lat: number; lon: number; reports: number; floodLine: { mm: number; note: string } | null; leads: Lead[]; firstAlert: number | null; note?: string }
interface Card { floods: number; withForecasts: number; warned: number; warned3: number; byLead: { lead: number; alerts: number }[]; replays: Replay[]; source: string; method: string }

const WORD: Record<Level, string> = { green: 'unlikely', amber: 'possible', red: 'likely' };
const date = (d: string, o: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { ...o, timeZone: 'UTC' });
const before = (n: number) => (n === 1 ? '1 day before' : `${n} days before`);

export function Past({ id, onPick, onHome }: { id: number | null; onPick: (id: number | null) => void; onHome: () => void }) {
  const [card, setCard] = useState<Card | null>(null), [error, setError] = useState('');
  useEffect(() => {
    fetch('/api/past').then((r) => (r.ok ? (r.json() as Promise<Card>) : Promise.reject(r.status))).then(setCard).catch(() => setError('The time machine did not load. Try again in a minute.'));
  }, []);
  useEffect(() => { scrollTo(0, 0); }, [id]);
  const one = card && id !== null ? card.replays.find((r) => r.id === id) : null;
  return (
    <main className="screen past">
      <div className="top">
        <button className="brand" onClick={onHome}><I.Logo />Forewarn</button>
        {id !== null && <button className="chip" onClick={() => onPick(null)}>All floods</button>}
      </div>
      {error && <p className="err">{error}</p>}
      {!card && !error && <p className="muted"><span className="spin" /> Replaying 36 floods. The first time takes about a minute.</p>}
      {card && (one ? <Flood r={one} /> : <List card={card} onPick={onPick} />)}
    </main>
  );
}

function List({ card, onPick }: { card: Card; onPick: (id: number) => void }) {
  const missed = card.withForecasts - card.warned;
  return (
    <>
      <h1 className="h1">The time machine</h1>
      <p>What Forewarn would have said before {card.withForecasts} real floods in Africa, with the rules it uses today.</p>
      <div className="score">
        <div><b>{card.warned} of {card.withForecasts}</b><span>floods got a warning</span></div>
        <div><b>{card.warned3}</b><span>of them 3 days or more ahead</span></div>
        <div><b>{missed}</b><span>missed, all listed below</span></div>
      </div>
      <div className="leads" aria-label="Warnings by how many days before the flood">
        {card.byLead.map((l) => <div key={l.lead}><b>{l.alerts}</b><small>{l.lead}d</small></div>)}
      </div>
      <p className="fine">Floods with a warning, by how many days before the flood the forecast was made.</p>
      <div className="results floods">
        {card.replays.map((r) => (
          <button key={r.id} onClick={() => onPick(r.id)} disabled={!r.leads.length}>
            <span><b>{r.label}</b><small>{r.country}, {date(r.peak, { day: 'numeric', month: 'short', year: 'numeric' })}</small></span>
            {r.leads.length ? (
              <span className="dots" aria-label={r.leads.map((l) => `${before(l.lead)}: ${WORD[l.worst.level]}`).join(', ')}>
                {r.leads.map((l) => <i key={l.lead} className={l.worst.level} />)}
              </span>
            ) : <small>No forecast archive yet</small>}
            <small className={r.firstAlert ? 'hit' : 'miss'}>{r.leads.length ? (r.firstAlert ? `Warned ${before(r.firstAlert)}` : 'Missed') : ''}</small>
          </button>
        ))}
      </div>
      <p className="fine">{card.method} Dots run from 7 days before to 1 day before. {card.source}</p>
    </>
  );
}

function Flood({ r }: { r: Replay }) {
  const [lead, setLead] = useState(r.firstAlert ?? 3);
  const l = r.leads.find((x) => x.lead === lead) ?? r.leads[0];
  const now = `?${new URLSearchParams({ lat: String(r.lat), lon: String(r.lon), name: r.label, where: r.country })}`;
  return (
    <>
      <div>
        <h1 className="h1">{r.label}</h1>
        <p className="muted">{r.country}. Flood day {date(r.peak)}, {r.reports} news reports.</p>
      </div>
      <div className="picker" role="radiogroup" aria-label="When the forecast was made">
        {r.leads.map((x) => (
          <button key={x.lead} role="radio" aria-checked={x.lead === lead} className={`${x.lead === lead ? 'on' : ''} ${x.worst.level}`} onClick={() => setLead(x.lead)}>
            <b>{x.lead}</b><small>{x.lead === 1 ? 'day' : 'days'}</small>
          </button>
        ))}
      </div>
      <p className="fine">Days before the flood. Pick one to see the forecast made that morning.</p>
      <section className={`verdict ${l.worst.level}`}>
        <small>Forecast made {date(l.init)}</small>
        <h2>Flooding {WORD[l.worst.level]} {/^(today|tomorrow)$/.test(l.worst.when) ? l.worst.when : `on ${l.worst.when}`}</h2>
        <p>{l.worst.why === '3 days' ? `${cap(l.worst.chance)} forecasts brought ${l.worst.threeDayLineMm} mm or more over the 3 days to then.` : `${cap(l.worst.chance)} forecasts brought ${r.floodLine?.mm} mm or more that day, the line for this place.`}</p>
        <p className="act">{l.alert ? <><I.Bell /> Forewarn would have drafted an alert for a person to approve.</> : <><I.Minus /> Forewarn would have stayed quiet.</>}</p>
      </section>
      <div className="three">
        {l.days.map((d) => (
          <div key={d.day} className={`${d.level} ${d.day === r.peak ? 'peak' : ''}`}>
            <small>{d.day === r.peak ? 'Flood day' : date(d.day, { weekday: 'short', day: 'numeric', month: 'short' })}</small>
            <b>{cap(WORD[d.level])}</b>
            <span>{cap(d.chance)}</span>
            <small>Middle run {d.middleMm} mm, wettest {d.wettestMm} mm</small>
          </div>
        ))}
      </div>
      {l.ground && <p><b>The ground that morning:</b> {l.ground.mm} mm in the 30 days before, against a normal {l.ground.normalMm} mm ({l.ground.word}).{l.ground.groundSoaked ? ' Soaked ground floods sooner.' : ''}</p>}
      {r.floodLine && <p className="fine">The flood line: {r.floodLine.note}</p>}
      <p className="fine">These are the runs of the forecast square nearest the flood. Today's app blends the four nearest squares.</p>
      <a className="btn dark" href={now}>See this place now</a>
    </>
  );
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
