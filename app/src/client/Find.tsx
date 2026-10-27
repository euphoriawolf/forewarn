// Landing and "find your place": search, pick a result, then drag the map so the pin sits on your door.
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import * as I from './icons';
import type { Place } from './types';

// Vite moves MapLibre's files, so tell it where its background worker is.
maplibregl.setWorkerUrl(workerUrl);

// Sentinel-2 cloudless 2024 by EOX: free for non-commercial use, attribution required.
const SATELLITE: maplibregl.StyleSpecification = {
  version: 8,
  sources: { s2: { type: 'raster', tileSize: 256, maxzoom: 15, attribution: 'Sentinel-2 cloudless 2024 by EOX IT Services (contains modified Copernicus Sentinel data)', tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg'] } },
  layers: [{ id: 's2', type: 'raster', source: 's2' }],
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
    map.current = new maplibregl.Map({ container: box.current!, style: SATELLITE, center: [place.lon, place.lat], zoom: 14.3, maxZoom: 17, attributionControl: { compact: true } });
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
