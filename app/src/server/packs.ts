// The 3D around a pin: four 2 km tiles (public/tiles, made by tools/make-tiles.py from Flood Check
// data) that make a 4 km square with the pin no more than 1 km from its centre. Lagos and Nairobi
// are covered; elsewhere there is no 3D yet.
import lagos from '../../public/tiles/lagos/index.json';
import nairobi from '../../public/tiles/nairobi/index.json';

interface RegionIndex { region: string; tile: number; west: number; north: number; kx: number; ky: number; cmx: number; cmz: number; cols: number; rows: number; start: string; tiles: number[][] }
const REGIONS = [lagos, nairobi] as RegionIndex[];

// what the page needs to load the 3D: which tiles, and where the pin sits from the square's centre (m, x east, z south)
export interface PinInPack { region: string; tiles: [number, number][]; cx: number; cz: number; dx: number; dz: number; start: string }

export function packFor(lat: number, lon: number): PinInPack | null {
  for (const r of REGIONS) {
    const px = (lon - r.west) * r.kx, pz = (r.north - lat) * r.ky;
    if (px < 0 || pz < 0 || px > r.cols * r.tile || pz > r.rows * r.tile) continue;
    const i0 = Math.round(px / r.tile) - 1, j0 = Math.round(pz / r.tile) - 1;
    const have = new Set(r.tiles.map(([i, j]) => `${i}_${j}`));
    const tiles = ([[i0, j0], [i0 + 1, j0], [i0, j0 + 1], [i0 + 1, j0 + 1]] as [number, number][]).filter(([i, j]) => have.has(`${i}_${j}`));
    if (!tiles.length) return null;
    const cx = (i0 + 1) * r.tile, cz = (j0 + 1) * r.tile;
    return { region: r.region, tiles, cx, cz, dx: Math.round(px - cx), dz: Math.round(pz - cz), start: r.start };
  }
  return null;
}

interface Ground { ci0: number; cj0: number; w: number; h: number }
interface City { roads: { k: string; n: string; p: [number, number][] }[] }
interface Life { water: { c: number; cm: number[] }[] }

// For named roads around a pin: how much of each road had 10 cm of water or more in the last storm.
export async function roadsCheck(assets: Fetcher, pin: PinInPack, wanted: string[]) {
  const r = REGIONS.find((x) => x.region === pin.region)!;
  const get = <T,>(i: number, j: number, f: string) => assets.fetch(`http://localhost/tiles/${pin.region}/${i}_${j}/${f}`).then((x) => x.json() as Promise<T>);
  const peak = new Map<number, number>(); // region cell (cj * 100000 + ci) -> deepest cm
  const roads: { n: string; p: [number, number][] }[] = [];
  await Promise.all(pin.tiles.map(async ([i, j]) => {
    const [g, c, l] = await Promise.all([get<Ground>(i, j, 'ground.json'), get<City>(i, j, 'city.json'), get<Life>(i, j, 'life.json')]);
    for (const w of l.water) {
      const ci = g.ci0 + (w.c % g.w), cj = g.cj0 + Math.floor(w.c / g.w), key = cj * 100000 + ci;
      peak.set(key, Math.max(peak.get(key) ?? 0, ...w.cm));
    }
    // road points are 0.5 m steps from the tile corner: turn them into region metres
    for (const rd of c.roads) roads.push({ n: rd.n, p: rd.p.map(([x, z]) => [i * r.tile + x / 2, j * r.tile + z / 2]) });
  }));
  const at = ([x, z]: [number, number]) => peak.get(Math.floor(z / r.cmz) * 100000 + Math.floor(x / r.cmx)) ?? 0;
  const names = [...new Set(roads.map((x) => x.n).filter(Boolean))];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  return wanted.map((w) => {
    const name = names.find((n) => norm(n) === norm(w)) ?? names.find((n) => norm(n).includes(norm(w)) || norm(w).includes(norm(n)));
    if (!name) return { asked: w, found: false, nearby: names.slice(0, 12) };
    const depths = roads.filter((x) => x.n === name).flatMap((x) => x.p).map(at);
    const wet = depths.filter((d) => d >= 10).length;
    return { asked: w, found: true, name, pointsChecked: depths.length, pointsWithWater: wet, deepestCm: Math.round(Math.max(0, ...depths)), stayedDry: wet === 0 };
  });
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

// The nearest spot to the pin where the last storm's water reached 10 cm or more, within the four
// tiles around it. x and z are metres from the view's centre, so the 3D can point at it.
export async function nearestFlood(assets: Fetcher, pin: PinInPack) {
  const r = REGIONS.find((x) => x.region === pin.region)!;
  const get = <T,>(i: number, j: number, f: string) => assets.fetch(`http://localhost/tiles/${pin.region}/${i}_${j}/${f}`).then((x) => x.json() as Promise<T>);
  const px = pin.cx + pin.dx, pz = pin.cz + pin.dz;
  let best: { d: number; x: number; z: number; cm: number; hour: number } | null = null;
  await Promise.all(pin.tiles.map(async ([i, j]) => {
    const [g, l] = await Promise.all([get<Ground>(i, j, 'ground.json'), get<Life>(i, j, 'life.json')]);
    for (const w of l.water) {
      const top = Math.max(...w.cm); if (top < 10) continue;
      const x = (g.ci0 + (w.c % g.w) + 0.5) * r.cmx, z = (g.cj0 + Math.floor(w.c / g.w) + 0.5) * r.cmz, d = Math.hypot(x - px, z - pz);
      if (!best || d < best.d) best = { d, x, z, cm: top, hour: w.cm.indexOf(top) };
    }
  }));
  if (!best) return null;
  const b = best as { d: number; x: number; z: number; cm: number; hour: number };
  const ang = Math.atan2(b.x - px, -(b.z - pz)); // 0 = north, clockwise
  const t = new Date(Date.parse(r.start + ':00Z') + b.hour * 3600e3).toISOString().slice(0, 13) + ':00';
  return { distanceM: Math.round(b.d / 10) * 10, direction: COMPASS[Math.round(((ang / (2 * Math.PI)) * 8 + 8)) % 8], peakCm: b.cm, peakTime: t, here: b.d < 45, x: Math.round(b.x - pin.cx), z: Math.round(b.z - pin.cz) };
}
