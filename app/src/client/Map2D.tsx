// The map for places outside Lagos and Nairobi (no 3D there yet): the satellite map with the pin, the
// forecast squares the answer blends, and the points from the "near" list. A point off the screen
// shows as an arrow on the edge with its distance; a tap on the arrow flies there.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { pinLabel, type Place } from './types';
import { distance, type NearPoint } from './Near';

maplibregl.setWorkerUrl(workerUrl);
// the same imagery as the pin map (Esri World Imagery, credit shown)
const SATELLITE: maplibregl.StyleSpecification = {
  version: 8,
  sources: { img: { type: 'raster', tileSize: 256, maxzoom: 19, attribution: 'Imagery: Esri, Maxar, Earthstar Geographics', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'] } },
  layers: [{ id: 'img', type: 'raster', source: 'img' }],
};

export interface Map2DApi { show: (p: NearPoint) => void }
interface Arrow { i: number; x: number; y: number; deg: number }

export const Map2D = forwardRef<Map2DApi, { place: Place; points: NearPoint[]; squares?: { lat: number; lon: number }[]; inset?: number }>(function Map2D({ place, points, squares, inset = 0 }, ref) {
  const box = useRef<HTMLDivElement>(null), map = useRef<maplibregl.Map | null>(null);
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const pts = points.filter((p) => p.lat !== undefined && p.lon !== undefined);

  useEffect(() => {
    const m = new maplibregl.Map({ container: box.current!, style: SATELLITE, center: [place.lon, place.lat], zoom: 13, maxZoom: 18, attributionControl: { compact: true } });
    map.current = m;
    const pin = document.createElement('div'); pin.className = 'mk pin'; pin.innerHTML = '<i></i>'; pin.querySelector('i')!.textContent = pinLabel(place.name);
    new maplibregl.Marker({ element: pin, anchor: 'bottom' }).setLngLat([place.lon, place.lat]).addTo(m);
    m.on('load', () => {
      // the forecast squares (about 28 km) the answer blends: the area a level is for
      if (squares?.length) {
        const h = 0.125;
        m.addSource('squares', { type: 'geojson', data: { type: 'FeatureCollection', features: squares.map((s) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[s.lon - h, s.lat - h], [s.lon + h, s.lat - h], [s.lon + h, s.lat + h], [s.lon - h, s.lat + h], [s.lon - h, s.lat - h]]] } })) } });
        m.addLayer({ id: 'squares', type: 'line', source: 'squares', paint: { 'line-color': '#ffffff', 'line-opacity': 0.55, 'line-width': 1, 'line-dasharray': [3, 3] } });
      }
    });
    return () => { m.remove(); map.current = null; };
  }, [place]);

  // on a phone the chat sheet covers the bottom: keep the pin centred in the part that shows
  useEffect(() => { const m = map.current; if (!m) return; m.easeTo({ padding: { top: 0, bottom: inset, left: 0, right: 0 }, center: [place.lon, place.lat], duration: 400 }); }, [inset, place]);

  // the markers for the points, and the edge arrows for the ones off screen
  useEffect(() => {
    const m = map.current; if (!m) return;
    const marks = pts.map((p) => {
      const el = document.createElement('div'); el.className = `mk ${p.kind}`; el.innerHTML = `<i>${p.title.replace(/[<&]/g, '')}</i>`;
      // a past flood opens its replay in the time machine
      if (p.kind === 'past' && p.id !== undefined) { el.style.cursor = 'pointer'; el.onclick = () => { location.href = `/?past=${p.id}`; }; }
      return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lon!, p.lat!]).addTo(m);
    });
    let raf = 0;
    const edges = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // the visible box: below the "near" button, above the sheet
        const w = m.getContainer().clientWidth, top = 64, bottom = m.getContainer().clientHeight - inset - 24, side = 34;
        const cx = w / 2, cy = (top + bottom) / 2, hw = cx - side, hh = (bottom - top) / 2;
        const out = pts.flatMap((p, i) => {
          const s = m.project([p.lon!, p.lat!]);
          if (s.x >= side && s.x <= w - side && s.y >= top && s.y <= bottom) return [];
          // where the line from the centre to the point leaves the visible box
          const dx = s.x - cx, dy = s.y - cy, k = Math.min(hw / Math.abs(dx || 1e-6), hh / Math.abs(dy || 1e-6));
          return [{ i, x: cx + dx * k, y: cy + dy * k, deg: (Math.atan2(dy, dx) * 180) / Math.PI }];
        });
        // two arrows on the same stretch of edge: move the later one along it, so both can be tapped
        for (let a = 1; a < out.length; a++) for (let b = 0; b < a; b++) {
          if (Math.hypot(out[a].x - out[b].x, out[a].y - out[b].y) < 40) {
            const onSide = Math.abs(out[a].x - cx) >= hw - 1;
            if (onSide) out[a].y = Math.min(bottom, out[b].y + 40); else out[a].x = Math.min(w - side, out[b].x + 74);
          }
        }
        setArrows(out);
      });
    };
    m.on('move', edges); m.once('idle', edges); edges();
    return () => { m.off('move', edges); marks.forEach((x) => x.remove()); cancelAnimationFrame(raf); };
  }, [points, inset]);

  const show = (p: NearPoint) => {
    const m = map.current; if (!m || p.lat === undefined) return;
    // fit the pin and the point, so the person sees how far it is
    const b = new maplibregl.LngLatBounds([place.lon, place.lat], [place.lon, place.lat]).extend([p.lon!, p.lat!]);
    // (the sheet's height is already the map's own bottom padding, which fitBounds adds to this)
    m.fitBounds(b, { padding: { top: 120, left: 60, right: 60, bottom: 50 }, maxZoom: 16, duration: 1200 });
  };
  useImperativeHandle(ref, () => ({ show }), [place, inset]);

  return (
    <div className="map2d">
      <div className="ml" ref={box} />
      {arrows.map((a) => (
        <button key={a.i} type="button" className="edge" style={{ left: a.x, top: a.y }} onClick={() => show(pts[a.i])} aria-label={`${pts[a.i].title}, ${distance(pts[a.i].m)} ${pts[a.i].direction}`}>
          <i style={{ transform: `rotate(${a.deg}deg)` }} /><span>{distance(pts[a.i].m)}</span>
        </button>
      ))}
    </div>
  );
});
