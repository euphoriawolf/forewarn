// The forecast for a place, computed in code: the model never makes these numbers. 14 days, the
// length of the 51-run forecast, then a weekly outlook out to about a month (outlookWeeks).
//
// ECMWF's 51-run forecast comes on a 0.25 degree grid (about 28 km). A place near the edge of a
// square would get one square's rain only, so we read the four squares around it and blend them
// by distance (bilinear), run by run and day by day. The level of each day comes from how many of
// the 51 blended runs reach the place's flood line.

export type Level = 'green' | 'amber' | 'red';
export interface Day { day: string; weekday: string; when: string; runsOverLine: number; runs: number; middleMm: number; wettestMm: number; level: Level; chance: string }
export interface Forecast { lat: number; lon: number; floodLineMm: number; issued: string; squares: { lat: number; lon: number; weight: number }[]; days: Day[]; worst: Day }

const STEP = 0.25;

export const levelOf = (share: number): Level => (share >= 0.5 ? 'red' : share >= 0.2 ? 'amber' : 'green');

// The simplest "k in n" within 3 points of the share: "3 in 4", not "37 in 51".
export function chanceWords(k: number, n: number): string {
  if (k === 0) return `none of ${n}`;
  const p = k / n;
  for (const of of [2, 3, 4, 5, 10, 20, 50]) for (let a = 1; a < of; a++) if (Math.abs(a / of - p) <= 0.03) return `about ${a} in ${of}`;
  return `${k} in ${n}`;
}

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
  const [res, line] = await Promise.all([fetch(url), floodLineMm]);
  floodLineMm = line;
  if (!res.ok) throw new Error(`forecast service answered ${res.status}`);
  const all = (await res.json()) as { daily: Record<string, (number | null)[]> & { time: string[] } }[];
  const keys = Object.keys(all[0].daily).filter((k) => k.startsWith('precipitation_sum'));
  const days: Day[] = all[0].daily.time.map((day, j) => {
    const runs = keys.map((k) => all.reduce((sum, p, i) => sum + squares[i].weight * (p.daily[k]?.[j] ?? 0), 0)).sort((a, b) => a - b);
    const over = runs.filter((x) => x >= line).length;
    const date = new Date(day + 'T12:00:00Z'), weekday = date.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
    // how to say the day: today, a weekday this week, or weekday and date further out (14 days repeat weekdays)
    const when = j === 0 ? 'today' : j < 7 ? weekday : date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    return { day, weekday, when, runs: runs.length, runsOverLine: over, middleMm: +runs[Math.floor(runs.length / 2)].toFixed(1), wettestMm: +runs[runs.length - 1].toFixed(1), level: levelOf(over / runs.length), chance: chanceWords(over, runs.length) };
  });
  const worst = days.reduce((a, b) => (b.runsOverLine > a.runsOverLine ? b : a));
  return { lat, lon, floodLineMm: line, issued: new Date().toISOString(), squares, days, worst };
}

// Beyond 14 days there is no useful flood chance, only whether rain will be above or below normal.
// ECMWF's extended range (Open-Meteo seasonal API, EC46 then SEAS5) gives per week the share of its
// runs above normal. 50% means no signal either way.
export interface Week { start: string; aboveNormalPct: number; meanMm: number; word: 'wetter than normal' | 'near normal' | 'drier than normal' }
export async function outlookWeeks(lat: number, lon: number, after: string): Promise<Week[]> {
  const r = await fetch(`https://seasonal-api.open-meteo.com/v1/seasonal?latitude=${lat}&longitude=${lon}&weekly=precipitation_anomaly_gt0,precipitation_mean&models=ecmwf_seasonal_ensemble_mean_seamless&forecast_days=46`);
  if (!r.ok) return [];
  const d = (await r.json()) as { weekly: { time: string[]; precipitation_anomaly_gt0: (number | null)[]; precipitation_mean: (number | null)[] } };
  const end = new Date(Date.parse(after + 'T00:00:00Z') + 31 * 86400e3).toISOString().slice(0, 10);
  return d.weekly.time.flatMap((start, i) => {
    const pct = d.weekly.precipitation_anomaly_gt0[i], mm = d.weekly.precipitation_mean[i];
    if (pct === null || mm === null || start <= after || start > end) return [];
    return [{ start, aboveNormalPct: Math.round(pct), meanMm: Math.round(mm), word: pct >= 65 ? 'wetter than normal' : pct <= 35 ? 'drier than normal' : 'near normal' }];
  });
}
