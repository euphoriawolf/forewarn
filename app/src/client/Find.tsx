// Landing and "find your place": search, pick a result, then drag the map so the pin sits on your door.
import { lazy, Suspense, useEffect, useState } from 'react';
import * as I from './icons';
import type { Place } from './types';

// the satellite map (a large library) loads only when there is a pin to place
const Pin = lazy(() => import('./Pin').then((m) => ({ default: m.Pin })));
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

  if (picked) return <Suspense fallback={<div className="screen"><div className="skeleton" style={{ flex: 1 }} /></div>}><Pin place={picked} onBack={() => setPicked(null)} onDone={onPlace} /></Suspense>;
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

