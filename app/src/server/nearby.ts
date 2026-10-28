// What is near a place that matters, so the map always has somewhere to go even when the pin itself
// stayed dry: approved flood reports within 5 km (last 48 hours) and the past floods of the time
// machine within 200 km. Each one has its distance and direction from the pin, computed here.
// (The nearest street that flooded in the last storm comes with /api/place, for Lagos and Nairobi.)
import { reportsOf } from './reports';
import type { Env } from './harness';

export interface Point { kind: 'report' | 'past'; id?: number; title: string; detail: string; lat: number; lon: number; m: number; direction: string }

const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export function from(lat: number, lon: number, lat2: number, lon2: number) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), dx = (lon2 - lon) * kx, dy = (lat2 - lat) * 110574;
  const deg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return { m: Math.round(Math.hypot(dx, dy)), direction: DIRS[Math.round(deg / 45) % 8] };
}

let past: Promise<{ floods: { label: string; country: string; peak: string; lat: number; lon: number; reports: number; runs: Record<string, unknown> }[] }> | null = null;

export async function nearby(env: Env, lat: number, lon: number): Promise<Point[]> {
  past ??= env.ASSETS.fetch('http://localhost/past/floods.json').then((r) => r.json() as Promise<NonNullable<Awaited<typeof past>>>).catch((e) => { past = null; throw e; });
  const [reports, { floods }] = await Promise.all([reportsOf(env.Reports).near(lat, lon).catch(() => []), past]);
  const ago = (at: string) => { const h = Math.round((Date.now() - Date.parse(at)) / 3600e3); return h < 1 ? 'just now' : h === 1 ? '1 hour ago' : `${h} hours ago`; };
  const out: Point[] = reports.map((r) => ({ kind: 'report' as const, title: 'Flood report', detail: `Water to ${r.reaches}, ${ago(r.at)}`, lat: r.lat, lon: r.lon, ...from(lat, lon, r.lat, r.lon) }));
  const near = floods.map((f, id) => ({ f, id, ...from(lat, lon, f.lat, f.lon) })).filter((x) => x.m <= 200000).sort((a, b) => a.m - b.m).slice(0, 3);
  for (const { f, id, m, direction } of near) {
    const day = new Date(f.peak + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    out.push({ kind: 'past', id, title: `Flood in ${f.label}`, detail: `${day}, ${f.reports} news reports`, lat: f.lat, lon: f.lon, m, direction });
  }
  return out.sort((a, b) => a.m - b.m);
}
