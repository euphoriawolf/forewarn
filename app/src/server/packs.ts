// Place packs: the 3 km squares with 3D data (public/packs, made by tools/make-pack.py from
// Flood Check data). A pin gets a pack when it sits well inside one.
import index from '../../public/packs/index.json';

export interface Pack { id: string; region: string; name: string; where: string; lat: number; lon: number; half: number; start: string }
export interface PinInPack { id: string; name: string; start: string; dx: number; dz: number } // pin offset from the pack centre, metres (x east, z south)

const metres = (p: Pack, lat: number, lon: number) => ({ dx: (lon - p.lon) * 111320 * Math.cos((p.lat * Math.PI) / 180), dz: -(lat - p.lat) * 110574 });

export function packFor(lat: number, lon: number): PinInPack | null {
  let best: (PinInPack & { d: number }) | null = null;
  for (const p of index.packs as Pack[]) {
    const { dx, dz } = metres(p, lat, lon), d = Math.max(Math.abs(dx), Math.abs(dz));
    if (d < p.half - 400 && (!best || d < best.d)) best = { id: p.id, name: p.name, start: p.start, dx: Math.round(dx), dz: Math.round(dz), d };
  }
  if (!best) return null;
  const { d: _, ...pin } = best;
  return pin;
}

interface Grid { x0: number; z0: number; dx: number; dz: number; w: number; h: number }
interface Road { k: string; n: string; p: [number, number][] }

// For named roads in a pack: how much of each road had 10 cm of water or more in the last storm.
export async function roadsCheck(assets: Fetcher, packId: string, wanted: string[]) {
  const get = (f: string) => assets.fetch(`http://localhost/packs/${packId}/${f}`).then((r) => r.json());
  const [G, C, L] = (await Promise.all([get('ground.json'), get('city.json'), get('life.json')])) as [{ grid: Grid }, { roads: Road[] }, { cm: number[][] }];
  const g = G.grid, peak = new Float32Array(g.w * g.h);
  for (const h of L.cm) for (let i = 0; i < peak.length; i++) if (h[i] > peak[i]) peak[i] = h[i];
  const at = (x: number, z: number) => {
    const i = Math.round((x - g.x0) / g.dx), j = Math.round((z - g.z0) / g.dz);
    return i < 0 || j < 0 || i >= g.w || j >= g.h ? 0 : peak[j * g.w + i];
  };
  const names = [...new Set(C.roads.map((r) => r.n).filter(Boolean))];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  return wanted.map((w) => {
    const name = names.find((n) => norm(n) === norm(w)) ?? names.find((n) => norm(n).includes(norm(w)) || norm(w).includes(norm(n)));
    if (!name) return { asked: w, found: false, nearby: names.slice(0, 12) };
    const pts = C.roads.filter((r) => r.n === name).flatMap((r) => r.p), depths = pts.map(([x, z]) => at(x, z));
    const wet = depths.filter((d) => d >= 10).length;
    return { asked: w, found: true, name, pointsChecked: pts.length, pointsWithWater: wet, deepestCm: Math.round(Math.max(0, ...depths)), stayedDry: wet === 0 };
  });
}
