// The forecast for a place, computed in code: the model never makes these numbers. 14 days, the
// length of the 51-run forecast, then a weekly outlook out to about a month (outlookWeeks).
//
// ECMWF's 51-run forecast comes on a 0.25 degree grid (about 28 km). A place near the edge of a
// square would get one square's rain only, so we read the four squares around it and blend them
// by distance (bilinear), run by run and day by day. The level of each day comes from how many of
// the 51 blended runs reach the place's flood line in that day, or 50 mm over the 3 days that end on
// it, whichever is more runs. The 3-day rule came from evals/rules.py on 28 Oct: on 36 past floods it
// raised the warnings from 14 to 21, for about 1.5 more false alarms a place a year.
import { fetchIn } from './net';

export type Level = 'green' | 'amber' | 'red';
export interface Day {
  day: string; weekday: string; when: string; runs: number; middleMm: number; wettestMm: number;
  runsOverLine: number;      // runs with more than the flood line in this one day
  runsOver3Days: number;     // runs with 50 mm or more over the 3 days that end on this day
  threeDayLineMm: number;
  why: 'one day' | '3 days'; // which count gave the level and the chance
  level: Level; chance: string;
}
export interface Forecast { lat: number; lon: number; floodLineMm: number; issued: string; squares: { lat: number; lon: number; weight: number }[]; days: Day[]; worst: Day }

const STEP = 0.25;
export const THREE_DAY_MM = 50;
// the runs that count for a day: the larger of the two rules
export const risk = (d: Day) => Math.max(d.runsOverLine, d.runsOver3Days);
export const riskiest = (days: Day[]) => days.reduce((a, b) => (risk(b) > risk(a) ? b : a));

export const levelOf = (share: number): Level => (share >= 0.5 ? 'red' : share >= 0.2 ? 'amber' : 'green');

// The simplest "k in n" within 3 points of the share: "3 in 4", not "37 in 51".
export function chanceWords(k: number, n: number): string {
  if (k === 0) return `none of ${n}`;
  if (k === n) return `all ${n}`;
  const p = k / n;
  if (p >= 0.95) return 'nearly all';
  for (const of of [2, 3, 4, 5, 10, 20, 50]) for (let a = 1; a < of; a++) if (Math.abs(a / of - p) <= 0.03) return `about ${a} in ${of}`;
  return `${k} in ${n}`;
}

// One day of the forecast from its runs' rain: the level, the chance and the middle and wettest run.
// `j` is how many days after the forecast was made (0 is today). `three` is each run's rain over the
// 3 days that end on this day (fewer at the start of the forecast), in the same run order as `rain`.
// The time machine uses this too.
export function dayOf(day: string, j: number, rain: number[], line: number, three: number[]): Day {
  const runs = [...rain].sort((a, b) => a - b), over = runs.filter((x) => x >= line).length;
  const over3 = three.filter((x) => x >= THREE_DAY_MM).length, k = Math.max(over, over3);
  const date = new Date(day + 'T12:00:00Z'), weekday = date.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  // how to say the day: today, a weekday this week, or weekday and date further out (14 days repeat weekdays)
  const when = j === 0 ? 'today' : j === 1 ? 'tomorrow' : j < 7 ? weekday : date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return { day, weekday, when, runs: runs.length, middleMm: +runs[Math.floor(runs.length / 2)].toFixed(1), wettestMm: +runs[runs.length - 1].toFixed(1),
    runsOverLine: over, runsOver3Days: over3, threeDayLineMm: THREE_DAY_MM, why: over3 > over ? '3 days' : 'one day', level: levelOf(k / runs.length), chance: chanceWords(k, runs.length) };
}

// Each run's rain over the 3 days that end on day j (days before the first are not in the forecast).
export const threeDays = (perDay: number[][], j: number) => perDay[j].map((_, r) => perDay.slice(Math.max(0, j - 2), j + 1).reduce((a, d) => a + d[r], 0));

// Read the four squares (slow part, a network call) separately from counting against a line, so
// the caller can fetch the forecast and the flood line at the same time.
export async function readForecast(lat: number, lon: number, floodLineMm: number | Promise<number>): Promise<Forecast> {
  const la0 = Math.floor(lat / STEP) * STEP, lo0 = Math.floor(lon / STEP) * STEP;
  const fy = (lat - la0) / STEP, fx = (lon - lo0) / STEP;
  const squares = [
    { lat: la0, lon: lo0, weight: (1 - fy) * (1 - fx) }, { lat: la0, lon: lo0 + STEP, weight: (1 - fy) * fx },
    { lat: la0 + STEP, lon: lo0, weight: fy * (1 - fx) }, { lat: la0 + STEP, lon: lo0 + STEP, weight: fy * fx },
  ].map((s) => ({ lat: +s.lat.toFixed(3), lon: +s.lon.toFixed(3), weight: +s.weight.toFixed(3) }));
  const url = 'https://ensemble-api.open-meteo.com/v1/ensemble?daily=precipitation_sum&models=ecmwf_ifs025&forecast_days=14&timezone=auto'
    + `&latitude=${squares.map((s) => s.lat).join(',')}&longitude=${squares.map((s) => s.lon).join(',')}`;
  const [res, line] = await Promise.all([fetchIn(url, 15000, 'The forecast service'), floodLineMm]);
  floodLineMm = line;
  if (!res.ok) throw new Error(`forecast service answered ${res.status}`);
  const all = (await res.json()) as { daily: Record<string, (number | null)[]> & { time: string[] } }[];
  const keys = Object.keys(all[0].daily).filter((k) => k.startsWith('precipitation_sum'));
  // each run's blended rain per day (runs in the same order every day, so 3-day totals follow one run)
  const perDay = all[0].daily.time.map((_, j) => keys.map((k) => all.reduce((sum, p, i) => sum + squares[i].weight * (p.daily[k]?.[j] ?? 0), 0)));
  const days: Day[] = all[0].daily.time.map((day, j) => dayOf(day, j, perDay[j], line, threeDays(perDay, j)));
  const worst = riskiest(days);
  return { lat, lon, floodLineMm: line, issued: new Date().toISOString(), squares, days, worst };
}

// Beyond 14 days there is no useful flood chance, only whether rain will be above or below normal.
// ECMWF's extended range (Open-Meteo seasonal API, EC46 then SEAS5) gives per week the share of its
// runs above normal. 50% means no signal either way.
export interface Week { start: string; aboveNormalPct: number; meanMm: number; word: 'wetter than normal' | 'near normal' | 'drier than normal' }
export async function outlookWeeks(lat: number, lon: number, after: string): Promise<Week[]> {
  const r = await fetchIn(`https://seasonal-api.open-meteo.com/v1/seasonal?latitude=${lat}&longitude=${lon}&weekly=precipitation_anomaly_gt0,precipitation_mean&models=ecmwf_seasonal_ensemble_mean_seamless&forecast_days=46`, 12000, 'The weekly outlook service');
  if (!r.ok) return [];
  const d = (await r.json()) as { weekly: { time: string[]; precipitation_anomaly_gt0: (number | null)[]; precipitation_mean: (number | null)[] } };
  const end = new Date(Date.parse(after + 'T00:00:00Z') + 31 * 86400e3).toISOString().slice(0, 10);
  return d.weekly.time.flatMap((start, i) => {
    const pct = d.weekly.precipitation_anomaly_gt0[i], mm = d.weekly.precipitation_mean[i];
    if (pct === null || mm === null || start <= after || start > end) return [];
    return [{ start, aboveNormalPct: Math.round(pct), meanMm: Math.round(mm), word: pct >= 65 ? 'wetter than normal' : pct <= 35 ? 'drier than normal' : 'near normal' }];
  });
}
