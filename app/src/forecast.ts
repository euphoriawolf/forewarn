// The forecast for a place, computed in code: the model never makes these numbers.
//
// ECMWF's 51-run forecast comes on a 0.25 degree grid (about 28 km). A place near the edge of a
// square would get one square's rain only, so we read the four squares around it and blend them
// by distance (bilinear), run by run and day by day. The level of each day comes from how many of
// the 51 blended runs reach the place's flood line.

export type Level = 'green' | 'amber' | 'red';
export interface Day { day: string; weekday: string; runsOverLine: number; runs: number; middleMm: number; wettestMm: number; level: Level; chance: string }
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

export async function readForecast(lat: number, lon: number, floodLineMm: number): Promise<Forecast> {
  const la0 = Math.floor(lat / STEP) * STEP, lo0 = Math.floor(lon / STEP) * STEP;
  const fy = (lat - la0) / STEP, fx = (lon - lo0) / STEP;
  const squares = [
    { lat: la0, lon: lo0, weight: (1 - fy) * (1 - fx) }, { lat: la0, lon: lo0 + STEP, weight: (1 - fy) * fx },
    { lat: la0 + STEP, lon: lo0, weight: fy * (1 - fx) }, { lat: la0 + STEP, lon: lo0 + STEP, weight: fy * fx },
  ].map((s) => ({ lat: +s.lat.toFixed(3), lon: +s.lon.toFixed(3), weight: +s.weight.toFixed(3) }));
  const url = 'https://ensemble-api.open-meteo.com/v1/ensemble?daily=precipitation_sum&models=ecmwf_ifs025&forecast_days=7&timezone=auto'
    + `&latitude=${squares.map((s) => s.lat).join(',')}&longitude=${squares.map((s) => s.lon).join(',')}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`forecast service answered ${res.status}`);
  const all = (await res.json()) as { daily: Record<string, (number | null)[]> & { time: string[] } }[];
  const keys = Object.keys(all[0].daily).filter((k) => k.startsWith('precipitation_sum'));
  const days: Day[] = all[0].daily.time.map((day, j) => {
    const runs = keys.map((k) => all.reduce((sum, p, i) => sum + squares[i].weight * (p.daily[k]?.[j] ?? 0), 0)).sort((a, b) => a - b);
    const over = runs.filter((x) => x >= floodLineMm).length;
    const weekday = new Date(day + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
    return { day, weekday, runs: runs.length, runsOverLine: over, middleMm: +runs[Math.floor(runs.length / 2)].toFixed(1), wettestMm: +runs[runs.length - 1].toFixed(1), level: levelOf(over / runs.length), chance: chanceWords(over, runs.length) };
  });
  const worst = days.reduce((a, b) => (b.runsOverLine > a.runsOverLine ? b : a));
  return { lat, lon, floodLineMm, issued: new Date().toISOString(), squares, days, worst };
}
