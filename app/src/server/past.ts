// The time machine: what Forewarn would have said before 36 real African floods, with the same rules
// the live app uses today (the flood line of the place, dayOf for each day, the Watch agent's alert rule).
// The floods and their forecasts are in public/past/floods.json (tools/make-past.py): for each flood,
// ECMWF's 51 runs made 1 to 7 days before the flood day: each run's rain per day from the day it was
// made to 8 days after, so 3-day totals can be added up. These are the runs of the grid square nearest the flood, not the four-square blend of the live app.
import { dayOf, riskiest, alertRiskiest, type Day } from './forecast';
import { floodLine, type FloodLine } from './place';
import { rainArchive, rain30Ending, type Rain30 } from './rain30';
import type { Env } from './harness';

interface Flood { label: string; country: string; peak: string; days: string[]; lat: number; lon: number; reports: number; runs: Record<string, { init: string; mm: number[][]; burst: number[][] }> }
// `flagged`: the app showed flooding possible or likely (the rule in forecast.ts); `alert`: an email alert
// would have been drafted (the stricter rule)
export interface Lead { lead: number; init: string; days: Day[]; worst: Day; ground: Rain30 | null; flagged: boolean; alert: boolean }
export interface Replay { id: number; label: string; country: string; peak: string; lat: number; lon: number; reports: number; floodLine: FloodLine | null; leads: Lead[]; firstAlert: number | null; note?: string }
export interface Scorecard { floods: number; withForecasts: number; warned: number; warned3: number; byLead: { lead: number; alerts: number }[]; groundSoaked: number; replays: Replay[]; source: string; method: string }

// change this when the rules or the data change: the cached scorecard is keyed by it
export const PAST_VERSION = '2026-10-30-burst';

let data: Promise<{ floods: Flood[] }> | null = null;
const load = (env: Env) => (data ??= env.ASSETS.fetch('http://localhost/past/floods.json').then((r) => r.json() as Promise<{ floods: Flood[] }>).catch((e) => { data = null; throw e; }));
const DAY = 864e5, iso = (t: number) => new Date(t).toISOString().slice(0, 10), at = (d: string) => Date.parse(d + 'T00:00:00Z');

export async function replay(env: Env, id: number): Promise<Replay> {
  const f = (await load(env)).floods[id];
  if (!f) throw new Error('no such flood');
  const base = { id, label: f.label, country: f.country, peak: f.peak, lat: f.lat, lon: f.lon, reports: f.reports };
  const leads = Object.keys(f.runs).map(Number).sort((a, b) => b - a);
  if (!leads.length) return { ...base, floodLine: null, leads: [], firstAlert: null, note: 'This flood came before the forecast archive starts (April 2024), so there is nothing to replay.' };
  // one archive call covers the 30 days before every forecast (the earliest is made 7 days before)
  const [line, daily] = await Promise.all([
    floodLine(env.FLOOD_CHECK_API, f.lat, f.lon),
    rainArchive(f.lat, f.lon, iso(at(f.peak) - 40 * DAY), iso(at(f.peak) - DAY)).catch(() => null),
  ]);
  const out: Lead[] = await Promise.all(leads.map(async (lead) => {
    const { init, mm, burst } = f.runs[lead];
    // the ground as it was known that morning: the 30 days that end the day before the forecast
    const ground = daily ? await rain30Ending(env.ASSETS, f.lat, f.lon, daily, iso(at(init) - DAY)).catch(() => null) : null;
    // the day before the flood, the flood day and the day after, as days after the forecast was made
    const days = f.days.map((day) => {
      const j = Math.round((at(day) - at(init)) / DAY);
      return dayOf(day, j, mm.map((run) => run[j]), line.mm, mm.map((run) => run.slice(Math.max(0, j - 2), j + 1).reduce((a, b) => a + b, 0)), burst.map((run) => run[j]), !!ground?.groundSoaked);
    });
    const worst = riskiest(days);
    return { lead, init, days, worst, ground, flagged: worst.level !== 'green', alert: alertRiskiest(days).alertLevel !== 'green' };
  }));
  return { ...base, floodLine: line, leads: out, firstAlert: out.find((l) => l.flagged)?.lead ?? null };
}

export async function scorecard(env: Env): Promise<Scorecard> {
  const { floods } = await load(env);
  const replays: Replay[] = [];
  // a few at a time: each one reads Flood Check and the rain archive
  for (let i = 0; i < floods.length; i += 12) replays.push(...(await Promise.all(floods.slice(i, i + 12).map((_, k) => replay(env, i + k)))));
  const tested = replays.filter((r) => r.leads.length);
  return {
    floods: floods.length, withForecasts: tested.length,
    warned: tested.filter((r) => r.firstAlert !== null).length,
    warned3: tested.filter((r) => (r.firstAlert ?? 0) >= 3).length,
    byLead: [7, 6, 5, 4, 3, 2, 1].map((lead) => ({ lead, alerts: tested.filter((r) => r.leads.find((l) => l.lead === lead)?.flagged).length })),
    groundSoaked: tested.filter((r) => r.leads.find((l) => l.lead === 1)?.ground?.groundSoaked).length,
    replays,
    source: 'Floods: Google Groundsource, news reports placed on a map (CC BY 4.0). Forecasts: ECMWF IFS ensemble archive, dynamical.org (CC BY 4.0).',
    method: 'For each flood, the 51 forecast runs made 1 to 7 days before the flood day, the 4 forecast squares around it blended. A flood counts as flagged when the day before, the flood day or the day after shows flooding possible or likely: at least 1 in 10 runs bring the flood line in one day, 40 mm over 3 days or 20 mm in 3 hours (lower bars on soaked ground). That is the rule the app uses today.',
  };
}

// One forecast of the past in the shape of the live read_forecast result, for the agent's test suite.
export async function pastView(env: Env, id: number, lead: number) {
  const r = await replay(env, id), l = r.leads.find((x) => x.lead === lead);
  if (!l || !r.floodLine) throw new Error('no forecast for that flood and lead');
  return {
    place: { name: r.label, where: r.country, lat: r.lat, lon: r.lon }, today: l.init, ground: l.ground,
    forecast: { floodLine: r.floodLine, lat: r.lat, lon: r.lon, floodLineMm: r.floodLine.mm, issued: l.init, days: l.days, worst: l.worst,
      note: 'A forecast from the past: only 3 of its days are kept (the day before the flood, the flood day and the day after), from the one grid square nearest the place.' },
    expected: { level: l.worst.level, alert: l.alert },
  };
}
