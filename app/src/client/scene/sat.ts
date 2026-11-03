// The last flood on the satellite map: Flood Check's water, hour by hour, drawn over Esri imagery with
// light hill shading. It keeps the interface the 3D scene had (Stage.tsx drives both the same way), in
// metres from the square's centre (x east, z south). The water comes in 60 m cells; it is read between
// cell centres so the edges come out soft, and each hour fades into the next. Buildings the water reached
// (10 cm or more at the building, from Flood Check's footprints) rise in red from the hour it got there.
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { tileSource, PinInPack } from './tiles';

maplibregl.setWorkerUrl(workerUrl);
type Source = ReturnType<typeof tileSource>;
interface Region { west: number; north: number; kx: number; ky: number }
type Cam = { tx: number; tz: number; zoom?: number; bearing?: number; pitch?: number };
const regions = new Map<string, Promise<Region>>();

// a 3D-scene distance (metres to the target) as a map zoom: 420 m was the street view
const zoomFor = (dist: number) => 16.7 - Math.log2(Math.max(150, dist) / 420);
const VIEWS: Record<string, { dist: number; pitch: number }> = { overview: { dist: 1500, pitch: 40 }, street: { dist: 420, pitch: 55 }, roads: { dist: 900, pitch: 35 } };

export async function satScene({ stage, source, pack, progress, onSettle, onView, drift = 0, start }: {
  stage: HTMLElement; source: Source; pack: PinInPack; progress?: (f: number, text: string) => void; onSettle?: (x: number, z: number) => void;
  onView?: (yaw: number) => void; drift?: number; start?: Cam;
}) {
  progress?.(0.1, 'Loading the map');
  if (!regions.has(pack.region)) regions.set(pack.region, fetch(`/tiles/${pack.region}/index.json`).then((r) => r.json() as Promise<Region>));
  const R = await regions.get(pack.region)!;
  const toLngLat = (x: number, z: number): [number, number] => [R.west + (pack.cx + x) / R.kx, R.north - (pack.cz + z) / R.ky];
  const fromLngLat = (lng: number, lat: number) => ({ x: (lng - R.west) * R.kx - pack.cx, z: (R.north - lat) * R.ky - pack.cz });

  const [{ grid: g }, life] = await Promise.all([source.ground(), source.life()]);
  progress?.(0.6, 'Loading the water');
  const cell = (cm: ArrayLike<number>, x: number, z: number) => {
    const i = Math.round((x - g.x0) / g.dx), j = Math.round((z - g.z0) / g.dz);
    return i < 0 || j < 0 || i >= g.w || j >= g.h ? 0 : cm[j * g.w + i];
  };
  const peak = new Float32Array(g.w * g.h);
  for (const h of life.cm) for (let i = 0; i < peak.length; i++) peak[i] = Math.max(peak[i], h[i]);

  // the water canvas: 8 px per cell, placed on the map by its four corners
  const S = 8, cv = document.createElement('canvas'); cv.width = g.w * S; cv.height = g.h * S;
  const ctx = cv.getContext('2d')!, img = ctx.createImageData(cv.width, cv.height);
  const half = { x: g.dx / 2, z: g.dz / 2 }, x1 = g.x0 + (g.w - 1) * g.dx, z1 = g.z0 + (g.h - 1) * g.dz;
  const corners = [toLngLat(g.x0 - half.x, g.z0 - half.z), toLngLat(x1 + half.x, g.z0 - half.z), toLngLat(x1 + half.x, z1 + half.z), toLngLat(g.x0 - half.x, z1 + half.z)] as [[number, number], [number, number], [number, number], [number, number]];
  const smooth = (e0: number, e1: number, v: number) => { const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const at = (a: ArrayLike<number>, i: number, j: number) => a[Math.max(0, Math.min(g.h - 1, j)) * g.w + Math.max(0, Math.min(g.w - 1, i))];
  const empty = new Float32Array(g.w * g.h);
  let from: ArrayLike<number> = empty, to: ArrayLike<number> = empty, mixStart = 0, mixing = false;
  function draw(f: number) {
    const d = img.data;
    for (let y = 0; y < cv.height; y++) {
      const gy = y / S - 0.5, j = Math.floor(gy), fy = gy - j;
      for (let x = 0; x < cv.width; x++) {
        const gx = x / S - 0.5, i = Math.floor(gx), fx = gx - i;
        const v = (a: ArrayLike<number>) => (at(a, i, j) * (1 - fx) + at(a, i + 1, j) * fx) * (1 - fy) + (at(a, i, j + 1) * (1 - fx) + at(a, i + 1, j + 1) * fx) * fy;
        const depth = v(from) * (1 - f) + v(to) * f, k = (y * cv.width + x) * 4;
        if (depth < 2) { d[k + 3] = 0; continue; }
        const deep = smooth(5, 150, depth), edge = smooth(0, 3 * S, Math.min(x, y, cv.width - 1 - x, cv.height - 1 - y));
        d[k] = 120 - 110 * deep; d[k + 1] = 190 - 148 * deep; d[k + 2] = 255 - 133 * deep;
        d[k + 3] = 255 * edge * Math.min(0.72, smooth(3, 25, depth) * (0.4 + 0.32 * deep));
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  draw(1);

  const startCam = start ?? { tx: pack.dx, tz: pack.dz };
  const map = new maplibregl.Map({
    container: stage, center: toLngLat(startCam.tx, startCam.tz), zoom: startCam.zoom ?? zoomFor(VIEWS.overview.dist), pitch: startCam.pitch ?? VIEWS.overview.pitch,
    bearing: startCam.bearing ?? -12, maxPitch: 65, maxZoom: 18.5, attributionControl: false, fadeDuration: 0, canvasContextAttributes: { preserveDrawingBuffer: true },
    style: {
      version: 8,
      state: { hour: { default: -1 } },
      sources: {
        img: { type: 'raster', tileSize: 256, maxzoom: 19, attribution: 'Imagery: Esri, Maxar, Earthstar Geographics', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'] },
        dem: { type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 14, attribution: 'Terrain: Mapzen, AWS Open Data', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'] },
        water: { type: 'canvas', canvas: cv, coordinates: corners, animate: true } as unknown as maplibregl.SourceSpecification, // canvas sources work, but are missing from the style types
        roads: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        houses: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      },
      layers: [
        { id: 'img', type: 'raster', source: 'img' },
        { id: 'relief', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': 'rgba(0,0,0,.55)', 'hillshade-highlight-color': 'rgba(255,255,255,.12)', 'hillshade-accent-color': 'rgba(0,0,0,0)' } },
        { id: 'water', type: 'raster', source: 'water', paint: { 'raster-resampling': 'linear', 'raster-fade-duration': 0 } },
        { id: 'houses', type: 'fill-extrusion', source: 'houses', filter: ['all', ['has', 'w'], ['<=', ['get', 'w'], ['global-state', 'hour']]], paint: { 'fill-extrusion-color': '#d4342a', 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.88, 'fill-extrusion-vertical-gradient': true } },
        { id: 'roads-edge', type: 'line', source: 'roads', paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.85 }, layout: { 'line-cap': 'round', 'line-join': 'round' } },
        { id: 'roads', type: 'line', source: 'roads', paint: { 'line-color': ['case', ['get', 'wet'], '#b42318', '#2f7d4f'], 'line-width': 4 }, layout: { 'line-cap': 'round', 'line-join': 'round' } },
      ],
    },
  });
  (window as unknown as { fwMap: maplibregl.Map }).fwMap = map; // recorders wait on fwMap.areTilesLoaded()
  map.dragRotate.enable(); map.touchZoomRotate.enableRotation();
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-right'); // the clock and the zoom buttons sit at the bottom
  // folded to its (i) until tapped: MapLibre opens the credit on the first data that carries one, and open
  // it lies under the chips on a phone. This listener runs after the control's own, so it folds it straight back.
  const fold = () => { const a = stage.querySelector('.maplibregl-ctrl-attrib'); if (a?.classList.contains('maplibregl-compact-show')) { a.classList.remove('maplibregl-compact-show'); map.off('sourcedata', fold); } };
  map.on('sourcedata', fold);
  // 'load' can wait a long time while the animated water keeps the sources busy: the style is enough to start
  await new Promise<void>((ok) => { map.once('load', () => ok()); map.once('style.load', () => setTimeout(ok, 800)); });
  progress?.(1, '');

  // roads come from the city files, only for "light the roads"
  const roads: { n: string; p: [number, number][] }[] = [];
  source.city().then((c) => {
    roads.push(...c.roads);
    // each building: the first hour the water at it reached 10 cm, and its height (1 storey when unknown)
    const features = c.buildings.flatMap((bd) => {
      const n = bd.p.length, cx = bd.p.reduce((a, q) => a + q[0], 0) / n, cz = bd.p.reduce((a, q) => a + q[1], 0) / n;
      if (cell(peak, cx, cz) < 10) return [];
      const w = life.cm.findIndex((cm) => cell(cm, cx, cz) >= 10);
      const ring = bd.p.map(([x, z]) => toLngLat(x, z)); ring.push(ring[0]);
      return [{ type: 'Feature' as const, properties: { w, h: Math.max(3.5, bd.h || 0) }, geometry: { type: 'Polygon' as const, coordinates: [ring] } }];
    });
    (map.getSource('houses') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features });
  }).catch(() => {});

  let inset = 0, frameFn: ((t: number) => void) | null = null, raf = 0, gone = false;
  const tags: maplibregl.Marker[] = [];
  const loop = (t: number) => {
    if (gone) return;
    if (mixing) { const f = Math.min(1, (t - mixStart) / 350); draw(f); if (f >= 1) mixing = false; }
    frameFn?.(t);
    if (drift && !map.isMoving()) map.setBearing(map.getBearing() + drift * 60); // never during a fly, which a bearing change would cancel
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  map.on('rotate', () => onView?.((-map.getBearing() * Math.PI) / 180));
  map.on('moveend', () => { const c = map.getCenter(), p = fromLngLat(c.lng, c.lat); onSettle?.(p.x, p.z); });

  const fly = (x: number, z: number, dist: number, pitch: number) => map.flyTo({ center: toLngLat(x, z), zoom: zoomFor(dist), pitch, duration: 1600, essential: true, padding: { top: 0, left: 0, right: 0, bottom: inset } });
  return {
    hours: life.cm.length, cmAt: (h: number) => life.cm[h], peak, start: life.start, roads,
    depthAt: (cm: ArrayLike<number>, x: number, z: number) => Math.round(cell(cm, x, z)),
    setWater(cm: ArrayLike<number> | null) {
      // fade from what is on screen to the new hour
      const now = performance.now();
      if (mixing) draw(Math.min(1, (now - mixStart) / 350));
      from = to; to = cm ?? empty; mixStart = now; mixing = true;
      map.setGlobalStateProperty('hour', cm === null ? -1 : cm === peak ? 1e6 : life.cm.indexOf(cm as number[]));
    },
    lightRoads(names: string[] | null) {
      const features = (names ?? []).flatMap((n) => roads.filter((r) => r.n === n).flatMap((r) => r.p.slice(1).map((b, k) => {
        const a = r.p[k], wet = cell(peak, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2) >= 10 || cell(peak, a[0], a[1]) >= 10 || cell(peak, b[0], b[1]) >= 10;
        return { type: 'Feature' as const, properties: { wet }, geometry: { type: 'LineString' as const, coordinates: [toLngLat(a[0], a[1]), toLngLat(b[0], b[1])] } };
      })));
      (map.getSource('roads') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features });
    },
    tag(text: string, x: number, z: number, cls = '') {
      const holder = document.createElement('div'), el = document.createElement('div');
      el.className = 'tag ' + cls; el.textContent = text; holder.appendChild(el);
      const m = new maplibregl.Marker({ element: holder }).setLngLat(toLngLat(x, z)).addTo(map); tags.push(m);
      return el;
    },
    view(name: string, o: Record<string, number> = {}) {
      const v = VIEWS[name] ?? VIEWS.street;
      // the 3D views gave pitch as a camera angle in radians (0.28 high to 1.05 low): here a map tilt in degrees
      const pitch = o.pitch !== undefined ? Math.max(20, Math.min(62, 66 - o.pitch * 40)) : v.pitch;
      fly(o.tx ?? pack.dx, o.tz ?? pack.dz, o.dist ?? v.dist, pitch);
    },
    camera(): Cam { const c = map.getCenter(), p = fromLngLat(c.lng, c.lat); return { tx: p.x, tz: p.z, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }; },
    onFrame(fn: ((t: number) => void) | null) { frameFn = fn; },
    zoom(f: number) { map.easeTo({ zoom: map.getZoom() - Math.log2(f), duration: 400 }); },
    north() { map.easeTo({ bearing: 0, duration: 500 }); },
    setInset(px: number) { inset = Math.max(0, px); map.easeTo({ padding: { top: 0, left: 0, right: 0, bottom: inset }, duration: 380 }); },
    dispose() { gone = true; cancelAnimationFrame(raf); for (const m of tags) m.remove(); map.remove(); },
  };
}
