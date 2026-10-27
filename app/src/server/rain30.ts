// How wet the ground already is: rain over the last 30 days at the place, against normal for those
// 30 days of the year. Soaked ground floods sooner (the Nairobi flood of 23 April 2024 came after 30 days
// at twice normal); on a farm, the same reading shows a season running dry.
// Recent rain: Open-Meteo (model analysis, the 4 nearest forecast points blended like the forecast).
// Normal: CHIRPS 1991 to 2020, monthly means per 0.25 degree square (public/normals, tools/make-normals.py).
// Two sources: a "close to normal" band of 0.8 to 1.25 absorbs the usual difference between them.

const W = 300, H = 320, WEST = -20, NORTH = 40, CELL = 0.25, NODATA = 65535;
let normals: Promise<Uint16Array> | null = null;

export interface Rain30 { days: number; from: string; to: string; mm: number; normalMm: number; timesNormal: number; word: string; groundSoaked: boolean; source: string }

const WORDS: [number, string][] = [[0.5, 'much drier than normal'], [0.8, 'drier than normal'], [1.25, 'close to normal'], [2, 'wetter than normal'], [Infinity, 'much wetter than normal, more than twice the usual rain']];

export async function rainLast30(assets: Fetcher, lat: number, lon: number): Promise<Rain30> {
  normals ??= assets.fetch('http://localhost/normals/chirps-1991-2020.bin').then(async (r) => {
    if (!r.ok) throw new Error(`normals answered ${r.status}`);
    return new Uint16Array(await r.arrayBuffer());
  }).catch((e) => { normals = null; throw e; });
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=precipitation_sum&past_days=30&forecast_days=1&timezone=auto`;
  const [grid, res] = await Promise.all([normals, fetch(url)]);
  if (!res.ok) throw new Error(`rain service answered ${res.status}`);
  const d = (await res.json()) as { daily: { time: string[]; precipitation_sum: (number | null)[] } };
  const times = d.daily.time.slice(0, 30), mm = d.daily.precipitation_sum.slice(0, 30).reduce<number>((a, v) => a + (v ?? 0), 0);

  // the normal: the 3 x 3 squares around the place (as the analysis did), each day taking its month's mean
  const r0 = Math.floor((NORTH - lat) / CELL), c0 = Math.floor((lon - WEST) / CELL);
  if (r0 < 1 || c0 < 1 || r0 >= H - 1 || c0 >= W - 1) throw new Error('outside Africa');
  const monthMean = (m: number) => {
    let s = 0, n = 0;
    for (let r = r0 - 1; r <= r0 + 1; r++) for (let c = c0 - 1; c <= c0 + 1; c++) { const v = grid[m * W * H + r * W + c]; if (v !== NODATA) { s += v / 100; n++; } }
    if (!n) throw new Error('no normal here (sea)');
    return s / n;
  };
  const normalMm = times.reduce((a, t) => a + monthMean(Number(t.slice(5, 7)) - 1), 0);
  const timesNormal = mm / Math.max(normalMm, 0.1);
  return {
    days: 30, from: times[0], to: times.at(-1)!, mm: Math.round(mm), normalMm: Math.round(normalMm), timesNormal: +timesNormal.toFixed(1),
    word: WORDS.find(([k]) => timesNormal < k)![1], groundSoaked: timesNormal >= 1.5 && mm >= 100,
    source: 'Last 30 days: Open-Meteo. Normal: CHIRPS 1991 to 2020.',
  };
}
