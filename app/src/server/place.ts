// A place's flood line and its last flood, and place search.
//
// Inside Lagos and Nairobi, Flood Check (a pre-existing project by the same author, used here only
// through its public API) has an hour-by-hour model of the last big storm. From it we take when the
// water at the pin first reached 10 cm and how deep it got. The rain that caused it comes from the
// ECMWF archive (Open-Meteo), read here for this place: the 24 hours before the water came. If
// those 24 hours hold less than half the storm's wettest day, the water came mostly from upstream
// (a river), so the line is the storm's wettest day instead, and the note says so.
// Everywhere else the line is heavy rain: 30 mm in a day.

export interface FloodLine {
  mm: number;
  source: 'last-flood' | 'heavy-rain';
  note: string;
  lastFlood?: { event: string; region: string; peakCm: number; peakTime: string | null; firstWet: string | null; river: boolean };
}

interface Region { id: string; bbox: [number, number, number, number]; first: string; last: string; event: string; timezone: string }
let regions: Region[] | null = null;

export async function floodLine(api: string, lat: number, lon: number): Promise<FloodLine> {
  const heavy: FloodLine = { mm: 30, source: 'heavy-rain', note: 'No street flood model here yet, so the line is heavy rain: 30 mm in a day.' };
  regions ??= ((await fetch(`${api}/regions`).then((r) => r.json())) as { regions: Region[] }).regions;
  const reg = regions.find((r) => lon >= r.bbox[0] && lon <= r.bbox[2] && lat >= r.bbox[1] && lat <= r.bbox[3]);
  if (!reg) return heavy;
  const d = (await fetch(`${api}/depth?lat=${lat}&lon=${lon}`).then((r) => (r.ok ? r.json() : null))) as
    | { times: string[]; depth_cm: number[]; peak: { depth_cm: number; time: string | null }; open_water: boolean } | null;
  if (!d || d.open_water) return heavy;
  const start = reg.first.slice(0, 10), end = reg.last.slice(0, 10);
  const arch = (await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${start}&end_date=${end}&hourly=precipitation&models=ecmwf_ifs&timezone=${encodeURIComponent(reg.timezone)}`).then((r) => r.json())) as { hourly: { time: string[]; precipitation: (number | null)[] } };
  const rain = d.times.map((t) => arch.hourly.precipitation[arch.hourly.time.indexOf(t)] ?? 0);
  const sum24 = (end: number) => rain.slice(Math.max(0, end - 23), end + 1).reduce((a, b) => a + b, 0);
  const wettest = Math.max(...rain.map((_, i) => sum24(i)));
  const first = d.depth_cm.findIndex((c) => c >= 10);
  const round = (v: number) => Math.round(v * 10) / 10;
  const lastFlood = { event: reg.event, region: reg.id, peakCm: d.peak.depth_cm, peakTime: d.peak.time, firstWet: first >= 0 ? d.times[first] : null, river: false };
  if (first < 0) return { mm: round(wettest), source: 'last-flood', lastFlood, note: `The storm of ${reg.event} did not flood this spot. Its wettest day here brought ${round(wettest)} mm.` };
  const before = sum24(first);
  if (before < wettest / 2) return { mm: round(wettest), source: 'last-flood', lastFlood: { ...lastFlood, river: true }, note: `In the storm of ${reg.event} the water here came mostly from upstream. The line is the storm's wettest day: ${round(wettest)} mm.` };
  return { mm: round(before), source: 'last-flood', lastFlood, note: `In the storm of ${reg.event}, ${round(before)} mm of rain in a day flooded this spot.` };
}

// Place search across Africa, from OpenStreetMap through Photon.
// The name of the place at a point (the street, then the area), for a place found by GPS or a report.
export async function placeName(lat: number, lon: number): Promise<{ name: string; where: string } | null> {
  const tidy = (name: string, parts: (string | undefined)[]) => ({ name, where: parts.filter((x, i, a) => x && x !== name && a.indexOf(x) === i).join(', ') });
  // Photon first (the same service as search); OpenStreetMap's Nominatim when Photon does not answer
  const r = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&limit=1`, { headers: { 'User-Agent': 'Forewarn (hackathon prototype)' } }).catch(() => null);
  const p = r?.ok ? ((await r.json()) as { features: { properties: Record<string, string> }[] }).features[0]?.properties : undefined;
  if (p) return tidy(p.name ?? p.street ?? p.locality ?? p.district ?? p.city ?? 'Unnamed place', [p.locality ?? p.district, p.city ?? p.county, p.country]);
  const n = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=${lat}&lon=${lon}`, { headers: { 'User-Agent': 'Forewarn/0.1 (https://forewarn.dawnstackai.com)', 'Accept-Language': 'en' } }).catch(() => null);
  if (!n?.ok) return null;
  const a = ((await n.json()) as { address?: Record<string, string> }).address;
  if (!a) return null;
  return tidy(a.road ?? a.neighbourhood ?? a.suburb ?? a.city ?? 'Unnamed place', [a.suburb ?? a.neighbourhood, a.city ?? a.town ?? a.county, a.country]);
}

export async function search(q: string) {
  const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&bbox=-26,-35,52,38`, { headers: { 'User-Agent': 'Forewarn (hackathon prototype)' } });
  const d = (await r.json()) as { features: { geometry: { coordinates: [number, number] }; properties: Record<string, string> }[] };
  return d.features.map((f) => {
    const p = f.properties;
    const name = p.name ?? p.street ?? p.city ?? 'Unnamed place';
    const where = [p.district ?? p.locality, p.city ?? p.county, p.state, p.country].filter((x, i, a) => x && x !== name && a.indexOf(x) === i).join(', ');
    return { name, where, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] };
  });
}
