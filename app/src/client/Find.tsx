// Landing and "find your place": search, pick a result, then drag the map so the pin sits on your door.
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import * as I from './icons';
import type { Place } from './types';

// Vite moves MapLibre's files, so tell it where its background worker is.
maplibregl.setWorkerUrl(workerUrl);

// Esri World Imagery: sharp enough to find your own roof (about 0.5 m in Lagos and Nairobi).
// Free for non-commercial use with the credit shown; a paid launch needs an Esri account or
// another source. (Sentinel-2 from EOX, used in the 3D, is 10 m: too soft for placing a pin.)
const SATELLITE: maplibregl.StyleSpecification = {
  version: 8,
  sources: { img: { type: 'raster', tileSize: 256, maxzoom: 19, attribution: 'Imagery: Esri, Maxar, Earthstar Geographics', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'] } },
  layers: [{ id: 'img', type: 'raster', source: 'img' }],
};

export function Find({ onPlace }: { onPlace: (p: Place) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Place[]>([]);
  const [picked, setPicked] = useState<Place | null>(null);
  const [error, setError] = useState('');

  // search as you type, after a short pause
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      try { setHits(await fetch(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r.json())); setError(''); }
      catch { setError('Search is not answering. Check your connection and try again.'); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const locate = () => navigator.geolocation?.getCurrentPosition(
    (p) => setPicked({ name: 'Your location', where: '', lat: p.coords.latitude, lon: p.coords.longitude }),
    () => setError('Location is off. Search for your place instead.'),
    { enableHighAccuracy: true, timeout: 10000 },
  );

  if (picked) return <Pin place={picked} onBack={() => setPicked(null)} onDone={onPlace} />;
  return (
    <div className="screen">
      <div className="hero"><img src="/hero.jpg" alt="Eastleigh, Nairobi, in the March 2026 storm, from the Forewarn 3D view" /><span>Eastleigh, Nairobi. March 2026 storm</span></div>
      <div className="brand"><I.Logo />Forewarn</div>
      <p className="h1">Know what the weather will do to your place, before it happens.</p>
      <label className="field"><I.Search /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Your street, farm or village" aria-label="Search for your place" /></label>
      {hits.length > 0 && (
        <div className="results">
          {hits.map((h, i) => <button key={i} type="button" onClick={() => setPicked(h)}><b>{h.name}</b><small>{h.where}</small></button>)}
        </div>
      )}
      <button className="btn light" type="button" onClick={locate}><I.Locate />Use my location</button>
      {error && <div className="error">{error}</div>}
      <p className="fine">Free. Covers Africa. Weather forecasts from ECMWF through Open-Meteo. Street-level flood history in Lagos and Nairobi from Flood Check.</p>
    </div>
  );
}

function Pin({ place, onBack, onDone }: { place: Place; onBack: () => void; onDone: (p: Place) => void }) {
  const box = useRef<HTMLDivElement>(null), map = useRef<maplibregl.Map | null>(null);
  useEffect(() => {
    map.current = new maplibregl.Map({ container: box.current!, style: SATELLITE, center: [place.lon, place.lat], zoom: 16.5, maxZoom: 19, attributionControl: { compact: true } });
    return () => map.current?.remove();
  }, [place]);
  const done = () => { const c = map.current!.getCenter(); onDone({ ...place, lat: +c.lat.toFixed(5), lon: +c.lng.toFixed(5) }); };
  return (
    <div className="screen">
      <div className="top"><div><b>{place.name}</b><small>{place.where}</small></div><button className="chip" type="button" onClick={onBack}>Change</button></div>
      <div className="map"><div className="ml" ref={box} /><div className="pin"><i>Your place</i></div><div className="hint">Drag the map to put the pin on your door</div></div>
      <button className="btn dark" type="button" onClick={done}>This is my place</button>
    </div>
  );
}
