// The forecast for a place, computed in code: the model never makes these numbers. 14 days, the
// length of the 51-run forecast, then a weekly outlook out to about a month (outlookWeeks).
//
// ECMWF's 51-run forecast comes on a 0.25 degree grid (about 28 km). A place near the edge of a
// square would get one square's rain only, so we read the four squares around it and blend them
// by distance (bilinear), run by run and hour by hour.
//
// Two rules, both from evals/rules2.py (30 Oct, every daily forecast since April 2024 at 36 past floods):
// - The level in the app (the answer, the 3D, the time machine): a run counts when it brings the place's
//   flood line in one day, 40 mm over the 3 days to it, or 20 mm in its heaviest 3 hours; on soaked
//   ground each bar is 3/4 as high. Flooding is possible when 1 in 10 runs count, likely at half.
//   On the 36 floods: 29 flagged in advance (81%).
// - Email alerts stay stricter (evals/rules.py, 28 Oct): the flood line in one day or 50 mm over 3 days,
//   in 1 in 5 runs. About 4 alerts a place a year, so people keep trusting them.
import { fetchIn } from './net';

export type Level = 'green' | 'amber' | 'red';
export type Why = 'one day' | '3 days' | 'burst';
export interface Day {
  day: string; weekday: string; when: string; runs: number; middleMm: number; wettestMm: number;
  runsFlagged: number;        // runs that count for the level in the app (any of the three signs)
  why: Why;                   // the sign most runs show: the flood line in one day, 3 days of rain, or a 3-hour burst
  lineMm: number; threeDayMm: number; burstMm: number; soaked: boolean; // the bars that day (lower on soaked ground)
  wettestBurstMm: number;     // the heaviest 3 hours in the wettest run
  level: Level; chance: string;
  // the stricter rule for email alerts
  runsOverLine: number; runsOver3Days: number; alertLevel: Level; alertChance: string; alertWhy: 'one day' | '3 days';
}
export interface Forecast { lat: number; lon: number; floodLineMm: number; issued: string; squares: { lat: number; lon: number; weight: number }[]; days: Day[]; worst: Day }

const STEP = 0.25;
export const WATCH = { share: 0.1, threeDayMm: 40, burstMm: 20, soaked: 0.75 };
export const ALERT = { share: 0.2, threeDayMm: 50 };
export const THREE_DAY_MM = ALERT.threeDayMm;
// the day with the most runs counting, for the app; and for email alerts, by the stricter rule
export const risk = (d: Day) => d.runsFlagged;
export const riskiest = (days: Day[]) => days.reduce((a, b) => (risk(b) > risk(a) ? b : a));
export const alertRisk = (d: Day) => Math.max(d.runsOverLine, d.runsOver3Days);
export const alertRiskiest = (days: Day[]) => days.reduce((a, b) => (alertRisk(b) > alertRisk(a) ? b : a));

export const levelOf = (share: number): Level => (share >= 0.5 ? 'red' : share >= ALERT.share ? 'amber' : 'green');
export const watchLevelOf = (share: number): Level => (share >= 0.5 ? 'red' : share >= WATCH.share ? 'amber' : 'green');

// The simplest "k in n" within 3 points of the share: "3 in 4", not "37 in 51".
export function chanceWords(k: number, n: number): string {
  if (k === 0) return `none of ${n}`;
  if (k === n) return `all ${n}`;
  const p = k / n;
  if (p >= 0.95) return 'nearly all';
  for (const of of [2, 3, 4, 5, 10, 20, 50]) for (let a = 1; a < of; a++) if (Math.abs(a / of - p) <= 0.03) return `about ${a} in ${of}`;
  return `${k} in ${n}`;
}

// One day of the forecast from its runs' rain, all arrays in the same run order: `rain` the day's total,
// `three` the 3 days that end on it, `burst` the heaviest 3 hours. `j` is how many days after the
// forecast was made (0 is today). The time machine uses this too.
export function dayOf(day: string, j: number, rain: number[], line: number, three: number[], burst: number[], soaked = false): Day {
  const n = rain.length, k = soaked ? WATCH.soaked : 1;
  const lineMm = +(line * k).toFixed(1), threeDayMm = Math.round(WATCH.threeDayMm * k), burstMm = Math.round(WATCH.burstMm * k);
  let flagged = 0, byLine = 0, by3 = 0, byBurst = 0, overLine = 0, over3 = 0;
  for (let r = 0; r < n; r++) {
    const a = rain[r] >= lineMm, b = three[r] >= threeDayMm, c = burst[r] >= burstMm;
    if (a || b || c) flagged++;
    if (a) byLine++; if (b) by3++; if (c) byBurst++;
    if (rain[r] >= line) overLine++; if (three[r] >= ALERT.threeDayMm) over3++;
  }
  const sorted = [...rain].sort((a, b) => a - b), strict = Math.max(overLine, over3);
  const why: Why = byBurst > Math.max(byLine, by3) ? 'burst' : by3 > byLine ? '3 days' : 'one day';
  const date = new Date(day + 'T12:00:00Z'), weekday = date.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  // how to say the day: today, a weekday this week, or weekday and date further out (14 days repeat weekdays)
  const when = j === 0 ? 'today' : j === 1 ? 'tomorrow' : j < 7 ? weekday : date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return { day, weekday, when, runs: n, middleMm: +sorted[Math.floor(n / 2)].toFixed(1), wettestMm: +sorted[n - 1].toFixed(1),
    runsFlagged: flagged, why, lineMm, threeDayMm, burstMm, soaked, wettestBurstMm: +Math.max(...burst).toFixed(1),
    level: watchLevelOf(flagged / n), chance: chanceWords(flagged, n),
    runsOverLine: overLine, runsOver3Days: over3, alertLevel: levelOf(strict / n), alertChance: chanceWords(strict, n), alertWhy: over3 > overLine ? '3 days' : 'one day' };
}

// Each run's rain over the 3 days that end on day j (days before the first are not in the forecast).
export const threeDays = (perDay: number[][], j: number) => perDay[j].map((_, r) => perDay.slice(Math.max(0, j - 2), j + 1).reduce((a, d) => a + d[r], 0));

// Read the four squares hour by hour (the slow part, a network call). The flood line and whether the
// ground is soaked can arrive at the same time.
export async function readForecast(lat: number, lon: number, floodLineMm: number | Promise<number>, soakedGround: boolean | Promise<boolean> = false): Promise<Forecast> {
  const la0 = Math.floor(lat / STEP) * STEP, lo0 = Math.floor(lon / STEP) * STEP;
  const fy = (lat - la0) / STEP, fx = (lon - lo0) / STEP;
  const squares = [
    { lat: la0, lon: lo0, weight: (1 - fy) * (1 - fx) }, { lat: la0, lon: lo0 + STEP, weight: (1 - fy) * fx },
    { lat: la0 + STEP, lon: lo0, weight: fy * (1 - fx) }, { lat: la0 + STEP, lon: lo0 + STEP, weight: fy * fx },
  ].map((s) => ({ lat: +s.lat.toFixed(3), lon: +s.lon.toFixed(3), weight: +s.weight.toFixed(3) }));
  const url = 'https://ensemble-api.open-meteo.com/v1/ensemble?hourly=precipitation&models=ecmwf_ifs025&forecast_days=14&timezone=auto'
    + `&latitude=${squares.map((s) => s.lat).join(',')}&longitude=${squares.map((s) => s.lon).join(',')}`;
  const [res, line, soaked] = await Promise.all([fetchIn(url, 20000, 'The forecast service'), floodLineMm, soakedGround]);
  if (!res.ok) throw new Error(`forecast service answered ${res.status}`);
  const all = (await res.json()) as { hourly: Record<string, (number | null)[]> & { time: string[] } }[];
  const keys = Object.keys(all[0].hourly).filter((k) => k.startsWith('precipitation'));
  const time = all[0].hourly.time;
  // each run's blended rain per hour (runs in the same order everywhere, so totals follow one run)
  const hourly = keys.map((k) => time.map((_, h) => all.reduce((sum, p, i) => sum + squares[i].weight * (p.hourly[k]?.[h] ?? 0), 0)));
  const dayNames = [...new Set(time.map((t) => t.slice(0, 10)))];
  const first = (d: string) => time.findIndex((t) => t.startsWith(d));
  const perDay = dayNames.map((d) => { const a = first(d); return hourly.map((run) => run.slice(a, a + 24).reduce((x, y) => x + y, 0)); });
  // the heaviest 3 hours of each day, run by run (a window may start in the evening before)
  const bursts = dayNames.map((d) => { const a = first(d); return hourly.map((run) => { let top = 0; for (let h = a; h < a + 24 && h < run.length; h++) top = Math.max(top, run.slice(Math.max(0, h - 2), h + 1).reduce((x, y) => x + y, 0)); return top; }); });
  const days: Day[] = dayNames.map((day, j) => dayOf(day, j, perDay[j], line, threeDays(perDay, j), bursts[j], soaked));
  return { lat, lon, floodLineMm: line, issued: new Date().toISOString(), squares, days, worst: riskiest(days) };
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
